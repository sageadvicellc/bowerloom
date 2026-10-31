/**
 * The adopt and install sheets of the sample launch (--prototype-v3): three made-up folders, and the same calls as the real bridge, answered in memory.
 * Nothing is read and nothing is written. The plans are shaped like the packages' own (tests/engine-sample.test.ts holds the shapes to a plan the packages
 * make from a synthetic folder), and the words of the refusals are the packages' words.
 *  - `inbox-tools` is set up the old way: adoption finds a conflict, three approvals, two acknowledgements and one entry it lists only.
 *  - `weekly-report` holds a definition for Claude Code, Codex and OpenCode, and its own CLAUDE.md: the plan asks for two approvals, then shows every
 *    result word, the partial notice, pending trust, the code and commands to read, and the drift report with Accept AGENTS.md as the default. Merge
 *    moves its CLAUDE.md into the harness once; the install that follows accepts AGENTS.md.
 *  - `garden` holds an install that stopped part way: only a recovery plan can run.
 * Each folder that holds a harness can also save its own harness (option C): agents, skills and interfaces, edited by id, with save points and "Go back".
 * A skill is copied from the harness of another sample folder. Save points keep a made-up time, one minute apart.
 * Notes (spec 6.9): two made-up notes folders answer main's notes chooser. `Garden notes` holds pages and no history yet, so the history offer shows;
 * `Notes` is empty, so "Start fresh" shows the starter files of the notes keeper kit. The ready-made notes keeper is added from the same made-up copy of
 * the kit's agent and skills (tests/engine-sample.test.ts holds it to the kit main ships), and notes attach to an agent through the save.
 */
import type {
  AdoptChoices, AdoptRecovered, AdoptRecoveryView, AdoptView, AdoptWritten, Answer, ApproveLineView, ChangeView, DefinitionView, EngineBridge, EngineId, EveryEnginePart, FolderInfo, LossView,
  MergeView, MergeWritten, NotesHistoryPlanView, NotesStarterView, NotesView, NotesWritten, ProjectAnswer, ProjectInput, ProjectView, ProjectWritten, Recovered, RecoveryChoices, RecoveryView,
  Refusal, RemovalView, Removed, RestoreView, SaveChangeView, SaveEdit, SaveView, SaveWritten, SetAsideView, SetAsideWritten, VersionView,
} from './types.js';
import { ENGINE_NAMES, EVERY_ENGINE_PARTS, KIT_MAIN_WORDS, NOTES_PURPOSES, SAVE_MAIN_WORDS, writesFile } from './types.js';
import { approveKey, lossByEngine, unmappedHashBody } from './view.js';

/** The packages' own words for the refusals the sample can give (packages/adoption/src/refusal.ts, packages/project-sync/src/portable-files.ts). */
export const SAMPLE_MESSAGES = Object.freeze({
  ADOPTION_STALE_APPROVAL: 'The plan changed after it was approved. Nothing was written. Plan again to see the new plan.',
  ADOPTION_APPROVAL_REQUIRED: 'Items need a person\'s approval, and the approvals given do not confirm every one. Nothing was written.',
  ADOPTION_CHOICE_REQUIRED: 'Items with the same name differ. A person picks one or keeps both under distinct names before adoption writes. Nothing was changed.',
  ADOPTION_ACKNOWLEDGEMENT_REQUIRED: 'Unmapped entries could hold a deny, an ask, or a sandbox value. A person acknowledges each by id before adoption writes. Nothing was written.',
  ADOPTION_DEFINED: 'The .bowerloom folder already holds harness.json, so it is a 0.8 definition. Adoption writes a new definition only. Nothing was changed.',
  ADOPTION_RECOVER_NOTHING: 'No adoption of this project is unfinished, so there is nothing to recover.',
  ADOPTION_MERGE_NOTHING: 'There is nothing to merge: the project has no CLAUDE.md, its CLAUDE.md is empty or already follows AGENTS.md, or the definition\'s instructions already hold its text. Nothing was changed.',
  PORTABLE_DEFINITION_INVALID: 'The harness definition cannot be loaded, so nothing was projected.',
  PORTABLE_MERGE_NOT_BUILT: 'Merge moves the CLAUDE.md text into the definition, and this projection does not edit the definition. Choose Accept AGENTS.md or Keep both. Nothing was projected.',
  PORTABLE_DRIFT: 'A file Bowerloom projected, or a file it was about to replace, changed since the plan. Nothing more was changed.',
  PORTABLE_RECOVERY_REQUIRED: 'An earlier projection or removal stopped part way. Nothing was changed. Recover it first.',
  PORTABLE_NOTHING_PROJECTED: 'This project has no projection receipt, so there is nothing to remove.',
  PORTABLE_RECOVER_NOTHING: 'No projection or removal of this project is unfinished, and no path to keep was named.',
  SAVE_STALE: 'The definition changed after the save was planned, or the approval is for another plan. Nothing more was written. Plan again to see the new plan.',
  VERSION_UNKNOWN: 'The store holds no such version for this folder. Nothing was changed.',
  VERSION_STALE: 'The version store changed after the plan to set it aside. Nothing was moved. Plan again.',
  VERSION_NOTHING: 'There is no version store to set aside. Nothing was changed.',
  SAVE_NO_DEFINITION: SAVE_MAIN_WORDS.SAVE_NO_DEFINITION,
  SAVE_SOURCE_MISSING: SAVE_MAIN_WORDS.SAVE_SOURCE_MISSING,
  KIT_ALREADY_ADDED: KIT_MAIN_WORDS.KIT_ALREADY_ADDED,
  NOTES_NOT_EMPTY: 'The folder for the starter wiki is not empty. A starter wiki goes only into a new or empty folder. Nothing was written.',
  NOTES_STALE: 'The folder changed after the preview, or the approval is for another preview. Nothing was changed. Preview again.',
  NOTES_ALREADY_REPOSITORY: 'The folder already has version history (.git). Nothing was changed.',
  NOTES_NOTHING_TO_COMMIT: 'The folder holds no file for the first commit. Nothing was changed.',
} as const);
type SampleCode = keyof typeof SAMPLE_MESSAGES;
const refuse = (code: SampleCode, paths: readonly string[] = []): { ok: false; refusal: Refusal } => ({ ok: false, refusal: { code, message: SAMPLE_MESSAGES[code], paths } });
const ok = <T>(value: T): Answer<T> => ({ ok: true, value });

/** A made-up revision: 64 hex characters from any text, the same text always giving the same revision. */
export function sampleRevision(text: string): string {
  let out = '', h = 0x811c9dc5;
  for (let round = 0; out.length < 64; round += 1) {
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i) + round; h = Math.imul(h, 0x01000193) >>> 0; }
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
}

export const SAMPLE_FOLDERS = Object.freeze({ adopt: 'sample-inbox-tools', defined: 'sample-weekly-report', stopped: 'sample-garden' });
/** The made-up notes folders: `use` holds pages and no history; `start` is empty, for "Start fresh". */
export const SAMPLE_NOTES = Object.freeze({ use: 'sample-notes', start: 'sample-new-notes' });

/**
 * The notes keeper kit as the sample shows it: the pinned version, the agent, and the skills with the names and one-line descriptions of the kit main ships
 * (kits/wiki-keeper). tests/engine-sample.test.ts holds every field here to the kit itself.
 */
