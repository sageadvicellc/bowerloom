// A skill folder a person made for Codex and OpenCode is taken over by install when every file means what the plan writes.
// SKILL.md is compared by meaning (same frontmatter values, same body), every other file by bytes and mode. The private
// blocks of a skill are written back into the engine's SKILL.md, so adopt from Codex and install to Codex round-trips.
// Synthetic folders only: no private paths, no real rules, no real secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFrontmatter } from '../../../dist/packages/harness-definition/src/index.js';
import { applyPortable, applyPortableRemoval, planPortable, planPortableRemoval, readPortableReceipt } from '../../../dist/packages/project-sync/src/index.js';
import { applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { projectedSkillMd, sameSkillText } from '../../../dist/packages/project-sync/src/skill-private.js';

const sha = b => createHash('sha256').update(b).digest('hex');
const chmodTree = p => { try { const st = fs.lstatSync(p); if (st.isDirectory() && !st.isSymbolicLink()) { fs.chmodSync(p, 0o700); for (const n of fs.readdirSync(p)) chmodTree(path.join(p, n)); } } catch { /* gone */ } };

const HINT = '[shape · audit|critique] [target]';
const BODY = '\n# Example\n\nUse it with care.\n\n```sh\necho "ok"\n```\n';
const SKILL = `---\nname: example\ndescription: "Reviews a change before merge."\nversion: 4.2.2\nuser-invocable: true\nargument-hint: "${HINT}"\n---\n${BODY}`;
const FILES = { 'AGENTS.md': '# Rules\n\nStanding fact: tests run with npm.\n', '.agents/skills/example/SKILL.md': SKILL, '.agents/skills/example/reference/x.md': 'Reference.\n' };
const ENGINES = [{ id: 'codex', version: '0.157.0' }, { id: 'opencode', version: '1.18.30' }];
const SKILL_PATH = '.agents/skills/example/SKILL.md';

/** The same folder in the engine's SKILL.md with the keys reordered, re-quoted, and a comment added: the same meaning. */
const REWRITTEN = `---\n# a note\nargument-hint: '${HINT}'\nuser-invocable: yes\nversion: "4.2.2"\ndescription: Reviews a change before merge.\nname: 'example'\n---\n${BODY}`;

function write(dir, files) {
  for (const [rel, value] of Object.entries(files)) {
    const at = path.join(dir, rel); fs.mkdirSync(path.dirname(at), { recursive: true });
    if (typeof value === 'object') { fs.writeFileSync(at, value.text); fs.chmodSync(at, value.mode); } else { fs.writeFileSync(at, value); fs.chmodSync(at, 0o644); }
  }
}
function snapshot(dir) {
  const out = {};
  const walk = rel => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (r === '.bowerloom') continue;
      const st = fs.lstatSync(path.join(dir, r), { bigint: true });
      if (st.isDirectory()) { out[r + '/'] = (Number(st.mode) & 0o777).toString(8); walk(r); }
      else out[r] = `${sha(fs.readFileSync(path.join(dir, r)))} ${(Number(st.mode) & 0o777).toString(8)} ${st.ino}:${st.mtimeNs}:${st.ctimeNs}`;
    }
  };
  walk(''); return out;
}

