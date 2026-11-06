/**
 * Codex matchers, read from the matching-semantics note (sections 1 to 4) and its vectors CX01 to CX29.
 *
 * - `prefix_rule`: a pattern is a list of literal argv tokens, or of alternative lists; it matches argv that starts with
 *   it. There is no wildcard: `*` is a literal. Several matches give the strictest decision. Codex 0.157.0.
 * - A `bash`, `zsh`, or `sh` call with `-c` or `-lc` is split into its commands only when the script holds plain words
 *   joined by `&&`, `||`, `;`, or `|`. Otherwise the rule sees `["bash", "-lc", script]`.
 * - An absolute program path matches only with host executable resolution on.
 * - A hook matcher of letters, digits, `_`, and `|` is a list of exact names; anything else is an unanchored regular
 *   expression. `apply_patch` is also matched by `Edit` and `Write`, `spawn_agent` by `Agent`.
 * - The filesystem of a permission profile: a more specific path wins; `deny` globs apply everywhere.
 */
import { combineParts, type Decision } from './decision.js';
import { pathRegex } from './paths.js';

export type CodexDecisionWord = 'allow' | 'prompt' | 'forbidden';

/** One `prefix_rule`. `decision` defaults to `allow`, as in Codex. */
export interface CodexPrefixRule {
  readonly pattern: readonly (string | readonly string[])[];
  readonly decision?: CodexDecisionWord;
  readonly justification?: string;
}

export interface CodexMatchOptions {
  /** Codex `--resolve-host-executables`: an absolute program path matches by its base name. Default: off. */
  readonly resolveHostExecutables?: boolean;
  /** `host_executable` entries: the absolute paths allowed for each base name. */
  readonly hostExecutables?: Readonly<Record<string, readonly string[]>>;
}

const SHELLS = new Set(['bash', 'zsh', 'sh']);
const SCRIPT_FLAGS = new Set(['-c', '-lc']);
const CONTROL = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'select', 'function', '{', '}', '!', 'time']);
const PLAIN = /^[A-Za-z0-9_./:@%+,=^-]+$/;

/**
 * The commands of a script when Codex would split it: plain words, single or double quotes with no expansion inside,
 * joined by `&&`, `||`, `;`, or `|`. Returns null when Codex checks the script as one command.
 */
