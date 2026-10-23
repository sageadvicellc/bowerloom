/**
 * `bowerloom-guard` and `bowerloom context guard` (spec 05, section 3.9): the read guard Claude Code runs before each Read,
 * Grep, and Glob of an agent that names a guarded slice. The hook form reads the hook input from stdin and prints a deny
 * line or nothing. It never prints allow, so it never approves a call that Claude Code would ask about or block.
 * The route catches every error and returns 0 or 2. It never exits the process, so stdout drains to a pipe.
 */
import { join } from 'node:path';
import { strictJson } from '../../../packages/codex-adapter/src/safe.js';
import { decideGuard } from '../../../packages/context-slices/src/guard.js';
import type { GuardDecision, GuardInput } from '../../../packages/context-slices/src/guard.js';
import { isSliceId } from '../../../packages/context-slices/src/slice-file.js';
import { loadGuardView } from './guard-view.js';
import type { GuardArgs } from './guard-view.js';

export const INPUT_INVALID_TEXT = 'Bowerloom guard: the hook input could not be read, so the call is blocked.';
const ROLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, HEX32 = /^[a-f0-9]{32}$/, ROOT = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-f0-9]{32}$/;

export type ParsedGuard = { form: 'hook'; args: GuardArgs } | { form: 'explain'; role: string; path: string; tool: 'Read' | 'Grep' | 'Glob'; slices: string[] };
/** Parses the arguments of either form; null when they are not one of the forms. */
export function parseGuardArgs(argv: readonly string[], explain: boolean): ParsedGuard | null {
  let role: string | null = null, project: string | null = null, id: string | null = null, path: string | null = null, tool: string | null = null;
  const slices: string[] = [], roots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!, value = argv[i + 1];
    if (value === undefined) return null;
    if (word === '--agent') { if (role !== null) return null; role = value; }
    else if (word === '--project') { if (project !== null) return null; project = value; }
    else if (word === '--project-id') { if (id !== null) return null; id = value; }
    else if (word === '--slice') slices.push(value);
    else if (word === '--root') roots.push(value);
    else if (word === '--explain' && explain) { if (path !== null) return null; path = value; }
    else if (word === '--tool' && explain) { if (tool !== null) return null; tool = value; }
    else return null;
    i++;
  }
  if (role === null || !ROLE.test(role) || slices.length > 64 || !slices.every(isSliceId) || new Set(slices).size !== slices.length || !roots.every(r => ROOT.test(r)) || roots.length > slices.length) return null;
  if (path !== null) {
    if (project !== null || id !== null || roots.length || (tool !== null && tool !== 'Read' && tool !== 'Grep' && tool !== 'Glob')) return null;
    return { form: 'explain', role, path, tool: (tool ?? 'Read') as 'Read', slices };
  }
  if (tool !== null || project === null || !project.startsWith('/') || project.includes('\0') || id === null || !HEX32.test(id) || slices.length < 1) return null;
  return { form: 'hook', args: { role, project, projectId: id, slices: [...slices], roots } };
}

/** Reads stdin to the end: at most 1 MiB, for at most 5 seconds. Null when it does not fit. */
export async function readLimited(stdin: AsyncIterable<unknown>, maxBytes = 1048576, ms = 5000): Promise<string | null> {
  const chunks: Buffer[] = []; let size = 0, timer: NodeJS.Timeout | undefined;
  const read = (async (): Promise<string | null> => {
    for await (const chunk of stdin) { const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)); size += b.length; if (size > maxBytes) return null; chunks.push(b); }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { return null; }
  })();
  // PR 102 rounds 1 and 2, item 5: a stdin that fails after the timeout must never surface as a rejection nobody
  // handles, which would crash with exit 1. Promise.race below already handles that rejection, because it subscribes
  // to `read`. This handler is a safeguard only: it keeps that true if the race is ever replaced.
  read.catch(() => { /* the race below decides */ });
  const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); timer.unref?.(); });
  try { return await Promise.race([read, timeout]); } finally { if (timer) clearTimeout(timer); }
}

export const denyLine = (reason: string): string => `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`;
/** An error the guard did not expect. It gets its own reason, so it is never read as a project mismatch. */
export const INTERNAL_ERROR_TEXT = 'Bowerloom guard: the guard hit an internal error, so the call is blocked. Run bowerloom apply, or reinstall Bowerloom.';

export interface GuardIo { stdin: AsyncIterable<unknown>; out: (text: string) => void; err: (text: string) => void; env: NodeJS.ProcessEnv; home: string; cwd: string }

function hookInput(text: string): Pick<GuardInput, 'tool' | 'toolInput' | 'cwd'> | null {
  let value: unknown;
  try { value = strictJson(text, 1048576); } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.tool_name !== 'string' || v.tool_input === null || typeof v.tool_input !== 'object' || Array.isArray(v.tool_input) || typeof v.cwd !== 'string' || !v.cwd.startsWith('/')) return null;
  return { tool: v.tool_name, toolInput: v.tool_input as Record<string, unknown>, cwd: v.cwd };
}
function stateRootOf(env: NodeJS.ProcessEnv, home: string): string {
  const xdg = env.XDG_STATE_HOME;
  return join(typeof xdg === 'string' && xdg !== '' && xdg.startsWith('/') && !xdg.includes('\0') ? xdg : join(home, '.local', 'state'), 'bowerloom');
}

/** The hook form. Returns the exit code: 0 with a deny line or silence, 2 for input it cannot read. */
export async function runHook(args: GuardArgs, io: GuardIo): Promise<0 | 2> {
  const text = await readLimited(io.stdin), input = text === null ? null : hookInput(text);
  if (input === null) { io.err(INPUT_INVALID_TEXT); return 2; }
  let decision: GuardDecision;
  try {
    decision = decideGuard({ role: args.role, project: args.project, ids: args.slices, tool: input.tool, toolInput: input.toolInput, cwd: input.cwd, home: io.home }, () => loadGuardView(args, stateRootOf(io.env, io.home), { home: io.home }));
  } catch { decision = { kind: 'deny', code: 'GUARD_INTERNAL_ERROR', reason: INTERNAL_ERROR_TEXT }; }
  if (decision.kind === 'invalid') { io.err(INPUT_INVALID_TEXT); return 2; }
  if (decision.kind === 'deny') io.out(denyLine(decision.reason));
  return 0;
}

/** Runs `bowerloom-guard` or `bowerloom context guard` (hook form, or with --explain when `explain` is true). */
export async function runGuard(argv: readonly string[], io: GuardIo, explain = false): Promise<0 | 2> {
  try {
    const parsed = parseGuardArgs(argv, explain);
    if (parsed === null) { io.err(INPUT_INVALID_TEXT); return 2; }
    if (parsed.form === 'hook') return await runHook(parsed.args, io);
    // The explain form is for a person: a refusal reaches the command line as it does for any command.
    const { runExplain } = await import('./guard-explain.js');
    return await runExplain(parsed, io);
  } catch (error) {
    if (explain && parseGuardArgs(argv, true)?.form === 'explain') throw error;
    try { io.out(denyLine('Bowerloom guard: the guard could not run, so the call is blocked. Run bowerloom apply, or reinstall Bowerloom.')); return 0; } catch { return 2; }
  }
}
