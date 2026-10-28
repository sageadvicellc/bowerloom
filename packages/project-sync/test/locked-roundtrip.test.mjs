// Step 3 round trip (definition spec section 12, checks 1 and 9): the private block of a guardrail entry reaches its own
// engine where the engine has a place for it. Synthetic fixtures only.
import test from 'node:test';
import { planPortable } from '../../../dist/packages/project-sync/src/index.js';
import { assert, json, projectNow } from './portable-fixture.mjs';
import { PINNED, approveAll, lockedProject, read } from './locked-fixture.mjs';

const engines = (...ids) => PINNED.filter(e => ids.includes(e.id));
const none = { mcp: null, parts: { mcp: undefined } };
const line = (plan, entry, engine) => plan.loss.find(l => l.part === 'guardrails' && l.entry === entry && l.engine === engine && l.field === undefined);
const approvalsFor = p => { try { planPortable(p.input()); return []; } catch (e) { if (e.code !== 'PORTABLE_FIDELITY') throw e; return approveAll(p, e); } };

test('Claude Code: the x-claude-code block of the sandbox is written into sandbox unchanged, after the keys Bowerloom writes', async t => {
  const block = { ignoreViolations: { '*': ['/tmp'] }, reportViolations: true };
  const p = lockedProject(t, { engines: engines('claude-code'), ...none, sandbox: { id: 'box', files: true, network: true, 'x-claude-code': block } });
  const plan = planPortable(p.input());
  assert.doesNotMatch(line(plan, 'box', 'claude-code').reason, /not written/);
  await projectNow(p.input());
  const box = JSON.parse(read(p, '.claude/settings.json')).sandbox;
  assert.deepEqual(box, { enabled: true, allowUnsandboxedCommands: false, ...block });
  assert.deepEqual(Object.keys(box), ['enabled', 'allowUnsandboxedCommands', 'ignoreViolations', 'reportViolations']);
  // A key Bowerloom writes itself is not taken from the block, and the line names it.
  const q = lockedProject(t, { engines: engines('claude-code'), ...none, sandbox: { id: 'box', files: true, network: true, 'x-claude-code': { enabled: false, ignoreViolations: {} } } });
  assert.match(line(planPortable(q.input()), 'box', 'claude-code').reason, /enabled/);
  await projectNow(q.input());
  assert.deepEqual(JSON.parse(read(q, '.claude/settings.json')).sandbox, { enabled: true, allowUnsandboxedCommands: false, ignoreViolations: {} });
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
