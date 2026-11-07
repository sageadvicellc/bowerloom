// Shared fixture for the release script tests. It builds a real temporary git repository with a local bare repository as origin, a fake npm
// and a fake pack script in a temporary folder, and runs scripts/release.mjs against them. Nothing here touches the network or the real npm.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const scriptPath = path.join(repoRoot, 'scripts/release.mjs');
export const VERSION = '0.8.0-beta.2';
export const BRANCH = 'release/0.8.0-beta.2';

const FAKE_NPM = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(process.env.FAKE_NPM_STATE, 'utf8'));
const sizeOf = file => { try { return fs.statSync(file).size; } catch { return null; } };
fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({ args, cwd: process.cwd(), env: process.env, userconfigSize: sizeOf(process.env.npm_config_userconfig ?? ''), globalconfigSize: sizeOf(process.env.npm_config_globalconfig ?? '') }) + '\\n');
const say = (text, code = 0) => { process.stdout.write(text + '\\n'); process.exit(code); };
const err = (text, code = 1) => { process.stderr.write(text + '\\n'); process.exit(code); };
const sub = args[0];
const joined = args.join(' ');
for (const rule of state.fail ?? []) {
  if (joined.startsWith(rule.match)) {
    if (rule.ignoreTerm) process.on('SIGTERM', () => {});
    if (rule.selfPidFile) fs.writeFileSync(rule.selfPidFile, String(process.pid));
    if (rule.daemon) { spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }).on('spawn', function () { fs.writeFileSync(rule.pidFile, String(this.pid)); }); await new Promise(r => setTimeout(r, 300)); say('daemon left behind'); }
    if (rule.splitUtf8) { const bytes = Buffer.from(rule.message, 'utf8'); const cut = bytes.indexOf(0xc3) + 1; process.stderr.write(bytes.subarray(0, cut)); await new Promise(r => setTimeout(r, 200)); process.stderr.write(Buffer.concat([bytes.subarray(cut), Buffer.from('\\n')])); process.exit(1); }
    if (rule.hang) { const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); fs.writeFileSync(rule.pidFile, String(child.pid)); setInterval(() => {}, 1000); await new Promise(() => {}); }
    if (rule.flood) { if (rule.pidFile) { const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); fs.writeFileSync(rule.pidFile, String(child.pid)); } const chunk = 'x'.repeat(1024 * 1024) + '\\n'; for (let i = 0; i < 40; i++) process.stdout.write(chunk); await new Promise(r => setTimeout(r, 5000)); }
    err(rule.message ?? 'npm error code EFAKE');
  }
}
if (sub === 'view') {
  if (state.registry === 'down') err('npm error code ENOTFOUND\\nnpm error network request failed');
  const spec = args[1], field = args[2];
  const at = spec.lastIndexOf('@');
  const pkg = at > 0 ? spec.slice(0, at) : spec, ver = at > 0 ? spec.slice(at + 1) : null;
  const notFound = () => err('npm error code E404\\nnpm error 404 Not Found');
  if (field === 'dist-tags') { if (!state.distTags) notFound(); say(JSON.stringify(state.distTags)); }
  const entry = state.versions?.[ver];
  if (!entry) notFound();
  if (field === 'version') say(ver);
  if (field === 'dist.integrity') say(entry.integrity);
  err('npm error unsupported field');
}
if (sub === 'whoami') say(state.user ?? 'someone');
if (sub === 'publish') {
  if (!args.includes('--dry-run')) say('REAL PUBLISH ATTEMPTED', 99);
  if (state.failPublishDryRun) err('npm error code EPUBLISHCONFLICT\\nnpm error dry run refused');
  say('+ dry-run ok');
}
if (sub === 'init') { fs.writeFileSync('package.json', JSON.stringify({ name: 'proj', version: '1.0.0' })); say('wrote package.json'); }
if (sub === 'install') {
  const spec = args[1];
  const at = spec.lastIndexOf('@');
  const pkg = spec.slice(0, at), tag = spec.slice(at + 1);
  const version = state.installVersion ?? state.distTags?.[tag];
  if (!version) err('npm error code ETARGET');
  fs.mkdirSync(path.join('node_modules', pkg), { recursive: true });
  fs.writeFileSync(path.join('node_modules', pkg, 'package.json'), JSON.stringify({ name: pkg, version }));
  fs.mkdirSync(path.join('node_modules', '.bin'), { recursive: true });
  const bin = path.join('node_modules', '.bin', state.binName ?? 'bowerloom');
  fs.writeFileSync(bin, '#!/usr/bin/env node\\nif (' + JSON.stringify(state.binExit ?? 0) + ') { process.stderr.write("error: broken cli\\\\n"); process.exit(' + JSON.stringify(state.binExit ?? 0) + '); }\\nconsole.log(process.argv[2] === "--version" ? ' + JSON.stringify(version) + ' : "usage");\\n', { mode: 0o755 });
  say('added 1 package');
}
// ci, run <script>, test
const isTestRun = sub === 'test' || (sub === 'run' && /^(test|e2e)/.test(args[1] ?? ''));
if (isTestRun) say(state.testOutput ?? '# some tests\\nok 1 - Expected value\\nℹ tests 3\\nℹ pass 3\\nℹ fail 0\\nℹ cancelled 0');
say('ok ' + joined);
`;

const FAKE_PACK = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const args = process.argv.slice(2);
const get = name => args[args.indexOf(name) + 1];
fs.appendFileSync(process.env.FAKE_PACK_LOG, JSON.stringify({ args, env: process.env }) + '\\n');
if (process.env.FAKE_PACK_FAIL) { process.stderr.write('pack error: ' + process.env.FAKE_PACK_FAIL + '\\n'); process.exit(1); }
if (fs.existsSync(get('--stage')) || fs.existsSync(get('--output'))) { process.stderr.write('pack error: destination exists\\n'); process.exit(1); }
fs.mkdirSync(get('--stage'), { recursive: true });
fs.mkdirSync(get('--output'), { recursive: true });
const file = path.join(get('--output'), 'bowerloom-${VERSION}.tgz');
const body = fs.readFileSync(process.env.FAKE_PACK_TGZ ?? path.join(import.meta.dirname, 'default.tgz'));
fs.writeFileSync(file, body);
if (process.env.FAKE_PACK_HANG) { const child = (await import('node:child_process')).spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); fs.writeFileSync(process.env.FAKE_PACK_HANG, String(child.pid)); setInterval(() => {}, 1000); await new Promise(() => {}); }
const sha256 = process.env.FAKE_PACK_WRONG_SHA ? '0'.repeat(64) : crypto.createHash('sha256').update(body).digest('hex');
const report = { file, sha256, bytes: process.env.FAKE_PACK_WRONG_BYTES ? body.length + 1 : body.length, unpackedBytes: body.length * 3, files: Number(process.env.FAKE_PACK_FILES ?? 7), bundle: { packages: 2, files: 3, bytes: 4 } };
if (process.env.FAKE_PACK_NO_SHA) delete report.sha256;
console.log(JSON.stringify(report, null, 2));
`;

