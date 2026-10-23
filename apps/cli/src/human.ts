import { canonicalJson, DefinitionError } from '../../../packages/contracts/src/index.js';

/**
 * The first screen a person sees, and the plain-words refusals. Output only: nothing here reads or writes a file.
 *
 * To add a command when its milestone lands:
 * 1. Add its usage line to a section in SECTIONS (or a new section).
 * 2. Add its full help text to TOPICS, keyed by the command word.
 * 3. Add its refusal codes to REFUSALS.
 * Only commands that exist at this commit may appear here. tests/help-human.test.ts checks the list.
 */
interface Section { readonly title: string; readonly lines: readonly string[] }
/** A command with its description. Every described line pads its command to 45 characters. */
const described = (command: string, text: string): string => `${command.padEnd(45)}${text}`;
const SECTIONS: readonly Section[] = [
  { title: 'Start here', lines: [
    described('bowerloom up --team <name>', 'Prepare this project for a team. Shows each plan first.'),
    described('bowerloom ls [teams|skills|prompts|slices]', 'List what this project holds.'),
    described('bowerloom status', 'Show whether this project is ready.'),
    described('bowerloom help context', 'Give each agent its part of a knowledge base.'),
  ] },
  { title: 'Skills and setup', lines: [
    'bowerloom skills add npm:<package>@<version>:<path>',
    'bowerloom skills add github:<owner>/<repo>@<40-char-commit>:<path>',
    described('bowerloom skills check', 'Check the pins in .bowerloom/skills.json.'),
    described('bowerloom skills sync [--offline]', 'Install the pinned skills on this machine.'),
    'bowerloom apply [--harness claude|codex|both]',
  ] },
  { title: 'Create (mostly used by agents)', lines: [
    'bowerloom team create <name> [--profile engineer|founder|research]',
    'bowerloom skill create <name> [--team <team>]',
    'bowerloom prompt create <name> [--team <team>]',
  ] },
];
const INTRO = "Set up agent teams, skills, and prompts for Claude Code and Codex.";
const OUTRO = [
  'Every change shows a plan first. Agents pass --approve <revision> or --json.',
  'No command here starts workers yet.', '',
  '  bowerloom help <command>   bowerloom help advanced',
  '  bowerloom help store       Your store, ~/.bowerloom, and how a project uses it.',
];

/** The short help, without the release heading. */
export function shortHelp(): string {
  return [INTRO, '', ...SECTIONS.flatMap(section => [section.title, ...section.lines.map(line => `  ${line}`), '']), ...OUTRO, ''].join('\n');
}

