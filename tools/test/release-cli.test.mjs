// Tests for the argument parser, the help and manifest output, the --json shape, and the config check of scripts/release.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { COMMANDS, UsageError, manifest, parseArgs, validateConfig } from '../../scripts/release.mjs';
import { spawnSync } from 'node:child_process';
import { makeFixture, repoRoot, scriptPath, testConfig, VERSION } from './release-fixture.mjs';

const clone = value => JSON.parse(JSON.stringify(value));

test('--help lists every subcommand with its class and exits 0', t => {
  const fx = makeFixture(t);
  const r = fx.run(['--help']);
  assert.equal(r.status, 0);
  for (const c of COMMANDS) assert.match(r.stdout, new RegExp(`${c.name}\\s+\\[${c.class}\\]`));
  assert.equal(fx.npmCalls().length, 0);
});

test('--manifest prints the subcommand table as JSON, and the docs describe every row with its class', t => {
  const fx = makeFixture(t);
  const r = fx.run(['--manifest']);
  assert.equal(r.status, 0);
  const table = r.json();
  assert.deepEqual(table, manifest());
  assert.deepEqual(table.commands.map(c => c.name), ['status', 'preflight', 'gates', 'dry-run', 'publish', 'hashes', 'verify', 'tag', 'retire', 'claims']);
  assert.deepEqual([...new Set(table.commands.map(c => c.class))].sort(), ['human-only', 'local-write', 'read-only', 'remote-write']);
  const docs = fs.readFileSync(path.join(repoRoot, 'docs/releasing.md'), 'utf8');
  for (const c of table.commands) {
    const section = docs.split(/^### /m).find(s => s.startsWith('`' + c.name + '`'));
    assert.ok(section, `docs/releasing.md has no section for ${c.name}`);
    assert.ok(section.includes(`Class: ${c.class}.`), `docs/releasing.md does not give the class ${c.class} for ${c.name}`);
  }
});

test('parseArgs accepts good input and refuses wrong use with a UsageError', () => {
  assert.equal(parseArgs(['status']).command.name, 'status');
  assert.equal(parseArgs(['gates', '--e2e', '--min-free-gib', '20']).flags['--min-free-gib'], '20');
  assert.equal(parseArgs(['verify', '--tarball=/x.tgz']).flags['--tarball'], '/x.tgz');
  assert.equal(parseArgs(['--help']).help, true);
  for (const name of ['gates', 'dry-run', 'hashes']) assert.equal(parseArgs([name, '--force']).flags['--force'], true, name);
  for (const argv of [
    [], ['nope'], ['push-tag'], ['status', 'extra'], ['status', '--nope'], ['status', '--json=1'], ['preflight', '--branch'], ['preflight', '--branch', '--json'],
    ['status', '--json', '--json'], ['status', '--e2e'], ['claims', '--tarball', 'x'], ['--manifest', 'status'], ['hashes', '--commit', 'abc'],
    ['status', '--force'], ['preflight', '--force'], ['publish', '--force'], ['verify', '--force'], ['tag', '--force'], ['retire', '--force'], ['claims', '--force'],
  ]) assert.throws(() => parseArgs(argv), UsageError, JSON.stringify(argv));
});

test('wrong use exits 2 and, with --json, still prints exactly one JSON object', t => {
  const fx = makeFixture(t);
  const cases = [[], ['nope'], ['push-tag'], ['status', '--nope'], ['preflight', '--branch'], ['status', '--e2e'], ['gates', '--min-free-gib', '5'], ['gates', '--min-free-gib', 'many'], ['tag', '--commit', 'abc123'], ['tag', '--commit', 'A'.repeat(40)]];
  for (const args of cases) {
    const plain = fx.run(args);
    assert.equal(plain.status, 2, `${args.join(' ')} -> ${plain.stderr}`);
    const withJson = fx.run([...args, '--json']);
    assert.equal(withJson.status, 2);
    const lines = withJson.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, args.join(' '));
    const out = JSON.parse(lines[0]);
    assert.equal(out.ok, false);
    assert.equal(out.exit, 2);
    assert.equal(out.outcome, 'usage');
    assert.equal(typeof out.message, 'string');
  }
  assert.equal(fx.npmCalls().length, 0);
});

