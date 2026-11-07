// Tests for the release script subcommands, run against a real temporary git repository with a local bare origin, a fake npm and a fake pack.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasVersion } from '../../scripts/release.mjs';
import { allFiles, BRANCH, makeFixture, scriptPath, TARBALL, testConfig, VERSION } from './release-fixture.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const integrityOf = bytes => 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');
const TARBALL_BODY = TARBALL;

/** Runs gates, which most later steps need. */
const passGates = fx => { const r = fx.run(['gates', '--json']); assert.equal(r.status, 0, r.stderr); return r.json(); };

// ---------------------------------------------------------------------------------------------------------------------------------
// preflight

test('preflight passes on a clean release branch equal to origin, prints the commit, and fetches but never pulls', t => {
  const fx = makeFixture(t);
  const head = fx.git('rev-parse', 'HEAD');
  const r = fx.run(['preflight']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(head));
  assert.match(r.stderr, /^\$ git -c core\.hooksPath=\/dev\/null fetch --prune origin$/m);
  const out = fx.run(['preflight', '--json']).json();
  assert.deepEqual([out.branch, out.commit, out.ahead, out.behind], [fx.git('rev-parse', '--abbrev-ref', 'HEAD'), head, 0, 0]);
  assert.deepEqual(out.checks.map(c => c.name), ['fetch', 'branch', 'sync', 'clean']);
});

test('preflight fails on a dirty tree, with untracked files counted', t => {
  const fx = makeFixture(t);
  fs.writeFileSync(path.join(fx.repo, 'stray.txt'), 'x');
  const r = fx.run(['preflight', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /not clean: \?\? stray\.txt/);
  fs.rmSync(path.join(fx.repo, 'stray.txt'));
  fs.appendFileSync(path.join(fx.repo, 'README.md'), 'edit\n');
  assert.equal(fx.run(['preflight']).status, 1);
});

test('preflight fails when HEAD is behind origin, reports the counts, and does not pull', t => {
  const fx = makeFixture(t);
  const other = path.join(fx.root, 'other');
  spawnSync('git', ['clone', '-b', fx.git('rev-parse', '--abbrev-ref', 'HEAD'), fx.origin, other], { env: fx.baseEnv });
  fs.writeFileSync(path.join(other, 'new.txt'), 'x');
  for (const args of [['add', '-A'], ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-m', 'remote change'], ['push', 'origin', 'HEAD']]) assert.equal(spawnSync('git', args, { cwd: other, env: fx.baseEnv }).status, 0);
  const before = fx.git('rev-parse', 'HEAD');
  const r = fx.run(['preflight', '--json']);
  assert.equal(r.status, 1);
  const out = r.json();
  assert.equal(out.behind, 1);
  assert.equal(out.ahead, 0);
  assert.match(out.message, /0 ahead and 1 behind/);
  assert.equal(fx.git('rev-parse', 'HEAD'), before);
  assert.ok(!fs.existsSync(path.join(fx.repo, 'new.txt')));
});

test('preflight fails when HEAD is ahead of origin', t => {
  const fx = makeFixture(t);
  fx.commit('local.txt', 'x');
  const r = fx.run(['preflight', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /1 ahead and 0 behind/);
});

test('preflight fails on a branch that does not match, passes with --branch NAME, and fails when the branch is not on origin', t => {
  const fx = makeFixture(t);
  fx.git('checkout', '-b', 'feature/x');
  let r = fx.run(['preflight', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /HEAD is feature\/x; expected a branch matching \^release\//);
  fx.git('push', '-u', 'origin', 'feature/x');
  assert.equal(fx.run(['preflight', '--branch', 'feature/x']).status, 0);
  assert.equal(fx.run(['preflight', '--branch', 'release/other']).status, 1);
  fx.git('checkout', '-b', 'release/unpushed');
  r = fx.run(['preflight', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /origin\/release\/unpushed not found/);
  assert.equal(fx.run(['preflight', '--branch', 'bad name']).status, 2);
});

test('preflight fails when origin cannot be fetched', t => {
  const fx = makeFixture(t);
  fx.git('remote', 'set-url', 'origin', path.join(fx.root, 'no-such-origin.git'));
  const r = fx.run(['preflight', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /git fetch origin failed/);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// gates

test('gates run the config list in order, with the right working folders, write a receipt, and run nothing twice', t => {
  const fx = makeFixture(t);
  const first = fx.run(['gates', '--json']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.json().outcome, 'done');
  const calls = fx.npmCalls();
  assert.deepEqual(calls.map(c => c.args.join(' ')), ['ci', 'run typecheck', 'test', 'ci', 'run typecheck', 'test']);
  assert.deepEqual(calls.map(c => path.relative(fx.repo, c.cwd)), ['', '', '', 'apps/desktop', 'apps/desktop', 'apps/desktop']);
  assert.match(first.stderr, /^\$ \S*fake-npm\.mjs ci$/m);
  const receipts = allFiles(path.join(fx.repo, '.trellis/release/receipts'));
  assert.equal(receipts.length, 1);
  assert.ok(path.basename(receipts[0]).includes(fx.git('rev-parse', 'HEAD')));
  assert.ok(path.basename(receipts[0]).includes(VERSION));

  const again = fx.run(['gates']);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /already done/);
  assert.equal(fx.npmCalls().length, 6);
  assert.equal(fx.run(['gates', '--json']).json().outcome, 'already done');
  assert.equal(fx.git('status', '--porcelain'), '');
});

test('gates --force reruns, and --e2e after a plain pass runs only the end-to-end gate', t => {
  const fx = makeFixture(t);
  passGates(fx);
  assert.equal(fx.run(['gates', '--force']).status, 0);
  assert.equal(fx.npmCalls().length, 12);
  const e2e = fx.run(['gates', '--e2e', '--json']);
  assert.equal(e2e.status, 0, e2e.stderr);
  assert.deepEqual(fx.npmCalls().slice(12).map(c => c.args.join(' ')), ['run e2e']);
  assert.equal(fx.run(['gates', '--e2e', '--json']).json().outcome, 'already done');
  assert.equal(fx.npmCalls().length, 13);
});

test('gates do not run the end-to-end gate without --e2e, and run the whole list plus it with --e2e on a fresh commit', t => {
  const fx = makeFixture(t);
  fx.run(['gates']);
  assert.ok(!fx.npmCalls().some(c => c.args.includes('e2e')));
  fx.commit('a.txt', 'a');
  fx.git('push', 'origin', 'HEAD');
  assert.equal(fx.run(['gates', '--e2e']).status, 0);
  assert.deepEqual(fx.npmCalls().slice(6).map(c => c.args.join(' ')), ['ci', 'run typecheck', 'test', 'ci', 'run typecheck', 'test', 'run e2e']);
});

test('a failed gate stops the list, prints the first failing line only, keeps the full log at mode 0600 and writes no receipt', t => {
  const fx = makeFixture(t);
  fx.setNpm({ fail: [{ match: 'run typecheck', message: 'npm warn something\nsrc/a.ts(1,1): error TS2322: bad type\nsrc/b.ts(2,2): error TS9999: later error' }] });
  const r = fx.run(['gates', '--json']);
  assert.equal(r.status, 1);
  const out = r.json();
  assert.equal(out.outcome, 'failed');
  assert.equal(out.message, 'gate "root: npm run typecheck" failed: src/a.ts(1,1): error TS2322: bad type');
  assert.ok(!r.stdout.includes('TS9999'));
  assert.deepEqual(fx.npmCalls().map(c => c.args.join(' ')), ['ci', 'run typecheck']);
  assert.equal(allFiles(path.join(fx.repo, '.trellis/release/receipts')).length, 0);
  const log = path.join(fx.repo, out.log);
  assert.equal(fs.statSync(log).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(log, 'utf8'), /TS9999/);
  const human = fx.run(['gates']);
  assert.equal(human.status, 1);
  assert.ok(!human.stderr.includes('TS9999') || human.stderr.split('\n').filter(l => l.includes('TS9999')).length === 0);
});

test('gates refuse a dirty tree, a failing disk floor, and a lowered floor', t => {
  const fx = makeFixture(t);
  fs.writeFileSync(path.join(fx.repo, 'stray.txt'), 'x');
  assert.equal(fx.run(['gates']).status, 1);
  fs.rmSync(path.join(fx.repo, 'stray.txt'));
  const low = fx.run(['gates', '--json'], { env: { BOWERLOOM_RELEASE_FREE_GIB: '11.9' } });
  assert.equal(low.status, 1);
  assert.match(low.json().message, /free disk is 11\.90 GiB, below the 12 GiB floor/);
  const raised = fx.run(['gates', '--json', '--min-free-gib', '50'], { env: { BOWERLOOM_RELEASE_FREE_GIB: '40' } });
  assert.equal(raised.status, 1);
  assert.match(raised.json().message, /below the 50 GiB floor/);
  assert.equal(fx.run(['gates', '--min-free-gib', '11']).status, 2);
  assert.equal(fx.npmCalls().length, 0);
  assert.equal(fx.run(['gates'], { env: { BOWERLOOM_RELEASE_FREE_GIB: '12' } }).status, 0);
});

test('gates fail when the gates themselves change the working tree, and write no receipt', t => {
  const fx = makeFixture(t);
  const script = path.join(fx.root, 'bin/dirty-npm.mjs');
  fs.writeFileSync(script, `#!/usr/bin/env node\nimport fs from 'node:fs';\nif (process.argv[2] === 'test') { fs.appendFileSync(${JSON.stringify(path.join(fx.repo, 'README.md'))}, 'changed\\n'); console.log('ℹ tests 1\\nℹ pass 1\\nℹ fail 0'); }\n`, { mode: 0o755 });
  const r = fx.run(['gates', '--json'], { env: { BOWERLOOM_RELEASE_NPM: script } });
  assert.equal(r.status, 1);
  assert.match(r.json().message, /changed the working tree/);
  assert.equal(allFiles(path.join(fx.repo, '.trellis/release/receipts')).length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// dry-run

test('dry-run refuses without a gates receipt for this commit, and a new commit invalidates the receipt', t => {
  const fx = makeFixture(t);
  const r = fx.run(['dry-run', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /run gates first/);
  assert.equal(fx.packCalls().length, 0);
  passGates(fx);
  fx.commit('b.txt', 'b');
  const again = fx.run(['dry-run', '--json']);
  assert.equal(again.status, 1);
  assert.match(again.json().message, /run gates first/);
  assert.equal(fx.packCalls().length, 0);
});

test('dry-run packs into two new folders, runs npm publish --dry-run, and reports name, version, files, size, tag, SHA-256 and integrity', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const r = fx.run(['dry-run', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = r.json();
  assert.equal(out.outcome, 'done');
  assert.equal(out.package, 'bowerloom');
  assert.equal(out.version, VERSION);
  assert.equal(out.files, 7);
  assert.equal(out.entries, 10, 'the real entry count of the listed tarball: 7 of the package and 3 bundled');
  assert.equal(out.tag, 'beta');
  assert.equal(out.bytes, TARBALL_BODY.length);
  assert.equal(out.sha256, sha256(TARBALL_BODY));
  assert.equal(out.integrity, integrityOf(TARBALL_BODY));
  assert.equal(sha256(fs.readFileSync(out.tarball)), out.sha256);

  const [pack] = fx.packCalls();
  const arg = name => pack.args[pack.args.indexOf(name) + 1];
  assert.equal(arg('--repo'), fx.repo);
  assert.ok(pack.args.includes('--release-candidate'));
  assert.ok(path.isAbsolute(arg('--stage')) && path.isAbsolute(arg('--output')));
  assert.notEqual(arg('--stage'), arg('--output'));
  assert.ok(out.tarball.startsWith(arg('--output') + path.sep));
  assert.ok(!fs.existsSync(arg('--stage')), 'the stage folder is removed after a good dry run');

  const publishCalls = fx.npmCalls().filter(c => c.args[0] === 'publish');
  assert.equal(publishCalls.length, 1);
  assert.deepEqual(publishCalls[0].args, ['publish', '--dry-run', out.tarball, '--tag', 'beta', '--access', 'public']);
  const human = fx.run(['dry-run', '--force']);
  assert.match(human.stdout, /sha256: {4}[0-9a-f]{64}/);
  assert.match(human.stdout, /integrity: sha512-/);
});

test('dry-run is idempotent for the same commit, reruns when the tarball is gone or with --force', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const first = fx.run(['dry-run', '--json']).json();
  const second = fx.run(['dry-run']);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /already done/);
  assert.equal(fx.packCalls().length, 1);
  assert.equal(fx.run(['dry-run', '--json']).json().sha256, first.sha256);
  fs.rmSync(first.tarball);
  assert.equal(fx.run(['dry-run', '--json']).json().outcome, 'done');
  assert.equal(fx.packCalls().length, 2);
  assert.equal(fx.run(['dry-run', '--force', '--json']).json().outcome, 'done');
  assert.equal(fx.packCalls().length, 3);
});

test('dry-run is not "already done" when the receipt files or tag no longer equal the config, and runs again', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const first = fx.run(['dry-run', '--json']).json();
  assert.equal(fx.packCalls().length, 1);
  const receiptFile = allFiles(path.join(fx.repo, '.trellis/release/receipts')).find(f => path.basename(f).startsWith('dry-run-'));
  const original = fs.readFileSync(receiptFile, 'utf8');
  // The receipt was made when the config expected another file count or used another dist-tag.
  for (const [key, value] of [['files', 6], ['tag', 'next']]) {
    fs.writeFileSync(receiptFile, JSON.stringify({ ...JSON.parse(original), [key]: value }));
    const again = fx.run(['dry-run', '--json']);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.json().outcome, 'done', key);
    assert.equal(again.json().tag, 'beta');
    assert.equal(again.json().files, 7);
  }
  assert.equal(fx.packCalls().length, 3);
  assert.equal(fx.run(['dry-run', '--json']).json().outcome, 'already done');
  assert.equal(first.files, 7);
});

test('dry-run checks the expected file count when the config sets one', t => {
  const bad = makeFixture(t, { config: testConfig({ expectedFileCount: 9 }) });
  passGates(bad);
  const r = bad.run(['dry-run', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /holds 7 files; the config expects 9/);
  assert.equal(bad.npmCalls().filter(c => c.args[0] === 'publish').length, 0);
  const good = makeFixture(t, { config: testConfig({ expectedFileCount: 7 }) });
  passGates(good);
  assert.equal(good.run(['dry-run']).status, 0);
});

test('dry-run reports the first failing line of a failed pack, a wrong pack SHA-256, and a failed npm dry run, and leaves no temp folder', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const packFail = fx.run(['dry-run', '--json'], { env: { FAKE_PACK_FAIL: 'boom' } });
  assert.equal(packFail.status, 1);
  assert.equal(packFail.json().message, 'pack failed: pack error: boom');
  assert.equal(fs.statSync(path.join(fx.repo, packFail.json().log)).mode & 0o777, 0o600);
  const wrongSha = fx.run(['dry-run', '--json'], { env: { FAKE_PACK_WRONG_SHA: '1' } });
  assert.equal(wrongSha.status, 1);
  assert.match(wrongSha.json().message, /differs from the pack report/);
  fx.setNpm({ failPublishDryRun: true });
  const npmFail = fx.run(['dry-run', '--json']);
  assert.equal(npmFail.status, 1);
  assert.equal(npmFail.json().message, 'npm publish --dry-run failed: npm error code EPUBLISHCONFLICT');
  assert.deepEqual(fs.readdirSync(fx.tmp), [], 'a failed dry run removes its temp folders');
  assert.equal(allFiles(path.join(fx.repo, '.trellis/release/receipts')).filter(f => f.includes('dry-run')).length, 0);
});

test('dry-run needs 12.05 GiB free and a lowered floor is refused', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const low = fx.run(['dry-run', '--json'], { env: { BOWERLOOM_RELEASE_FREE_GIB: '12.04' } });
  assert.equal(low.status, 1);
  assert.match(low.json().message, /below the 12\.05 GiB floor/);
  assert.equal(fx.packCalls().length, 0);
  assert.equal(fx.run(['dry-run'], { env: { BOWERLOOM_RELEASE_FREE_GIB: '12.06' } }).status, 0);
  assert.equal(fx.run(['dry-run', '--force', '--min-free-gib', '500']).status, 1);
  assert.equal(fx.run(['dry-run', '--min-free-gib', '1']).status, 2);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// hashes

test('hashes writes the SHA-256 of each artifact, only for the configured patterns, in the documented shape', t => {
  const fx = makeFixture(t);
  fx.artifacts({ 'Bowerloom-0.8.0-beta.2-arm64.dmg': 'dmg bytes', 'Bowerloom-0.8.0-beta.2-arm64.zip': 'zip bytes', 'notes.txt': 'ignored' });
  const r = fx.run(['hashes', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const file = JSON.parse(fs.readFileSync(path.join(fx.repo, 'release/desktop-sha256.json'), 'utf8'));
  assert.deepEqual(file, { schema: 'bowerloom/desktop-hashes/v1', version: VERSION, files: { 'Bowerloom-0.8.0-beta.2-arm64.dmg': sha256('dmg bytes'), 'Bowerloom-0.8.0-beta.2-arm64.zip': sha256('zip bytes') } });
});

test('hashes is idempotent, adds a new artifact, refuses a different hash for a known name, and --force overwrites', t => {
  const fx = makeFixture(t);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one' });
  assert.equal(fx.run(['hashes', '--json']).json().outcome, 'done');
  const hashFile = path.join(fx.repo, 'release/desktop-sha256.json');
  const written = fs.readFileSync(hashFile, 'utf8');
  const again = fx.run(['hashes']);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /already done/);
  assert.equal(fs.readFileSync(hashFile, 'utf8'), written);

  fx.artifacts({ 'b-0.8.0-beta.2.zip': 'two' });
  assert.equal(fx.run(['hashes', '--json']).json().outcome, 'done');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(hashFile, 'utf8')).files), ['a-0.8.0-beta.2.dmg', 'b-0.8.0-beta.2.zip']);

  const before = fs.readFileSync(hashFile, 'utf8');
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'changed' });
  const refused = fx.run(['hashes', '--json']);
  assert.equal(refused.status, 1);
  assert.match(refused.json().message, /hash differs from the recorded hash for a-0\.8\.0-beta\.2\.dmg/);
  assert.equal(fs.readFileSync(hashFile, 'utf8'), before);
  assert.equal(fx.run(['hashes', '--force']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(hashFile, 'utf8')).files['a-0.8.0-beta.2.dmg'], sha256('changed'));
});

test('hashes writes the file fresh: an entry of an earlier run is dropped, also with --force, and a file from another run is not merged in', t => {
  const fx = makeFixture(t);
  const hashFile = path.join(fx.repo, 'release/desktop-sha256.json');
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one', 'b-0.8.0-beta.2.dmg': 'old' });
  assert.equal(fx.run(['hashes']).status, 0);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(hashFile, 'utf8')).files), ['a-0.8.0-beta.2.dmg', 'b-0.8.0-beta.2.dmg']);
  fs.rmSync(path.join(fx.repo, fx.config.desktop.dir, 'b-0.8.0-beta.2.dmg'));
  assert.equal(fx.run(['hashes', '--json']).json().outcome, 'done');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(hashFile, 'utf8')).files), ['a-0.8.0-beta.2.dmg']);
  fs.writeFileSync(hashFile, JSON.stringify({ schema: 'bowerloom/desktop-hashes/v1', version: VERSION, files: { 'ghost.dmg': 'f'.repeat(64) } }));
  assert.equal(fx.run(['hashes', '--force']).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(hashFile, 'utf8')).files, { 'a-0.8.0-beta.2.dmg': sha256('one') });
});