export const SAMPLE_KIT = Object.freeze({
  id: 'wiki-keeper' as const, version: '0.1.0',
  agent: Object.freeze({ id: 'notes-keeper', description: 'Looks after a folder of notes. Adds sources, files pages, answers questions from the notes with citations, checks the notes for problems, and writes a tidy-up report.', skills: Object.freeze(['add-source', 'file-page', 'answer-from-notes', 'check-notes', 'log-change', 'refine-report']) }),
  skills: Object.freeze([
    { id: 'add-source', description: 'Saves a new source into the wiki and turns it into notes. Use when the person hands over a file, a note, a transcript, or pasted text to keep. It keeps the original untouched, writes a summary page, updates related pages, and makes one commit.' },
    { id: 'answer-from-notes', description: 'Answers a question from the pages in the wiki and cites each page it used. Use when the person asks what their notes say about a subject. It changes nothing, says plainly when the notes hold no answer, and never fills a gap from memory.' },
    { id: 'check-notes', description: 'Checks the wiki for problems and reports them without fixing anything. Use when the person asks if their notes are in good shape. It finds broken links, pages with no links, missing page fields, sources that do not exist, and pages missing from the index.' },
    { id: 'file-page', description: 'Writes a new page, or updates an existing one, from what the wiki already holds or from what the person says. Use when the person wants a subject written down in the notes. It avoids duplicates, cites its sources, links the page both ways, and makes one commit.' },
    { id: 'log-change', description: 'Brings the log up to date with changes already made to the wiki, by hand or by another tool. Use when the person edited the notes themselves and wants the log to catch up. It reads the commit history, adds log lines, and makes one commit.' },
    { id: 'refine-report', description: 'Studies the whole wiki and writes one tidy-up report that suggests topics to merge, pages to split or shorten, stale pages, and missing links. Use when the person asks for a tidy-up or refinement report. It writes only the report, commits only the report, and changes no other page.' },
  ]),
  /** The starter template, each file with its size in bytes. */
  starter: Object.freeze([
    { path: 'AGENTS.md', bytes: 2809 }, { path: 'index.md', bytes: 302 }, { path: 'log.md', bytes: 203 },
    { path: 'pages/README.md', bytes: 431 }, { path: 'reports/README.md', bytes: 402 }, { path: 'sources/README.md', bytes: 433 },
  ]),
});
/** The pages of the made-up `Garden notes`, for its history plan. One hidden folder stays out of the first commit. */
const SAMPLE_NOTE_FILES: readonly string[] = Object.freeze([
  'beds/east-bed.md', 'beds/herb-spiral.md', 'beds/north-bed.md', 'compost.md', 'frost-dates.md', 'index.md', 'log.md', 'pests/aphids.md', 'pests/slugs.md',
  'plans/2026-spring.md', 'plans/2026-winter.md', 'seed-list.md', 'tools.md', 'watering.md',
]);

const PLUGIN = `// Bowerloom generated this OpenCode plugin from the hooks of a harness definition. Read it before you approve the plan:
// OpenCode loads every file in .opencode/plugins and runs it with your permissions. Removal restores what was here before.
// Each hook runs its command with /bin/sh through the $ shell of the plugin context, with the hook input as JSON on
// standard input. Exit 2, or a deny decision on standard output, blocks the tool call: the plugin throws with the
// reason. Any other exit lets the call continue.

const HOOKS = [
  {
    "entry": "check-shell",
    "event": "PreToolUse",
    "tools": { "bash": "Bash" },
    "command": "./scripts/check-shell.sh",
    "timeoutMs": 600000
  }
];

async function run($, hook, input, directory) {
  const shell = $\`/bin/sh -c \${hook.command} < \${new Response(input)}\`.env({ ...process.env, BOWERLOOM_PROJECT_DIR: directory }).quiet().nothrow();
  const result = await shell;
  return { status: result.exitCode, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

export const BowerloomHooks = async ({ directory, $ }) => {
  return {
    "tool.execute.before": async (input, output) => {
      for (const hook of HOOKS) {
        const result = await run($, hook, JSON.stringify({ tool_name: input?.tool, tool_input: output?.args ?? {} }), directory);
        if (result.status === 2) throw new Error(result.stderr.trim() || "A Bowerloom hook blocked this action.");
      }
    },
  };
};
`;
const RULES = `# Bowerloom writes this file from the guardrails of a harness definition. Removal restores what was here before.
# A neutral allow never becomes a Codex allow rule: Codex would run the command outside the sandbox without asking.

prefix_rule(
    pattern = ["git", "push", "--force"],
    decision = "forbidden",
    justification = "Bowerloom guardrail no-force-push",
)
`;

const place = (path: string, pointer: string | null, engines: EngineId[], shape: string, shapeVersion: string | null = '2.1.310') => ({ path, pointer, engines, shape, shapeVersion });

function adoptFixture(): AdoptView {
  const hook = place('.claude/settings.json', '/hooks/PreToolUse/0/hooks/0', ['claude-code'], 'Claude Code settings.json');
  const server = place('.mcp.json', '/mcpServers/mail', ['claude-code'], 'Claude Code .mcp.json');
  const codexServer = place('.codex/config.toml', '/mcp_servers/mail', ['codex'], 'Codex config.toml', '0.157.0');
  const search = place('.mcp.json', '/mcpServers/search', ['claude-code'], 'Claude Code .mcp.json');
  return {
    folder: '~/Projects/inbox-tools',
    harness: { id: 'inbox-tools', description: 'Adopted from the engine files of this project.' },
    engines: [{ id: 'claude-code', version: null, model: null, detected: true }, { id: 'codex', version: null, model: 'gpt-5', detected: true }],
    read: 9,
    items: [
      { key: 'guardrails/deny-shell-4be1c2aa', part: 'guardrails', id: 'deny-shell-4be1c2aa', places: [place('.claude/settings.json', '/permissions/deny/0', ['claude-code'], 'Claude Code settings.json')], engines: ['claude-code'], needsApproval: [], notes: [] },
      { key: 'hooks/pre-tool-use-9c03e1f2', part: 'hooks', id: 'pre-tool-use-9c03e1f2', places: [hook], engines: ['claude-code'], needsApproval: ['A hook runs a command. A person reads the command before Bowerloom writes it into an engine.'], notes: ['The event can block an action, so the hook is enforced.'] },
      { key: 'mcp/mail', part: 'mcp', id: 'mail', places: [server, codexServer], engines: null, needsApproval: ['An MCP server that uses stdio runs a command. A person reads the command before Bowerloom writes it into an engine.'], notes: ['The copies differ in bytes: .mcp.json and .codex/config.toml. They mean the same server.'] },
      { key: 'mcp/search', part: 'mcp', id: 'search', places: [search], engines: ['claude-code'], needsApproval: ['The server uses ${SEARCH_KEY}. Your own value of SEARCH_KEY will be sent to this server.'], notes: [] },
      { key: 'skills/sort-mail', part: 'skills', id: 'sort-mail', places: [place('.agents/skills/sort-mail', null, ['codex'], 'skill folder', null), place('.claude/skills/sort-mail', null, ['claude-code'], 'Claude Code skill folder')], engines: null, needsApproval: [], notes: [] },
      { key: 'subagents/triage', part: 'subagents', id: 'triage', places: [place('.claude/agents/triage.md', null, ['claude-code'], 'Claude Code subagent')], engines: ['claude-code'], needsApproval: [], notes: [] },
    ],
    conflicts: [{
      key: 'system-prompt/AGENTS.md', part: 'system-prompt', id: 'AGENTS.md',
      variants: [{ key: 'AGENTS.md', places: [place('AGENTS.md', null, ['codex'], 'AGENTS.md', null)] }, { key: 'CLAUDE.md', places: [place('CLAUDE.md', null, ['claude-code'], 'CLAUDE.md')] }],
      picked: null,
    }],
    differences: [{ action: 'shell', pattern: 'git push *', rules: [{ id: 'ask-shell-17a2d0c4', effect: 'ask', engines: ['claude-code'] }, { id: 'deny-shell-60f3e9b1', effect: 'deny', engines: ['codex'] }] }],
    everyEngine: [],
    unmapped: ([
      { id: '.claude/settings.json#/permissions/defaultMode', path: '.claude/settings.json', pointer: '/permissions/defaultMode', part: 'guardrails', reason: 'Permission modes do not translate between engines (locked-in parts spec, section 8.3 rule 12). Bowerloom writes the engine default.', gate: 'acknowledge', acknowledged: false },
      { id: '.codex/config.toml#/approval_policy', path: '.codex/config.toml', pointer: '/approval_policy', part: 'guardrails', reason: 'An approval policy is an engine mode with no neutral form. It can make Codex ask less, so a person acknowledges that it is not carried.', gate: 'acknowledge', acknowledged: false },
      { id: '.claude/skills/sort-mail/SKILL.md#/allowed-tools', path: '.claude/skills/sort-mail/SKILL.md', pointer: '/allowed-tools', part: 'skills', reason: 'A grant scoped to the skill has no neutral form. Without it the engine asks more often.', gate: 'none', acknowledged: false },
    ] as const).map(u => ({ ...u, hash: sampleRevision(JSON.stringify(unmappedHashBody(u))) })),
    secrets: [{ path: '.mcp.json', pointer: '/mcpServers/search/env/SEARCH_KEY', reference: '${SEARCH_KEY}', key: 'mcp/search' }],
    managed: [{ catalog: '.bowerloom/managed/catalog/tidy-notes.json', id: 'tidy-notes', skill: 'tidy-notes', reason: 'A 0.7 managed copy from npm. Its source is recorded as claimed: Bowerloom did not check it.' }],
    warnings: [],
    files: [
      { path: 'guardrails.json', bytes: 512 }, { path: 'harness.json', bytes: 702 }, { path: 'hooks.json', bytes: 241 }, { path: 'instructions/AGENTS.md', bytes: 1880 },
      { path: 'mcp.json', bytes: 466 }, { path: 'skills/sort-mail/SKILL.md', bytes: 930 }, { path: 'subagents/triage.md', bytes: 611 },
    ],
    approvals: [],
    problems: [],
    ready: false,
    revision: '',
  };
}

