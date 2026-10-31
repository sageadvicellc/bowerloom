/**
 * Builds a made-up home folder for the acceptance journeys (spec section 12, pass 1). Every name, text and setting is invented. No path in it points outside the
 * folder, and no value in it is a secret: a tool names the variable that holds its key, as `${VARIABLE}`.
 *
 * The folder it makes:
 *   <root>/.made-up-home                        the marker. The script removes a folder only when it holds this file.
 *   <root>/home                                 the HOME to give the app.
 *   <root>/home/.claude, .claude.json, .codex   Claude Code and Codex at home: skills, agents, instructions, settings with a hook, and tool entries.
 *   <root>/home/Projects/ferry-schedule         a project set up for both programs (AGENTS.md and a CLAUDE.md that differ, a hook, two tools).
 *   <root>/home/Projects/kite-workshop          a project set up for Claude Code only.
 *   <root>/home/Projects/rope-yard              a project that already holds a harness, for Claude Code and Codex.
 *   <root>/home/Documents/tide-notes            a wiki folder of markdown pages, with a short git history when `git` is given.
 *
 * Run it again on the same folder and it returns every file to the start state, so a build is also a reset. The git history uses fixed names, dates and messages,
 * so the commit it makes is the same on every run.
 *
 * Use it from code (`buildMadeUpHome`) or from a terminal: `node apps/desktop/tools/made-up-home.ts [folder] [--git <path-to-git>]`. With no folder it makes a new one in the
 * system temp folder and prints its path. The file uses only syntax that Node can run without a build step.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The file that marks a folder as one this script made. */
export const MARKER = '.made-up-home';
/** The days of the three commits in the wiki, oldest first (UTC noon). The last one is the wiki's last-change day. */
export const WIKI_DAYS: readonly string[] = Object.freeze(['2024-02-01', '2024-03-05', '2024-04-12']);

