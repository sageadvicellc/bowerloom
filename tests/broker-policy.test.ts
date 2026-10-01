import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { digest } from '../packages/contracts/src/index.js';
import { compileCrew } from '../packages/crew/src/index.js';
import { ActionBroker, BROKER_LIMITS, BrokerError, createTaskState, parseProposal } from '../packages/broker/src/index.js';
import { InMemoryBrokerStore, InMemoryWorkspaceEffects } from '../packages/broker/src/synthetic.js';
import type { ActionRecord, ApprovalRequest, BrokerStore, Clock, EffectRequest, EffectResult, IdentityProvider, Proposal, Scope, TaskState, WorkspaceEffects } from '../packages/broker/src/index.js';

const plan = await compileCrew(resolve('examples/endor/crew.yaml'));
const scope: Scope = { workspaceId: 'synthetic-workspace', runId: 'synthetic-run', taskId: 'build' };
const failed = (code: string) => (error: unknown): boolean => error instanceof BrokerError && error.code === code;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
class TestClock implements Clock {
  time = 1000;
  alarms = new Map<() => void, number>();
  now(): number { return this.time; }
  alarm(deadline: number, callback: () => void): () => void { this.alarms.set(callback, deadline); return () => { this.alarms.delete(callback); }; }
  advance(milliseconds: number): void {
    this.time += milliseconds;
    for (const [callback, deadline] of this.alarms) if (deadline <= this.time) { this.alarms.delete(callback); callback(); }
  }
}
function setup() {
  const clock = new TestClock();
  const store = new InMemoryBrokerStore();
  const state = createTaskState(plan, { ...scope, ownerSubject: 'agent:coda', ownerEpoch: 1, approverSubjects: ['founder:reviewer'],
    readyAtMs: clock.now(), leaseExpiresAtMs: 1_000_000, completedDependencies: ['design'] });
  store.seed(state);
  const identity: IdentityProvider = { async authenticate(credential) {
    const subjects: Record<string, string> = { worker: 'agent:coda', reviewer: 'founder:reviewer', stranger: 'unrelated:user' };
    if (typeof credential !== 'string' || !Object.hasOwn(subjects, credential)) throw new Error('Invalid synthetic credential');
    return { subject: subjects[credential]!, proofRef: `synthetic-proof:${credential}`, expiresAtMs: 1_000_000 };
  } };
  const workspace = new InMemoryWorkspaceEffects(clock);
  let calls = 0;
  const effects: WorkspaceEffects = {
    async apply(request, signal) { calls++; return workspace.apply(request, signal); },
    lookup: request => workspace.lookup(request),
  };
  const broker = new ActionBroker({ store, identity, effects, clock });
  const proposal = (requestId = 'write-one'): Proposal => ({ format: 'trellis/action/v0.7-alpha', scope: structuredClone(scope), requestId,
    candidateRevision: plan.candidateRevision, ownerEpoch: 1, edit: { operation: 'workspace.write', path: 'output/job-board/index.html', expectedDigest: null, content: '<p>Synthetic job board</p>' } });
  const approval = (action: ActionRecord): ApprovalRequest => ({ candidateRevision: action.proposal.candidateRevision,
    actionDigest: action.actionDigest, ownerEpoch: action.proposal.ownerEpoch, expiresAtMs: clock.now() + 60_000 });
  const prepare = (value = proposal()) => broker.prepare(JSON.stringify(value), 'worker');
  const approve = (action: ActionRecord) => broker.approve(action.proposal.scope, action.proposal.requestId, approval(action), 'reviewer');
  return { clock, store, state, identity, workspace, effects, broker, proposal, approval, prepare, approve, calls: () => calls };
}

test('exact approval releases one bounded synthetic write and retains its receipt', async () => {
  const f = setup();
  const action = await f.prepare();
  assert.equal(action.status, 'PREPARED');
  assert.equal(f.calls(), 0);
  const approved = await f.approve(action);
  assert.equal(approved.approval?.proofRef, 'synthetic-proof:reviewer');
  const completed = await f.broker.dispatch(scope, 'write-one', 'worker');
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.receipt?.afterDigest, digest(action.proposal.edit.content));
  assert.equal(f.workspace.read(scope.workspaceId, action.proposal.edit.path), action.proposal.edit.content);
  assert.equal(f.calls(), 1);
  assert.deepEqual(await f.broker.dispatch(scope, 'write-one', 'worker'), completed);
  assert.equal(f.calls(), 1);
});

