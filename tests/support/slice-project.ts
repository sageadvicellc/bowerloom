// A project with a wiki, the slice `wiki`, and the agent `lead` applied, through the real command line. Not a test file.
// HOME and XDG_STATE_HOME point at a private folder, so nothing touches the real home.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { TestContext } from 'node:test';

export const cli = fileURLToPath(new URL('../../apps/cli/src/main.js', import.meta.url));
export const guardMain = fileURLToPath(new URL('../../apps/cli/src/guard-main.js', import.meta.url));
export interface RunOptions { input?: string; env?: NodeJS.ProcessEnv; timeout?: number }
export function folder(t: TestContext, prefix = 'bowerloom-slices-cli-'): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix))); t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}
export const envFor = (home: string): NodeJS.ProcessEnv => ({ ...process.env, HOME: home, XDG_STATE_HOME: join(home, 'state') });
export function run(cwd: string, args: string[], home: string, o: RunOptions = {}, entry = cli) {
  const r = spawnSync(process.execPath, [entry, ...args], { cwd, encoding: 'utf8', timeout: o.timeout ?? 60000, env: o.env ?? envFor(home), ...(o.input === undefined ? {} : { input: o.input }) });
  assert.equal(r.error, undefined); return r;
}
export const revisionIn = (stdout: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };
export function put(dir: string, rel: string, text: string): string {
  const file = join(dir, rel);
  // Only the folders this call makes get mode 0755; a folder that is already there keeps its mode.
  const missing: string[] = []; for (let p = dirname(file); p.startsWith(dir + '/') && !existsSync(p); p = dirname(p)) missing.unshift(p);
  for (const p of missing) { mkdirSync(p, { mode: 0o755 }); chmodSync(p, 0o755); }
  writeFileSync(file, text, { mode: 0o644 }); return file;
}
/** Runs a command that plans first, then applies it with its own revision. */
export function approve(cwd: string, args: string[], home: string): void {
  const planned = run(cwd, args, home); assert.equal(planned.status, 3, planned.stdout + planned.stderr);
  const applied = run(cwd, [...args, '--approve', revisionIn(planned.stdout)], home); assert.equal(applied.status, 0, applied.stdout + applied.stderr);
}
/** `kb` is the registered folder `kb` when the project was made with `registered: true`, else null. */
export interface SliceProject { home: string; dir: string; agent: string; kb: string | null }
export const AGENT = (extra = ''): string => `---\nname: lead\ndescription: Leads the desk.\nskills: [slice-wiki]\n${extra}---\nDo the work.\n`;
/** init, a wiki of three pages, `slice create wiki --root wiki`, the agent `lead`, and `apply --harness claude`. */
export function sliceProject(t: TestContext, { apply = true, agentExtra = '', root = 'wiki', registered = false }: { apply?: boolean; agentExtra?: string; root?: string; registered?: boolean } = {}): SliceProject {
  const home = folder(t), dir = join(home, 'studio'); mkdirSync(dir);
  const init = ['--mode', 'existing', '--target', dir, '--name', 'Studio handbook', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  const plan = run(home, ['init', 'plan', ...init, '--json'], home); assert.equal(plan.status, 0, plan.stderr);
  const applied = run(home, ['init', 'apply', ...init, '--approve', JSON.parse(plan.stdout).revision], home); assert.equal(applied.status, 0, applied.stderr);
  // A registered project keeps the wiki in the folder `kb` beside the project, registered with `folder add`.
  const base = registered ? join(home, 'kb') : dir;
  if (registered) { mkdirSync(base, { mode: 0o755 }); chmodSync(base, 0o755); }
  put(base, `${root}/a.md`, '# Alpha\nbody a\n'); put(base, `${root}/sub/b.md`, '# Beta\nbody b\n'); put(base, `${root}/secret.txt`, 'not in the slice\n');
  if (registered) approve(dir, ['folder', 'add', 'kb', base], home);
  approve(dir, ['slice', 'create', 'wiki', '--root', root, '--include', '**/*.md', ...(registered ? ['--registered', 'kb'] : [])], home);
  const agent = put(dir, '.bowerloom/teams/first-team/agents/lead.md', AGENT(agentExtra));
  if (apply) approve(dir, ['apply', '--harness', 'claude'], home);
  return { home, dir, agent, kb: registered ? base : null };
}
/** The arguments of the guard hook in the installed copy of `lead`. */
export function guardArgs(p: SliceProject, role = 'lead'): string[] {
  const text = readFileSync(join(p.dir, '.claude/agents', role + '.md'), 'utf8');
  const front = parse(text.split('\n---\n')[0]!.replace(/^---\n/, '')) as { hooks: { PreToolUse: { hooks: { args: string[] }[] }[] } };
  return front.hooks.PreToolUse.at(-1)!.hooks[0]!.args;
}
export const hookInput = (tool: string, toolInput: Record<string, unknown>, cwd: string): string => JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, cwd });
export const denyJson = (reason: string): string => `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`;

/**
 * Rewrites the catalog of an installed item and fixes the pin in its committed receipt, so that only the guard's own checks of the
 * catalog can refuse it. `edit` gets the parsed catalog. The receipt revision is made again from the new body.
 */
export async function tamperCatalog(p: SliceProject, itemId: string, edit: (catalog: Record<string, unknown>) => void): Promise<void> {
  const { surfaceV2 } = await import('../../packages/managed-skills/src/v2-observed.js');
  const { revisionOf } = await import('../../packages/skill-sources/src/validation.js');
  const { identityFrom, projectId } = await import('../../packages/project-context/src/discovery.js');
  const { lstatSync, readdirSync } = await import('node:fs');
  const catalog = join(p.dir, '.bowerloom/managed/catalog', itemId + '.json'), value = JSON.parse(readFileSync(catalog, 'utf8')) as Record<string, unknown>;
  edit(value); writeFileSync(catalog, JSON.stringify(value) + '\n');
  const id = projectId(p.dir, identityFrom(lstatSync(p.dir, { bigint: true }))), state = join(p.home, 'state', 'bowerloom', id, 'items', itemId);
  for (const op of readdirSync(state).filter(n => /^op-[a-f0-9]{64}$/.test(n))) {
    const file = join(state, op, 'receipt.json'), receipt = JSON.parse(readFileSync(file, 'utf8')) as { installed: { id: string; kind: 'file'; path: string; pins: unknown }[]; revision?: string };
    const surface = receipt.installed.find(x => x.id === 'catalog'); if (!surface) continue;
    surface.pins = surfaceV2('catalog', 'file', catalog).pins;
    delete receipt.revision; receipt.revision = revisionOf(receipt);
    writeFileSync(file, JSON.stringify(receipt));
  }
}
