// Locked-in parts spec, sections 2 and 3: the fidelity rule. An `enforced` entry whose result is `weakened` or `absent`
// is refused unless a recorded approval exists. Harness definition spec, section 12 check 10, is the case for Pi and
// DeepSeek Harness. Lead rulings R3 (approvals bound to the entry hash), R6 (FidelityApproval), and R8 (completeness,
// strength from the definition).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESULTS, STRENGTHS, checkFidelity, entryHash, loadDefinition, needsApproval, parseFidelityApproval, strengthOf,
} from '../../../dist/packages/harness-definition/src/index.js';
import { NOW, cleanup, harness, json, makeDefinition } from './fixture.mjs';

test.after(cleanup);

/** A harness for Pi and Codex with one deny rule, one allow rule, the sandbox, a hook, and a subagent with a tool limit. */
function source(engines = ['pi', 'codex']) {
  const r = loadDefinition(makeDefinition({
    'harness.json': harness({ engines: engines.map(id => ({ id })), parts: { guardrails: 'guardrails.json', hooks: 'hooks.json', subagents: 'agents/' } }),
    'guardrails.json': json({
      rules: [
        { id: 'no-push', action: 'shell', pattern: 'git push *', effect: 'deny', strength: 'advisory' },
        { id: 'git', action: 'shell', pattern: 'git *', effect: 'allow', strength: 'advisory' },
      ],
      sandbox: { id: 'box', files: true, network: false },
    }),
    'hooks.json': json({ hooks: [{ id: 'lint', event: 'PostToolUse', command: 'true', strength: 'advisory' }] }),
    'agents/reader.md': '---\nname: reader\ndescription: Reads.\ntools:\n  - read\n---\nRead.\n',
  }));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  return { entries: r.definition.entries, engines: r.definition.harness.engines, definition: r.definition };
}
const ENTRIES = [['guardrails', 'no-push'], ['guardrails', 'git'], ['guardrails', 'box'], ['hooks', 'lint'], ['subagents', 'reader']];
/** One exact line for every entry and engine, then the lines given replace the matching ones. */
function report(src, lines = []) {
  const out = [];
  for (const engine of src.engines.map(e => e.id)) for (const [part, entry] of ENTRIES) out.push({ part, entry, engine, result: 'exact', reason: '' });
  for (const line of lines) {
    const at = out.findIndex(l => l.part === line.part && l.entry === line.entry && l.engine === line.engine && line.field === undefined);
    if (at >= 0) out[at] = line; else out.push(line);
  }
  return out;
}
const lost = (part, entry, engine, result, extra = {}) => ({ part, entry, engine, result, reason: 'The engine cannot carry it.', ...extra });
const approve = (src, part, entry, engine, result, extra = {}) => {
  const item = [...src.entries.rules, ...src.entries.sandbox, ...src.entries.hooks, ...src.entries.subagents].find(e => e.id === entry);
  return { part, entry, engine, result, entryHash: entryHash(item), who: 'Hanna Sage', when: '2026-10-28T14:00:00Z', reason: 'Pi runs in a disposable container.', ...extra };
};
const judge = (src, lines, approvals = []) => checkFidelity(src, report(src, lines), approvals, { now: NOW });

test('result and strength words', () => {
  assert.deepEqual([...RESULTS], ['exact', 'translated', 'weakened', 'absent']);
  assert.deepEqual([...STRENGTHS], ['enforced', 'advisory']);
});

test('R8: strength comes from the definition', () => {
  const src = source();
  const rule = id => src.entries.rules.find(r => r.id === id);
  assert.equal(strengthOf('guardrails', rule('no-push')), 'enforced', 'a deny rule is enforced whatever it declares');
  assert.equal(strengthOf('guardrails', rule('git')), 'advisory');
  assert.equal(strengthOf('guardrails', src.entries.sandbox[0]), 'enforced');
  assert.equal(strengthOf('hooks', src.entries.hooks[0]), 'advisory');
  assert.equal(strengthOf('subagents', src.entries.subagents[0]), 'enforced', 'a tool limit is enforced');
  assert.equal(strengthOf('subagents', src.entries.subagents[0], 'description'), 'advisory');
  assert.equal(strengthOf('subagents', { ...src.entries.subagents[0], tools: undefined }), 'advisory');
});