test('dispatch records committed intent before it calls the effect adapter', async () => {
  const f = setup();
  await f.approve(await f.prepare());
  const effects: WorkspaceEffects = { lookup: f.effects.lookup, async apply(request, signal) {
    const stored = await f.store.transaction(scope, state => state.actions['write-one']);
    assert.equal(stored?.status, 'IN_FLIGHT');
    assert.equal(stored?.operationKey, request.operationKey);
    return f.effects.apply(request, signal);
  } };
  const broker = new ActionBroker({ ...f, effects });
  assert.equal((await broker.dispatch(scope, 'write-one', 'worker')).status, 'COMPLETED');
});

test('request reuse is stable, but changed bytes or preconditions conflict', async () => {
  const f = setup();
  const original = await f.prepare();
  assert.deepEqual(await f.prepare(), original);
  for (const edit of [{ content: 'changed' }, { expectedDigest: digest('prior') }]) {
    const proposal = f.proposal(); Object.assign(proposal.edit, edit);
    await assert.rejects(f.prepare(proposal), failed('REQUEST_CONFLICT'));
  }
  assert.equal(f.calls(), 0);
});

test('changing action bytes creates a different digest and needs separate approval', async () => {
  const f = setup();
  const first = await f.prepare(); await f.approve(first);
  const next = f.proposal('write-two'); next.edit.content = 'Changed body';
  const second = await f.prepare(next);
  assert.notEqual(first.actionDigest, second.actionDigest);
  await assert.rejects(f.broker.approve(scope, 'write-two', f.approval(first), 'reviewer'), failed('STALE_APPROVAL'));
  await assert.rejects(f.broker.dispatch(scope, 'write-two', 'worker'), failed('APPROVAL_REQUIRED'));
});

for (const [name, change] of [
  ['candidate', (value: ApprovalRequest) => { value.candidateRevision = digest('other-candidate'); }],
  ['action', (value: ApprovalRequest) => { value.actionDigest = digest('other-action'); }],
  ['ownership epoch', (value: ApprovalRequest) => { value.ownerEpoch++; }],
] as const) {
  test(`refuse approval for a different ${name}`, async () => {
    const f = setup(); const action = await f.prepare(); const approval = f.approval(action); change(approval);
    await assert.rejects(f.broker.approve(scope, 'write-one', approval, 'reviewer'), failed('STALE_APPROVAL'));
    assert.equal(f.calls(), 0);
  });
}

test('missing, expired, and revoked approval all stop dispatch', async () => {
  const f = setup(); const action = await f.prepare();
  await assert.rejects(f.broker.dispatch(scope, 'write-one', 'worker'), failed('APPROVAL_REQUIRED'));
  await f.approve(action); f.clock.advance(60_000);
  await assert.rejects(f.broker.dispatch(scope, 'write-one', 'worker'), failed('APPROVAL_REQUIRED'));
  await f.approve(action); await f.broker.revokeApproval(scope, 'write-one', 'reviewer');
  await assert.rejects(f.broker.dispatch(scope, 'write-one', 'worker'), failed('APPROVAL_REQUIRED'));
  assert.equal(f.calls(), 0);
});

test('approval expiry cannot exceed the identity, task, lease, or fixed time bounds', async () => {
  const f = setup(); const action = await f.prepare();
  for (const expiresAtMs of [f.clock.now(), f.clock.now() - 1, 1_100_000, NaN]) {
    await assert.rejects(f.broker.approve(scope, 'write-one', { ...f.approval(action), expiresAtMs }, 'reviewer'), failed('INVALID_APPROVAL'));
  }
});

test('identity comes from the trusted provider, not action fields or caller labels', async () => {
  const f = setup();
  await assert.rejects(f.broker.prepare(JSON.stringify(f.proposal()), { subject: 'agent:coda' }), failed('UNAUTHENTICATED'));
  await assert.rejects(f.broker.prepare(JSON.stringify(f.proposal()), 'stranger'), failed('FORBIDDEN'));
  const action = await f.prepare();
  await assert.rejects(f.broker.approve(scope, 'write-one', f.approval(action), 'worker'), failed('FORBIDDEN'));
  await assert.rejects(f.broker.inspect(scope, 'write-one', 'stranger'), failed('FORBIDDEN'));
  await assert.rejects(f.broker.cancel(scope, 'stranger'), failed('FORBIDDEN'));
  assert.equal(f.calls(), 0);
});

