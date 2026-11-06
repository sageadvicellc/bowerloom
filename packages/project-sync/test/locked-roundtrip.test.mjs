// Step 3 round trip (definition spec section 12, checks 1 and 9): the private block of a guardrail entry reaches its own
// engine where the engine has a place for it. Synthetic fixtures only.
import test from 'node:test';
import { PORTABLE_RECEIPT_FORMAT, planPortable, readPortableReceipt } from '../../../dist/packages/project-sync/src/index.js';
import { assert, forge, json, projectNow } from './portable-fixture.mjs';
import { PINNED, approveAll, lockedProject, read } from './locked-fixture.mjs';

const engines = (...ids) => PINNED.filter(e => ids.includes(e.id));
const none = { mcp: null, parts: { mcp: undefined } };
const line = (plan, entry, engine) => plan.loss.find(l => l.part === 'guardrails' && l.entry === entry && l.engine === engine && l.field === undefined);
const approvalsFor = p => { try { planPortable(p.input()); return []; } catch (e) { if (e.code !== 'PORTABLE_FIDELITY') throw e; return approveAll(p, e); } };

test('review item K3: the x-claude-code block of the sandbox goes through an allowlist; every other key is not written and gets an absent line', async t => {
  const block = { ignoreViolations: { '*': ['/tmp'] }, seccomp: { applyPath: '/tmp/apply' }, bpfPath: '/tmp/bpf', httpProxyPort: 8080, enabled: false };
  const p = lockedProject(t, { engines: engines('claude-code'), ...none, sandbox: { id: 'box', files: true, network: true, 'x-claude-code': block } });
  // The dropped keys are an absent field line of an enforced entry, so the plan asks for an approval first.
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_FIDELITY' && e.refused.some(l => l.entry === 'box' && l.field === 'x-claude-code' && l.result === 'absent'));
  const approvals = approvalsFor(p);
  const plan = planPortable(p.input({ approvals }));
  const field = plan.loss.find(l => l.entry === 'box' && l.field === 'x-claude-code');
  assert.equal(field.result, 'absent');
  for (const k of Object.keys(block)) assert.match(field.reason, new RegExp(`\\b${k}\\b`), k);
  await projectNow(p.input({ approvals }));
  assert.deepEqual(JSON.parse(read(p, '.claude/settings.json')).sandbox, { enabled: true, allowUnsandboxedCommands: false });
  // A sandbox with no block writes the two keys and no field line.
  const q = lockedProject(t, { engines: engines('claude-code'), ...none, sandbox: { id: 'box', files: true, network: true } });
  assert.equal(planPortable(q.input()).loss.some(l => l.field === 'x-claude-code'), false);
});

test('Codex: the justification of a rule\'s x-codex block is written into its prefix rule; other keys are named as not written', async t => {
  const rules = [
    { id: 'no-push', action: 'shell', pattern: 'git push *', effect: 'deny', strength: 'enforced', 'x-codex': { justification: 'No pushes from an agent.' } },
    { id: 'ask-rm', action: 'shell', pattern: 'rm *', effect: 'ask', strength: 'enforced', 'x-codex': { match: [['rm', 'x']] } },
  ];
  const p = lockedProject(t, { engines: engines('codex'), ...none, rules });
  const approvals = approvalsFor(p);
  const plan = planPortable(p.input({ approvals }));
  assert.doesNotMatch(line(plan, 'no-push', 'codex').reason, /not written/);
  assert.match(line(plan, 'ask-rm', 'codex').reason, /match/);
  await projectNow(p.input({ approvals }));
  const text = read(p, '.codex/rules/bowerloom.rules');
  assert.match(text, /justification = "No pushes from an agent\."/);
  assert.match(text, /justification = "Bowerloom guardrail ask-rm"/);
  assert.doesNotMatch(text, /match =/);
});

test('review item K5: the receipt carries claimed for a source the 0.7 catalog only claims; a v1beta3 receipt still reads', async t => {
  const p = lockedProject(t, { engines: engines('claude-code'), ...none, parts: { mcp: undefined, plugins: 'sources.json' }, files: {
    'sources.json': json({ sources: [{ name: 'kit', marketplace: 'market', version: '1.0.0', claimed: true, items: [{ part: 'skills', id: 'review' }] }] }),
  } });
  assert.equal(PORTABLE_RECEIPT_FORMAT, 'bowerloom/portable-projection-receipt/v1beta4');
  const { plan, result } = await projectNow(p.input());
  assert.deepEqual(plan.sources, [{ skill: 'review', name: 'kit', marketplace: 'market', version: '1.0.0', claimed: true }]);
  assert.deepEqual(result.receipt.sources, plan.sources);
  assert.equal(readPortableReceipt(p.input()).format, PORTABLE_RECEIPT_FORMAT);
  // A v1beta3 receipt holds no claimed: it reads, and the next plan sees the difference and rewrites it.
  forge(p.stateDir, 'receipt.json', r => { r.format = 'bowerloom/portable-projection-receipt/v1beta3'; delete r.sources[0].claimed; });
  assert.deepEqual(readPortableReceipt(p.input()).sources, [{ skill: 'review', name: 'kit', marketplace: 'market', version: '1.0.0' }]);
  assert.equal(planPortable(p.input()).noop, false);
  forge(p.stateDir, 'receipt.json', r => { r.sources[0].claimed = true; });
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_STATE_INVALID', 'claimed in an older format is refused');
  forge(p.stateDir, 'receipt.json', r => { r.format = PORTABLE_RECEIPT_FORMAT; r.sources[0].claimed = false; });
  assert.throws(() => planPortable(p.input()), e => e.code === 'PORTABLE_STATE_INVALID', 'claimed is true or absent');
});
