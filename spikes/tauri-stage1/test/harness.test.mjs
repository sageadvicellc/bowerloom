// The smoke-check harness: a small macOS app that alone holds the Accessibility permission, and runs the window probe on the app under test.
// These tests need no Accessibility. They never call `smoke`. The dry run only reports whether the permission is held (`AXIsProcessTrusted`, which never prompts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPIKE, tempDir } from './support.mjs';

export const HARNESS_NAME = 'Bowerloom Smoke Harness';
export const HARNESS_ID = 'com.sageadvice.bowerloom.smokeharness';
export const HARNESS_APP = join(SPIKE, 'harness', 'build', `${HARNESS_NAME}.app`);
const exe = join(HARNESS_APP, 'Contents', 'MacOS', 'bowerloom-smoke-harness');

test('H1. the bundle has its own name and bundle id, and is an agent app (no dock icon)', () => {
  assert.ok(existsSync(HARNESS_APP), `build it first: npm run build:harness (${HARNESS_APP})`);
  const plist = readFileSync(join(HARNESS_APP, 'Contents', 'Info.plist'), 'utf8');
  assert.ok(plist.includes(`<string>${HARNESS_ID}</string>`));
  assert.ok(plist.includes(`<string>${HARNESS_NAME}</string>`));
  assert.match(plist, /<key>LSUIElement<\/key>\s*<true\/>/);
});

test('H2. it is ad-hoc signed, with no team, and its designated requirement names only its identifier, so a rebuild keeps the same identity', () => {
  const run = spawnSync('codesign', ['-d', '--verbose=2', '-r-', HARNESS_APP], { encoding: 'utf8' });
  const text = `${run.stdout}${run.stderr}`;
  assert.match(text, /Signature=adhoc/);
  assert.match(text, /TeamIdentifier=not set/);
  assert.match(text, new RegExp(`Identifier=${HARNESS_ID.replaceAll('.', '\\.')}`));
  assert.match(text, new RegExp(`designated => identifier "${HARNESS_ID.replaceAll('.', '\\.')}"`));
  assert.equal(spawnSync('codesign', ['--verify', '--strict', HARNESS_APP]).status, 0);
});

test('H3. it needs no network: it links 3 system libraries or fewer kinds, and imports no socket call', () => {
  const linked = execFileSync('otool', ['-L', exe], { encoding: 'utf8' }).split('\n').slice(1).map(l => l.trim().split(' ')[0]).filter(Boolean);
  for (const lib of linked) assert.match(lib, /^(\/System\/Library\/Frameworks\/(ApplicationServices|CoreFoundation|AppKit)\.framework|\/usr\/lib\/(libSystem|libobjc)\.)/, lib);
  const undefinedSymbols = new Set(execFileSync('nm', ['-u', exe], { encoding: 'utf8' }).split('\n').map(l => l.trim()));
  for (const banned of ['_socket', '_connect', '_getaddrinfo', '_bind', '_listen', '_accept', '_sendto', '_recvfrom']) assert.ok(!undefinedSymbols.has(banned), banned);
  assert.ok([...undefinedSymbols].every(s => !/CFNetwork|NSURLSession|CFSocket/.test(s)));
});

test('H4. it probes only the app it starts: the code makes 1 accessibility element, from the pid of its own child', () => {
  const source = readFileSync(join(SPIKE, 'harness', 'src', 'main.rs'), 'utf8');
  assert.equal(source.match(/AXUIElementCreateApplication\(/g).length, 2, 'one declaration and one call');
  assert.match(source, /AXUIElementCreateApplication\(child\.id\(\)/);
  assert.doesNotMatch(source, /--pid/);
});

function openHarness(t, args) {
  const out = join(tempDir(t, 'stage1-harness-'), 'result.json');
  const run = spawnSync('open', ['-n', '-W', '-a', HARNESS_APP, '--args', ...args, `--out=${out}`], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(existsSync(out), 'the harness wrote its result');
  return JSON.parse(readFileSync(out, 'utf8'));
}

test('H5. dry run through `open`: the harness is its own process, its parent is launchd (1), and it reports the permission without asking for it', t => {
  const r = openHarness(t, ['dry-run']);
  assert.equal(r.bundleId, HARNESS_ID);
  assert.equal(r.ppid, 1, 'launched by launchd, not by this terminal or agent host');
  assert.notEqual(r.pid, process.pid);
  assert.notEqual(r.pid, process.ppid);
  assert.equal(typeof r.trusted, 'boolean');
  assert.equal(r.prompted, false);
  t.diagnostic(`dry run: ${JSON.stringify(r)}`);
});

test('H6. smoke on a path that does not exist is refused before any accessibility call', t => {
  const r = openHarness(t, ['smoke', '--exe=/nonexistent/app']);
  assert.equal(r.error, 'no such file');
  assert.equal(r.accessibilityCalls, 0);
});