export interface MadeUpHome {
  /** The folder that holds everything. Remove it with `removeMadeUpHome`. */
  readonly root: string;
  /** The HOME to give the app. */
  readonly home: string;
  /** The projects, by name. */
  readonly ferry: string; readonly kite: string; readonly rope: string;
  /** The folder of projects a person would pick in "Add a folder". */
  readonly projects: string;
  /** The wiki folder, and whether it has a git history. */
  readonly wiki: string; readonly wikiHasHistory: boolean;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const skill = (name: string, description: string, body: string): string => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
const claudeAgent = (name: string, description: string, skills: readonly string[], body: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n${skills.length === 0 ? '' : `skills: [${skills.join(', ')}]\n`}---\n${body}\n`;
const codexAgent = (name: string, description: string, body: string): string => `name = "${name}"\ndescription = "${description}"\ndeveloper_instructions = """\n${body}\n"""\n`;

/** Every file of the made-up home, by its path under the home folder: its text. Nothing here depends on the machine it runs on. */
export function homeFiles(): Readonly<Record<string, string>> {
  const chart = skill('chart-check', 'Checks a tide chart against the posted times.', 'Read the chart. Compare each line with the posted times. List the lines that differ.');
  const chartCodex = skill('chart-check', 'Checks a tide chart against the posted times.', 'Read the chart twice. Compare each line with the posted times and with last week. List the lines that differ.');
  const timetable = skill('timetable-check', 'Checks a ferry timetable for gaps.', 'Read the timetable. Find a gap longer than an hour. List each gap.');
  const stringTest = skill('string-test', 'Tests the strength of a kite string.', 'Pull the string. Note the weight at which it gives. Write the number down.');
  const splice = skill('splice', 'Explains how to splice two ropes.', 'Unlay the strands. Weave each strand through the other rope. Trim the ends.');
  const knot = skill('knot-guide', 'Picks the right knot for a job.', 'Ask what the rope must hold. Name one knot. Say how to tie it.');
  const coil = skill('coil-count', 'Counts the coils on a shelf.', 'Count each coil. Write the total and the shelf name.');
  const tideServer = { command: 'npx', args: ['-y', 'tide-feed-server'], env: { TIDE_API_KEY: '${TIDE_API_KEY}' } };
  return Object.freeze({
    // Claude Code and Codex at home.
    '.claude/CLAUDE.md': '# Home rules\n\nBe brief. Name the file you change.\n',
    '.claude/settings.json': json({ permissions: { allow: ['Read'] }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo ready' }] }] } }),
    '.claude/skills/chart-check/SKILL.md': chart,
    '.claude/skills/coil-count/SKILL.md': coil,
    '.claude/agents/dock-clerk.md': claudeAgent('dock-clerk', 'Keeps the dock log tidy.', ['chart-check'], 'You keep the dock log.'),
    '.claude.json': json({ mcpServers: { 'tide-feed': tideServer } }),
    '.codex/AGENTS.md': '# Home rules for Codex\n\nBe brief. Name the file you change.\n',
    '.codex/config.toml': 'model = "gpt-5"\n\n[mcp_servers.tide-feed]\ncommand = "npx"\nargs = ["-y", "tide-feed-server"]\n',
    '.codex/skills/chart-check/SKILL.md': chartCodex,
    '.codex/agents/signal-reader.toml': codexAgent('signal-reader', 'Reads the flags on the harbor mast.', 'Read each flag. Say what it means.'),

    // Project 1, set up for both programs. AGENTS.md and CLAUDE.md differ on purpose.
    'Projects/ferry-schedule/AGENTS.md': '# Ferry schedule\n\nUse npm.\n',
    'Projects/ferry-schedule/CLAUDE.md': '# Ferry schedule for Claude\n\nUse pnpm.\n',
    'Projects/ferry-schedule/.claude/skills/timetable-check/SKILL.md': timetable,
    'Projects/ferry-schedule/.claude/skills/chart-check/SKILL.md': chart,
    'Projects/ferry-schedule/.claude/agents/dock-clerk.md': claudeAgent('dock-clerk', 'Keeps the dock log tidy.', ['timetable-check'], 'You keep the dock log.'),
    'Projects/ferry-schedule/.claude/settings.json': json({ permissions: { deny: ['Bash(rm -rf:*)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo check' }] }] } }),
    'Projects/ferry-schedule/.mcp.json': json({ mcpServers: { 'tide-feed': tideServer } }),
    'Projects/ferry-schedule/.codex/config.toml': 'model = "gpt-5"\n',
    'Projects/ferry-schedule/.codex/agents/signal-reader.toml': codexAgent('signal-reader', 'Reads the flags on the harbor mast.', 'Read each flag. Say what it means.'),
    'Projects/ferry-schedule/.agents/skills/timetable-check/SKILL.md': timetable,

    // Project 2, set up for Claude Code only.
    'Projects/kite-workshop/CLAUDE.md': '# Kite workshop\n\nWrite short notes. Use metric units.\n',
    'Projects/kite-workshop/.claude/skills/string-test/SKILL.md': stringTest,
    'Projects/kite-workshop/.claude/agents/wind-reader.md': claudeAgent('wind-reader', 'Reads the wind and says if it is a kite day.', ['string-test'], 'You read the wind.'),

    // Project 3, which already holds a harness for Claude Code and Codex: three skills, two agents, and one skill that no agent uses yet.
    'Projects/rope-yard/.bowerloom/harness.json': json({ format: 'bowerloom/harness/v1beta1', id: 'rope-yard', description: 'The rope yard harness.', engines: [{ id: 'claude-code', version: '2.1.310' }, { id: 'codex' }], parts: { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/', subagents: 'agents/' } }),
    'Projects/rope-yard/.bowerloom/instructions/AGENTS.md': '# Rope yard\n\nCount every coil. Name the shelf.\n',
    'Projects/rope-yard/.bowerloom/skills/splice/SKILL.md': splice,
    'Projects/rope-yard/.bowerloom/skills/knot-guide/SKILL.md': knot,
    'Projects/rope-yard/.bowerloom/skills/coil-count/SKILL.md': coil,
    'Projects/rope-yard/.bowerloom/agents/foreman.md': '---\nname: foreman\ndescription: Plans the day in the rope yard.\nskills:\n  - splice\n---\n\nPlan the day.\n',
    'Projects/rope-yard/.bowerloom/agents/tallyman.md': '---\nname: tallyman\ndescription: Counts what is on the shelves.\n---\n\nCount the shelves.\n',

    // The wiki folder. A hidden folder, a file that is not a page, and a nested page are in it on purpose.
    'Documents/tide-notes/AGENTS.md': '# Tide notes\n\nOne page for each subject. Link pages with relative links.\n',
    'Documents/tide-notes/index.md': '# Tide notes\n\n- [Spring tides](pages/spring-tides.md)\n- [Harbor bar](pages/harbor/bar.md)\n',
    'Documents/tide-notes/log.md': '# Log\n\n- 2024-02-01 Started the notes.\n- 2024-04-12 Added the tide pages.\n',
    'Documents/tide-notes/pages/spring-tides.md': '# Spring tides\n\nThe highest tides come near a new moon and a full moon.\n',
    'Documents/tide-notes/pages/neap-tides.md': '# Neap tides\n\nThe lowest range comes near a half moon.\n',
    'Documents/tide-notes/pages/harbor/bar.md': '# Harbor bar\n\nThe bar is shallow at low water.\n',
    'Documents/tide-notes/pages/harbor/chart.png': 'not a page',
    'Documents/tide-notes/sources/almanac-note.md': '# Almanac note\n\nA short note copied from the almanac.\n',
    'Documents/tide-notes/.obsidian/app.json': '{}\n',
  });
}

const WIKI = 'Documents/tide-notes';
/** The log page as the first two commits leave it. The last commit writes the full page of `homeFiles`. */
const LOG_AT_START = '# Log\n\n- 2024-02-01 Started the notes.\n';
/** The commits of the wiki, oldest first: the day, the message, and the files each one writes. */
const WIKI_COMMITS: readonly { readonly day: string; readonly message: string; readonly paths: readonly string[] }[] = Object.freeze([
  { day: WIKI_DAYS[0]!, message: 'Start the notes', paths: ['AGENTS.md', 'index.md', 'log.md', 'pages/spring-tides.md'] },
  { day: WIKI_DAYS[1]!, message: 'Add tide pages', paths: ['pages/neap-tides.md', 'pages/harbor/bar.md', 'pages/harbor/chart.png', 'sources/almanac-note.md', '.obsidian/app.json'] },
  { day: WIKI_DAYS[2]!, message: 'Log the pages', paths: ['log.md'] },
]);

function runGit(git: string, dir: string, args: readonly string[], day: string | null): void {
  const when = day === null ? {} : { GIT_AUTHOR_DATE: `${day}T12:00:00Z`, GIT_COMMITTER_DATE: `${day}T12:00:00Z` };
  const result = spawnSync(git, ['-C', dir, ...args], {
    encoding: 'utf8', shell: false,
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Tide Keeper', GIT_AUTHOR_EMAIL: 'keeper@example.invalid', GIT_COMMITTER_NAME: 'Tide Keeper', GIT_COMMITTER_EMAIL: 'keeper@example.invalid', ...when },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

/** Writes the wiki again in three steps and commits each one, so the folder ends as `final` says and holds three commits on the days of WIKI_DAYS. */
function giveHistory(git: string, wiki: string, final: Readonly<Record<string, string>>): void {
  rmSync(wiki, { recursive: true, force: true });
  mkdirSync(wiki, { recursive: true });
  runGit(git, wiki, ['init', '-q', '-b', 'main', '--template='], null);
  WIKI_COMMITS.forEach((step, index) => {
    for (const path of step.paths) {
      mkdirSync(dirname(join(wiki, path)), { recursive: true });
      writeFileSync(join(wiki, path), path === 'log.md' && index < WIKI_COMMITS.length - 1 ? LOG_AT_START : final[path]!);
    }
    runGit(git, wiki, ['add', '-A'], step.day);
    runGit(git, wiki, ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', step.message], step.day);
  });
}

function assertSafeRoot(root: string): void {
  if (!isAbsolute(root)) throw new Error('The folder must be an absolute path.');
  const here = resolve(root);
  if (here === resolve('/') || here === resolve(homedir()) || dirname(here) === here) throw new Error('That folder is not a place for a made-up home.');
  if (!existsSync(here)) return;
  if (!lstatSync(here).isDirectory()) throw new Error('That path is a file, not a folder.');
  if (existsSync(join(here, MARKER))) return;
  if (readdirSync(here).length === 0) return;
  throw new Error('That folder holds files that this script did not make, so it leaves them alone.');
}

/**
 * Builds the made-up home in `root`, or returns it to the start state when it is already there. `root` is made when missing. It must be empty or hold the marker.
 * `git` is the path of a git program; with `null`, the wiki has no history. Nothing outside `root` is read or written.
 */
export function buildMadeUpHome(root: string, { git = null }: { git?: string | null } = {}): MadeUpHome {
  assertSafeRoot(root);
  mkdirSync(root, { recursive: true });
  const base = realpathSync(root);
  for (const name of readdirSync(base)) rmSync(join(base, name), { recursive: true, force: true });
  writeFileSync(join(base, MARKER), 'A made-up home. The script that made it removes this folder only because this file is here.\n');
  const home = join(base, 'home');
  const files = homeFiles();
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(home, rel)), { recursive: true });
    writeFileSync(join(home, rel), text);
  }
  chmodSync(home, 0o700);
  const wiki = join(home, WIKI);
  let history = false;
  if (git !== null) {
    const final: Record<string, string> = {};
    for (const [rel, text] of Object.entries(files)) if (rel.startsWith(`${WIKI}/`)) final[rel.slice(WIKI.length + 1)] = text;
    giveHistory(git, wiki, final);
    history = true;
  }
  const projects = join(home, 'Projects');
  return { root: base, home, projects, ferry: join(projects, 'ferry-schedule'), kite: join(projects, 'kite-workshop'), rope: join(projects, 'rope-yard'), wiki, wikiHasHistory: history };
}

/** The same as `buildMadeUpHome`: a build on a made-up home is a reset. The name says what the caller means. */
export const resetMadeUpHome = buildMadeUpHome;

/** Removes a made-up home, only when it holds the marker. Returns true when it removed one. */
export function removeMadeUpHome(root: string): boolean {
  if (!isAbsolute(root) || !existsSync(join(root, MARKER))) return false;
  rmSync(root, { recursive: true, force: true });
  return true;
}

/** A digest of every file under a folder: path, mode and bytes. The `.git` folder is left out, because its index holds file times. */
export function digestTree(dir: string): string {
  const lines: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.name === '.git') continue;
      if (entry.isDirectory()) walk(r);
      else if (entry.isFile()) lines.push(`${r} ${(lstatSync(join(dir, r)).mode & 0o777).toString(8)} ${createHash('sha256').update(readFileSync(join(dir, r))).digest('hex')}`);
    }
  };
  walk('');
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

// Run from a terminal: node made-up-home.ts [folder] [--git <path-to-git>]
// It runs only when this very file is the program Node started. A test that imports it is bundled into another file, so the name differs.
if (process.argv[1] !== undefined && basename(process.argv[1]) === 'made-up-home.ts' && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--git');
  const git = at >= 0 ? (args[at + 1] ?? null) : null;
  const rest = at < 0 ? args : args.filter((_, i) => i !== at && i !== at + 1);
  const built = buildMadeUpHome(rest[0] ?? mkdtempSync(join(tmpdir(), 'bowerloom-made-up-home-')), { git });
  process.stdout.write(`${built.home}\n`);
}
