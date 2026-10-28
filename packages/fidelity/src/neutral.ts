/**
 * The neutral guardrail model (locked-in parts spec, section 8.1): what a definition decides, with no engine.
 *
 * The precedence is fixed: `deny` beats `ask`, and `ask` beats `allow`, whatever the order of the rules. A request no
 * rule matches gets `default`, the engine default.
 *
 * The neutral pattern language of each action:
 * - `shell`: Claude Code's Bash pattern. `*` matches any text, spaces too. A trailing ` *` that is the only wildcard also
 *   matches the bare command, and a trailing `:*` means the same. A command line is split into its simple commands; a
 *   `deny` or `ask` fires when any of them matches, and an `allow` needs every one to match. Runs of spaces and tabs
 *   count as one space (ruling R2). The wrappers Claude Code strips are stripped, and so are `command -p` and `xargs`
 *   with options before a literal program (R4); a `deny` or `ask` also skips leading `NAME=value` words. A command line
 *   with a form the splitter does not fully parse is never allowed from a rule (R1). Matching is on the text as
 *   written, so quoting, `sudo`, `env`, `bash -c`, and absolute paths escape a rule in every engine, and every
 *   guardrail loss line says so (section 8.3 rule 6).
 * - `read`, `edit`, `write`: the path language of `paths.ts`. `edit` and `write` are one action, a change to a file,
 *   because every engine joins them (section 8.4). A `read` deny also blocks a change to the same path. A request path
 *   is resolved first; a `deny` or `ask` ignores letter case (R5).
 * - `web`: a host name, where `*` matches any text. Letter case and a trailing dot do not count (R15); a `deny` or `ask`
 *   also covers subdomains (R5). The pattern `*` also covers web search.
 * - `mcp`: `server` for every tool of a server, `server/tool`, or `*` for every server. A tool may hold `*`.
 * - `subagent` and `skill`: a name, where `*` matches any text.
 */
import type { GuardrailEffect, GuardrailRule } from '../../harness-definition/src/index.js';
import { combineParts, type Decision } from './decision.js';
import { normalizeRequestPath, pathMatches, pathPatternProblem, type PathMode } from './paths.js';
import { collapseWhitespace, joinLines, opaqueForms, rawWords, splitCommand, stripAssignments, stripWrappers } from './shell.js';

/** One action a person or model asks an engine to take. */
export type NeutralRequest =
  | { readonly action: 'shell'; readonly command: string }
  | { readonly action: 'read' | 'edit' | 'write'; readonly path: string }
  | { readonly action: 'web'; readonly host: string }
  | { readonly action: 'web'; readonly search: true }
  | { readonly action: 'mcp'; readonly server: string; readonly tool: string }
  | { readonly action: 'subagent' | 'skill'; readonly name: string };

/** The parts of a rule that matching reads. */
export type RuleShape = Pick<GuardrailRule, 'action' | 'pattern' | 'effect'>;

const NAME = /^[A-Za-z0-9_*-]+$/;
const SERVER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HOST = /^[A-Za-z0-9*][A-Za-z0-9.*-]*$/;

/** Why a rule's pattern is outside the neutral language of its action, or null when it is inside. */
export function patternProblem(rule: RuleShape): string | null {
  const p = rule.pattern;
  switch (rule.action) {
    case 'shell':
      return p.trim() === '' ? 'The shell pattern is empty.' : null;
    case 'read': case 'edit': case 'write':
      return pathPatternProblem(p);
    case 'web':
      return HOST.test(p) ? null : 'A web pattern is a host name, such as example.com or *.example.com, with no scheme or path.';
    case 'mcp': {
      if (p === '*') return null;
      const [server, tool, extra] = p.split('/');
      if (extra !== undefined || server === undefined || !SERVER.test(server)) return 'An MCP pattern is server, server/tool, or *. The server is a server name.';
      return tool === undefined || (tool !== '' && NAME.test(tool)) ? null : 'An MCP tool pattern holds letters, digits, _, -, and *.';
    }
    case 'subagent': case 'skill':
      return NAME.test(p) ? null : `A ${rule.action} pattern holds letters, digits, _, -, and *.`;
  }
}

