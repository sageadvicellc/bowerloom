import { canonicalJson } from '../../contracts/src/index.js';
import { systemClock } from '../../broker/src/index.js';
import type { Scope, IdentityProvider, Principal, Clock } from '../../broker/src/types.js';
import { data, fail, McpConnectionError, planMcpConnection, sha256 } from './model.js';
import type { McpPlanInput, McpBinding } from './model.js';
import { discoverMcpCatalog } from './discovery.js';
import type { McpDiscoveryContext, McpDiscoveryTransport, McpDiscoveryResult } from './discovery.js';
import { planMcpContainerDiscoveryLaunch } from './container-policy.js';
import type { GuardianBindingStore, GuardianDescriptor, GuardianBinding } from './container-guardian-provenance.js';
import type { McpContainerPlanInput } from './container-policy.js';

export type DiscoveryEffect = {
  kind: 'stdio'; executable: { path: string; digest: string }; entrypoints: { path: string; digest: string }[];
  args: string[]; cwd: string; environment: { inherit: false; secretReferences: { environmentVariable: string; reference: string }[] };
} | { kind: 'streamable-http'; endpoint: string; authBindingRevision: string }
  | { kind: 'container-stdio'; launch: McpContainerPlanInput; launchRevision: string };
export interface DiscoveryProposalInput { scope: Scope; requestId: string; ownerEpoch: number; input: McpPlanInput; effect: DiscoveryEffect; timeoutMs: number }
export interface DiscoveryProposal extends DiscoveryProposalInput { format: 'bowerloom/mcp-discovery-proposal/v1beta1'; planRevision: string; revision: string }
export interface DiscoveryGrant { scope: Scope; ownerSubject: string; ownerEpoch: number; approverSubjects: string[]; readyAtMs: number; leaseExpiresAtMs: number; revoked: boolean }
export interface DiscoveryApproval { revision: string; expiresAtMs: number; subject: string; proofRef: string; approvedAtMs: number; ownerEpoch: number }
export interface DiscoveryIntent { operationKey: string; proposalRevision: string; ownerSubject: string; ownerEpoch: number; principalExpiresAtMs: number; startedAtMs: number; deadlineMs: number }
export type DiscoveryAuthorityStatus = 'PREPARED' | 'IN_FLIGHT' | 'COMPLETED' | 'NEEDS_RECONCILIATION' | 'CANCELLED';
export interface DiscoveryAuthorityState {
  format: 'bowerloom/mcp-discovery-authority/v1beta1'; scope: Scope; proposal: DiscoveryProposal; grant: DiscoveryGrant;
  operationKey: string; status: DiscoveryAuthorityStatus; approval: DiscoveryApproval | null; intent: DiscoveryIntent | null;
  result: McpDiscoveryResult | null; stopRequested: boolean; reason: null | 'STOP_REQUESTED' | 'SESSION_UNCERTAIN' | 'RECOVERY_UNCERTAIN';
}
export interface DiscoveryAuthorityStore {
  /** Serialize per scope, validate transitions, and durably commit before resolving. Never rerun a callback automatically. */
  transaction<T>(scope: Scope, mutate: (state: DiscoveryAuthorityState) => T): Promise<T>;
}
export interface DiscoveryAuthorityContext extends McpDiscoveryContext { effect: DiscoveryEffect; operationKey: string; scope: Scope; deadlineMs?: number; renewAuthority?: () => Promise<void>; bindGuardian?: (descriptor: GuardianDescriptor) => Promise<GuardianBinding> }
export type DiscoveryAuthorityOpen = (context: Readonly<DiscoveryAuthorityContext>) => Promise<McpDiscoveryTransport>;
const AUTHORITY_CODES = new Set(['MCP_AUTHORITY_FIELDS', 'MCP_AUTHORITY_IDENTIFIER', 'MCP_AUTHORITY_TIME', 'MCP_AUTHORITY_DIGEST',
  'MCP_AUTHORITY_TEXT', 'MCP_AUTHORITY_PATH', 'MCP_AUTHORITY_EFFECT', 'MCP_AUTHORITY_EFFECT_BINDING', 'MCP_AUTHORITY_EFFECT_BOUND',
  'MCP_AUTHORITY_EFFECT_DUPLICATE', 'MCP_AUTHORITY_PROPOSAL', 'MCP_AUTHORITY_GRANT', 'MCP_AUTHORITY_STATE', 'MCP_AUTHORITY_APPROVAL',
  'MCP_AUTHORITY_INTENT', 'MCP_AUTHORITY_RESULT', 'MCP_AUTHORITY_TRANSITION', 'MCP_AUTHORITY_CLOCK', 'MCP_AUTHORITY_IDENTITY',
  'MCP_AUTHORITY_FORBIDDEN', 'MCP_AUTHORITY_GRANT_EXPIRED', 'MCP_AUTHORITY_APPROVAL_EXPIRED', 'MCP_AUTHORITY_DEADLINE',
  'MCP_AUTHORITY_ALREADY_DISPATCHED', 'MCP_AUTHORITY_CANCELLED', 'MCP_AUTHORITY_OPEN_UNCERTAIN', 'MCP_AUTHORITY_STORE_UNCERTAIN']);
