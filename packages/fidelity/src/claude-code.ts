/**
 * Claude Code: `permissions.allow`, `permissions.ask`, and `permissions.deny` in `settings.json`, and the sandbox.
 * Claude Code 2.1.310. The neutral pattern languages are Claude Code's (locked-in parts spec, section 10). Tool names
 * follow section 8.4: `write` becomes `Edit`, because a `Write` rule never matches.
 *
 * Review rulings on 122891c: a shell line is `translated`, because Claude Code's own command parser is not Bowerloom's
 * (R1). A path or web deny or ask is `translated`, because a shell command can still reach the path or host, unless a
 * sandbox the engine carries covers it (R3). A web deny also covers subdomains and a trailing dot (R5). A read deny
 * writes `Read`, `Edit`, and `Write` (R6).
 */
import type { GuardrailRule, SandboxRequirement } from '../../harness-definition/src/index.js';
import type { Decision } from './decision.js';
import { PATH_ALLOW_REACH, escapeSentence } from './escapes.js';
import { bashPatternRegex, globRegex, normalizeHost, shellDecision, type NeutralRequest } from './neutral.js';
import { listMatches, type PathMode } from './paths.js';
import { Collector, type EngineDefault, type SandboxForm, type Translation } from './translation.js';

export interface ClaudeCodeLists {
  readonly allow?: readonly string[];
  readonly ask?: readonly string[];
  readonly deny?: readonly string[];
}

export interface ClaudeCodeForm {
  readonly engine: 'claude-code';
  readonly permissions: { readonly allow: readonly string[]; readonly ask: readonly string[]; readonly deny: readonly string[] };
  readonly sandbox?: SandboxForm;
  readonly defaults: EngineDefault;
}

/** Claude Code's default for a request no rule matches. */
export const CLAUDE_CODE_DEFAULT: EngineDefault = Object.freeze({
  decision: 'default',
  written: false,
  reason: 'Claude Code applies its permission mode to a request no rule matches. Bowerloom writes no mode (section 8.3 rule 12). The research notes do not record what the default mode decides for each tool, so the live check of step 5 records it.',
});

/** A Claude Code tool call: the tool name and the one field a rule reads. */
export interface ClaudeCodeRequest {
  readonly tool: string;
  readonly command?: string;
  readonly path?: string;
  readonly host?: string;
  readonly name?: string;
}

interface Parsed { readonly tool: string; readonly spec: string | undefined }