/** Full help for one command, keyed by the command word. `init` has its own text in main.ts. */
export const TOPICS: Readonly<Record<string, string>> = {
  store: [
    'Usage:', '  bowerloom store status [--json]',
    '  bowerloom store migrate [--skill <id>]... [--prompt <id>]... [--team <id>]... [--all] [--commit <sha>] [--approve <revision>] [--json]',
    '  bowerloom receipt clean [--global] [--approve <revision>] [--json]',
    // Spec 09.
    '  bowerloom cache list [--json]',
    '  bowerloom cache prune [--unreferenced] [--partial] [--legacy] [--all] [--entry <id-prefix>]... [--approve <revision>] [--json]', '',
    'Shows the state of your store, ~/.bowerloom. The store holds definitions of skills, prompts, and teams.',
    'It holds no cache and no installed copy.',
    'store status reads only and writes nothing. No store command starts workers.',
    'The store is always at ~/.bowerloom, and ~ is your HOME folder. Bowerloom refuses a store that is a link,',
    'that sits in an iCloud folder, or that other users can change, and a home folder that other users can write in.',
    'It does not check the folders above your home folder.',
    '--global on skill create, prompt create, team create, skills add, skills check and ls works on the store. See bowerloom help skill.',
    'A project picks store items with bowerloom use and stops with bowerloom unuse. bowerloom.lock.json records where a',
    'teammate gets them, with bowerloom lock verify and bowerloom lock update. See bowerloom help use and bowerloom help lock.',
    'A store that is a git repository with a github.com remote can be shared. store status shows the Git: line and the commands to set it up.',
    'A store in a private GitHub repository needs a token. Set BOWERLOOM_GITHUB_TOKEN to a GitHub token that can read',
    'the repository. Bowerloom sends it only to api.github.com, only for that repository. It never stores or prints it.',
    'Add --json for one machine-readable object.', '',
    // Spec 08, 3.1.
    'store migrate copies skills, prompts, and teams from this project to your store, ~/.bowerloom. Then it lists them in bowerloom.json',
    'with the source store. It deletes nothing. It prints the git rm lines so you can delete the old files after you check.',
    '--all picks every skill, prompt, and team that bowerloom.json lists, except first-team and personal-assistant.',
    'If the project has no bowerloom.json, --all picks every skill, prompt, and team of the project.',
    'Naming an item with --skill, --prompt, or --team moves it even when bowerloom.json does not list it.',
    'Slices never move.',
    'A store skill or prompt holds only md, txt, json, yaml, yml, csv, and license files. Each file is UTF-8, not empty, and not executable.',
    'An item holds at most 126 files, 65536 bytes in a file, and 2 MiB in all.',
    'In a shared project, a skill, prompt, or team that you wrote is switched to the store only after the store is',
    'pushed to its git remote. Until then it is copied and nothing else changes. Run the command again after you push.',
    '--commit <sha> records that commit of the store remote instead of the pushed commit of the current branch.',
    'After you delete the old files, run bowerloom receipt clean.',
    'It shows the plan first. Agents pass --approve <revision> or --json.', '',
    // Spec 09, section 6.
    'cache list shows the bytes that Bowerloom downloaded and kept on this machine. cache prune deletes them after you approve a plan.', '',
  ].join('\n'),
  // Spec 09, 3.3.
  cache: [
    'Usage:',
    '  bowerloom cache list [--json]',
    '  bowerloom cache prune [--unreferenced] [--partial] [--legacy] [--all] [--entry <id-prefix>]... [--approve <revision>] [--json]', '',
    'Bowerloom keeps the skill bytes it downloads in a cache on this machine, outside your projects and your store.',
    'cache list shows what is there. It reads only.',
    'cache prune deletes entries after you approve a plan. Nothing is deleted by itself.',
    '--unreferenced picks entries that your store and this project do not list. Other projects are not checked.',
    '--partial picks unfinished fetches. --legacy picks the per-project caches of earlier betas. --all picks everything.',
    '--entry <id-prefix> picks one entry by the first 8 or more characters of its id from cache list, or by its full store folder name.',
    'An entry whose owner lock is older than a day counts as not in use.',
    'A deleted pin is fetched again when bowerloom skills sync or apply --frozen needs it.',
    'It deletes no project file and no installed copy.',
    'It shows the plan first. Agents pass --approve <revision> or --json.', '',
  ].join('\n'),
  // Spec 08, 3.4.
  receipt: [
    'Usage:',
    '  bowerloom receipt clean [--global] [--approve <revision>] [--json]', '',
    'Removes entries from the record of created items when the files of those items are gone. Run it after you delete',
    'old files, for example after bowerloom store migrate. Then bowerloom status no longer names them as missing.',
    '--global cleans the record of your store, ~/.bowerloom.',
    'It also removes the local entry of a gone skill from skills.json, and the project entry from bowerloom.json.',
    'It deletes no file and no installed copy. Copies that sync or apply made stay where they are.',
    'It shows the plan first. Agents pass --approve <revision> or --json.', '',
  ].join('\n'),
  use: [
    'Usage:',
    '  bowerloom use skill|prompt|team <id> [--project] [--commit <sha>] [--max-github-requests <n>] [--approve <revision>] [--json]', '',
    'Picks an item for this project. By default the item comes from your store, ~/.bowerloom.',
    '--project picks an item that this project defines in .bowerloom and that bowerloom.json does not list yet.',
    'bowerloom.json lists everything this project installs. If it is missing, use creates it and lists the items',
    'this project defines now, with the source project.',
    'use team <id> also picks the store skills and prompts that name that team.',
    'In a shared project the item must be fetchable by your team. bowerloom.lock.json records where. See bowerloom help lock.',
    '--commit <sha> records that commit of the store remote instead of the pushed commit of the current branch.',
    '--max-github-requests <n> lets one run make up to n GitHub requests, at most 5000. The default is 1000.',
    'It changes bowerloom.json and bowerloom.lock.json only. Run bowerloom skills sync and bowerloom apply to put the copies in place.',
    'It shows the plan first. Agents pass --approve <revision> or --json.', '',
  ].join('\n'),
  unuse: [
    'Usage:',
    '  bowerloom unuse skill|prompt|team <id> [--approve <revision>] [--json]', '',
    'Removes an item from bowerloom.json and from bowerloom.lock.json. It removes no copy that sync or apply already made.',
    'unuse team <id> also removes the items that were picked only through that team.',
    'It shows the plan first. Agents pass --approve <revision> or --json.', '',
  ].join('\n'),
  lock: [
    'Usage:',
    '  bowerloom lock verify [--json]',
    '  bowerloom lock update [--item <kind>:<id>]... [--commit <sha>] [--approve <revision>] [--json]', '',
    'bowerloom.lock.json records where each store item of this project comes from and a hash that proves its bytes.',
    'Commit it with bowerloom.json. A teammate then runs bowerloom apply --frozen to get the same items.',
    'Project items are not in the lock. Git versions them.',
    'lock verify reads only. It checks the file, its hashes, and that it agrees with bowerloom.json. It uses no network.',
    'lock update looks at your store again and rewrites the lock items. Use --item to refresh some. <kind> is skill, prompt, or team.',
    'A pinned skill needs no network. A skill, prompt, or team written in the store is checked against its pushed copy on github.com.',
    'Without a token, GitHub allows about 60 requests an hour. Each item takes about 4 plus one per file.',
    'To raise the limit, set BOWERLOOM_GITHUB_TOKEN (see bowerloom help store).',
    '--commit <sha> records that commit of the store remote instead of the pushed commit of the current branch.',
    'A store in a private GitHub repository needs a token. Set BOWERLOOM_GITHUB_TOKEN to a GitHub token that can read',
    'the repository. Bowerloom sends it only to api.github.com, only for that repository. It never stores or prints it.', '',
  ].join('\n'),
  ls: [
    'Usage:', '  bowerloom ls [teams|skills|prompts|slices] [--global] [--json]', '',
    'Lists the teams, skills, prompts, and slices of this project. Each item shows where it comes from: project or store.',
    '--global lists your store, ~/.bowerloom, from any folder.',
    'It reads only and writes nothing.',
    'The project is the nearest parent folder that holds .bowerloom or bowerloom.json, found the way git finds .git.',
    'It stops at your home folder and refuses cloud-synced folders.',
    'When bowerloom.json lists what the project installs, ls lists its entries in id order, from the project or the store.',
    'An entry with no definition shows (missing). A line after the sections names the items Defined here but not listed in bowerloom.json.',
    'With --json each item has source, via (the teams it was picked through), state, locked (whether bowerloom.lock.json',
    'holds it, or null), and resolvedFrom: store, lock, or project.',
    'If the store refuses, its items show as missing and ls prints The store cannot be used (<code>). Run bowerloom store status.',
    'Add --json for one machine-readable object.', '',
  ].join('\n'),
  status: [
    'Usage:', '  bowerloom status [--json]', '',
    'Shows whether this project\'s setup is ready. It names each changed file or folder since setup, and each held',
    'or missing skill, prompt or team, with its next step.',
    'It reads only and writes nothing, and it starts no workers.',
    'A project with a bowerloom.json also shows its config: the counts, and a config-invalid drift if the file is wrong.',
    'A project that has only bowerloom.json shows Setup: ready (no startup setup, this project uses bowerloom.json).',
    'With bowerloom.json it also prints Lock: and the state of bowerloom.lock.json: not-used, absent, valid, stale, invalid, mismatch, or orphan.',
    'A lock that cannot be read is drift lock-invalid; a lock with no bowerloom.json is drift lock-orphan.',
    'With --json, config.store says whether the store items can be read (not-needed, ok, absent, or refused),',
    'config.items lists each entry with its source and state, and config.lock has the lock state and whether the project is shared.',
    'Add --json for one machine-readable object.',
    'bowerloom status --installation <private.json> still reads a prepared session. See bowerloom help advanced.', '',
  ].join('\n'),
  skills: [
    'Usage:',
    '  bowerloom skills add npm:<package>@<version>:<path> [--id <id>] [--team <team>]... [--replace] [--global] [--approve <revision>] [--json]',
    '  bowerloom skills add github:<owner>/<repo>@<40-char-commit>:<path> [--id <id>] [--team <team>]... [--replace] [--global] [--approve <revision>] [--json]',
    '  bowerloom skills check [--global] [--json]', '',
    'skills add pins one skill in .bowerloom/skills.json, the file you commit so every machine gets the same skills.',
    'The pin must be exact: an npm version such as 1.2.3, or a full 40-character lower-case Git commit.',
    'Ranges, tags, branches and short commits are refused before anything is fetched.',
    '<path> is the skill folder inside the package or repository, for example:',
    '  bowerloom skills add npm:@tanstack/db-skills@0.0.1:skills/tanstack-db/collections',
    'It reads only registry.npmjs.org or api.github.com, without credentials, and takes MIT or Apache-2.0 skills only.',
    'It shows the plan first. Agents pass --approve <revision> or --json. It records the pin only: nothing is installed or run.',
    '--id sets the entry id; the default is the skill name. --team limits the skill to a team; without it, every team gets it.',
    '--replace moves an existing id to another version or commit of the same package or repository. The plan shows the',
    'old pin and the new pin, and the entry keeps its teams unless you pass --team. Then skills sync updates the copies:',
    '  bowerloom skills add npm:@tanstack/db-skills@0.0.2:skills/tanstack-db/collections --id <id> --replace',
    '--global pins the skill in ~/.bowerloom/skills.json, your store, and keeps the checked bytes in the machine cache.',
    'The store holds up to 256 skills. A project holds up to 128.', '',
    'skills check reads .bowerloom/skills.json and checks every pin, offline. It writes nothing.',
    'skills check --global checks the pins in the store.', '',
    '  bowerloom skills sync [--offline] [--team <team>] [--frozen] [--max-github-requests <n>] [--approve <revision>] [--json]',
    'skills sync installs every skill in skills.json for Claude Code and Codex (the harnesses skills.json names):',
    'into .bowerloom/managed, .claude/skills and .agents/skills. Those copies stay on this machine; commit skills.json.',
    'It fetches only pins that are not in the private cache yet, and checks every byte against its pin first.',
    '--offline refuses before any change if a pin still needs fetching. --team syncs only that team\'s skills.',
    '--frozen installs only what bowerloom.lock.json records. It ignores your store and refuses if the lock and bowerloom.json',
    'disagree. It cannot be combined with --offline unless every item is already on this machine.',
    '--max-github-requests <n> lets one run make up to n GitHub requests, at most 5000. The default is 1000.',
    'A skill whose copy you changed is held and shown with its next step; the others apply. Sync removes nothing.',
    'Ctrl-C stops it between two skills, never inside one.', '',
    '  bowerloom skills recover plan|apply --item <id> [--action resume|rollback|abandon] [--approve <revision>] [--json]',
    'skills recover finishes or undoes the one unfinished change of an item, after a crash or a refusal inside it.', '',
    '  bowerloom skills migrate plan|apply --state <earlier-state-folder> [--approve <revision>] [--json]',
    'skills migrate moves a skill installed by an earlier Bowerloom (.bowerloom-skills) to .bowerloom/managed.',
    'skills.json must pin the same source first; migrate plan prints the skills add command if it does not.', '',
    'The other skills forms are listed by bowerloom help advanced.', '',
  ].join('\n'),
  up: [
    'Usage:', '  bowerloom up --team <name> [--goal <goal>] [--name <project-name>] [--allow-agent <role>:<hash>]... [--approve <revision>] [--json]', '',
    'Prepares this project for a team, one step at a time, and starts no workers.',
    'Each run looks at the project and shows the one next step:',
    '  init    when no folder above holds .bowerloom or bowerloom.json: sets up this folder. It needs --goal; the project name is the',
    '          folder name unless you pass --name, and <name> becomes the display name of first-team.',
    '  team    when <name> is neither first-team (its id or display name) nor a team you created: team create <name>.',
    '  sync    when .bowerloom/skills.json has skills of the team to install: skills sync --team <team>.',
    '  apply   when skills, prompts, or agents of the team need copies for Claude Code and Codex: apply.',
    'At the end it prints "prepared, workers held", points to .bowerloom/START-HERE.md, and exits 4. When a skill, prompt,',
    'agent, or team is held or gone, it prints "prepared, N items held" instead, with the next command for each item.',
    'In a terminal it asks before each step. Agents pass --approve <revision>: the step whose revision matches is',
    'applied, then the next plan is shown with its revision (exit 3). If the next plan then refuses, the refusal says',
    'that the step was applied.',
    'With --json, every line is one JSON document: an --approve run prints the result of the step it applied,',
    'then the next plan. Read stdout line by line.',
    'It never edits AGENTS.md or CLAUDE.md, and never runs claude, codex or any other program.',
    'bowerloom up --demo --pro|--5x|--20x --installation <private.json> still runs the demo session. See bowerloom help advanced.', '',
  ].join('\n'),
  apply: [
    'Usage:', '  bowerloom apply [--harness claude|codex|both] [--allow-agent <role>:<hash>]... [--frozen] [--max-github-requests <n>] [--approve <revision>] [--json]', '',
    'Puts the skills in .bowerloom/skills.json and the prompts in .bowerloom/prompts in place for Claude Code, Codex,',
    'or both (the default), from what this machine already holds.',
    'Skills go to .claude/skills and .agents/skills. A prompt becomes the Claude Code command .claude/commands/<name>.md',
    'and the Codex skill .agents/skills/prompt-<name>. An agent becomes .claude/agents/<role>.md. Codex agents are not projected in this beta. These copies stay on this machine.',
    'It never fetches: a pin that is not cached yet refuses, and bowerloom skills sync fetches it.',
    'It adds copies for the harness you choose and never removes one. A copy you changed is held, never overwritten.',
    'Agents come from .bowerloom/teams/<team>/agents/<role>.md. A file at the target that Bowerloom did not install is adopted when it equals the copy.',
    'If it differs, apply holds that agent. Move the file aside, then run bowerloom apply. A bad agent file holds only that agent.',
    'An agent that sets permissionMode bypassPermissions, hooks, or mcpServers is held until you read it and pass',
    '--allow-agent <role>:<hash>, where <hash> is the full sha256 of the agent file. It works only in a terminal and not with --json.',
    'Bowerloom asks you to type the role name. --allow-agent repeats, and it works with bowerloom up too. An edit to the file holds the agent again.',
    'A context slice in .bowerloom/slices/<name>.yaml becomes the skill .claude/skills/slice-<name>/SKILL.md, a list',
    'of paths. An agent whose skills list names slice-<name> loads it at start and reads the files where they are.',
    'Such an agent also gets a read guard in its copy. See bowerloom help context.',
    'It never edits AGENTS.md or CLAUDE.md: it prints a line you can add there yourself.',
    '--frozen installs only what bowerloom.lock.json records, as npm ci does. It refuses if the lock file and bowerloom.json',
    'disagree. It ignores your store. It fetches what this machine does not hold yet, from the hosts the plan names.',
    'Plain apply never fetches.',
    '--max-github-requests <n> lets one run make up to n GitHub requests, at most 5000. The default is 1000.',
    'It shows the plan first. Agents pass --approve <revision> or --json. It starts no workers and runs nothing.', '',
  ].join('\n'),
  context: [
    'Usage:',
    '  bowerloom slice create <name> [--root <folder>] [--registered <folder-name>] [--include <pattern>]... [--approve <revision>] [--json]',
    '  bowerloom context show <slice> [--json]',
    '  bowerloom context measure [--agent <role>]... [--team <team>] [--from <folder>] [--baseline <folder>] [--bytes-per-token <number>] [--user] [--json]',
    '  bowerloom context guard --agent <role> --explain <path> [--tool Read|Grep|Glob] [--slice <id>]...',
    '  bowerloom folder add <folder-name> <path> [--approve <revision>] [--json]',
    '  bowerloom folder allow <folder-name> [--approve <revision>] [--json]',
    '  bowerloom folder deny <folder-name> [--approve <revision>] [--json]',
    '  bowerloom folder list [--json]',
    '  bowerloom folder remove <folder-name> [--approve <revision>] [--json]', '',
    'A context slice selects files from one folder by path patterns, frontmatter, and links. slice create writes it to',
    '.bowerloom/slices/<name>.yaml and registers it. bowerloom apply turns it into the skill slice-<name>, a list of',
    'paths that an agent loads at start. The files stay where they are. Only their titles are copied.',
    'An agent loads a slice when the skills list in its file names slice-<name>.',
    '--root is the folder the patterns start from. The default is the project folder. --include adds a path pattern.',
    'The default is **/*.md. If .bowerloom/slices/<name>.yaml is already there and not registered, create registers it.',
    'context show prints the files a slice selects and the index skill that apply writes for it. It reads only.',
    'context measure compares what each agent loads at start with the same agent loaded with every .md file of the',
    'knowledge base. Bytes are exact. Tokens are an estimate, bytes divided by 4, unless you pass --bytes-per-token.',
    'It reads only and never uses the network. --from is the folder Claude Code starts in. --baseline is the folder of',
    'the full load. --user also counts your own CLAUDE.md, rules, and skills.',
    'context guard is the read guard that apply adds to an agent with slices. Claude Code runs it before each Read,',
    'Grep, and Glob of that agent, in a folder you trusted. It blocks a read under a slice\'s folder that no slice of the',
    'agent lists. It never allows what Claude Code would block. It does not check shell commands.',
    'With --explain it prints what the guard decides for one path.',
    'folder add registers a folder outside this project, such as a knowledge base, in your store. A slice then names it',
    'with root: { registered: <folder-name> } and --registered on slice create. Bowerloom reads it and never writes it.',
    'The folder must be yours, below your home folder, outside iCloud folders, and not writable by other users.',
    'folder allow, run in a project, lets that project read the folder after you approve a plan that names it. Every other project',
    'stays shut out until you allow it. folder deny takes the grant back. folder remove deletes the record and its grants only.',
    'The folder stays. A slice of a registered folder copies text from it into .claude/skills, so keep that folder out of git.',
    'The commands that change something show the plan first. Agents pass --approve <revision> or --json.', '',
  ].join('\n'),
  team: [
    'Usage:', '  bowerloom team create <name> [--profile engineer|founder|research] [--global] [--approve <revision>] [--json]',
    '  bowerloom team adopt <id> [--approve <revision>] [--json]', '',
    "Creates a team in .bowerloom/teams/<name>, from the project brief, with a lead, a maker and a reviewer.",
    'The name is the team id: lower-case words joined by hyphens, such as research-desk. first-team is taken by setup.',
    'The profile defaults to the one in the project brief.',
    '--global creates the team in your store, ~/.bowerloom, and not in this project. The store holds definitions only.',
    'A project picks store items with bowerloom use. The first --global write makes the store.',
    'With --global a team is built from a fixed store brief and the profile you choose. It does not read a project brief.',
    'team adopt copies a team from your store into this project, at .bowerloom/teams/<id>, and lists it in bowerloom.json as a project item.',
    'The project then owns the copy. Later changes in the store do not reach it. Edit the copy to fit the project.',
    'team adopt also changes bowerloom.json and bowerloom.lock.json.',
    'It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the files it makes.',
    'It writes inside .bowerloom only, or inside your store with --global, except for team adopt. It starts no workers and runs nothing.', '',
  ].join('\n'),
  skill: [
    'Usage:', '  bowerloom skill create <name> [--team <team>]... [--global] [--approve <revision>] [--json]', '',
    'Creates a skill of your own in .bowerloom/skills/<name>/SKILL.md, and lists it in .bowerloom/skills.json as a local skill.',
    'The name is the skill id, such as house-style. personal-assistant and ids that start with prompt- or slice- are reserved.',
    '--team limits the skill to a team that exists; without it, every team gets it.',
    '--global creates the skill in your store, ~/.bowerloom, and not in this project. The store holds definitions only.',
    'A project picks store items with bowerloom use. The first --global write makes the store.',
    'It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the file it makes.',
    'It writes inside .bowerloom only, or inside your store with --global. It starts no workers and runs nothing.',
    'To pin a skill from npm or GitHub instead, see bowerloom help skills.', '',
  ].join('\n'),
  prompt: [
    'Usage:', '  bowerloom prompt create <name> [--team <team>]... [--global] [--approve <revision>] [--json]', '',
    'Creates a reusable prompt in .bowerloom/prompts/<name>.md.',
    'When the file of a prompt you created is gone, the same command puts it back with the text it was created with.',
    'The name is the prompt id, such as weekly-update, at most 57 characters. An id that starts with slice- is reserved.',
    '--team limits the prompt to a team that exists; without it, every team gets it.',
    '--global creates the prompt in your store, ~/.bowerloom, and not in this project. The store holds definitions only.',
    'A project picks store items with bowerloom use. The first --global write makes the store.',
    'It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the file it makes.',
    'It writes inside .bowerloom only, or inside your store with --global. It starts no workers and runs nothing.', '',
  ].join('\n'),
};