/** The exact text each sample approval covers, as the planned definition files would hold it (U7). */
const SAMPLE_TEXT: Readonly<Record<string, readonly { path: string; text: string }[]>> = Object.freeze({
  'hooks/pre-tool-use-9c03e1f2': [{ path: '.bowerloom/hooks.json', text: JSON.stringify({ id: 'pre-tool-use-9c03e1f2', event: 'PreToolUse', matcher: 'Bash', command: '${PROJECT_DIR}/scripts/check-shell.sh', strength: 'enforced', engines: ['claude-code'] }, null, 2) }],
  'mcp/mail': [{ path: '.bowerloom/mcp.json', text: JSON.stringify({ name: 'mail', transport: 'stdio', command: 'npx', args: ['-y', 'mail-server@1.4.2', '--inbox', 'work'] }, null, 2) }],
  'mcp/search': [{ path: '.bowerloom/mcp.json', text: JSON.stringify({ name: 'search', transport: 'http', url: 'https://search.example/mcp', env: { SEARCH_KEY: '${SEARCH_KEY}' }, engines: ['claude-code'] }, null, 2) }],
});

function withApprovals(v: AdoptView): AdoptView {
  return {
    ...v,
    approvals: v.items.filter(i => i.needsApproval.length > 0).map(i => {
      // An item used for every engine has no engine filter in its file text (D8B), so its text, and the hash a tick names, change with it.
      const text = (SAMPLE_TEXT[i.key] ?? []).map(t => (i.engines !== null ? t : { ...t, text: JSON.stringify({ ...JSON.parse(t.text) as Record<string, unknown>, engines: undefined }, null, 2) }));
      const body = { key: i.key, part: i.part, id: i.id, reasons: i.needsApproval, places: i.places, secrets: v.secrets.filter(s => s.key === i.key), text };
      return { ...body, hash: sampleRevision(JSON.stringify(body)), blocked: null };
    }),
  };
}
/**
 * "Use for every engine" on the sample plan, as the package does it (D8B): each ticked part's items lose their engine filter, except a rule of a
 * difference, which keeps its engines and is listed with the package's reason. Every part is counted, ticked or not.
 */
function withEveryEngine(v: AdoptView, chosen: readonly EveryEnginePart[]): AdoptView {
  const differing = v.differences.flatMap(d => d.rules.map(r => r.id));
  const reason = 'Not widened: its effect differs between engines, so each engine keeps its own rule.';
  const everyEngine = EVERY_ENGINE_PARTS.map(part => ({
    part, chosen: chosen.includes(part),
    widens: v.items.filter(i => i.part === part && i.engines !== null && !differing.includes(i.id)).length,
    notWidened: part === 'guardrails' ? differing.map(id => ({ id, reason })) : [],
  }));
  const items = v.items.map(i => (chosen.includes(i.part as EveryEnginePart) && i.engines !== null && !differing.includes(i.id)
    ? { ...i, engines: null, notes: [...i.notes, `Used for every engine, as a person chose for ${i.part}. Before, only ${i.engines.join(', ')} read it.`] } : i));
  return { ...v, items, everyEngine };
}

/** The entry of each sample line to approve, as the harness holds it (W7). */
const SAMPLE_ENTRY: Readonly<Record<string, string>> = Object.freeze({
  'guardrails/no-force-push': JSON.stringify({ id: 'no-force-push', action: 'shell', pattern: 'git push --force *', effect: 'deny', strength: 'enforced' }, null, 2),
  'hooks/check-shell': JSON.stringify({ id: 'check-shell', event: 'PreToolUse', matcher: 'Bash', command: '${PROJECT_DIR}/scripts/check-shell.sh', strength: 'enforced' }, null, 2),
});
/** A sample line's key: the line and a made-up hash of its entry, as main makes it (U15). */
const sampleKey = (l: LossView): string => approveKey(l, `sha256:${sampleRevision(`${l.part}/${l.entry}`)}`);

const line = (engine: EngineId, part: string, entry: string, result: LossView['result'], reason: string, field: string | null = null): LossView => ({ engine, part, entry, field, result, reason });