test('identity expiry is rechecked inside the transaction', async () => {
  const f = setup();
  const store: BrokerStore = { transaction<T>(scope: Scope, mutate: (state: TaskState) => T): Promise<T> {
    f.clock.advance(1_000_000); return f.store.transaction(scope, mutate);
  } };
  const broker = new ActionBroker({ ...f, store });
  await assert.rejects(broker.prepare(JSON.stringify(f.proposal()), 'worker'), failed('UNAUTHENTICATED'));
  assert.equal(f.calls(), 0);
});

test('stale plan, ownership, lease, and task readiness stop prepared actions', async t => {
  for (const [name, code, change] of [
    ['candidate', 'STALE_AUTHORITY', (state: TaskState) => { state.candidateRevision = digest('replacement'); }],
    ['owner epoch', 'STALE_AUTHORITY', (state: TaskState) => { state.ownerEpoch++; }],
    ['owner identity', 'FORBIDDEN', (state: TaskState) => { state.ownerSubject = 'agent:replacement'; }],
    ['lease', 'LEASE_EXPIRED', (state: TaskState) => { state.leaseExpiresAtMs = 1000; }],
    ['dependencies', 'TASK_NOT_READY', (state: TaskState) => { state.completedDependencies = []; }],
    ['future readiness', 'TASK_NOT_READY', (state: TaskState) => { state.readyAtMs = 2000; }],
    ['removed approver', 'APPROVAL_REQUIRED', (state: TaskState) => { state.approverSubjects = []; }],
  ] as const) {
    await t.test(name, async () => {
      const f = setup(); await f.approve(await f.prepare()); await f.store.transaction(scope, change);
      await assert.rejects(f.broker.dispatch(scope, 'write-one', 'worker'), failed(code));
      assert.equal(f.calls(), 0);
    });
  }
});

test('workspace and task scope cannot reuse another action approval', async () => {
  const f = setup(); const first = await f.approve(await f.prepare());
  const otherScope = { ...scope, workspaceId: 'other-workspace' };
  f.store.seed({ ...structuredClone(f.state), scope: otherScope });
  const proposal = f.proposal(); proposal.scope = otherScope;
  const second = await f.prepare(proposal);
  await assert.rejects(f.broker.approve(otherScope, 'write-one', f.approval(first), 'reviewer'), failed('STALE_APPROVAL'));
  await f.store.transaction(otherScope, state => { state.actions['write-one']!.approval = first.approval; });
  await assert.rejects(f.broker.dispatch(otherScope, 'write-one', 'worker'), failed('APPROVAL_REQUIRED'));
  assert.notEqual(first.actionDigest, second.actionDigest);
});

test('undeclared writes and prefix collisions are denied', async () => {
  const f = setup();
  for (const path of ['private/secret.txt', 'output/job-board-other/index.html']) {
    const proposal = f.proposal(); proposal.edit.path = path;
    await assert.rejects(f.prepare(proposal), failed('EFFECT_DENIED'));
  }
});

test('broker exposes no command execution, path escape, or unbounded edit proposal', () => {
  const f = setup();
  const cases: Array<[string, (proposal: Proposal) => void]> = [
    ['INVALID_PROPOSAL', proposal => { Object.assign(proposal.edit, { operation: 'command.test', command: 'test-job-board' }); }],
    ['INVALID_PROPOSAL', proposal => { Object.assign(proposal, { authenticatedSubject: 'founder:reviewer' }); }],
    ['INVALID_PROPOSAL', proposal => { proposal.edit.content = 'a'.repeat(BROKER_LIMITS.contentBytes + 1); }],
    ['INVALID_PROPOSAL', proposal => { proposal.edit.content = '\ud800'; }],
    ['INVALID_PROPOSAL', proposal => { proposal.edit.expectedDigest = 'anything'; }],
    ['UNSAFE_PATH', proposal => { proposal.edit.path = '../outside'; }],
    ['UNSAFE_PATH', proposal => { proposal.edit.path = '/tmp/outside'; }],
    ['UNSAFE_PATH', proposal => { proposal.edit.path = '.env'; }],
  ];
  for (const [code, mutate] of cases) { const value = f.proposal(); mutate(value); assert.throws(() => parseProposal(JSON.stringify(value)), failed(code)); }
  assert.throws(() => parseProposal(' '.repeat(BROKER_LIMITS.proposalBytes + 1)), failed('INVALID_PROPOSAL'));
});