const hash = (value: unknown): string => 'sha256:' + sha256(canonicalJson(value));
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('MCP_AUTHORITY_FIELDS');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9@._:-]{0,127}$/.test(value) || ['__proto__', 'prototype', 'constructor', 'toJSON'].includes(value)) fail('MCP_AUTHORITY_IDENTIFIER');
  return value;
}
function time(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail('MCP_AUTHORITY_TIME'); return value as number;
}
function digest(value: unknown): string { if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail('MCP_AUTHORITY_DIGEST'); return value; }
function scope(value: unknown): Scope { const v = object(data(value), ['workspaceId', 'runId', 'taskId']); return { workspaceId: id(v.workspaceId), runId: id(v.runId), taskId: id(v.taskId) }; }
function text(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max || /[\p{Cc}\p{Cf}]/u.test(value)) fail('MCP_AUTHORITY_TEXT'); return value;
}
function path(value: unknown): string { const v = text(value); if (!v.startsWith('/') || v.endsWith('/') || v.includes('//') || v.includes('\\') || v.split('/').some(p => p === '.' || p === '..') || v !== v.normalize('NFC')) fail('MCP_AUTHORITY_PATH'); return v; }
function pinned(value: unknown): { path: string; digest: string } { const v = object(value, ['path', 'digest']); return { path: path(v.path), digest: digest(v.digest) }; }
function effect(value: unknown, binding: McpBinding, bindingRevision: string): DiscoveryEffect {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('MCP_AUTHORITY_EFFECT');
  const kind = (value as Record<string, unknown>).kind;
  if (kind === 'container-stdio' && binding.transport.kind === 'stdio') {
    const v = object(value, ['kind', 'launch', 'launchRevision']);
    let launchPlan;
    try { launchPlan = planMcpContainerDiscoveryLaunch(v.launch as McpContainerPlanInput); }
    catch { return fail('MCP_AUTHORITY_EFFECT'); }
    if (v.launchRevision !== launchPlan.revision || binding.transport.secretReferences.length !== 0
      || binding.transport.executable !== launchPlan.spec.entrypoint || binding.transport.workingDirectory !== launchPlan.spec.workingDirectory) fail('MCP_AUTHORITY_EFFECT_BINDING');
    return { kind, launch: data(v.launch) as McpContainerPlanInput, launchRevision: launchPlan.revision };
  }
  if (kind === 'stdio' && binding.transport.kind === 'stdio') {
    const v = object(value, ['kind', 'executable', 'entrypoints', 'args', 'cwd', 'environment']);
    const executable = pinned(v.executable), cwd = path(v.cwd), environment = object(v.environment, ['inherit', 'secretReferences']);
    if (executable.path !== binding.transport.executable || cwd !== binding.transport.workingDirectory || environment.inherit !== false
      || !same(environment.secretReferences, binding.transport.secretReferences)) fail('MCP_AUTHORITY_EFFECT_BINDING');
    if (!Array.isArray(v.entrypoints) || v.entrypoints.length > 16 || !Array.isArray(v.args) || v.args.length > 32) fail('MCP_AUTHORITY_EFFECT_BOUND');
    const entrypoints = v.entrypoints.map(pinned), args = v.args.map(value => text(value));
    if (new Set(entrypoints.map(item => item.path)).size !== entrypoints.length) fail('MCP_AUTHORITY_EFFECT_DUPLICATE');
    return { kind, executable, entrypoints, args, cwd, environment: { inherit: false, secretReferences: data(environment.secretReferences) as Extract<McpBinding['transport'], { kind: 'stdio' }>['secretReferences'] } };
  }
  if (kind === 'streamable-http' && binding.transport.kind === 'streamable-http') {
    const v = object(value, ['kind', 'endpoint', 'authBindingRevision']);
    if (v.endpoint !== binding.transport.endpoint || v.authBindingRevision !== bindingRevision) fail('MCP_AUTHORITY_EFFECT_BINDING');
    return { kind, endpoint: binding.transport.endpoint, authBindingRevision: bindingRevision };
  }
  return fail('MCP_AUTHORITY_EFFECT');
}
export function createDiscoveryProposal(value: DiscoveryProposalInput): DiscoveryProposal {
  const v = object(data(value), ['scope', 'requestId', 'ownerEpoch', 'input', 'effect', 'timeoutMs']);
  const input = v.input as McpPlanInput, plan = planMcpConnection(input);
  const body = { format: 'bowerloom/mcp-discovery-proposal/v1beta1' as const, scope: scope(v.scope), requestId: id(v.requestId), ownerEpoch: time(v.ownerEpoch, 1),
    input, effect: effect(v.effect, plan.binding, plan.bindingRevision), timeoutMs: time(v.timeoutMs, 1, 30000), planRevision: plan.revision };
  return { ...body, revision: hash(body) };
}
function proposal(value: unknown): DiscoveryProposal {
  const v = object(value, ['format', 'scope', 'requestId', 'ownerEpoch', 'input', 'effect', 'timeoutMs', 'planRevision', 'revision']);
  const { format, revision, planRevision, ...input } = v;
  const expected = createDiscoveryProposal(input as unknown as DiscoveryProposalInput);
  if (!same(expected, v)) fail('MCP_AUTHORITY_PROPOSAL'); return expected;
}
function grant(value: unknown): DiscoveryGrant {
  const v = object(value, ['scope', 'ownerSubject', 'ownerEpoch', 'approverSubjects', 'readyAtMs', 'leaseExpiresAtMs', 'revoked']);
  if (!Array.isArray(v.approverSubjects) || !v.approverSubjects.length || v.approverSubjects.length > 16 || typeof v.revoked !== 'boolean') fail('MCP_AUTHORITY_GRANT');
  const approverSubjects = v.approverSubjects.map(id), readyAtMs = time(v.readyAtMs), leaseExpiresAtMs = time(v.leaseExpiresAtMs);
  if (new Set(approverSubjects).size !== approverSubjects.length || leaseExpiresAtMs <= readyAtMs) fail('MCP_AUTHORITY_GRANT');
  return { scope: scope(v.scope), ownerSubject: id(v.ownerSubject), ownerEpoch: time(v.ownerEpoch, 1), approverSubjects, readyAtMs, leaseExpiresAtMs, revoked: v.revoked };
}
const operationKey = (p: DiscoveryProposal) => hash({ scope: p.scope, requestId: p.requestId, proposalRevision: p.revision });
export function createDiscoveryAuthorityState(value: DiscoveryProposal, configuration: DiscoveryGrant): DiscoveryAuthorityState {
  const p = proposal(data(value)), g = grant(data(configuration));
  if (!same(p.scope, g.scope) || p.ownerEpoch !== g.ownerEpoch || g.revoked) fail('MCP_AUTHORITY_GRANT');
  return { format: 'bowerloom/mcp-discovery-authority/v1beta1', scope: p.scope, proposal: p, grant: g, operationKey: operationKey(p),
    status: 'PREPARED', approval: null, intent: null, result: null, stopRequested: false, reason: null };
}
export function validateDiscoveryAuthorityState(value: unknown, expectedScope?: Scope): DiscoveryAuthorityState {
  const v = object(data(value), ['format', 'scope', 'proposal', 'grant', 'operationKey', 'status', 'approval', 'intent', 'result', 'stopRequested', 'reason']);
  const p = proposal(v.proposal), g = grant(v.grant), s = scope(v.scope);
  if (v.format !== 'bowerloom/mcp-discovery-authority/v1beta1' || !same(s, p.scope) || !same(s, g.scope)
    || (expectedScope && !same(s, scope(expectedScope))) || v.operationKey !== operationKey(p) || g.ownerEpoch < p.ownerEpoch
    || !['PREPARED', 'IN_FLIGHT', 'COMPLETED', 'NEEDS_RECONCILIATION', 'CANCELLED'].includes(v.status as string)
    || typeof v.stopRequested !== 'boolean' || ![null, 'STOP_REQUESTED', 'SESSION_UNCERTAIN', 'RECOVERY_UNCERTAIN'].includes(v.reason as null | string)) fail('MCP_AUTHORITY_STATE');
  let approval: DiscoveryApproval | null = null, intent: DiscoveryIntent | null = null;
  if (v.approval !== null) {
    const a = object(v.approval, ['revision', 'expiresAtMs', 'subject', 'proofRef', 'approvedAtMs', 'ownerEpoch']);
    approval = { revision: digest(a.revision), expiresAtMs: time(a.expiresAtMs), subject: id(a.subject), proofRef: text(a.proofRef, 256), approvedAtMs: time(a.approvedAtMs), ownerEpoch: time(a.ownerEpoch, 1) };
    if (!approval.proofRef || approval.revision !== p.revision || approval.ownerEpoch !== p.ownerEpoch || approval.expiresAtMs <= approval.approvedAtMs) fail('MCP_AUTHORITY_APPROVAL');
  }
  if (v.intent !== null) {
    const i = object(v.intent, ['operationKey', 'proposalRevision', 'ownerSubject', 'ownerEpoch', 'principalExpiresAtMs', 'startedAtMs', 'deadlineMs']);
    intent = { operationKey: digest(i.operationKey), proposalRevision: digest(i.proposalRevision), ownerSubject: id(i.ownerSubject), ownerEpoch: time(i.ownerEpoch, 1),
      principalExpiresAtMs: time(i.principalExpiresAtMs), startedAtMs: time(i.startedAtMs), deadlineMs: time(i.deadlineMs) };
    if (!approval || intent.operationKey !== v.operationKey || intent.proposalRevision !== p.revision || intent.ownerEpoch !== p.ownerEpoch
      || intent.startedAtMs < approval.approvedAtMs || intent.deadlineMs <= intent.startedAtMs || intent.deadlineMs > intent.startedAtMs + p.timeoutMs
      || intent.deadlineMs > approval.expiresAtMs || intent.deadlineMs > intent.principalExpiresAtMs) fail('MCP_AUTHORITY_INTENT');
  }
  let result: McpDiscoveryResult | null = null;
  if (v.result !== null) {
    const r = object(v.result, ['format', 'contentScope', 'planRevision', 'bindingRevision', 'catalogRevision', 'protocolVersion', 'serverIdentity', 'transport', 'observedToolCount', 'pageCount', 'catalogMatched', 'discoveryEvidence', 'authenticatedServerIdentity', 'authenticationVerified', 'runtimePortabilityVerified', 'toolCalls', 'executionAuthorized', 'grants', 'cleanup']);
    const plan = planMcpConnection(p.input);
    if (r.format !== 'bowerloom/mcp-discovery-result/v1beta1' || r.contentScope !== 'private-local-result' || r.planRevision !== p.planRevision
      || r.bindingRevision !== plan.bindingRevision || r.catalogRevision !== plan.catalogRevision || r.protocolVersion !== plan.binding.protocolVersion
      || !same(r.serverIdentity, plan.binding.serverIdentity) || r.transport !== plan.binding.transport.kind || r.observedToolCount !== plan.catalogTools.length
      || !Number.isInteger(r.pageCount) || (r.pageCount as number) < 1 || (r.pageCount as number) > 8 || r.catalogMatched !== true
      || r.discoveryEvidence !== 'trusted-adapter-session' || r.authenticatedServerIdentity !== false || r.authenticationVerified !== false
      || r.runtimePortabilityVerified !== false || r.toolCalls !== 0 || r.executionAuthorized !== false || !same(r.grants, []) || r.cleanup !== 'closed') fail('MCP_AUTHORITY_RESULT');
    result = r as unknown as McpDiscoveryResult;
  }
  if (v.status === 'PREPARED' && (intent || result || v.stopRequested || v.reason !== null)) fail('MCP_AUTHORITY_STATE');
  if (v.status === 'IN_FLIGHT' && (!intent || result || v.stopRequested || v.reason !== null)) fail('MCP_AUTHORITY_STATE');
  if (v.status === 'COMPLETED' && (!intent || !result || v.reason !== null)) fail('MCP_AUTHORITY_STATE');
  if (v.status === 'NEEDS_RECONCILIATION' && (!intent || result || v.reason === null)) fail('MCP_AUTHORITY_STATE');
  if (v.status === 'CANCELLED' && (intent || result || !v.stopRequested || v.reason !== 'STOP_REQUESTED')) fail('MCP_AUTHORITY_STATE');
  return { format: 'bowerloom/mcp-discovery-authority/v1beta1', scope: s, proposal: p, grant: g, operationKey: v.operationKey as string,
    status: v.status as DiscoveryAuthorityStatus, approval, intent, result, stopRequested: v.stopRequested, reason: v.reason as DiscoveryAuthorityState['reason'] };
}
export function validateDiscoveryAuthorityTransition(beforeInput: unknown, afterInput: unknown): void {
  const before = validateDiscoveryAuthorityState(beforeInput), after = validateDiscoveryAuthorityState(afterInput, before.scope);
  if (!same(before.proposal, after.proposal) || before.operationKey !== after.operationKey || after.grant.ownerEpoch < before.grant.ownerEpoch
    || (before.grant.revoked && !after.grant.revoked) || (before.stopRequested && !after.stopRequested)) fail('MCP_AUTHORITY_TRANSITION');
  const { revoked: _br, ...oldGrant } = before.grant, { revoked: _ar, ...newGrant } = after.grant;
  if (after.grant.ownerEpoch === before.grant.ownerEpoch && !same(oldGrant, newGrant)) fail('MCP_AUTHORITY_TRANSITION');
  if (before.intent && (!same(before.intent, after.intent) || !same(before.approval, after.approval))) fail('MCP_AUTHORITY_TRANSITION');
  const transitions = { PREPARED: ['PREPARED', 'IN_FLIGHT', 'CANCELLED'], IN_FLIGHT: ['IN_FLIGHT', 'COMPLETED', 'NEEDS_RECONCILIATION'], COMPLETED: ['COMPLETED'], NEEDS_RECONCILIATION: ['NEEDS_RECONCILIATION'], CANCELLED: ['CANCELLED'] };
  if (!transitions[before.status].includes(after.status) || (before.result && !same(before.result, after.result))
    || (before.status === 'COMPLETED' && after.reason !== null) || (before.reason && before.reason !== after.reason)) fail('MCP_AUTHORITY_TRANSITION');
}
const frozen = <T>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); } return value; };