test('needsApproval: only enforced lines that are weakened or absent', () => {
  for (const result of RESULTS) {
    assert.equal(needsApproval({ strength: 'enforced', result }), result === 'weakened' || result === 'absent', result);
    assert.equal(needsApproval({ strength: 'advisory', result }), false, result);
  }
});

test('check 10: Pi with an enforced guardrail is refused without an approval', () => {
  const src = source();
  const v = judge(src, [lost('guardrails', 'no-push', 'pi', 'absent')]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.refused.map(l => [l.entry, l.engine, l.strength]), [['no-push', 'pi', 'enforced']]);
});

test('check 10: DeepSeek Harness too, and an approval for Pi does not cover it', () => {
  const src = source(['pi', 'deepseek-harness']);
  const v = judge(src, [lost('guardrails', 'no-push', 'pi', 'absent'), lost('guardrails', 'no-push', 'deepseek-harness', 'absent')], [approve(src, 'guardrails', 'no-push', 'pi', 'absent')]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.refused.map(l => l.engine), ['deepseek-harness']);
});

test('weakened enforced lines are refused; the sandbox and a tool limit count as enforced', () => {
  const src = source();
  const v = judge(src, [lost('guardrails', 'box', 'codex', 'weakened'), lost('subagents', 'reader', 'codex', 'absent', { field: 'tools' })]);
  assert.deepEqual(v.refused.map(l => [l.entry, l.field ?? null]), [['box', null], ['reader', 'tools']]);
});

test('exact, translated, and advisory losses pass, and stay in the report', () => {
  const src = source();
  const v = judge(src, [lost('guardrails', 'no-push', 'codex', 'translated'), lost('guardrails', 'git', 'pi', 'absent'), lost('hooks', 'lint', 'pi', 'absent')]);
  assert.equal(v.ok, true, JSON.stringify(v));
});

test('R3: a matching approval bound to the entry hash lets the entry through', () => {
  const src = source();
  const a = approve(src, 'guardrails', 'no-push', 'pi', 'absent');
  const v = judge(src, [lost('guardrails', 'no-push', 'pi', 'absent')], [a]);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.approved.length, 1);
  assert.deepEqual(v.approved[0].approval, a);
});

test('R3: a change to the entry voids its approval', () => {
  const src = source();
  const a = approve(src, 'guardrails', 'no-push', 'pi', 'absent');
  const changed = { ...src, entries: { ...src.entries, rules: src.entries.rules.map(r => r.id === 'no-push' ? { ...r, pattern: 'git push origin *' } : r) } };
  const v = judge(changed, [lost('guardrails', 'no-push', 'pi', 'absent')], [a]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.unused, [a]);
});

test('an approval must match the part, entry, engine, field, and result', () => {
  const src = source();
  const line = lost('guardrails', 'no-push', 'pi', 'absent');
  for (const extra of [{ part: 'hooks' }, { entry: 'git' }, { engine: 'codex' }, { result: 'weakened' }, { field: 'pattern' }]) {
    const v = judge(src, [line], [{ ...approve(src, 'guardrails', 'no-push', 'pi', 'absent'), ...extra }]);
    assert.equal(v.ok, false, JSON.stringify(extra));
  }
  const field = lost('subagents', 'reader', 'pi', 'absent', { field: 'tools' });
  assert.equal(judge(src, [field], [approve(src, 'subagents', 'reader', 'pi', 'absent')]).ok, false);
  assert.equal(judge(src, [field], [approve(src, 'subagents', 'reader', 'pi', 'absent', { field: 'tools' })]).ok, true);
});

