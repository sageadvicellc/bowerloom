/** `bowerloom context guard --agent <role> --explain <path>`: what the guard decides for one path, in one line. Reads only. */
import fs from 'node:fs';
import { posix } from 'node:path';
import { discoverProject } from '../../../packages/project-context/src/index.js';
import { planProjectApply } from '../../../packages/project-sync/src/index.js';
import { syncError } from '../../../packages/project-sync/src/refusal.js';
import { decideGuard } from '../../../packages/context-slices/src/guard.js';
import { identityFrom, projectId } from '../../../packages/project-context/src/discovery.js';
import { plain } from '../../../packages/context-slices/src/guard.js';
import { loadGuardView } from './guard-view.js';
import { privateStateRoot } from '../../../packages/project-context/src/index.js';
import { INTERNAL_ERROR_TEXT } from './guard-run.js';
import type { GuardIo, ParsedGuard } from './guard-run.js';

export async function runExplain(parsed: Extract<ParsedGuard, { form: 'explain' }>, io: GuardIo): Promise<0 | 2> {
  const project = discoverProject(io.cwd, io.home), stateRoot = privateStateRoot(io.env, io.home);
  const plan = await planProjectApply({ project, stateRoot, engines: ['claude-code'], team: null, agentsOnly: true, home: io.home });
  const agent = plan.agents.find(a => a.id === parsed.role && a.state !== 'orphaned');
  if (agent === undefined) throw syncError('CONTEXT_AGENT_NOT_FOUND');
  const slices = parsed.slices.length ? parsed.slices : agent.context.guard ?? [];
  const roots = slices.flatMap(id => { const s = plan.slices.find(x => x.id === id); if (!s?.root) return []; try { const real = fs.realpathSync(s.root.dir); return [`${id}:${projectId(real, identityFrom(fs.lstatSync(real, { bigint: true })))}`]; } catch { return []; } });
  const target = parsed.path.startsWith('/') ? parsed.path : posix.resolve(io.cwd, parsed.path);
  const toolInput = parsed.tool === 'Read' ? { file_path: parsed.path } : parsed.tool === 'Grep' ? { pattern: 'x', path: parsed.path } : { pattern: parsed.path };
  const view = () => loadGuardView({ role: parsed.role, project: project.dir, projectId: project.projectId, slices, roots }, stateRoot, { explain: true, home: io.home });
  let decision;
  try { decision = decideGuard({ role: parsed.role, project: project.dir, ids: slices, tool: parsed.tool, toolInput, cwd: io.cwd, home: io.home }, view); }
  catch (error) {
    // The hook would block this call with the internal-error reason. A person also gets the system error that caused it.
    const cause = (error as { code?: unknown } | null)?.code;
    io.out(`denied (GUARD_INTERNAL_ERROR): ${INTERNAL_ERROR_TEXT}${typeof cause === 'string' && /^[A-Z0-9_]{1,40}$/.test(cause) ? ` Cause: ${cause}.` : ''}\n`);
    return 0;
  }
  const shown = plain(parsed.path);
  if (decision.kind === 'deny') io.out(`denied (${decision.code}): ${decision.reason}\n`);
  else if (decision.kind === 'invalid') io.out(`denied (GUARD_INPUT_INVALID): ${INVALID}\n`);
  else {
    const hit = memberOf(view(), target);
    io.out(hit ? `allowed: ${shown} is in slice ${hit}\n` : `allowed: no guard rule applies to ${shown}\n`);
  }
  return 0;
}
const INVALID = 'Bowerloom guard: the hook input could not be read, so the call is blocked.';
function memberOf(view: ReturnType<typeof loadGuardView>, target: string): string | null {
  let real: string; try { real = fs.realpathSync(target); } catch { return null; }
  for (const s of view.slices) if (s.state === 'ok' && real.startsWith(s.root + '/') && s.members.includes(real.slice(s.root.length + 1))) return s.id;
  return null;
}
