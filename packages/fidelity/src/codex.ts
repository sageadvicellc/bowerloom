/**
 * Codex: `prefix_rule` rules, the filesystem of a permission profile, MCP disabled tools, and the sandbox. Codex 0.157.0.
 * Locked-in parts spec, section 8.3 rules 2 to 4 and 8, and decision 1 of section 13: tighten, then refuse.
 *
 * - A neutral `allow` never becomes a Codex `allow` rule: a Codex allow runs a command outside the sandbox without
 *   asking. Nothing is written for it, and the line says so.
 * - A `deny` becomes `forbidden`, an `ask` becomes `prompt`, on the longest literal prefix of the pattern. A prefix
 *   shorter than the pattern blocks more, and the line names it. A pattern with no literal prefix is `absent`.
 * - Read, edit, and write rules go to the filesystem table under `:workspace_roots`. Codex has no ask there, so an ask
 *   blocks. It binds only commands that run in the Codex sandbox.
 * - Codex has no rule target for web, skill, or subagent rules: they are `absent`.
 * - An MCP deny disables the tool, or the whole server, in the server's Codex entry.
 */
import type { GuardrailRule, JsonValue, SandboxRequirement } from '../../harness-definition/src/index.js';
import { codexDecide, codexFilesystemDecide, codexShellArgv, type CodexFilesystemEntry, type CodexPrefixRule } from './codex-shell.js';
import type { Decision } from './decision.js';
import { escapeSentence } from './escapes.js';
import type { NeutralRequest } from './neutral.js';
import { normalizePath } from './paths.js';
import { Collector, NOT_WRITTEN, type EngineDefault, type SandboxForm, type Translation } from './translation.js';

export interface CodexMcpDisable {
  readonly server: string;
  /** The disabled tool. Absent: the whole server is disabled. */
  readonly tool?: string;
}

export interface CodexForm {
  readonly engine: 'codex';
  readonly prefixRules: readonly (CodexPrefixRule & { readonly decision: 'prompt' | 'forbidden' })[];
  /** Entries of `[permissions.<profile>.filesystem.":workspace_roots"]`. */
  readonly filesystem: readonly CodexFilesystemEntry[];
  readonly mcpDisabled: readonly CodexMcpDisable[];
  readonly sandbox?: SandboxForm;
  readonly defaults: EngineDefault;
}

/** Codex's default for a command no rule matches (ruling R8). */
export const CODEX_DEFAULT: EngineDefault = Object.freeze({
  decision: 'default',
  written: false,
  reason: 'Codex applies its approval policy and sandbox to a command that no rule matches: inside the sandbox it can run without asking, and it never leaves the sandbox without a person. Bowerloom writes no policy (section 8.3 rule 12).',
});

/**
 * What live check g8 of step 5 covered of the Codex permission profile (ruling B6), said on every line the profile
 * carries.
 */
const PROFILE_SCOPE = 'Bowerloom writes it into a Codex permission profile that extends :workspace, selected by default_permissions. Live check g8 of step 5 showed on Codex 0.157.0 that this profile loads and that a literal deny entry at the project root blocks a read. Bowerloom does not read user or managed configuration, a profile selected on the command line, or start flags such as --sandbox, and no live check covered them.';

/** A token Codex compares as a literal and a shell passes through unchanged. */
const LITERAL_TOKEN = /^[A-Za-z0-9_./:@%+,=^-]+$/;

/**
 * The longest literal argv prefix of a neutral shell pattern, and whether it covers the same commands. Only a pattern of
 * literal words with one trailing ` *` or `:*` covers the same commands; any other prefix covers more.
 */
export function codexPrefix(pattern: string): { readonly tokens: readonly string[]; readonly same: boolean } | null {
  let body = pattern.trim();
  let tail = false;
  if (body.endsWith(':*')) { body = body.slice(0, -2); tail = true; }
  else if (body.endsWith(' *')) { body = body.slice(0, -2); tail = true; }
  const words = body.trim().split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  // A NAME=value word ends the prefix (ruling R13): Codex would compare it as argv, which a shell never passes.
  for (const w of words) { if (!LITERAL_TOKEN.test(w) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) break; tokens.push(w); }
  if (tokens.length === 0) return null;
  return { tokens, same: tail && tokens.length === words.length };
}

