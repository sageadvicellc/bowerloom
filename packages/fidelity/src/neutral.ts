/**
 * The neutral guardrail model (locked-in parts spec, section 8.1): what a definition decides, with no engine.
 *
 * The precedence is fixed: `deny` beats `ask`, and `ask` beats `allow`, whatever the order of the rules. A request no
 * rule matches gets `default`, the engine default.
 *
 * The neutral pattern language of each action:
 * - `shell`: Claude Code's Bash pattern. `*` matches any text, spaces too. A trailing ` *` that is the only wildcard also
 *   matches the bare command, and a trailing `:*` means the same. A command line is split into its simple commands; a
 *   `deny` or `ask` fires when any of them matches, and an `allow` needs every one to match. Before matching, the
 *   wrappers Claude Code strips are stripped, and a `deny` or `ask` also skips leading `NAME=value` words. Matching is on
 *   the text as written, so quoting, `sudo`, `env`, `bash -c`, and absolute paths escape a rule in every engine, and
 *   every guardrail loss line says so (section 8.3 rule 6).
 * - `read`, `edit`, `write`: the path language of `paths.ts`. `edit` and `write` are one action, a change to a file,
 *   because every engine joins them (section 8.4). A `read` deny also blocks a change to the same path.
 * - `web`: a host name, where `*` matches any text. The pattern `*` also covers web search.
 * - `mcp`: `server` for every tool of a server, `server/tool`, or `*` for every server. A tool may hold `*`.
 * - `subagent` and `skill`: a name, where `*` matches any text.
 */
import type { GuardrailEffect, GuardrailRule } from '../../harness-definition/src/index.js';
import { combineParts, type Decision } from './decision.js';
import { pathMatches, pathPatternProblem, type PathMode } from './paths.js';
import { splitCommand, stripAssignments, stripWrappers } from './shell.js';

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

/** The forms of one simple command that a rule of this effect is matched against. */
export function shellForms(part: string, effect: GuardrailEffect): string[] {
  const forms = new Set([part, stripWrappers(part)]);
  if (effect !== 'allow') {
    for (let i = 0; i < 4; i++) for (const f of [...forms]) { forms.add(stripAssignments(f)); forms.add(stripWrappers(f)); }
  }
  return [...forms];
}

/** The decision of shell patterns, grouped by effect, for one command line. Shared with Claude Code, which is exact. */
export function shellDecision(patterns: Readonly<Record<GuardrailEffect, readonly string[]>>, command: string): Decision {
  const parts = splitCommand(command);
  if (parts.length === 0) return 'default';
  const compiled = {
    deny: patterns.deny.map(bashPatternRegex), ask: patterns.ask.map(bashPatternRegex), allow: patterns.allow.map(bashPatternRegex),
  };
  const hits = (effect: GuardrailEffect, part: string) => shellForms(part, effect).some(f => compiled[effect].some(re => re.test(f)));
  return combineParts(parts.map(part => hits('deny', part) ? 'deny' : hits('ask', part) ? 'ask' : hits('allow', part) ? 'allow' : 'default'));
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

/** True when one neutral rule applies to one request. A rule outside the neutral language matches nothing. */
export function ruleMatches(rule: RuleShape, request: NeutralRequest): boolean {
  if (patternProblem(rule) !== null) return false;
  switch (request.action) {
    case 'shell':
      return rule.action === 'shell' && shellDecision({ deny: [], ask: [], allow: [], [rule.effect]: [rule.pattern] }, request.command) !== 'default';
    case 'read':
      return rule.action === 'read' && pathMatches(rule.pattern, request.path, pathMode(rule.effect));
    case 'edit': case 'write':
      if (rule.action === 'read') return rule.effect === 'deny' && pathMatches(rule.pattern, request.path, 'any-depth');
      return (rule.action === 'edit' || rule.action === 'write') && pathMatches(rule.pattern, request.path, pathMode(rule.effect));
    case 'web':
      if (rule.action !== 'web') return false;
      return 'search' in request ? rule.pattern === '*' : globRegex(rule.pattern).test(request.host);
    case 'mcp':
      return rule.action === 'mcp' && mcpMatches(rule.pattern, request.server, request.tool);
    case 'subagent': case 'skill':
      return rule.action === request.action && globRegex(rule.pattern).test(request.name);
  }
}

/**
 * The neutral decision for one request. For a shell request every simple command is judged on its own and the results
 * combine: any `deny` denies, else any `ask` asks, else `allow` only when every command is allowed.
 */
export function neutralDecision(rules: readonly RuleShape[], request: NeutralRequest): Decision {
  const valid = rules.filter(r => patternProblem(r) === null);
  if (request.action === 'shell') {
    const by = (effect: GuardrailEffect) => valid.filter(r => r.action === 'shell' && r.effect === effect).map(r => r.pattern);
    return shellDecision({ deny: by('deny'), ask: by('ask'), allow: by('allow') }, request.command);
  }
  const matching = valid.filter(r => ruleMatches(r, request));
  if (matching.some(r => r.effect === 'deny')) return 'deny';
  if (matching.some(r => r.effect === 'ask')) return 'ask';
  return matching.some(r => r.effect === 'allow') ? 'allow' : 'default';
}