test('cancellation before dispatch prevents the effect and further proposals', async () => {
  const f = setup(); await f.approve(await f.prepare()); await f.broker.cancel(scope, 'reviewer');
  assert.equal((await f.broker.dispatch(scope, 'write-one', 'worker')).status, 'CANCELLED');
  await assert.rejects(f.prepare(f.proposal('another-write')), failed('CANCELLED'));
  assert.equal(f.calls(), 0);
});

test('task deadline stops a prepared action', async () => {
  const f = setup(); await f.approve(await f.prepare()); f.clock.advance(610_000);
  await assert.rejects(f.broker.dispatch(scope, 'write-one', 'worker'), failed('DEADLINE_EXPIRED'));
  assert.equal(f.calls(), 0);
});

test('concurrent dispatch through two broker instances calls the effect only once', async () => {
  const f = setup(); await f.approve(await f.prepare());
  const other = new ActionBroker(f);
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => (index % 2 ? f.broker : other).dispatch(scope, 'write-one', 'worker')));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of results) if (result.status === 'rejected') assert(failed('RECONCILIATION_REQUIRED')(result.reason));
  assert.equal(f.calls(), 1);
  assert.equal((await other.dispatch(scope, 'write-one', 'worker')).status, 'COMPLETED');
  assert.equal(f.calls(), 1);
});

test('concurrent writes to one path cannot overwrite an unexpected predecessor', async () => {
  const f = setup(); await f.approve(await f.prepare());
  const second = f.proposal('write-two'); second.edit.content = 'Competing content'; await f.approve(await f.prepare(second));
  const results = await Promise.all([f.broker.dispatch(scope, 'write-one', 'worker'), f.broker.dispatch(scope, 'write-two', 'worker')]);
  assert.deepEqual(results.map(result => result.status).sort(), ['COMPLETED', 'NOT_APPLIED']);
  const completed = results.find(result => result.status === 'COMPLETED')!;
  assert.equal(f.workspace.read(scope.workspaceId, completed.proposal.edit.path), completed.proposal.edit.content);
});

test('an existing file changes only when its digest matches the approved precondition', async () => {
  const f = setup(); const proposal = f.proposal(); f.workspace.seed(scope.workspaceId, proposal.edit.path, 'Prior content');
  await f.approve(await f.prepare(proposal));
  const rejected = await f.broker.dispatch(scope, proposal.requestId, 'worker');
  assert.equal(rejected.status, 'NOT_APPLIED');
  assert.equal(f.workspace.read(scope.workspaceId, proposal.edit.path), 'Prior content');
  proposal.requestId = 'write-two'; proposal.edit.expectedDigest = digest('Prior content'); await f.approve(await f.prepare(proposal));
  assert.equal((await f.broker.dispatch(scope, proposal.requestId, 'worker')).status, 'COMPLETED');
});

test('an effect exception holds the action without automatic retry', async () => {
  const f = setup(); await f.approve(await f.prepare()); let calls = 0;
  const effects: WorkspaceEffects = { async apply() { calls++; throw new Error('ambiguous external result'); }, async lookup() { return null; } };
  const broker = new ActionBroker({ ...f, effects });
  assert.equal((await broker.dispatch(scope, 'write-one', 'worker')).status, 'NEEDS_RECONCILIATION');
  await assert.rejects(broker.dispatch(scope, 'write-one', 'worker'), failed('RECONCILIATION_REQUIRED'));
  assert.equal((await broker.reconcile(scope, 'write-one', 'reviewer')).status, 'NEEDS_RECONCILIATION');
  assert.equal(calls, 1);
});