/** The filesystem entries for one neutral path rule, and whether they block more than the rule. */
function filesystemEntries(rule: GuardrailRule): { entries: CodexFilesystemEntry[]; more: string[] } {
  const { body, dirOnly } = normalizePath(rule.pattern);
  const access: CodexFilesystemEntry['access'] = rule.action === 'read' ? 'deny' : 'read';
  const subtree = body.endsWith('/**') ? body.slice(0, -3) : dirOnly ? body : body.includes('*') ? null : body;
  const literal = subtree !== null && !subtree.includes('*') && subtree !== '' ? subtree : null;
  const more: string[] = [];
  const entries: CodexFilesystemEntry[] = [];
  if (literal !== null) entries.push({ path: literal, access });
  else {
    entries.push({ path: body, access: 'deny' }, { path: `${body}/**`, access: 'deny' });
    if (access === 'read') more.push('Codex takes a glob only as deny, so reads are blocked too');
  }
  // Deny and ask match at any depth, as do bare names; Codex needs a deny glob for that. A read-only entry keeps reads at
  // the root open, so its deny globs name copies below the root only: one segment or more in front. Both `*/` and
  // `*/**/` are written, so the copies are covered whether or not Codex lets `**` match no segment.
  if (!body.startsWith('**')) {
    const base = literal ?? body;
    const fronts = access === 'read' && literal !== null ? ['*/', '*/**/'] : ['**/'];
    for (const front of fronts) entries.push({ path: `${front}${base}`, access: 'deny' }, { path: `${front}${base}/**`, access: 'deny' });
    if (access === 'read' && literal !== null) more.push('a copy below the root is matched by a deny glob, so reads of it are blocked too');
  }
  return { entries, more };
}

/** The justification an x-codex block of a rule names, when it is one line of text. Codex shows it to the person. */
export function codexJustification(block: JsonValue | undefined): string | undefined {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return undefined;
  const j = (block as Record<string, JsonValue>).justification;
  // Review item K4: no control character (C0, DEL, C1) and no invisible format, line, or paragraph separator.
  return typeof j === 'string' && j.trim() !== '' && j.length <= 1024 && !/[\0-\x1f\x7f-\x9f\p{Cf}\p{Zl}\p{Zp}]/u.test(j) ? j : undefined;
}

