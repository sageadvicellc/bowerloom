#!/usr/bin/env node
/**
 * Records the real output of each `terminal` entry of plan.json and writes it into apps/docs/src/visuals/manifest.json (the `terminals` half; the `shots` half is kept).
 *   node tools/docs-visuals/capture-terminals.mjs        (after `npm run build` at the root)
 * Every command runs against a fresh sample project in a private temporary folder, with a made-up HOME and made-up state folder, so nothing of the real home, real projects, or real engine
 * configuration is read or written. The text is then made stable: every temporary path becomes `~` or `~/projects/sample`, every revision or hash becomes a placeholder, and the script
 * fails when a timestamp, a duration, a personal name, a real home path, a machine name, or a token is still in the text.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { weeklyFolder } from '../../apps/desktop/e2e/landing-shots-fixture.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const cli = join(root, 'dist', 'apps', 'cli', 'src', 'main.js');
const manifestPath = join(root, 'apps', 'docs', 'src', 'visuals', 'manifest.json');
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8'));
if (!existsSync(cli)) throw new Error('Build the CLI first: npm run build at the root.');

const made = [];
/** A private made-up home. Its real path is looked up, because the temp folder of a Mac is a link. */
function newHome() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-docs-')));
  chmodSync(dir, 0o700);
  made.push(dir);
  mkdirSync(join(dir, 'projects'), { mode: 0o700 });
  return dir;
}
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

/** A folder with engine files and no harness yet: what the adopt step reads. */
function rawProject(home) {
  const dir = join(home, 'projects', 'sample');
  put(join(dir, 'CLAUDE.md'), '# Weekly report\n\nWrite the report from the notes in `notes/`. Keep it to one page.\n');
  put(join(dir, '.claude', 'skills', 'outline', 'SKILL.md'), '---\nname: outline\ndescription: Outlines the report before it is written.\n---\n\nOutline the report first.\n');
  put(join(dir, '.claude', 'skills', 'proofread', 'SKILL.md'), '---\nname: proofread\ndescription: Checks spelling and tone.\n---\n\nCheck spelling and tone.\n');
  put(join(dir, '.claude', 'agents', 'drafter.md'), '---\nname: drafter\ndescription: Writes the first draft of the report.\n---\n\nWrite the first draft.\n');
  return dir;
}

/** An empty folder that is a project of git, like a new checkout. */
function emptyProject(home, name = 'sample') {
  const dir = join(home, 'projects', name);
  mkdirSync(dir, { mode: 0o700 });
  put(join(dir, 'README.md'), '# Sample\n');
  return dir;
}

/** The scenarios. A step with an `id` is recorded. A step with `approve` runs the command again with the revision of the step before, and is not recorded. */
const SCENARIOS = [
  { setup: home => ({ cwd: weeklyFolder(home, 'sample', { hook: false, servers: [] }) }), steps: [
    { id: 'cli-help', args: ['--help'] },
  ] },
  { setup: home => ({ cwd: rawProject(home) }), steps: [
    { id: 'cli-harness-status', args: ['harness', 'status'] },
    { id: 'cli-harness-adopt', args: ['harness', 'adopt'] },
    { approve: true },
    { id: 'cli-harness-install', args: ['harness', 'install'] },
    { approve: true },
    { id: 'cli-harness-drift', args: ['harness', 'drift'] },
    { id: 'cli-harness-remove', args: ['harness', 'remove'] },
  ] },
  { setup: home => ({ cwd: weeklyFolder(home, 'sample', { hook: false, servers: [] }) }), steps: [
    { id: 'cli-harness-export', args: ['harness', 'export', '--output', 'harness.json'] },
    { approve: true },
    { move: 'harness.json' },
  ] },
  { setup: home => ({ cwd: emptyProject(home), prior: 'import' }), steps: [
    { id: 'cli-harness-import', args: ['harness', 'import', 'harness.json'] },
  ] },
  { setup: home => ({ cwd: emptyProject(home) }), steps: [
    { id: 'cli-up', args: ['up', '--team', 'first', '--goal', 'Write the weekly report'] },
    { approve: true },
    { id: 'cli-ls', args: ['ls'] },
    { id: 'cli-skill-create', args: ['skill', 'create', 'house-style'] },
    { approve: true },
    { id: 'cli-status', args: ['status'] },
    { args: ['prompt', 'create', 'weekly-update'] },
    { approve: true },
    { id: 'cli-apply', args: ['apply'] },
  ] },
  { setup: home => ({ cwd: emptyProject(home) }), steps: [
    { id: 'cli-init-plan', args: ['init', 'plan', '--mode', 'new', '--target', '{home}/projects/new-project', '--name', 'Sample team', '--goal', 'Review a synthetic team setup', '--profile', 'engineer'] },
  ] },
];

