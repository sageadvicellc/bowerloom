// Final round of the step 3 writers: items D1, D2, D4, D6, and D7 of the verification review. Synthetic fixtures only.
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planPortable } from '../../../dist/packages/project-sync/src/index.js';
import { editToml, scanToml } from '../../../dist/packages/project-sync/src/locked-text.js';
import { writeAbs } from '../../../dist/packages/project-sync/src/portable-files.js';
import { assert, json, projectNow } from './portable-fixture.mjs';
import { DOCS, PINNED, approveAll, lockedProject, put, read } from './locked-fixture.mjs';

const engines = (...ids) => PINNED.filter(e => ids.includes(e.id));
const none = { mcp: null, parts: { mcp: undefined } };
const approvalsFor = (p, extra = {}) => { try { planPortable(p.input(extra)); return []; } catch (e) { if (e.code !== 'PORTABLE_FIDELITY') throw e; return approveAll(p, e); } };
const line = (plan, part, entry, engine) => plan.loss.find(l => l.part === part && l.entry === entry && l.engine === engine && l.field === undefined);
const GUARD = { id: 'guard', event: 'PreToolUse', matcher: 'Bash', command: 'check', strength: 'advisory' };
const CASES = JSON.parse(fs.readFileSync(new URL('./toml-cases.json', import.meta.url), 'utf8')).cases;

// ---- D1: the TOML scanner fails closed --------------------------------------------------------------------------------------

test('D1: the scanner refuses every case that TOML 1.0 refuses, and accepts the valid ones', () => {
  const wrong = CASES.filter(c => (scanToml(c.text) !== null) !== c.valid).map(c => `${c.valid ? 'refused valid' : 'accepted invalid'}: ${JSON.stringify(c.text)}`);
  assert.deepEqual(wrong, []);
});

test('D1, D4: the keys and sub-tables of each element of an array of tables are scoped to that element', () => {
  const d = scanToml('[[a]]\nx = 1\n[a.b]\ny = 2\n[[a]]\nx = 1\n[a.b]\ny = 2\n');
  assert.deepEqual(d.values, [['a', '\u00000', 'x'], ['a', '\u00000', 'b', 'y'], ['a', '\u00001', 'x'], ['a', '\u00001', 'b', 'y']]);
  assert.deepEqual(d.arrays, [['a'], ['a']]);
  assert.deepEqual(d.headers, [['a', '\u00000', 'b'], ['a', '\u00001', 'b']]);
});

test('D1: a merge into a file that does not parse refuses; a merge into a valid file gives a file that parses', () => {
  for (const c of CASES) {
    const r = editToml(c.text, [], [{ path: ['mcp_servers', 'zz'], entries: [['command', 'docs']] }]);
    if (!c.valid) assert.equal(r.ok, false, JSON.stringify(c.text));
    else if (r.ok) assert.notEqual(scanToml(r.text), null, JSON.stringify(c.text));
  }
});

// ---- D2 ---------------------------------------------------------------------------------------------------------------------

test('D2: .claude/settings.local.json is read too, and every Claude Code hook line says user and managed settings are not read', async t => {
  const p = lockedProject(t, { engines: engines('claude-code'), ...none, hooks: [GUARD] });
  put(p, '.claude/settings.local.json', json({ disableAllHooks: true }));
  const l = line(planPortable(p.input()), 'hooks', 'guard', 'claude-code');
  assert.equal(l.result, 'weakened'); assert.match(l.reason, /settings\.local\.json sets disableAllHooks/);
  const q = lockedProject(t, { engines: engines('claude-code'), ...none, hooks: [GUARD] });
  assert.match(line(planPortable(q.input()), 'hooks', 'guard', 'claude-code').reason, /user and managed settings are not read/);
  assert.equal(line(planPortable(q.input()), 'hooks', 'guard', 'claude-code').result, 'exact');
});

// ---- D4 ---------------------------------------------------------------------------------------------------------------------

test('D4: an unrecorded Claude Code, Codex, or Pi version gets the note on every line of that engine', t => {
  for (const [engine, checked] of [['claude-code', '2.1.310'], ['codex', '0.157.0'], ['pi', '1.4.0']]) {
    const plan = planPortable(lockedProject(t, { engines: [{ id: engine }] }).input());
    for (const l of plan.loss) assert.match(l.reason, new RegExp(`not recorded; Bowerloom writes the file shape checked at ${checked.replaceAll('.', '\\.')}`), `${engine} ${l.part}`);
  }
});

test('D4: when the name is swapped for another file between the create and a failed write, the other file stays', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-b21-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'a.json');
  const noLink = () => { throw Object.assign(new Error('no link'), { code: 'EPERM' }); };
  const swap = () => { fs.writeFileSync(path.join(dir, 'theirs'), 'theirs'); fs.renameSync(path.join(dir, 'theirs'), target); throw new Error('write failed'); };
  assert.throws(() => writeAbs(target, Buffer.from('ours'), 0o644, { exclusive: true, link: noLink, afterCreate: swap }), /write failed/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'theirs');
});

// ---- D6 ---------------------------------------------------------------------------------------------------------------------

test('D6: versions compare as semver: a prerelease of the checked version is older, and a version that is not semver is refused', t => {
  for (const version of ['2.1.310-rc.1', '2.1.310-0', '2.1', 'v2.1.310', '2.1.310.1', '02.1.310', 'latest']) {
    assert.throws(() => planPortable(lockedProject(t, { engines: [{ id: 'claude-code', version }] }).input()), e => e.code === 'PORTABLE_ENGINE_VERSION', version);
  }
  for (const version of ['2.1.311-rc.1', '3.0.0']) {
    assert.match(planPortable(lockedProject(t, { engines: [{ id: 'claude-code', version }] }).input()).loss[0].reason, /newer than the version Bowerloom checked/, version);
  }
  // Build metadata does not count, so 2.1.310+build.5 is the checked version itself.
  for (const version of ['2.1.310', '2.1.310+build.5']) assert.doesNotMatch(planPortable(lockedProject(t, { engines: [{ id: 'claude-code', version }] }).input()).loss[0].reason, /checked at/, version);
});

// ---- D7 ---------------------------------------------------------------------------------------------------------------------

test('D7: review shows each server\'s env names, and values unless they are references; the Codex rules file is code to read', async t => {
  const p = lockedProject(t, { engines: engines('claude-code', 'codex'), mcp: [{ ...DOCS, env: { NODE_OPTIONS: '--require ./x.js', DOCS_TOKEN: '${DOCS_TOKEN}' } }],
    rules: [{ id: 'no-curl', action: 'shell', pattern: 'curl *', effect: 'deny', strength: 'enforced' }] });
  const plan = planPortable(p.input({ approvals: approvalsFor(p) }));
  const cc = plan.review.find(r => r.engine === 'claude-code' && r.part === 'mcp' && r.entry === 'docs');
  assert.deepEqual(cc.env, { NODE_OPTIONS: '--require ./x.js', DOCS_TOKEN: null });
  const cx = plan.review.find(r => r.engine === 'codex' && r.part === 'mcp' && r.entry === 'docs');
  assert.deepEqual(cx.env, { NODE_OPTIONS: '--require ./x.js', DOCS_TOKEN: null });
  const rules = plan.review.find(r => r.path === '.codex/rules/bowerloom.rules');
  assert.equal(rules.kind, 'code');
  await projectNow(p.input({ approvals: approvalsFor(p) }));
  assert.equal(rules.text, read(p, '.codex/rules/bowerloom.rules'));
});
