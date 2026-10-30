import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { buildReport, eventLogPath, issueUrl, probeEngine, recordEvent, redactText, renderReport } from '../../../dist/packages/diagnostics/src/index.js';
import { HOME, PLAN, at, stateRoot } from './fixture.mjs';

const GHP = `ghp_${'A1b2C3d4E5'.repeat(4)}`;
const fail = code => Object.assign(new Error(code), { code });
/** A fake process runner: tool name to output, or an error to throw. */
const runner = (table, calls = []) => async (file, args, options) => {
  calls.push({ file, args, options });
  const v = table[file];
  if (v instanceof Error) throw v;
  if (v === undefined) throw fail('ENOENT');
  return { stdout: v, stderr: '' };
};
const base = (root, over = {}) => ({
  stateRoot: root, env: { PATH: '/usr/bin:/bin', SECRET_THING: 'nope' }, home: HOME, now: at(), platform: 'linux', release: '0.8.0-beta.1',
  osRelease: () => '6.5.0-test', run: runner({ claude: '2.1.4 (Claude Code)\n', codex: 'codex-cli 0.9.1\n' }), ...over,
});
const rec = (root, input, when = '2026-10-30T14:00:00Z') => recordEvent({ stateRoot: root, env: {}, now: at(when) }, input);

test('probeEngine parses the first version, maps ENOENT to not found, and anything else to unknown', async () => {
  assert.equal(await probeEngine('claude', runner({ claude: 'Claude Code 2.1.4-beta.1+build (x)' }), '/usr/bin', HOME), '2.1.4-beta.1+build');
  assert.equal(await probeEngine('claude', runner({}), '/usr/bin', HOME), 'not found');
  assert.equal(await probeEngine('claude', runner({ claude: fail('ETIMEDOUT') }), '/usr/bin', HOME), 'unknown');
  assert.equal(await probeEngine('claude', runner({ claude: Object.assign(new Error('t'), { killed: true }) }), '/usr/bin', HOME), 'unknown');
  assert.equal(await probeEngine('claude', runner({ claude: 'garbage with no number' }), '/usr/bin', HOME), 'unknown');
  assert.equal(await probeEngine('claude', runner({ claude: '' }), '/usr/bin', HOME), 'unknown');
});

test('engines are probed without a shell, with a 3 second timeout and only PATH and HOME', async t => {
  const calls = [];
  const b = await buildReport(base(stateRoot(t), { run: runner({ claude: '2.1.4', codex: '0.9.1' }, calls) }));
  assert.deepEqual(b.engines, { 'claude-code': '2.1.4', codex: '0.9.1' });
  assert.deepEqual(calls.map(c => [c.file, c.args]), [['claude', ['--version']], ['codex', ['--version']]]);
  for (const c of calls) {
    assert.equal(c.options.timeout, 3000);
    assert.deepEqual(c.options.env, { PATH: '/usr/bin:/bin', HOME });
    assert.notEqual(c.options.shell, true);
  }
});

test('the bundle has the report fields, the os from sw_vers on darwin, and no note, target or plan in recent', async t => {
  const root = stateRoot(t);
  rec(root, { source: 'cli', kind: 'scenario', scenario: 'S1', outcome: 'done', step: 'adopt', plan: PLAN, target: 'x', targetRoot: '/home/test-person/proj' }, '2026-10-30T10:00:00Z');
  rec(root, { source: 'app', kind: 'check', answer: 'no', note: 'private words' }, '2026-10-30T11:00:00Z');
  rec(root, { source: 'cli', kind: 'error', code: 'PORTABLE_DRIFT', step: 'drift' }, '2026-10-30T12:00:00Z');
  const calls = [];
  const b = await buildReport(base(root, { platform: 'darwin', appVersion: '0.8.0', run: runner({ claude: '2.1.4', codex: 'codex 1.0.0', sw_vers: '15.1\n' }, calls) }));
  assert.equal(b.schema, 'bowerloom/report/v1');
  assert.equal(b.created, '2026-10-30T14:00:00Z');
  assert.deepEqual(b.bowerloom, { cli: '0.8.0-beta.1', app: '0.8.0' });
  assert.deepEqual(b.os, { platform: 'darwin', version: '15.1' });
  assert.deepEqual(calls.find(c => c.file === 'sw_vers').args, ['-productVersion']);
  assert.equal(b.lastError, 'PORTABLE_DRIFT');
  assert.equal(b.planHash, PLAN);
  assert.equal(b.recent.length, 3);
  assert.deepEqual(Object.keys(b.recent[0]).sort(), ['at', 'kind', 'outcome', 'scenario', 'source', 'step']);
  assert.deepEqual(b.recent.at(-1), { at: '2026-10-30T12:00:00Z', source: 'cli', kind: 'error', step: 'drift', code: 'PORTABLE_DRIFT' });
  const text = JSON.stringify(b) + renderReport(b);
  assert.doesNotMatch(text, /private words|target|proj/);
  assert.equal('app' in (await buildReport(base(stateRoot(t)))).bowerloom, false);
  assert.equal((await buildReport(base(stateRoot(t)))).os.version, '6.5.0-test');
});