/** The words of the command up to its first flag, such as `bowerloom harness status`. */
function titleOf(args) {
  const words = [];
  for (const arg of args) { if (arg.startsWith('-')) { if (words.length === 0) words.push(arg); break; } words.push(arg); }
  return ['bowerloom', ...words].join(' ');
}

const forbiddenWords = () => [...new Set([userInfo().username, homedir(), hostname(), hostname().split('.')[0], tmpdir(), '/var/folders', '/private/var', '/Users/', root].filter(word => word.length >= 4))];

/** Makes the text stable and readable. */
function clean(text, home) {
  let out = text;
  for (const base of new Set([home, home.replace(/^\/private/, '')])) out = out.split(`${base}/`).join('~/').split(base).join('~');
  out = out.replace(/\b[0-9a-f]{64}\b/g, '<revision>').replace(/\b[0-9a-f]{40}\b/g, '<commit>');
  return out.replace(/\r/g, '');
}

function check(id, text) {
  for (const word of forbiddenWords()) if (text.includes(word)) throw new Error(`${id}: the text holds a private word (${word.length} characters long)`);
  const bad = [
    [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/, 'a timestamp'], [/\b\d+(\.\d+)? ?(ms|seconds?)\b/, 'a duration'], [/\b(ghp|gho|github_pat|sk|xox[bp])[-_][A-Za-z0-9_]{8,}/, 'a token'],
    [/\/(Users|home)\/[a-z]/i, 'a home path'], [/\/(private\/)?(var|tmp)\/[a-z]/i, 'a temporary path'], [/\bbowerloom-docs-/, 'a temporary folder name'],
  ];
  for (const [pattern, name] of bad) if (pattern.test(text)) throw new Error(`${id}: the text holds ${name}: ${text.match(pattern)[0]}`);
}

const wanted = new Map(plan.filter(entry => entry.kind === 'terminal').map(entry => [entry.id, entry]));
const recorded = new Map();
let carried = null;

try {
  for (const scenario of SCENARIOS) {
    const home = newHome();
    const set = scenario.setup(home);
    const cwd = set.cwd;
    if (set.prior === 'import') { if (carried === null) throw new Error('No exported file to import.'); cpSync(carried, join(cwd, 'harness.json')); }
    const env = { PATH: process.env.PATH, HOME: home, XDG_STATE_HOME: join(home, '.local', 'state'), NO_COLOR: '1', BOWERLOOM_EVENT_LOG: 'off', LANG: 'C.UTF-8' };
    let revision = null, last = null;
    for (const step of scenario.steps) {
      if (step.move !== undefined) { carried = join(mkdtempSync(join(home, 'carry-')), step.move); cpSync(join(cwd, step.move), carried); continue; }
      const args = step.approve ? [...last, '--approve', revision] : step.args.map(arg => arg.replaceAll('{home}', home));
      const ran = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env });
      if (step.approve) { if (![0, 4].includes(ran.status)) throw new Error(`The approve step failed: ${ran.stdout}${ran.stderr}`); continue; }
      last = args;
      revision = /^Revision: ([0-9a-f]{64})$/m.exec(ran.stdout)?.[1] ?? null;
      if (step.id === undefined || !wanted.has(step.id)) continue;
      const toLines = text => clean(text, home).replace(/\n+$/, '').split('\n').filter((line, i, all) => !(line === '' && all.length === 1));
      const shown = ['bowerloom', ...args].map(arg => clean(arg, home)).map(arg => (/[\s]/.test(arg) ? `"${arg}"` : arg)).join(' ');
      const lines = [{ kind: 'cmd', text: shown }, ...toLines(ran.stdout).map(text => ({ kind: 'out', text })), ...(ran.stderr.trim() === '' ? [] : toLines(ran.stderr).map(text => ({ kind: 'err', text })))];
      check(step.id, lines.map(line => line.text).join('\n'));
      if (lines.length < 2) throw new Error(`${step.id}: the command printed nothing (exit ${ran.status})`);
      const entry = wanted.get(step.id);
      recorded.set(step.id, { title: titleOf(args), caption: entry.caption, lines });
    }
  }
} finally {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
}

for (const id of wanted.keys()) if (!recorded.has(id)) throw new Error(`The plan names the terminal ${id}, and no scenario records it.`);
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { shots: {} };
manifest.shots ??= {};
manifest.terminals = Object.fromEntries([...wanted.keys()].map(id => [id, recorded.get(id)]));
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify({ shots: manifest.shots, terminals: manifest.terminals }, null, 2)}\n`);
console.log(`Recorded ${recorded.size} terminals.`);