function lossFixture(reconcile: ProjectInput['reconcile']): LossView[] {
  const claude = reconcile === 'keep-both'
    ? line('claude-code', 'system-prompt', 'AGENTS.md', 'weakened', 'CLAUDE.md does not follow AGENTS.md, so Claude Code does not load AGENTS.md. Keep both leaves the drift reported.')
    : line('claude-code', 'system-prompt', 'AGENTS.md', 'exact', 'CLAUDE.md becomes the single line @AGENTS.md, so Claude Code loads AGENTS.md.');
  return [
    claude,
    line('claude-code', 'skills', 'draft-outline', 'exact', 'The engine reads .claude/skills.'),
    line('claude-code', 'guardrails', 'no-force-push', 'translated', 'Claude Code carries the rule as Bash(git push --force *) (documented by vector CC02, CC03, CC08, CC13, and CC17). Known escapes: an absolute program path such as /usr/bin/git escapes the rule; quoting a word after the program, as in git \'push\', escapes the rule.'),
    line('claude-code', 'hooks', 'check-shell', 'exact', 'Claude Code runs the command on PreToolUse from .claude/settings.json; ${PROJECT_DIR} becomes ${CLAUDE_PROJECT_DIR}.'),
    line('claude-code', 'mcp', 'files', 'exact', 'Claude Code reads the server in .mcp.json with the same fields. Pending trust: Claude Code asks the person to approve a project server in .mcp.json before it runs.'),
    line('codex', 'system-prompt', 'AGENTS.md', 'exact', 'The engine reads AGENTS.md as written.'),
    line('codex', 'skills', 'draft-outline', 'exact', 'The engine reads .agents/skills.'),
    line('codex', 'guardrails', 'no-force-push', 'weakened', 'Codex carries the rule as a forbidden prefix rule on git push --force, matched against argv. Codex checks a command with a glob, ~, $, a redirect, or a trailing & as one bash -lc command, so common forms of git push --force escape the rule.'),
    line('codex', 'hooks', 'check-shell', 'weakened', 'Codex runs the command on PreToolUse from .codex/hooks.json. Pending trust: Codex runs it only after a person trusts the project .codex folder and reviews the hook by its hash. A hook that fails lets the call continue.'),
    line('codex', 'mcp', 'files', 'absent', 'Codex documents no expansion in env: it passes a variable by its own name only, through env_vars. The value of ROOT names another variable, so the server is not written.'),
    line('opencode', 'system-prompt', 'AGENTS.md', 'exact', 'The engine reads AGENTS.md as written.'),
    line('opencode', 'skills', 'draft-outline', 'exact', 'The engine reads .claude/skills and .agents/skills.'),
    line('opencode', 'skills', 'draft-outline', 'absent', 'Not projected in this step: scripts, engine-private files, and the private blocks of skills stay in the definition.', 'x-opencode'),
    line('opencode', 'guardrails', 'no-force-push', 'translated', 'OpenCode carries the rule under bash as git*push*--force*. Each space is written as *, so it blocks more than git push --force.'),
    line('opencode', 'hooks', 'check-shell', 'weakened', 'OpenCode runs the command from the generated plugin .opencode/plugins/bowerloom-hooks.js on tool.execute.before. The plugin fails open, so the hook cannot fail closed.'),
    line('opencode', 'mcp', 'files', 'translated', 'OpenCode carries the server under mcp in opencode.json as a local server whose command is one array; a ${NAME} reference becomes {env:NAME}.'),
  ];
}

const APPROVE: readonly LossView[] = Object.freeze([
  line('codex', 'guardrails', 'no-force-push', 'weakened', 'Codex carries the rule as a forbidden prefix rule on git push --force, matched against argv. Common forms of git push --force escape the rule.'),
  line('codex', 'hooks', 'check-shell', 'weakened', 'Codex calls tool hooks a useful guardrail and not a complete boundary: a hook that fails lets the call continue, so the hook cannot fail closed.'),
  line('opencode', 'hooks', 'check-shell', 'weakened', 'The OpenCode plugin fails open: a hook that fails or runs past its timeout lets the call continue.'),
]);

function projectFixture(input: ProjectInput, projected: boolean, written: string | null): ProjectView {
  const engines = input.engines;
  const loss = lossFixture(input.reconcile).filter(l => engines.includes(l.engine));
  const all: ChangeView[] = [
    { path: '.agents/skills/draft-outline/SKILL.md', action: 'create', engines: ['codex', 'opencode'] },
    { path: '.claude/settings.json', action: 'create', engines: ['claude-code'] },
    { path: '.claude/skills/draft-outline/SKILL.md', action: 'create', engines: ['claude-code', 'opencode'] },
    { path: '.codex/hooks.json', action: 'create', engines: ['codex'] },
    { path: '.codex/rules/bowerloom.rules', action: 'create', engines: ['codex'] },
    { path: '.mcp.json', action: 'create', engines: ['claude-code'] },
    { path: '.opencode/plugins/bowerloom-hooks.js', action: 'create', engines: ['opencode'] },
    { path: 'AGENTS.md', action: 'create', engines: ['claude-code', 'codex', 'opencode'] },
    ...(input.reconcile === 'accept-agents' ? [{ path: 'CLAUDE.md', action: 'replace' as const, engines: ['claude-code', 'codex', 'opencode'] as EngineId[] }] : []),
    { path: 'opencode.json', action: 'create', engines: ['opencode'] },
  ];
  const revision = sampleRevision(`project ${JSON.stringify(input)} ${projected}`);
  const noop = projected && written === JSON.stringify({ ...input, approve: [...input.approve].sort() });
  const changes = all.map(c => ({ ...c, engines: c.engines.filter(e => engines.includes(e)) })).filter(c => c.engines.length > 0).map(c => (noop ? { ...c, action: 'unchanged' as const } : projected ? { ...c, action: 'update' as const } : c));
  return {
    folder: '~/Projects/weekly-report',
    harness: 'weekly-report',
    engines: lossByEngine(loss, ([['claude-code', null], ['codex', '0.157.0'], ['opencode', '1.18.30']] as const).filter(([id]) => engines.includes(id)).map(([id, version]) => ({ id, version }))),
    partial: loss.some(l => l.result === 'absent'),
    notice: loss.some(l => l.result === 'absent') ? 'This projection is partial: some parts are absent in some engines. Every line marked absent says why.' : null,
    trust: [
      { engine: 'codex' as const, path: '.codex/hooks.json', entry: 'check-shell', state: 'pending trust' as const, reason: 'Codex runs a project hook only after a person trusts the .codex folder and reviews the hook by its hash. A changed hook needs a new review.' },
      { engine: 'codex' as const, path: '.codex/rules/bowerloom.rules', entry: null, state: 'pending trust' as const, reason: 'Codex reads the project .codex folder only after a person trusts the project.' },
      { engine: 'claude-code' as const, path: '.mcp.json', entry: null, state: 'pending trust' as const, reason: 'Claude Code asks the person to approve each project server in .mcp.json before it runs.' },
    ].filter(t => engines.includes(t.engine)),
    review: [
      { path: '.claude/settings.json', engine: 'claude-code' as const, kind: 'command' as const, part: 'hooks', entry: 'check-shell', text: '"${CLAUDE_PROJECT_DIR}"/scripts/check-shell.sh', env: [] },
      { path: '.codex/hooks.json', engine: 'codex' as const, kind: 'command' as const, part: 'hooks', entry: 'check-shell', text: '"$(git rev-parse --show-toplevel)"/scripts/check-shell.sh', env: [] },
      { path: '.codex/rules/bowerloom.rules', engine: 'codex' as const, kind: 'code' as const, part: null, entry: null, text: RULES, env: [] },
      { path: '.mcp.json', engine: 'claude-code' as const, kind: 'command' as const, part: 'mcp', entry: 'files', text: '["npx","-y","files-server@2.1.0"]', env: [{ name: 'ROOT', value: null }, { name: 'LOG_LEVEL', value: 'warn' }, { name: 'FILES_SERVER_CACHE_DIRECTORY_FOR_THE_WEEKLY_REPORT_PROJECT_AND_ITS_DRAFTS', value: '/tmp/files-server-cache/weekly-report/drafts/and/a/long/path/that/keeps/going' }] },
      { path: '.opencode/plugins/bowerloom-hooks.js', engine: 'opencode' as const, kind: 'code' as const, part: null, entry: null, text: PLUGIN, env: [] },
      { path: 'opencode.json', engine: 'opencode' as const, kind: 'command' as const, part: 'mcp', entry: 'files', text: '["npx","-y","files-server@2.1.0"]', env: [{ name: 'ROOT', value: null }, { name: 'LOG_LEVEL', value: 'warn' }] },
    ].filter(r => engines.includes(r.engine)),
    drift: projected ? null : {
      agents: 'planned', actions: ['accept-agents', 'merge', 'keep-both'], defaultAction: 'accept-agents',
      engines: ([
        { engine: 'claude-code', hidden: 'AGENTS.md', rule: 'Claude Code reads CLAUDE.md. It reads AGENTS.md only when no CLAUDE.md or CLAUDE.local.md exists.' },
        { engine: 'codex', hidden: 'CLAUDE.md', rule: 'Codex reads AGENTS.md and does not read CLAUDE.md.' },
        { engine: 'opencode', hidden: 'CLAUDE.md', rule: 'OpenCode reads AGENTS.md. Version 1.x reads CLAUDE.md only when no AGENTS.md exists.' },
      ] as const).filter(e => engines.includes(e.engine)),
    },
    reconcile: projected ? null : input.reconcile,
    driftLines: [],
    approved: APPROVE.filter(l => engines.includes(l.engine)).map(l => ({ part: l.part, entry: l.entry, field: l.field, engine: l.engine, result: 'weakened' as const, who: 'you', when: '2026-10-28T09:00:00Z', reason: `Approved in the Bowerloom app after reading this line: ${l.reason}`, earlier: false })),
    changes,
    offers: [],
    ignored: [],
    pendingTrust: [],
    filterLeaks: [],
    takenOver: [],
    skippedPreview: [], keptPreview: [], previewNotice: null,
    noop,
    revision,
  };
}

