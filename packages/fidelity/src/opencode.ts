/**
 * OpenCode 1.x: the `permission` key of `opencode.json`. OpenCode 1.18.30. Locked-in parts spec, section 8.3 rules 5,
 * 9, 10, and 11.
 *
 * - The last matching rule wins, so each key is written with `allow` first, then `ask`, then `deny`. That order gives
 *   the fixed precedence. A pattern appears once per key, with the strictest action.
 * - OpenCode's `*` crosses `/`, `?` matches one character, and a trailing ` *` makes the tail optional. A rule that
 *   OpenCode would read more widely is tightened for `deny` and `ask`, and is `absent` for `allow`.
 * - `webfetch` and `websearch` take one action in 1.x, so a host rule covers the whole tool.
 * - OpenCode documents no sandbox: a sandbox requirement is `absent`, and the form never claims one.
 * - The form is ordered lists, not an object, so a key such as "1" cannot move. Step 3 writes the 1.x shape.
 */
import type { GuardrailEffect, GuardrailRule, SandboxRequirement } from '../../harness-definition/src/index.js';
import { combineParts, type Decision } from './decision.js';
import { escapeSentence } from './escapes.js';
import type { NeutralRequest } from './neutral.js';
import { normalizePath } from './paths.js';
import { splitCommand } from './shell.js';
import { bypassNote } from './claude-code.js';
import { Collector, type EngineDefault, type Translation } from './translation.js';

export interface OpenCodeRule {
  readonly pattern: string;
  readonly action: GuardrailEffect;
}
export interface OpenCodeKey {
  readonly key: string;
  readonly rules: readonly OpenCodeRule[];
}
/** The permission of OpenCode 1.x as ordered keys, each with ordered rules. */
export type OpenCodePermission = readonly OpenCodeKey[];

export interface OpenCodeForm {
  readonly engine: 'opencode';
  /** The OpenCode major version the form is for. */
  readonly version: 1;
  readonly permission: OpenCodePermission;
  /** Never set: OpenCode documents no sandbox. */
  readonly sandbox?: undefined;
  readonly defaults: EngineDefault;
}

export interface WildcardOptions {
  /** On `win32` matching ignores case. Default: any other platform. */
  readonly platform?: string;
}