/**
 * Builds a gzip tar archive in memory: `own` files of the package, `bundled` files under node_modules/, and any `extra` entries (paths below
 * package/). Only files are added, so the entry count is the file count. The same arguments give the same bytes.
 */
export function makeTarball({ own = 7, bundled = 3, extra = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-release-tgz-'));
  try {
    const names = [
      ...Array.from({ length: own }, (_, i) => (i === 0 ? 'package.json' : `dist/file-${i}.js`)),
      ...Array.from({ length: bundled }, (_, i) => `node_modules/dep/file-${i}.js`),
      ...extra,
    ];
    for (const name of names) {
      fs.mkdirSync(path.dirname(path.join(dir, 'package', name)), { recursive: true });
      fs.writeFileSync(path.join(dir, 'package', name), `content of ${name}\n`);
    }
    const file = path.join(dir, 'out.tgz');
    tar.create({ file, cwd: dir, gzip: true, portable: true, noMtime: true, sync: true }, names.map(name => `package/${name}`));
    return fs.readFileSync(file);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
/** The tarball the fake pack writes unless a test sets FAKE_PACK_TGZ: 7 files of the package and 3 bundled ones. */
export const TARBALL = makeTarball();

/** Real config values with test-friendly settings. `patch` is merged over the top level. */
export function testConfig(patch = {}) {
  const real = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release.config.json'), 'utf8'));
  return { ...real, registry: 'https://registry.example.test', expectedFileCount: 7, ...patch };
}

/**
 * Builds the fixture. Registers its own removal with `t.after`.
 * Returns helpers: run(args, opts), git(...args), npmCalls(), setNpm(patch), commit(file, text), and the paths.
 */
export function makeFixture(t, { config = testConfig(), branch = BRANCH, record = {} } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-release-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'work');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const fakeNpm = path.join(bin, 'fake-npm.mjs');
  const fakePack = path.join(bin, 'fake-pack.mjs');
  fs.writeFileSync(fakeNpm, FAKE_NPM, { mode: 0o755 });
  fs.writeFileSync(fakePack, FAKE_PACK, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'default.tgz'), TARBALL);
  const npmState = path.join(root, 'npm-state.json');
  const npmLog = path.join(root, 'npm-log.jsonl');
  const packLog = path.join(root, 'pack-log.jsonl');
  fs.writeFileSync(npmLog, '');
  fs.writeFileSync(packLog, '');
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  // Everything the script makes in the system temp folder lands here and goes with the fixture.
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(tmp);

  const baseEnv = {
    PATH: process.env.PATH, HOME: home, TMPDIR: tmp,
    GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1',
    BOWERLOOM_RELEASE_NPM: fakeNpm, BOWERLOOM_RELEASE_PACK: fakePack, BOWERLOOM_RELEASE_FREE_GIB: '100',
    FAKE_NPM_STATE: npmState, FAKE_NPM_LOG: npmLog, FAKE_PACK_LOG: packLog,
  };
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: repo, env: baseEnv, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const setNpm = patch => {
    const current = fs.existsSync(npmState) ? JSON.parse(fs.readFileSync(npmState, 'utf8')) : {};
    fs.writeFileSync(npmState, JSON.stringify({ ...current, ...patch }));
  };
  setNpm({ distTags: null, versions: {}, user: 'tester' });

  spawnSync('git', ['init', '--bare', '-b', 'main', origin], { env: baseEnv });
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-b', branch, repo], { env: baseEnv });
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release-test@example.com');
  fs.mkdirSync(path.join(repo, 'release'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'apps/desktop'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'release.config.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(repo, 'release/beta.json'), JSON.stringify({ schema: 'bowerloom/release/v1', version: VERSION, state: 'prepared', npm: { published: false, authenticatedIdentity: 'tester' }, ...record }, null, 2));
  fs.writeFileSync(path.join(repo, 'apps/desktop/package.json'), JSON.stringify({ name: '@bowerloom/desktop', version: VERSION }));
  fs.writeFileSync(path.join(repo, 'README.md'), 'Readme\n');
  for (const dir of ['apps/docs/src/content/docs', 'apps/landing/content/articles']) {
    fs.mkdirSync(path.join(repo, dir), { recursive: true });
    fs.writeFileSync(path.join(repo, dir, 'page.md'), 'The beta is on npm.\n');
  }
  fs.writeFileSync(path.join(repo, '.gitignore'), '.trellis/\napps/desktop/release/\nnode_modules/\n');
  git('add', '-A');
  git('commit', '-m', 'initial');
  git('remote', 'add', 'origin', origin);
  git('push', '-u', 'origin', branch);

  const run = (args, { env = {}, cwd = root } = {}) => {
    const r = spawnSync(process.execPath, [scriptPath, '--repo', repo, ...args], { cwd, env: { ...baseEnv, ...env }, encoding: 'utf8', timeout: 120_000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
  };
  /** Starts the script without waiting. Returns { child, done } where done resolves with { status, signal, stdout, stderr }. */
  const start = (args, { env = {}, cwd = root } = {}) => {
    const child = spawn(process.execPath, [scriptPath, '--repo', repo, ...args], { cwd, env: { ...baseEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const done = new Promise(resolve => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
    return { child, done, stderr: () => stderr };
  };
  const npmCalls = () => fs.readFileSync(npmLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const packCalls = () => fs.readFileSync(packLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const commit = (file, text, message = 'change') => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
    git('add', '-A');
    git('commit', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  /** Writes desktop artifacts into the ignored release folder. */
  const artifacts = files => {
    const dir = path.join(repo, config.desktop.dir);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  };
  /**
   * Writes a verify receipt for `commit` (default HEAD) as a run under the fixture's four test seams would (or under `seams`), without running verify.
   * `status` of a check can be changed to make a receipt that does not count.
   */
  const verified = (commit = git('rev-parse', 'HEAD'), { version = VERSION, status = 'pass', seams = ['BOWERLOOM_RELEASE_NPM', 'BOWERLOOM_RELEASE_PACK', 'BOWERLOOM_RELEASE_FREE_GIB', '--repo'] } = {}) => {
    const file = path.join(repo, '.trellis/release/receipts', `verify-${version}-${commit}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schema: 'bowerloom/release-receipt/v2', step: 'verify', version, commit, at: new Date().toISOString(), seams, checks: [{ name: 'dist-tag', status: 'pass' }, { name: 'integrity', status }] }));
    return commit;
  };
  /** Writes a tarball into the fixture and returns its path, for FAKE_PACK_TGZ. */
  const tarballWith = (name, options) => { const file = path.join(root, name); fs.writeFileSync(file, makeTarball(options)); return file; };
  return { root, tmp, repo, origin, tarballWith, verified, baseEnv, run, start, git, setNpm, npmCalls, packCalls, commit, artifacts, config, fakeNpm, fakePack, npmLog };
}

/** Streams that collect text, for in-process runs. */
export function fakeStreams({ tty = false } = {}) {
  const out = [], err = [];
  return {
    stdin: { isTTY: tty }, stdout: { isTTY: tty, write: s => { out.push(s); return true; } }, stderr: { write: s => { err.push(s); return true; } },
    out: () => out.join(''), err: () => err.join(''),
  };
}

/** Lists every file under a folder, as absolute paths. */
export function allFiles(dir) {
  const found = [];
  const visit = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) visit(p); else found.push(p); } };
  if (fs.existsSync(dir)) visit(dir);
  return found;
}

/** Waits until a file exists and holds a number; returns the number. */
export async function waitForPid(file, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const n = Number(fs.readFileSync(file, 'utf8')); if (Number.isInteger(n) && n > 0) return n; } catch { /* not written yet */ }
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`no pid in ${file}`);
}

/** True when the process no longer exists. Polls for up to `ms`. A process that is only a zombie counts as gone. */
export async function isGone(pid, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { process.kill(pid, 0); } catch { return true; }
    const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
    if (state === '' || state.startsWith('Z')) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}