test('an invalid receipt cannot prove completion', async () => {
  const f = setup(); await f.approve(await f.prepare());
  const effects: WorkspaceEffects = { lookup: f.effects.lookup, async apply(request, signal) {
    const result = await f.effects.apply(request, signal);
    if (result.kind === 'applied') result.receipt.afterDigest = digest('unrelated-result');
    return result;
  } };
  const broker = new ActionBroker({ ...f, effects });
  assert.equal((await broker.dispatch(scope, 'write-one', 'worker')).status, 'NEEDS_RECONCILIATION');
  assert.equal((await broker.reconcile(scope, 'write-one', 'reviewer')).status, 'COMPLETED');
  assert.equal(f.calls(), 1);
});

test('deadline termination leaves a hold when the effect supplies no accepted receipt', async () => {
  const f = setup(); await f.approve(await f.prepare());
  const started = deferred<void>(); const result = deferred<EffectResult>();
  let signal!: AbortSignal;
  const effects: WorkspaceEffects = { async apply(_request, currentSignal) { signal = currentSignal; started.resolve(); return result.promise; }, async lookup() { return null; } };
  const broker = new ActionBroker({ ...f, effects });
  const dispatch = broker.dispatch(scope, 'write-one', 'worker'); await started.promise;
  f.clock.advance(300_000);
  assert.equal((await dispatch).status, 'NEEDS_RECONCILIATION');
  assert.equal(signal.aborted, true);
  assert.equal(f.clock.alarms.size, 0);
  await assert.rejects(broker.dispatch(scope, 'write-one', 'worker'), failed('RECONCILIATION_REQUIRED'));
});

test('cancellation during dispatch records an uncertain effect without claiming rollback', async () => {
  const f = setup(); await f.approve(await f.prepare());
  const applied = deferred<void>(); const release = deferred<void>();
  const effects: WorkspaceEffects = { lookup: f.effects.lookup, async apply(request, signal) {
    const result = await f.effects.apply(request, signal); applied.resolve(); await release.promise; return result;
  } };
  const broker = new ActionBroker({ ...f, effects });
  const dispatch = broker.dispatch(scope, 'write-one', 'worker'); await applied.promise;
  await broker.cancel(scope, 'reviewer');
  assert.equal((await dispatch).status, 'NEEDS_RECONCILIATION');
  release.resolve();
  const completed = await broker.reconcile(scope, 'write-one', 'reviewer');
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(await f.store.transaction(scope, state => state.cancelRequested), true);
  assert.equal(f.calls(), 1);
  assert.equal((await broker.dispatch(scope, 'write-one', 'worker')).status, 'COMPLETED');
  assert.equal(f.calls(), 1);
});

test('storage failure before dispatch commit calls no effect', async () => {
  const f = setup(); await f.approve(await f.prepare());
  const store: BrokerStore = { transaction<T>(scope: Scope, mutate: (state: TaskState) => T): Promise<T> {
    return f.store.transaction(scope, state => { mutate(state); throw new Error('synthetic commit failure'); });
  } };
  const broker = new ActionBroker({ ...f, store });
  await assert.rejects(broker.dispatch(scope, 'write-one', 'worker'), /synthetic commit failure/);
  assert.equal(f.calls(), 0);
  assert.equal((await f.broker.inspect(scope, 'write-one', 'worker')).status, 'PREPARED');
});

test('lost completion storage recovers from a receipt without repeating the effect', async () => {
  const f = setup(); await f.approve(await f.prepare());
  let failCompletion = true;
  const store: BrokerStore = { transaction<T>(scope: Scope, mutate: (state: TaskState) => T): Promise<T> {
    return f.store.transaction(scope, state => {
      const result = mutate(state);
      if (failCompletion && state.actions['write-one']?.status === 'COMPLETED') { failCompletion = false; throw new Error('synthetic completion commit failure'); }
      return result;
    });
  } };
  const broker = new ActionBroker({ ...f, store });
  await assert.rejects(broker.dispatch(scope, 'write-one', 'worker'), /synthetic completion commit failure/);
  assert.equal(f.calls(), 1);
  const replacement = new ActionBroker({ ...f, store });
  await assert.rejects(replacement.dispatch(scope, 'write-one', 'worker'), failed('RECONCILIATION_REQUIRED'));
  await replacement.recover(scope, 'reviewer');
  assert.equal((await replacement.reconcile(scope, 'write-one', 'reviewer')).status, 'COMPLETED');
  assert.equal(f.calls(), 1);
});

