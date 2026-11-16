// Tests for the sandbox proof of npm installs in tools/npm-install-proof/. They need no network and no Docker. They check the static
// registry (GET only, 127.0.0.1 only), the stand-in probe, the shape of the image file, the refusals of the driver, and that the
// proof holds no command that sends anything to a registry. The temporary folder is removed in the `after` hook.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const proofDir = path.join(repo, 'tools/npm-install-proof');
const { startRegistry, readManifest, digestsOf } = await import(pathToFileURL(path.join(proofDir, 'registry.mjs')).href);

let base;
let sample;
let sampleSecond;
before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-install-proof-test-'));
  sample = pack('sample', { name: 'sample-pkg', version: '1.2.3', bin: { sample: 'cli.js' }, dependencies: { other: '^1.0.0' }, bundleDependencies: ['other'] });
  sampleSecond = pack('sample-two', { name: '@scope/sample', version: '2.0.0-beta.1' });
});
after(() => { fs.rmSync(base, { recursive: true, force: true }); });

/** Makes a small package folder and packs it with `npm pack`, which reads no network. Returns the tarball and the entry of `npm pack --json`. */
function pack(label, record) {
  const dir = path.join(base, label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(record));
  fs.writeFileSync(path.join(dir, 'cli.js'), '#!/usr/bin/env node\n');
  const dest = path.join(base, `${label}-out`);
  fs.mkdirSync(dest);
  const env = { PATH: process.env.PATH, HOME: base, npm_config_userconfig: path.join(base, 'user.npmrc'), npm_config_cache: path.join(base, 'cache'), npm_config_update_notifier: 'false', npm_config_offline: 'true' };
  const result = spawnSync('npm', ['pack', dir, '--pack-destination', dest, '--json'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const entry = JSON.parse(result.stdout)[0];
  return { file: path.join(dest, entry.filename), pack: { integrity: entry.integrity, shasum: entry.shasum } };
}

/** Sends one request and returns the status, the headers, and the body. */
function request(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('the registry serves a package record built from the tarball and its npm pack entry', async () => {
  const registry = await startRegistry({ packages: [sample, sampleSecond], tags: { 'sample-pkg': { beta: '1.2.3' } } });
  try {
    const found = await request(`${registry.url}/sample-pkg`);
    assert.equal(found.status, 200);
    const record = JSON.parse(found.body.toString('utf8'));
    assert.equal(record.name, 'sample-pkg');
    assert.deepEqual(record['dist-tags'], { latest: '1.2.3', beta: '1.2.3' });
    const version = record.versions['1.2.3'];
    assert.deepEqual(version.bin, { sample: 'cli.js' });
    assert.deepEqual(version.dependencies, { other: '^1.0.0' });
    assert.deepEqual(version.bundleDependencies, ['other']);
    assert.equal(version.dist.integrity, sample.pack.integrity);
    assert.equal(version.dist.shasum, sample.pack.shasum);
    assert.equal(version.dist.tarball, `${registry.url}/sample-pkg/-/${path.basename(sample.file)}`);
    // The tarball itself.
    const tarball = await request(version.dist.tarball);
    assert.equal(tarball.status, 200);
    assert.deepEqual(tarball.body, fs.readFileSync(sample.file));
    assert.equal(digestsOf(tarball.body).integrity, sample.pack.integrity);
    // A scoped name is asked for with an encoded slash.
    const scoped = await request(`${registry.url}/@scope%2fsample`);
    assert.equal(scoped.status, 200);
    assert.deepEqual(JSON.parse(scoped.body.toString('utf8'))['dist-tags'], { latest: '2.0.0-beta.1' });
  } finally { await registry.close(); }
});

test('the registry listens on 127.0.0.1 only', async () => {
  const registry = await startRegistry({ packages: [sample] });
  try {
    assert.match(registry.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const found = await request(`${registry.url}/sample-pkg`);
    assert.equal(found.status, 200);
    assert.equal(registry.requests.every(row => ['127.0.0.1', '::ffff:127.0.0.1'].includes(row.remote)), true);
  } finally { await registry.close(); }
});

test('the registry answers GET only: every other method gets 405 and changes nothing', async () => {
  const registry = await startRegistry({ packages: [sample] });
  try {
    const before = (await request(`${registry.url}/sample-pkg`)).body.toString('utf8');
    for (const method of ['PUT', 'POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
      for (const target of ['/sample-pkg', '/sample-pkg/-/sample-pkg-1.2.3.tgz', '/new-pkg', '/-/user/org.couchdb.user:someone', '/-/npm/v1/security/advisories/bulk']) {
        const result = await request(`${registry.url}${target}`, { method, body: method === 'GET' || method === 'HEAD' ? undefined : '{"name":"x"}' })
          .catch(error => { throw new Error(`${method} ${target}: ${error.message}`); });
        assert.equal(result.status, 405, `${method} ${target}`);
        assert.equal(result.headers.allow, 'GET');
      }
    }
    assert.equal((await request(`${registry.url}/sample-pkg`)).body.toString('utf8'), before);
    assert.equal((await request(`${registry.url}/new-pkg`)).status, 404);
    assert.equal(registry.requests.filter(row => row.method !== 'GET').every(row => row.status === 405), true);
  } finally { await registry.close(); }
});

test('the registry answers a large request body with 405 and Connection: close, and stays up', async () => {
  const registry = await startRegistry({ packages: [sample] });
  try {
    const big = Buffer.alloc(8 * 1024 * 1024, 0x61);
    for (const method of ['PUT', 'POST']) {
      // The server closes the connection after it answers, so a client that is still sending may get the 405 or a reset. Both mean refusal.
      const outcome = await request(`${registry.url}/sample-pkg`, { method, body: big }).catch(error => ({ reset: error.code }));
      if (outcome.reset === undefined) {
        assert.equal(outcome.status, 405, method);
        assert.equal(outcome.headers.connection, 'close', method);
        assert.equal(outcome.headers.allow, 'GET');
      } else {
        assert.ok(['ECONNRESET', 'EPIPE'].includes(outcome.reset), `${method}: ${outcome.reset}`);
      }
    }
    // A small body always gets the whole answer, with the close header.
    const small = await request(`${registry.url}/sample-pkg`, { method: 'PUT', body: '{}' });
    assert.equal(small.status, 405);
    assert.equal(small.headers.connection, 'close');
    // The registry is still up, and logged each refusal as 405.
    assert.equal((await request(`${registry.url}/sample-pkg`)).status, 200);
    const refused = registry.requests.filter(row => row.method !== 'GET');
    assert.equal(refused.length, 3);
    assert.equal(refused.every(row => row.status === 405), true);
  } finally { await registry.close(); }
});

test('the registry answers 404 for a package it does not hold, and refuses a malformed path', async () => {
  const registry = await startRegistry({ packages: [sample] });
  try {
    assert.equal((await request(`${registry.url}/latebrake`)).status, 404);
    assert.equal((await request(`${registry.url}/sample-pkg/-/other-1.0.0.tgz`)).status, 404);
    assert.equal((await request(`${registry.url}/%E0%A4%A`)).status, 400);
  } finally { await registry.close(); }
});

test('the registry refuses a tarball whose npm pack entry does not match the bytes, and one that is listed twice', async () => {
  await assert.rejects(() => startRegistry({ packages: [{ file: sample.file, pack: { integrity: 'sha512-AAAA', shasum: sample.pack.shasum } }] }), /does not match the bytes/);
  await assert.rejects(() => startRegistry({ packages: [sample, sample] }), /listed twice/);
});

test('readManifest reads package/package.json from a tarball', () => {
  assert.equal(readManifest(sample.file).version, '1.2.3');
  assert.throws(() => readManifest(path.join(base, 'missing.tgz')));
});

test('the stand-in probe echoes arguments and standard input, writes one fixed stderr line, and sets the exit code', () => {
  const dir = path.join(base, 'probe-copy');
  fs.cpSync(path.join(proofDir, 'standin/latebrake'), dir, { recursive: true });
  // The command name comes from the name that started the process. A link named like an old command maps to the new one.
  fs.symlinkSync(path.join(dir, 'probe.mjs'), path.join(dir, 'bowerloom-mcp'));
  const run = (name, args, input) => spawnSync(process.execPath, [path.join(dir, name), ...args], { input, encoding: 'utf8' });
  const a = run('bowerloom-mcp', ['one', 'two words', '--exit=3'], 'text on stdin\n');
  assert.equal(a.status, 3);
  assert.deepEqual(JSON.parse(a.stdout), { command: 'latebrake-mcp', package: 'latebrake', version: '0.9.0-beta.1', args: ['one', 'two words', '--exit=3'], input: 'text on stdin\n' });
  assert.equal(a.stderr, 'probe: fixed stderr line\n');
  const quiet = run('probe.mjs', ['--quiet'], 'ignored');
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '');
  assert.equal(quiet.stderr, 'probe: fixed stderr line\n');
  assert.equal(run('probe.mjs', ['--exit=130'], '').status, 130);
  // --which adds the marker of the copy. This folder is not nested inside a bowerloom package, so it reads as global. Without --which there is no marker.
  assert.equal(JSON.parse(run('probe.mjs', ['--which'], '').stdout).copy, 'global');
  assert.equal(Object.hasOwn(JSON.parse(run('probe.mjs', [], '').stdout), 'copy'), false);
  const nested = path.join(base, 'node_modules', 'bowerloom', 'node_modules', 'latebrake');
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.cpSync(path.join(proofDir, 'standin/latebrake'), nested, { recursive: true });
  assert.equal(JSON.parse(spawnSync(process.execPath, [path.join(nested, 'probe.mjs'), '--which'], { encoding: 'utf8' }).stdout).copy, 'nested');
});

test('the stand-in names the three commands and is private', () => {
  const record = JSON.parse(fs.readFileSync(path.join(proofDir, 'standin/latebrake/package.json'), 'utf8'));
  assert.equal(record.name, 'latebrake');
  assert.equal(record.version, '0.9.0-beta.1');
  assert.equal(record.private, true);
  assert.deepEqual(Object.keys(record.bin).sort(), ['latebrake', 'latebrake-guard', 'latebrake-mcp']);
  assert.equal(Object.hasOwn(record, 'scripts'), false);
  assert.equal(Object.hasOwn(record, 'publishConfig'), false);
});

test('no file of the proof holds a command that sends anything to a registry, or a credential name', () => {
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const child = path.join(dir, entry.name); if (entry.isDirectory()) walk(child); else files.push(child); } };
  walk(proofDir);
  assert.ok(files.length >= 5, 'the proof has its files');
  // The words are spelled out one by one, so the pattern is the whole list in the plan: the verbs of the commands that write to a registry or sign in.
  const banned = /\bnpm\s+(?:publish|dist-tag|deprecate|login|adduser|token)\b|\b(?:publish|dist-tag|deprecate|login|adduser|token)\b|NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/i;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const found = banned.exec(text);
    assert.equal(found, null, `${path.relative(repo, file)} holds "${found?.[0]}"`);
  }
  // The driver builds each child's environment from names. It never copies the environment of its own process.
  const driver = fs.readFileSync(path.join(proofDir, 'run.mjs'), 'utf8');
  assert.equal(/env:\s*process\.env/.test(driver), false);
  assert.equal(/\.\.\.process\.env/.test(driver), false);
});

test('the image file uses the pinned Node image of the gate sandbox, a non-root user, and no repository code', () => {
  const text = fs.readFileSync(path.join(proofDir, 'Dockerfile'), 'utf8');
  const sandbox = fs.readFileSync(path.join(repo, 'tools/sandbox/Dockerfile'), 'utf8');
  const from = line => /^FROM (\S+)/m.exec(line)?.[1];
  assert.equal(from(text), from(sandbox));
  assert.match(text, /^USER node$/m);
  const copies = text.split('\n').filter(line => /^COPY\b/.test(line));
  assert.equal(copies.length, 2);
  for (const line of copies) assert.doesNotMatch(line, /\.\.|COPY\s+(?:--\S+\s+)*\.\s/);
  assert.equal(/^RUN\s+.*npm\s+(?:ci|install)/m.test(text), false);
});

test('the driver refuses a missing --out, an --out inside the repository, an --out that holds files, and an unknown flag', () => {
  const driver = path.join(proofDir, 'run.mjs');
  const run = args => spawnSync(process.execPath, [driver, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  const inside = path.join(repo, 'tools', 'npm-install-proof-never-made');
  const insideResult = run(['--out', inside]);
  assert.notEqual(insideResult.status, 0);
  assert.match(insideResult.stderr, /outside the repository/);
  assert.equal(fs.existsSync(inside), false);
  const missing = run([]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--out/);
  const busy = path.join(base, 'busy');
  fs.mkdirSync(busy);
  fs.writeFileSync(path.join(busy, 'a'), 'x');
  const busyResult = run(['--out', busy]);
  assert.notEqual(busyResult.status, 0);
  assert.match(busyResult.stderr, /must not exist yet, or be empty/);
  assert.match(run(['--surprise']).stderr, /Unknown argument/);
  assert.match(run(['--mode', 'both', '--out', path.join(base, 'fresh')]).stderr, /container or host/);
});