test('a wrong form of --json still prints exactly one JSON object with exit 2, and --force outside gates, dry-run and hashes is a usage error', t => {
  const fx = makeFixture(t);
  for (const args of [['status', '--json=1'], ['status', '--json='], ['gates', '--json=true'], ['--json=x', '--help'], ['status', '--json=1', '--json'], ['tag', '--force', '--json'], ['status', '--force', '--json'], ['claims', '--json', '--force']]) {
    const r = fx.run(args);
    assert.equal(r.status, 2, args.join(' '));
    const lines = r.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `${args.join(' ')} -> ${JSON.stringify(r.stdout)}`);
    const out = JSON.parse(lines[0]);
    assert.deepEqual([out.ok, out.exit, out.outcome], [false, 2, 'usage'], args.join(' '));
  }
  const force = JSON.parse(fx.run(['tag', '--force', '--json']).stdout);
  assert.match(force.message, /flag --force does not apply to tag/);
  assert.equal(fx.npmCalls().length, 0);
  assert.equal(fx.git('tag', '--list'), '');
});

test('--help --json stays JSON, with or without --force', t => {
  const fx = makeFixture(t);
  for (const args of [['--help', '--json'], ['--json', '--help'], ['--help', '--json', '--force']]) {
    const r = fx.run(args);
    assert.equal(r.status, 0, args.join(' '));
    assert.equal(r.stdout.split('\n').filter(Boolean).length, 1);
    assert.equal(r.json().outcome, 'help');
  }
});