test('an ambiguous dispatch commit refuses replay even when no effect was observed', async () => {
  const f = setup(); await f.approve(await f.prepare()); let first = true;
  const store: BrokerStore = { async transaction<T>(scope: Scope, mutate: (state: TaskState) => T): Promise<T> {
    const result = await f.store.transaction(scope, mutate);
    if (first) { first = false; throw new Error('synthetic lost commit response'); }
    return result;
  } };
  const broker = new ActionBroker({ ...f, store });
  await assert.rejects(broker.dispatch(scope, 'write-one', 'worker'), /synthetic lost commit response/);
  assert.equal(f.calls(), 0);
  await broker.recover(scope, 'reviewer');
  assert.equal((await broker.reconcile(scope, 'write-one', 'reviewer')).status, 'NEEDS_RECONCILIATION');
  await assert.rejects(broker.dispatch(scope, 'write-one', 'worker'), failed('RECONCILIATION_REQUIRED'));
});

test('store rollback and detached results preserve transaction boundaries', async () => {
  const f = setup();
  await assert.rejects(f.store.transaction(scope, state => { state.ownerEpoch = 99; throw new Error('rollback'); }), /rollback/);
  const detached = await f.store.transaction(scope, state => state);
  assert.equal(detached.ownerEpoch, 1); detached.ownerEpoch = 99;
  assert.equal(await f.store.transaction(scope, state => state.ownerEpoch), 1);
});

test('action content is pinned even when returned records are changed by a caller', async () => {
  const f = setup(); const action = await f.prepare(); const original = action.proposal.edit.content;
  action.proposal.edit.content = 'Caller mutation';
  await f.approve(action);
  assert.equal((await f.broker.dispatch(scope, 'write-one', 'worker')).proposal.edit.content, original);
  assert.equal(f.workspace.read(scope.workspaceId, action.proposal.edit.path), original);
});

test('a changed stored payload cannot use its earlier approval', async () => {
  const f = setup(); await f.approve(await f.prepare());
  await f.store.transaction(scope, state => { state.actions['write-one']!.proposal.edit.content = 'Changed after approval'; });
  await assert.rejects(f.broker.dispatch(scope, 'write-one', 'worker'), failed('RECORD_CONFLICT'));
  assert.equal(f.calls(), 0);
});

test('the compiled task determines whether an action needs separate approval', async () => {
  const f = setup(); const designScope = { ...scope, taskId: 'design' };
  f.store.seed(createTaskState(plan, { ...designScope, ownerSubject: 'agent:coda', ownerEpoch: 1, approverSubjects: ['founder:reviewer'],
    readyAtMs: 1000, leaseExpiresAtMs: 1_000_000, completedDependencies: [] }));
  const proposal = f.proposal(); proposal.scope = designScope; proposal.edit.path = 'output/design/brief.md';
  await f.prepare(proposal);
  assert.equal((await f.broker.dispatch(designScope, proposal.requestId, 'worker')).status, 'COMPLETED');
});

test('malformed receipt lookup retains the reconciliation hold', async () => {
  const f = setup(); await f.approve(await f.prepare());
  const effects: WorkspaceEffects = {
    async apply(request, signal) { await f.effects.apply(request, signal); throw new Error('lost reply'); },
    async lookup(request) { const receipt = await f.effects.lookup(request); return receipt ? { ...receipt, workspaceId: 'unrelated-workspace' } : null; },
  };
  const broker = new ActionBroker({ ...f, effects });
  assert.equal((await broker.dispatch(scope, 'write-one', 'worker')).status, 'NEEDS_RECONCILIATION');
  assert.equal((await broker.reconcile(scope, 'write-one', 'reviewer')).status, 'NEEDS_RECONCILIATION');
  await assert.rejects(broker.dispatch(scope, 'write-one', 'worker'), failed('RECONCILIATION_REQUIRED'));
  assert.equal(f.calls(), 1);
});

test('tampered compiled plans cannot create a trusted task state', () => {
  const f = setup(); const changed = structuredClone(plan); changed.definition.tasks[1]!.effects = [];
  assert.throws(() => createTaskState(changed, { ...scope, ownerSubject: 'agent:coda', ownerEpoch: 1, approverSubjects: ['founder:reviewer'],
    readyAtMs: 1000, leaseExpiresAtMs: 1_000_000, completedDependencies: ['design'] }), failed('INVALID_PLAN'));
  assert.equal(f.calls(), 0);
});
