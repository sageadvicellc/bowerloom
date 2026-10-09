/** Internal historical evidence. None of these records grants an effect or a retry. */
import { createPublicKey, verify } from 'node:crypto';
import { resolve } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import type { Scope } from '../../broker/src/types.js';
import { data, fail, sha256 } from './model.js';
import { validateDiscoveryAuthorityState } from './authority.js';
import type { DiscoveryAuthorityState } from './authority.js';
import { validateGuardianBinding, verifyGuardianJournal } from './container-guardian-provenance.js';
import type { GuardianBinding } from './container-guardian-provenance.js';
import { snapshotContainerJournal } from './container-journal-snapshot.js';
import { readDarwinBootSession } from './darwin-boot-session.js';
const hash = (v: unknown) => 'sha256:' + sha256(canonicalJson(v));
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function requireValue(v: unknown): asserts v { if (!v) fail('MCP_GUARDIAN_CHECKPOINT_INVALID'); }
function exact(v: unknown, keys: string[]): Record<string, any> { const r = data(v) as Record<string, any>; requireValue(r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).sort().join() === keys.sort().join()); return r; }
export interface GuardianCheckpoint { format: 'bowerloom/mcp-guardian-checkpoint/v1beta1'; bindingRevision: string; sequence: number; envelope: string; envelopeSha256: string; previousRevision: string | null; revision: string }
export interface GuardianCloseWitness { format: 'bowerloom/mcp-guardian-owned-close/v1beta1'; bindingRevision: string; guardianSessionId: string; guardianPid: number; exitCode: 0; signal: null; observedAtMs: number }
export interface GuardianClosure { format: 'bowerloom/mcp-guardian-closure/v1beta1'; checkpointRevision: string; seal: string; witness: GuardianCloseWitness; revision: string }
export interface GuardianCheckpointEvidence { authority: DiscoveryAuthorityState; binding: GuardianBinding | null; checkpoints: GuardianCheckpoint[]; closure: GuardianClosure | null }
export interface GuardianCheckpointStore {
  recordGuardianCheckpoint(expected: DiscoveryAuthorityState, head: string | null, envelope: string, assertLive: (state: DiscoveryAuthorityState) => void): Promise<GuardianCheckpoint>;
  recordGuardianClosed(expected: DiscoveryAuthorityState, head: string | null, envelope: string, seal: string, witness: GuardianCloseWitness, checkActive: () => void): Promise<GuardianClosure>;
  readGuardianCheckpointEvidence(scope: Scope): Promise<GuardianCheckpointEvidence>;
}
export interface GuardianCheckpointCallbacks {
  checkpoint(head: string | null, envelope: string): Promise<GuardianCheckpoint>;
  closed(head: string | null, envelope: string, seal: string, witness: GuardianCloseWitness): Promise<GuardianClosure>;
}
export function guardianTerminalPayload(value: unknown): Buffer { return Buffer.from('bowerloom/guardian-terminal-seal/v1\n' + canonicalJson(value)); }
export function terminalDeclaration(bindingRevision: string, envelope: string) {
  const v = strictJson(envelope, 12288) as Record<string, any>;
  requireValue(v.bindingRevision === bindingRevision && ['REAPED', 'CANCELLED'].includes(v.body?.stage));
  const b = v.body;
  if (b.stage === 'REAPED') requireValue(b.cid !== null && b.lease.containerAbsentAtMs !== null && (b.attachPid === null || b.lease.attachReapedAtMs !== null));
  else requireValue(b.cid === null && b.attachPid === null);
  return { format: 'bowerloom/mcp-guardian-terminal/v1beta1', bindingRevision, sequence: v.sequence as number, envelopeSha256: 'sha256:' + sha256(envelope), outcome: b.stage as string };
}
export function verifyGuardianTerminal(envelope: string, seal: string, binding: GuardianBinding): void {
  verifyGuardianJournal(envelope, binding);
  requireValue(typeof seal === 'string' && Buffer.byteLength(seal) <= 2048);
  const s = exact(strictJson(seal, 2048), ['format', 'bindingRevision', 'sequence', 'envelopeSha256', 'outcome', 'signature']);
  requireValue(canonicalJson(s) === seal); const { signature, ...body } = s;
  requireValue(same(body, terminalDeclaration(binding.revision, envelope)) && typeof signature === 'string');
  const bytes = Buffer.from(signature, 'base64'); requireValue(bytes.length === 64 && bytes.toString('base64') === signature);
  const key = createPublicKey({ key: Buffer.from(binding.descriptor.publicKey, 'base64'), format: 'der', type: 'spki' });
  requireValue(verify(null, guardianTerminalPayload(body), key, bytes));
}
export function createGuardianCheckpoint(binding: GuardianBinding, previous: string | null, envelope: string): GuardianCheckpoint {
  requireValue(typeof envelope === 'string' && Buffer.byteLength(envelope) <= 12288 && (previous === null || /^sha256:[a-f0-9]{64}$/.test(previous)));
  const sequence = verifyGuardianJournal(envelope, binding);
  const body = { format: 'bowerloom/mcp-guardian-checkpoint/v1beta1' as const, bindingRevision: binding.revision, sequence, envelope, envelopeSha256: 'sha256:' + sha256(envelope), previousRevision: previous };
  return { ...body, revision: hash(body) };
}
export function createGuardianClosure(binding: GuardianBinding, checkpoint: GuardianCheckpoint, seal: string, supplied: GuardianCloseWitness): GuardianClosure {
  verifyGuardianTerminal(checkpoint.envelope, seal, binding);
  const witness = exact(supplied, ['format', 'bindingRevision', 'guardianSessionId', 'guardianPid', 'exitCode', 'signal', 'observedAtMs']) as GuardianCloseWitness;
  requireValue(witness.format === 'bowerloom/mcp-guardian-owned-close/v1beta1' && witness.bindingRevision === binding.revision && witness.guardianSessionId === binding.descriptor.guardianSessionId && witness.guardianPid === binding.descriptor.guardianPid && witness.exitCode === 0 && witness.signal === null && Number.isSafeInteger(witness.observedAtMs) && witness.observedAtMs >= binding.intent.startedAtMs);
  const body = { format: 'bowerloom/mcp-guardian-closure/v1beta1' as const, checkpointRevision: checkpoint.revision, seal, witness };
  return { ...body, revision: hash(body) };
}
export function validateGuardianCheckpointRecords(binding: GuardianBinding | null, checkpoints: unknown, closure: unknown): { checkpoints: GuardianCheckpoint[]; closure: GuardianClosure | null } {
  const list = data(checkpoints) as GuardianCheckpoint[]; requireValue(Array.isArray(list) && list.length <= 32);
  requireValue(binding || (list.length === 0 && closure === null)); let previous: GuardianCheckpoint | undefined;
  for (const item of list) {
    requireValue(same(item, createGuardianCheckpoint(binding!, previous?.revision ?? null, item.envelope)) && (!previous || item.sequence > previous.sequence));
    const stage = (strictJson(item.envelope, 12288) as any).body.stage;
    requireValue(['CREATING', 'CREATED', 'STARTED'].includes(stage) || item === list.at(-1) && closure !== null && ['REAPED', 'CANCELLED'].includes(stage));
    previous = item;
  }
  let terminal: GuardianClosure | null = null;
  if (closure !== null) { const c = data(closure) as GuardianClosure; requireValue(previous && same(c, createGuardianClosure(binding!, previous!, c.seal, c.witness))); terminal = c; }
  return { checkpoints: list, closure: terminal };
}
export function advanceGuardianCheckpoint(binding: GuardianBinding, records: { checkpoints: GuardianCheckpoint[]; closure: GuardianClosure | null }, head: string | null, envelope: string, terminal?: { seal: string; witness: GuardianCloseWitness }) {
  const current = validateGuardianCheckpointRecords(binding, records.checkpoints, records.closure), last = current.checkpoints.at(-1);
  if (current.closure) {
    requireValue(terminal && last?.envelope === envelope && same(current.closure, createGuardianClosure(binding, last!, terminal.seal, terminal.witness)));
    return current;
  }
  // An exact normal duplicate is safe, but never rebases a terminal onto an unseen commit.
  if (!terminal && current.checkpoints.some(record => record.envelope === envelope && record.previousRevision === head)) return current;
  requireValue((last?.revision ?? null) === head && current.checkpoints.length < 32);
  const next = createGuardianCheckpoint(binding, head, envelope); requireValue(!last || next.sequence > last.sequence);
  const stage = (strictJson(envelope, 12288) as any).body.stage;
  requireValue(terminal ? ['REAPED', 'CANCELLED'].includes(stage) : ['CREATING', 'CREATED', 'STARTED'].includes(stage));
  return validateGuardianCheckpointRecords(binding, [...current.checkpoints, next], terminal ? createGuardianClosure(binding, next, terminal.seal, terminal.witness) : null);
}
export function classifyGuardianCheckpoint(text: string | null, binding: GuardianBinding | null, records: { checkpoints: GuardianCheckpoint[]; closure: GuardianClosure | null }): string {
  validateGuardianCheckpointRecords(binding, records.checkpoints, records.closure);
  if (!binding || !text || (strictJson(text, 12288) as any).format !== 'bowerloom/mcp-container-journal/v1beta2') return 'unknown';
  const sequence = verifyGuardianJournal(text, binding), head = records.checkpoints.at(-1);
  if (!head) return 'unknown';
  if (sequence < head.sequence) return 'rollback';
  if (records.closure) return text === head.envelope ? 'final-snapshot-verified' : 'terminal-mismatch';
  if (sequence === head.sequence) return text === head.envelope ? 'matches-checkpoint' : 'conflict';
  return 'newer-unanchored';
}
/** Reads real host/file/store observations; no supplied digest, clock, PID claim or key. */
export async function inspectMcpGuardianCheckpoints(dependencies: { store: Pick<GuardianCheckpointStore, 'readGuardianCheckpointEvidence'>; stateRoot: string; trustedDarwinHost: true }, selected: Scope) {
  let active = true, timer: ReturnType<typeof setTimeout> | undefined; const check = () => requireValue(active);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(dependencies);
    requireValue(Reflect.ownKeys(dependencies).length === 3 && ['store', 'stateRoot', 'trustedDarwinHost'].every(k => descriptors[k] && 'value' in descriptors[k]!));
    const {store, stateRoot, trustedDarwinHost} = dependencies;
    requireValue(trustedDarwinHost === true && typeof store?.readGuardianCheckpointEvidence === 'function' && typeof stateRoot === 'string' && resolve(stateRoot) === stateRoot && stateRoot.startsWith('/') && !/[\p{Cc}\p{Cf}]/u.test(stateRoot));
    const scope = data(selected) as Scope;
    const run = async () => {
      const first = exact(await store.readGuardianCheckpointEvidence(scope), ['authority', 'binding', 'checkpoints', 'closure']) as GuardianCheckpointEvidence; check();
      const authority = validateDiscoveryAuthorityState(first.authority, scope); requireValue(authority.intent && authority.proposal.effect.kind === 'container-stdio');
      const binding = first.binding === null ? null : validateGuardianBinding(first.binding, authority);
      const records = validateGuardianCheckpointRecords(binding, first.checkpoints, first.closure);
      const boot = await readDarwinBootSession(); check(); const snapshot = await snapshotContainerJournal(stateRoot, authority.operationKey); check();
      const checkpointClassification = classifyGuardianCheckpoint(snapshot.text, binding, records);
      requireValue(same(snapshot, await snapshotContainerJournal(stateRoot, authority.operationKey))); check();
      requireValue(boot === await readDarwinBootSession()); check(); requireValue(same(first, await store.readGuardianCheckpointEvidence(scope))); check();
      requireValue(same(snapshot, await snapshotContainerJournal(stateRoot, authority.operationKey))); check();
      const body = {format:'bowerloom/mcp-guardian-provenance/v1beta2', scope, operationKey:authority.operationKey, proposalRevision:authority.proposal.revision, authorityRevision:hash(authority), bindingRevision:binding?.revision ?? null,
        journalSha256:snapshot.sha256, checkpointClassification, headRevision:records.checkpoints.at(-1)?.revision ?? null, closureRevision:records.closure?.revision ?? null,
        observedAtMs:Date.now(), bootSession:binding ? binding.descriptor.bootSessionId === boot ? 'matches' : 'differs' : 'unknown', finding:'HOLD_RECOVERY', authorityDisposition:'unchanged', currentExternalState:'unverified', processIdentity:'unproved', cleanupAuthorized:false, retryAuthorized:false, executionAuthorized:false};
      return {...body,revision:hash(body)};
    };
    return await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{active=false;reject(Error('TIMEOUT'));},15000);})]);
  } catch { return fail('MCP_GUARDIAN_CHECKPOINT_UNCERTAIN'); } finally {active=false;clearTimeout(timer);}
}
/** Private operator presentation. It collects observations itself and never accepts a supplied trusted report. */
export async function collectMcpGuardianOperatorReceipt(dependencies: Parameters<typeof inspectMcpGuardianCheckpoints>[0], scope: Scope) {
  const observation = await inspectMcpGuardianCheckpoints(dependencies, scope);
  const body = {format:'bowerloom/mcp-recovery-operator/v1beta1', observation, unresolvedReason:observation.checkpointClassification === 'final-snapshot-verified' ? 'HISTORICAL_CLOSURE_NOT_RECOVERY_AUTHORITY' : 'UNRESOLVED_LIFECYCLE', disposition:'PRESERVE_HOLD', cleanupAuthorized:false,retryAuthorized:false,executionAuthorized:false};
  return {...body,revision:hash(body)};
}