/** The fixtures as plain data, for the tests and for the sample bridge. */
export function sampleEngineFixtures(): { adopt: AdoptView; approveLines: ApproveLineView[]; project(input: ProjectInput): ProjectView } {
  return {
    adopt: withApprovals(withEveryEngine(adoptFixture(), [])),
    approveLines: APPROVE.map(l => ({ ...l, key: sampleKey(l), approvable: true, text: SAMPLE_ENTRY[`${l.part}/${l.entry}`] ?? '' })),
    project: input => projectFixture(input, false, null),
  };
}

interface SampleFolder {
  info: FolderInfo; adopted: boolean; projected: boolean; written: string | null; stopped: boolean; merged: boolean;
  /** The folder's own harness as the editor draws it, or null when it has none. Save points, oldest first. */
  def: DefinitionView | null; versions: { entry: Omit<VersionView, 'current'>; def: DefinitionView }[]; counter: number;
}

// ---- the save step of the sample: each folder's own harness, in memory -----------------------------------------------------------

const skillOf = (id: string, description: string): DefinitionView['skills'][number] => ({ id, name: id, description });
const agentOf = (id: string, description: string, skills: readonly string[]): DefinitionView['agents'][number] => ({ id, name: id, description, skills, notes: [] });
/** The made-up harness of each sample folder that holds one. `inbox-tools` gets its own after the sample adoption. */
const SAMPLE_DEFS: Readonly<Record<string, DefinitionView>> = Object.freeze({
  [SAMPLE_FOLDERS.defined]: {
    id: 'weekly-report', description: 'Drafts the weekly report.', engines: ['claude-code', 'codex', 'opencode'], instructions: true,
    skills: [skillOf('check-facts', 'Checks each figure in a draft.'), skillOf('draft-outline', 'Outlines the report.')],
    agents: [agentOf('editor', 'Edits the draft.', []), agentOf('writer', 'Writes the draft.', ['draft-outline'])], sources: [], kits: [],
  },
  [SAMPLE_FOLDERS.stopped]: {
    id: 'garden', description: 'Keeps the garden notes.', engines: ['claude-code', 'codex'], instructions: true,
    skills: [skillOf('water-plants', 'Plans the watering.')], agents: [agentOf('gardener', 'Looks after the beds.', ['water-plants'])], sources: [], kits: [],
  },
  [SAMPLE_FOLDERS.adopt]: {
    id: 'inbox-tools', description: 'Adopted from the engine files of this project.', engines: ['claude-code', 'codex'], instructions: true,
    skills: [skillOf('sort-mail', 'Sorts the inbox.')], agents: [agentOf('triage', 'Triages new mail.', [])], sources: [], kits: [],
  },
});
/** The files of a sample harness, each as a text that stands for its bytes, so a change list compares two harnesses as the save plan compares two file sets. */
function sampleFiles(d: DefinitionView): Map<string, string> {
  // harness.json lists sources.json while a kit's record is in it, as the real one lists the plugins part.
  const out = new Map<string, string>([['harness.json', JSON.stringify({ id: d.id, engines: d.engines, ...(d.kits.length ? { plugins: 'sources.json' } : {}) })]]);
  for (const k of d.skills) out.set(`skills/${k.id}/SKILL.md`, JSON.stringify(k));
  for (const a of d.agents) out.set(`agents/${a.id}.md`, JSON.stringify(a));
  if (d.sources.length) out.set('knowledge.json', JSON.stringify(d.sources.map(x => [x.name, x.label])));
  if (d.kits.length) out.set('sources.json', JSON.stringify(d.kits));
  return out;
}
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The change list as the save plan orders it: creates and updates, then deletes, then harness.json, each group in path order. */
function sampleChanges(from: DefinitionView, to: DefinitionView): SaveChangeView[] {
  const a = sampleFiles(from), b = sampleFiles(to), writes: SaveChangeView[] = [], deletes: SaveChangeView[] = [];
  let harness: SaveChangeView | null = null;
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort(byText)) {
    const was = a.get(path), now = b.get(path);
    if (was === now) continue;
    const change: SaveChangeView = { path: `.bowerloom/${path}`, action: was === undefined ? 'create' : now === undefined ? 'delete' : 'update' };
    if (path === 'harness.json') harness = change; else if (change.action === 'delete') deletes.push(change); else writes.push(change);
  }
  return [...writes, ...deletes, ...(harness === null ? [] : [harness])];
}
const sameDef = (a: DefinitionView, b: DefinitionView): boolean => JSON.stringify([...sampleFiles(a)]) === JSON.stringify([...sampleFiles(b)]);
/** The words of the definition package for an id the folder does not hold (packages/harness-definition, `editDefinition`). */
const editRefusal = (what: string, id: string, tail = ''): { ok: false; refusal: Refusal } => ({ ok: false, refusal: { code: 'EDIT_UNKNOWN_ID', message: `The folder holds no ${what} "${id}"${tail}.`, paths: [] } });
const duplicate = (what: string, id: string): { ok: false; refusal: Refusal } => ({ ok: false, refusal: { code: 'EDIT_DUPLICATE_ID', message: `The folder already holds ${what} "${id}".`, paths: [] } });

/** A made-up notes folder, as the Notes panel reads it. */
interface SampleNotes { view: NotesView; files: readonly string[]; hidden: number }

/** The CLAUDE.md of the sample folder that differs from its AGENTS.md. */
export const SAMPLE_CLAUDE = '# Weekly report\n\nDraft the report on Friday. Keep each section under 200 words.\n';
/** The keep list of earlier steps, or the full recovery choices, as one shape. */
const choicesOf = (c: readonly string[] | RecoveryChoices): RecoveryChoices => (Array.isArray(c) ? { keep: [...c as readonly string[]], restoreMode: [], recordMode: [] } : c as RecoveryChoices);

