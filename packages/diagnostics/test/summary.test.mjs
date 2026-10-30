import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklySummary } from '../../../dist/packages/diagnostics/src/index.js';
import { PLAN, at } from './fixture.mjs';

const now = at('2026-10-30T14:00:00Z');
const ev = (day, extra) => ({ v: 1, at: `2026-10-${day}T10:00:00Z`, source: 'cli', ...extra });
const done = (day, scenario, extra = {}) => ev(day, { kind: 'scenario', scenario, outcome: 'done', ...extra });

test('the window is the 7 days before now, as dates, and old events do not count', () => {
  const s = weeklySummary([done('22', 'S1'), done('23', 'S1'), done('30', 'S1')], now);
  assert.equal(s.schema, 'bowerloom/usage-summary/v1');
  assert.deepEqual([s.from, s.to], ['2026-10-23', '2026-10-30']);
  assert.deepEqual(s.scenarios.S1, { done: 2, refused: 0 });
  assert.deepEqual(Object.keys(s.scenarios), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
});

test('counts done and refused per scenario, top-10 errors by count, and checks', () => {
  const events = [
    done('24', 'S3'), ev('25', { kind: 'scenario', scenario: 'S3', outcome: 'refused', code: 'SKILLS_ADD_EXISTS' }),
    ...Array.from({ length: 12 }, (_, i) => ev('26', { kind: 'error', code: `ERR_${String.fromCharCode(65 + i)}${i === 3 ? '' : ''}` })),
    ev('27', { kind: 'error', code: 'ERR_D' }), ev('27', { kind: 'error', code: 'ERR_D' }), ev('27', { kind: 'error', code: 'ERR_B' }),
    ev('28', { kind: 'check', answer: 'yes' }), ev('28', { kind: 'check', answer: 'yes' }), ev('28', { kind: 'check', answer: 'partly' }), ev('28', { kind: 'check', answer: 'no' }),
  ];
  const s = weeklySummary(events, now);
  assert.deepEqual(s.scenarios.S3, { done: 1, refused: 1 });
  assert.equal(s.errors.length, 10);
  assert.deepEqual(s.errors.slice(0, 2), [{ code: 'ERR_D', count: 3 }, { code: 'ERR_B', count: 2 }]);
  assert.deepEqual(s.checks, { yes: 2, partly: 1, no: 1 });
});

test('S2 is met by an S2 event, or by one plan installed into both engines within the week', () => {
  assert.equal(weeklySummary([done('25', 'S2', { step: 'install', engines: ['claude-code', 'codex'] })], now).s2BothEngines, true);
  const split = [
    done('25', 'S2'.replace('S2', 'S3'), { step: 'install', engines: ['claude-code'], plan: PLAN }),
    done('26', 'S3', { step: 'install', engines: ['codex'], plan: PLAN }),
  ];
  const s = weeklySummary(split, now);
  assert.equal(s.s2BothEngines, true);
  assert.equal(s.scenarios.S2.done >= 1, true);
  const other = [
    done('25', 'S3', { step: 'install', engines: ['claude-code'], plan: PLAN }),
    done('26', 'S3', { step: 'install', engines: ['codex'], plan: 'b'.repeat(64) }),
  ];
  assert.equal(weeklySummary(other, now).s2BothEngines, false);
  const refused = [ev('25', { kind: 'scenario', outcome: 'refused', step: 'install', engines: ['claude-code'], plan: PLAN, code: 'X_Y' }), done('26', 'S3', { step: 'install', engines: ['codex'], plan: PLAN })];
  assert.equal(weeklySummary(refused, now).s2BothEngines, false);
});

test('S8 counts distinct targets among done installs and is met at two; targets never appear', () => {
  const t = c => c.repeat(16);
  const install = (day, target, outcome = 'done') => ev(day, { kind: 'scenario', outcome, step: 'install', target });
  let s = weeklySummary([install('25', t('a')), install('26', t('a'))], now);
  assert.equal(s.s8DistinctTargets, 1);
  assert.deepEqual(s.scenarios.S8, { done: 0, refused: 0 });
  s = weeklySummary([install('25', t('a')), install('26', t('b')), install('27', t('c'), 'refused'), install('01', t('d'))], now);
  assert.equal(s.s8DistinctTargets, 2);
  assert.deepEqual(s.scenarios.S8, { done: 1, refused: 0 });
  const text = JSON.stringify(s);
  assert.doesNotMatch(text, /aaaaaaaa|bbbbbbbb|target|plan|T10:/);
});

test('notes appear only with withNotes, and never targets or timestamps', () => {
  const events = [ev('25', { kind: 'check', answer: 'no', note: 'hand a setup to a colleague', target: 'a'.repeat(16) }), ev('26', { kind: 'check', answer: 'yes' })];
  assert.equal('notes' in weeklySummary(events, now), false);
  assert.equal('notes' in weeklySummary(events, now, { withNotes: false }), false);
  assert.deepEqual(weeklySummary(events, now, { withNotes: true }).notes, ['hand a setup to a colleague']);
  assert.deepEqual(weeklySummary([], now, { withNotes: true }).notes, []);
});
