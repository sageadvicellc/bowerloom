import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../packages/contracts/src/index.js';
import { namesYesFlag, parseApprovalFlags, runWithApproval } from '../apps/cli/src/confirm.js';
import type { ApprovalIo } from '../apps/cli/src/confirm.js';
import type { PlannedChange } from '../packages/project-context/src/types.js';

const REV = (c: string) => c.repeat(64);
interface Plan { readonly files: readonly string[]; readonly stamp: string }
/** A change whose revision follows `state.stamp`, so a test can change an input between plan and apply. */
function change(state = { stamp: 'a' }) {
  const applied: string[] = [], planned: number[] = []; let count = 0;
  const value: PlannedChange<Plan> = {
    plan: async () => { planned.push(++count); return { files: ['teams/research/team.md'], stamp: state.stamp }; },
    revision: plan => REV(plan.stamp),
    review: plan => `Create ${plan.files.join(', ')}.`,
    apply: async revision => { applied.push(revision); return { done: revision }; },
  };
  return { value, applied, planned, state };
}
const terminal = (answers: string[], seen: string[] = [], hook?: () => void): ApprovalIo => ({ interactive: true, ask: async q => { seen.push(q); hook?.(); return answers.shift() ?? ''; } });
const piped: ApprovalIo = { interactive: false, ask: async () => { throw new Error('a pipe must not prompt'); } };

test('in a terminal, a yes plans again and applies once', async () => {
  const c = change(), seen: string[] = [];
  const result = await runWithApproval(c.value, { json: false }, terminal(['y'], seen));
  assert.equal(result.exitCode, 0); assert.deepEqual(c.applied, [REV('a')]); assert.equal(c.planned.length, 2);
  assert.match(seen[0]!, /Create teams\/research\/team\.md\./); assert.match(seen[0]!, /Apply plan aaaa…aaaa\? \[y\/N\]/);
  assert.match(result.output, new RegExp(REV('a')));
});

test('a yes is accepted as yes, YES or y with spaces; anything else declines', async () => {
  for (const answer of ['yes', 'YES', ' y ']) { const c = change(); assert.equal((await runWithApproval(c.value, { json: false }, terminal([answer]))).exitCode, 0, answer); assert.equal(c.applied.length, 1); }
  for (const answer of ['', 'n', 'no', 'maybe', 'yy']) {
    const c = change(); await assert.rejects(runWithApproval(c.value, { json: false }, terminal([answer])), (e: { code: string }) => e.code === 'APPROVAL_DECLINED', answer); assert.deepEqual(c.applied, []);
  }
});

test('an input changed during the prompt gives STALE_APPROVAL with no write', async () => {
  const c = change();
  await assert.rejects(runWithApproval(c.value, { json: false }, terminal(['y'], [], () => { c.state.stamp = 'b'; })), (e: { code: string }) => e.code === 'STALE_APPROVAL');
  assert.deepEqual(c.applied, []);
});

test('a no gives APPROVAL_DECLINED with no write and no second plan', async () => {
  const c = change();
  await assert.rejects(runWithApproval(c.value, { json: false }, terminal(['n'])), (e: { code: string }) => e.code === 'APPROVAL_DECLINED');
  assert.deepEqual(c.applied, []); assert.equal(c.planned.length, 1);
});

test('without a terminal and without --approve, it prints the plan and revision and needs approval', async () => {
  const c = change(), result = await runWithApproval(c.value, { json: false }, piped);
  assert.equal(result.exitCode, 3); assert.deepEqual(c.applied, []);
  assert.equal(result.output, `Create teams/research/team.md.\nRevision: ${REV('a')}\nApproval required. Run the same command again with --approve ${REV('a')}\n`);
});

test('with --json and no --approve, it prints the full plan as one JSON object and needs approval, even in a terminal', async () => {
  const c = change(), result = await runWithApproval(c.value, { json: true }, terminal(['y']));
  assert.equal(result.exitCode, 3); assert.deepEqual(c.applied, []);
  assert.equal(result.output, canonicalJson({ approvalRequired: true, code: 'APPROVAL_REQUIRED', plan: { files: ['teams/research/team.md'], stamp: 'a' }, revision: REV('a') }) + '\n');
});

test('with the matching --approve it applies once and never prompts', async () => {
  const c = change(), result = await runWithApproval(c.value, { approve: REV('a'), json: false }, piped);
  assert.equal(result.exitCode, 0); assert.deepEqual(c.applied, [REV('a')]); assert.equal(result.output, `Applied plan ${REV('a')}.\n`);
  const j = change(), json = await runWithApproval(j.value, { approve: REV('a'), json: true }, piped);
  assert.equal(json.output, canonicalJson({ applied: true, revision: REV('a'), result: { done: REV('a') } }) + '\n');
});