test('hashes refuses, also with --force, when no artifact filename contains the release version, and names the mismatch', t => {
  const fx = makeFixture(t);
  fx.artifacts({ 'Bowerloom-0.7.0-arm64.dmg': 'old build', 'Bowerloom-0.7.0-arm64.zip': 'old build' });
  for (const args of [['hashes', '--json'], ['hashes', '--force', '--json']]) {
    const r = fx.run(args);
    assert.equal(r.status, 1);
    assert.match(r.json().message, /every artifact filename must contain the release version 0\.8\.0-beta\.2 \(not matching: Bowerloom-0\.7\.0-arm64\.dmg, Bowerloom-0\.7\.0-arm64\.zip\)/);
  }
  assert.ok(!fs.existsSync(path.join(fx.repo, 'release/desktop-sha256.json')));
});

test('hashes refuses a stale installer of an older version next to a new one, also with --force, and lists the stale names', t => {
  const fx = makeFixture(t);
  fx.artifacts({ 'Bowerloom-0.8.0-beta.2-arm64.dmg': 'new', 'Bowerloom-0.8.0-beta.1-arm64.dmg': 'old', 'Bowerloom-0.8.0-beta.1-arm64.zip': 'old' });
  for (const args of [['hashes', '--json'], ['hashes', '--force', '--json']]) {
    const r = fx.run(args);
    assert.equal(r.status, 1);
    assert.match(r.json().message, /not matching: Bowerloom-0\.8\.0-beta\.1-arm64\.dmg, Bowerloom-0\.8\.0-beta\.1-arm64\.zip\)/);
    assert.doesNotMatch(r.json().message, /not matching:[^)]*beta\.2/);
  }
  assert.ok(!fs.existsSync(path.join(fx.repo, 'release/desktop-sha256.json')));
});

test('hashes needs the version at a boundary: beta.21, beta.2.1, 10.8.0-beta.2, and a letter glued to either side do not satisfy beta.2; real installer names do', t => {
  const fx = makeFixture(t);
  const only = name => { fs.rmSync(path.join(fx.repo, fx.config.desktop.dir), { recursive: true, force: true }); fx.artifacts({ [name]: 'x' }); };
  for (const name of ['Bowerloom-0.8.0-beta.21-arm64.dmg', 'Bowerloom-0.8.0-beta.2.1-arm64.dmg', 'Bowerloom-10.8.0-beta.2-arm64.dmg', 'Bowerloom-x0.8.0-beta.2-arm64.dmg', 'Bowerloom-0.8.0-beta.2a.dmg', 'Bowerloom-0.8.0-beta.20.zip']) {
    only(name);
    const r = fx.run(['hashes', '--json']);
    assert.equal(r.status, 1, name);
    assert.match(r.json().message, /every artifact filename must contain the release version/, name);
  }
  for (const name of ['Bowerloom-0.8.0-beta.2.dmg', 'Bowerloom-0.8.0-beta.2-arm64.dmg', '0.8.0-beta.2_arm64.zip', 'Bowerloom_0.8.0-beta.2.zip', 'Bowerloom 0.8.0-beta.2.dmg', 'Bowerloom-0.8.0-beta.2.universal.dmg']) {
    only(name);
    const r = fx.run(['hashes', '--json', '--force']);
    assert.equal(r.status, 0, `${name}: ${r.stdout}`);
  }
});

