import { createPublicKey, verify } from 'node:crypto';
import { resolve } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import type { Scope } from '../../broker/src/types.js';
import { planMcpContainerDiscoveryLaunch } from './container-policy.js';
import { validateDiscoveryAuthorityState } from './authority.js';
import type { DiscoveryAuthorityState, DiscoveryIntent } from './authority.js';
import { data, fail, sha256 } from './model.js';
import { readDarwinBootSession, validBootSession } from './darwin-boot-session.js';
import { snapshotContainerJournal } from './container-journal-snapshot.js';
export interface GuardianDescriptor { guardianPid: number; bootSessionId: string; guardianSessionId: string; publicKey: string }
export interface GuardianBinding {
  format: 'bowerloom/mcp-guardian-binding/v1beta1'; scope: Scope; operationKey: string; proposalRevision: string;
  intent: DiscoveryIntent; launchOperationKey: string; launchRevision: string; descriptor: GuardianDescriptor; revision: string;
}
export interface GuardianEvidence { authority: DiscoveryAuthorityState; binding: GuardianBinding | null }
export interface GuardianBindingStore {
  bindContainerGuardian(expected: DiscoveryAuthorityState, descriptor: GuardianDescriptor, assertLive: (state: DiscoveryAuthorityState) => void): Promise<GuardianBinding>;
  readGuardianEvidence(scope: Scope): Promise<GuardianEvidence>;
}
const hash = (v: unknown) => 'sha256:' + sha256(canonicalJson(v));
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function requireValue(v: unknown): asserts v { if (!v) fail('MCP_GUARDIAN_PROVENANCE_INVALID'); }
function exact(v: unknown, keys: string[]): Record<string, unknown> { requireValue(v && typeof v === 'object' && !Array.isArray(v)); const r = v as Record<string, unknown>; requireValue(Object.keys(r).length === keys.length && keys.every(k => Object.hasOwn(r, k))); return r; }
export function validateGuardianDescriptor(value: unknown): GuardianDescriptor {
  const v = exact(data(value), ['guardianPid', 'bootSessionId', 'guardianSessionId', 'publicKey']);
  requireValue(Number.isSafeInteger(v.guardianPid) && (v.guardianPid as number) > 0 && (v.guardianPid as number) <= 2147483647
    && validBootSession(v.bootSessionId) && typeof v.guardianSessionId === 'string' && /^[a-f0-9]{64}$/.test(v.guardianSessionId)
    && typeof v.publicKey === 'string' && v.publicKey.length === 60);
  const bytes = Buffer.from(v.publicKey, 'base64'); requireValue(bytes.length === 44 && bytes.toString('base64') === v.publicKey);
  const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' }); requireValue(key.asymmetricKeyType === 'ed25519' && key.export({ format: 'der', type: 'spki' }).equals(bytes));
  return v as unknown as GuardianDescriptor;
}
export function createGuardianBinding(expected: DiscoveryAuthorityState, supplied: GuardianDescriptor): GuardianBinding {
  const state = validateDiscoveryAuthorityState(expected); requireValue(state.intent && state.proposal.effect.kind === 'container-stdio');
  const body = { format: 'bowerloom/mcp-guardian-binding/v1beta1' as const, scope: state.scope, operationKey: state.operationKey, proposalRevision: state.proposal.revision,
    intent: state.intent, launchOperationKey: planMcpContainerDiscoveryLaunch(state.proposal.effect.launch).spec.operationKey, launchRevision: state.proposal.effect.launchRevision, descriptor: validateGuardianDescriptor(supplied) };
  return { ...body, revision: hash(body) };
}
export function validateGuardianBinding(value: unknown, state: DiscoveryAuthorityState): GuardianBinding {
  const v = exact(data(value), ['format', 'scope', 'operationKey', 'proposalRevision', 'intent', 'launchOperationKey', 'launchRevision', 'descriptor', 'revision']);
  requireValue(Buffer.byteLength(canonicalJson(v)) <= 4096);
  const expected = createGuardianBinding(state, v.descriptor as GuardianDescriptor); requireValue(same(v, expected)); return expected;
}
export const guardianSignaturePayload = (value: unknown): Buffer => Buffer.from('bowerloom/guardian-journal-signature/v1\n' + canonicalJson(value));
function envelope(text: string): Record<string, unknown> {
  const v = exact(data(strictJson(text, 12288)), ['format', 'bindingRevision', 'sequence', 'body', 'signature']);
  requireValue(text === canonicalJson(v) && v.format === 'bowerloom/mcp-container-journal/v1beta2' && typeof v.bindingRevision === 'string' && /^sha256:[a-f0-9]{64}$/.test(v.bindingRevision)
    && Number.isSafeInteger(v.sequence) && (v.sequence as number) > 0 && typeof v.signature === 'string' && v.signature.length === 88);
  const bytes = Buffer.from(v.signature, 'base64'); requireValue(bytes.length === 64 && bytes.toString('base64') === v.signature);
  requireValue(Buffer.byteLength(canonicalJson(v.body)) <= 8192); return v;
}
/** Legacy normalization never upgrades origin. A syntactically signed envelope is not a verified signature. */
export function guardianJournalBody(text: string): unknown {
  const v = data(strictJson(text, 12288)) as Record<string, unknown>;
  if (v.format === 'bowerloom/mcp-container-journal/v1beta2') return envelope(text).body;
  requireValue(Buffer.byteLength(text) <= 8192 && canonicalJson(v) === text); return v;
}
export function verifyGuardianJournal(text: string, binding: GuardianBinding): number {
  const v = envelope(text), { signature, ...payload } = v;
  requireValue(v.bindingRevision === binding.revision);
  const key = createPublicKey({ key: Buffer.from(binding.descriptor.publicKey, 'base64'), format: 'der', type: 'spki' });
  requireValue(verify(null, guardianSignaturePayload(payload), key, Buffer.from(signature as string, 'base64')));
  const body = exact(v.body, ['format', 'operationKey', 'launchOperationKey', 'launchRevision', 'name', 'cid', 'stage', 'deadlineMs', 'guardianPid', 'attachPid', 'reason', 'lease']);
  requireValue(body && body.format === 'bowerloom/mcp-container-journal/v1beta1' && body.operationKey === binding.operationKey && body.launchRevision === binding.launchRevision
    && body.launchOperationKey === binding.launchOperationKey && body.name === 'bowerloom-mcp-' + binding.launchOperationKey.slice(7) && body.guardianPid === binding.descriptor.guardianPid && Number.isSafeInteger(body.deadlineMs) && (body.deadlineMs as number) > binding.intent.startedAtMs && (body.deadlineMs as number) <= binding.intent.deadlineMs);
  requireValue(body.cid === null || typeof body.cid === 'string' && /^[a-f0-9]{64}$/.test(body.cid));
  requireValue(body.attachPid === null || Number.isSafeInteger(body.attachPid) && (body.attachPid as number) > 0 && (body.attachPid as number) <= 2147483647);
  requireValue(['PREPARED', 'CREATING', 'CREATED', 'STARTED', 'REAPED', 'CANCELLED', 'UNCERTAIN'].includes(body.stage as string)
    && (body.reason === null || typeof body.reason === 'string' && /^[A-Z_]{1,64}$/.test(body.reason)));
  requireValue(!(['CREATED', 'STARTED', 'REAPED'].includes(body.stage as string) && body.cid === null)
    && !(['PREPARED', 'CREATING', 'CANCELLED'].includes(body.stage as string) && body.cid !== null) && !(body.stage === 'STARTED' && body.attachPid === null));
  const lease = exact(body.lease, ['sequence', 'lastRenewedAtMs', 'expiresMonotonicMs', 'stopRequestedAtMs', 'containerAbsentAtMs', 'attachReapedAtMs']);
  requireValue(Number.isSafeInteger(lease.sequence) && (lease.sequence as number) > 0 && typeof lease.expiresMonotonicMs === 'number' && Number.isFinite(lease.expiresMonotonicMs) && lease.expiresMonotonicMs > 0 && lease.lastRenewedAtMs !== null);
  for (const key of ['lastRenewedAtMs', 'stopRequestedAtMs', 'containerAbsentAtMs', 'attachReapedAtMs']) requireValue(lease[key] === null || Number.isSafeInteger(lease[key]) && (lease[key] as number) > 0);
  return v.sequence as number;
}
/** Fresh read-only inspection. Signatures establish historical origin, never freshness or PID identity. */
export async function inspectMcpGuardianProvenance(dependencies: { store: Pick<GuardianBindingStore, 'readGuardianEvidence'>; stateRoot: string; trustedDarwinHost: true }, selected: Scope) {
  let active = true, timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => requireValue(active);
  try {
    const desc = Object.getOwnPropertyDescriptors(dependencies);
    requireValue(Reflect.ownKeys(dependencies).length === 3 && ['store', 'stateRoot', 'trustedDarwinHost'].every(k => desc[k] && 'value' in desc[k]!));
    const { store, stateRoot, trustedDarwinHost } = dependencies;
    requireValue(trustedDarwinHost === true && typeof store?.readGuardianEvidence === 'function' && typeof stateRoot === 'string' && stateRoot.startsWith('/') && resolve(stateRoot) === stateRoot && !/[\p{Cc}\p{Cf}]/u.test(stateRoot));
    const scope = data(selected) as Scope;
    const run = async () => {
      const first = exact(data(await store.readGuardianEvidence(scope)), ['authority', 'binding']) as unknown as GuardianEvidence; check();
      const authority = validateDiscoveryAuthorityState(first.authority, scope); requireValue(authority.intent && authority.proposal.effect.kind === 'container-stdio');
      const binding = first.binding === null ? null : validateGuardianBinding(first.binding, authority);
      const boot = await readDarwinBootSession(); check();
      const snapshot = await snapshotContainerJournal(stateRoot, authority.operationKey); check();
      let signature: 'verified-historical' | 'legacy-or-unavailable' = 'legacy-or-unavailable', sequence: number | null = null;
      if (snapshot.text !== null && (data(strictJson(snapshot.text, 12288)) as Record<string, unknown>).format === 'bowerloom/mcp-container-journal/v1beta2') {
        if (binding) { sequence = verifyGuardianJournal(snapshot.text, binding); signature = 'verified-historical'; }
      }
      requireValue(same(snapshot, await snapshotContainerJournal(stateRoot, authority.operationKey))); check();
      requireValue(boot === await readDarwinBootSession()); check();
      requireValue(same(first, await store.readGuardianEvidence(scope))); check();
      requireValue(same(snapshot, await snapshotContainerJournal(stateRoot, authority.operationKey))); check();
      const body = { format: 'bowerloom/mcp-guardian-provenance/v1beta1', operationKey: authority.operationKey, authorityRevision: hash(authority), bindingRevision: binding?.revision ?? null,
        journalSha256: snapshot.sha256, signature, snapshotSequence: sequence, bootSession: binding ? binding.descriptor.bootSessionId === boot ? 'matches' : 'differs' : 'unknown',
        snapshotFreshness: 'unproved', processIdentity: 'unproved', finding: 'HOLD_RECOVERY', authorityDisposition: 'unchanged', localUserTrustRequired: true,
        cleanupAuthorized: false, retryAuthorized: false, executionAuthorized: false, hostRestartSafetyVerified: false };
      return { ...body, revision: hash(body) };
    };
    return await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => { active = false; reject(Error('TIMEOUT')); }, 15000); })]);
  } catch { return fail('MCP_GUARDIAN_PROVENANCE_UNCERTAIN'); } finally { active = false; clearTimeout(timer); }
}