test('R8: a missing loss line is a problem; an empty report is not a pass', () => {
  const src = source();
  const v = checkFidelity(src, [], [], { now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.problems.filter(p => p.code === 'LOSS_LINE_MISSING').length, ENTRIES.length * 2);
  const partial = report(src).filter(l => !(l.entry === 'lint' && l.engine === 'pi'));
  assert.deepEqual(checkFidelity(src, partial, [], { now: NOW }).problems.map(p => p.code), ['LOSS_LINE_MISSING']);
});

test('R8: the caller cannot state the strength, name an unknown entry, or an engine outside the harness', () => {
  const src = source();
  const codes = lines => checkFidelity(src, report(src, lines), [], { now: NOW }).problems.map(p => p.code);
  assert.ok(codes([{ ...lost('guardrails', 'no-push', 'pi', 'absent'), strength: 'advisory' }]).includes('LOSS_LINE_INVALID'));
  assert.ok(codes([lost('guardrails', 'ghost', 'pi', 'absent')]).includes('LOSS_LINE_UNKNOWN'));
  assert.ok(codes([lost('guardrails', 'no-push', 'opencode', 'absent')]).includes('LOSS_LINE_INVALID'));
  for (const bad of [lost('guardrails', 'no-push', 'pi', 'portable'), lost('teams', 'x', 'pi', 'absent'), lost('guardrails', '', 'pi', 'absent')]) {
    assert.ok(codes([bad]).includes('LOSS_LINE_INVALID'), JSON.stringify(bad));
  }
});

test('every loss is reported: a loss with no reason is a problem', () => {
  const src = source();
  const v = judge(src, [{ ...lost('hooks', 'lint', 'pi', 'translated'), reason: ' ' }]);
  assert.deepEqual(v.problems.map(p => p.code), ['LOSS_WITHOUT_REASON']);
});

test('parseFidelityApproval accepts a complete record', () => {
  const src = source();
  const a = approve(src, 'subagents', 'reader', 'codex', 'absent', { field: 'tools' });
  const r = parseFidelityApproval(a, { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.approval, a);
  assert.equal(parseFidelityApproval({ ...a, when: '2026-10-28T14:00:00.123Z' }, { now: NOW }).ok, true);
});

test('C9: a field that is undefined is absent', () => {
  const src = source();
  const r = parseFidelityApproval({ ...approve(src, 'guardrails', 'no-push', 'pi', 'absent'), field: undefined }, { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(Object.hasOwn(r.approval, 'field'), false);
});

test('parseFidelityApproval refuses a record that does not say who, when, which entry, which engine, which version, and why', () => {
  const src = source();
  const o = approve(src, 'guardrails', 'no-push', 'pi', 'absent');
  const bad = [
    ['who', { ...o, who: '' }], ['who', (({ who, ...rest }) => rest)(o)],
    ['when', { ...o, when: '2026-10-28' }], ['when', { ...o, when: '2026-13-28T14:00:00Z' }], ['when', { ...o, when: '2026-10-28T14:00:00+02:00' }],
    ['future when', { ...o, when: '2026-10-29T14:00:00Z' }],
    ['reason', { ...o, reason: '   ' }],
    ['engine', { ...o, engine: 'claude' }],
    ['entry', { ...o, entry: '' }],
    ['entryHash', { ...o, entryHash: 'abc' }], ['entryHash', (({ entryHash: _, ...rest }) => rest)(o)],
    ['part', { ...o, part: 'instructions' }],
    ['result', { ...o, result: 'exact' }], ['result', { ...o, result: 'translated' }],
    ['extra', { ...o, approvedBy: 'x' }],
    ['shape', null], ['shape', []], ['shape', 'text'],
  ];
  for (const [label, value] of bad) assert.equal(parseFidelityApproval(value, { now: NOW }).ok, false, label);
});

test('checkFidelity refuses an approval that is not a valid record', () => {
  const src = source();
  const v = judge(src, [lost('guardrails', 'no-push', 'pi', 'absent')], [{ ...approve(src, 'guardrails', 'no-push', 'pi', 'absent'), who: '' }]);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some(p => p.code === 'APPROVAL_INVALID'));
});