test('lastError counts a refused scenario, empty logs give none, recent holds the newest 20', async t => {
  const root = stateRoot(t);
  let b = await buildReport(base(root));
  assert.deepEqual([b.lastError, b.planHash, b.recent], ['none', 'none', []]);
  rec(root, { source: 'cli', kind: 'error', code: 'OLD_ERROR' }, '2026-10-30T01:00:00Z');
  rec(root, { source: 'cli', kind: 'scenario', scenario: 'S5', outcome: 'refused', code: 'NEWER_REFUSAL' }, '2026-10-30T02:00:00Z');
  for (let i = 0; i < 25; i++) rec(root, { source: 'cli', kind: 'check', answer: 'yes' }, '2026-10-30T03:00:00Z');
  b = await buildReport(base(root));
  assert.equal(b.recent.length, 20);
  assert.equal(b.lastError, 'NEWER_REFUSAL');
});

test('redaction guard: a planted home path and planted tokens never survive, from a fake engine or a corrupted log line', async t => {
  const root = stateRoot(t);
  rec(root, { source: 'cli', kind: 'check', answer: 'yes' });
  appendFileSync(eventLogPath(root), `${GHP}\n{"v":1,"at":"2026-10-30T14:00:00Z","source":"cli","kind":"error","code":"X_Y","step":"${GHP}","note":"${GHP}"}\n`);
  const planted = `1.2.3-${GHP} ${HOME}/work /Users/someone/x /home/other-person/y sk-ant-api03-abcdefghijklmnop xoxb-1234567890-abc AKIAABCDEFGHIJKLMNOP`;
  const b = await buildReport(base(root, { run: runner({ claude: planted, codex: `0.1.0+${HOME}/bin` }) }));
  const everything = JSON.stringify(b) + renderReport(b) + issueUrl(b, 'bug.yml') + decodeURIComponent(issueUrl(b, 'bug.yml'));
  for (const bad of [GHP, 'test-person', 'someone', 'other-person', 'sk-ant-api03', 'xoxb-', 'AKIAABCDEFGHIJKLMNOP']) assert.equal(everything.includes(bad), false, bad);
  assert.match(JSON.stringify(b.engines), /\[redacted\]/);
});

test('redactText covers the token shapes and path prefixes', () => {
  const cases = [
    ['gho_' + 'a'.repeat(30), '[redacted]'], ['github_pat_' + 'B'.repeat(30), '[redacted]'], ['npm_' + 'c'.repeat(36), '[redacted]'],
    ['sk-' + 'd'.repeat(30), '[redacted]'], ['xoxp-12345-67890-abcdef', '[redacted]'], ['AKIA' + 'E'.repeat(16), '[redacted]'],
    ['password: ' + 'Zm9vYmFyYmF6cXV4'.repeat(2), 'password: [redacted]'], ['api_key=' + 'f'.repeat(40), 'api_key=[redacted]'],
    ['/Users/test-person/project', '~/project'], ['at /home/test-person/x.ts:1', 'at ~/x.ts:1'], [`${HOME}/a and ${HOME}`, '~/a and ~'],
    ['plain text 1.2.3', 'plain text 1.2.3'],
  ];
  for (const [input, expected] of cases) assert.equal(redactText(input, HOME), expected, input);
  assert.equal(redactText('/private/var/h/p', '/private/var/h'), '~/p');
});

test('renderReport puts each field on its own line', async t => {
  const root = stateRoot(t);
  for (let i = 0; i < 3; i++) rec(root, { source: 'cli', kind: 'scenario', scenario: 'S3', outcome: 'refused', code: 'SKILLS_ADD_EXISTS', step: 'skills' }, `2026-10-30T0${i}:00:00Z`);
  const text = renderReport(await buildReport(base(root)));
  for (const label of ['Bowerloom:', 'Operating system:', 'Claude Code:', 'Codex:', 'Last error:', 'Plan hash:', 'Recent events']) assert.match(text, new RegExp(`^${label}`, 'm'));
  assert.equal(text.split('\n').filter(l => l.startsWith('  ')).length, 3);
  assert.match(text, /^  2026-10-30T02:00:00Z cli scenario S3 refused skills SKILLS_ADD_EXISTS$/m);
});

test('issueUrl stays under 7,500 characters by dropping the oldest lines, and says what it left out', async t => {
  const b = await buildReport(base(stateRoot(t)));
  const long = { source: 'cli', kind: 'error', code: 'X'.repeat(500) };
  const big = { ...b, recent: Array.from({ length: 20 }, (_, i) => ({ ...long, at: `2026-10-30T00:00:${String(i).padStart(2, '0')}Z` })) };
  const url = issueUrl(big, 'bug.yml');
  assert.match(url, /^https:\/\/github\.com\/sageadvicellc\/bowerloom\/issues\/new\?template=bug\.yml&bundle=/);
  assert.ok(url.length <= 7500, String(url.length));
  const sent = decodeURIComponent(url.split('bundle=')[1]);
  const left = Number(/\((\d+) older lines left out\)/.exec(sent)[1]);
  assert.ok(left > 0 && left < 20);
  assert.equal(sent.split('\n').filter(l => l.startsWith('  ')).length, 20 - left);
  assert.match(sent, new RegExp(`:${String(left).padStart(2, '0')}Z`), 'the newest lines stay');
  assert.doesNotMatch(sent, /T00:00:00Z/);
  assert.doesNotMatch(decodeURIComponent(issueUrl(b, 'engine-change.yml')), /older lines/);
  assert.match(issueUrl(b, 'fidelity-gap.yml'), /template=fidelity-gap\.yml/);
  assert.throws(() => issueUrl(b, 'other.yml'));
});
