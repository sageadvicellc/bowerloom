#!/usr/bin/env node
// Test tooling, never shipped. The sandbox proof of npm installs: how npm handles the global packages `bowerloom` and `latebrake`,
// before either one is released. It is not part of `npm test`. It needs Docker (container mode) and one registry read.
// The page docs/v0.9/npm-install-proof.md says how to run it and how to read its result.
//
//   node tools/npm-install-proof/run.mjs --out <new folder> [--final-bowerloom-tarball <file>] [--latebrake-tarball <file>]
//                                        [--mode container|host] [--keep]
//
// Two phases. The fetch phase has the network on and makes two reads from registry.npmjs.org: the 0.8 tarball, and the pinned skill
// that a real 0.8 run needs. The run phase has no network: `docker run --network none` in container mode, and a proxy that points at a
// closed local port in host mode. In the run phase every install reads from a static registry on 127.0.0.1 (registry.mjs), which
// answers GET only. Packs are local tarballs made with `npm pack`. Nothing is sent to any registry, and no credential is set.
//
// --out must name a folder that does not exist yet, or is empty, outside the repository. The result is one JSON file in it.
// The container modes of this file (--inner) run inside the image of tools/npm-install-proof/Dockerfile.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestsOf, readManifest, startRegistry } from './registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const IMAGE = 'bowerloom-proof-node:dev';
const WORK = '/home/node/work';
const SCHEMA = 'npm-install-proof/1';

// What the registry listed for bowerloom@0.8.0-beta.1 when the proof was written.
const OLD_VERSION = '0.8.0-beta.1';
const OLD_INTEGRITY = 'sha512-8HrwtMDM25dVcVgqZ9HKQn5YyK3PCbyUA4kzUG0bNGdXWIU4ZCTvjoMXJTGqVvPbLj63BZMoHo8LejhpFuhiIA==';
const OLD_BINS = ['bowerloom', 'bowerloom-guard', 'bowerloom-mcp'];
const NEW_BINS = ['latebrake', 'latebrake-guard', 'latebrake-mcp'];
const PAIRS = [['bowerloom', 'latebrake'], ['bowerloom-mcp', 'latebrake-mcp'], ['bowerloom-guard', 'latebrake-guard']];
// The global copy of the stand-in that a case installs beside the final package. Its version differs from the nested copy, so the
// version that a probe prints says which copy ran.
const OTHER_LATEBRAKE = '0.9.0-beta.2';
const PROBE_STDERR = 'probe: fixed stderr line\n';
const SKILL_SPEC = 'npm:@tanstack/db-skills@0.0.1:skills/tanstack-db/collections';
// The npm commands that the driver may run. Check C13 fails on any other command.
const ALLOWED_NPM = new Set(['pack', 'install', 'uninstall', 'view', 'ls', '--version']);
// The names that a child process may have in its environment. Check C13 fails on any other name.
// These are the exact names that the driver sets, and no others. An npm setting such as one for an auth value is not on the list.
const ALLOWED_ENV = new Set([
  'PATH', 'HOME', 'LANG',
  'npm_config_userconfig', 'npm_config_globalconfig', 'npm_config_cache', 'npm_config_update_notifier', 'npm_config_fund', 'npm_config_audit',
  'npm_config_progress', 'npm_config_fetch_retries', 'npm_config_prefix', 'npm_config_proxy', 'npm_config_https_proxy', 'npm_config_noproxy',
]);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const clip = (value, max = 3000) => { const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value); return text.length > max ? `${text.slice(0, max)}... (${text.length - max} more characters)` : text; };
const modeOf = stat => (stat.mode & 0o7777).toString(8).padStart(4, '0');

// ---------------------------------------------------------------------------------------------------------------------------
// Running a command. Every command that the proof starts goes through exec, which appends it to the command log.
// ---------------------------------------------------------------------------------------------------------------------------

/** One log for the whole run. Check C13 reads it. */
const commandLog = [];

/** Runs a file with arguments and no shell. Resolves with the exit code and the bytes of stdout and stderr; it never rejects. */
function exec(tool, file, args, { env, cwd, input = '', timeoutMs = 600000 } = {}) {
  return new Promise(resolve => {
    const out = [];
    const err = [];
    const entry = { tool, argv: [path.basename(file), ...args], envNames: Object.keys(env ?? {}).sort(), exit: null };
    commandLog.push(entry);
    let child;
    try {
      child = spawn(file, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      entry.exit = -1;
      resolve({ code: -1, stdout: Buffer.alloc(0), stderr: Buffer.from(String(error.message)) });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    const done = (code, extra = '') => {
      clearTimeout(timer);
      entry.exit = code;
      resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat([...err, Buffer.from(extra)]) });
    };
    child.on('error', error => done(-1, String(error.message)));
    child.on('close', (code, signal) => done(code ?? (signal ? 128 : -1)));
  });
}

/** The environment of a child process. It is built from names, never copied from this process, so no credential can pass through. */
function childEnv(extra = {}) {
  return { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', ...extra };
}

/** The environment of an npm command in one case: an empty prefix, an empty cache, empty settings files, and its own HOME. */
function npmEnv(c) {
  const env = childEnv({
    HOME: c.home,
    npm_config_userconfig: path.join(c.cfg, 'user.npmrc'),
    npm_config_globalconfig: path.join(c.cfg, 'global.npmrc'),
    npm_config_cache: c.cache,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_progress: 'false',
    npm_config_fetch_retries: '0',
  });
  if (c.prefix) env.npm_config_prefix = c.prefix;
  if (c.proxyPort) {
    // Host mode. Any request that is not for 127.0.0.1 goes to a port where nothing listens, and fails.
    env.npm_config_proxy = `http://127.0.0.1:${c.proxyPort}`;
    env.npm_config_https_proxy = `http://127.0.0.1:${c.proxyPort}`;
    env.npm_config_noproxy = '127.0.0.1,localhost';
  }
  return env;
}

const npm = (c, args, extra = {}) => exec('npm', 'npm', args, { env: npmEnv(c), cwd: c.home, ...extra });

// ---------------------------------------------------------------------------------------------------------------------------
// Cases. Each case has its own prefix, cache, settings files, and HOME.
// ---------------------------------------------------------------------------------------------------------------------------

function newCase(proof, name, { home } = {}) {
  const root = path.join(proof.work, 'cases', name);
  const c = {
    name,
    root,
    prefix: path.join(root, 'prefix'),
    cache: path.join(root, 'cache'),
    cfg: path.join(root, 'cfg'),
    home: home ?? path.join(root, 'home'),
    registry: proof.registry.url,
    proxyPort: proof.proxyPort,
  };
  for (const dir of [c.prefix, c.cache, c.cfg]) fs.mkdirSync(dir, { recursive: true });
  if (home === undefined) fs.mkdirSync(c.home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(c.cfg, 'user.npmrc'), '');
  fs.writeFileSync(path.join(c.cfg, 'global.npmrc'), '');
  return c;
}

/** Removes the prefix and the cache of a case, which hold about 90 MB each for the 0.8 package. */
function dropCase(c) {
  fs.rmSync(c.prefix, { recursive: true, force: true });
  fs.rmSync(c.cache, { recursive: true, force: true });
}

const installGlobal = (c, ...specs) => npm(c, ['install', '-g', '--prefix', c.prefix, '--registry', c.registry, ...specs]);
const uninstallGlobal = (c, ...names) => npm(c, ['uninstall', '-g', '--prefix', c.prefix, '--registry', c.registry, ...names]);

/** The command links in the prefix: name to { target, resolves }. */
function links(c) {
  const dir = path.join(c.prefix, 'bin');
  if (!fs.existsSync(dir)) return {};
  const found = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file);
    found[name] = stat.isSymbolicLink() ? { target: fs.readlinkSync(file), resolves: fs.existsSync(file) } : { target: null, resolves: true, plainFile: true };
  }
  return found;
}