/** Adopts the folder in place, then lets `edit` change the folder the way a person would. Returns the install input. */
async function adoptInPlace(t, files = FILES, engines = ENGINES, edit = () => {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-skill-takeover-'))); fs.chmodSync(base, 0o700);
  t.after(() => { chmodTree(base); fs.rmSync(base, { recursive: true, force: true }); });
  const dir = path.join(base, 'project'); fs.mkdirSync(dir, { mode: 0o755 });
  write(dir, files);
  const stateDir = path.join(base, 'state', 'adoption');
  const first = planAdoption({ projectDir: dir, stateDir, engines });
  const input = { projectDir: dir, stateDir, engines, acknowledged: first.unmapped.filter(u => u.gate === 'acknowledge').map(u => u.id) };
  const plan = planAdoption(input);
  assert.equal(plan.ready, true, JSON.stringify({ conflicts: plan.conflicts, problems: plan.problems }));
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  edit(dir);
  return { base, dir, def: path.join(dir, '.bowerloom'), input: { projectDir: dir, definitionFolder: path.join(dir, '.bowerloom'), stateDir: path.join(base, 'state', 'portable'), engines } };
}
const actions = plan => plan.changes.map(c => [c.path, c.action]);
const occupied = input => { try { planPortable(input); } catch (e) { assert.equal(e.code, 'PORTABLE_PATH_OCCUPIED', e.message); return e.paths; } assert.fail('expected PORTABLE_PATH_OCCUPIED'); };

// ---- the comparison ------------------------------------------------------------------------------------------------------

test('sameSkillText: key order, quoting, comments, and line endings do not matter; values and body do', () => {
  assert.equal(sameSkillText(SKILL, SKILL), true);
  assert.equal(sameSkillText(REWRITTEN.replace('yes', 'true'), SKILL), true, 'key order, quoting style, and a comment');
  assert.equal(sameSkillText(SKILL.replace(/\n/g, '\r\n'), SKILL), true, 'the line-ending rule of the reader');
  assert.equal(sameSkillText(SKILL.replace('4.2.2', '4.2.3'), SKILL), false, 'a value');
  assert.equal(sameSkillText(SKILL.replace('user-invocable: true\n', ''), SKILL), false, 'a missing key');
  assert.equal(sameSkillText(SKILL.replace('version: 4.2.2\n', 'version: 4.2.2\nextra: 1\n'), SKILL), false, 'an extra key');
  assert.equal(sameSkillText(SKILL.replace('Use it', 'Use that'), SKILL), false, 'a body change');
  assert.equal(sameSkillText(SKILL + '\n', SKILL), false, 'a body byte');
  assert.equal(sameSkillText(SKILL.replace('---\n\n# Example', '---\n# Example'), SKILL), false, 'a body line');
});

test('sameSkillText: a plain value that YAML 1.1 reads as another type is not the same as the quoted text', () => {
  assert.equal(sameSkillText(SKILL.replace('user-invocable: true', 'user-invocable: yes'), SKILL), false);
  assert.equal(sameSkillText(SKILL.replace('4.2.2', '010'), SKILL.replace('4.2.2', '"010"')), false);
});

test('sameSkillText: text with no readable frontmatter is never the same', () => {
  assert.equal(sameSkillText('no frontmatter', 'no frontmatter'), false);
  assert.equal(sameSkillText(SKILL.replace('---\n\n', '\n\n'), SKILL), false);
  assert.equal(sameSkillText(SKILL.replace('name: example', 'name: [a'), SKILL), false);
});

test('projectedSkillMd: writes the keys of a block into the frontmatter, keeps the core bytes and the body', () => {
  const core = '---\nname: example\ndescription: "Reviews a change before merge."\n---\n' + BODY;
  const out = Buffer.from(projectedSkillMd(Buffer.from(core), { version: '4.2.2', 'user-invocable': true, 'argument-hint': HINT, list: ['a', 1], nested: { a: null } })).toString('utf8');
  assert.ok(out.startsWith('---\nname: example\ndescription: "Reviews a change before merge."\n'));
  assert.ok(out.endsWith('---\n' + BODY));
  const fm = readFrontmatter(out);
  assert.equal(fm.ok, true);
  assert.deepEqual(fm.data, { name: 'example', description: 'Reviews a change before merge.', version: '4.2.2', 'user-invocable': true, 'argument-hint': HINT, list: ['a', 1], nested: { a: null } });
  assert.equal(fm.body, BODY);
});

test('projectedSkillMd: a block that is not a plain mapping, an empty one, or one that repeats a core key is not written', () => {
  const core = Buffer.from('---\nname: example\ndescription: d\n---\n' + BODY);
  for (const block of [null, 'text', 3, ['a'], {}, { name: 'other' }, { description: 'd' }, { 'bad key': 1, description: 'x' }]) {
    assert.equal(projectedSkillMd(core, block), null, JSON.stringify(block));
  }
  assert.equal(projectedSkillMd(Buffer.from('no frontmatter'), { a: 1 }), null);
  assert.equal(projectedSkillMd(Buffer.from('---\r\nname: example\r\ndescription: d\r\n---\r\nbody\r\n'), { a: 1 }), null, 'a text with carriage returns is left alone');
});

// ---- the plan ------------------------------------------------------------------------------------------------------------

test('adopt a Codex and OpenCode skill with extra keys in place, then install: the folder is taken over, nothing is written, removal keeps it', async t => {
  const a = await adoptInPlace(t);
  const before = snapshot(a.dir);
  const plan = planPortable(a.input);
  assert.deepEqual(actions(plan).filter(([p]) => p.startsWith('.agents/')), [['.agents/skills/example/SKILL.md', 'take-over'], ['.agents/skills/example/reference/x.md', 'take-over']]);
  assert.deepEqual(plan.deferred.filter(d => d.part === 'skill-private'), [], 'the private keys are projected');
  assert.ok(actions(plan).some(([p, act]) => p.startsWith('.claude/skills/example/') && act === 'create'), 'OpenCode also gets .claude/skills');
  const result = await applyPortable(a.input, plan.revision);
  const after = snapshot(a.dir);
  for (const k of Object.keys(before)) assert.equal(after[k], before[k], `${k} is as it was: same bytes, mode, inode, and times`);
  const written = fs.readFileSync(path.join(a.dir, '.claude/skills/example/SKILL.md'), 'utf8');
  const fm = readFrontmatter(written);
  assert.equal(fm.ok, true);
  assert.equal(fm.data.version, '4.2.2');
  assert.equal(fm.data['argument-hint'], HINT);
  assert.equal(result.report.takenOver.some(x => x.path === SKILL_PATH), true);
  const receipt = readPortableReceipt(a.input);
  const rec = receipt.files.find(f => f.path === SKILL_PATH);
  assert.deepEqual(rec.original, { sha256: rec.sha256, mode: rec.mode }, 'the receipt holds the current state of the taken-over file');
  const removal = planPortableRemoval(a.input);
  const removed = await applyPortableRemoval(a.input, removal.revision);
  assert.ok(removed.kept.includes(SKILL_PATH), 'removal keeps the taken-over SKILL.md');
  assert.ok(removed.kept.includes('.agents/skills/example/reference/x.md'));
  const last = snapshot(a.dir);
  assert.deepEqual(Object.keys(last).sort(), Object.keys(before).sort(), 'the created folder is gone');
  for (const k of Object.keys(before)) assert.equal(last[k], before[k], k);
});

test('a second install after the take-over is a no-op, and a changed definition value is a real update', async t => {
  const a = await adoptInPlace(t);
  const first = planPortable(a.input);
  await applyPortable(a.input, first.revision);
  const again = planPortable(a.input);
  assert.equal(again.noop, true);
  assert.equal(actions(again).find(([p]) => p === SKILL_PATH)[1], 'unchanged');
  // The definition changes a value: the held file no longer means the plan, so the plan writes it, saving the original.
  const harness = path.join(a.def, 'harness.json');
  const h = JSON.parse(fs.readFileSync(harness, 'utf8'));
  h.skills.example['x-codex']['argument-hint'] = 'changed'; h.skills.example['x-opencode']['argument-hint'] = 'changed';
  fs.writeFileSync(harness, JSON.stringify(h, null, 2) + '\n');
  const update = planPortable(a.input);
  assert.equal(actions(update).find(([p]) => p === SKILL_PATH)[1], 'update');
});

test('the same keys in another order and quoting style are taken over, and the bytes stay', async t => {
  const a = await adoptInPlace(t, FILES, ENGINES, dir => fs.writeFileSync(path.join(dir, SKILL_PATH), REWRITTEN.replace('yes', 'true')));
  // Adoption read the folder before the edit, so the edit is the person's later rewrite of the same meaning.
  const before = snapshot(a.dir);
  const plan = planPortable(a.input);
  assert.equal(actions(plan).find(([p]) => p === SKILL_PATH)[1], 'take-over');
  await applyPortable(a.input, plan.revision);
  assert.equal(fs.readFileSync(path.join(a.dir, SKILL_PATH), 'utf8'), REWRITTEN.replace('yes', 'true'));
  for (const k of Object.keys(before)) assert.equal(snapshot(a.dir)[k], before[k], k);
});

test('a real difference still refuses PORTABLE_PATH_OCCUPIED, and nothing is written', async t => {
  const cases = {
    'a changed value': dir => fs.writeFileSync(path.join(dir, SKILL_PATH), SKILL.replace('4.2.2', '4.2.3')),
    'a missing key': dir => fs.writeFileSync(path.join(dir, SKILL_PATH), SKILL.replace('user-invocable: true\n', '')),
    'an extra key': dir => fs.writeFileSync(path.join(dir, SKILL_PATH), SKILL.replace('version: 4.2.2\n', 'version: 4.2.2\nextra: 1\n')),
    'a body change': dir => fs.writeFileSync(path.join(dir, SKILL_PATH), SKILL.replace('Use it with care', 'Use it freely')),
    'a changed type': dir => fs.writeFileSync(path.join(dir, SKILL_PATH), SKILL.replace('user-invocable: true', 'user-invocable: "true"')),
    'an extra file': dir => fs.writeFileSync(path.join(dir, '.agents/skills/example/reference/y.md'), 'More.\n'),
    'a missing file': dir => fs.rmSync(path.join(dir, '.agents/skills/example/reference/x.md')),
    'a changed other file': dir => fs.writeFileSync(path.join(dir, '.agents/skills/example/reference/x.md'), 'Changed.\n'),
    'a mode on SKILL.md': dir => fs.chmodSync(path.join(dir, SKILL_PATH), 0o755),
    'a mode on another file': dir => fs.chmodSync(path.join(dir, '.agents/skills/example/reference/x.md'), 0o755),
  };
  for (const [label, edit] of Object.entries(cases)) {
    const a = await adoptInPlace(t, FILES, ENGINES, edit);
    const before = snapshot(a.dir);
    const paths = occupied(a.input);
    assert.ok(paths.length > 0, label);
    assert.deepEqual(snapshot(a.dir), before, label);
  }
});

test('a changed SKILL.md names itself in the refusal', async t => {
  const a = await adoptInPlace(t, FILES, ENGINES, dir => fs.writeFileSync(path.join(dir, SKILL_PATH), SKILL.replace('4.2.2', '4.2.3')));
  assert.deepEqual(occupied(a.input), [SKILL_PATH]);
});

test('drift after the take-over: an edit to the held SKILL.md is reported as drift, as for any written file', async t => {
  const a = await adoptInPlace(t);
  const plan = planPortable(a.input);
  await applyPortable(a.input, plan.revision);
  fs.writeFileSync(path.join(a.dir, SKILL_PATH), SKILL.replace('4.2.2', '9.9.9'));
  assert.throws(() => planPortable(a.input), e => e.code === 'PORTABLE_DRIFT');
});

// ---- the writer ----------------------------------------------------------------------------------------------------------

test('a fresh install writes the private keys of a skill into the engine SKILL.md for every engine that shares the folder', async t => {
  const a = await adoptInPlace(t, FILES, ENGINES, dir => fs.rmSync(path.join(dir, '.agents'), { recursive: true }));
  const plan = planPortable(a.input);
  assert.deepEqual(plan.deferred.filter(d => d.part === 'skill-private'), []);
  await applyPortable(a.input, plan.revision);
  for (const root of ['.agents/skills', '.claude/skills']) {
    const fm = readFrontmatter(fs.readFileSync(path.join(a.dir, root, 'example/SKILL.md'), 'utf8'));
    assert.equal(fm.ok, true, root);
    assert.deepEqual(fm.data, { name: 'example', description: 'Reviews a change before merge.', version: '4.2.2', 'user-invocable': true, 'argument-hint': HINT }, root);
  }
});

test('engines that share a folder but hold different private blocks leave the keys out: core fields only, and the plan still says they are absent', async t => {
  const a = await adoptInPlace(t, FILES, ENGINES, dir => fs.rmSync(path.join(dir, '.agents'), { recursive: true }));
  const harness = path.join(a.def, 'harness.json');
  const h = JSON.parse(fs.readFileSync(harness, 'utf8'));
  h.skills.example['x-opencode'] = { version: '1.0.0' };
  fs.writeFileSync(harness, JSON.stringify(h, null, 2) + '\n');
  const plan = planPortable(a.input);
  assert.deepEqual(plan.deferred.filter(d => d.part === 'skill-private').map(d => d.engine).sort(), ['codex', 'opencode']);
  assert.ok(plan.loss.some(l => l.part === 'skills' && l.field === 'x-codex' && l.result === 'absent'));
  await applyPortable(a.input, plan.revision);
  assert.deepEqual(readFrontmatter(fs.readFileSync(path.join(a.dir, SKILL_PATH), 'utf8')).data, { name: 'example', description: 'Reviews a change before merge.' });
  // OpenCode alone owns .claude/skills, so its block is written there.
  assert.equal(readFrontmatter(fs.readFileSync(path.join(a.dir, '.claude/skills/example/SKILL.md'), 'utf8')).data.version, '1.0.0');
});