/** The exit codes: 0 done, 1 refused, 2 usage, 3 approval required, 4 held by a gate, 130 stopped at a prompt. */
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 130;
type GateCode = 'APPROVAL_REQUIRED' | 'WORKERS_HELD';
const GATE_EXIT: Readonly<Record<GateCode, 3 | 4>> = { APPROVAL_REQUIRED: 3, WORKERS_HELD: 4 };

// The marker of an error a new command raised. Only newCommandRefusal adds to it, and membership is the object
// itself: a copy, a spread or a prototype child of a marked error is not marked. Existing plumbing (recipes, broker,
// controlled tests) raises APPROVAL_REQUIRED of its own; that never reaches exit 3 or the --approve hint.
const raisedByNewCommand = new WeakSet<object>();

/** The approval or gate refusal of a new command (0.7.0 and later). Only these errors exit 3 or 4. */
export function newCommandRefusal(code: GateCode, message: string): DefinitionError {
  if (!Object.hasOwn(GATE_EXIT, code)) throw new TypeError('newCommandRefusal takes APPROVAL_REQUIRED or WORKERS_HELD only.');
  const error = new DefinitionError(code, message);
  raisedByNewCommand.add(error); return error;
}
const marked = (error: unknown): error is DefinitionError => typeof error === 'object' && error !== null && raisedByNewCommand.has(error);