/** A glob where `*` matches any text and every other character is literal. */
export function globRegex(pattern: string): RegExp {
  return new RegExp(`^${pattern.split('*').map(s => s.replace(/[.+?^$()|{}[\]\\]/g, '\\$&')).join('.*')}$`, 's');
}

/**
 * Claude Code's Bash pattern as a regular expression (matching-semantics note, section 2): `*` matches any text, and a
 * trailing ` *` or `:*` also matches the bare command when it is the only wildcard.
 */
export function bashPatternRegex(pattern: string): RegExp {
  let p = pattern;
  if (p.endsWith(':*')) p = `${p.slice(0, -2)} *`;
  const stars = p.split('*').length - 1;
  const esc = (s: string) => s.replace(/[.+?^$()|{}[\]\\]/g, '\\$&');
  if (stars === 1 && p.endsWith(' *')) return new RegExp(`^${esc(p.slice(0, -2))}(?: .*)?$`, 's');
  return new RegExp(`^${p.split('*').map(esc).join('.*')}$`, 's');
}

/** Whose reading a shell matcher follows. `neutral` adds rulings R2 and R4 to Claude Code's documented reading. */
export type ShellReading = 'neutral' | 'claude-code';

/** The forms of one simple command that a rule of this effect is matched against. */
export function shellForms(part: string, effect: GuardrailEffect, reading: ShellReading = 'neutral'): string[] {
  const strip = { options: reading === 'neutral' };
  const start = reading === 'neutral' ? collapseWhitespace(part) : part;
  const forms = new Set([start, stripWrappers(start, strip)]);
  if (effect !== 'allow') {
    for (let i = 0; i < 4; i++) for (const f of [...forms]) { forms.add(stripAssignments(f)); forms.add(stripWrappers(f, strip)); }
  }
  return [...forms];
}

/** The text with its first word in lower case. */
const lowerFirst = (text: string) => text.replace(/^\S+/, w => w.toLowerCase());

/**
 * The decision of shell patterns, grouped by effect, for one command line, from the parsed parts only. In the neutral
 * reading a deny or ask compares the program word in any letter case (review item W7).
 */
export function shellDecision(patterns: Readonly<Record<GuardrailEffect, readonly string[]>>, command: string, reading: ShellReading = 'neutral'): Decision {
  const parts = splitCommand(command);
  if (parts.length === 0) return 'default';
  const fold = reading === 'neutral' ? lowerFirst : (t: string) => t;
  const compiled = {
    deny: patterns.deny.map(p => bashPatternRegex(fold(p))), ask: patterns.ask.map(p => bashPatternRegex(fold(p))), allow: patterns.allow.map(bashPatternRegex),
  };
  const hits = (effect: GuardrailEffect, part: string) => shellForms(part, effect, reading)
    .flatMap(f => effect === 'allow' ? [f] : [f, fold(f)]).some(f => compiled[effect].some(re => re.test(f)));
  return combineParts(parts.map(part => hits('deny', part) ? 'deny' : hits('ask', part) ? 'ask' : hits('allow', part) ? 'allow' : 'default'));
}

/** The program word of a shell pattern: its first word, or null when that word holds a wildcard. */
export function patternProgram(pattern: string): string | null {
  const first = (pattern.endsWith(':*') ? `${pattern.slice(0, -2)} *` : pattern).trim().split(/\s+/)[0] ?? '';
  return first === '' || first.includes('*') ? null : first;
}

/**
 * For a command line with a form the splitter does not fully parse (ruling R1): the deny and ask rules whose program
 * word appears anywhere in the text. A rule with no literal program word could match anything, so it counts.
 */
function failClosedRules<R extends RuleShape>(rules: readonly R[], command: string): R[] {
  const text = joinLines(command);
  return rules.filter(r => r.action === 'shell' && r.effect !== 'allow' && (() => {
    const program = patternProgram(r.pattern);
    if (program === null) return true;
    const esc = program.replace(/[.+?^$()|{}[\]\\*]/g, '\\$&');
    return new RegExp(`(?:^|[^A-Za-z0-9_-])${esc}(?:[^A-Za-z0-9_-]|$)`, 'i').test(text);
  })());
}