export function translateCodex(rules: readonly GuardrailRule[], sandbox: readonly SandboxRequirement[], out: Collector): Translation<CodexForm> {
  const prefixRules: (CodexPrefixRule & { decision: 'prompt' | 'forbidden' })[] = [];
  const filesystem: CodexFilesystemEntry[] = [];
  const mcpDisabled: CodexMcpDisable[] = [];
  const escapes = escapeSentence('codex');
  const sandboxNote = 'The filesystem table binds only commands that run in the Codex sandbox, so the sandbox must stay on.';
  for (const rule of rules) {
    const p = rule.pattern;
    if (rule.effect === 'allow') {
      const why = rule.action === 'shell'
        ? 'Bowerloom writes no Codex allow rule: a Codex allow runs a command outside the sandbox without asking, which a neutral allow does not mean. The sandbox profile and the approval policy decide instead, so Codex may ask where the source allows.'
        : `Codex grants nothing from a neutral allow: the sandbox profile and the approval policy decide, so Codex may ask or block where the source allows.`;
      out.line(rule, 'translated', `${why} ${NOT_WRITTEN}`);
      continue;
    }
    const tightenAsk = rule.effect === 'ask' ? ' Codex has no ask for this target, so the rule blocks instead of asking.' : '';
    switch (rule.action) {
      case 'shell': {
        const prefix = codexPrefix(p);
        if (prefix === null) { out.line(rule, 'absent', `Codex rules hold literal argv tokens only, and ${p} has no literal prefix. ${escapes}`); break; }
        const decision = rule.effect === 'deny' ? 'forbidden' : 'prompt';
        out.wrote(rule.id, `rules[${prefixRules.length}]`);
        // The step 3 round trip: a justification that a person wrote rides in the rule's x-codex block and comes back.
        const own = codexJustification(rule.privateBlocks.codex);
        prefixRules.push({ pattern: prefix.tokens, decision, justification: own ?? `Bowerloom guardrail ${rule.id}` });
        const shown = prefix.tokens.join(' ');
        const more = prefix.same ? '' : ` The rule covers every command that starts with ${shown}, so it blocks more than ${p}.`;
        // Ruling R14: Codex checks a script with a glob, ~, $, a redirect, quotes around a variable, or a trailing & as
        // one bash -lc command, so common forms of the rule's own program escape it. That is weakened, unless a
        // sandbox that Codex carries bounds what an escaped command can do.
        // Review item W5: a sandbox requirement gives no scope, so it never upgrades the line; the note names it.
        const box = sandbox[0];
        const common = `Codex checks a command with a glob, ~, $, a redirect, quotes around a variable, or a trailing & as one bash -lc command, so common forms of ${shown} escape the rule.`;
        const said = own !== undefined ? ' The justification Codex shows comes from the definition: it is the text of the rule\'s x-codex block.' : '';
        out.line(rule, 'weakened', `Codex carries the rule as a ${decision} prefix rule on ${shown}, matched against argv.${said}${more} ${common}${box ? ` The sandbox ${box.id} may cover it; the live check of step 5 checks it.` : ' No sandbox requirement bounds them.'} ${escapes}`);
        break;
      }
      case 'read': case 'edit': case 'write': {
        const { entries, more } = filesystemEntries(rule);
        for (const e of entries) { out.wrote(rule.id, `filesystem["${e.path}"]`); filesystem.push(e); }
        const extra = more.length ? ` It blocks more: ${more.join('; ')}.` : '';
        // Rulings B6 and R17: live check g8 of step 5 covered one literal deny entry at the project root, for a read and a
        // patch turn. Every path rule also writes a glob entry, and a change rule on a literal path writes a read-only
        // entry. No live check covered either form, so every path rule is weakened and names the forms.
        const forms = [...(entries.some(e => e.access === 'read') ? ['a read-only entry'] : []), ...(entries.some(e => e.path.includes('*')) ? ['a glob entry'] : [])];
        const patch = rule.action === 'read' ? '' : ' Codex edits files through apply_patch, and g8 found the file unchanged after a patch turn.';
        out.line(rule, 'weakened', `Codex carries the rule in the sandbox filesystem table as ${entries.map(e => `${e.path} = ${e.access}`).join(', ')}.${tightenAsk}${extra} ${sandboxNote} ${PROFILE_SCOPE}${patch} No live check covered ${forms.join(' or ') || 'this entry'}, so the rule is weakened. ${escapeSentence('codex', 'path')}`);
        break;
      }
      case 'web': case 'skill': case 'subagent':
        out.line(rule, 'absent', `Codex has no rule target for ${rule.action} rules.`);
        break;
      case 'mcp': {
        if (p === '*') { out.line(rule, 'absent', 'Codex disables MCP tools per server, and a rule for every server names none.'); break; }
        const [server, tool] = p.split('/') as [string, string | undefined];
        const whole = tool === undefined || tool.includes('*');
        out.wrote(rule.id, `mcp_servers.${server}`);
        mcpDisabled.push(whole ? { server } : { server, tool });
        const more = whole && tool !== undefined ? ` Codex lists tools by name, so the whole server is disabled: it blocks more than ${p}.` : '';
        out.line(rule, 'translated', `Codex carries the rule by disabling ${whole ? 'the server' : `the tool ${tool}`} in the Codex entry of ${server}.${tightenAsk}${more}`);
        break;
      }
    }
  }
  // Codex lets a more specific path win, so a read-only entry below a literal deny would reopen reads. Such an entry
  // becomes deny: the deny above it already blocks the path, so nothing extra is blocked.
  const denied = filesystem.filter(e => e.access === 'deny' && !e.path.includes('*')).map(e => e.path);
  const table = filesystem.map(e => e.access === 'read' && denied.some(d => e.path === d || e.path.startsWith(`${d}/`)) ? { ...e, access: 'deny' as const } : e);
  let box: SandboxForm | undefined;
  for (const s of sandbox) {
    box = { files: true, network: true };
    out.wrote(s.id, 'sandbox');
    // Ruling B6: g8 showed that the profile loads. No live check covered the network and write bounds of :workspace.
    const both = s.files && s.network ? 'Codex keeps its sandbox on, with writes limited to the workspace and no network, as the research notes say.' : `Codex sandboxes files and network together, so it also limits ${s.files ? 'the network' : 'files'}: it blocks more than the requirement.`;
    out.line(s, 'weakened', `${both} ${PROFILE_SCOPE} No live check covered the network and write bounds of :workspace, so the line is weakened.`);
  }
  return out.done<CodexForm>({ engine: 'codex', prefixRules, filesystem: table, mcpDisabled, ...(box ? { sandbox: box } : {}), defaults: CODEX_DEFAULT });
}

/** What the translated Codex form decides for a neutral request. */
export function codexFormDecide(form: CodexForm, request: NeutralRequest): Decision {
  const decision = codexRulesDecide(form, request);
  return decision === 'default' ? form.defaults.decision : decision;
}

function codexRulesDecide(form: CodexForm, request: NeutralRequest): Decision {
  switch (request.action) {
    case 'shell': return codexDecide(form.prefixRules, codexShellArgv(request.command));
    case 'read': return codexFilesystemDecide(form.filesystem, 'read', request.path);
    case 'edit': case 'write': return codexFilesystemDecide(form.filesystem, 'write', request.path);
    case 'mcp': return form.mcpDisabled.some(d => d.server === request.server && (d.tool === undefined || d.tool === request.tool)) ? 'deny' : 'default';
    default: return 'default';
  }
}