test('--json prints one object with the schema, command, ok, outcome, exit and message; the command echo stays on stderr', t => {
  const fx = makeFixture(t);
  const r = fx.run(['preflight', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const out = JSON.parse(lines[0]);
  assert.equal(out.schema, 'bowerloom/release-result/v1');
  assert.equal(out.command, 'preflight');
  assert.equal(out.ok, true);
  assert.equal(out.outcome, 'done');
  assert.equal(out.exit, 0);
  assert.equal(out.version, VERSION);
  assert.match(out.commit, /^[0-9a-f]{40}$/);
  assert.match(r.stderr, /^\$ git -c core\.hooksPath=\/dev\/null fetch --prune origin$/m);
  assert.ok(!r.stdout.includes('$ git'));
});

test('the real release.config.json passes the strict check and names the beta stream', () => {
  const real = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release.config.json'), 'utf8'));
  assert.equal(validateConfig(real), real);
  assert.equal(real.schema, 'bowerloom/release-config/v1');
  assert.equal(real.package, 'bowerloom');
  assert.equal(real.distTag, 'beta');
  assert.equal(real.releaseRecord, 'release/beta.json');
  assert.deepEqual(real.retire, []);
});

test('config check refuses unknown keys, missing keys, wrong types and unsafe values', () => {
  const good = testConfig();
  assert.doesNotThrow(() => validateConfig(clone(good)));
  const mutations = {
    'unknown top-level key': c => { c.extra = 1; },
    'unknown nested key': c => { c.desktop.extra = 1; },
    'missing key': c => { delete c.distTag; },
    'wrong schema': c => { c.schema = 'other/v1'; },
    'package not a string': c => { c.package = 5; },
    'package with a space': c => { c.package = 'bad name'; },
    'registry not https': c => { c.registry = 'http://registry.example.test'; },
    'registry with a space': c => { c.registry = 'https://registry example'; },
    'dist-tag with a slash': c => { c.distTag = 'a/b'; },
    'tag prefix with a space': c => { c.tagPrefix = 'v '; },
    'record path absolute': c => { c.releaseRecord = '/etc/passwd'; },
    'record path escapes': c => { c.releaseRecord = '../x.json'; },
    'branch pattern not a regex': c => { c.branchPattern = '('; },
    'gates not a list': c => { c.gates = 'npm ci'; },
    'gate command empty': c => { c.gates[0].command = []; },
    'gate command not npm or node': c => { c.gates[0].command = ['sh', '-c', 'x']; },
    'gate cwd escapes': c => { c.gates[0].cwd = '../x'; },
    'gate timeout zero': c => { c.gates[0].timeoutSeconds = 0; },
    'gate unknown key': c => { c.gates[0].shell = true; },
    'desktop patterns empty': c => { c.desktop.patterns = []; },
    'desktop pattern with a slash': c => { c.desktop.patterns = ['a/*.dmg']; },
    'hash file absolute': c => { c.desktop.hashFile = '/tmp/x.json'; },
    'claims path escapes': c => { c.claims.paths = ['../x']; },
    'claims patterns not strings': c => { c.claims.patterns = [1]; },
    'retire not a list': c => { c.retire = {}; },
    'retire item bad version': c => { c.retire = [{ version: 'one', message: 'm' }]; },
    'retire item missing message': c => { c.retire = [{ version: '0.1.0' }]; },
    'retire item extra key': c => { c.retire = [{ version: '0.1.0', message: 'm', run: true }]; },
    'expected file count zero': c => { c.expectedFileCount = 0; },
    'expected file count text': c => { c.expectedFileCount = '7'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const c = clone(good);
    mutate(c);
    assert.throws(() => validateConfig(c), UsageError, name);
  }
  assert.throws(() => validateConfig(null), UsageError);
  assert.throws(() => validateConfig([]), UsageError);
  const withCount = clone(good);
  withCount.expectedFileCount = 7;
  assert.doesNotThrow(() => validateConfig(withCount));
});

test('a bad or missing config file, or a release record without a version, exits 2 for every kind of subcommand', t => {
  const fx = makeFixture(t);
  const configFile = path.join(fx.repo, 'release.config.json');
  const good = fs.readFileSync(configFile, 'utf8');

  fs.writeFileSync(configFile, JSON.stringify({ ...JSON.parse(good), surprise: true }));
  for (const sub of ['status', 'claims', 'publish', 'gates']) assert.equal(fx.run([sub]).status, 2, sub);
  fs.writeFileSync(configFile, '{ not json');
  assert.equal(fx.run(['status']).status, 2);
  fs.rmSync(configFile);
  assert.equal(fx.run(['status']).status, 2);
  fs.writeFileSync(configFile, good);

  const recordFile = path.join(fx.repo, 'release/beta.json');
  const record = fs.readFileSync(recordFile, 'utf8');
  fs.writeFileSync(recordFile, JSON.stringify({ ...JSON.parse(record), version: 'not-a-version' }));
  assert.equal(fx.run(['status']).status, 2);
  fs.rmSync(recordFile);
  assert.equal(fx.run(['status']).status, 2);
  fs.writeFileSync(recordFile, record);
  assert.equal(fx.run(['claims']).status, 0);

  // fx.run always adds its own --repo, so this one starts the script directly to reach the missing folder.
  const missing = spawnSync(process.execPath, [scriptPath, 'status', '--json', '--repo', path.join(fx.root, 'nowhere')], { cwd: fx.root, env: fx.baseEnv, encoding: 'utf8' });
  assert.equal(missing.status, 2, missing.stderr);
  assert.match(JSON.parse(missing.stdout).message, /--repo .*nowhere not found/);
  assert.equal(fx.npmCalls().length, 0);
});

test('the version comes from the release record, not from a constant', t => {
  const fx = makeFixture(t, { record: { version: '1.2.3-beta.9' } });
  const out = fx.run(['preflight', '--json']).json();
  assert.equal(out.version, '1.2.3-beta.9');
});
