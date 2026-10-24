#!/usr/bin/env node
// Makes, or resets, the sandbox: a folder of invented content beside the real Sage Advice folder, with its own pretend home folder and
// shared library. Run as `npm run desktop:sandbox` (make if missing) or `npm run sandbox:reset` (delete and make again).
//
//   node tools/make-sandbox.mjs            make the sandbox if it is missing; leave it alone if it is there
//   node tools/make-sandbox.mjs --reset    delete it (only if it is exactly the sandbox, carries the mark, and holds no link that leads outside) and make it again
//
// The folder is the one constant in main/boundary.ts. For tests only, BOWERLOOM_VIEWER_SANDBOX names another folder with "Sandbox" in its
// name. Every file this script writes itself goes through the write boundary. The rest is written by Bowerloom's own commands, run with
// the sandbox's pretend home, in folders inside the sandbox.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');
const repo = join(desktop, '..', '..');

// The safety code is TypeScript in the app. Bundle it to a temporary file and use the very same code here.
const scratch = mkdtempSync(join(tmpdir(), 'bowerloom-make-sandbox-'));
await build({ entryPoints: [join(desktop, 'main', 'sandbox.ts')], outfile: join(scratch, 'sandbox.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'error' });
const lib = await import(pathToFileURL(join(scratch, 'sandbox.mjs')).href);
const { SANDBOX_DIR, ensureSandbox, deleteSandbox, sandboxPaths, sandboxExists, writeSandboxFile, assertWritable } = lib;
process.on('exit', () => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* temporary */ } });

const reset = process.argv.includes('--reset');
const unknown = process.argv.slice(2).filter(a => a !== '--reset');
if (unknown.length) { console.error(`I do not know ${unknown.join(', ')}. Use --reset to delete the sandbox and make it again.`); process.exit(2); }

if (reset && sandboxExists(SANDBOX_DIR)) { deleteSandbox(); console.log('The old sandbox was deleted.'); }
else if (reset) console.log('There was no sandbox to delete.');
else if (sandboxExists(SANDBOX_DIR)) { console.log(`The sandbox is already there: ${SANDBOX_DIR}`); process.exit(0); }

ensureSandbox();
const P = sandboxPaths(SANDBOX_DIR);
console.log(`Making the sandbox in ${SANDBOX_DIR} ...`);

// ---- the pieces ----------------------------------------------------------------------------------------------------------------------
const cli = join(repo, 'dist', 'apps', 'cli', 'src', 'main.js');
if (!existsSync(cli)) {
  console.log('Building Bowerloom first (once)...');
  const npm = process.env.npm_execpath && /npm-cli\.js$/.test(process.env.npm_execpath) ? [process.execPath, [process.env.npm_execpath]] : [process.execPath, [join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]];
  const r = spawnSync(npm[0], [...npm[1], 'run', 'build'], { cwd: repo, stdio: 'inherit' });
  if (r.status !== 0) { console.error('Bowerloom could not be built.'); process.exit(1); }
}
const { buildFakeRepo } = await import(pathToFileURL(join(repo, 'dist/tests/support/fake-github-repo.js')).href);
const { npmPackage } = await import(pathToFileURL(join(repo, 'dist/tests/support/sync-packages.js')).href);

const COMMIT = '7b1d4f2a9c3e5068b1a7d9e2f4c6a8b0d3e5f712';
const baseEnv = { PATH: process.env.PATH, HOME: P.home, XDG_STATE_HOME: P.state };
const inSandbox = path => { assertWritable(join(path, '.bowerloom-write-check')); return path; };
const run = (cwd, args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: inSandbox(cwd), env: { ...baseEnv, ...extra }, encoding: 'utf8' });
function approve(cwd, args, extra = {}) {
  const planned = run(cwd, [...args, '--json'], extra);
  if (planned.status !== 3) throw new Error(`plan ${args.join(' ')}: ${planned.status} ${planned.stderr}${planned.stdout.slice(0, 300)}`);
  const applied = run(cwd, [...args, '--approve', JSON.parse(planned.stdout).revision], extra);
  if (applied.status !== 0 && applied.status !== 4) throw new Error(`apply ${args.join(' ')}: ${applied.status} ${applied.stderr}${applied.stdout.slice(0, 300)}`);
}
const NET = ['--import', pathToFileURL(join(repo, 'dist/tests/support/fake-network.js')).href];
const runNet = (cwd, args, extra) => spawnSync(process.execPath, [...NET, cli, ...args], { cwd: inSandbox(cwd), env: { ...baseEnv, ...extra }, encoding: 'utf8' });
function approveNet(cwd, args, extra) {
  const planned = runNet(cwd, [...args, '--json'], extra);
  if (planned.status !== 3) throw new Error(`plan ${args.join(' ')}: ${planned.status} ${planned.stderr}${planned.stdout.slice(0, 300)}`);
  const applied = runNet(cwd, [...args, '--approve', JSON.parse(planned.stdout).revision], extra);
  if (applied.status !== 0) throw new Error(`apply ${args.join(' ')}: ${applied.status} ${applied.stderr}${applied.stdout.slice(0, 300)}`);
}
const put = (path, text, mode) => writeSandboxFile(path, text, mode);
const config = () => `${JSON.stringify({ format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [], prompts: [], teams: [] }, null, 2)}\n`;
const mk = dir => { assertWritable(join(dir, 'x')); mkdirSync(dir, { recursive: true, mode: 0o755 }); return dir; };
const up = (dir, team) => approve(dir, ['up', '--team', team, '--goal', 'Prepare a fictional onboarding kit for an independent design studio.']);