/** The literal words of a shell pattern before its first wildcard. */
function literalWords(pattern: string): string[] {
  const words = (pattern.endsWith(':*') ? `${pattern.slice(0, -2)} *` : pattern).trim().split(/\s+/);
  const out: string[] = [];
  for (const w of words) { if (w.includes('*')) break; out.push(w); }
  return out;
}

/** True when a raw word holds an unquoted $, backtick, {, *, ?, [ or ~. */
function buildsAtRunTime(word: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < word.length; i++) {
    const c = word[i] as string;
    if (quote === "'") { if (c === "'") quote = null; continue; }
    if (c === '\\') { i++; continue; }
    if (quote === '"') { if (c === '"') quote = null; else if (c === '$' || c === '`') return true; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if ('$`{*?[~'.includes(c)) return true;
  }
  return false;
}

/**
 * True when, for a deny or ask rule, a part with the rule's program word builds one of the words the rule names at run
 * time: an unquoted $, backtick, {, *, ?, [ or ~ in its first N words, N being the rule's literal word count (review
 * item W4). Such a line is opaque for the neutral model.
 */
export function ruleOpaque(rules: readonly RuleShape[], command: string): boolean {
  const named = rules.filter(r => r.action === 'shell' && r.effect !== 'allow').map(r => literalWords(r.pattern)).filter(w => w.length > 0);
  if (named.length === 0) return false;
  return splitCommand(command).some(part => {
    const words = rawWords(stripWrappers(stripAssignments(collapseWhitespace(part)))).map(w => w.text);
    const program = (words[0] ?? '').toLowerCase();
    return named.some(literal => literal[0]!.toLowerCase() === program && words.slice(0, literal.length).some(buildsAtRunTime));
  });
}

/** True when the neutral model fails closed on a command line for these rules. */
function isOpaque(rules: readonly RuleShape[], command: string): boolean {
  return opaqueForms(command).length > 0 || ruleOpaque(rules, command);
}

/** The depth mode of a path rule of this effect. */
export function pathMode(effect: GuardrailEffect): PathMode {
  return effect === 'allow' ? 'anchored' : 'any-depth';
}

function mcpMatches(pattern: string, server: string, tool: string): boolean {
  if (pattern === '*') return true;
  const [s, t] = pattern.split('/');
  return s === server && (t === undefined || globRegex(t).test(tool));
}

/**
 * True when a path rule matches a request path. The path is normalized first (ruling R5); a path that leaves the
 * project matches nothing. A deny or ask matches in any letter case, which blocks more; an allow does not.
 */
function pathRuleMatches(rule: RuleShape, path: string, mode: PathMode): boolean {
  const normal = normalizeRequestPath(path);
  return normal !== null && pathMatches(rule.pattern, normal, mode, rule.effect !== 'allow');
}

/**
 * The host contract (review item W10): userinfo, a port, and a trailing dot are dropped, and letters are lower case.
 * It applies to the pattern and to the request alike.
 */
export function normalizeHost(host: string): string {
  let h = host.slice(host.lastIndexOf('@') + 1).replace(/:\d*$/, '');
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h.toLowerCase();
}

/**
 * True when a web rule matches a host. Letter case and a trailing dot are ignored (ruling R15). A deny or ask also
 * covers subdomains (ruling R5).
 */
function webMatches(rule: RuleShape, host: string): boolean {
  const h = normalizeHost(host);
  const p = normalizeHost(rule.pattern);
  return globRegex(p).test(h) || (rule.effect !== 'allow' && globRegex(`*.${p}`).test(h));
}