export function codexScriptCommands(script: string): string[][] | null {
  const commands: string[][] = [];
  let current: string[] = [];
  let i = 0;
  const end = () => { if (current.length === 0) return false; commands.push(current); current = []; return true; };
  while (i < script.length) {
    const c = script[i] as string;
    if (c === ' ' || c === '\t') { i++; continue; }
    const op = ['&&', '||', ';', '|'].find(o => script.startsWith(o, i));
    if (op) { if (!end()) return null; i += op.length; continue; }
    let word = '';
    while (i < script.length && !/[ \t]/.test(script[i] as string) && !['&&', '||', ';', '|'].some(o => script.startsWith(o, i))) {
      const ch = script[i] as string;
      if (ch === "'") {
        const close = script.indexOf("'", i + 1);
        if (close === -1) return null;
        word += script.slice(i + 1, close); i = close + 1; continue;
      }
      if (ch === '"') {
        const close = script.indexOf('"', i + 1);
        if (close === -1) return null;
        const inner = script.slice(i + 1, close);
        if (/[$`\\]/.test(inner)) return null;
        word += inner; i = close + 1; continue;
      }
      if (!PLAIN.test(ch)) return null;
      word += ch; i++;
    }
    if (current.length === 0 && (CONTROL.has(word) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word))) return null;
    current.push(word);
  }
  if (!end()) return null;
  return commands;
}

/** True when Codex sees the plain commands of `bash -lc <command>`, so its rules match each of them. */
export function codexSplits(command: string): boolean {
  return codexScriptCommands(command) !== null;
}

/** The argv lists that Codex checks for one exec call. */
export function codexCommands(argv: readonly string[]): (readonly string[])[] {
  if (argv.length === 3 && SHELLS.has(argv[0] as string) && SCRIPT_FLAGS.has(argv[1] as string)) {
    const split = codexScriptCommands(argv[2] as string);
    if (split) return split;
  }
  return [argv];
}

function resolveProgram(argv: readonly string[], options: CodexMatchOptions): readonly string[] {
  const program = argv[0];
  if (!options.resolveHostExecutables || program === undefined || !program.startsWith('/')) return argv;
  const base = program.slice(program.lastIndexOf('/') + 1);
  const allowed = options.hostExecutables?.[base];
  if (allowed !== undefined && !allowed.includes(program)) return argv;
  return [base, ...argv.slice(1)];
}

/** True when a prefix rule matches argv. */
export function codexPatternMatches(pattern: CodexPrefixRule['pattern'], argv: readonly string[]): boolean {
  if (pattern.length === 0 || argv.length < pattern.length) return false;
  return pattern.every((element, i) => typeof element === 'string' ? element === argv[i] : element.includes(argv[i] as string));
}

const WORD_DECISION: Readonly<Record<CodexDecisionWord, Decision>> = { allow: 'allow', prompt: 'ask', forbidden: 'deny' };

/** What Codex rules decide for one exec call. No match is `default`: heuristics, the approval policy, and the sandbox. */
export function codexDecide(rules: readonly CodexPrefixRule[], argv: readonly string[], options: CodexMatchOptions = {}): Decision {
  return combineParts(codexCommands(argv).map(command => {
    const resolved = resolveProgram(command, options);
    const hits = rules.filter(r => codexPatternMatches(r.pattern, resolved)).map(r => WORD_DECISION[r.decision ?? 'allow']);
    if (hits.includes('deny')) return 'deny';
    if (hits.includes('ask')) return 'ask';
    return hits.includes('allow') ? 'allow' : 'default';
  }));
}

/** The argv of a command line, as the Codex shell tool runs it. */
export function codexShellArgv(command: string): string[] {
  return ['bash', '-lc', command];
}

/**
 * Checks an administrator rule of `requirements.toml` (`[rules] prefix_rules`): tokens are `{ token }` or `{ any_of }`,
 * and the decision can only be `prompt` or `forbidden` (vectors CX13 and CX14).
 */
export function codexRequirementsRule(value: unknown): { readonly ok: true; readonly rule: CodexPrefixRule } | { readonly ok: false; readonly reason: string } {
  const v = value as { pattern?: unknown; decision?: unknown } | null;
  if (typeof v !== 'object' || v === null) return { ok: false, reason: 'A rule must be an object.' };
  if (v.decision !== 'prompt' && v.decision !== 'forbidden') return { ok: false, reason: 'An administrator rule decision can only be prompt or forbidden.' };
  if (!Array.isArray(v.pattern) || v.pattern.length === 0) return { ok: false, reason: 'A rule pattern must be a list of one token or more.' };
  const pattern: (string | string[])[] = [];
  for (const t of v.pattern as unknown[]) {
    const token = t as { token?: unknown; any_of?: unknown };
    if (typeof token?.token === 'string' && token.token !== '') pattern.push(token.token);
    else if (Array.isArray(token?.any_of) && token.any_of.length > 0 && token.any_of.every(x => typeof x === 'string' && x !== '')) pattern.push(token.any_of as string[]);
    else return { ok: false, reason: 'Each pattern token is { token } or { any_of } with text.' };
  }
  return { ok: true, rule: { pattern, decision: v.decision } };
}

const HOOK_ALIASES: Readonly<Record<string, readonly string[]>> = { apply_patch: ['Edit', 'Write'], spawn_agent: ['Agent'] };

/** True when a Codex hook matcher matches a tool name. */
export function codexHookMatches(matcher: string, tool: string): boolean {
  if (matcher === '' || matcher === '*') return true;
  if (/^[A-Za-z0-9_|]+$/.test(matcher)) {
    const names = matcher.split('|');
    return names.includes(tool) || (HOOK_ALIASES[tool] ?? []).some(a => names.includes(a));
  }
  try { return new RegExp(matcher).test(tool); } catch { return false; }
}

/** One entry of a Codex permission profile's filesystem table under `:workspace_roots`. */
export interface CodexFilesystemEntry {
  /** A path relative to each workspace root: `.`, a subpath, or a glob. */
  readonly path: string;
  readonly access: 'read' | 'write' | 'deny';
}

const ACCESS_ORDER = { deny: 0, write: 1, read: 2 } as const;

/**
 * What a Codex permission profile decides for one read or write inside a workspace root. A sandboxed command that the
 * profile does not let through is `deny`; anything the profile lets through is left to the engine, so `default`.
 * Bowerloom's reading of an undocumented case: a `deny` glob wins over a more specific literal entry.
 */
export function codexFilesystemDecide(entries: readonly CodexFilesystemEntry[], op: 'read' | 'write', path: string): Decision {
  const subject = path.startsWith('./') ? path.slice(2) : path;
  const literal: CodexFilesystemEntry[] = [];
  for (const e of entries) {
    const subtree = e.path.endsWith('/**') && !e.path.slice(0, -3).includes('*') ? e.path.slice(0, -3) : null;
    if (subtree !== null) literal.push({ path: subtree, access: e.access });
    else if (e.path.includes('*')) { if (e.access === 'deny' && pathRegex(`/${e.path}`, 'anchored').test(subject)) return 'deny'; }
    else literal.push(e);
  }
  const covering = literal.filter(e => e.path === '.' || subject === e.path || subject.startsWith(`${e.path}/`));
  if (covering.length === 0) return 'default';
  const depth = (e: CodexFilesystemEntry) => e.path === '.' ? 0 : e.path.split('/').length;
  const best = Math.max(...covering.map(depth));
  const access = covering.filter(e => depth(e) === best).sort((a, b) => ACCESS_ORDER[a.access] - ACCESS_ORDER[b.access])[0]!.access;
  if (access === 'deny') return 'deny';
  return access === 'read' && op === 'write' ? 'deny' : 'default';
}

