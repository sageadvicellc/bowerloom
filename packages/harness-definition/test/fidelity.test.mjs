// Locked-in parts spec, sections 2 and 3: the fidelity rule. An `enforced` entry whose result is `weakened` or `absent`
// is refused unless a recorded override exists. Harness definition spec, section 12 check 10, is the case for Pi and
// DeepSeek Harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RESULTS, STRENGTHS, checkFidelity, needsOverride, parseFidelityOverride } from '../../../dist/packages/harness-definition/src/index.js';

const line = (extra = {}) => ({ part: 'guardrails', entry: 'no-push', engine: 'pi', strength: 'enforced', result: 'absent', reason: 'Pi has no permission rules.', ...extra });
const override = (extra = {}) => ({ part: 'guardrails', entry: 'no-push', engine: 'pi', result: 'absent', who: 'Hanna Sage', when: '2026-10-28T14:00:00Z', reason: 'Pi runs in a disposable container.', ...extra });

test('result and strength words', () => {
  assert.deepEqual([...RESULTS], ['exact', 'translated', 'weakened', 'absent']);
  assert.deepEqual([...STRENGTHS], ['enforced', 'advisory']);
});

test('needsOverride: only enforced entries that are weakened or absent', () => {
  for (const result of RESULTS) {
    assert.equal(needsOverride(line({ result })), result === 'weakened' || result === 'absent', result);
    assert.equal(needsOverride(line({ result, strength: 'advisory' })), false, result);
  }
});

test('an enforced entry that is absent is refused without an override (check 10, Pi)', () => {
  const v = checkFidelity([line()], []);
  assert.equal(v.ok, false);
  assert.deepEqual(v.refused, [line()]);
  assert.deepEqual(v.approved, []);
});

test('an enforced entry that is weakened is refused without an override', () => {
  const l = line({ engine: 'codex', result: 'weakened', reason: 'A Codex hook is not a complete boundary.' });
  const v = checkFidelity([l], []);
  assert.equal(v.ok, false);
  assert.deepEqual(v.refused, [l]);
});

test('check 10: DeepSeek Harness with an enforced guardrail is refused too', () => {
  const v = checkFidelity([line({ engine: 'deepseek-harness' })], [override()]);
  assert.equal(v.ok, false, 'an override for pi must not cover deepseek-harness');
});

test('exact, translated, and advisory losses pass, and stay in the report', () => {
  const lines = [
    line({ result: 'exact', engine: 'claude-code', reason: '' }),
    line({ result: 'translated', engine: 'codex', reason: 'Tightened to the prefix git push.' }),
    line({ strength: 'advisory', result: 'absent', reason: 'No hook file.' }),
    line({ strength: 'advisory', result: 'weakened', engine: 'codex', reason: 'Text only.' }),
  ];
  const v = checkFidelity(lines, []);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.deepEqual(v.refused, []);
  assert.deepEqual(v.problems, []);
});

test('a matching recorded override lets the entry through and is named', () => {
  const o = override();
  const v = checkFidelity([line()], [o]);
  assert.equal(v.ok, true);
  assert.deepEqual(v.refused, []);
  assert.deepEqual(v.approved, [{ line: line(), override: o }]);
});

test('an override must match the part, entry, engine, field, and result', () => {
  const misses = [
    override({ part: 'hooks' }),
    override({ entry: 'other' }),
    override({ engine: 'codex' }),
    override({ result: 'weakened' }),
    override({ field: 'pattern' }),
  ];
  for (const o of misses) {
    const v = checkFidelity([line()], [o]);
    assert.equal(v.ok, false, JSON.stringify(o));
    assert.deepEqual(v.unused, [o]);
  }
  // A field-level line needs a field-level override.
  const fieldLine = line({ field: 'tools', part: 'subagents', entry: 'reader', engine: 'codex' });
  assert.equal(checkFidelity([fieldLine], [override({ part: 'subagents', entry: 'reader', engine: 'codex' })]).ok, false);
  assert.equal(checkFidelity([fieldLine], [override({ part: 'subagents', entry: 'reader', engine: 'codex', field: 'tools' })]).ok, true);
});

test('an approval of weakened does not cover a worse result', () => {
  const v = checkFidelity([line({ engine: 'codex', result: 'absent' })], [override({ engine: 'codex', result: 'weakened' })]);
  assert.equal(v.ok, false);
});

test('every loss is reported: a loss with no reason is a problem', () => {
  const v = checkFidelity([line({ strength: 'advisory', result: 'translated', reason: ' ' })], []);
  assert.equal(v.ok, false);
  assert.deepEqual(v.problems.map(p => p.code), ['LOSS_WITHOUT_REASON']);
});

test('malformed loss lines are problems, not passes', () => {
  for (const bad of [line({ result: 'portable' }), line({ strength: 'hard' }), line({ engine: 'hermes' }), line({ part: 'teams' }), line({ entry: '' })]) {
    const v = checkFidelity([bad], []);
    assert.equal(v.ok, false, JSON.stringify(bad));
    assert.ok(v.problems.length > 0);
  }
});

test('parseFidelityOverride accepts a complete record', () => {
  const r = parseFidelityOverride(override({ field: 'tools' }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.override, override({ field: 'tools' }));
  assert.equal(parseFidelityOverride(override({ when: '2026-10-28T14:00:00.123Z' })).ok, true);
});

test('parseFidelityOverride refuses a record that does not say who, when, which entry, which engine, and why', () => {
  const o = override();
  const bad = [
    ['who', { ...o, who: '' }], ['who', (({ who, ...rest }) => rest)(o)],
    ['when', { ...o, when: '2026-10-28' }], ['when', { ...o, when: '2026-13-28T14:00:00Z' }], ['when', { ...o, when: '2026-10-28T14:00:00+02:00' }],
    ['reason', { ...o, reason: '   ' }],
    ['engine', { ...o, engine: 'claude' }],
    ['entry', { ...o, entry: '' }],
    ['part', { ...o, part: 'instructions' }],
    ['result', { ...o, result: 'exact' }], ['result', { ...o, result: 'translated' }],
    ['extra', { ...o, approvedBy: 'x' }],
    ['shape', null], ['shape', []], ['shape', 'text'],
  ];
  for (const [label, value] of bad) assert.equal(parseFidelityOverride(value).ok, false, label);
});

test('checkFidelity refuses an override that is not a valid record', () => {
  const v = checkFidelity([line()], [override({ who: '' })]);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some(p => p.code === 'OVERRIDE_INVALID'));
});