test('hasVersion: a version with no prerelease part does not match a longer prerelease version, and a prerelease version keeps its old rules', () => {
  // No prerelease part in the release version: a hyphen plus a letter or digit after it means the name carries a longer version.
  for (const name of ['Bowerloom-0.8.0-beta.2-arm64.dmg', 'Bowerloom-0.8.0-rc1.dmg', 'Bowerloom-0.8.0-1.dmg', 'Bowerloom-0.8.0-arm64.dmg', 'Bowerloom-0.8.0-beta.dmg']) assert.equal(hasVersion(name, '0.8.0'), false, name);
  for (const name of ['Bowerloom-0.8.0.dmg', 'Bowerloom_0.8.0_arm64.dmg', 'Bowerloom 0.8.0.zip', '0.8.0', 'Bowerloom-0.8.0 -x.dmg', 'Bowerloom-0.8.0.universal.dmg']) assert.equal(hasVersion(name, '0.8.0'), true, name);
  assert.equal(hasVersion('Bowerloom-0.8.0-.dmg', '0.8.0'), true, 'a hyphen followed by a dot is not a longer version');
  // A prerelease release version: unchanged.
  assert.equal(hasVersion('Bowerloom-0.8.0-beta.2-arm64.dmg', '0.8.0-beta.2'), true);
  assert.equal(hasVersion('Bowerloom-0.8.0-beta.21.dmg', '0.8.0-beta.2'), false);
});

test('hashes fails with no artifact folder, no matching file, a hash file of another version, or a damaged hash file', t => {
  const fx = makeFixture(t);
  assert.match(fx.run(['hashes', '--json']).json().message, /build the desktop app first/);
  fx.artifacts({ 'notes.txt': 'x' });
  assert.match(fx.run(['hashes', '--json']).json().message, /no files matching/);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one' });
  const hashFile = path.join(fx.repo, 'release/desktop-sha256.json');
  fs.writeFileSync(hashFile, JSON.stringify({ schema: 'bowerloom/desktop-hashes/v1', version: '0.0.1', files: {} }));
  assert.match(fx.run(['hashes', '--json']).json().message, /for version 0\.0\.1/);
  assert.equal(fx.run(['hashes', '--force']).status, 0);
  fs.writeFileSync(hashFile, '{ nope');
  assert.match(fx.run(['hashes', '--json']).json().message, /not valid JSON/);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// verify

const publish = (fx, { integrity = integrityOf(TARBALL_BODY), tag = VERSION } = {}) => fx.setNpm({ distTags: { beta: tag, latest: tag }, versions: { [VERSION]: { integrity } } });
const tarballFile = fx => { const file = path.join(fx.root, 'release.tgz'); fs.writeFileSync(file, TARBALL_BODY); return file; };
const readyVerify = fx => { fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one', 'b-0.8.0-beta.2.zip': 'two' }); assert.equal(fx.run(['hashes']).status, 0); publish(fx); };
const checkOf = (out, name) => out.checks.find(c => c.name === name);

test('verify passes with the tag, the matching integrity, a clean install, and matching desktop hashes', t => {
  const fx = makeFixture(t);
  readyVerify(fx);
  const r = fx.run(['verify', '--tarball', tarballFile(fx), '--json']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const out = r.json();
  assert.deepEqual(out.checks.map(c => [c.name, c.status]), [['dist-tag', 'pass'], ['integrity', 'pass'], ['install', 'pass'], ['desktop-sha256', 'pass']]);
  const calls = fx.npmCalls().map(c => c.args);
  assert.ok(calls.some(a => a[0] === 'init' && a[1] === '-y'));
  assert.ok(calls.some(a => a[0] === 'install' && a[1] === 'bowerloom@beta'));
  assert.ok(calls.some(a => a.join(' ').startsWith('view bowerloom dist-tags --json')));
  assert.ok(calls.some(a => a.join(' ').startsWith(`view bowerloom@${VERSION} dist.integrity`)));
  assert.deepEqual(fs.readdirSync(fx.tmp), [], 'the install project is removed');
  assert.equal(fx.git('status', '--porcelain'), '?? release/desktop-sha256.json', 'verify changes only the hash file written by hashes, and nothing tracked');
});

test('verify without --tarball and without a dry-run receipt fails, never skips the integrity check, and writes no receipt', t => {
  const fx = makeFixture(t);
  readyVerify(fx);
  const r = fx.run(['verify', '--json']);
  assert.equal(r.status, 1);
  const out = r.json();
  assert.equal(out.ok, false);
  assert.equal(checkOf(out, 'integrity').status, 'fail');
  assert.match(checkOf(out, 'integrity').reason, /no --tarball given and no dry-run receipt/);
  assert.ok(!out.checks.some(c => c.status === 'skipped'));
  assert.equal(allFiles(path.join(fx.repo, '.trellis/release/receipts')).filter(f => path.basename(f).startsWith('verify-')).length, 0);
});

test('verify without --tarball takes the tarball from the dry-run receipt, and writes a receipt only when every check passes', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const dry = fx.run(['dry-run', '--json']).json();
  readyVerify(fx);
  const r = fx.run(['verify', '--json']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.json().checks.map(c => c.status), ['pass', 'pass', 'pass', 'pass']);
  assert.match(checkOf(r.json(), 'integrity').reason, new RegExp(dry.integrity.replace(/[+/]/g, '\\$&')));
  const receipts = allFiles(path.join(fx.repo, '.trellis/release/receipts')).filter(f => path.basename(f).startsWith('verify-'));
  assert.equal(receipts.length, 1);
  assert.ok(JSON.parse(fs.readFileSync(receipts[0], 'utf8')).checks.every(c => c.status === 'pass'));
});

test('verify fails when the dry-run tarball changed since the dry run, and compares the receipt integrity when the tarball is gone', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const dry = fx.run(['dry-run', '--json']).json();
  readyVerify(fx);
  fs.writeFileSync(dry.tarball, 'tampered');
  const changed = fx.run(['verify', '--json']);
  assert.equal(changed.status, 1);
  assert.match(checkOf(changed.json(), 'integrity').reason, /differs from the dry-run receipt/);
  fs.rmSync(dry.tarball);
  assert.equal(fx.run(['verify', '--json']).status, 0);
  publish(fx, { integrity: 'sha512-AAAA' });
  const wrong = fx.run(['verify', '--json']);
  assert.equal(wrong.status, 1);
  assert.match(checkOf(wrong.json(), 'integrity').reason, /differs from the local tarball/);
});

test('verify fails on an integrity mismatch, a wrong tag, a missing package, and a wrong installed version', t => {
  const fx = makeFixture(t);
  readyVerify(fx);
  const tarball = tarballFile(fx);
  publish(fx, { integrity: 'sha512-AAAA' });
  const mismatch = fx.run(['verify', '--tarball', tarball, '--json']);
  assert.equal(mismatch.status, 1);
  assert.equal(checkOf(mismatch.json(), 'integrity').status, 'fail');
  assert.match(checkOf(mismatch.json(), 'integrity').reason, /differs from the local tarball/);

  publish(fx, { tag: '0.0.1' });
  const wrongTag = fx.run(['verify', '--json']);
  assert.equal(wrongTag.status, 1);
  assert.match(checkOf(wrongTag.json(), 'dist-tag').reason, /beta points at 0\.0\.1, not 0\.8\.0-beta\.2/);

  fx.setNpm({ distTags: null });
  const missing = fx.run(['verify', '--json']);
  assert.equal(missing.status, 1);
  assert.match(checkOf(missing.json(), 'dist-tag').reason, /not found on the registry/);

  publish(fx);
  fx.setNpm({ installVersion: '9.9.9' });
  const wrongInstall = fx.run(['verify', '--json']);
  assert.equal(wrongInstall.status, 1);
  assert.match(checkOf(wrongInstall.json(), 'install').reason, /installed version is 9\.9\.9/);
  assert.equal(fx.run(['verify', '--tarball', path.join(fx.root, 'nope.tgz'), '--json']).status, 1);
});

test('verify fails when the installed command fails', t => {
  const fx = makeFixture(t);
  readyVerify(fx);
  fx.setNpm({ binExit: 1 });
  const r = fx.run(['verify', '--json']);
  assert.equal(r.status, 1);
  assert.equal(checkOf(r.json(), 'install').reason, 'bowerloom --version failed: error: broken cli');
});

test('verify with an unreachable registry fails with the reason "registry unreachable", never a pass', t => {
  const fx = makeFixture(t);
  readyVerify(fx);
  fx.setNpm({ registry: 'down' });
  const r = fx.run(['verify', '--tarball', tarballFile(fx), '--json']);
  assert.equal(r.status, 1);
  const out = r.json();
  assert.equal(out.ok, false);
  assert.equal(out.message, 'dist-tag: registry unreachable');
  assert.equal(checkOf(out, 'integrity').reason, 'registry unreachable');
  assert.equal(checkOf(out, 'install').status, 'fail');
  assert.ok(!fx.npmCalls().some(c => c.args[0] === 'install'));
});

test('verify fails with the reason "unrecorded" when the hash file is missing, and for any artifact with no recorded hash', t => {
  const fx = makeFixture(t);
  publish(fx);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one' });
  const none = fx.run(['verify', '--json']);
  assert.equal(none.status, 1);
  assert.match(checkOf(none.json(), 'desktop-sha256').reason, /hash file release\/desktop-sha256\.json is missing: every artifact is unrecorded/);
  assert.deepEqual(checkOf(none.json(), 'desktop-sha256').unrecorded, ['a-0.8.0-beta.2.dmg']);

  assert.equal(fx.run(['hashes']).status, 0);
  fx.artifacts({ 'c.zip': 'three' });
  const partial = fx.run(['verify', '--json']);
  assert.equal(partial.status, 1);
  assert.deepEqual(checkOf(partial.json(), 'desktop-sha256').unrecorded, ['c.zip']);
  assert.match(checkOf(partial.json(), 'desktop-sha256').reason, /unrecorded: c\.zip/);
});

test('verify fails on a differing desktop hash, and reports the differing and the unrecorded lists together', t => {
  const fx = makeFixture(t);
  publish(fx);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one', 'b-0.8.0-beta.2.zip': 'two' });
  assert.equal(fx.run(['hashes']).status, 0);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'tampered', 'c.dmg': 'new' });
  const r = fx.run(['verify', '--json']);
  assert.equal(r.status, 1);
  const check = checkOf(r.json(), 'desktop-sha256');
  assert.deepEqual(check.mismatched, ['a-0.8.0-beta.2.dmg']);
  assert.deepEqual(check.unrecorded, ['c.dmg']);
  assert.deepEqual(check.matched, ['b-0.8.0-beta.2.zip']);
  fs.rmSync(path.join(fx.repo, fx.config.desktop.dir, 'b-0.8.0-beta.2.zip'));
  assert.deepEqual(checkOf(fx.run(['verify', '--json']).json(), 'desktop-sha256').missing, ['b-0.8.0-beta.2.zip']);
});

test('verify fails when the hash file is for another version, even if every hash matches', t => {
  const fx = makeFixture(t);
  publish(fx);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one' });
  const hashFile = path.join(fx.repo, 'release/desktop-sha256.json');
  assert.equal(fx.run(['hashes']).status, 0);
  const data = JSON.parse(fs.readFileSync(hashFile, 'utf8'));
  fs.writeFileSync(hashFile, JSON.stringify({ ...data, version: '0.7.0' }));
  const r = fx.run(['verify', '--json']);
  assert.equal(r.status, 1);
  assert.match(checkOf(r.json(), 'desktop-sha256').reason, /is for version 0\.7\.0, not 0\.8\.0-beta\.2/);
  assert.equal(phaseMap(fx.run(['status', '--json']).json()).hashes, 'todo');
});