/** The packages in lib/node_modules, with the version of each. */
function packages(c) {
  const dir = path.join(c.prefix, 'lib', 'node_modules');
  if (!fs.existsSync(dir)) return {};
  const found = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const record = path.join(dir, name, 'package.json');
    found[name] = fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')).version : null;
  }
  return found;
}

const nestedLatebrake = c => {
  const record = path.join(c.prefix, 'lib', 'node_modules', 'bowerloom', 'node_modules', 'latebrake', 'package.json');
  return fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')).version : null;
};

/** The package that a link points into, as the part after lib/node_modules/. Null for a link that points elsewhere. */
const packageOfLink = entry => (entry && entry.target ? /^\.\.\/lib\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(entry.target)?.[1] ?? null : null);

/** Runs a command link of a case, with only PATH, HOME, and LANG in its environment. Parses the probe's JSON line when there is one. */
async function runLink(c, command, args = [], input = '') {
  const result = await exec('command', path.join(c.prefix, 'bin', command), args, { env: childEnv({ HOME: c.home }), cwd: c.home, input, timeoutMs: 120000 });
  let probe = null;
  try { probe = JSON.parse(result.stdout.toString('utf8')); } catch { probe = null; }
  return { ...result, probe };
}

/** A stable view of a prefix, for the record. */
const snapshot = c => ({ links: links(c), packages: packages(c) });
const dangling = c => Object.entries(links(c)).filter(([, entry]) => !entry.resolves).map(([name]) => name);

// ---------------------------------------------------------------------------------------------------------------------------
// The files of a person: a hash of a whole folder, with each path, mode, type, and the bytes of each file.
// ---------------------------------------------------------------------------------------------------------------------------