/** True when one neutral rule applies to one request. A rule outside the neutral language matches nothing. */
export function ruleMatches(rule: RuleShape, request: NeutralRequest): boolean {
  if (patternProblem(rule) !== null) return false;
  switch (request.action) {
    case 'shell':
      if (rule.action !== 'shell') return false;
      if (isOpaque([rule], request.command)) return failClosedRules([rule], request.command).length > 0;
      return shellDecision({ deny: [], ask: [], allow: [], [rule.effect]: [rule.pattern] }, request.command) !== 'default';
    case 'read':
      return rule.action === 'read' && pathRuleMatches(rule, request.path, pathMode(rule.effect));
    case 'edit': case 'write':
      if (rule.action === 'read') return rule.effect === 'deny' && pathRuleMatches(rule, request.path, 'any-depth');
      return (rule.action === 'edit' || rule.action === 'write') && pathRuleMatches(rule, request.path, pathMode(rule.effect));
    case 'web':
      if (rule.action !== 'web') return false;
      return 'search' in request ? rule.pattern === '*' : webMatches(rule, request.host);
    case 'mcp':
      return rule.action === 'mcp' && mcpMatches(rule.pattern, request.server, request.tool);
    case 'subagent': case 'skill':
      return rule.action === request.action && globRegex(rule.pattern).test(request.name);
  }
}

/**
 * For a path request that cannot be resolved inside the project: the deny and ask rules that could apply to it, which
 * make the request ask (review item W10). Null when the path resolves, or the request is not a path.
 */
function unresolvedPathRules<R extends RuleShape>(rules: readonly R[], request: NeutralRequest): R[] | null {
  if (request.action !== 'read' && request.action !== 'edit' && request.action !== 'write') return null;
  if (normalizeRequestPath(request.path) !== null) return null;
  return rules.filter(r => r.effect !== 'allow' && (request.action === 'read'
    ? r.action === 'read'
    : r.action === 'edit' || r.action === 'write' || (r.action === 'read' && r.effect === 'deny')));
}

/**
 * The neutral decision for one request. For a shell request every simple command is judged on its own and the results
 * combine: any `deny` denies, else any `ask` asks, else `allow` only when every command is allowed. A command line with
 * a form the splitter does not fully parse is never allowed from a rule: it asks when a deny or ask rule's program word
 * appears in it, and otherwise gets the engine default (ruling R1).
 */
export function neutralDecision(rules: readonly RuleShape[], request: NeutralRequest): Decision {
  const valid = rules.filter(r => patternProblem(r) === null);
  if (request.action === 'shell') {
    if (isOpaque(valid, request.command)) return failClosedRules(valid, request.command).length > 0 ? 'ask' : 'default';
    const by = (effect: GuardrailEffect) => valid.filter(r => r.action === 'shell' && r.effect === effect).map(r => r.pattern);
    return shellDecision({ deny: by('deny'), ask: by('ask'), allow: by('allow') }, request.command);
  }
  const unresolved = unresolvedPathRules(valid, request);
  if (unresolved !== null) return unresolved.length > 0 ? 'ask' : 'default';
  const matching = valid.filter(r => ruleMatches(r, request));
  if (matching.some(r => r.effect === 'deny')) return 'deny';
  if (matching.some(r => r.effect === 'ask')) return 'ask';
  return matching.some(r => r.effect === 'allow') ? 'allow' : 'default';
}

/**
 * The rules that decided the neutral decision: the rules of the deciding effect that match the request. For a command
 * line the splitter does not fully parse, the deny and ask rules whose program word appears. Empty for `default`.
 */
export function decidingRules<R extends RuleShape>(rules: readonly R[], request: NeutralRequest): R[] {
  const decision = neutralDecision(rules, request);
  if (decision === 'default') return [];
  const valid = rules.filter(r => patternProblem(r) === null);
  if (request.action === 'shell' && isOpaque(valid, request.command)) return failClosedRules(valid, request.command);
  const unresolved = unresolvedPathRules(valid, request);
  if (unresolved !== null) return unresolved;
  const effect = decision as GuardrailEffect;
  if (request.action === 'shell') {
    const parts = splitCommand(request.command);
    return valid.filter(r => r.action === 'shell' && r.effect === effect
      && parts.some(part => shellDecision({ deny: [], ask: [], allow: [], [effect]: [r.pattern] }, part) !== 'default'));
  }
  return valid.filter(r => r.effect === effect && ruleMatches(r, request));
}