export class DiscoveryAuthorityController {
  readonly #store: DiscoveryAuthorityStore; readonly #identity: IdentityProvider; readonly #open: DiscoveryAuthorityOpen; readonly #clock: Clock;
  readonly #active = new Map<string, AbortController>();
  constructor(dependencies: { store: DiscoveryAuthorityStore; identity: IdentityProvider; open: DiscoveryAuthorityOpen; clock?: Clock }) {
    this.#store = dependencies.store; this.#identity = dependencies.identity; this.#open = dependencies.open; this.#clock = dependencies.clock ?? systemClock;
  }
  #now(): number { try { return time(this.#clock.now()); } catch { return fail('MCP_AUTHORITY_CLOCK'); } }
  async #principal(credential: unknown): Promise<Principal> {
    try {
      const p = object(data(await this.#identity.authenticate(credential)), ['subject', 'proofRef', 'expiresAtMs']);
      const principal = { subject: id(p.subject), proofRef: text(p.proofRef, 256), expiresAtMs: time(p.expiresAtMs) };
      if (!principal.proofRef || principal.expiresAtMs <= this.#now()) fail('MCP_AUTHORITY_IDENTITY'); return principal;
    } catch { return fail('MCP_AUTHORITY_IDENTITY'); }
  }
  async #transaction<T>(selected: Scope, mutate: (state: DiscoveryAuthorityState) => T): Promise<T> {
    try {
      return await this.#store.transaction(selected, raw => {
        const before = validateDiscoveryAuthorityState(raw, selected), state = validateDiscoveryAuthorityState(raw, selected);
        const result = mutate(state); validateDiscoveryAuthorityTransition(before, state); Object.assign(raw, state); return data(result) as T;
      });
    } catch (error) {
      if (error instanceof McpConnectionError && AUTHORITY_CODES.has(error.code)) throw new McpConnectionError(error.code);
      return fail('MCP_AUTHORITY_STORE_UNCERTAIN');
    }
  }
  #reader(state: DiscoveryAuthorityState, p: Principal): void {
    if (p.expiresAtMs <= this.#now() || (p.subject !== state.grant.ownerSubject && !state.grant.approverSubjects.includes(p.subject))) fail('MCP_AUTHORITY_FORBIDDEN');
  }
  #live(state: DiscoveryAuthorityState, p: Principal): void {
    const now = this.#now();
    if (p.subject !== state.grant.ownerSubject || p.expiresAtMs <= now) fail('MCP_AUTHORITY_FORBIDDEN');
    if (state.stopRequested || state.grant.revoked || state.grant.ownerEpoch !== state.proposal.ownerEpoch || now < state.grant.readyAtMs || now >= state.grant.leaseExpiresAtMs) fail('MCP_AUTHORITY_GRANT_EXPIRED');
    if (!state.approval || state.approval.revision !== state.proposal.revision || state.approval.expiresAtMs <= now
      || !state.grant.approverSubjects.includes(state.approval.subject) || state.approval.ownerEpoch !== state.grant.ownerEpoch) fail('MCP_AUTHORITY_APPROVAL_EXPIRED');
    if (state.intent && (state.intent.deadlineMs <= now || state.intent.ownerSubject !== p.subject || state.intent.principalExpiresAtMs <= now)) fail('MCP_AUTHORITY_DEADLINE');
  }
  async inspect(selected: Scope, credential: unknown): Promise<DiscoveryAuthorityState> {
    const s = scope(selected), p = await this.#principal(credential); return this.#transaction(s, state => { this.#reader(state, p); return state; });
  }
  async approve(selected: Scope, request: { revision: string; expiresAtMs: number }, credential: unknown): Promise<DiscoveryAuthorityState> {
    const s = scope(selected), r = object(data(request), ['revision', 'expiresAtMs']), revision = digest(r.revision), expiresAtMs = time(r.expiresAtMs), p = await this.#principal(credential);
    return this.#transaction(s, state => {
      const now = this.#now();
      if (!state.grant.approverSubjects.includes(p.subject) || p.expiresAtMs <= now) fail('MCP_AUTHORITY_FORBIDDEN');
      if (state.status !== 'PREPARED' || state.stopRequested || state.grant.revoked || state.grant.ownerEpoch !== state.proposal.ownerEpoch || now < state.grant.readyAtMs || now >= state.grant.leaseExpiresAtMs) fail('MCP_AUTHORITY_STATE');
      if (revision !== state.proposal.revision || expiresAtMs <= now || expiresAtMs > Math.min(p.expiresAtMs, state.grant.leaseExpiresAtMs, now + 900000)) fail('MCP_AUTHORITY_APPROVAL');
      state.approval = { revision, expiresAtMs, subject: p.subject, proofRef: p.proofRef, approvedAtMs: now, ownerEpoch: state.grant.ownerEpoch }; return state;
    });
  }
  async stop(selected: Scope, credential: unknown): Promise<DiscoveryAuthorityState> {
    const s = scope(selected), p = await this.#principal(credential); let activeKey: string | undefined;
    try {
      return await this.#transaction(s, state => {
        this.#reader(state, p); activeKey = state.operationKey; state.stopRequested = true;
        if (state.status === 'PREPARED') { state.status = 'CANCELLED'; state.reason = 'STOP_REQUESTED'; }
        if (state.status === 'IN_FLIGHT') { state.status = 'NEEDS_RECONCILIATION'; state.reason = 'STOP_REQUESTED'; }
        return state;
      });
    } finally { if (activeKey) this.#active.get(activeKey)?.abort(); }
  }
  async recover(selected: Scope, credential: unknown): Promise<DiscoveryAuthorityState> {
    const s = scope(selected), p = await this.#principal(credential); let activeKey: string | undefined;
    try {
      return await this.#transaction(s, state => {
        this.#reader(state, p); activeKey = state.operationKey;
        if (state.status === 'IN_FLIGHT') { state.status = 'NEEDS_RECONCILIATION'; state.reason = 'RECOVERY_UNCERTAIN'; } return state;
      });
    } finally { if (activeKey) this.#active.get(activeKey)?.abort(); }
  }
  async dispatch(selected: Scope, credential: unknown): Promise<DiscoveryAuthorityState> {
    const s = scope(selected), p = await this.#principal(credential);
    const intent = await this.#transaction(s, state => {
      this.#reader(state, p); if (state.status === 'COMPLETED') return state;
      this.#live(state, p); if (state.status !== 'PREPARED') fail('MCP_AUTHORITY_ALREADY_DISPATCHED');
      const now = this.#now(), deadlineMs = Math.min(now + state.proposal.timeoutMs, state.grant.leaseExpiresAtMs, state.approval!.expiresAtMs, p.expiresAtMs);
      if (deadlineMs <= now) fail('MCP_AUTHORITY_DEADLINE');
      state.intent = { operationKey: state.operationKey, proposalRevision: state.proposal.revision, ownerSubject: p.subject, ownerEpoch: state.grant.ownerEpoch,
        principalExpiresAtMs: p.expiresAtMs, startedAtMs: now, deadlineMs };
      state.status = 'IN_FLIGHT'; return state;
    });
    if (intent.status === 'COMPLETED') return intent;
    const controller = new AbortController(); this.#active.set(intent.operationKey, controller);
    let cancelAlarm: (() => void) | undefined;
    try {
      cancelAlarm = this.#clock.alarm(intent.intent!.deadlineMs, () => controller.abort());
      const result = await discoverMcpCatalog(intent.proposal.input, { approve: intent.proposal.planRevision, timeoutMs: Math.max(1, Math.min(30000, intent.intent!.deadlineMs - this.#now())), signal: controller.signal, ...(intent.proposal.effect.kind === 'container-stdio' ? { cleanupTimeoutMs: 10000 } : {}),
        open: async context => {
          let opening: Promise<McpDiscoveryTransport> | undefined;
          try {
            await this.#transaction(s, state => {
              this.#live(state, p);
              if (state.status !== 'IN_FLIGHT' || !same(state.intent, intent.intent) || controller.signal.aborted || context.signal.aborted) fail('MCP_AUTHORITY_CANCELLED');
              // The durable intent already committed. Invoke only while this final authorization row lock is held.
              opening = Promise.resolve(this.#open(Object.freeze({ ...context, effect: frozen(data(state.proposal.effect) as DiscoveryEffect), operationKey: state.operationKey, scope: frozen(scope(state.scope)),
                ...(state.proposal.effect.kind === 'container-stdio' ? { deadlineMs: state.intent!.deadlineMs, bindGuardian: async (descriptor: GuardianDescriptor) => {
                  const store = this.#store as DiscoveryAuthorityStore & Partial<GuardianBindingStore>;
                  if (typeof store.bindContainerGuardian !== 'function') fail('MCP_AUTHORITY_STORE_UNCERTAIN');
                  return store.bindContainerGuardian(intent, descriptor, current => {
                    this.#live(current, p);
                    if (current.status !== 'IN_FLIGHT' || !same(current.intent, intent.intent) || controller.signal.aborted || context.signal.aborted) fail('MCP_AUTHORITY_CANCELLED');
                  });
                }, renewAuthority: async () => {
                  // No cached authority: acknowledge only a fresh, committed durable check.
                  await this.#transaction(s, current => {
                    this.#live(current, p);
                    if (current.status !== 'IN_FLIGHT' || !same(current.intent, intent.intent) || controller.signal.aborted || context.signal.aborted) fail('MCP_AUTHORITY_CANCELLED');
                    return null;
                  });
                  if (controller.signal.aborted || context.signal.aborted) fail('MCP_AUTHORITY_CANCELLED');
                } } : {}) })));
              // Observe rejection before awaiting the store commit acknowledgement.
              // Keep the original promise so dispatch still receives the failure.
              void opening.catch(() => undefined);
              return null;
            });
            if (!opening) fail('MCP_AUTHORITY_CANCELLED');
            return await opening;
          } catch {
            if (opening) void opening.then(value => value.close()).catch(() => undefined);
            return fail('MCP_AUTHORITY_OPEN_UNCERTAIN');
          }
        } });
      return await this.#transaction(s, state => {
        this.#live(state, p);
        if (state.status !== 'IN_FLIGHT' || !same(state.intent, intent.intent) || controller.signal.aborted) fail('MCP_AUTHORITY_CANCELLED');
        state.status = 'COMPLETED'; state.result = result; return state;
      });
    } catch {
      // No outcome supplied by a caller can turn an uncertain session into completion.
      await this.#transaction(s, state => {
        if (state.status === 'IN_FLIGHT' && same(state.intent, intent.intent)) { state.status = 'NEEDS_RECONCILIATION'; state.reason = 'SESSION_UNCERTAIN'; }
        return state;
      }).catch(() => undefined);
      return fail('MCP_AUTHORITY_DISPATCH_UNCERTAIN');
    } finally { cancelAlarm?.(); this.#active.delete(intent.operationKey); }
  }
}
