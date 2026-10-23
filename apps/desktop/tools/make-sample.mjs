// Builds apps/desktop/sample-data/ with the real Bowerloom commands, in a throw-away world. Developers run it by hand
// (`npm run sample:make`, after `npm run build` at the repository root). The app never runs it: it only copies the result.
// Machine-dependent files are left out and the app writes them when it copies the sample: the store's .git files, each
// project's .git/config, and the folder grants (a project id and a folder birth time depend on where a folder sits).
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const cli = join(root, 'dist/apps/cli/src/main.js');
const out = join(here, '..', 'sample-data');
if (!existsSync(cli)) throw new Error('Run `npm run build` at the repository root first.');
const { buildFakeRepo } = await import(pathToFileURL(join(root, 'dist/tests/support/fake-github-repo.js')).href);
const { npmPackage } = await import(pathToFileURL(join(root, 'dist/tests/support/sync-packages.js')).href);

const base = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-sample-')));
const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 });
const store = join(home, '.bowerloom');
const COMMIT = '5a3c9e1d7b2f4860a1c3e5d7f9b1a3c5e7d90b24';
const env = { PATH: process.env.PATH, HOME: home, XDG_STATE_HOME: join(base, 'state') };
const run = (cwd, args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
function approve(cwd, args, extra = {}) {
  const planned = run(cwd, [...args, '--json'], extra);
  if (planned.status !== 3) throw new Error(`plan ${args.join(' ')}: ${planned.status} ${planned.stderr}${planned.stdout.slice(0, 300)}`);
  const applied = run(cwd, [...args, '--approve', JSON.parse(planned.stdout).revision], extra);
  if (applied.status !== 0) throw new Error(`apply ${args.join(' ')}: ${applied.stderr}${applied.stdout.slice(0, 300)}`);
}
const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const config = (skills = []) => `${JSON.stringify({ format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills, prompts: [], teams: [] }, null, 2)}\n`;

// The store: yours (local), and one skill pinned to npm.
approve(home, ['team', 'create', 'research-desk', '--global', '--profile', 'research']);
approve(home, ['team', 'create', 'launch-crew', '--global', '--profile', 'engineer']);
approve(home, ['skill', 'create', 'house-style', '--global']);
approve(home, ['skill', 'create', 'meeting-notes', '--team', 'research-desk', '--global']);
approve(home, ['skill', 'create', 'weekly-digest', '--global']);
approve(home, ['prompt', 'create', 'weekly-update', '--global']);
approve(home, ['prompt', 'create', 'launch-checklist', '--team', 'launch-crew', '--global']);
put(join(store, 'skills/house-style/SKILL.md'), '---\nname: house-style\ndescription: Keep every document in the studio voice. Plain, warm and short.\n---\n\n# House style\n\nWrite in short sentences. Use the words our clients use.\nName the next step at the end of every message.\n');
put(join(store, 'prompts/weekly-update.md'), '# Weekly update\n\nWrite a five-line update for the client.\n\n1. What we finished this week.\n2. What we start next week.\n3. Anything that needs the client to decide.\n');
// Editing files by hand changes their hashes in the authoring record; the creating commands are the only writers, so this is left as created.
const pkg = npmPackage('brand-voice', '1.2.0');
const manifestPath = join(store, 'skills.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.skills.push(pkg.entry);
manifest.skills.sort((a, b) => (a.id < b.id ? -1 : 1));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// A registered folder (a knowledge base) outside any project. Each note is long enough that reading all of them costs far more than reading a short index.
const FILLER = Array.from({ length: 6 }, (_, i) => `Section ${i + 1}. Our studio keeps notes short and specific. Each note says who it is for, what to do, and who decides. When something changes, we change the note first and tell the team second. This paragraph stands in for the longer text a real knowledge folder would hold.`).join('\n\n');
for (const [name, text] of [['brand-rules.md', '# Brand rules\n\nThe logo sits top left. Use two colors.\n'], ['clients.md', '# Clients\n\nA list of who we work with and what they asked for.\n'], ['pricing-notes.md', '# Pricing notes\n\nRates are reviewed each January.\n'], ['process/onboarding.md', '# Onboarding\n\nFive steps to start with a new client.\n']]) put(join(home, 'Notes/team-notes', name), `${text}\n${FILLER}`);
put(join(home, 'Notes/client-archive/2024-projects.md'), '# 2024 projects\n\nThe finished work from last year.\n');
for (const [name, text] of [['studio-brief.md', '---\ntitle: Studio site brief\n---\n# Brief\n\nThe goals for the new site.\n'], ['launch-brief.md', '---\ntitle: Launch plan\n---\n# Launch\n\nDates and owners.\n']]) put(join(home, 'Notes/project-briefs', name), `${text}\n${FILLER}`);
mkdirSync(join(home, 'Notes/meeting-archive'), { recursive: true }); put(join(home, 'Notes/meeting-archive/README.md'), '# Meeting archive\n');
put(join(home, 'Notes/old-reports/2023-report.md'), '# 2023 report\n\nWhat we delivered in 2023.\n');
chmodSync(join(home, 'Notes'), 0o755);
const projects = join(home, 'Projects'); mkdirSync(projects, { mode: 0o755 });
const mk = name => { const dir = join(projects, name); mkdirSync(dir, { mode: 0o755 }); return dir; };
const share = dir => put(join(dir, '.git/config'), '[remote "origin"]\n\turl = https://github.com/sample-co/studio-site.git\n');

// The fake copy of the store that a lock records. Its commit is fixed so the app can recreate the same git files.
function lockEnv(files, planPath) {
  const dir = mkdtempSync(join(base, 'repo-'));
  const repo = buildFakeRepo('sample-co', 'shared-store', files, COMMIT, dir);
  const git = join(store, '.git'); rmSync(git, { recursive: true, force: true });
  put(join(git, 'config'), '[remote "origin"]\n\turl = git@github.com:sample-co/shared-store.git\n'); put(join(git, 'HEAD'), 'ref: refs/heads/main\n');
  put(join(git, 'refs/remotes/origin/main'), `${COMMIT}\n`); put(join(git, 'refs/heads/main'), `${COMMIT}\n`);
  const log = join(base, 'net.log'); put(log, ''); put(planPath, JSON.stringify({ log, routes: repo.routes }));
  return { TEST_FAKE_NETWORK_PLAN: planPath };
}
const storeFiles = () => { const o = {}; const walk = rel => { for (const n of readdirSync(join(store, rel)).sort()) { if (n === '.git') continue; const r = rel ? `${rel}/${n}` : n; if (statSync(join(store, r)).isDirectory()) walk(r); else o[r] = readFileSync(join(store, r), 'utf8'); } }; walk(''); return o; };
const NET = ['--import', pathToFileURL(join(root, 'dist/tests/support/fake-network.js')).href];
const runNet = (cwd, args, extra) => spawnSync(process.execPath, [...NET, cli, ...args], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
function approveNet(cwd, args, extra) {
  const planned = runNet(cwd, [...args, '--json'], extra);
  if (planned.status !== 3) throw new Error(`plan ${args.join(' ')}: ${planned.status} ${planned.stderr}${planned.stdout.slice(0, 300)}`);
  const applied = runNet(cwd, [...args, '--approve', JSON.parse(planned.stdout).revision], extra);
  if (applied.status !== 0) throw new Error(`apply ${args.join(' ')}: ${applied.stderr}${applied.stdout.slice(0, 300)}`);
}

// 1. A healthy project.
const healthy = mk('studio-site'); put(join(healthy, 'bowerloom.json'), config()); share(healthy);
const netEnv = lockEnv(storeFiles(), join(base, 'plan-1.json'));
for (const args of [['use', 'team', 'research-desk'], ['use', 'skill', 'house-style'], ['use', 'prompt', 'weekly-update']]) approveNet(healthy, args, netEnv);
approve(healthy, ['folder', 'add', 'team-notes', join(home, 'Notes/team-notes')]);
approve(healthy, ['folder', 'add', 'client-archive', join(home, 'Notes/client-archive')]);
approve(healthy, ['folder', 'add', 'project-briefs', join(home, 'Notes/project-briefs')]);
approve(healthy, ['folder', 'add', 'old-reports', join(home, 'Notes/old-reports')]);
approve(healthy, ['folder', 'add', 'meeting-archive', join(home, 'Notes/meeting-archive')]);
approve(healthy, ['slice', 'create', 'team-notes', '--registered', 'team-notes', '--include', '**/*.md']);
approve(healthy, ['slice', 'create', 'brief-titles', '--registered', 'project-briefs', '--include', '**/*.md']);
const briefFile = join(healthy, '.bowerloom/slices/brief-titles.yaml');
writeFileSync(briefFile, readFileSync(briefFile, 'utf8').replace(/^summary: .*$/m, 'summary: frontmatter:title'));

// 2. A drifted project: its lock was made, then the store changed, and it names a store item that is gone.
const drifted = mk('newsletter'); put(join(drifted, 'bowerloom.json'), config()); share(drifted);
for (const args of [['use', 'skill', 'weekly-digest'], ['use', 'skill', 'brand-voice'], ['use', 'prompt', 'launch-checklist']]) approveNet(drifted, args, netEnv);
approve(drifted, ['team', 'create', 'newsroom', '--profile', 'research']);
put(join(drifted, '.bowerloom/teams/newsroom/agents/editor.md'), '---\nname: editor\ndescription: Reads the team notes and edits drafts in the studio voice.\ntools: Read, Grep, Glob\nskills:\n  - slice-team-notes\n---\n\nYou edit drafts. Read the notes first. Never change facts.\n');
put(join(drifted, '.bowerloom/teams/newsroom/agents/publisher.md'), '---\nname: publisher\ndescription: Publishes approved issues to the mailing list.\npermissionMode: bypassPermissions\n---\n\nYou publish issues that the editor has approved.\n');
approve(drifted, ['slice', 'create', 'team-notes', '--registered', 'team-notes', '--include', '**/*.md']);
// Two more reading lists: one on a folder this project may not read yet, and one that wants each file's title.
approve(drifted, ['slice', 'create', 'client-history', '--registered', 'client-archive', '--include', '**/*.md']);
approve(drifted, ['slice', 'create', 'meeting-archive-all', '--registered', 'meeting-archive', '--include', '**/*.md']);
approve(drifted, ['slice', 'create', 'old-reports-list', '--registered', 'old-reports', '--include', '**/*.md']);
approve(drifted, ['slice', 'create', 'team-titles', '--registered', 'team-notes', '--include', '**/*.md']);
const titlesFile = join(drifted, '.bowerloom/slices/team-titles.yaml');
writeFileSync(titlesFile, readFileSync(titlesFile, 'utf8').replace(/^summary: .*$/m, 'summary: frontmatter:title'));
put(join(store, 'prompts/launch-checklist.md'), '# Launch checklist\n\nThis text changed after the lock was written.\n');
const driftConfig = JSON.parse(readFileSync(join(drifted, 'bowerloom.json'), 'utf8'));
driftConfig.skills.push({ id: 'old-rules', source: 'store' });
driftConfig.skills.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
put(join(drifted, 'bowerloom.json'), `${JSON.stringify(driftConfig, null, 2)}\n`);

// 3. A project whose lock cannot be read.
const broken = mk('old-archive'); put(join(broken, 'bowerloom.json'), config()); share(broken);
approveNet(broken, ['use', 'skill', 'house-style'], netEnv);
put(join(broken, 'bowerloom.lock.json'), '<<<<<<< HEAD\n{"format": "bowerloom/lock/v1beta1"\n');

// Copy the authored files only.
rmSync(out, { recursive: true, force: true });
cpSync(home, join(out, 'home'), { recursive: true, filter: src => !/(^|\/)(\.git|\.claude|\.codex|\.local|meeting-archive)(\/|$)/.test(src.slice(home.length)) || /\.bowerloom\/folders\//.test(src) });
writeFileSync(join(out, 'sample.json'), `${JSON.stringify({ storeCommit: COMMIT, storeRemote: 'git@github.com:sample-co/shared-store.git', projectRemote: 'https://github.com/sample-co/studio-site.git', projects: ['studio-site', 'newsletter', 'old-archive'], grants: [{ folder: 'team-notes', project: 'studio-site', summary: 'heading' }, { folder: 'team-notes', project: 'newsletter', summary: 'heading' }, { folder: 'project-briefs', project: 'studio-site', summary: 'frontmatter:title' }, { folder: 'old-reports', project: 'newsletter', summary: null }, { folder: 'meeting-archive', project: 'newsletter', summary: 'heading' }], generated: [{ folder: 'Notes/meeting-archive', files: 1100 }] }, null, 2)}\n`);
rmSync(base, { recursive: true, force: true });
console.log(`Sample data written to ${out}`);