// ---- the pretend home and its shared library ----------------------------------------------------------------------------------------
mk(P.home); chmodSync(P.home, 0o700); mk(P.state); chmodSync(P.state, 0o700);
approve(P.home, ['team', 'create', 'studio', '--global', '--profile', 'engineer']);
approve(P.home, ['team', 'create', 'research-desk', '--global', '--profile', 'research']);
approve(P.home, ['skill', 'create', 'house-style', '--global']);
approve(P.home, ['skill', 'create', 'meeting-notes', '--team', 'research-desk', '--global']);
approve(P.home, ['prompt', 'create', 'weekly-update', '--global']);
approve(P.home, ['prompt', 'create', 'launch-checklist', '--team', 'studio', '--global']);
const store = join(P.home, '.bowerloom');
put(join(store, 'skills/house-style/SKILL.md'), '---\nname: house-style\ndescription: Keep every document in the studio voice. Plain, warm and short.\n---\n\n# House style\n\nWrite in short sentences. Name the next step at the end of every message.\n', 0o600);
// A skill pinned to npm, made of invented files.
const pkg = npmPackage('brand-voice', '1.2.0');
const manifestPath = join(store, 'skills.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.skills.push(pkg.entry); manifest.skills.sort((a, b) => (a.id < b.id ? -1 : 1));
put(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
// A store team with a helper that carries powerful settings, hand-placed as the format allows.
put(join(store, 'teams/studio/agents/publisher.md'), '---\nname: publisher\ndescription: Publishes approved pages to the site.\npermissionMode: bypassPermissions\n---\n\nYou publish pages that the editor has approved.\n', 0o600);
put(join(store, 'teams/studio/agents/editor.md'), '---\nname: editor\ndescription: Reads the knowledge base and edits drafts.\ntools: Read, Grep, Glob\n---\n\nYou edit drafts. Read the notes first.\n', 0o600);

// ---- the workspace, its layers, and the context store -----------------------------------------------------------------------------
const workspace = mk(P.workspace), code = mk(join(workspace, 'code')), kb = mk(join(workspace, 'knowledge-base'));
const siteApp = mk(join(workspace, 'site-app')), archiveApp = mk(join(workspace, 'archive-app'));

// The synthetic wiki: 50 pages, wikilinks, tags, an index, a hub, and orphans. Invented text only.
function wiki() {
  let seed = 20261023; const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const groups = { concepts: 14, people: 8, projects: 12, sources: 10 };
  const words = ['studio', 'client', 'brief', 'invoice', 'launch', 'review', 'voice', 'palette', 'archive', 'handoff', 'schedule', 'budget', 'draft', 'feedback', 'moodboard'];
  const names = []; for (const [g, n] of Object.entries(groups)) for (let i = 1; i <= n; i++) names.push({ group: g, id: `${g.slice(0, -1)}-${String(i).padStart(2, '0')}` });
  const title = n => `${n.id.split('-')[0][0].toUpperCase()}${n.id.split('-')[0].slice(1)} ${Number(n.id.split('-')[1])} about ${words[(Number(n.id.split('-')[1]) * 3 + n.group.length) % words.length]}`;
  const orphans = new Set(['concept-13', 'concept-14', 'source-09', 'source-10']);
  const linkable = names.filter(n => !orphans.has(n.id));
  const hub = { group: '.', id: 'hub' };
  for (const n of names) {
    const out = new Set();
    if (!orphans.has(n.id)) { const count = 1 + Math.floor(rand() * 4); for (let k = 0; k < count; k++) { const t = linkable[Math.floor(rand() * linkable.length)]; if (t.id !== n.id) out.add(t.id); } }
    const tags = [words[Math.floor(rand() * words.length)], words[Math.floor(rand() * words.length)]];
    const body = `---\ntitle: ${title(n)}\n---\n# ${title(n)}\n\nTags: ${[...new Set(tags)].map(t => `#${t}`).join(' ')}\n\nThis page is invented for the sandbox. It talks about ${words[Math.floor(rand() * words.length)]} and ${words[Math.floor(rand() * words.length)]}.\n\n${[...out].map(t => `- See [[${t}]]`).join('\n')}\n${n.group === 'sources' && !orphans.has(n.id) ? '\nA broken link: [[a-page-that-is-not-there]]\n' : ''}`;
    put(join(kb, 'wiki', n.group, `${n.id}.md`), body, 0o644);
  }
  put(join(kb, 'wiki', 'hub.md'), `---\ntitle: Start here\n---\n# Start here\n\nTags: #index\n\nThe hub: it points at every group.\n\n${linkable.filter((_, i) => i % 2 === 0).map(t => `- [[${t.id}]]`).join('\n')}\n`, 0o644);
  put(join(kb, 'wiki', 'index.md'), `---\ntitle: Index\n---\n# Index\n\nTags: #index\n\n${names.filter(n => !orphans.has(n.id)).map(n => `- [${title(n)}](${n.group}/${n.id}.md)`).join('\n')}\n\nSee also [[hub]].\n`, 0o644);
  put(join(kb, 'raw', 'notes-2026.md'), '# Raw notes\n\nLoose notes before they are sorted into pages. See [[hub]].\n', 0o644);
  put(join(kb, 'raw', 'ideas.md'), '# Ideas\n\nNot linked from anywhere yet.\n', 0o644);
}
wiki();
chmodSync(kb, 0o755);

// The older way: each layer set up by `up`, with no bowerloom.json.
// Inside first, then outside: `up` works on the nearest folder that is not yet set up, so the layers are made from the inside out.
up(kb, 'wiki-crew'); up(code, 'code-crew'); up(workspace, 'workspace-crew');

// ---- the projects ---------------------------------------------------------------------------------------------------------------------
const share = (dir) => put(join(dir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/sandbox-co/site-app.git\n');
function lockEnv(files, planPath) {
  const dir = mkdtempSync(join(scratch, 'repo-'));
  const repoFiles = buildFakeRepo('sandbox-co', 'shared-store', files, COMMIT, dir);
  const git = join(store, '.git');
  put(join(git, 'config'), '[remote "origin"]\n\turl = git@github.com:sandbox-co/shared-store.git\n'); put(join(git, 'HEAD'), 'ref: refs/heads/main\n');
  put(join(git, 'refs/remotes/origin/main'), `${COMMIT}\n`); put(join(git, 'refs/heads/main'), `${COMMIT}\n`);
  const log = join(scratch, 'net.log'); writeFileSync(log, ''); writeFileSync(planPath, JSON.stringify({ log, routes: repoFiles.routes }));
  return { TEST_FAKE_NETWORK_PLAN: planPath };
}
const storeFiles = () => { const o = {}; const walk = rel => { for (const n of readdirSync(join(store, rel)).sort()) { if (n === '.git') continue; const r = rel ? `${rel}/${n}` : n; if (statSync(join(store, r)).isDirectory()) walk(r); else o[r] = readFileSync(join(store, r), 'utf8'); } }; walk(''); return o; };

// The knowledge-base is a registered knowledge folder, and site-app is allowed to read it.
put(join(siteApp, 'bowerloom.json'), config()); share(siteApp);
const netEnv = lockEnv(storeFiles(), join(scratch, 'plan.json'));
for (const args of [['use', 'team', 'research-desk'], ['use', 'skill', 'house-style'], ['use', 'skill', 'brand-voice'], ['use', 'prompt', 'weekly-update'], ['use', 'prompt', 'launch-checklist']]) approveNet(siteApp, args, netEnv);
approve(siteApp, ['folder', 'add', 'knowledge-base', kb]);
approve(siteApp, ['folder', 'allow', 'knowledge-base', 'heading']);
approve(siteApp, ['slice', 'create', 'kb-index', '--registered', 'knowledge-base', '--include', 'wiki/**/*.md']);
approve(siteApp, ['slice', 'create', 'kb-titles', '--registered', 'knowledge-base', '--include', 'wiki/**/*.md']);
const titles = join(siteApp, '.bowerloom/slices/kb-titles.yaml');
put(titles, readFileSync(titles, 'utf8').replace(/^summary: .*$/m, 'summary: frontmatter:title'), 0o600);
// Drifted: a prompt changes in the library after the lock was written, and the project asks for a skill that is gone.
put(join(store, 'prompts/launch-checklist.md'), '# Launch checklist\n\nThis text changed after the lock was written.\n', 0o600);
const cfgPath = join(siteApp, 'bowerloom.json'), cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
cfg.skills.push({ id: 'old-rules', source: 'store' }); cfg.skills.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
put(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, 0o644);

// A project with a lock that cannot be read.
put(join(archiveApp, 'bowerloom.json'), config()); share(archiveApp);
approveNet(archiveApp, ['use', 'skill', 'house-style'], netEnv);
put(join(archiveApp, 'bowerloom.lock.json'), '<<<<<<< HEAD\n{"format": "bowerloom/lock/v1beta1"\n', 0o644);

// A project-owned team whose helper has powerful settings, so the plan shows them.
approve(siteApp, ['team', 'create', 'publishing', '--profile', 'engineer']);
put(join(siteApp, '.bowerloom/teams/publishing/agents/publisher.md'), '---\nname: publisher\ndescription: Publishes approved pages.\npermissionMode: bypassPermissions\n---\n\nYou publish pages that the editor approved.\n', 0o600);
put(join(siteApp, '.bowerloom/teams/publishing/agents/editor.md'), '---\nname: editor\ndescription: Reads the knowledge base and edits drafts.\ntools: Read, Grep, Glob\nskills:\n  - slice-kb-index\n---\n\nYou edit drafts. Read the notes first.\n', 0o600);

console.log(`Done. The sandbox is in ${SANDBOX_DIR}`);
console.log(`Pages in the invented knowledge base: ${readdirSync(join(kb, 'wiki'), { recursive: true }).filter(f => String(f).endsWith('.md')).length}`);
void relative; void sep;