// Review finding 3: Ctrl-C or Ctrl-D at a "[y/N]" prompt. Membership is the error object itself, as above.
const stoppedAtPrompt = new WeakSet<object>();
/**
 * The stop of a person who pressed Ctrl-C or Ctrl-D at a prompt: exit 130, never the generic failure words.
 * `applied` names a step of the same run that was applied before the prompt, so the words stay true.
 */
export function promptStopped(applied?: string): DefinitionError {
  const error = new DefinitionError('APPROVAL_STOPPED', applied ? `Stopped. The ${applied} step was applied, and nothing else was changed.` : 'Stopped. Nothing was changed.');
  stoppedAtPrompt.add(error); return error;
}
export const isPromptStopped = (error: unknown): error is DefinitionError => typeof error === 'object' && error !== null && stoppedAtPrompt.has(error);
const codeOf = (error: unknown): string | null =>
  error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z_]{1,100}$/.test(error.code) ? error.code : null;

/**
 * The exit code for a command's outcome: `null` when it finished, else the error it raised.
 * USAGE is 2 for every command. 3 and 4 only for an error from newCommandRefusal; any other error, whatever its code, is 1.
 */
export function exitCodeFor(error: unknown): ExitCode {
  if (error === null) return 0;
  if (isPromptStopped(error)) return 130;
  const code = codeOf(error);
  if (code === 'USAGE') return 2;
  return marked(error) && Object.hasOwn(GATE_EXIT, error.code) ? GATE_EXIT[error.code as GateCode] : 1;
}