/** Splits `Tool(spec)`. The spec ends at the last `)`. */
function parse(rule: string): Parsed {
  const open = rule.indexOf('(');
  if (open === -1 || !rule.endsWith(')')) return { tool: rule, spec: undefined };
  return { tool: rule.slice(0, open), spec: rule.slice(open + 1, -1) };
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

function listHits(list: readonly string[], effect: 'allow' | 'ask' | 'deny', request: ClaudeCodeRequest): boolean {
  const parsed = list.map(parse);
  const mode: PathMode = effect === 'allow' ? 'anchored' : 'any-depth';
  const specs = (tool: string) => parsed.filter(p => p.tool === tool);
  const all = (tool: string) => specs(tool).some(p => p.spec === undefined);
  switch (request.tool) {
    case 'Read':
      return all('Read') || listMatches(specs('Read').map(p => p.spec as string).filter(s => s !== undefined), request.path ?? '', mode);
    case 'WebFetch':
      // WebFetch matching ignores letter case (matching-semantics note, section 2: Case).
      return all('WebFetch') || specs('WebFetch').some(p => p.spec?.startsWith('domain:') === true && globRegex(p.spec.slice(7).toLowerCase()).test((request.host ?? '').toLowerCase()));
    case 'Agent': case 'Skill':
      return all(request.tool) || specs(request.tool).some(p => p.spec !== undefined && bashPatternRegex(p.spec).test(request.name ?? ''));
    default:
      if (EDIT_TOOLS.has(request.tool)) {
        const edits = specs('Edit').map(p => p.spec).filter((s): s is string => s !== undefined);
        if (all('Edit') || listMatches(edits, request.path ?? '', mode)) return true;
        // A Read deny also blocks Edit and Write on that path.
        const reads = specs('Read').map(p => p.spec).filter((s): s is string => s !== undefined);
        return effect === 'deny' && (all('Read') || listMatches(reads, request.path ?? '', mode));
      }
      return parsed.some(p => p.spec === undefined && globRegex(p.tool).test(request.tool));
  }
}

/** What Claude Code decides for one tool call: `deny`, then `ask`, then `allow`, first match; `default` otherwise. */
export function claudeCodeDecide(lists: ClaudeCodeLists, request: ClaudeCodeRequest): Decision {
  const deny = lists.deny ?? [], ask = lists.ask ?? [], allow = lists.allow ?? [];
  if (request.tool === 'Bash') {
    const bash = (list: readonly string[]) => list.map(parse).filter(p => p.tool === 'Bash').map(p => p.spec ?? '*');
    return shellDecision({ deny: bash(deny), ask: bash(ask), allow: bash(allow) }, request.command ?? '', 'claude-code');
  }
  if (listHits(deny, 'deny', request)) return 'deny';
  if (listHits(ask, 'ask', request)) return 'ask';
  return listHits(allow, 'allow', request) ? 'allow' : 'default';
}

/**
 * True when a Claude Code hook matcher matches a tool name. Letters, digits, `_`, `|`, `-`, space, and comma make an
 * exact list; anything else is an unanchored regular expression (matching-semantics note, section 7 item 3).
 */
export function claudeCodeHookMatches(matcher: string, tool: string): boolean {
  if (matcher === '' || matcher === '*') return true;
  if (/^[A-Za-z0-9_|, -]+$/.test(matcher)) return matcher.split(/[|,]/).map(s => s.trim()).includes(tool);
  try { return new RegExp(matcher).test(tool); } catch { return false; }
}

/** The Claude Code tool call of a neutral request. */
export function claudeCodeRequest(request: NeutralRequest): ClaudeCodeRequest {
  switch (request.action) {
    case 'shell': return { tool: 'Bash', command: request.command };
    case 'read': return { tool: 'Read', path: request.path };
    case 'edit': return { tool: 'Edit', path: request.path };
    case 'write': return { tool: 'Write', path: request.path };
    case 'web': return 'search' in request ? { tool: 'WebSearch' } : { tool: 'WebFetch', host: request.host };
    case 'mcp': return { tool: `mcp__${request.server}__${request.tool}` };
    case 'subagent': return { tool: 'Agent', name: request.name };
    case 'skill': return { tool: 'Skill', name: request.name };
  }
}

export function claudeCodeFormDecide(form: ClaudeCodeForm, request: NeutralRequest): Decision {
  const decision = claudeCodeDecide(form.permissions, claudeCodeRequest(request));
  return decision === 'default' ? form.defaults.decision : decision;
}

/** Translates rules that are inside the neutral language. */
/**
 * The note of a path or web deny or ask (ruling R3, review item W5): a shell command can still reach the path or host.
 * A sandbox requirement gives no path or host scope, so it never makes the line exact; the note names it as one that
 * may cover the rule, for the live check of step 5.
 */
export function bypassNote(rule: GuardrailRule, sandbox: readonly SandboxRequirement[], carried: boolean): string {
  if (rule.effect === 'allow' || !['read', 'edit', 'write', 'web'].includes(rule.action)) return '';
  const web = rule.action === 'web';
  const box = carried ? sandbox.find(s => web ? s.network : s.files) : undefined;
  const reach = ` A shell command can still reach the ${web ? 'host, as with curl' : 'path, as with cat or a redirect'}.`;
  return box ? `${reach} The sandbox ${box.id} may cover it; the live check of step 5 checks it.` : `${reach} No sandbox requirement this engine carries covers it.`;
}

/**
 * The research-note vectors that document each Claude Code deny form (review item W6). The vectors are the authority:
 * a deny form with no D-labelled vector is weakened until the live check of step 5.
 */
const VECTORS = { bash: 'vector CC02, CC03, CC08, CC13, and CC17', read: 'vector CC21, CC22, and CC23', edit: 'vector CC20', write: 'vector CC24', mcp: 'vector CC27' } as const;
const UNDOCUMENTED = 'has no documented vector in the research notes, so the line is weakened until the live check of step 5 confirms it';

/** The Claude Code host patterns of a neutral web deny or ask: the host, its subdomains, and both with a trailing dot. */
export function webDenyHosts(pattern: string): string[] {
  const host = normalizeHost(pattern);
  const hosts = new Set([host, `*.${host}`, `${host}.`, `*.${host}.`]);
  return [...hosts];
}

/** Translates rules that are inside the neutral language. */
export function translateClaudeCode(rules: readonly GuardrailRule[], sandbox: readonly SandboxRequirement[], out: Collector): Translation<ClaudeCodeForm> {
  const lists = { allow: [] as string[], ask: [] as string[], deny: [] as string[] };
  const escapes = escapeSentence('claude-code');
  const pathEscapes = escapeSentence('claude-code', 'path');
  const parser = "Claude Code's own command parser is not Bowerloom's, so how it splits a command line is not known here; the live check of step 5 confirms it.";
  const put = (rule: GuardrailRule, text: string) => {
    const list = lists[rule.effect];
    out.wrote(rule.id, `permissions.${rule.effect}[${list.length}]`);
    list.push(text);
  };
  const carried = (rule: GuardrailRule, text: string) => {
    // A path allow can be reached through .. or other letter case (follow-up ruling 4).
    if (rule.effect === 'allow' && rule.action !== 'web') { out.line(rule, 'weakened', `${text} ${PATH_ALLOW_REACH}`); return; }
    const note = bypassNote(rule, sandbox, true);
    out.line(rule, note === '' ? 'exact' : 'translated', `${text}${note}`);
  };
  const denyLike = (rule: GuardrailRule) => rule.effect !== 'allow';
  for (const rule of rules) {
    const p = rule.pattern;
    switch (rule.action) {
      case 'shell':
        put(rule, `Bash(${p})`);
        out.line(rule, 'translated', `Claude Code carries the rule as Bash(${p}) (documented by ${VECTORS.bash}). ${parser} ${escapes}`);
        break;
      case 'read':
        put(rule, `Read(${p})`);
        if (rule.effect === 'deny') { put(rule, `Edit(${p})`); put(rule, `Write(${p})`); }
        carried(rule, rule.effect === 'deny'
          ? `Claude Code carries the rule as Read(${p}) (documented by ${VECTORS.read}), Edit(${p}) (${VECTORS.edit}), and Write(${p}) (${VECTORS.write}: never matches, harmless), so a change to the path is blocked too. ${pathEscapes}`
          : `Claude Code carries the rule as Read(${p}) (documented by ${VECTORS.read}). ${pathEscapes}`);
        break;
      case 'edit': case 'write':
        put(rule, `Edit(${p})`);
        carried(rule, `Claude Code carries the rule as Edit(${p}) (documented by ${VECTORS.edit}), which covers Edit, Write, and NotebookEdit. A Write rule would never match (${VECTORS.write}). ${pathEscapes}`);
        break;
      case 'web':
        if (p === '*') {
          put(rule, 'WebFetch'); put(rule, 'WebSearch');
          if (denyLike(rule)) { out.line(rule, 'weakened', `Claude Code carries the rule as WebFetch and WebSearch. A bare WebFetch or WebSearch rule ${UNDOCUMENTED}.${bypassNote(rule, sandbox, true)}`); break; }
          carried(rule, 'Claude Code carries the rule as WebFetch and WebSearch.');
          break;
        }
        if (rule.effect === 'allow') { put(rule, `WebFetch(domain:${p})`); out.line(rule, 'exact', `Claude Code carries the rule as WebFetch(domain:${p}). Web search has no domain, as in the source.`); break; }
        for (const host of webDenyHosts(p)) put(rule, `WebFetch(domain:${host})`);
        out.line(rule, 'weakened', `Claude Code carries the rule as WebFetch(domain:...) for ${webDenyHosts(p).join(', ')}, so subdomains and a trailing dot are covered. The domain and *. forms have vector CC25; the trailing-dot form ${UNDOCUMENTED}. Web search has no domain, as in the source.${bypassNote(rule, sandbox, true)}`);
        break;
      case 'mcp': {
        if (p === '*') {
          if (rule.effect === 'allow') { out.line(rule, 'absent', 'Claude Code accepts an MCP allow only after a literal server name, so an allow for every server is not written.'); break; }
          put(rule, 'mcp__*');
          out.line(rule, 'weakened', `Claude Code carries the rule as mcp__*. That form ${UNDOCUMENTED}.`);
          break;
        }
        const [server, tool] = p.split('/') as [string, string | undefined];
        const name = `mcp__${server}__${tool ?? '*'}`;
        // Claude Code joins server and tool with __. A wildcard tool, or a name that holds __, can also match a tool of
        // another server whose name starts with `${server}__`.
        if (server.includes('__') || tool === undefined || tool.includes('*') || tool.includes('__')) {
          if (rule.effect === 'allow') { out.line(rule, 'absent', `In Claude Code, ${name} can also match a tool of another server whose name starts with ${server}__, so the allow could reach that server. Not written.`); break; }
          put(rule, name);
          out.line(rule, 'translated', `Claude Code carries the rule as ${name} (documented by ${VECTORS.mcp}). It can also match a tool of another server whose name starts with ${server}__: it blocks more.`);
          break;
        }
        put(rule, name);
        out.line(rule, 'exact', `Claude Code carries the rule as ${name}${denyLike(rule) ? ` (documented by ${VECTORS.mcp})` : ''}.`);
        break;
      }
      case 'subagent': case 'skill': {
        const tool = rule.action === 'subagent' ? 'Agent' : 'Skill';
        if (!p.includes('*')) {
          put(rule, `${tool}(${p})`);
          if (denyLike(rule)) out.line(rule, 'weakened', `Claude Code carries the rule as ${tool}(${p}). That form ${UNDOCUMENTED}.`);
          else out.line(rule, 'exact', `Claude Code carries the rule as ${tool}(${p}).`);
          break;
        }
        if (rule.effect === 'allow') { out.line(rule, 'absent', `Claude Code documents no wildcard in ${tool}(...), so a name pattern cannot be allowed exactly. Not written.`); break; }
        put(rule, tool);
        out.line(rule, 'weakened', `Claude Code documents no wildcard in ${tool}(...), so the rule covers the whole ${tool} tool: it blocks more than ${p}. A bare ${tool} rule ${UNDOCUMENTED}.`);
        break;
      }
    }
  }
  let box: SandboxForm | undefined;
  for (const s of sandbox) {
    box = { files: s.files || (box?.files ?? false), network: s.network || (box?.network ?? false) };
    out.wrote(s.id, 'sandbox');
    out.line(s, 'exact', 'Claude Code turns its sandbox on for the files and network the requirement names.');
  }
  return out.done<ClaudeCodeForm>({ engine: 'claude-code', permissions: lists, ...(box ? { sandbox: box } : {}), defaults: CLAUDE_CODE_DEFAULT });
}