test('a different --approve gives STALE_APPROVAL with no write', async () => {
  const c = change();
  await assert.rejects(runWithApproval(c.value, { approve: REV('c'), json: false }, piped), (e: { code: string }) => e.code === 'STALE_APPROVAL');
  assert.deepEqual(c.applied, []);
});

test('a plan whose revision is not 64 lowercase hex is refused, never applied', async () => {
  const c = change(); const bad: PlannedChange<Plan> = { ...c.value, revision: () => 'xyz' };
  await assert.rejects(runWithApproval(bad, { approve: 'xyz', json: false }, piped), (e: { code: string }) => e.code === 'IO_ERROR');
  assert.deepEqual(c.applied, []);
});

test('parseApprovalFlags takes --approve and --json and returns the other words', () => {
  assert.deepEqual(parseApprovalFlags(['a', '--json', 'b']), { json: true, rest: ['a', 'b'] });
  assert.deepEqual(parseApprovalFlags(['--approve', REV('f'), 'x']), { approve: REV('f'), json: false, rest: ['x'] });
  assert.deepEqual(parseApprovalFlags([]), { json: false, rest: [] });
});

test('parseApprovalFlags refuses --yes, malformed or repeated --approve and --json as usage', () => {
  const usage = (args: string[]) => assert.throws(() => parseApprovalFlags(args), (e: { code: string }) => e.code === 'USAGE', args.join(' '));
  usage(['--yes']); usage(['-y']); usage(['--yes=true']); usage(['--approve']); usage(['--approve', 'abc']); usage(['--approve', 'A'.repeat(64)]);
  usage(['--approve', 'sha256:' + REV('a')]); usage(['--approve', REV('a') + '0']); usage([`--approve=${REV('a')}`]);
  usage(['--approve', REV('a'), '--approve', REV('a')]); usage(['--json', '--json']); usage(['--approve', '--json']);
});

test('the review text escapes control bytes in the prompt and on a pipe, and keeps its lines; JSON keeps the plan exact', async () => {
  const c = change(), seen: string[] = [];
  const hostile: PlannedChange<Plan> = { ...c.value, review: plan => `Create ${plan.files.join(', ')}.\nNote: \x1b[2J\u202eevil\x9b` };
  await runWithApproval(hostile, { json: false }, terminal(['y'], seen));
  assert.equal(seen[0]!.includes('\x1b'), false); assert.equal(seen[0]!.includes('\u202e'), false); assert.equal(seen[0]!.includes('\x9b'), false);
  assert.match(seen[0]!, /^Create teams\/research\/team\.md\.\nNote: \\u001b\[2J\\u202eevil\\u009b\nApply plan /);
  const piped3 = await runWithApproval(hostile, { json: false }, piped);
  assert.equal(piped3.output, `Create teams/research/team.md.\nNote: \\u001b[2J\\u202eevil\\u009b\nRevision: ${REV('a')}\nApproval required. Run the same command again with --approve ${REV('a')}\n`);
  const weird: PlannedChange<{ note: string }> = { plan: async () => ({ note: 'a\x1bb' }), revision: () => REV('a'), review: p => p.note, apply: async () => ({}) };
  assert.equal((await runWithApproval(weird, { json: true }, piped)).output, canonicalJson({ approvalRequired: true, code: 'APPROVAL_REQUIRED', plan: { note: 'a\x1bb' }, revision: REV('a') }) + '\n');
});

test('namesYesFlag finds --yes anywhere and -y only in a flag position, never as the value of a flag', () => {
  for (const args of [['--yes'], ['init', 'plan', '--yes'], ['--yes=1'], ['-y'], ['init', 'apply', '-y'], ['ls', '--json', '-y'], ['init', 'plan', '--goal', 'x', '-y'], ['init', 'plan', '--goal', '--yes'], ['up', '--demo', '-y'], ['harness', 'import', '--synthetic', '-y']]) {
    assert.equal(namesYesFlag(args), true, args.join(' '));
  }
  for (const args of [['init', 'plan', '--goal', '-y'], ['init', 'plan', '--assistant', '-y', '--json'], ['init', 'plan', '--name', 'x', '--goal', '-y'], ['ls'], ['init', 'plan', '--goal', 'yes'], ['init', 'plan', '--goal=-y'], ['-yy'], ['--yesterday']]) {
    assert.equal(namesYesFlag(args), false, args.join(' '));
  }
});