// Every control character (C0, DEL, C1), every format character (the bidi controls, zero-width characters, the byte
// order mark, tag characters), and the line and paragraph separators U+2028 and U+2029 (review M1F 2).
const CONTROLS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
const CONTROLS_BUT_NEWLINE = /(?!\n)[\p{Cc}\p{Cf}\u2028\u2029]/gu;
// Every UTF-16 unit of a match as `\\uXXXX`, so a character outside the basic plane (a tag character) keeps both halves.
const escapeUnits = (c: string): string => Array.from({ length: c.length }, (_, i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`).join('');
// DEL (review M3 finding 6), the C1 controls and the format characters (bidi controls, zero-width characters), plus the
// line and paragraph separators.
const JSON_HIDDEN = /[\u007f-\u009f\p{Cf}\u2028\u2029]/gu;
/**
 * The JSON output of a new command (0.7.0 and later): canonical JSON, with DEL, every C1 control, format character (bidi
 * and zero-width included), U+2028 and U+2029 written as a \uXXXX escape, so a terminal shows it as text. The parsed
 * value is the same. Plumbing commands keep their exact envelope and do not use this.
 */
export function newCommandJson(value: unknown): string {
  return `${canonicalJson(value).replace(JSON_HIDDEN, escapeUnits)}\n`;
}
/** As newCommandJson, with the keys in the order the value holds them (spec 09, 4.1: `cache list --json`). */
export function orderedJson(value: unknown): string {
  canonicalJson(value);
  return `${JSON.stringify(value).replace(JSON_HIDDEN, escapeUnits)}\n`;
}

/**
 * Text that is safe to print to a terminal: every C0, C1, DEL and bidi control becomes a visible `\uXXXX`, so a file
 * name or a message cannot move the cursor, recolour the screen or reorder a line. `multiline` keeps the newline.
 * For human output only. JSON output is never passed through here.
 */
export function plainText(value: string, multiline = false): string {
  return value.replace(multiline ? CONTROLS_BUT_NEWLINE : CONTROLS, escapeUnits);
}

// Review finding 5: a folder with no project starts with up, never with the init plumbing.
const INIT_NEXT = 'bowerloom up --team <name> --goal <goal>';
interface Words { readonly sentence: string; readonly next: string }
const REFUSALS: Readonly<Record<string, Words>> = {
  USAGE: { sentence: 'Nothing was changed.', next: 'bowerloom help' },
  APPROVAL_DECLINED: { sentence: 'Bowerloom applies a plan only when you answer y.', next: 'run the same command again to see the plan' },
  STALE_APPROVAL: { sentence: 'The plan changed after you saw it, so nothing was applied.', next: 'run the same command again, without --approve, to see the new plan' },
  PROJECT_NOT_FOUND: { sentence: 'Bowerloom looked in this folder and in every parent folder up to your home folder.', next: INIT_NEXT },
  PROJECT_ROOT_REFUSED: { sentence: 'A whole disk or home folder is too broad to be a project.', next: 'cd <project-folder>' },
  PROJECT_IN_CLOUD_FOLDER: { sentence: 'Cloud sync changes file times and moves files, which breaks the checks that keep a project safe.', next: 'mv <project-folder> ~/Projects/' },
  PROJECT_UNSAFE: { sentence: 'Bowerloom will not trust a .bowerloom folder that other people or links can change.', next: 'ls -ld .bowerloom' },
  PROJECT_FOLDER_UNSAFE: { sentence: 'Bowerloom will not trust a project folder that other people can change.', next: 'ls -ld .' },
  PROJECT_UNREADABLE: { sentence: 'A folder on the way to the project could not be read, so Bowerloom cannot tell which project holds this folder.', next: 'ls -ld <folder>' },
  PROJECT_LOCKED: { sentence: 'Two commands must not change one project at the same time, so nothing was changed.', next: 'bowerloom status' },
  PROJECT_LOCK_UNAVAILABLE: { sentence: 'The lock uses a local port, and this computer would not give it out.', next: 'bowerloom status' },
  PROJECT_LOCK_SLOT_COLLISION: { sentence: 'The lock uses a local port. Another program listens on it, or another Bowerloom command is too busy to answer.', next: 'lsof -nP -iTCP:<port> -sTCP:LISTEN' },
  STORE_NOT_FOUND: { sentence: 'The first --global create or skills add makes the store.', next: 'bowerloom skill create <name> --global' },
  STORE_INVALID: { sentence: 'If ~/.bowerloom holds no store.json that Bowerloom wrote, Bowerloom does not use it and never takes over the folder.', next: 'bowerloom store status' },
  STORE_UNSAFE: { sentence: 'Bowerloom will not trust a store that other people or links can change.', next: 'ls -ld ~/.bowerloom' },
  STORE_UNREADABLE: { sentence: 'A folder that cannot be read cannot be checked, so Bowerloom does not use it.', next: 'ls -ld ~ ~/.bowerloom' },
  STORE_IN_CLOUD_FOLDER: { sentence: 'Cloud sync changes file times and moves files, which breaks the checks that keep the store safe.', next: 'Move the home folder setup out of iCloud. The store must stay at ~/.bowerloom.' },
  STORE_STATE_NESTED: { sentence: 'Bowerloom keeps the cache outside the store, so a store inside the state folder, or the reverse, is refused.', next: 'Set XDG_STATE_HOME to a folder outside ~/.bowerloom.' },
  // Round 1 of the reviews of PR 101 (Hanna's choice C on #97): the words of the errors.md row, so the terminal and the docs agree.
  STORE_WRITE_FAILED: { sentence: 'Bowerloom failed to write to the store. The disk refused the write, and the message names the system error, such as ENOSPC.', next: 'df -h ~ && ls -ld ~/.bowerloom' },
  STORE_LOCKED: { sentence: 'Two commands must not change the store at the same time, so nothing was changed.', next: 'When the other command is done, run this one again.' },
  STORE_NOT_A_PROJECT: { sentence: 'The store holds definitions only, so a folder inside it cannot be a project.', next: 'Run the command in a project folder outside ~/.bowerloom.' },
  CONFIG_INVALID: { sentence: 'Bowerloom reads bowerloom.json strictly, so a hand edit can break it.', next: 'git diff bowerloom.json' },
  CONFIG_UNREADABLE: { sentence: 'A file that cannot be read cannot be checked, so Bowerloom does not use it.', next: 'ls -l bowerloom.json' },
  // Spec 06, section 5.
  STORE_ITEM_NOT_FOUND: { sentence: 'Bowerloom picks only items that your store defines.', next: 'bowerloom ls --global' },
  STORE_ITEM_MISSING: { sentence: 'A listed store item is not in your store and not in the lock, so Bowerloom cannot install it.', next: 'Create it with bowerloom <kind> create <id> --global, or run bowerloom unuse <kind> <id>.' },
  // Round 2 of the reviews of PR 101: each cause and each fault carries its own next step, which names the file or folder.
  // Round 3: the sentence holds in a project that is not shared too, and each cause carries its own next step.
  STORE_ITEM_NOT_SHAREABLE: { sentence: 'Each store item that a lock records must be fetchable by your team.', next: 'Each cause prints its own next step. bowerloom store status shows the git state of the store.' },
  STORE_REMOTE_PRIVATE: { sentence: 'GitHub does not show this repository without a token. It is private, or it does not exist.', next: 'Set BOWERLOOM_GITHUB_TOKEN to a GitHub token that can read the repository, or make the repository public.' },
  // Spec 07, section 5: the sentence is the fixed message, and the next step the table's.
  // Review R2 of PR 97 (option C): each sentence says why, instead of repeating the message.
  GITHUB_TOKEN_INVALID: { sentence: "Bowerloom checks the token's shape before any network call and never shows the value.", next: 'Set it to a token with letters, digits, _ or -, 20 to 255 characters.' },
  STORE_REMOTE_AUTH_FAILED: { sentence: 'GitHub answers the same way for a token that cannot read the repository and for a repository that does not exist.', next: 'Check that the token can read the repository, and that the repository name is right.' },
  // Review F1 of PR 97.
  GITHUB_TOKEN_SSO_REQUIRED: { sentence: 'An organization that uses single sign-on refuses a token until it is authorized for that organization.', next: "Authorize the token for the organization on GitHub, under the token's settings, then run the command again." },
  CONFIG_ITEM_SELECTED: { sentence: 'This project already picks that item from that source.', next: 'bowerloom ls' },
  // Spec 08, section 5. Review C2 of PR 98 (Hanna's choice C on #97): each sentence says why, and the next step is the table's.
  MIGRATE_ITEM_NOT_FOUND: { sentence: 'store migrate moves only items that this project defines in .bowerloom, with their files in place.', next: 'bowerloom ls' },
  MIGRATE_ITEM_UNSUPPORTED: { sentence: 'A store item holds only md, txt, json, yaml, yml, csv, and license files, within the size limits.', next: 'bowerloom help store' },
  MIGRATE_ID_EXISTS: { sentence: 'Bowerloom never overwrites a store item, so an item with the same id and other bytes cannot move.', next: 'Rename the project item, or remove the store item yourself.' },
  MIGRATE_RESERVED: { sentence: 'Setup made these items for this project, so they stay in it.', next: 'bowerloom store migrate --all skips them.' },
  MIGRATE_TEAM_MISSING: { sentence: 'The store keeps the team tag, so that team must be in the store.', next: 'Add --team <name> to move that team too.' },
  MIGRATE_LIMIT: { sentence: 'This beta keeps the store record small: 512 items and 1 MiB at most.', next: 'Remove items from the store, or move fewer items.' },
  // Spec 09, section 5, with review M4 of PR 99 (Hanna's choice C on #97): each sentence says why.
  CACHE_ENTRY_NOT_FOUND: { sentence: 'cache prune --entry deletes only an entry that cache list shows, so the text must start one of its ids.', next: 'bowerloom cache list' },
  CACHE_ENTRY_BUSY: { sentence: 'Bowerloom never deletes an entry while another command holds it. An owner lock older than a day does not count.', next: 'When the other command is done, run this one again.' },
  CACHE_PRUNE_FAILED: { sentence: 'Bowerloom deletes only private folders of this user, one at a time, and stops at the first one it cannot delete.', next: 'bowerloom cache list, then run the command again without --approve' },
  CONFIG_ITEM_NOT_SELECTED: { sentence: 'Bowerloom changes only items that bowerloom.json lists.', next: 'bowerloom ls' },
  CONFIG_ITEM_MISSING: { sentence: 'bowerloom.json lists a project item that the project does not define.', next: 'bowerloom <kind> create <id>, or bowerloom unuse <kind> <id>.' },
  CONFIG_WRITE_UNCONFIRMED: { sentence: 'bowerloom.json was written, but it changed again before Bowerloom read it back.', next: 'git diff bowerloom.json' },
  TEAM_NOT_SELECTED: { sentence: 'up installs only the teams that bowerloom.json lists.', next: 'bowerloom use team <id>, or add --project for a team this project defines' },
  LOCK_MISSING: { sentence: 'A frozen install needs bowerloom.lock.json, and there is none.', next: 'bowerloom lock update on a machine with the store.' },
  LOCK_INVALID: { sentence: 'Bowerloom reads the lock strictly, so a hand edit or a merge conflict can break it.', next: 'bowerloom lock verify. For a merge conflict, take one side for each item, then run it.' },
  LOCK_UNSAFE: { sentence: 'Bowerloom will not trust a lock file that links or other users can change.', next: 'ls -l bowerloom.lock.json' },
  LOCK_LIMIT: { sentence: 'This beta keeps the lock small: 128 skills, 128 prompts, 32 teams, and 4 MiB at most.', next: 'bowerloom lock verify' },
  LOCK_CONFIG_MISSING: { sentence: 'A lock and a config go together, and one of them is missing.', next: 'bowerloom use skill <id>, or restore bowerloom.json from version control.' },
  LOCK_CONFIG_MISMATCH: { sentence: 'A frozen install must match bowerloom.json exactly, as npm ci does.', next: 'bowerloom lock update' },
  LOCK_HASH_MISMATCH: { sentence: 'Bowerloom installs only bytes that match the lock, so it stopped before any change to the project.', next: 'bowerloom lock verify, then ask the owner of the store to run bowerloom lock update.' },
  LOCK_STORE_NOT_PUSHED: { sentence: 'A teammate can fetch only what you pushed, and your store differs from the pushed copy.', next: 'Commit and push the store, then run the command again.' },
  LOCK_COMMIT_UNREACHABLE: { sentence: 'The lock needs a commit that GitHub has, and GitHub does not have this one.', next: 'Push the store, or pass --commit <sha> of a pushed commit.' },
  LOCK_WRITE_UNCONFIRMED: { sentence: 'bowerloom.lock.json was written, but it changed again before Bowerloom read it back.', next: 'git diff bowerloom.lock.json' },
  GITHUB_REQUEST_FAILED: { sentence: 'GitHub answered with an error status, so Bowerloom stopped before any change to the project.', next: 'Run the command again later. If the status is 401 or 403, check that you can read the repository. For a private store repository, set BOWERLOOM_GITHUB_TOKEN.' },
  GITHUB_REQUEST_BUDGET: { sentence: 'A lock this large needs several runs or a smaller selection.', next: 'For apply, skills sync, and use, run it again with --max-github-requests <n>, up to 5000. For lock update, lock fewer items in one run with --item <kind>:<id>. For store migrate, move fewer items in one run.' },
  // Beta.3 docs review, fix 2.
  LOCK_COMMIT_GONE: { sentence: 'A force-push or a deleted branch removes a commit that a lock still names.', next: 'Ask the author of the store to run bowerloom lock update, then commit and push bowerloom.lock.json. Then pull the project.' },
  STORE_ITEM_GONE_AT_COMMIT: { sentence: 'The lock names a store commit that does not hold this item, so Bowerloom cannot install it.', next: 'bowerloom lock verify, then ask the owner of the store to run bowerloom lock update.' },
  GITHUB_RATE_LIMITED: { sentence: 'GitHub allows about 60 requests an hour without a token and about 5,000 with one. It also limits bursts of requests, and a 403 answer can say so.', next: 'Wait until the limit resets, at most an hour. Without a token, set BOWERLOOM_GITHUB_TOKEN to raise the limit (see bowerloom help store).' },
  ITEM_REVIEW_REQUIRED: { sentence: 'Bowerloom shows what an item can do before it installs it.', next: 'Run bowerloom apply --frozen again to review it.' },
  CONFIG_UNSAFE: { sentence: 'Bowerloom will not trust a bowerloom.json that other people or links can change.', next: 'ls -l bowerloom.json' },
  CONFIG_LIMIT: { sentence: 'This beta keeps bowerloom.json small: 128 skills, 128 prompts, and 32 teams at most.', next: 'bowerloom status' },
  CONFIG_DUPLICATE_ID: { sentence: 'Each item is listed once, from one source.', next: 'git diff bowerloom.json' },
  MANIFEST_NOT_FOUND: { sentence: 'There is nothing to check yet.', next: 'bowerloom skills add npm:<package>@<version>:<path>' },
  MANIFEST_INVALID: { sentence: 'Bowerloom reads skills.json strictly, so a hand edit can break it.', next: 'git diff .bowerloom/skills.json' },
  MANIFEST_UNSAFE: { sentence: 'Bowerloom will not trust a skills.json that other people or links can change.', next: 'ls -l .bowerloom/skills.json' },
  MANIFEST_WRITE_UNCONFIRMED: { sentence: 'skills.json was written, but it changed again before Bowerloom read it back.', next: 'Check skills.json, then run bowerloom skills check.' },
  MANIFEST_PIN_NOT_EXACT: { sentence: 'A pin that can move would install different files on different machines.', next: 'bowerloom help skills' },
  MANIFEST_LICENSE_UNSUPPORTED: { sentence: 'This beta installs MIT and Apache-2.0 skills only.', next: 'bowerloom help skills' },
  MANIFEST_DUPLICATE_ID: { sentence: 'Each skill needs its own id.', next: 'git diff .bowerloom/skills.json' },
  MANIFEST_LIMIT: { sentence: 'This beta keeps skills.json small: 128 skills and 1 MiB at most.', next: 'bowerloom skills check' },
  SKILLS_ADD_SPEC_INVALID: { sentence: 'The source names a package or repository, an exact pin, and the skill folder.', next: 'bowerloom help skills' },
  SKILLS_ADD_EXISTS: { sentence: 'skills.json already holds a skill with this id or this source.', next: 'To move that id to another version or commit, add --replace: bowerloom skills add <source> --id <id> --replace.' },
  SKILLS_ADD_SOURCE_CHANGED: { sentence: '--replace keeps the npm package or GitHub repository and moves only its version or commit.', next: 'Add the other source under a new id.' },
  SKILLS_ADD_REPLACE_MISSING: { sentence: 'There is no skill with this id to replace.', next: 'bowerloom skills check' },
  SKILLS_ADD_NOT_FOUND: { sentence: 'Check the package name, version, commit and folder.', next: 'bowerloom help skills' },
  SKILLS_ADD_SKILL_MISSING: { sentence: 'A skill folder holds a SKILL.md file at its top.', next: 'bowerloom help skills' },
  SKILLS_ADD_LICENSE_UNKNOWN: { sentence: 'This beta installs a skill only when its MIT or Apache-2.0 license is shipped with it.', next: 'bowerloom help skills' },
  SKILLS_ADD_FRONTMATTER: { sentence: 'Bowerloom installs a skill only when its frontmatter uses the keys it can check.', next: 'bowerloom help skills' },
  SKILLS_ADD_UNSAFE_CONTENT: { sentence: 'Skills here are text files only, and nothing in them is run.', next: 'bowerloom help skills' },
  SKILLS_ADD_NETWORK: { sentence: 'Nothing was changed.', next: 'run the same command again' },
  SKILLS_ADD_HOST_REFUSED: { sentence: 'Bowerloom asked no other host, and nothing was changed.', next: 'bowerloom help skills' },
  TEAM_NOT_FOUND: { sentence: 'A skill or prompt can be limited only to a team that exists.', next: 'bowerloom ls teams' },
  TEAM_EXISTS: { sentence: 'Each team needs its own id.', next: 'bowerloom ls teams' },
  TEAM_ID_RESERVED: { sentence: 'Setup made first-team, so a new team needs another id.', next: 'bowerloom team create <another-name>' },
  TEAM_NAME_TAKEN: { sentence: 'bowerloom up --team takes first-team by its id or its display name, so a new team needs another id.', next: 'bowerloom team create <another-name>' },
  TEAM_NAME_INVALID: { sentence: 'The id becomes a folder name, so it is kept plain.', next: 'bowerloom help team' },
  SKILL_EXISTS: { sentence: 'Each skill needs its own id.', next: 'bowerloom ls skills' },
  SKILL_NAME_RESERVED: { sentence: 'Bowerloom uses these ids itself.', next: 'bowerloom help skill' },
  SKILL_NAME_INVALID: { sentence: 'The id becomes a folder name, so it is kept plain.', next: 'bowerloom help skill' },
  PROMPT_EXISTS: { sentence: 'Each prompt needs its own id.', next: 'bowerloom ls prompts' },
  PROMPT_NAME_INVALID: { sentence: 'The id becomes a file name, so it is kept plain.', next: 'bowerloom help prompt' },
  PROJECT_BRIEF_INVALID: { sentence: 'A new team is built from the project brief that setup saved, and it cannot be read.', next: 'bowerloom status' },
  AUTHORING_PENDING: { sentence: 'Bowerloom finishes an interrupted create only when what it left matches its record exactly.', next: 'cat .bowerloom/authoring/pending.json' },
  AUTHORING_RECEIPT_INVALID: { sentence: 'Bowerloom reads its record of created items strictly, so a hand edit can break it.', next: 'git diff .bowerloom/authoring/receipt.json' },
  // Review L8 of PR 98.
  AUTHORING_DISK_FULL: { sentence: 'The disk has no room, so Bowerloom stopped before it wrote more.', next: 'df -h .' },
  AUTHORING_ACCESS_DENIED: { sentence: 'The system refused the write, so Bowerloom stopped before it wrote more.', next: 'ls -ld .bowerloom ~/.bowerloom' },
  AUTHORING_UNSAFE_PATH: { sentence: 'Bowerloom will not read or write through links, shared files or files others can change.', next: 'ls -la .bowerloom' },
  AUTHORING_UNREGISTERED: { sentence: 'Bowerloom keeps track only of what create made.', next: 'bowerloom status' },
  REVISION_PENDING: { sentence: 'Create waits until the revise is finished.', next: 'bowerloom help advanced' },
  AUTHORING_WRITE_INTERRUPTED: { sentence: 'Part of the item may be in place, and the next plan shows how it is finished or cleared.', next: 'run the same command again, without --approve, to see the new plan' },
  AUTHORING_ITEM_MISSING: { sentence: 'Bowerloom reports a created item that is gone, so it is not lost silently.', next: 'bowerloom status' },
  PROMPT_RESTORE_TEAMS: { sentence: 'A restore puts the prompt back as it was created, with the same teams.', next: 'bowerloom prompt create <name>' },
  PROMPT_RESTORE_UNAVAILABLE: { sentence: 'Create writes only the text it would write today, and the record names other text.', next: 'git restore .bowerloom/prompts' },
  APPLY_NAME_COLLISION: { sentence: 'Bowerloom never overwrites what it did not install, and two items cannot share one place.', next: 'bowerloom apply' },
  PROMPT_INVALID: { sentence: 'Bowerloom reads only plain prompt files you own.', next: 'ls -l .bowerloom/prompts' },
  AGENT_INVALID: { sentence: 'Bowerloom copies only agent files it can check.', next: 'bowerloom help apply' },
  AGENT_KEY_UNKNOWN: { sentence: 'Bowerloom accepts only the documented subagent keys.', next: 'bowerloom help apply' },
  AGENT_NAME_MISMATCH: { sentence: 'The name becomes the file name in .claude/agents.', next: 'bowerloom help apply' },
  AGENT_LIMIT: { sentence: 'This beta applies at most 128 agents.', next: 'bowerloom help apply' },
  APPLY_AGENT_DUPLICATE: { sentence: 'Each agent name goes to one file in .claude/agents.', next: 'bowerloom help apply' },
  APPLY_AGENTS_FOLDER_UNSAFE: { sentence: 'Bowerloom writes agents only into a real folder that only you can change.', next: 'ls -ld .claude .claude/agents' },
  AGENT_GRANT_REVIEW_REQUIRED: { sentence: 'Bypass permissions, hooks, and MCP servers change what Claude Code lets the agent do.', next: 'bowerloom apply --allow-agent <role>:<hash>' },
  AGENT_TEAM_UNREGISTERED: { sentence: 'Bowerloom applies agents only from teams it created or adopted.', next: 'bowerloom team create <name>' },
  AGENT_TARGET_OCCUPIED: { sentence: 'Bowerloom never overwrites what it did not install.', next: 'bowerloom apply' },
  SLICE_INVALID: { sentence: 'Bowerloom builds an index only from slice files it can check.', next: 'bowerloom help context' },
  SLICE_KEY_UNKNOWN: { sentence: 'Bowerloom accepts only the documented slice keys.', next: 'bowerloom help context' },
  SLICE_NAME_INVALID: { sentence: 'The id becomes a file name and a skill name, so it is kept plain.', next: 'bowerloom help context' },
  SLICE_EXISTS: { sentence: 'Each slice needs its own id and its own skill name.', next: 'bowerloom ls slices' },
  SLICE_LIMIT: { sentence: 'This beta applies at most 64 slices.', next: 'bowerloom ls slices' },
  SLICE_PATH_MISSING: { sentence: 'Bowerloom does not drop a named file without telling you.', next: 'bowerloom status' },
  SLICE_ROOT_MISSING: { sentence: 'A slice root must exist, and a registered folder must also be recorded in your store.', next: 'bowerloom help context' },
  SLICE_ROOT_UNSAFE: { sentence: 'Bowerloom reads only folders that you own and that no other user can change.', next: 'ls -ld <folder>' },
  SLICE_SOURCE_UNSAFE: { sentence: 'Bowerloom will not read through links or files that others can change.', next: 'ls -l <path>' },
  SLICE_EMPTY: { sentence: 'An empty index would give an agent nothing.', next: 'bowerloom context show <slice>' },
  SLICE_TOO_LARGE: { sentence: 'A slice index stays small so that an agent can load it at start.', next: 'bowerloom context show <slice>' },
  SLICE_TARGET_OCCUPIED: { sentence: 'Bowerloom never overwrites what it did not install.', next: 'bowerloom apply' },
  AGENT_GUARD_CONFLICT: { sentence: 'Bowerloom adds the guard only to hooks it can read as a map of lists.', next: 'bowerloom help context' },
  AGENT_GUARD_WORKTREE: { sentence: 'A worktree holds its own copies of every tracked file, outside the guarded folders.', next: 'bowerloom help context' },
  CONTEXT_SLICE_NOT_FOUND: { sentence: 'Only a registered slice can be shown.', next: 'bowerloom ls slices' },
  CONTEXT_AGENT_NOT_FOUND: { sentence: 'Bowerloom measures the agents in .bowerloom/teams/*/agents.', next: 'bowerloom ls teams' },
  CONTEXT_BASELINE_INVALID: { sentence: 'The baseline must be a folder you own.', next: 'bowerloom help context' },
  CONTEXT_MEASURE_LIMIT: { sentence: 'This beta measures at most 100000 entries.', next: 'bowerloom context measure --baseline <narrower-folder>' },
  GUARD_OUTSIDE_SLICE: { sentence: 'A slice lists the files an agent reads under its folder.', next: 'bowerloom context show <slice>' },
  // Round 3 of the reviews of PR 101: plain words for what the guard does.
  GUARD_SLICE_NOT_INSTALLED: { sentence: 'The guard blocks every call when it cannot read a slice.', next: 'bowerloom apply' },
  GUARD_ROOT_MISSING: { sentence: 'The guard blocks every call when the folder of a slice is gone.', next: 'bowerloom apply' },
  GUARD_PROJECT_MISMATCH: { sentence: 'A guarded copy works only in the project folder that apply wrote it for.', next: 'bowerloom apply' },
  GUARD_INPUT_INVALID: { sentence: 'The guard blocks a call it cannot check.', next: 'claude --debug' },
  GUARD_INTERNAL_ERROR: { sentence: 'The guard blocks a call when it meets an error it cannot explain, such as a folder it is not allowed to read.', next: 'claude --debug' },
  FOLDER_NAME_INVALID: { sentence: 'The name becomes a file name in your store.', next: 'bowerloom help context' },
  FOLDER_EXISTS: { sentence: 'Each registered folder needs its own name.', next: 'bowerloom folder list' },
  FOLDER_NOT_FOUND: { sentence: 'Only a registered folder can be used or removed.', next: 'bowerloom folder list' },
  FOLDER_UNSAFE: { sentence: 'Bowerloom reads only folders that you own and that no other user can change.', next: 'ls -ld <folder>' },
  FOLDER_IN_CLOUD: { sentence: 'Cloud sync changes file times and moves files, which breaks the checks that keep a folder safe.', next: 'mv <folder> ~/Projects/' },
  FOLDER_NOT_ALLOWED: { sentence: 'A registered folder is shared with the projects you allow, one by one.', next: 'bowerloom folder allow <folder-name>' },
  FOLDER_INVALID: { sentence: 'Bowerloom reads folder records strictly, so a hand edit can break one.', next: 'bowerloom folder list' },
  // Round 2 of the reviews of PR 101: true for every raise site. A network failure carries its own next step.
  // Round 3: each raise site carries the next step of its cause, so this one prints only for an error that carries none.
  SKILLS_OFFLINE: { sentence: 'A pin or a lock item needs a fetch, and this run did not fetch it. The message says why.', next: 'After --offline, run the command again without --offline. After plain apply, run bowerloom skills sync, or bowerloom apply --frozen.' },
  SKILLS_SYNC_CONTENT_MISMATCH: { sentence: 'Bowerloom installs only bytes that match skills.json exactly, so it stopped before any change to the project.', next: 'bowerloom skills check' },
  SKILLS_SYNC_INTERRUPTED: { sentence: 'Every skill it finished is complete, and the rest are untouched.', next: 'bowerloom skills sync' },
  SKILLS_SYNC_LIMIT: { sentence: 'This beta syncs at most 256 skills at once.', next: 'bowerloom skills check' },
  SKILLS_CACHE_RECOVERY_REQUIRED: { sentence: 'The private cache needs a look before this pin can be read.', next: 'bowerloom help advanced' },
  SKILLS_PROJECT_UNSAFE: { sentence: 'Bowerloom writes copies only under folders that no other user can change. A shared folder such as /tmp is refused.', next: 'move the project into your home folder, then run the command again' },
  SKILLS_STATE_UNSAFE: { sentence: 'Bowerloom keeps receipts and the cache in a private folder that only you can change, outside the project.', next: 'check the private state folder: $XDG_STATE_HOME/bowerloom when XDG_STATE_HOME is set, else ~/.local/state/bowerloom' },
  SKILLS_STATE_STRAY_ENTRY: { sentence: 'Bowerloom keeps only its own operation folders there, and changes nothing it did not make.', next: 'move the named entry out of the private state folder with mv' },
  SKILLS_RECOVER_NOTHING: { sentence: 'Nothing of this item is unfinished.', next: 'bowerloom status' },
  SKILLS_MIGRATE_NOTHING: { sentence: 'The project has no .bowerloom-skills folder.', next: 'bowerloom skills sync' },
  SKILLS_MIGRATE_STATE_INVALID: { sentence: 'Migrate needs the private state folder the earlier install was made with.', next: 'bowerloom help skills' },
  SKILLS_MIGRATE_NOT_IN_MANIFEST: { sentence: 'skills.json must pin the installed skill before it can be migrated.', next: 'bowerloom skills check' },
  MANAGED_SKILL_LEGACY_PRESENT: { sentence: 'Skills from an earlier Bowerloom must be migrated before sync can manage this project.', next: 'bowerloom skills migrate plan --state <earlier-state-folder>' },
  MANAGED_SKILL_RECOVERY_REQUIRED: { sentence: 'A change was interrupted inside one skill, and Bowerloom changes nothing else until it is recovered.', next: 'bowerloom skills recover plan --item <id>' },
  MANAGED_SKILL_LOCAL_DRIFT: { sentence: 'Bowerloom never overwrites a copy you changed.', next: 'bowerloom skills sync' },
  MANAGED_SKILL_PATH_OCCUPIED: { sentence: 'Something Bowerloom did not install is where a copy goes.', next: 'bowerloom skills sync' },
  MANAGED_SKILL_HISTORY_FULL: { sentence: 'Bowerloom deletes no history by itself.', next: 'bowerloom skills sync' },
  // Review finding 14: the managed codes that pass through from managed-skills.
  MANAGED_SKILL_STALE_APPROVAL: { sentence: 'A copy changed after you approved the plan, so Bowerloom stopped before that copy.', next: 'run the same command again, without --approve, to see the new plan' },
  MANAGED_SKILL_LOCKED: { sentence: 'Two commands must not change one project at the same time.', next: 'run the same command again when the other command is done' },
  MANAGED_SKILL_LOCK_NOT_HELD: { sentence: 'Bowerloom stops when it cannot show that it still holds the project lock.', next: 'bowerloom status' },
  MANAGED_SKILL_LOCK_SLOT_COLLISION: { sentence: 'The lock uses a local port. Another program listens on it, or another Bowerloom command is too busy to answer.', next: 'lsof -nP -iTCP:<port> -sTCP:LISTEN' },
  MANAGED_SKILL_ABORTED: { sentence: 'The change stopped before it finished. Status shows any item that needs recovery.', next: 'bowerloom status' },
  MANAGED_SKILL_TIMEOUT: { sentence: 'A step ran past its time limit, so Bowerloom stopped it. Status shows any item that needs recovery.', next: 'bowerloom status' },
  MANAGED_SKILL_REFUSED: { sentence: 'A safety check of the copies failed, so Bowerloom changed nothing more.', next: 'bowerloom status' },
};
// Only for an error a new command raised (newCommandRefusal).
const GATE_REFUSALS: Readonly<Record<GateCode, Words>> = {
  APPROVAL_REQUIRED: { sentence: 'This change needs your approval before it is applied.', next: 'run the same command again with --approve <revision>' },
  WORKERS_HELD: { sentence: 'The project is prepared. No worker was started.', next: 'bowerloom status' },
};
// APPROVAL_REQUIRED from existing plumbing. Those commands take no --approve <revision>, so the words never name it.
const PLUMBING_APPROVAL: Words = { sentence: 'This command needs a current approval for the exact action before it runs.', next: 'bowerloom help advanced' };
const GENERIC: Words = { sentence: 'Nothing more is known about this refusal beyond its code.', next: 'bowerloom help' };

/** What a refusal carries besides its code and message. */
export interface RefusalDetail {
  /** The local port of a lock slot collision, when the error names one. */
  readonly port?: number;
  /** True only for an error from newCommandRefusal. */
  readonly raisedByNewCommand?: boolean;
  /** A fixed hint name the error carries, for words that are more exact than its code alone. */
  readonly hint?: typeof LEFTOVER_TEMP_LINK | typeof STORE_LIMIT | typeof PARTIAL;
  /** Review C5: the error's own next step, which replaces the generic one of its code. */
  readonly next?: string;
}
/** The hint of a MANIFEST_UNSAFE whose second link is a leftover `.skills.json.*.tmp` (skill-manifest/src/add.ts). */
const LEFTOVER_TEMP_LINK = 'skills-json-temp-link';
/** The hint of a MANIFEST_LIMIT for the store skills.json (skill-manifest/src/refusal.ts). */
const STORE_LIMIT = 'store-limit';
/** The hint of a refusal after a partial write (packages/project-sync/src/refusal.ts, `partialRefusal`). Its `next` is the command that finishes the run. */
const PARTIAL = 'partial';
const validPort = (port: unknown): port is number => Number.isInteger(port) && (port as number) >= 1 && (port as number) <= 65535;

function wordsFor(code: string, detail: RefusalDetail): Words {
  // Second security review of PR 98, M1: a partial refusal never says that nothing was applied.
  if (detail.hint === PARTIAL && typeof detail.next === 'string' && detail.next.length > 0) return { sentence: 'The run stopped part way; the message lists what was written.', next: detail.next };
  if (typeof detail.next === 'string' && detail.next.length > 0 && Object.hasOwn(REFUSALS, code)) return { sentence: REFUSALS[code]!.sentence, next: detail.next };
  if (Object.hasOwn(GATE_REFUSALS, code)) return detail.raisedByNewCommand === true ? GATE_REFUSALS[code as GateCode] : code === 'APPROVAL_REQUIRED' ? PLUMBING_APPROVAL : GENERIC;
  if (code === 'MANIFEST_LIMIT' && detail.hint === STORE_LIMIT) return { sentence: 'This beta keeps the store skills.json small: 256 skills and 4 MiB at most.', next: 'bowerloom skills check --global' };
  if (code === 'MANIFEST_UNSAFE' && detail.hint === LEFTOVER_TEMP_LINK) {
    return { sentence: 'An interrupted write left a second link to skills.json, the temporary file .bowerloom/.skills.json.*.tmp. Check that both name the same file, then remove the temporary one.', next: 'ls -li .bowerloom/skills.json .bowerloom/.skills.json.*.tmp' };
  }
  if ((code === 'PROJECT_LOCK_SLOT_COLLISION' || code === 'MANAGED_SKILL_LOCK_SLOT_COLLISION') && validPort(detail.port)) {
    return { sentence: `The lock uses local port ${detail.port}. Another program listens on it, or another Bowerloom command is too busy to answer.`, next: `lsof -nP -iTCP:${detail.port} -sTCP:LISTEN` };
  }
  return Object.hasOwn(REFUSALS, code) ? REFUSALS[code]! : GENERIC;
}

/** One refusal in plain words. The fixed refusal code stays visible. Control characters in the code or message are escaped. */
export function renderRefusal(code: string, message: string, detail: RefusalDetail = {}): string {
  const { sentence, next } = wordsFor(code, detail);
  return `Refused (${plainText(code)}): ${plainText(message)}\n${sentence}\nNext: ${next}\n`;
}

/**
 * What to print on stderr and which exit code to use. A terminal gets plain words. Anything else gets today's
 * JSON envelope, byte for byte, which agents parse. Never exit 0.
 */
export function reportFailure(error: unknown, tty: boolean): { text: string; exitCode: Exclude<ExitCode, 0> } {
  // Review finding 3: a stop at a prompt is not a failure. A terminal gets one plain line.
  if (isPromptStopped(error)) return { text: tty ? `${plainText(error.message)}\n` : `${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`, exitCode: 130 };
  // Review finding 4: in a terminal, workers held is the successful end of up, already printed on stdout.
  // Agents keep the JSON envelope on a pipe.
  if (tty && marked(error) && error.code === 'WORKERS_HELD') return { text: '', exitCode: 4 };
  const code = codeOf(error) ?? 'IO_ERROR';
  const safe = error instanceof DefinitionError ? error : new DefinitionError(code, 'The command failed. Review the relevant local files and operation records before another action. This error supplies no registered-work stop result.');
  const port = error instanceof DefinitionError && 'port' in error ? (error as { port?: unknown }).port : undefined;
  const hint = error instanceof DefinitionError && 'hint' in error ? (error as { hint?: unknown }).hint : undefined;
  const next = error instanceof DefinitionError && 'next' in error && typeof (error as { next?: unknown }).next === 'string' ? (error as { next: string }).next : undefined;
  // Round 5 of the reviews of PR 99, L-1: a fix is the bare command of a refusal, in its own JSON field.
  const fix = error instanceof DefinitionError && 'fix' in error && typeof (error as { fix?: unknown }).fix === 'string' ? (error as { fix: string }).fix : undefined;
  const detail: RefusalDetail = { raisedByNewCommand: marked(error), ...(validPort(port) ? { port } : {}), ...(hint === LEFTOVER_TEMP_LINK || hint === STORE_LIMIT || hint === PARTIAL ? { hint } : {}), ...(next !== undefined ? { next } : {}) };
  const exitCode = exitCodeFor(marked(error) ? error : safe) as Exclude<ExitCode, 0>;
  // An error that carries its own next step gives it to agents too, as `next`; every other envelope is unchanged.
  return { text: tty ? renderRefusal(safe.code, safe.message, detail) : `${JSON.stringify({ error: { code: safe.code, message: safe.message, ...(next !== undefined ? { next } : {}), ...(fix !== undefined ? { fix } : {}), ...(hint === PARTIAL ? { partial: true } : {}) } })}\n`, exitCode };
}

/** A path as one shell word: plain characters stay, anything else is single-quoted. */
export const shellWord = (path: string): string => /^[A-Za-z0-9_/.:@%+=,-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