/** The sample bridge: the same calls as the real one, on three made-up folders in memory. Nothing is read or written. */
export function createSampleEngine({ previewEngines = false }: { previewEngines?: boolean } = {}): EngineBridge {
  const folders = new Map<string, SampleFolder>();
  const add = (id: string, name: string, extra: Partial<FolderInfo>): void => {
    folders.set(id, { info: { id, label: `~/Projects/${name}`, name, hasDefinition: false, engines: [], previewEngines, installedEngines: [], problem: null, projected: false, unfinished: { projection: false, adoption: false }, ...extra }, adopted: false, projected: false, written: null, stopped: extra.unfinished?.projection === true, merged: false, def: extra.hasDefinition === true ? SAMPLE_DEFS[id] ?? null : null, versions: [], counter: 0 });
  };
  add(SAMPLE_FOLDERS.adopt, 'inbox-tools', {});
  add(SAMPLE_FOLDERS.defined, 'weekly-report', { hasDefinition: true, engines: ['claude-code', 'codex', 'opencode'] });
  add(SAMPLE_FOLDERS.stopped, 'garden', { hasDefinition: true, engines: ['claude-code', 'codex'], unfinished: { projection: true, adoption: false } });
  const notes = new Map<string, SampleNotes>([
    [SAMPLE_NOTES.use, { view: { id: SAMPLE_NOTES.use, label: '~/Documents/Garden notes', name: 'Garden notes', suggestedName: 'garden-notes', pages: SAMPLE_NOTE_FILES.length, complete: true, history: 'none', lastCommitAt: null, latestReport: null, reportsComplete: true }, files: SAMPLE_NOTE_FILES, hidden: 1 }],
    [SAMPLE_NOTES.start, { view: { id: SAMPLE_NOTES.start, label: '~/Documents/Notes', name: 'Notes', suggestedName: 'notes', pages: 0, complete: true, history: 'none', lastCommitAt: null, latestReport: null, reportsComplete: true }, files: [], hidden: 0 }],
  ]);
  /** A notes folder by id; an id the sample never gave is refused as main refuses it. */
  const notesGet = (id: string): SampleNotes => { const n = notes.get(id); if (n === undefined) throw new Error('UNKNOWN_FOLDER'); return n; };
  /** The time of the sample's first commit: fixed, as the sample has no clock. */
  const COMMITTED = '2026-10-28T09:30:00Z';
  const info = (f: SampleFolder): FolderInfo => ({ ...f.info, projected: f.projected, unfinished: { projection: f.stopped, adoption: false }, hasDefinition: f.info.hasDefinition || f.adopted, engines: f.adopted ? ['claude-code', 'codex'] : f.info.engines });
  const get = (id: string): SampleFolder => { const f = folders.get(id); if (f === undefined) throw new Error('UNKNOWN_FOLDER'); return f; };
  const settle = async <T>(value: T): Promise<T> => value;

  function adoptPlan(choices: AdoptChoices): AdoptView {
    const base = withApprovals(withEveryEngine(adoptFixture(), choices.everyEngine ?? []));
    const conflicts = base.conflicts.map(c => ({ ...c, picked: c.variants.some(v => v.key === choices.picks[c.key]) ? choices.picks[c.key]! : null }));
    const unmapped = base.unmapped.map(u => ({ ...u, acknowledged: u.gate === 'acknowledge' && choices.acknowledged.some(a => a.id === u.id && a.hash === u.hash) }));
    const ready = conflicts.every(c => c.picked !== null) && unmapped.every(u => u.gate === 'none' || u.acknowledged);
    return { ...base, conflicts, unmapped, ready, revision: sampleRevision(`adopt ${JSON.stringify(conflicts.map(c => c.picked))} ${JSON.stringify(unmapped.map(u => u.acknowledged))} ${JSON.stringify(base.everyEngine.map(e => e.chosen))}`) };
  }
  function projectAnswer(f: SampleFolder, input: ProjectInput): Answer<ProjectAnswer> {
    if (f.stopped) return refuse('PORTABLE_RECOVERY_REQUIRED');
    if (!f.info.hasDefinition && !f.adopted) return refuse('PORTABLE_DEFINITION_INVALID', ['harness.json']);
    if (input.reconcile === 'merge' && !f.projected) return refuse('PORTABLE_MERGE_NOT_BUILT');
    const needed = APPROVE.filter(l => input.engines.includes(l.engine)).map(l => ({ ...l, key: sampleKey(l), approvable: true, text: SAMPLE_ENTRY[`${l.part}/${l.entry}`] ?? '' }));
    if (!f.projected && needed.some(l => !input.approve.includes(l.key))) return ok({ kind: 'approve', lines: needed, approvedSoFar: input.approve.filter(k => needed.some(l => l.key === k)) });
    return ok({ kind: 'plan', plan: projectFixture(input, f.projected, f.written) });
  }

  /** The harness after the edits, as main would make it, or a refusal in the packages' words. */
  function edited(f: SampleFolder, edits: readonly SaveEdit[]): Answer<DefinitionView> {
    if (f.def === null) return refuse('SAVE_NO_DEFINITION');
    let d: DefinitionView = f.def;
    for (const e of edits) {
      if (e.kind === 'set-agent') {
        if (!d.agents.some(a => a.id === e.id)) return editRefusal('agent', e.id);
        const ghost = (e.skills ?? []).find(k => !d.skills.some(x => x.id === k));
        if (ghost !== undefined) return editRefusal('skill', ghost, ' to link');
        const unknown = (e.notes ?? []).find(n => !d.sources.some(x => x.name === n));
        if (unknown !== undefined) return editRefusal('knowledge source', unknown, ' to list in notes');
        d = { ...d, agents: d.agents.map(a => (a.id === e.id ? { ...a, ...(e.skills === undefined ? {} : { skills: [...e.skills] }), ...(e.notes === undefined ? {} : { notes: [...e.notes] }) } : a)) };
      } else if (e.kind === 'set-source') {
        const n = notesGet(e.notesId).view;
        const source = { name: e.name, kind: 'wiki-folder' as const, label: n.label, notesId: n.id };
        d = { ...d, sources: d.sources.some(x => x.name === e.name) ? d.sources.map(x => (x.name === e.name ? source : x)) : [...d.sources, source] };
      } else if (e.kind === 'remove-source') {
        if (!d.sources.some(x => x.name === e.name)) return editRefusal('knowledge source', e.name);
        d = { ...d, sources: d.sources.filter(x => x.name !== e.name), agents: d.agents.map(a => ({ ...a, notes: a.notes.filter(n => n !== e.name) })) };
      } else if (e.kind === 'add-from-kit') {
        if (d.kits.some(k => k.id === e.kit)) return { ok: false, refusal: { code: 'KIT_ALREADY_ADDED', message: SAMPLE_MESSAGES.KIT_ALREADY_ADDED, paths: [] } };
        const taken = SAMPLE_KIT.skills.find(k => d.skills.some(x => x.id === k.id));
        if (taken !== undefined) return duplicate('a skill', taken.id);
        if (d.agents.some(a => a.id === SAMPLE_KIT.agent.id)) return duplicate('an agent', SAMPLE_KIT.agent.id);
        d = {
          ...d,
          skills: [...d.skills, ...SAMPLE_KIT.skills.map(k => skillOf(k.id, k.description))].sort((a, b) => byText(a.id, b.id)),
          agents: [...d.agents, { ...agentOf(SAMPLE_KIT.agent.id, SAMPLE_KIT.agent.description, SAMPLE_KIT.agent.skills) }].sort((a, b) => byText(a.id, b.id)),
          kits: [...d.kits, { id: SAMPLE_KIT.id, version: SAMPLE_KIT.version, skills: SAMPLE_KIT.skills.map(k => k.id) }],
        };
      } else if (e.kind === 'remove-skill') {
        if (!d.skills.some(x => x.id === e.id)) return editRefusal('skill', e.id);
        // A kit's record leaves with its last skill, as the real save drops it from sources.json.
        d = {
          ...d, skills: d.skills.filter(x => x.id !== e.id), agents: d.agents.map(a => ({ ...a, skills: a.skills.filter(k => k !== e.id) })),
          kits: d.kits.map(k => ({ ...k, skills: k.skills.filter(x => x !== e.id) })).filter(k => k.skills.length > 0),
        };
      } else if (e.kind === 'add-skill') {
        const source = get(e.from).def?.skills.find(x => x.id === e.id);
        if (source === undefined) return refuse('SAVE_SOURCE_MISSING');
        if (d.skills.some(x => x.id === e.id)) return duplicate('a skill', e.id);
        d = { ...d, skills: [...d.skills, source].sort((a, b) => byText(a.id, b.id)) };
      } else {
        d = { ...d, engines: (Object.keys(ENGINE_NAMES) as EngineId[]).filter(x => e.engines.includes(x)) };
      }
    }
    return ok(d);
  }
  function savePlan(f: SampleFolder, edits: readonly SaveEdit[]): Answer<SaveView & { after: DefinitionView }> {
    const a = edited(f, edits);
    if (!a.ok) return a;
    const changes = sampleChanges(f.def!, a.value);
    return ok({ folder: f.info.label, changes, definition: a.value, noop: changes.length === 0, revision: sampleRevision(`save ${f.info.id} ${JSON.stringify(f.def)} ${JSON.stringify(a.value)}`), after: a.value });
  }
  const versionView = (f: SampleFolder, v: SampleFolder['versions'][number]): VersionView => ({ ...v.entry, current: f.def !== null && sameDef(v.def, f.def) });
  /** Keeps a save point, as main does: the harness as it was first when the newest one is not it, then what was written. */
  function keep(f: SampleFolder, d: DefinitionView, label: string): string {
    f.counter += 1;
    const id = `v${f.counter}`;
    // The sample has no clock: each save point is one minute after the last, from a fixed time.
    f.versions.push({ entry: { id, created: new Date(Date.UTC(2026, 9, 28, 9, f.counter)).toISOString().replace(/\.\d{3}Z$/, 'Z'), label, files: sampleFiles(d).size }, def: d });
    return id;
  }
  function write(f: SampleFolder, plan: SaveView & { after: DefinitionView }, label: string): SaveWritten {
    if (plan.noop) return { written: [], version: null };
    const newest = f.versions[f.versions.length - 1];
    if (newest === undefined || !sameDef(newest.def, f.def!)) keep(f, f.def!, f.versions.length === 0 ? 'As it was before the first save' : 'As it was before this save');
    f.def = plan.after;
    return { written: plan.changes.map(c => c.path), version: keep(f, plan.after, label) };
  }
  function restorePlan(f: SampleFolder, version: string): Answer<RestoreView & { after: DefinitionView }> {
    if (f.def === null) return refuse('SAVE_NO_DEFINITION');
    const v = f.versions.find(x => x.entry.id === version);
    if (v === undefined) return refuse('VERSION_UNKNOWN');
    const changes = sampleChanges(f.def, v.def);
    return ok({ folder: f.info.label, changes, definition: v.def, noop: changes.length === 0, revision: sampleRevision(`restore ${f.info.id} ${version} ${JSON.stringify(f.def)}`), version: versionView(f, v), after: v.def });
  }
  const strip = <T extends { after: DefinitionView }>(v: T): Omit<T, 'after'> => { const { after: _after, ...rest } = v; return rest; };

  function mergePlan(f: SampleFolder): Answer<MergeView> {
    if (f.stopped) return refuse('PORTABLE_RECOVERY_REQUIRED');
    if (!f.info.hasDefinition || f.merged || f.projected) return refuse('ADOPTION_MERGE_NOTHING');
    return ok({ folder: f.info.label, claude: SAMPLE_CLAUDE, heading: 'From CLAUDE.md', addsPart: false, files: [{ path: '.bowerloom/instructions/AGENTS.md', action: 'update' }], revision: sampleRevision(`merge ${f.info.id}`) });
  }

  /** The starter plan of an empty made-up folder, or the package's refusal of a folder that holds pages. */
  function starterPlan(n: SampleNotes): Answer<NotesStarterView> {
    if (n.view.pages > 0 || n.view.history !== 'none') return refuse('NOTES_NOT_EMPTY');
    return ok({ notes: n.view.label, createsFolder: false, folders: ['pages', 'reports', 'sources'], files: SAMPLE_KIT.starter.map(f => ({ ...f })), kit: { id: SAMPLE_KIT.id, version: SAMPLE_KIT.version }, revision: sampleRevision(`starter ${n.view.id}`) });
  }
  /** The history plan of a made-up folder with pages and no history, or the package's refusal. */
  function historyPlan(n: SampleNotes): Answer<NotesHistoryPlanView> {
    if (n.view.history !== 'none') return refuse('NOTES_ALREADY_REPOSITORY');
    if (n.files.length === 0) return refuse('NOTES_NOTHING_TO_COMMIT');
    return ok({ notes: n.view.label, files: n.files.map(path => ({ path, kind: 'file' as const })), count: n.files.length, hidden: n.hidden, revision: sampleRevision(`history ${n.view.id}`) });
  }

  return {
    mode: 'sample',
    folders: () => settle([...folders.values()].map(info)),
    chooseFolder: () => settle(null),
    planAdoption: (id, choices) => settle(((): Answer<AdoptView> => {
      const f = get(id);
      if (f.info.hasDefinition || f.adopted) return refuse('ADOPTION_DEFINED');
      return ok(adoptPlan(choices));
    })()),
    runAdoption: (id, revision, choices, approvals) => settle(((): Answer<AdoptWritten> => {
      const f = get(id);
      if (f.info.hasDefinition || f.adopted) return refuse('ADOPTION_DEFINED');
      const plan = adoptPlan(choices);
      if (plan.revision !== revision) return refuse('ADOPTION_STALE_APPROVAL');
      if (plan.conflicts.some(c => c.picked === null)) return refuse('ADOPTION_CHOICE_REQUIRED');
      if (plan.unmapped.some(u => u.gate === 'acknowledge' && !u.acknowledged)) return refuse('ADOPTION_ACKNOWLEDGEMENT_REQUIRED');
      if (plan.approvals.some(a => !approvals.some(x => x.key === a.key && x.hash === a.hash))) return refuse('ADOPTION_APPROVAL_REQUIRED');
      f.adopted = true; f.def = SAMPLE_DEFS[f.info.id] ?? null;
      return ok({ written: plan.files.map(file => `.bowerloom/${file.path}`) });
    })()),
    planAdoptionRecovery: id => settle((get(id), refuse('ADOPTION_RECOVER_NOTHING')) as Answer<AdoptRecoveryView>),
    runAdoptionRecovery: id => settle((get(id), refuse('ADOPTION_RECOVER_NOTHING')) as Answer<AdoptRecovered>),
    planProjection: (id, input) => settle(projectAnswer(get(id), input)),
    runProjection: (id, revision, input) => settle(((): Answer<ProjectWritten> => {
      const f = get(id), a = projectAnswer(f, input);
      if (!a.ok) return a;
      if (a.value.kind !== 'plan' || a.value.plan.revision !== revision) return refuse('ADOPTION_STALE_APPROVAL');
      const plan = a.value.plan;
      f.projected = true; f.written = JSON.stringify({ ...input, approve: [...input.approve].sort() });
      return ok({ noop: plan.noop, written: plan.changes.filter(writesFile).map(c => c.path), takenOver: plan.changes.filter(c => c.action === 'take-over').map(c => c.path), leftBehind: [] });
    })()),
    planRemoval: id => settle(((): Answer<RemovalView> => {
      const f = get(id);
      if (!f.projected) return refuse('PORTABLE_NOTHING_PROJECTED');
      const changes: ChangeView[] = [
        { path: '.claude/settings.json', action: 'delete', engines: [] }, { path: '.codex/rules/bowerloom.rules', action: 'delete', engines: [] },
        { path: 'AGENTS.md', action: 'delete', engines: [] }, { path: 'CLAUDE.md', action: 'restore', engines: [] },
      ];
      return ok({ changes, removeDirs: ['.codex/rules', '.claude/skills/draft-outline'], revision: sampleRevision(`removal ${f.written}`) });
    })()),
    runRemoval: (id, revision) => settle(((): Answer<Removed> => {
      const f = get(id);
      if (!f.projected) return refuse('PORTABLE_NOTHING_PROJECTED');
      if (revision !== sampleRevision(`removal ${f.written}`)) return refuse('ADOPTION_STALE_APPROVAL');
      f.projected = false; f.written = null;
      return ok({ restored: ['CLAUDE.md'], kept: [], deleted: ['.claude/settings.json', '.codex/rules/bowerloom.rules', 'AGENTS.md'], leftBehind: [] });
    })()),
    planRecovery: (id, choices) => settle(((): Answer<RecoveryView> => {
      const f = get(id), c = choicesOf(choices);
      if (!f.stopped) return refuse('PORTABLE_RECOVER_NOTHING');
      return ok({
        kind: 'apply', action: 'rollback',
        steps: [{ path: 'AGENTS.md', now: 'present', decision: 'undo' }, { path: '.claude/settings.json', now: 'present', decision: 'undo' }, { path: '.codex/hooks.json', now: 'missing', decision: 'none' }],
        keep: [...c.keep], modes: [], notice: null, revision: sampleRevision(`recovery ${c.keep.join(',')}`),
      });
    })()),
    runRecovery: (id, revision, choices) => settle(((): Answer<Recovered> => {
      const f = get(id), c = choicesOf(choices);
      if (!f.stopped) return refuse('PORTABLE_RECOVER_NOTHING');
      if (revision !== sampleRevision(`recovery ${c.keep.join(',')}`)) return refuse('ADOPTION_STALE_APPROVAL');
      f.stopped = false;
      return ok({ leftBehind: [] });
    })()),
    planMerge: id => settle(mergePlan(get(id))),
    runMerge: (id, revision) => settle(((): Answer<MergeWritten> => {
      const f = get(id), plan = mergePlan(f);
      if (!plan.ok) return plan;
      if (plan.value.revision !== revision) return refuse('ADOPTION_STALE_APPROVAL');
      f.merged = true;
      return ok({ written: plan.value.files.map(x => x.path) });
    })()),
    // The sample writes nothing, not even a usage line.
    recordCheck: () => settle(false),
    planSave: (id, edits) => settle(((): Answer<SaveView> => { const a = savePlan(get(id), edits); return a.ok ? ok(strip(a.value)) : a; })()),
    runSave: (id, revision, edits) => settle(((): Answer<SaveWritten> => {
      const f = get(id), a = savePlan(f, edits);
      if (!a.ok) return a;
      if (a.value.revision !== revision) return refuse('SAVE_STALE');
      return ok(write(f, a.value, `Saved ${a.value.changes.length} ${a.value.changes.length === 1 ? 'change' : 'changes'}`));
    })()),
    listVersions: id => settle(((): Answer<readonly VersionView[]> => {
      const f = get(id);
      if (f.def === null) return refuse('SAVE_NO_DEFINITION');
      return ok([...f.versions].reverse().map(v => versionView(f, v)));
    })()),
    planRestore: (id, version) => settle(((): Answer<RestoreView> => { const a = restorePlan(get(id), version); return a.ok ? ok(strip(a.value)) : a; })()),
    runRestore: (id, revision, version) => settle(((): Answer<SaveWritten> => {
      const f = get(id), a = restorePlan(f, version);
      if (!a.ok) return a;
      if (a.value.revision !== revision) return refuse('SAVE_STALE');
      return ok(write(f, a.value, `Went back to ${version}`));
    })()),
    // The sample's save points live in memory and are never damaged. Setting them aside starts a new list; the counter goes on, as nothing is deleted.
    planSetAside: id => settle(((): Answer<SetAsideView> => {
      const f = get(id);
      if (f.def === null) return refuse('SAVE_NO_DEFINITION');
      if (f.versions.length === 0) return refuse('VERSION_NOTHING');
      return ok({ folder: f.info.label, damaged: false, revision: sampleRevision(`set-aside ${f.versions.map(v => v.entry.id).join(',')}`) });
    })()),
    runSetAside: (id, revision) => settle(((): Answer<SetAsideWritten> => {
      const f = get(id);
      if (f.def === null) return refuse('SAVE_NO_DEFINITION');
      if (f.versions.length === 0) return refuse('VERSION_NOTHING');
      if (revision !== sampleRevision(`set-aside ${f.versions.map(v => v.entry.id).join(',')}`)) return refuse('VERSION_STALE');
      f.versions = [];
      return ok({ name: 'versions-set-aside-sample' });
    })()),
    // The sample has no chooser: it answers the made-up notes folder for each purpose.
    chooseNotesFolder: purpose => settle(((): Answer<NotesView> => {
      if (!(NOTES_PURPOSES as readonly string[]).includes(purpose)) throw new Error('BAD_ARGUMENT');
      return ok({ ...notesGet(purpose === 'use' ? SAMPLE_NOTES.use : SAMPLE_NOTES.start).view });
    })()),
    notesSummary: id => settle(ok({ ...notesGet(id).view })),
    planCreateNotes: id => settle(starterPlan(notesGet(id))),
    runCreateNotes: (id, revision) => settle(((): Answer<NotesWritten> => {
      const n = notesGet(id), plan = starterPlan(n);
      if (!plan.ok) return plan;
      if (plan.value.revision !== revision) return refuse('NOTES_STALE');
      n.view = { ...n.view, pages: SAMPLE_KIT.starter.length, history: 'git', lastCommitAt: COMMITTED };
      return ok({ files: SAMPLE_KIT.starter.length, committedAt: COMMITTED, clean: true });
    })()),
    planNotesHistory: id => settle(historyPlan(notesGet(id))),
    runNotesHistory: (id, revision) => settle(((): Answer<NotesWritten> => {
      const n = notesGet(id), plan = historyPlan(n);
      if (!plan.ok) return plan;
      if (plan.value.revision !== revision) return refuse('NOTES_STALE');
      n.view = { ...n.view, history: 'git', lastCommitAt: COMMITTED };
      return ok({ files: n.files.length, committedAt: COMMITTED, clean: true });
    })()),
  };
}