function treeHash(root) {
  if (!fs.existsSync(root)) return { absent: true };
  const lines = [];
  const walk = rel => {
    for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
      const childRel = rel ? `${rel}/${name}` : name;
      const file = path.join(root, childRel);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) lines.push(`l ${childRel} ${fs.readlinkSync(file)}`);
      else if (stat.isDirectory()) { lines.push(`d ${childRel} ${modeOf(stat)}`); walk(childRel); }
      else if (stat.isFile()) lines.push(`f ${childRel} ${modeOf(stat)} ${sha256(fs.readFileSync(file))}`);
      else lines.push(`o ${childRel}`);
    }
  };
  walk('');
  return { entries: lines.length, sha256: sha256(lines.join('\n')) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// A real 0.8 run: the commands of tools/fixtures-0.8/in-container.sh, in the same order.
// ---------------------------------------------------------------------------------------------------------------------------

/** A runner for the 0.8 command line in the person's HOME. `cli` is the path of the 0.8 `bowerloom` command. */
function oldCli(c, cli, home, cwd) {
  const env = childEnv({
    HOME: home,
    npm_config_userconfig: path.join(c.cfg, 'user.npmrc'),
    npm_config_globalconfig: path.join(c.cfg, 'global.npmrc'),
    npm_config_cache: c.cache,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  });
  const run = (args, where = cwd) => exec('command', cli, args, { env, cwd: where });
  const fail = (label, result) => new Error(`${label} failed (exit ${result.code}): ${clip(result.stderr, 600)} ${clip(result.stdout, 600)}`);
  /** The plan with --json to get the revision, then the same command with --approve <revision>. */
  const step = async (label, args, where = cwd) => {
    const plan = await run([...args, '--json'], where);
    let revision;
    try { revision = JSON.parse(plan.stdout.toString('utf8')).revision; } catch { revision = undefined; }
    if (!revision) throw fail(`${label} (plan)`, plan);
    const approved = await run([...args, '--approve', revision, '--json'], where);
    if (approved.code !== 0) throw fail(`${label} (approve)`, approved);
  };
  /** `harness install` refuses a rule that an engine carries more weakly. Each refused line that can be approved is accepted first. */
  const installAccepting = async (label, where = cwd) => {
    const first = await run(['harness', 'install', '--json'], where);
    let keys = [];
    try { keys = (JSON.parse(first.stdout.toString('utf8')).refused ?? []).filter(r => r.approvable).map(r => r.key); } catch { keys = []; }
    for (const key of keys) {
      const accepted = await run(['harness', 'accept', key, '--json'], where);
      if (accepted.code !== 0) throw fail(`harness accept ${key}`, accepted);
    }
    await step(label, ['harness', 'install'], where);
  };
  return { run, step, installAccepting, fail };
}

/** Fetch phase of the replay (network on): the pin, the project, adopt, install, the store items, use, sync, and lock update. */
async function replayBuild(proof, inputFile) {
  const dir = path.join(proof.work, 'replay');
  const c = { cfg: path.join(dir, 'cfg'), cache: path.join(dir, 'cache'), prefix: path.join(dir, 'prefix'), home: path.join(proof.work, 'person', 'home'), proxyPort: undefined };
  for (const d of [c.cfg, c.cache, c.prefix]) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(c.home, { recursive: true, mode: 0o700 });
  fs.chmodSync(c.home, 0o700);
  fs.writeFileSync(path.join(c.cfg, 'user.npmrc'), '');
  fs.writeFileSync(path.join(c.cfg, 'global.npmrc'), '');
  const tarball = path.join(proof.work, 'tarballs', `bowerloom-${OLD_VERSION}.tgz`);
  const installed = await npm({ ...c, home: dir }, ['install', '-g', '--prefix', c.prefix, tarball]);
  if (installed.code !== 0) throw new Error(`the 0.8 install for the replay failed: ${clip(installed.stderr, 800)}`);
  const cli = path.join(c.prefix, 'bin', 'bowerloom');
  const project = path.join(c.home, 'project');
  const old = oldCli(c, cli, c.home, proof.work);
  await old.step('skills add --global', ['skills', 'add', SKILL_SPEC, '--global']);
  const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  for (const [rel, text] of Object.entries(input.files)) {
    const file = path.join(project, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const inProject = { ...old, step: (label, args) => old.step(label, args, project), installAccepting: label => old.installAccepting(label, project) };
  await inProject.step('harness adopt', ['harness', 'adopt', '--every-engine', 'guardrails', '--every-engine', 'hooks', '--every-engine', 'mcp',
    '--pick', 'system-prompt/AGENTS.md=AGENTS.md', '--confirm', 'hooks/pre-tool-use-52407f3d', '--confirm', 'mcp/files', '--confirm', 'mcp/lint']);
  await inProject.installAccepting('harness install');
  await inProject.step('skill create --global', ['skill', 'create', 'house-style', '--global']);
  await inProject.step('prompt create --global', ['prompt', 'create', 'weekly-update', '--global']);
  await inProject.step('team create --global', ['team', 'create', 'review-desk', '--global']);
  await inProject.step('use skill', ['use', 'skill', 'tanstack-db-collections']);
  await inProject.step('skills sync', ['skills', 'sync']);
  await inProject.step('lock update', ['lock', 'update', '--item', 'skill:tanstack-db-collections']);
  return { cli, home: c.home, project };
}

/** Run phase of the replay (no network): apply and lock verify. */
async function replayFinish(proof, replay) {
  const dir = path.join(proof.work, 'replay');
  const c = { cfg: path.join(dir, 'cfg'), cache: path.join(dir, 'cache') };
  const old = oldCli(c, replay.cli, replay.home, replay.project);
  await old.step('apply', ['apply']);
  const verified = await old.run(['lock', 'verify', '--json']);
  if (verified.code !== 0) throw old.fail('lock verify', verified);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The fetch phase.
// ---------------------------------------------------------------------------------------------------------------------------

async function fetchPhase(proof) {
  const info = { phase: 'fetch', node: process.version, npm: null, listedIntegrity: null, packedIntegrity: null, pack: null, error: null, replay: { ok: false, error: null } };
  const dirs = ['tarballs', 'out', 'input', 'fetch'];
  for (const d of dirs) fs.mkdirSync(path.join(proof.work, d), { recursive: true });
  const c = { cfg: path.join(proof.work, 'fetch', 'cfg'), cache: path.join(proof.work, 'fetch', 'cache'), home: path.join(proof.work, 'fetch', 'home'), prefix: undefined };
  for (const d of [c.cfg, c.cache, c.home]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(c.cfg, 'user.npmrc'), '');
  fs.writeFileSync(path.join(c.cfg, 'global.npmrc'), '');
  info.npm = (await npm(c, ['--version'])).stdout.toString('utf8').trim();

  // The only read of the 0.8 tarball. The proof checks its bytes against the integrity above.
  const packed = await npm(c, ['pack', `bowerloom@${OLD_VERSION}`, '--pack-destination', path.join(proof.work, 'tarballs'), '--json']);
  if (packed.code !== 0) {
    info.error = `npm pack failed (exit ${packed.code}): ${clip(packed.stderr, 800)}`;
  } else {
    try {
      info.pack = JSON.parse(packed.stdout.toString('utf8'))[0];
      const file = path.join(proof.work, 'tarballs', info.pack.filename);
      info.packedIntegrity = digestsOf(fs.readFileSync(file)).integrity;
    } catch (error) {
      info.error = `the output of npm pack could not be read: ${error.message}`;
    }
    const listed = await npm(c, ['view', `bowerloom@${OLD_VERSION}`, 'dist.integrity']);
    info.listedIntegrity = listed.stdout.toString('utf8').trim() || null;
  }

  // A real 0.8 run in a person's HOME, from the tarball that was just fetched. It reads the pinned skill, so it belongs in this phase.
  if (info.error === null && info.packedIntegrity === OLD_INTEGRITY) {
    try {
      const replay = await replayBuild(proof, path.join(proof.work, 'input', 'project.json'));
      fs.writeFileSync(path.join(proof.work, 'out', 'replay.json'), JSON.stringify(replay));
      info.replay.ok = true;
    } catch (error) {
      info.replay.error = String(error.message);
    }
  } else {
    info.replay.error = 'not run: the 0.8 tarball was not fetched, or its integrity differs';
  }
  info.commandLog = commandLog;
  fs.writeFileSync(path.join(proof.work, 'out', 'fetch.json'), JSON.stringify(info, null, 2));
  return info;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The run phase.
// ---------------------------------------------------------------------------------------------------------------------------

/** Packs a copy of the stand-in with the changes in `edit`, and returns the path of the tarball. */
async function packStandin(proof, label, edit) {
  const copy = path.join(proof.work, 'pack', label);
  fs.cpSync(path.join(proof.standin), copy, { recursive: true });
  const file = path.join(copy, 'package.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(record);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  const c = { cfg: path.join(proof.work, 'pack', `${label}-cfg`), cache: path.join(proof.work, 'pack', `${label}-cache`), home: path.join(proof.work, 'pack', `${label}-home`) };
  for (const d of Object.values(c)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(c.cfg, 'user.npmrc'), '');
  fs.writeFileSync(path.join(c.cfg, 'global.npmrc'), '');
  const dest = path.join(proof.work, 'tarballs', 'standins');
  fs.mkdirSync(dest, { recursive: true });
  const result = await npm(c, ['pack', copy, '--pack-destination', dest, '--json']);
  if (result.code !== 0) throw new Error(`npm pack of the stand-in ${label} failed: ${clip(result.stderr, 600)}`);
  const entry = JSON.parse(result.stdout.toString('utf8'))[0];
  return { file: path.join(dest, entry.filename), pack: { integrity: entry.integrity, shasum: entry.shasum } };
}

function findFinal(work) {
  const dir = path.join(work, 'tarballs', 'final-bowerloom');
  if (!fs.existsSync(dir)) return null;
  const names = fs.readdirSync(dir).filter(n => n.endsWith('.tgz'));
  return names.length === 1 ? path.join(dir, names[0]) : null;
}

const same = (a, b) => Buffer.compare(a, b) === 0;
const verdict = (problems, ok, observed = {}) => ({ status: problems.length === 0 ? 'pass' : 'fail', detail: problems.length === 0 ? ok : problems.join(' '), observed });
const notRun = (reason, observed = {}) => ({ status: 'not run', detail: `not run: ${reason}`, observed });

async function runPhase(proof, fetched) {
  const checks = {};
  const nodeVersion = process.version;
  const npmVersion = (await exec('npm', 'npm', ['--version'], { env: childEnv({ HOME: proof.work }) })).stdout.toString('utf8').trim();
  const oldTar = path.join(proof.work, 'tarballs', `bowerloom-${OLD_VERSION}.tgz`);
  const finalTar = findFinal(proof.work);
  const hasOld = fs.existsSync(oldTar);
  const NO_FINAL = 'no final bowerloom tarball';
  // In container mode the fetch phase ran in another process. Its log is in fetch.json. In host mode both phases share one log.
  const fullLog = () => (proof.mode === 'container' ? [...(fetched.commandLog ?? []), ...commandLog] : commandLog);

  // The stand-ins and the static registry.
  const first = await packStandin(proof, 'latebrake-1', () => {});
  const standinVersion = JSON.parse(fs.readFileSync(path.join(proof.standin, 'package.json'), 'utf8')).version;
  const second = await packStandin(proof, 'latebrake-2', record => { record.version = OTHER_LATEBRAKE; });
  const clash = await packStandin(proof, 'clash', record => { record.name = 'bowerloom-clash'; record.version = '1.0.0'; record.bin = { bowerloom: 'probe.mjs' }; });
  const listed = [first, second, clash];
  if (hasOld) listed.push({ file: oldTar });
  let finalManifest = null;
  if (finalTar !== null) { listed.push({ file: finalTar }); finalManifest = readManifest(finalTar); }
  const tags = { latebrake: { latest: standinVersion } };
  if (finalManifest !== null) tags.bowerloom = { latest: finalManifest.version, beta: finalManifest.version };
  else if (hasOld) tags.bowerloom = { latest: OLD_VERSION, beta: OLD_VERSION };
  const registry = await startRegistry({ packages: listed, tags });
  proof.registry = registry;
  const hashes = {};
  for (const [label, file] of [['bowerloom-0.8', hasOld ? oldTar : null], ['final-bowerloom', finalTar], ['latebrake-standin', first.file], ['latebrake-standin-other', second.file], ['bowerloom-clash-standin', clash.file]]) {
    if (file !== null) hashes[label] = { file: path.basename(file), bytes: fs.statSync(file).size, ...digestsOf(fs.readFileSync(file)), sha256: sha256(fs.readFileSync(file)) };
  }
  const realLatebrake = path.join(proof.work, 'tarballs', 'latebrake-real');
  const realFiles = fs.existsSync(realLatebrake) ? fs.readdirSync(realLatebrake).filter(n => n.endsWith('.tgz')) : [];
  if (realFiles.length === 1) { const bytes = fs.readFileSync(path.join(realLatebrake, realFiles[0])); hashes['latebrake-real'] = { file: realFiles[0], bytes: bytes.length, ...digestsOf(bytes), sha256: sha256(bytes) }; }

  /** The direct run of the stand-in: a global install of it alone, which the shims are compared with. */
  const ref = newCase(proof, 'reference');
  const refInstall = await installGlobal(ref, `latebrake@${standinVersion}`);
  const direct = (command, args, input) => runLink(ref, command, args, input);

  const check = async (id, title, fn) => {
    try { checks[id] = { id, title, ...(await fn()) }; } catch (error) { checks[id] = { id, title, status: 'fail', detail: `The check stopped on an error: ${error.message}`, observed: {} }; }
  };

  // C1: the fetch.
  await check('C1', 'Fetch', async () => {
    const problems = [];
    const observed = { integrityExpected: OLD_INTEGRITY, integrityListedByRegistry: fetched.listedIntegrity, integrityOfBytes: fetched.packedIntegrity, bin: null };
    if (fetched.error) problems.push(`The fetch failed: ${fetched.error}`);
    if (!hasOld) problems.push('The 0.8 tarball is not in the work folder.');
    if (hasOld) {
      const bytesIntegrity = digestsOf(fs.readFileSync(oldTar)).integrity;
      observed.integrityOfBytes = bytesIntegrity;
      if (bytesIntegrity !== OLD_INTEGRITY) problems.push('The bytes of the 0.8 tarball do not match the integrity of the registry.');
      if (fetched.listedIntegrity !== OLD_INTEGRITY) problems.push('The registry no longer lists the integrity that this proof was written against.');
      const bin = readManifest(oldTar).bin;
      observed.bin = bin;
      if (JSON.stringify(Object.keys(bin ?? {}).sort()) !== JSON.stringify(OLD_BINS)) problems.push(`The bin of the 0.8 tarball is ${JSON.stringify(Object.keys(bin ?? {}).sort())}, not the three old commands.`);
    }
    return verdict(problems, 'The 0.8 tarball matches the integrity of the registry, and its bin names exactly bowerloom, bowerloom-guard, and bowerloom-mcp.', observed);
  });

  // C2: 0.8 alone.
  await check('C2', '0.8 alone', async () => {
    const c = newCase(proof, 'c2');
    try {
      const problems = [];
      const install = await installGlobal(c, `bowerloom@${OLD_VERSION}`);
      if (install.code !== 0) problems.push(`npm install exited ${install.code}.`);
      const found = links(c);
      if (JSON.stringify(Object.keys(found).sort()) !== JSON.stringify(OLD_BINS)) problems.push(`The links are ${JSON.stringify(Object.keys(found))}, not the three old commands.`);
      for (const [name, entry] of Object.entries(found)) if (packageOfLink(entry) !== 'bowerloom') problems.push(`The link ${name} does not point into lib/node_modules/bowerloom.`);
      const version = await runLink(c, 'bowerloom', ['--version']);
      if (version.code !== 0) problems.push(`bowerloom --version exited ${version.code}.`);
      if (!version.stdout.toString('utf8').includes(OLD_VERSION)) problems.push(`bowerloom --version did not name ${OLD_VERSION}.`);
      return verdict(problems, 'The prefix has the three links into lib/node_modules/bowerloom, and bowerloom --version exits 0 and names 0.8.0-beta.1.', {
        links: found, versionStdout: clip(version.stdout, 400), versionStderr: clip(version.stderr, 400), npmStdout: clip(install.stdout), npmStderr: clip(install.stderr),
      });
    } finally { dropCase(c); }
  });

  // C3 and C4: the 0.8 package and the stand-in, in both orders.
  const sideBySide = async (id, title, name, order) => check(id, title, async () => {
    const c = newCase(proof, name);
    try {
      const problems = [];
      const steps = [];
      const record = async (label, spec) => {
        const before = links(c);
        const result = await installGlobal(c, spec);
        steps.push({ step: label, exit: result.code, npmStdout: clip(result.stdout, 1500), npmStderr: clip(result.stderr, 1500) });
        if (result.code !== 0) problems.push(`${label} exited ${result.code}.`);
        return before;
      };
      let afterFirst;
      for (const [index, spec] of order.entries()) {
        await record(`npm install -g ${spec}`, spec);
        if (index === 0) afterFirst = links(c);
      }
      const finalLinks = links(c);
      const all = [...OLD_BINS, ...NEW_BINS].sort();
      if (JSON.stringify(Object.keys(finalLinks).sort()) !== JSON.stringify(all)) problems.push(`The links are ${JSON.stringify(Object.keys(finalLinks).sort())}, not the six commands.`);
      for (const name of OLD_BINS) if (packageOfLink(finalLinks[name]) !== 'bowerloom') problems.push(`The link ${name} does not point into its own package.`);
      for (const name of NEW_BINS) if (packageOfLink(finalLinks[name]) !== 'latebrake') problems.push(`The link ${name} does not point into its own package.`);
      for (const [name, entry] of Object.entries(afterFirst ?? {})) if (JSON.stringify(finalLinks[name]) !== JSON.stringify(entry)) problems.push(`The link ${name} was replaced by the second install.`);
      return verdict(problems, 'The second install exits 0. Six links exist, each into its own package, and no link of the first install was replaced.', { steps, links: finalLinks });
    } finally { dropCase(c); }
  });
  await sideBySide('C3', '0.8, then latebrake', 'c3', [`bowerloom@${OLD_VERSION}`, 'latebrake']);
  await sideBySide('C4', 'latebrake, then 0.8', 'c4', ['latebrake', `bowerloom@${OLD_VERSION}`]);

  // Each old command and the stand-in command that it must forward to. The cases cover the arguments, the standard input, and the exit codes.
  const FORWARD_CASES = [
    { args: ['--exit=0'], input: 'one line\n' },
    { args: ['alpha', 'beta gamma', '--exit=3'], input: 'two words\nand a second line\n' },
    { args: ['--exit=130'], input: '' },
    { args: ['--quiet'], input: 'ignored\n' },
  ];

  // C5: the upgrade from 0.8 to the final package.
  await check('C5', 'Upgrade 0.8 to the final bowerloom', async () => {
    if (finalTar === null) return notRun(NO_FINAL);
    const c = newCase(proof, 'c5');
    try {
      const problems = [];
      const first = await installGlobal(c, `bowerloom@${OLD_VERSION}`);
      if (first.code !== 0) problems.push(`The install of 0.8 exited ${first.code}.`);
      const upgrade = await installGlobal(c, 'bowerloom@latest');
      if (upgrade.code !== 0) problems.push(`npm install -g bowerloom@latest exited ${upgrade.code}.`);
      const found = links(c);
      const installed = packages(c);
      if (installed.bowerloom !== finalManifest.version) problems.push(`The installed bowerloom is ${installed.bowerloom}, not ${finalManifest.version}.`);
      for (const name of OLD_BINS) {
        const entry = found[name];
        const expected = `bin/${name}.js`;
        if (!entry || packageOfLink(entry) !== 'bowerloom' || !entry.target.endsWith(`/bowerloom/${expected}`)) problems.push(`The link ${name} does not point at the shim ${expected}.`);
        if (entry && !entry.resolves) problems.push(`The link ${name} points nowhere.`);
      }
      const latebrakeLinks = Object.keys(found).filter(name => NEW_BINS.includes(name));
      const forwarding = [];
      for (const [oldName, newName] of PAIRS) {
        for (const scenario of FORWARD_CASES) {
          const via = await runLink(c, oldName, scenario.args, scenario.input);
          const dir = await direct(newName, scenario.args, scenario.input);
          // A probe that is told to be quiet writes no stdout, so only the bytes and the exit code are compared for it.
          const echoed = scenario.args.includes('--quiet') ? true : via.probe?.input === scenario.input;
          const ok = same(via.stdout, dir.stdout) && via.code === dir.code && echoed;
          if (!ok) problems.push(`${oldName} ${scenario.args.join(' ')} differs from a direct ${newName} (exit ${via.code} and ${dir.code}).`);
          forwarding.push({ command: oldName, args: scenario.args, exit: via.code, directExit: dir.code, stdoutEqual: same(via.stdout, dir.stdout), stdinEchoed: echoed });
        }
      }
      return verdict(problems, 'npm install -g bowerloom@latest exits 0, the three old links point at the shims, and each old command forwards stdout bytes, the exit code, and standard input exactly as a direct run of the stand-in.', {
        npmUpgradeStdout: clip(upgrade.stdout), npmUpgradeStderr: clip(upgrade.stderr), npmFirstStdout: clip(first.stdout, 800),
        linksAfter: found, packagesAfter: installed, nestedLatebrake: nestedLatebrake(c),
        npmLinkedLatebrakeCommandsFromNestedCopy: latebrakeLinks.length > 0, latebrakeLinks, forwarding,
      });
    } finally { dropCase(c); }
  });

  // C6: the final package beside a global stand-in, in both orders.
  // The global copy is installed at a version that differs from the nested copy, and at the pinned version. At the pinned version the
  // version cannot tell the copies apart, so each probe is run with --which, which makes it print where its own files are.
  const finalBeside = async (name, order, globalVersion) => {
    const c = newCase(proof, name);
    try {
      const problems = [];
      const steps = [];
      for (const spec of order) {
        const result = await installGlobal(c, spec);
        steps.push({ step: `npm install -g ${spec}`, exit: result.code, npmStdout: clip(result.stdout, 1500), npmStderr: clip(result.stderr, 1500) });
        if (result.code !== 0) problems.push(`npm install -g ${spec} exited ${result.code}.`);
      }
      const found = links(c);
      const all = [...OLD_BINS, ...NEW_BINS].sort();
      if (JSON.stringify(Object.keys(found).sort()) !== JSON.stringify(all)) problems.push(`The links are ${JSON.stringify(Object.keys(found).sort())}, not the six commands.`);
      const ran = {};
      for (const [oldName, newName] of PAIRS) {
        const viaOld = await runLink(c, oldName, ['--which', '--exit=0'], 'in\n');
        const viaNew = await runLink(c, newName, ['--which', '--exit=0'], 'in\n');
        ran[oldName] = { version: viaOld.probe?.version ?? null, copy: viaOld.probe?.copy ?? null };
        ran[newName] = { version: viaNew.probe?.version ?? null, copy: viaNew.probe?.copy ?? null };
        if (ran[oldName].copy !== 'nested' || ran[oldName].version !== standinVersion) problems.push(`${oldName} ran the ${ran[oldName].copy} copy at version ${ran[oldName].version}, not the nested copy ${standinVersion}.`);
        if (ran[newName].copy !== 'global' || ran[newName].version !== globalVersion) problems.push(`${newName} ran the ${ran[newName].copy} copy at version ${ran[newName].version}, not the global copy ${globalVersion}.`);
      }
      return verdict(problems, `No clash. The old commands run the nested copy (${standinVersion}), and the new commands run the global copy (${globalVersion}).`, { steps, links: found, packages: packages(c), nestedLatebrake: nestedLatebrake(c), eachCommandRuns: ran });
    } finally { dropCase(c); }
  };
  await check('C6', 'The final bowerloom beside a global latebrake, in both orders', async () => {
    if (finalTar === null) return notRun(NO_FINAL);
    const runs = {};
    const problems = [];
    for (const [label, name, order, globalVersion] of [
      ['final first, global latebrake at another version', 'c6a', ['bowerloom@latest', `latebrake@${OTHER_LATEBRAKE}`], OTHER_LATEBRAKE],
      ['latebrake first, at another version', 'c6b', [`latebrake@${OTHER_LATEBRAKE}`, 'bowerloom@latest'], OTHER_LATEBRAKE],
      ['final first, global latebrake at the pinned version', 'c6c', ['bowerloom@latest', `latebrake@${standinVersion}`], standinVersion],
      ['latebrake first, at the pinned version', 'c6d', [`latebrake@${standinVersion}`, 'bowerloom@latest'], standinVersion],
    ]) {
      const result = await finalBeside(name, order, globalVersion);
      runs[label] = { status: result.status, detail: result.detail, observed: result.observed };
      if (result.status !== 'pass') problems.push(`${label}: ${result.detail}`);
    }
    return verdict(problems, 'No clash in any of the four runs. The old commands run the nested copy, and the new commands run the global copy. The probe marker, not the version alone, tells the copies apart.', { runs });
  });

  // C7: one command name in two packages. Both orders are recorded.
  await check('C7', 'The same command name in two packages', async () => {
    if (!hasOld) return verdict(['The 0.8 tarball is not available.'], '', {});
    const problems = [];
    const orders = {};
    for (const [label, name, specs] of [['0.8 first, then the second package', 'c7a', [`bowerloom@${OLD_VERSION}`, 'bowerloom-clash']], ['the second package first, then 0.8', 'c7b', ['bowerloom-clash', `bowerloom@${OLD_VERSION}`]]]) {
      const c = newCase(proof, name);
      try {
        const run = { steps: [] };
        for (const [index, spec] of specs.entries()) {
          const plainFirst = index === 0;
          const result = await installGlobal(c, spec);
          const step = { step: `npm install -g ${spec}`, exit: result.code, npmStdout: clip(result.stdout), npmStderr: clip(result.stderr), bowerloomLinkInto: packageOfLink(links(c).bowerloom) };
          run.steps.push(step);
          if (plainFirst && result.code !== 0) problems.push(`${label}: the first install exited ${result.code}.`);
          if (!plainFirst && result.code !== 0) {
            // npm refused. The record also holds what --force does.
            const forced = await installGlobal(c, '--force', spec);
            run.steps.push({ step: `npm install -g --force ${spec}`, exit: forced.code, npmStdout: clip(forced.stdout), npmStderr: clip(forced.stderr), bowerloomLinkInto: packageOfLink(links(c).bowerloom) });
          }
        }
        const finalLinks = links(c);
        const firstSpecWasOld = specs[0].startsWith('bowerloom@');
        const owner = packageOfLink(finalLinks.bowerloom);
        const plainSecond = run.steps[1];
        const refused = plainSecond.exit !== 0;
        run.behaviour = refused
          ? (run.steps.at(-1).exit === 0 ? 'npm refused the second install, and --force replaced the link' : 'npm refused the second install, and --force was refused too')
          : (owner === (firstSpecWasOld ? 'bowerloom' : 'bowerloom-clash') ? 'npm accepted the second install and kept the first link' : 'npm accepted the second install and replaced the link');
        run.bowerloomLinkOwner = owner;
        run.links = finalLinks;
        run.packages = packages(c);
        run.danglingLinks = dangling(c);
        orders[label] = run;
        if (run.danglingLinks.length > 0) problems.push(`${label}: these links point nowhere: ${run.danglingLinks.join(', ')}.`);
        for (const [pkg, version] of Object.entries(run.packages)) if (version === null) problems.push(`${label}: lib/node_modules/${pkg} has no package.json.`);
      } finally { dropCase(c); }
    }
    return verdict(problems, 'The behaviour of npm for one command name in two packages is recorded, and the prefix is whole after each order.', { orders });
  });

  // C8: uninstall, in each order.
  await check('C8', 'Uninstall in each order', async () => {
    if (finalTar === null) return notRun(NO_FINAL);
    const problems = [];
    const record = {};
    for (const [label, name, firstRemoved] of [['remove bowerloom first', 'c8a', 'bowerloom'], ['remove latebrake first', 'c8b', 'latebrake']]) {
      const c = newCase(proof, name);
      try {
        const steps = [];
        const note = (step, result) => steps.push({ step, exit: result.code, npmStdout: clip(result.stdout, 1500), npmStderr: clip(result.stderr, 1500), ...snapshot(c), danglingLinks: dangling(c) });
        for (const spec of ['bowerloom@latest', `latebrake@${OTHER_LATEBRAKE}`]) {
          const result = await installGlobal(c, spec);
          if (result.code !== 0) problems.push(`${label}: npm install -g ${spec} exited ${result.code}.`);
        }
        const removed = await uninstallGlobal(c, firstRemoved);
        note(`npm uninstall -g ${firstRemoved}`, removed);
        if (removed.code !== 0) problems.push(`${label}: npm uninstall -g ${firstRemoved} exited ${removed.code}.`);
        const left = links(c);
        if (firstRemoved === 'bowerloom') {
          if (JSON.stringify(Object.keys(left).sort()) !== JSON.stringify(NEW_BINS)) problems.push(`${label}: after the removal the links are ${JSON.stringify(Object.keys(left).sort())}, not the three latebrake commands.`);
          const working = await runLink(c, 'latebrake', ['--exit=0'], 'in\n');
          if (working.code !== 0 || working.probe?.version !== OTHER_LATEBRAKE) problems.push(`${label}: the global latebrake does not work after the removal.`);
        } else {
          if (JSON.stringify(Object.keys(left).sort()) !== JSON.stringify(OLD_BINS)) problems.push(`${label}: after the removal the links are ${JSON.stringify(Object.keys(left).sort())}, not the three old commands.`);
          for (const [oldName] of PAIRS) {
            const working = await runLink(c, oldName, ['--exit=0'], 'in\n');
            if (working.code !== 0 || working.probe?.version !== standinVersion) problems.push(`${label}: ${oldName} does not work through the nested copy after the removal.`);
          }
        }
        if (dangling(c).length > 0) problems.push(`${label}: links point nowhere after the first removal: ${dangling(c).join(', ')}.`);
        const other = firstRemoved === 'bowerloom' ? 'latebrake' : 'bowerloom';
        const removedBoth = await uninstallGlobal(c, other);
        note(`npm uninstall -g ${other}`, removedBoth);
        if (removedBoth.code !== 0) problems.push(`${label}: npm uninstall -g ${other} exited ${removedBoth.code}.`);
        const rest = snapshot(c);
        if (Object.keys(rest.links).length !== 0) problems.push(`${label}: bin is not empty after both removals: ${JSON.stringify(Object.keys(rest.links))}.`);
        if (Object.keys(rest.packages).length !== 0) problems.push(`${label}: lib/node_modules is not empty after both removals: ${JSON.stringify(Object.keys(rest.packages))}.`);
        record[label] = steps;
      } finally { dropCase(c); }
    }
    return verdict(problems, 'Removing the final bowerloom leaves latebrake working and removes the three old links. Removing latebrake leaves the old commands working through the nested copy. Removing both leaves an empty bin and an empty lib/node_modules. No step leaves a link that points nowhere.', { record });
  });

  // C9: the files of a person do not change.
  await check('C9', "The person's files", async () => {
    if (!hasOld) return verdict(['The 0.8 tarball is not available.'], '', {});
    if (!fetched.replay.ok) return verdict([`The real 0.8 run did not finish: ${fetched.replay.error}`], '', {});
    const replay = JSON.parse(fs.readFileSync(path.join(proof.work, 'out', 'replay.json'), 'utf8'));
    await replayFinish(proof, replay);
    const home = replay.home;
    const c = newCase(proof, 'c9', { home });
    try {
      const problems = [];
      const trees = () => ({
        project: treeHash(path.join(home, 'project')),
        store: treeHash(path.join(home, '.bowerloom')),
        state: treeHash(path.join(home, '.local', 'state', 'bowerloom')),
        home: treeHash(home),
        npmSettings: treeHash(c.cfg),
      });
      const baseline = trees();
      for (const [name, tree] of Object.entries({ project: baseline.project, store: baseline.store, state: baseline.state })) if (tree.absent || tree.entries === 0) problems.push(`The real 0.8 run left no ${name} tree to compare.`);
      const sequence = [
        ['npm install -g bowerloom@0.8.0-beta.1', () => installGlobal(c, `bowerloom@${OLD_VERSION}`)],
        [`npm install -g latebrake@${OTHER_LATEBRAKE}`, () => installGlobal(c, `latebrake@${OTHER_LATEBRAKE}`)],
        ...(finalTar !== null ? [['npm install -g bowerloom@latest', () => installGlobal(c, 'bowerloom@latest')]] : []),
        ['npm uninstall -g latebrake', () => uninstallGlobal(c, 'latebrake')],
        ['npm uninstall -g bowerloom', () => uninstallGlobal(c, 'bowerloom')],
      ];
      const steps = [];
      for (const [label, action] of sequence) {
        const result = await action();
        const after = trees();
        const changed = Object.keys(baseline).filter(key => JSON.stringify(after[key]) !== JSON.stringify(baseline[key]));
        steps.push({ step: label, exit: result.code, changed });
        if (result.code !== 0) problems.push(`${label} exited ${result.code}.`);
        if (changed.length > 0) problems.push(`After ${label}, these trees changed: ${changed.join(', ')}.`);
      }
      return verdict(problems, 'A real 0.8 run made the project, the store, and the state trees. Their SHA-256 values, and the whole HOME, are the same before and after each npm step.', { baseline, steps, ranOnlyAgainst: finalTar === null ? 'the 0.8 package and the stand-in (no final bowerloom tarball)' : 'the 0.8 package, the stand-in, and the final bowerloom' });
    } finally { dropCase(c); }
  });

  // C10 and C11 use one prefix with the final package.
  await check('C10', 'Clean stdout', async () => {
    if (finalTar === null) return notRun(NO_FINAL);
    const c = newCase(proof, 'c10');
    try {
      const problems = [];
      const install = await installGlobal(c, 'bowerloom@latest');
      if (install.code !== 0) problems.push(`npm install -g bowerloom@latest exited ${install.code}.`);
      const rows = [];
      const quiet = [['bowerloom-mcp', []], ['bowerloom-guard', []], ['bowerloom', ['context', 'guard']]];
      for (const [command, extra] of quiet) {
        const result = await runLink(c, command, [...extra, '--quiet'], '');
        const clean = result.stdout.length === 0 && result.stderr.toString('utf8') === PROBE_STDERR && result.code === 0;
        if (!clean) problems.push(`${[command, ...extra].join(' ')} is not clean: stdout ${result.stdout.length} bytes, stderr ${JSON.stringify(clip(result.stderr, 200))}.`);
        rows.push({ command: [command, ...extra].join(' '), stdoutBytes: result.stdout.length, stderr: clip(result.stderr, 200), exit: result.code });
      }
      for (const args of [['--json'], [], ['harness', 'status']]) {
        const via = await runLink(c, 'bowerloom', args, '');
        const dir = await direct('latebrake', args, '');
        const clean = same(via.stdout, dir.stdout) && via.stderr.toString('utf8') === PROBE_STDERR;
        if (!clean) problems.push(`bowerloom ${args.join(' ')} with stdout to a pipe differs from a direct run or prints a notice: stderr ${JSON.stringify(clip(via.stderr, 200))}.`);
        rows.push({ command: `bowerloom ${args.join(' ')}`.trim(), stdoutEqualsDirect: same(via.stdout, dir.stdout), stderr: clip(via.stderr, 200), exit: via.code });
      }
      return verdict(problems, 'Through the shims, bowerloom-mcp, bowerloom-guard, and bowerloom context guard add zero bytes to stdout and print no notice. bowerloom --json, and bowerloom with stdout to a pipe, print no notice.', { rows });
    } finally { dropCase(c); }
  });

  await check('C11', 'Fail closed', async () => {
    if (finalTar === null) return notRun(NO_FINAL);
    const c = newCase(proof, 'c11');
    try {
      const problems = [];
      const install = await installGlobal(c, 'bowerloom@latest');
      if (install.code !== 0) problems.push(`npm install -g bowerloom@latest exited ${install.code}.`);
      const entry = path.join(c.prefix, 'lib', 'node_modules', 'bowerloom', 'node_modules', 'latebrake', 'probe.mjs');
      if (!fs.existsSync(entry)) problems.push('The nested latebrake entry file is not where the proof expects it.');
      fs.rmSync(entry, { force: true });
      const guard = await runLink(c, 'bowerloom-guard', [], '{"tool":"example"}\n');
      const lines = guard.stdout.toString('utf8').split('\n');
      let decision = null;
      try { decision = JSON.parse(lines[0]).hookSpecificOutput?.permissionDecision; } catch { decision = null; }
      if (!(lines.length === 2 && lines[1] === '' && decision === 'deny' && guard.code === 0)) problems.push(`bowerloom-guard did not print exactly one deny line and exit 0 (exit ${guard.code}, stdout ${JSON.stringify(clip(guard.stdout, 300))}).`);
      const hook = await runLink(c, 'bowerloom', ['context', 'guard'], '');
      if (!(hook.code === 2 && hook.stdout.length === 0)) problems.push(`bowerloom context guard did not exit 2 with empty stdout (exit ${hook.code}, ${hook.stdout.length} bytes).`);
      const mcp = await runLink(c, 'bowerloom-mcp', [], '');
      if (!(mcp.code !== 0 && mcp.stdout.length === 0)) problems.push(`bowerloom-mcp did not exit non-zero with empty stdout (exit ${mcp.code}, ${mcp.stdout.length} bytes).`);
      const cli = await runLink(c, 'bowerloom', ['harness', 'status'], '');
      return verdict(problems, 'With the nested latebrake entry file removed, bowerloom-guard prints exactly one deny line and exits 0, bowerloom context guard exits 2 with empty stdout, and bowerloom-mcp exits non-zero with empty stdout.', {
        guard: { exit: guard.code, stdout: clip(guard.stdout, 600), stderr: clip(guard.stderr, 300) },
        contextGuard: { exit: hook.code, stdoutBytes: hook.stdout.length, stderr: clip(hook.stderr, 300) },
        mcp: { exit: mcp.code, stdoutBytes: mcp.stdout.length, stderr: clip(mcp.stderr, 300) },
        cliForRecord: { exit: cli.code, stdoutBytes: cli.stdout.length, stderr: clip(cli.stderr, 300) },
      });
    } finally { dropCase(c); }
  });

  // C12: no network in the run phase.
  await check('C12', 'No network', async () => {
    const problems = [];
    const outside = registry.requests.filter(r => !['127.0.0.1', '::ffff:127.0.0.1'].includes(r.remote));
    const methods = [...new Set(registry.requests.map(r => r.method))];
    if (outside.length > 0) problems.push(`${outside.length} requests came from an address that is not 127.0.0.1.`);
    // One read of a real host must fail: the proxy points at a closed port (host mode), or there is no network (container mode).
    const probeCase = newCase(proof, 'c12');
    let externalRead;
    try {
      const attempt = await npm(probeCase, ['view', 'bowerloom', 'version', '--registry', 'https://registry.npmjs.org']);
      externalRead = { exit: attempt.code, stderr: clip(attempt.stderr, 500) };
      if (attempt.code === 0) problems.push('A request to registry.npmjs.org succeeded in the run phase.');
    } finally { dropCase(probeCase); }
    const interfaces = Object.entries(os.networkInterfaces()).map(([name, list]) => ({ name, addresses: (list ?? []).map(a => `${a.address}${a.internal ? ' (internal)' : ''}`) }));
    const external = Object.entries(os.networkInterfaces()).flatMap(([, list]) => (list ?? []).filter(a => !a.internal));
    if (proof.mode === 'container' && external.length > 0) problems.push('The container has a network interface other than loopback.');
    return verdict(problems, 'Every request of the run phase came from 127.0.0.1, a read of registry.npmjs.org failed, and the run phase had no route out.', {
      requestsToStaticRegistry: registry.requests.length, methodsSeen: methods, requestsFromOtherAddresses: outside.length, externalRead,
      mode: proof.mode, proxyPort: proof.proxyPort ?? null, interfaces,
    });
  });

  // C13: no write to a registry. This check reads the command log of the whole run, so it runs last of the ones that use npm.
  await check('C13', 'No write to a registry', async () => {
    const problems = [];
    const npmCommands = fullLog().filter(entry => entry.tool === 'npm');
    const verbs = npmCommands.map(entry => entry.argv.slice(1).find(arg => !arg.startsWith('-')) ?? entry.argv[1]);
    const outsideList = [...new Set(verbs.filter(verb => !ALLOWED_NPM.has(verb)))];
    if (outsideList.length > 0) problems.push(`These npm commands are not on the allowed list: ${outsideList.join(', ')}.`);
    const badEnv = [...new Set(fullLog().flatMap(entry => entry.envNames ?? []).filter(name => !ALLOWED_ENV.has(name)))];
    if (badEnv.length > 0) problems.push(`These environment names reached a child process: ${badEnv.join(', ')}.`);
    const counts = {};
    for (const verb of verbs) counts[verb] = (counts[verb] ?? 0) + 1;
    return verdict(problems, 'Every npm command of the run is a pack, install, uninstall, view, ls, or version command, and no child process had an environment name beyond PATH, HOME, LANG, and the 12 exact npm settings that the driver sets.', { npmCommandCount: npmCommands.length, verbs: counts, requestMethodsAtRegistry: [...new Set(registry.requests.map(r => r.method))] });
  });

  checks.C14 = { id: 'C14', title: 'Real code', status: 'not run', detail: 'not run by design: the byte test needs the real latebrake tarball, and a real latebrake cannot be built before the rename.', observed: { latebrakeTarballGiven: 'latebrake-real' in hashes, latebrakeTarball: hashes['latebrake-real'] ?? null } };

  await registry.close();
  dropCase(ref);
  const folded = { ...checks };
  const summary = { pass: 0, fail: 0, 'not run': 0 };
  for (const entry of Object.values(folded)) summary[entry.status] += 1;
  return {
    schema: SCHEMA,
    mode: proof.mode,
    finishedAt: new Date().toISOString(),
    node: nodeVersion,
    npm: npmVersion,
    platform: `${process.platform}/${process.arch}`,
    user: typeof process.getuid === 'function' ? { uid: process.getuid() } : null,
    referenceInstallExit: refInstall.code,
    tarballs: hashes,
    registryPackages: registry.packages,
    summary,
    checks: Object.fromEntries(Object.keys(folded).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map(key => [key, folded[key]])),
    commandLog: fullLog().map(entry => ({ tool: entry.tool, argv: entry.argv, exit: entry.exit })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Modes.
// ---------------------------------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { mode: 'container', keep: false, inner: null, innerArg: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => { i += 1; if (argv[i] === undefined) throw new Error(`${arg} needs a value`); return argv[i]; };
    if (arg === '--out') opts.out = value();
    else if (arg === '--mode') opts.mode = value();
    else if (arg === '--latebrake-tarball') opts.latebrakeTarball = value();
    else if (arg === '--final-bowerloom-tarball') opts.finalTarball = value();
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--inner') { opts.inner = value(); if (opts.inner === 'put' || opts.inner === 'get') opts.innerArg = value(); }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['container', 'host'].includes(opts.mode)) throw new Error('--mode is container or host');
  return opts;
}

function prepareOut(out) {
  if (!out) throw new Error('--out <folder> is required. It must not exist yet, or be empty, and must be outside the repository.');
  const abs = path.resolve(out);
  const relative = path.relative(REPO, abs);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('--out must be outside the repository.');
  if (fs.existsSync(abs) && fs.readdirSync(abs).length > 0) throw new Error('--out must not exist yet, or be empty.');
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

function checkTarballs(opts) {
  const found = {};
  if (opts.finalTarball) {
    const manifest = readManifest(path.resolve(opts.finalTarball));
    if (manifest.name !== 'bowerloom' || manifest.version === OLD_VERSION) throw new Error('--final-bowerloom-tarball must be the final bowerloom package, not 0.8.');
    found.final = path.resolve(opts.finalTarball);
  }
  if (opts.latebrakeTarball) {
    const manifest = readManifest(path.resolve(opts.latebrakeTarball));
    if (manifest.name !== 'latebrake') throw new Error('--latebrake-tarball must be a latebrake package.');
    found.latebrake = path.resolve(opts.latebrakeTarball);
  }
  return found;
}

const docker = (args, options = {}) => spawnSync('docker', args, { maxBuffer: 1024 * 1024 * 1024, ...options });
function must(result, what) {
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${what} failed (exit ${result.status})\n${(result.stderr ?? '').toString().slice(0, 3000)}`);
  return result;
}

function containerMode(opts) {
  const out = prepareOut(opts.out);
  const given = checkTarballs(opts);
  const volume = `bowerloom-proof-${Date.now()}`;
  const input = fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'harness-08', 'project.json'));
  const put = (rel, bytes) => must(docker(['run', '--rm', '-i', '-v', `${volume}:${WORK}`, IMAGE, '--inner', 'put', rel], { input: bytes }), `copy ${rel} into the volume`);
  must(docker(['build', '-q', '-t', IMAGE, HERE]), 'docker build');
  const imageId = must(docker(['image', 'inspect', IMAGE, '--format', '{{.Id}}']), 'image inspect').stdout.toString().trim();
  must(docker(['volume', 'create', volume]), 'docker volume create');
  try {
    put('input/project.json', input);
    if (given.final) put(`tarballs/final-bowerloom/${path.basename(given.final)}`, fs.readFileSync(given.final));
    if (given.latebrake) put(`tarballs/latebrake-real/${path.basename(given.latebrake)}`, fs.readFileSync(given.latebrake));
    // The fetch phase has the network on.
    must(docker(['run', '--rm', '-v', `${volume}:${WORK}`, IMAGE, '--inner', 'fetch']), 'fetch phase');
    // The run phase has no network at all.
    must(docker(['run', '--rm', '--network', 'none', '-v', `${volume}:${WORK}`, IMAGE, '--inner', 'run']), 'run phase');
    const result = must(docker(['run', '--rm', '--network', 'none', '-v', `${volume}:${WORK}:ro`, IMAGE, '--inner', 'get', 'out/result.json']), 'read the result');
    const parsed = JSON.parse(result.stdout.toString('utf8'));
    parsed.image = { tag: IMAGE, id: imageId };
    fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(parsed, null, 2)}\n`);
    return { out, parsed, volume };
  } finally {
    if (!opts.keep) docker(['volume', 'rm', volume]);
  }
}

async function hostMode(opts) {
  const out = prepareOut(opts.out);
  const given = checkTarballs(opts);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-install-proof-'));
  try {
    const work = path.join(temp, 'work');
    for (const dir of ['input', 'tarballs']) fs.mkdirSync(path.join(work, dir), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'tests', 'fixtures', 'harness-08', 'project.json'), path.join(work, 'input', 'project.json'));
    if (given.final) { fs.mkdirSync(path.join(work, 'tarballs', 'final-bowerloom')); fs.copyFileSync(given.final, path.join(work, 'tarballs', 'final-bowerloom', path.basename(given.final))); }
    if (given.latebrake) { fs.mkdirSync(path.join(work, 'tarballs', 'latebrake-real')); fs.copyFileSync(given.latebrake, path.join(work, 'tarballs', 'latebrake-real', path.basename(given.latebrake))); }
    const proof = { work, mode: 'host', standin: path.join(HERE, 'standin', 'latebrake'), proxyPort: undefined };
    const fetched = await fetchPhase(proof);
    // A port with nothing behind it: found by listening, then closing.
    proof.proxyPort = await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
    const result = await runPhase(proof, fetched);
    fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    return { out, parsed: result };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function inner(opts) {
  const proof = { work: WORK, mode: 'container', standin: path.join(HERE, 'standin', 'latebrake'), proxyPort: undefined };
  if (opts.inner === 'put') {
    const target = path.join(WORK, opts.innerArg);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    fs.writeFileSync(target, Buffer.concat(chunks));
  } else if (opts.inner === 'get') {
    process.stdout.write(fs.readFileSync(path.join(WORK, opts.innerArg)));
  } else if (opts.inner === 'fetch') {
    const info = await fetchPhase(proof);
    console.log(`fetch phase: ${info.error ?? 'tarball ok'}; replay ${info.replay.ok ? 'ok' : `not ok: ${info.replay.error}`}`);
  } else if (opts.inner === 'run') {
    const fetched = JSON.parse(fs.readFileSync(path.join(WORK, 'out', 'fetch.json'), 'utf8'));
    const result = await runPhase(proof, fetched);
    result.fetchPhase = { node: fetched.node, npm: fetched.npm, listedIntegrity: fetched.listedIntegrity, packedIntegrity: fetched.packedIntegrity, error: fetched.error, replay: fetched.replay };
    fs.writeFileSync(path.join(WORK, 'out', 'result.json'), JSON.stringify(result));
  } else {
    throw new Error(`Unknown --inner command: ${opts.inner}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.inner) { await inner(opts); return; }
  const done = opts.mode === 'host' ? await hostMode(opts) : containerMode(opts);
  for (const entry of Object.values(done.parsed.checks)) console.log(`${entry.id}  ${entry.status.padEnd(7)}  ${entry.title}${entry.status === 'pass' ? '' : `: ${entry.detail}`}`);
  console.log(`Node ${done.parsed.node}, npm ${done.parsed.npm}. Result: ${path.join(done.out, 'result.json')}`);
  if (done.parsed.summary.fail > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A failed run must not wait for an open server, so it exits.
  main().catch(error => { console.error(error.message); process.exit(2); });
}