test('verify fails when there are no desktop artifacts at all', t => {
  const fx = makeFixture(t);
  publish(fx);
  fs.mkdirSync(path.join(fx.repo, 'release'), { recursive: true });
  fs.writeFileSync(path.join(fx.repo, 'release/desktop-sha256.json'), JSON.stringify({ schema: 'bowerloom/desktop-hashes/v1', version: VERSION, files: {} }));
  const r = fx.run(['verify', '--json']);
  assert.equal(r.status, 1);
  assert.match(checkOf(r.json(), 'desktop-sha256').reason, /no desktop artifacts found/);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// tag

/** Every ref on the bare origin, as one string. */
const originRefs = fx => fx.git('ls-remote', 'origin');
/** The refs on the bare origin other than the one release tag. */
const otherRefs = fx => originRefs(fx).split('\n').filter(line => line && !line.includes(`refs/tags/v${VERSION}`)).join('\n');
/** True when the fake npm saw a publish that is not a dry run. */
const sawRealPublish = fx => fx.npmCalls().some(c => c.args[0] === 'publish' && !c.args.includes('--dry-run'));
const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** The exact lines the script echoes before the fetch and the push of the tag. */
const FETCH_LINE = /^\$ git -c core\.hooksPath=\/dev\/null fetch --prune origin$/m;
const PUSH_COMMAND = `git -c core.hooksPath=/dev/null -c push.followTags=false push --no-verify --no-recurse-submodules origin refs/tags/v${VERSION}`;
/** A git command that pushes, fetches, or makes a tag, as the script echoes it ("$ git [-c x=y ...] push ..."). A `git remote get-url --push` line is none of these. */
const DID_PUSH = /^\$ git (?:-c \S+ )*push\b/m;
const DID_PUSH_OR_TAG = /^\$ git (?:-c \S+ )*(?:push|tag)\b/m;
const DID_ANYTHING = /^\$ git (?:-c \S+ )*(?:push|fetch|tag)\b/m;
const PUSH_LINE = new RegExp(`^\\$ ${escapeRe(PUSH_COMMAND)}$`, 'm');
/** Gates and a verify receipt for HEAD: what `tag` needs. Returns the commit. */
const ready = fx => { const head = fx.git('rev-parse', 'HEAD'); passGates(fx); fx.verified(head); return head; };
/** `tag --commit HASH --branch NAME` (the branch defaults to the fixture's release branch). */
const tagAt = (fx, commit, { branch = BRANCH, json = true } = {}) => fx.run(['tag', '--commit', commit, '--branch', branch, ...(json ? ['--json'] : [])]);
/** Gates, then a verify receipt, for a commit that is not checked out. Leaves the release branch checked out. */
const readyAt = (fx, commit) => { fx.git('checkout', '--detach', commit); passGates(fx); fx.verified(commit); fx.git('checkout', BRANCH); };

test('tag creates an annotated tag at the checked commit and pushes only that tag to origin', t => {
  const fx = makeFixture(t);
  const head = ready(fx);
  const before = originRefs(fx);
  const r = fx.run(['tag', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json().tag, `v${VERSION}`);
  assert.equal(r.json().outcome, 'done');
  assert.match(r.json().message, /created and pushed tag v0\.8\.0-beta\.2 at [0-9a-f]{12} to origin/);
  assert.equal(fx.git('cat-file', '-t', `v${VERSION}`), 'tag');
  assert.equal(fx.git('rev-parse', `v${VERSION}^{commit}`), head);
  assert.match(fx.git('tag', '-n1', `v${VERSION}`), /bowerloom 0\.8\.0-beta\.2/);
  // The tag is on the bare origin, annotated, at the checked commit.
  assert.equal(fx.git('--git-dir', fx.origin, 'cat-file', '-t', `refs/tags/v${VERSION}`), 'tag');
  assert.equal(fx.git('--git-dir', fx.origin, 'rev-parse', `refs/tags/v${VERSION}^{commit}`), head);
  // No other ref on origin changed or appeared.
  assert.equal(otherRefs(fx), before);
  assert.match(r.stderr, PUSH_LINE, 'the push is this exact command');
  assert.match(r.stderr, FETCH_LINE, 'the fetch prunes and runs no hooks');
  assert.doesNotMatch(r.stderr, /--force|--tags|-f /);
  assert.equal(sawRealPublish(fx), false);
});

test('tag is idempotent: the second run says already done, and a different commit on the local tag fails', t => {
  const fx = makeFixture(t);
  const first = ready(fx);
  assert.equal(fx.run(['tag']).status, 0);
  const onOrigin = originRefs(fx);
  const again = fx.run(['tag', '--json']);
  assert.equal(again.status, 0);
  assert.equal(again.json().outcome, 'already done');
  assert.match(again.json().message, /already done/);
  assert.doesNotMatch(again.stderr, DID_PUSH, 'an already done run pushes nothing');
  assert.equal(originRefs(fx), onOrigin);
  fx.commit('c.txt', 'c');
  fx.git('push', 'origin', 'HEAD');
  assert.match(fx.run(['tag', '--json']).json().message, /no passing gates receipt/);
  passGates(fx);
  const moved = fx.run(['tag', '--json']);
  assert.equal(moved.status, 1);
  assert.match(moved.json().message, new RegExp(`exists at ${first.slice(0, 12)}`));
  assert.equal(tagAt(fx, first).json().outcome, 'already done');
  assert.equal(fx.git('--git-dir', fx.origin, 'rev-parse', `refs/tags/v${VERSION}^{commit}`), first, 'origin still has the first commit');
  assert.equal(sawRealPublish(fx), false);
});

test('tag pushes a local-only tag, and then reports already done', t => {
  const fx = makeFixture(t);
  const head = ready(fx);
  fx.git('tag', '-a', '-m', 'bowerloom 0.8.0-beta.2', '--', `v${VERSION}`, head);
  assert.equal(fx.git('ls-remote', '--tags', 'origin'), '');
  const r = fx.run(['tag', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json().outcome, 'done');
  assert.doesNotMatch(r.stderr, /git tag /, 'the local tag already existed');
  assert.equal(fx.git('--git-dir', fx.origin, 'rev-parse', `refs/tags/v${VERSION}^{commit}`), head);
  assert.equal(fx.run(['tag', '--json']).json().outcome, 'already done');
});

test('tag fails and never overwrites when origin has the tag at a different commit', t => {
  const fx = makeFixture(t);
  const first = fx.git('rev-parse', 'HEAD');
  const second = fx.commit('c.txt', 'c');
  fx.git('push', 'origin', 'HEAD');
  // Another person pushed the tag at the first commit.
  fx.git('tag', '-a', '-m', 'someone else', `v${VERSION}`, first);
  fx.git('push', 'origin', `refs/tags/v${VERSION}`);
  fx.git('tag', '-d', `v${VERSION}`);
  ready(fx);
  const refsBefore = originRefs(fx);
  const remoteObject = fx.git('--git-dir', fx.origin, 'rev-parse', `refs/tags/v${VERSION}`);
  // A fetch normally brings the remote tag into this clone. Turn that off, so the read of origin is what finds the tag.
  fx.git('config', 'remote.origin.tagOpt', '--no-tags');
  const r = tagAt(fx, second);
  assert.equal(r.status, 1);
  assert.equal(r.json().outcome, 'failed');
  assert.match(r.json().message, new RegExp(`origin has v${VERSION.replace(/\./g, '\\.')} at ${first.slice(0, 12)}, not ${second.slice(0, 12)}`));
  assert.equal(fx.git('tag', '--list'), '', 'no local tag is made when origin already has another one');
  assert.equal(originRefs(fx), refsBefore);
  assert.equal(fx.git('--git-dir', fx.origin, 'rev-parse', `refs/tags/v${VERSION}`), remoteObject);
  assert.doesNotMatch(r.stderr, DID_PUSH);
  // The plain form fetches first, which brings the remote tag into this clone. It still fails and still overwrites nothing.
  fx.git('config', '--unset', 'remote.origin.tagOpt');
  const plain = fx.run(['tag', '--json']);
  assert.equal(plain.status, 1);
  assert.match(plain.json().message, new RegExp(`exists at ${first.slice(0, 12)}, not ${second.slice(0, 12)}`));
  assert.equal(originRefs(fx), refsBefore);
  assert.doesNotMatch(plain.stderr, DID_PUSH);
  assert.equal(sawRealPublish(fx), false);
});

test('tag fails when origin has the tag at the checked commit but the local tag is missing', t => {
  const fx = makeFixture(t);
  const head = ready(fx);
  fx.git('tag', '-a', '-m', 'x', `v${VERSION}`, head);
  fx.git('push', 'origin', `refs/tags/v${VERSION}`);
  fx.git('tag', '-d', `v${VERSION}`);
  fx.git('config', 'remote.origin.tagOpt', '--no-tags');
  const r = tagAt(fx, head);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /origin has v0\.8\.0-beta\.2 at [0-9a-f]{12} but this clone has no such tag/);
  assert.equal(fx.git('tag', '--list'), '');
});

test('a failed push fails with the first error line and no receipt, and a later run pushes the kept local tag', t => {
  const fx = makeFixture(t);
  const head = ready(fx);
  // A pre-receive hook on the bare origin rejects every update. The ref listing still works.
  const hook = path.join(fx.origin, 'hooks/pre-receive');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, '#!/bin/sh\necho "refusing this push" >&2\nexit 1\n', { mode: 0o755 });
  const receipts = () => allFiles(path.join(fx.repo, '.trellis/release/receipts')).sort();
  const receiptsBefore = receipts();
  const refsBefore = originRefs(fx);
  const r = fx.run(['tag', '--json']);
  assert.equal(r.status, 1);
  assert.equal(r.json().outcome, 'failed');
  assert.match(r.json().message, /^git push failed: /);
  assert.match(r.json().message, /refusing this push|rejected|failed/);
  assert.equal(r.json().message.includes('\n'), false, 'one line');
  assert.deepEqual(receipts(), receiptsBefore, 'no receipt is written');
  assert.equal(originRefs(fx), refsBefore, 'nothing changed on origin');
  assert.equal(fx.git('rev-parse', `v${VERSION}^{commit}`), head, 'the local tag is kept');
  fs.rmSync(hook);
  assert.equal(fx.run(['tag']).status, 0);
  assert.equal(fx.git('--git-dir', fx.origin, 'rev-parse', `refs/tags/v${VERSION}^{commit}`), head);
});

test('tag fails with the first error line, and makes no tag, when origin cannot be reached', t => {
  const fx = makeFixture(t);
  ready(fx);
  fx.git('remote', 'set-url', 'origin', path.join(fx.root, 'no-such-origin.git'));
  const r = tagAt(fx, fx.git('rev-parse', 'HEAD'));
  assert.equal(r.status, 1);
  assert.match(r.json().message, /^git fetch origin failed: /);
  assert.equal(r.json().message.includes('\n'), false, 'one line');
  assert.equal(fx.git('tag', '--list'), '');
});

test('tag without --commit needs a passing gates receipt, then a passing verify receipt, for the checked commit, and writes no tag without them', t => {
  const fx = makeFixture(t);
  const r = fx.run(['tag', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /no passing gates receipt for [0-9a-f]{12} 0\.8\.0-beta\.2; run gates on that commit first/);
  assert.equal(fx.git('tag', '--list'), '');
  passGates(fx);
  const before = originRefs(fx);
  const noVerify = fx.run(['tag', '--json']);
  assert.equal(noVerify.status, 1);
  assert.match(noVerify.json().message, /no passing verify receipt for [0-9a-f]{12} 0\.8\.0-beta\.2; run verify first \(the package must be published and verified before the tag\)/);
  assert.equal(fx.git('tag', '--list'), '');
  assert.equal(originRefs(fx), before);
  assert.doesNotMatch(noVerify.stderr, DID_PUSH_OR_TAG);
  fx.verified();
  assert.equal(fx.run(['tag']).status, 0);
});

test('tag needs a verify receipt for the same version, with every check passed, at the tagged commit or an ancestor of it', t => {
  const fx = makeFixture(t);
  const first = fx.git('rev-parse', 'HEAD');
  passGates(fx);
  const second = fx.commit('c.txt', 'c');
  fx.git('push', 'origin', 'HEAD');
  const before = originRefs(fx);
  const verifyMessage = /run verify first \(the package must be published and verified before the tag\)/;
  // A receipt for another version, a receipt with a check that did not pass, and a receipt on a LATER commit do not count.
  fx.verified(first, { version: '0.0.1' });
  assert.match(tagAt(fx, first).json().message, verifyMessage);
  fx.verified(first, { status: 'fail' });
  assert.match(tagAt(fx, first).json().message, verifyMessage);
  fx.verified(second);
  const later = tagAt(fx, first);
  assert.equal(later.status, 1);
  assert.match(later.json().message, verifyMessage);
  assert.equal(fx.git('tag', '--list'), '');
  assert.equal(originRefs(fx), before);
  // A passing receipt on the commit itself counts.
  fx.verified(first);
  assert.equal(tagAt(fx, first).status, 0);
});

test('a verify receipt on an ancestor of the tagged commit counts', t => {
  const fx = makeFixture(t);
  const first = fx.verified();
  const second = fx.commit('c.txt', 'c');
  fx.git('push', 'origin', 'HEAD');
  passGates(fx);
  const r = fx.run(['tag', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fx.git('rev-parse', `v${VERSION}^{commit}`), second);
  assert.notEqual(first, second);
});

test('tag refuses to run on a dirty tree', t => {
  const fx = makeFixture(t);
  fs.writeFileSync(path.join(fx.repo, 'stray.txt'), 'x');
  const r = fx.run(['tag', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /not clean: \?\? stray\.txt/);
});

test('tag refuses to run on a branch that is behind origin', t => {
  const fx = makeFixture(t);
  const other = path.join(fx.root, 'other');
  spawnSync('git', ['clone', '-b', BRANCH, fx.origin, other], { env: fx.baseEnv });
  fs.writeFileSync(path.join(other, 'new.txt'), 'x');
  for (const args of [['add', '-A'], ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-m', 'remote change'], ['push', 'origin', 'HEAD']]) assert.equal(spawnSync('git', args, { cwd: other, env: fx.baseEnv }).status, 0);
  const r = fx.run(['tag', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /0 ahead and 1 behind/);
  assert.equal(fx.git('tag', '--list'), '');
});

test('tag --commit needs a full hash, a --branch that matches the branch pattern, a real commit, and passing gates and verify receipts for it', t => {
  const fx = makeFixture(t);
  const older = fx.git('rev-parse', 'HEAD');
  // Wrong use: exit 2, and nothing is read or written.
  const usage = (args, pattern) => { const r = fx.run([...args, '--json']); assert.equal(r.status, 2, args.join(' ')); assert.equal(r.json().outcome, 'usage'); assert.match(r.json().message, pattern); return r; };
  usage(['tag', '--commit', fx.git('rev-parse', '--short', 'HEAD'), '--branch', BRANCH], /40-character/);
  usage(['tag', '--commit', older], /--commit needs --branch/);
  usage(['tag', '--commit', older, '--branch', 'feature/x'], /does not match the branchPattern/);
  usage(['tag', '--commit', older, '--branch', 'release/has space'], /invalid form/);
  assert.equal(tagAt(fx, 'a'.repeat(40)).status, 1);
  const noReceipt = tagAt(fx, older);
  assert.equal(noReceipt.status, 1);
  assert.match(noReceipt.json().message, /no passing gates receipt for /);
  assert.equal(fx.git('tag', '--list'), '');
  passGates(fx);
  assert.match(tagAt(fx, older).json().message, /run verify first/);
  fx.verified(older);
  fx.commit('d.txt', 'd');
  fx.git('push', 'origin', 'HEAD');
  assert.equal(tagAt(fx, older, { json: false }).status, 0);
  assert.equal(fx.git('rev-parse', `v${VERSION}^{commit}`), older);
  assert.equal(fx.git('--git-dir', fx.origin, 'rev-parse', `refs/tags/v${VERSION}^{commit}`), older, 'the tag is on origin at the tagged commit');
});

test('tag --commit refuses a gated commit that exists only locally, and nothing reaches origin', t => {
  const fx = makeFixture(t);
  const local = fx.commit('local.txt', 'unpublished');
  ready(fx);
  const refsBefore = originRefs(fx);
  const r = tagAt(fx, local);
  assert.equal(r.status, 1);
  assert.equal(r.json().outcome, 'failed');
  assert.equal(r.json().message, `commit ${local} is not on origin/${BRANCH}; push the branch first`);
  assert.match(r.stderr, FETCH_LINE, 'the --commit path fetches first');
  assert.doesNotMatch(r.stderr, DID_PUSH_OR_TAG);
  assert.equal(fx.git('tag', '--list'), '');
  assert.equal(originRefs(fx), refsBefore);
  assert.equal(spawnSync('git', ['--git-dir', fx.origin, 'cat-file', '-e', `${local}^{commit}`], { env: fx.baseEnv }).status === 0, false, 'the unpublished commit never reached origin');
  // Once the branch is pushed, the same call passes.
  fx.git('push', 'origin', 'HEAD');
  assert.equal(tagAt(fx, local, { json: false }).status, 0);
  assert.equal(fx.git('--git-dir', fx.origin, 'rev-parse', `refs/tags/v${VERSION}^{commit}`), local);
});

test('tag --commit passes for a commit on the named published release branch, which is not the checked-out one', t => {
  const fx = makeFixture(t);
  const base = fx.git('rev-parse', 'HEAD');
  fx.git('checkout', '-b', 'release/other');
  const other = fx.commit('other.txt', 'other');
  fx.git('push', 'origin', 'release/other');
  fx.git('checkout', BRANCH);
  fx.git('branch', '-D', 'release/other');
  assert.notEqual(other, base);
  readyAt(fx, other);
  const r = tagAt(fx, other, { branch: 'release/other' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fx.git('--git-dir', fx.origin, 'rev-parse', `refs/tags/v${VERSION}^{commit}`), other);
});

test('tag --commit proves the commit is on exactly the named branch: a stray release/scratch branch that holds it does not count', t => {
  const fx = makeFixture(t);
  fx.git('checkout', '-b', 'release/scratch');
  const stray = fx.commit('scratch.txt', 'scratch');
  fx.git('push', 'origin', 'release/scratch');
  fx.git('checkout', BRANCH);
  readyAt(fx, stray);
  const refsBefore = originRefs(fx);
  const r = tagAt(fx, stray);
  assert.equal(r.status, 1);
  assert.equal(r.json().message, `commit ${stray} is not on origin/${BRANCH}; push the branch first`);
  assert.equal(fx.git('tag', '--list'), '');
  assert.equal(originRefs(fx), refsBefore);
  assert.doesNotMatch(r.stderr, DID_PUSH_OR_TAG);
  // Named, the same branch is the proof.
  assert.equal(tagAt(fx, stray, { branch: 'release/scratch' }).status, 0);
});

test('tag --commit fetches with --prune: a release branch deleted on origin is not proof, and nothing is pushed', t => {
  const fx = makeFixture(t);
  fx.git('checkout', '-b', 'release/stale');
  const stale = fx.commit('stale.txt', 'stale');
  fx.git('push', 'origin', 'release/stale');
  fx.git('checkout', BRANCH);
  readyAt(fx, stale);
  // A second clone deletes the branch on origin. This clone still holds its remote-tracking ref until a prune.
  const other = path.join(fx.root, 'other');
  assert.equal(spawnSync('git', ['clone', fx.origin, other], { env: fx.baseEnv }).status, 0);
  assert.equal(spawnSync('git', ['push', 'origin', '--delete', 'release/stale'], { cwd: other, env: fx.baseEnv }).status, 0);
  assert.equal(fx.git('rev-parse', '--verify', 'refs/remotes/origin/release/stale'), stale, 'the stale tracking ref is still here');
  const refsBefore = originRefs(fx);
  const r = tagAt(fx, stale, { branch: 'release/stale' });
  assert.equal(r.status, 1);
  assert.equal(r.json().message, 'origin has no branch release/stale; push the branch first');
  assert.match(r.stderr, FETCH_LINE);
  assert.doesNotMatch(r.stderr, DID_PUSH_OR_TAG);
  assert.equal(fx.git('tag', '--list'), '');
  assert.equal(originRefs(fx), refsBefore);
});

test('preflight fetches with --prune and without hooks', t => {
  const fx = makeFixture(t);
  const r = fx.run(['preflight']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, FETCH_LINE);
});

test('a git error from the ancestor check is reported as a git error, not as "not on the branch"', t => {
  const fx = makeFixture(t);
  const head = ready(fx);
  // A git that fails every merge-base with exit 128, as a damaged repository would.
  const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const bin = path.join(fx.root, 'shim');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nfor a in "$@"; do if [ "$a" = merge-base ]; then echo "fatal: simulated git failure" >&2; exit 128; fi; done\nexec ${real} "$@"\n`, { mode: 0o755 });
  const r = fx.run(['tag', '--commit', head, '--branch', BRANCH, '--json'], { env: { PATH: `${bin}:${fx.baseEnv.PATH}` } });
  assert.equal(r.status, 1);
  assert.match(r.json().message, /^git merge-base failed: fatal: simulated git failure/);
  assert.doesNotMatch(r.json().message, /is not on origin/);
  assert.doesNotMatch(r.stderr, DID_PUSH_OR_TAG);
  assert.equal(fx.git('tag', '--list'), '');
});

test('the tag push and the fetches run no repository hooks', t => {
  const fx = makeFixture(t);
  const hooks = path.join(fx.root, 'hooks');
  fs.mkdirSync(hooks);
  const marker = path.join(fx.root, 'hook-ran.txt');
  // pre-push would block and note the push; reference-transaction notes every ref update, which a fetch of a new branch makes.
  fs.writeFileSync(path.join(hooks, 'pre-push'), `#!/bin/sh\necho pre-push >> ${marker}\nexit 1\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(hooks, 'reference-transaction'), `#!/bin/sh\nif [ "$1" = prepared ]; then cat >> ${marker}; fi\nexit 0\n`, { mode: 0o755 });
  fx.git('config', 'core.hooksPath', hooks);
  const head = ready(fx);
  // Origin gains a new branch, so the next fetch updates a ref in this clone.
  const other = path.join(fx.root, 'other');
  assert.equal(spawnSync('git', ['clone', '-b', BRANCH, fx.origin, other], { env: fx.baseEnv }).status, 0);
  assert.equal(spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/release/fetched'], { cwd: other, env: fx.baseEnv }).status, 0);
  const r = fx.run(['tag', '--json']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(fx.git('--git-dir', fx.origin, 'rev-parse', `refs/tags/v${VERSION}^{commit}`), head);
  assert.equal(fx.git('rev-parse', '--verify', 'refs/remotes/origin/release/fetched').length, 40, 'the fetch did update a ref');
  const seen = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
  assert.doesNotMatch(seen, /pre-push/, 'pre-push did not run');
  assert.doesNotMatch(seen, /refs\/remotes\/origin\/release\/fetched/, 'no hook ran for the fetch');
});

test('tag refuses when the push URL differs from the fetch URL, before it fetches or pushes anything', t => {
  const fx = makeFixture(t);
  ready(fx);
  const elsewhere = path.join(fx.root, 'elsewhere.git');
  assert.equal(spawnSync('git', ['init', '--bare', '-b', 'main', elsewhere], { env: fx.baseEnv }).status, 0);
  fx.git('remote', 'set-url', '--push', 'origin', elsewhere);
  const r = fx.run(['tag', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /push URL differs from fetch URL/);
  assert.doesNotMatch(r.stderr, DID_ANYTHING);
  assert.equal(fx.git('tag', '--list'), '');
  assert.equal(fx.git('--git-dir', elsewhere, 'tag', '--list'), '');
});

test('tag refuses under a test seam when the origin URL is not a local filesystem path', t => {
  const fx = makeFixture(t);
  ready(fx);
  for (const url of ['ssh://git@example.com/owner/repo.git', 'git@example.com:owner/repo.git', 'https://example.com/owner/repo.git']) {
    fx.git('remote', 'set-url', 'origin', url);
    const r = fx.run(['tag', '--json']);
    assert.equal(r.status, 1, url);
    assert.match(r.json().message, /test seams are active and the origin URL is not a local path/, url);
    assert.doesNotMatch(r.stderr, DID_ANYTHING, url);
  }
  assert.equal(fx.git('tag', '--list'), '');
});

test('the tag push ignores push.followTags: origin gains only the release tag', t => {
  const fx = makeFixture(t);
  const head = fx.git('rev-parse', 'HEAD');
  fx.git('config', 'push.followTags', 'true');
  // A second annotated local tag on a commit the push would carry, and an unpushed local branch.
  fx.git('tag', '-a', '-m', 'other', 'v0.0.1-other', head);
  fx.git('branch', 'release/unpushed');
  ready(fx);
  const before = originRefs(fx);
  const r = fx.run(['tag', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, PUSH_LINE);
  assert.equal(otherRefs(fx), before);
  const tags = fx.git('--git-dir', fx.origin, 'tag', '--list').split('\n').filter(Boolean);
  assert.deepEqual(tags, [`v${VERSION}`]);
  assert.equal(fx.git('--git-dir', fx.origin, 'branch', '--list').split('\n').filter(l => l.includes('unpushed')).length, 0);
  assert.equal(fx.git('tag', '--list', 'v0.0.1-other'), 'v0.0.1-other', 'the other local tag is kept');
});

test('tag fails when origin has a lightweight tag at another commit, and overwrites nothing', t => {
  const fx = makeFixture(t);
  const first = fx.git('rev-parse', 'HEAD');
  const second = fx.commit('c.txt', 'c');
  fx.git('push', 'origin', 'HEAD');
  fx.git('tag', `v${VERSION}`, first);
  fx.git('push', 'origin', `refs/tags/v${VERSION}`);
  fx.git('tag', '-d', `v${VERSION}`);
  fx.git('config', 'remote.origin.tagOpt', '--no-tags');
  ready(fx);
  const refsBefore = originRefs(fx);
  assert.equal(fx.git('--git-dir', fx.origin, 'cat-file', '-t', `refs/tags/v${VERSION}`), 'commit', 'the tag on origin is lightweight');
  const r = tagAt(fx, second);
  assert.equal(r.status, 1);
  assert.match(r.json().message, new RegExp(`origin has v${VERSION.replace(/\./g, '\\.')} at ${first.slice(0, 12)}, not ${second.slice(0, 12)}; it was not overwritten`));
  assert.equal(fx.git('tag', '--list'), '');
  assert.equal(originRefs(fx), refsBefore);
  assert.doesNotMatch(r.stderr, DID_PUSH);
});

test('a tag that appears on origin between the read and the push is rejected, and nothing is overwritten', t => {
  const fx = makeFixture(t);
  const first = fx.git('rev-parse', 'HEAD');
  const second = fx.commit('c.txt', 'c');
  fx.git('push', 'origin', 'HEAD');
  ready(fx);
  // The race: while origin receives the push, another tag appears at the first commit, as if a second person pushed just before.
  const hook = path.join(fx.origin, 'hooks/pre-receive');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `#!/bin/sh\nmkdir -p refs/tags\necho ${first} > refs/tags/v${VERSION}\nexit 0\n`, { mode: 0o755 });
  const r = tagAt(fx, second);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.json().outcome, 'failed');
  assert.match(r.json().message, /^git push failed: /);
  assert.equal(r.json().message.includes('\n'), false, 'one line');
  assert.equal(fx.git('--git-dir', fx.origin, 'rev-parse', `refs/tags/v${VERSION}`), first, 'the other tag on origin is untouched');
  assert.equal(allFiles(path.join(fx.repo, '.trellis/release/receipts')).filter(f => f.includes('tag')).length, 0, 'no tag receipt');
});

test('every JSON result lists the active test seams, and a run without seams has no seams key', t => {
  const fx = makeFixture(t);
  const r = fx.run(['status', '--json']);
  assert.deepEqual(r.json().seams.sort(), ['--repo', 'BOWERLOOM_RELEASE_FREE_GIB', 'BOWERLOOM_RELEASE_NPM', 'BOWERLOOM_RELEASE_PACK']);
  const failed = fx.run(['tag', '--json']);
  assert.equal(failed.status, 1);
  assert.equal(failed.json().seams.length, 4, 'a failure lists them too');
  const usage = fx.run(['tag', '--commit', 'zz', '--json']);
  assert.equal(usage.status, 2);
  assert.equal(usage.json().seams.length, 4, 'a usage error found after the seams were read lists them too');
  // No seam: a usage error in the real repository (no network, no git write).
  const real = spawnSync(process.execPath, [scriptPath, 'tag', '--commit', 'zz', '--json'], { env: { PATH: fx.baseEnv.PATH, HOME: fx.baseEnv.HOME, TMPDIR: fx.tmp }, encoding: 'utf8' });
  assert.equal(real.status, 2, real.stderr);
  assert.equal(JSON.parse(real.stdout).seams, undefined);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// status

const phaseMap = out => Object.fromEntries(out.phases.map(p => [p.phase, p.state]));

test('status is read-only and shows todo for a fresh checkout whose package is not on the registry', t => {
  const fx = makeFixture(t);
  const r = fx.run(['status', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(phaseMap(r.json()), { record: 'todo', gates: 'todo', 'dry-run': 'todo', publish: 'todo', 'dist-tag': 'todo', 'desktop-version': 'done', hashes: 'todo', verify: 'todo', tag: 'todo', 'tag-on-origin': 'todo' });
  assert.ok(r.json().phases.every(p => p.reason.length > 0));
  assert.equal(fx.git('status', '--porcelain'), '');
  assert.equal(allFiles(path.join(fx.repo, '.trellis')).length, 0);
  assert.ok(fx.npmCalls().every(c => c.args[0] === 'view'));
  const human = fx.run(['status']);
  assert.match(human.stdout, /todo {4}gates/);
});

test('status marks registry phases unknown, never todo, when the registry cannot be reached', t => {
  const fx = makeFixture(t);
  fx.setNpm({ registry: 'down' });
  const phases = phaseMap(fx.run(['status', '--json']).json());
  assert.equal(phases.publish, 'unknown');
  assert.equal(phases['dist-tag'], 'unknown');
});

test('status follows the steps: receipts, registry state, desktop version, hashes, tag and the tag on origin', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const published = fx.git('rev-parse', 'HEAD');
  assert.equal(fx.run(['dry-run']).status, 0);
  publish(fx);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one' });
  assert.equal(fx.run(['hashes']).status, 0);
  // The hash file is a tracked file, so a person commits and pushes it. Receipts follow the new commit, so verify runs after.
  fx.commit('.keep', 'x', 'Record the desktop hashes');
  fx.git('push', 'origin', 'HEAD');
  assert.equal(fx.run(['verify']).status, 0);
  // The verify receipt belongs to the hash commit, so the tag goes on that commit (or on a later one). The tag step needs gates for it too.
  assert.equal(fx.run(['tag']).status, 1);
  assert.equal(fx.run(['tag', '--commit', published, '--branch', BRANCH]).status, 1, 'the verify receipt is on a later commit than the published one');
  passGates(fx);
  assert.equal(fx.run(['tag']).status, 0);
  let phases = phaseMap(fx.run(['status', '--json']).json());
  // The receipt for the dry run belongs to the commit before the hash commit.
  assert.deepEqual(phases, { record: 'todo', gates: 'done (with test seams)', 'dry-run': 'todo', publish: 'done', 'dist-tag': 'done', 'desktop-version': 'done', hashes: 'done', verify: 'done (with test seams)', tag: 'done', 'tag-on-origin': 'done' });

  fx.setNpm({ distTags: { beta: '0.0.1' }, versions: {} });
  phases = phaseMap(fx.run(['status', '--json']).json());
  assert.equal(phases.publish, 'todo');
  assert.equal(phases['dist-tag'], 'todo');
});

test('status counts a receipt written under test seams as "done (with test seams)", not as done', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const out = fx.run(['status', '--json']).json();
  assert.equal(phaseMap(out).gates, 'done (with test seams)');
  assert.deepEqual(out.phases.filter(p => p.state === 'done').map(p => p.phase), ['desktop-version'], 'only a phase without a receipt counts as done');
  const receipt = JSON.parse(fs.readFileSync(allFiles(path.join(fx.repo, '.trellis/release/receipts'))[0], 'utf8'));
  assert.deepEqual(receipt.seams.sort(), ['--repo', 'BOWERLOOM_RELEASE_FREE_GIB', 'BOWERLOOM_RELEASE_NPM', 'BOWERLOOM_RELEASE_PACK']);
});

test('status shows gates and the dry run as todo when the tree is dirty or the tarball is gone', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const dry = fx.run(['dry-run', '--json']).json();
  assert.deepEqual([phaseMap(fx.run(['status', '--json']).json()).gates, phaseMap(fx.run(['status', '--json']).json())['dry-run']], ['done (with test seams)', 'done (with test seams)']);
  fs.rmSync(dry.tarball);
  assert.equal(phaseMap(fx.run(['status', '--json']).json())['dry-run'], 'todo');
  fs.writeFileSync(path.join(fx.repo, 'stray.txt'), 'x');
  const dirty = fx.run(['status', '--json']).json();
  assert.equal(phaseMap(dirty).gates, 'todo');
  assert.match(dirty.phases.find(p => p.phase === 'gates').reason, /not clean/);
});

test('status marks the tag done only when it points at the release commit, and the tag on origin done only when origin has it at that commit', t => {
  const fx = makeFixture(t);
  const first = fx.git('rev-parse', 'HEAD');
  passGates(fx);
  // A local tag that nobody pushed is not on origin, and the tag phase says it is local only.
  fx.git('tag', '-a', '-m', 'local only', `v${VERSION}`, first);
  const unpushed = fx.run(['status', '--json']).json().phases.find(p => p.phase === 'tag-on-origin');
  assert.equal(unpushed.state, 'todo');
  assert.match(unpushed.reason, /not on origin/);
  const localOnly = fx.run(['status', '--json']).json().phases.find(p => p.phase === 'tag');
  assert.equal(localOnly.state, 'done');
  assert.match(localOnly.reason, /\(local only\)/);
  fx.verified(first);
  assert.equal(fx.run(['tag']).status, 0);
  assert.doesNotMatch(fx.run(['status', '--json']).json().phases.find(p => p.phase === 'tag').reason, /local only/, 'once origin has it, the tag is not local only');
  fx.commit('e.txt', 'e');
  fx.git('push', 'origin', 'HEAD');
  let phases = fx.run(['status', '--json']).json().phases;
  const tag = phases.find(p => p.phase === 'tag');
  assert.equal(tag.state, 'todo');
  assert.match(tag.reason, new RegExp(`at ${first.slice(0, 12)}`));
  assert.equal(phases.find(p => p.phase === 'tag-on-origin').state, 'done', 'origin has the tag at the same commit as the local tag');
  // Move the tag to HEAD locally; origin keeps the old copy, which `tag` pushed.
  fx.git('tag', '-f', '-a', `v${VERSION}`, '-m', 'again', 'HEAD');
  phases = fx.run(['status', '--json']).json().phases;
  assert.equal(phases.find(p => p.phase === 'tag').state, 'done');
  const pushed = phases.find(p => p.phase === 'tag-on-origin');
  assert.equal(pushed.state, 'todo');
  assert.match(pushed.reason, /not at/);
  fx.git('push', '-f', 'origin', `v${VERSION}`);
  assert.equal(phaseMap(fx.run(['status', '--json']).json())['tag-on-origin'], 'done');
});

test('status marks the tag unknown, not todo, when the local tag ref cannot be read', t => {
  const fx = makeFixture(t);
  ready(fx);
  // A tag ref that names an object this clone does not have.
  const ref = path.join(fx.repo, '.git/refs/tags', `v${VERSION}`);
  fs.mkdirSync(path.dirname(ref), { recursive: true });
  fs.writeFileSync(ref, '1'.repeat(40) + '\n');
  const tag = fx.run(['status', '--json']).json().phases.find(p => p.phase === 'tag');
  assert.equal(tag.state, 'unknown');
  assert.match(tag.reason, /cannot read the local tag/);
  // A missing tag is still todo.
  fs.rmSync(ref);
  assert.equal(fx.run(['status', '--json']).json().phases.find(p => p.phase === 'tag').state, 'todo');
});

test('status reports a tag that origin has but this clone lacks, with a fetch hint, and not todo', t => {
  const fx = makeFixture(t);
  const head = fx.git('rev-parse', 'HEAD');
  passGates(fx);
  fx.git('tag', '-a', '-m', 'x', `v${VERSION}`, head);
  fx.git('push', 'origin', `refs/tags/v${VERSION}`);
  fx.git('tag', '-d', `v${VERSION}`);
  const phase = fx.run(['status', '--json']).json().phases.find(p => p.phase === 'tag-on-origin');
  assert.equal(phase.state, 'done');
  assert.match(phase.reason, new RegExp(`v0\\.8\\.0-beta\\.2 exists on origin at ${head.slice(0, 12)}`));
  assert.match(phase.reason, /git fetch origin tag v0\.8\.0-beta\.2/);
  // A tag on origin at some other commit is not done.
  const second = fx.commit('c.txt', 'c');
  fx.git('push', 'origin', 'HEAD');
  const other = fx.run(['status', '--json']).json().phases.find(p => p.phase === 'tag-on-origin');
  assert.equal(other.state, 'todo');
  assert.match(other.reason, new RegExp(`origin has v0\\.8\\.0-beta\\.2 at ${head.slice(0, 12)}, not at the release commit ${second.slice(0, 12)}`));
});

test('status marks hashes done only when the recorded hashes equal the files on disk', t => {
  const fx = makeFixture(t);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one' });
  assert.equal(fx.run(['hashes']).status, 0);
  assert.equal(phaseMap(fx.run(['status', '--json']).json()).hashes, 'done');
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'tampered' });
  const r = fx.run(['status', '--json']).json();
  assert.equal(phaseMap(r).hashes, 'todo');
  assert.match(r.phases.find(p => p.phase === 'hashes').reason, /hash differs: a-0\.8\.0-beta\.2\.dmg/);
  fx.artifacts({ 'a-0.8.0-beta.2.dmg': 'one' });
  fs.rmSync(path.join(fx.repo, fx.config.desktop.dir, 'a-0.8.0-beta.2.dmg'));
  fx.artifacts({ 'b.dmg': 'two' });
  assert.equal(phaseMap(fx.run(['status', '--json']).json()).hashes, 'todo');
});

test('status reports unknown, not todo, for a registry 404 when the release record says the package is published', t => {
  const fx = makeFixture(t, { record: { state: 'published', npm: { published: true } } });
  const phases = fx.run(['status', '--json']).json().phases;
  for (const name of ['publish', 'dist-tag']) {
    const p = phases.find(x => x.phase === name);
    assert.equal(p.state, 'unknown', name);
    assert.match(p.reason, /npm\.published is true/);
  }
  publish(fx);
  fx.setNpm({ versions: {} });
  assert.equal(phaseMap(fx.run(['status', '--json']).json()).publish, 'unknown');
});

test('status reads the record state and a desktop version that differs', t => {
  const fx = makeFixture(t, { record: { state: 'published', npm: { published: true } } });
  fs.writeFileSync(path.join(fx.repo, 'apps/desktop/package.json'), JSON.stringify({ version: '0.0.1' }));
  const phases = phaseMap(fx.run(['status', '--json']).json());
  assert.equal(phases.record, 'done');
  assert.equal(phases['desktop-version'], 'todo');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// claims

test('claims lists file:line for each stale phrase, skips node_modules, dist and .git, and exits 1', t => {
  const fx = makeFixture(t);
  const content = path.join(fx.repo, 'apps/docs/src/content/docs');
  fs.writeFileSync(path.join(content, 'start.md'), 'Fine line\nThe package is not published yet.\nOther\n');
  fs.mkdirSync(path.join(content, 'node_modules/x'), { recursive: true });
  fs.mkdirSync(path.join(content, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(content, '.git'), { recursive: true });
  for (const d of ['node_modules/x', 'dist', '.git']) fs.writeFileSync(path.join(content, d, 'skip.md'), 'is not published yet\n');
  fs.writeFileSync(path.join(fx.repo, 'README.md'), 'a\nb\nIt is not on npm yet. Also has not been published.\n');
  fs.writeFileSync(path.join(content, 'case.md'), 'Is Not Published Yet\n');
  fs.writeFileSync(path.join(content, 'bin.dat'), Buffer.from([0, 1, 2, 0x69, 0x73]));
  const r = fx.run(['claims', '--json']);
  assert.equal(r.status, 1);
  assert.deepEqual(r.json().hits, ['README.md:3', 'apps/docs/src/content/docs/case.md:1', 'apps/docs/src/content/docs/start.md:2']);
  const human = fx.run(['claims']);
  assert.equal(human.status, 1);
  assert.match(human.stderr, /^ {2}README\.md:3$/m);
  assert.ok(!human.stderr.includes('is not on npm yet'), 'only file:line is printed');
  assert.equal(fx.npmCalls().length, 0);
});

test('claims passes on clean files, reports how many it scanned, and fails when a configured path is missing', t => {
  const fx = makeFixture(t);
  const ok = fx.run(['claims', '--json']);
  assert.equal(ok.status, 0);
  assert.equal(ok.json().scanned, 3);
  assert.deepEqual(ok.json().skipped, []);
  fs.rmSync(path.join(fx.repo, 'apps/landing'), { recursive: true });
  const r = fx.run(['claims', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /claims path not found: apps\/landing\/content/);
});

test('claims matches without regard to case or line breaks, and reports the line where the match starts', t => {
  const fx = makeFixture(t);
  const content = path.join(fx.repo, 'apps/docs/src/content/docs');
  fs.writeFileSync(path.join(content, 'wrap.md'), 'Intro line\nThe package is not\npublished yet, sadly.\n');
  fs.writeFileSync(path.join(content, 'tabs.md'), 'x\ny\nHas  not\t\r\n  been Published.\n');
  fs.writeFileSync(path.join(content, 'start.md'), 'Not Yet Available On NPM at the start\n');
  fs.writeFileSync(path.join(content, 'clean.md'), 'This one is published, it is not unpublished.\n');
  const r = fx.run(['claims', '--json']);
  assert.equal(r.status, 1);
  assert.deepEqual(r.json().hits, ['apps/docs/src/content/docs/start.md:1', 'apps/docs/src/content/docs/tabs.md:3', 'apps/docs/src/content/docs/wrap.md:2']);
});

test('claims fails, and lists them, when a file was skipped (symlink, over 2 MiB, binary) even if the rest is clean', t => {
  const fx = makeFixture(t);
  const content = path.join(fx.repo, 'apps/docs/src/content/docs');
  fs.symlinkSync(path.join(fx.repo, 'README.md'), path.join(content, 'link.md'));
  fs.writeFileSync(path.join(content, 'big.md'), Buffer.alloc(2 * 2 ** 20 + 1, 0x61));
  fs.writeFileSync(path.join(content, 'bin.dat'), Buffer.from([0, 1, 2]));
  const r = fx.run(['claims', '--json']);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.json().ok, false);
  assert.equal(r.json().scanned, 3);
  assert.deepEqual(r.json().hits, []);
  const skipped = Object.fromEntries(r.json().skipped.map(x => [x.file, x.reason]));
  assert.deepEqual(skipped, { 'apps/docs/src/content/docs/link.md': 'symlink', 'apps/docs/src/content/docs/big.md': 'over 2 MiB', 'apps/docs/src/content/docs/bin.dat': 'binary' });
  assert.match(r.json().message, /3 files not scanned \(.*link\.md: symlink/);
  const human = fx.run(['claims']);
  assert.equal(human.status, 1);
  assert.match(human.stderr, /skipped apps\/docs\/src\/content\/docs\/big\.md \(over 2 MiB\)/);
});

test('claims fails when a configured path is itself a symlink, and does not follow it', t => {
  const fx = makeFixture(t);
  const target = path.join(fx.root, 'outside');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'x.md'), 'is not published yet\n');
  fs.rmSync(path.join(fx.repo, 'apps/landing/content'), { recursive: true });
  fs.symlinkSync(target, path.join(fx.repo, 'apps/landing/content'));
  const r = fx.run(['claims', '--json']);
  assert.equal(r.status, 1);
  assert.deepEqual(r.json().skipped, [{ file: 'apps/landing/content', reason: 'symlink' }]);
  assert.deepEqual(r.json().hits, []);
  assert.match(r.json().message, /1 file not scanned \(apps\/landing\/content: symlink\)/);
});

test('claims fails when it scanned no file at all', t => {
  const fx = makeFixture(t, { config: testConfig({ claims: { paths: ['apps/docs/src/content/docs'], patterns: ['is not published yet'] } }) });
  const content = path.join(fx.repo, 'apps/docs/src/content/docs');
  fs.rmSync(path.join(content, 'page.md'));
  fs.writeFileSync(path.join(content, 'bin.dat'), Buffer.from([0, 1, 2]));
  const r = fx.run(['claims', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /scanned 0 files/);
  assert.deepEqual(r.json().skipped.map(x => x.file), ['apps/docs/src/content/docs/bin.dat']);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// gates: counts and empty lists

test('a gate list with no gate is a config error, and --e2e with no end-to-end gate exits 2 and records no e2e pass', t => {
  const none = makeFixture(t, { config: testConfig({ gates: [] }) });
  const r = none.run(['gates', '--json']);
  assert.equal(r.status, 2);
  assert.match(r.json().message, /gates must be a list with at least one item/);
  assert.equal(none.npmCalls().length, 0);

  const fx = makeFixture(t, { config: testConfig({ e2eGates: [] }) });
  const e2e = fx.run(['gates', '--e2e', '--json']);
  assert.equal(e2e.status, 2);
  assert.match(e2e.json().message, /no end-to-end gate/);
  assert.equal(fx.npmCalls().length, 0);
  assert.equal(allFiles(path.join(fx.repo, '.trellis/release/receipts')).length, 0);
  assert.equal(fx.run(['gates']).status, 0);
});

test('a test gate fails when its output has no counts, a failure count, or zero passing tests, even with exit 0', t => {
  for (const [output, reason] of [['all fine', /no test counts found/], ['ℹ tests 3\nℹ pass 2\nℹ fail 1', /1 test failed/], ['ℹ tests 0\nℹ pass 0\nℹ fail 0', /no passing tests/]]) {
    const fx = makeFixture(t);
    fx.setNpm({ testOutput: output });
    const r = fx.run(['gates', '--json']);
    assert.equal(r.status, 1, output);
    assert.match(r.json().message, new RegExp('^gate "root: npm test" failed: '));
    assert.match(r.json().message, reason);
    assert.equal(allFiles(path.join(fx.repo, '.trellis/release/receipts')).length, 0);
  }
});

test('the end-to-end gate is held to the same count rule', t => {
  const fx = makeFixture(t);
  passGates(fx);
  fx.setNpm({ testOutput: 'done' });
  const r = fx.run(['gates', '--e2e', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /gate "desktop: npm run e2e" failed: no test counts found/);
});

test('the receipt records the counts of each test gate', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const receipt = JSON.parse(fs.readFileSync(allFiles(path.join(fx.repo, '.trellis/release/receipts'))[0], 'utf8'));
  assert.deepEqual(receipt.gates.filter(g => g.counts).map(g => [g.name, g.counts.pass, g.counts.fail]), [['root: npm test', 3, 0], ['desktop: npm test', 3, 0]]);
});

test('the first failure line skips passing lines that contain error, fail 0 or Expected', t => {
  const fx = makeFixture(t);
  fx.setNpm({ fail: [{ match: 'run typecheck', message: 'ok 1 - Expected value\nℹ fail 0\nthis ensures an error is handled\nnot ok 2 - the real failure\nnot ok 3 - later' }] });
  const r = fx.run(['gates', '--json']);
  assert.equal(r.status, 1);
  assert.equal(r.json().message, 'gate "root: npm run typecheck" failed: not ok 2 - the real failure');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// dry-run: tarball checks

test('dry-run refuses a config with no expectedFileCount and says how to fix it', t => {
  const config = testConfig();
  delete config.expectedFileCount;
  const fx = makeFixture(t, { config });
  passGates(fx);
  const r = fx.run(['dry-run', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /^expectedFileCount is not set; run pack once and record the count \(pack reported 7 files\)/);
  assert.equal(fx.npmCalls().filter(c => c.args[0] === 'publish').length, 0);
  assert.deepEqual(fs.readdirSync(fx.tmp), []);
});

test('dry-run refuses a pack that reports no files, no SHA-256, or a wrong size', t => {
  const fx = makeFixture(t, { config: testConfig({ expectedFileCount: 7 }) });
  passGates(fx);
  const zero = fx.run(['dry-run', '--json'], { env: { FAKE_PACK_FILES: '0' } });
  assert.equal(zero.status, 1);
  assert.match(zero.json().message, /reports no files/);
  const noSha = fx.run(['dry-run', '--json'], { env: { FAKE_PACK_NO_SHA: '1' } });
  assert.equal(noSha.status, 1);
  assert.match(noSha.json().message, /no SHA-256/);
  const bytes = fx.run(['dry-run', '--json'], { env: { FAKE_PACK_WRONG_BYTES: '1' } });
  assert.equal(bytes.status, 1);
  assert.match(bytes.json().message, /reports \d+ bytes; the tarball is \d+ bytes/);
  assert.equal(fx.npmCalls().filter(c => c.args[0] === 'publish').length, 0);
  assert.deepEqual(fs.readdirSync(fx.tmp), []);
});

const dryRunWith = (fx, tgz, files) => fx.run(['dry-run', '--json'], { env: { FAKE_PACK_TGZ: tgz, ...(files === undefined ? {} : { FAKE_PACK_FILES: String(files) }) } });

test('dry-run lists the tarball itself and records the real entry count in the receipt', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const r = fx.run(['dry-run', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const receipt = JSON.parse(fs.readFileSync(allFiles(path.join(fx.repo, '.trellis/release/receipts')).find(f => path.basename(f).startsWith('dry-run-')), 'utf8'));
  assert.equal(receipt.entries, 10);
  assert.equal(receipt.files, 7);
});

test('dry-run refuses a tarball whose entry count differs from the pack report plus its bundled files', t => {
  const fx = makeFixture(t);
  passGates(fx);
  for (const options of [{ own: 8, bundled: 3 }, { own: 6, bundled: 3 }, { own: 7, bundled: 4 }, { own: 7, bundled: 0 }]) {
    const r = dryRunWith(fx, fx.tarballWith('odd.tgz', options));
    assert.equal(r.status, 1, JSON.stringify(options));
    assert.match(r.json().message, new RegExp(`the tarball holds ${options.own + options.bundled} files \\(${options.own} of the package, ${options.bundled} bundled\\); the pack reported 10 \\(7 of the package, 3 bundled\\)`));
  }
  assert.equal(fx.npmCalls().filter(c => c.args[0] === 'publish').length, 0);
  assert.deepEqual(fs.readdirSync(fx.tmp), []);
  assert.equal(allFiles(path.join(fx.repo, '.trellis/release/receipts')).filter(f => f.includes('dry-run')).length, 0);
});

test('dry-run refuses an entry that must never ship, and does not hold bundled third-party code to that list', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const never = ['.env', '.env.local', '.env.example', 'config/.env.sample', 'config/.env', 'dist/app.js.map', 'dist/types.d.ts', 'dist/types.d.mts', 'test/helper.js', 'dist/tests/a.js', '.trellis/release/x.json', '.git/config', 'sub/.git/HEAD'];
  for (const bad of never) {
    // The extra entry replaces one of the package's own files, so only the never-ship rule can fail.
    const r = dryRunWith(fx, fx.tarballWith('bad.tgz', { own: 6, bundled: 3, extra: [bad] }));
    assert.equal(r.status, 1, bad);
    assert.match(r.json().message, new RegExp(`that must never ship: ${bad.replace(/[.]/g, '\\.')}$`), bad);
  }
  assert.equal(fx.npmCalls().filter(c => c.args[0] === 'publish').length, 0);
  assert.deepEqual(fs.readdirSync(fx.tmp), []);
  const lookalike = dryRunWith(fx, fx.tarballWith('ok.tgz', { own: 5, bundled: 3, extra: ['dist/environment.js', 'docs/test-notes.md'] }));
  assert.equal(lookalike.status, 0, lookalike.stderr + lookalike.stdout);
  const bundled = dryRunWith(fx, fx.tarballWith('bundled.tgz', { own: 7, bundled: 0, extra: ['node_modules/dep/index.d.ts', 'node_modules/dep/index.js.map', 'node_modules/dep/test/a.js'] }));
  assert.equal(bundled.status, 0, bundled.stderr + bundled.stdout);
  assert.equal(bundled.json().entries, 10);
});

test('dry-run applies the .env, .git, and .trellis never-ship rules to bundled node_modules entries too', t => {
  const fx = makeFixture(t);
  passGates(fx);
  for (const bad of ['node_modules/dep/.env', 'node_modules/dep/.env.local', 'node_modules/dep/.env.production', 'node_modules/dep/.env.example.local', 'node_modules/dep/.env.examples', 'node_modules/dep/.env.', 'node_modules/dep/.git/config', 'node_modules/@scope/dep/.trellis/release/x.json']) {
    const r = dryRunWith(fx, fx.tarballWith('bad-bundled.tgz', { own: 7, bundled: 0, extra: [bad] }));
    assert.equal(r.status, 1, bad);
    assert.match(r.json().message, new RegExp(`that must never ship: ${bad.replace(/[.]/g, '\\.')}$`), bad);
  }
  const lookalike = dryRunWith(fx, fx.tarballWith('ok-bundled.tgz', { own: 7, bundled: 0, extra: ['node_modules/dep/environment.js', 'node_modules/dep/.github/x.yml', 'node_modules/dep/lib/.envelope'] }));
  assert.equal(lookalike.status, 0, lookalike.stderr + lookalike.stdout);
});

test('dry-run lets a bundled package ship .env.example, .env.sample, .env.template, and .env.dist, but not the same names in the package itself', t => {
  const fx = makeFixture(t);
  passGates(fx);
  for (const bad of ['.env.example', 'dist/.env.sample', '.env.template', '.env.dist']) {
    const r = dryRunWith(fx, fx.tarballWith('own-env.tgz', { own: 6, bundled: 3, extra: [bad] }));
    assert.equal(r.status, 1, bad);
    assert.match(r.json().message, /an environment file that must never ship/, bad);
  }
  const first = dryRunWith(fx, fx.tarballWith('templates.tgz', { own: 7, bundled: 0, extra: ['node_modules/dep/.env.example', 'node_modules/dep/.env.sample', 'node_modules/dep/.env.template'] }));
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const second = fx.run(['dry-run', '--force', '--json'], { env: { FAKE_PACK_TGZ: fx.tarballWith('dist.tgz', { own: 7, bundled: 2, extra: ['node_modules/@scope/dep/.env.dist'] }) } });
  assert.equal(second.json().outcome, 'done');
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.equal(second.json().entries, 10);
});

test('dry-run refuses a tarball that is not a readable archive', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const junk = path.join(fx.root, 'junk.tgz');
  fs.writeFileSync(junk, 'not an archive at all');
  const r = dryRunWith(fx, junk);
  assert.equal(r.status, 1);
  assert.match(r.json().message, /^the tarball cannot be listed/);
  assert.equal(fx.npmCalls().filter(c => c.args[0] === 'publish').length, 0);
});

test('the dry-run fallback of verify and the tag phase of status use only receipts on HEAD or one of its ancestors', t => {
  const fx = makeFixture(t);
  passGates(fx);
  const base = fx.run(['dry-run', '--json']).json();
  // A newer dry run on a commit that HEAD does not contain, with a different tarball.
  fx.git('checkout', '-b', 'side');
  const side = fx.commit('side.txt', 's');
  passGates(fx);
  const sideDry = dryRunWith(fx, fx.tarballWith('side.tgz', { own: 6, bundled: 3, extra: ['dist/side.js'] })).json();
  assert.notEqual(sideDry.integrity, base.integrity);
  fx.git('tag', '-a', `v${VERSION}`, '-m', 'side', side);
  fx.git('checkout', BRANCH);
  fx.commit('release.txt', 'r');
  publish(fx, { integrity: base.integrity });
  const verify = fx.run(['verify', '--json']);
  assert.equal(checkOf(verify.json(), 'integrity').status, 'pass', checkOf(verify.json(), 'integrity').reason);
  assert.match(checkOf(verify.json(), 'integrity').reason, new RegExp(base.integrity.replace(/[+/]/g, '\\$&')));
  const tag = fx.run(['status', '--json']).json().phases.find(p => p.phase === 'tag');
  assert.equal(tag.state, 'todo', tag.reason);
  assert.match(tag.reason, /not at the release commit/);
  // Move the tag onto the ancestor that has the dry run: now it is the release commit.
  fx.git('tag', '-f', '-a', `v${VERSION}`, '-m', 'base', fx.git('rev-parse', 'HEAD~1'));
  assert.equal(fx.run(['status', '--json']).json().phases.find(p => p.phase === 'tag').state, 'done');
});

test('status shows verify as todo when the stored receipt holds a skipped or failed check', t => {
  const fx = makeFixture(t);
  const head = fx.git('rev-parse', 'HEAD');
  const file = path.join(fx.repo, '.trellis/release/receipts', `verify-${VERSION}-${head}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const status of ['skipped', 'fail']) {
    fs.writeFileSync(file, JSON.stringify({ schema: 'bowerloom/release-receipt/v2', step: 'verify', version: VERSION, commit: head, at: new Date().toISOString(), seams: [], checks: [{ name: 'dist-tag', status: 'pass' }, { name: 'integrity', status }] }));
    const verify = fx.run(['status', '--json']).json().phases.find(p => p.phase === 'verify');
    assert.equal(verify.state, 'todo', status);
    assert.match(verify.reason, /did not pass/);
  }
});