/** OpenCode's wildcard match (`util/wildcard.ts` at v1.18.30, as the matching-semantics note reads it). */
export function openCodeWildcard(subject: string, pattern: string, options: WildcardOptions = {}): boolean {
  const s = subject.replaceAll('\\', '/');
  let source = pattern.replaceAll('\\', '/').replace(/[.+^${}()|[\]]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.');
  if (source.endsWith(' .*')) source = `${source.slice(0, -3)}( .*)?`;
  return new RegExp(`^${source}$`, options.platform === 'win32' ? 'si' : 's').test(s);
}

/** An OpenCode 1.x permission object, in its own key order, as ordered keys. */
export function openCodeFromConfig(config: Readonly<Record<string, GuardrailEffect | Readonly<Record<string, GuardrailEffect>>>>): OpenCodePermission {
  return Object.entries(config).map(([key, value]) => ({
    key,
    rules: typeof value === 'string' ? [{ pattern: '*', action: value }] : Object.entries(value).map(([pattern, action]) => ({ pattern, action })),
  }));
}

/** An OpenCode permission request: the permission name and the subjects it asks for. */
export interface OpenCodeRequest {
  readonly permission: string;
  readonly subjects: readonly string[];
}

/**
 * What OpenCode decides: for each subject the last rule whose key matches the permission and whose pattern matches the
 * subject wins. Subjects combine as in the source: any `deny` denies, else any `ask` asks (vectors OC14 and OC19).
 */
export function openCodeDecide(permission: OpenCodePermission, request: OpenCodeRequest, options: WildcardOptions = {}): Decision {
  const flat = permission.flatMap(k => k.rules.map(r => ({ key: k.key, ...r })));
  return combineParts(request.subjects.map(subject => {
    let hit: Decision = 'default';
    for (const r of flat) if (openCodeWildcard(request.permission, r.key, options) && openCodeWildcard(subject, r.pattern, options)) hit = r.action;
    return hit;
  }));
}

/** The command nodes OpenCode asks about for one command line: every simple command, nested ones too, as written. */
export function openCodeShellSubjects(command: string): string[] {
  return splitCommand(command);
}

/** The OpenCode request of a neutral request. */
export function openCodeRequest(request: NeutralRequest): OpenCodeRequest {
  switch (request.action) {
    case 'shell': return { permission: 'bash', subjects: openCodeShellSubjects(request.command) };
    case 'read': return { permission: 'read', subjects: [request.path] };
    case 'edit': case 'write': return { permission: 'edit', subjects: [request.path] };
    case 'web': return 'search' in request ? { permission: 'websearch', subjects: ['*'] } : { permission: 'webfetch', subjects: [request.host] };
    case 'mcp': return { permission: `${request.server}_${request.tool}`, subjects: ['*'] };
    case 'subagent': return { permission: 'task', subjects: [request.name] };
    case 'skill': return { permission: 'skill', subjects: [request.name] };
  }
}

export function openCodeFormDecide(form: OpenCodeForm, request: NeutralRequest): Decision {
  return openCodeDecide(form.permission, openCodeRequest(request));
}

/** OpenCode patterns for one neutral path rule, and whether OpenCode reads them more widely than the rule. */
export function openCodePathPatterns(pattern: string, effect: GuardrailEffect): { readonly patterns: readonly string[]; readonly wider: boolean } {
  const { body, dirOnly, anchored } = normalizePath(pattern);
  const segments = body.split('/');
  const wider = segments.some((s, i) => s !== '**' && s.includes('*') && !(i === segments.length - 1 && s === '*'));
  let bases = [''];
  segments.forEach((segment, i) => {
    const join = (b: string, s: string) => b === '' ? s : `${b}/${s}`;
    if (segment !== '**') { bases = bases.map(b => join(b, segment)); return; }
    bases = i === segments.length - 1 ? bases.map(b => join(b, '*')) : bases.flatMap(b => [b, join(b, '*')]);
  });
  const anyDepth = !anchored && (effect !== 'allow' || !body.includes('/'));
  const out = new Set<string>();
  for (const base of bases) {
    const variants = dirOnly ? [`${base}/*`] : base === '*' || base.endsWith('/*') ? [base] : [base, `${base}/*`];
    for (const v of variants) { out.add(v); if (anyDepth && !v.startsWith('*')) out.add(`*/${v}`); }
  }
  return { patterns: [...out], wider };
}

const RANK: Readonly<Record<GuardrailEffect, number>> = { allow: 0, ask: 1, deny: 2 };
const READ_LIKE = ['grep', 'glob', 'list'];
const KEY_ORDER = ['*', 'bash', 'read', ...READ_LIKE, 'edit', 'webfetch', 'websearch', 'task', 'skill'];

/**
 * OpenCode's built-in default for a request no rule matches is allow (agent defaults come first, then the
 * configuration). Bowerloom writes an explicit ask default as the first key (ruling R8); every later rule overrides it.
 */
export const OPENCODE_DEFAULT: EngineDefault = Object.freeze({
  decision: 'ask',
  written: true,
  reason: 'OpenCode allows a request that no rule matches. Bowerloom writes "*": { "*": "ask" } as the first key, so such a request asks.',
});

export function translateOpenCode(rules: readonly GuardrailRule[], sandbox: readonly SandboxRequirement[], out: Collector): Translation<OpenCodeForm> {
  const keys = new Map<string, Map<string, { action: GuardrailEffect; sources: string[] }>>();
  const put = (rule: GuardrailRule, key: string, pattern: string) => {
    const k = keys.get(key) ?? new Map<string, { action: GuardrailEffect; sources: string[] }>();
    keys.set(key, k);
    const had = k.get(pattern);
    if (!had) k.set(pattern, { action: rule.effect, sources: [rule.id] });
    else { had.sources.push(rule.id); if (RANK[rule.effect] > RANK[had.action]) had.action = rule.effect; }
  };
  const ordered = 'Each key is written allow first, then ask, then deny, so last match wins gives the fixed precedence.';
  const escapes = escapeSentence('opencode');
  const pathEscapes = escapeSentence('opencode', 'path');
  const parser = "OpenCode's own command parser is not Bowerloom's, so how it splits a command line is not known here; the live check of step 5 confirms it.";
  // OpenCode documents no sandbox, so a shell command can always reach a denied path or host (ruling R3).
  const bypass = (rule: GuardrailRule) => bypassNote(rule, sandbox, false).note;
  for (const rule of rules) {
    const p = rule.pattern;
    const allow = rule.effect === 'allow';
    switch (rule.action) {
      case 'shell': {
        const ocPattern = p.endsWith(':*') ? `${p.slice(0, -2)} *` : p;
        const stars = ocPattern.split('*').length - 1;
        const widen: string[] = [];
        if (ocPattern.includes('?')) widen.push('OpenCode reads ? as any one character and has no escape');
        if (ocPattern.includes('\\')) widen.push('OpenCode reads \\ as /');
        if (allow && ocPattern.endsWith(' *') && stars > 1) widen.push('OpenCode makes a trailing " *" optional even beside another wildcard');
        if (allow && ocPattern.includes('/')) widen.push('OpenCode rewrites a backslash in the command to /, so a / in the allow also matches a command with a backslash');
        if (allow && widen.length) { out.line(rule, 'absent', `${widen.join('; ')}, so the allow would cover more commands than ${p}. Not written. ${escapes}`); break; }
        // Ruling R2: a deny or ask writes each literal space as *, so extra spaces and tabs between words are caught.
        const written = allow ? ocPattern : ocPattern.replace(/\s+/g, '*').replace(/\*+/g, '*');
        if (!allow && written !== ocPattern) widen.push('each space is written as *, so extra spaces and tabs are caught, and so is other text in those places');
        put(rule, 'bash', written);
        const more = widen.length ? ` ${widen.join('; ')}, so it blocks more than ${p}.` : '';
        out.line(rule, 'translated', `OpenCode carries the rule under bash as ${written}. ${ordered}${more} ${parser} ${escapes}`);
        break;
      }
      case 'read': case 'edit': case 'write': {
        if (p.startsWith('$HOME')) { out.line(rule, 'absent', `OpenCode expands $HOME at the start of a path pattern, so ${p} would name a folder in the home folder, not the project path of the source. Not written. ${pathEscapes}`); break; }
        const { patterns, wider } = openCodePathPatterns(p, rule.effect);
        if (allow && wider) { out.line(rule, 'absent', `OpenCode's * crosses /, so the allow would cover more paths than ${p}. Not written. ${pathEscapes}`); break; }
        const targets = rule.action === 'read' ? (rule.effect === 'deny' ? ['read', 'edit'] : ['read']) : ['edit'];
        for (const key of targets) for (const pattern of patterns) put(rule, key, pattern);
        // Ruling R9: grep, glob, and list read files too, and their permission subject is not the path in the research
        // notes, so a read deny or ask covers each whole tool.
        const readLike = rule.action === 'read' && !allow;
        if (readLike) for (const key of READ_LIKE) put(rule, key, '*');
        const more = wider ? ` OpenCode's * crosses /, so it blocks more than ${p}.` : '';
        const editToo = targets.length > 1 ? ' A read deny is also written under edit, because it blocks changes too.' : '';
        const tools = readLike ? ` It also ${rule.effect === 'deny' ? 'blocks' : 'asks for'} every grep, glob, and list, which read files too: it blocks more.` : '';
        out.line(rule, 'translated', `OpenCode carries the rule under ${targets.join(' and ')} as ${patterns.join(', ')}, matched against the path from the project root. ${ordered}${editToo}${tools}${more}${bypass(rule)} ${pathEscapes}`);
        break;
      }
      case 'web': {
        if (p === '*') { put(rule, 'webfetch', '*'); put(rule, 'websearch', '*'); out.line(rule, allow ? 'exact' : 'translated', `OpenCode carries the rule as one action for webfetch and websearch.${bypass(rule)}`); break; }
        if (allow) { out.line(rule, 'absent', `OpenCode 1.x takes one action for all of webfetch, so an allow for ${p} would allow every host. Not written.`); break; }
        put(rule, 'webfetch', '*');
        out.line(rule, 'translated', `OpenCode 1.x takes one action for all of webfetch, so the rule covers every host: it blocks more than ${p}.${bypass(rule)}`);
        break;
      }
      case 'subagent': case 'skill': {
        const key = rule.action === 'subagent' ? 'task' : 'skill';
        put(rule, key, p);
        out.line(rule, 'exact', `OpenCode carries the rule under ${key} as ${p}. ${ordered}`);
        break;
      }
      case 'mcp': {
        const [server, tool] = p === '*' ? ['*', '*'] : p.split('/') as [string, string | undefined];
        const key = `${server}_${tool ?? '*'}`;
        // OpenCode joins server and tool with _, so a key can also name a tool of another server.
        const ambiguous = server === '*' || server.includes('_') || tool === undefined || tool.includes('_') || tool.includes('*');
        if (allow && ambiguous) { out.line(rule, 'absent', `OpenCode joins server and tool with _, so the key ${key} can also match a tool of another server. The allow could reach it. Not written.`); break; }
        put(rule, key, '*');
        out.line(rule, ambiguous ? 'translated' : 'exact', ambiguous
          ? `OpenCode carries the rule as the key ${key}. OpenCode joins server and tool with _, so the key can also match a tool of another server: it blocks more.`
          : `OpenCode carries the rule as the key ${key}.`);
        break;
      }
    }
  }
  for (const s of sandbox) out.line(s, 'absent', 'OpenCode documents no sandbox. Bowerloom never labels an OpenCode projection as sandboxed.');

  keys.set('*', new Map([['*', { action: 'ask' as GuardrailEffect, sources: [] as string[] }], ...(keys.get('*') ?? new Map())]));
  const builtIn = KEY_ORDER.filter(k => keys.has(k));
  const mcp = [...keys.keys()].filter(k => !KEY_ORDER.includes(k))
    .sort((a, b) => RANK[keys.get(a)!.get('*')!.action] - RANK[keys.get(b)!.get('*')!.action] || (a < b ? -1 : a > b ? 1 : 0));
  const permission: OpenCodeKey[] = [];
  for (const key of [...builtIn, ...mcp]) {
    const entries = [...keys.get(key)!.entries()].sort((a, b) => RANK[a[1].action] - RANK[b[1].action]);
    entries.forEach(([, v], i) => { for (const source of v.sources) out.wrote(source, `permission.${key}[${i}]`); });
    permission.push({ key, rules: entries.map(([pattern, v]) => ({ pattern, action: v.action })) });
  }
  return out.done<OpenCodeForm>({ engine: 'opencode', version: 1, permission, defaults: OPENCODE_DEFAULT });
}
