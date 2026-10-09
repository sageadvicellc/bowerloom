import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { canonicalJson } from '../../contracts/src/index.js';
import type { CompiledPlan } from '../../contracts/src/index.js';
import { compileCrew } from '../../crew/src/index.js';
import { scaffold, TEAM_PATH, TEMPLATE_VERSION } from './scaffold.js';
import { scaffold as legacyScaffold, TEMPLATE_VERSION as LEGACY_TEMPLATE_VERSION } from './scaffold-v1alpha1.js';
import { scaffold as alpha2Scaffold, TEMPLATE_VERSION as ALPHA2_TEMPLATE_VERSION } from './scaffold-v1alpha2.js';
import { scaffold as beta1Scaffold, TEMPLATE_VERSION as BETA1_TEMPLATE_VERSION } from './scaffold-v1beta1.js';
import { scaffold as beta2Scaffold, TEMPLATE_VERSION as BETA2_TEMPLATE_VERSION } from './scaffold-v1beta2.js';
import { scaffold as beta3Scaffold, TEMPLATE_VERSION as BETA3_TEMPLATE_VERSION } from './scaffold-v1beta3.js';
import { startupProfiles } from './profiles.js';
import { INSTALLATION_IDENTITY_POLICY, parseInstallationIdentityPolicy, canonicalBirthtimeNs, comparePersistentIdentity, snapshotPersistentIdentity } from './identity-policy.js';
import type { InstallationIdentityPolicy, PersistentIdentityComparison } from './identity-policy.js';
import { classifyStartupIdentityDiagnostic } from './identity-diagnostic.js';
import type { StartupIdentityDiagnostic } from './identity-diagnostic.js';
import type { StartupProfile } from './profiles.js';
import { askOwners, validOwners } from './owners.js';
import type { OwnedEntryKind, OwnerName, OwnerVerifier } from '../../project-context/src/types.js';
export { startupProfiles } from './profiles.js';
export type { StartupProfile } from './profiles.js';
import type { GeneratedFile, NormalizedBrief, StartupBrief } from './scaffold.js';
export type { StartupBrief, GeneratedFile } from './scaffold.js';
export const STARTUP_FORMAT = 'bowerloom/startup-plan/v1alpha1' as const;
export interface StartupInput { mode: 'new' | 'existing'; targetDir: string; brief: StartupBrief }
interface NormalizedInput { mode: 'new' | 'existing'; targetDir: string; brief: NormalizedBrief }
export interface DirectoryIdentity { device: string; inode: string; birthtimeNs: string; uid: number; mode: number }
export const STARTUP_V2_FORMAT = 'bowerloom/startup-plan/v1beta2' as const;
interface StartupPlanBody {
  templateVersion: string; input: NormalizedInput;
  binding: { parent: DirectoryIdentity; target: DirectoryIdentity | null };
  files: GeneratedFile[]; compiled: CompiledPlan;
  specReady: true; runtimeReady: false; executionAuthorized: false; reviewRequired: true; revision: string;
}
export interface LegacyStartupPlan extends StartupPlanBody { format: typeof STARTUP_FORMAT }
export interface StartupContinuity {
  predecessorReceiptSha256: string; predecessorPolicy: InstallationIdentityPolicy;
  predecessorPlanRevision: string; retainedTargetBaseline: DirectoryIdentity;
}
export interface V2StartupPlan extends StartupPlanBody {
  format: typeof STARTUP_V2_FORMAT; purpose: 'first-install' | 'revision';
  installationIdentityPolicy: InstallationIdentityPolicy; continuity: StartupContinuity | null;
}
export type StartupPlan = LegacyStartupPlan | V2StartupPlan;
interface ReceiptBody {
  installedTargetIdentity: DirectoryIdentity; installedBowerloomIdentity: DirectoryIdentity;
  specReady: true; runtimeReady: false; executionAuthorized: false; reviewRequired: true;
}
export interface LegacyStartupReceipt extends ReceiptBody { format: 'bowerloom/startup-receipt/v1alpha1'; plan: LegacyStartupPlan }
export interface V2StartupReceipt extends ReceiptBody {
  format: 'bowerloom/startup-receipt/v1beta2'; plan: V2StartupPlan;
  derivedBirthtimeNs: { target: string; bowerloom: string };
}
export type StartupReceipt = LegacyStartupReceipt | V2StartupReceipt;
/** `owner-refused` (with its `code`) appears only when `inspectStartup` was given owners. */
export interface Drift { path: string; kind: 'missing' | 'changed' | 'unsafe' | 'unexpected' | 'invalid-receipt' | 'installation-binding-changed' | 'compiler-failed' | 'revision-pending' | 'owner-refused'; code?: string }
/** An entry a registered owner verified. `edited` is authored content a person or agent changed; it is not drift. */
export interface OwnedEntry { path: string; owner: OwnerName; state: 'verified' | 'edited' }
export interface InspectStartupOptions { owners?: readonly OwnerVerifier[] }
export interface StartupInspection {
  format: 'bowerloom/startup-inspection/v1alpha1'; status: 'ready-for-review' | 'drifted' | 'revision-pending'; targetDir: string; revision: string | null;
  specReady: boolean; runtimeReady: false; executionAuthorized: false; reviewRequired: true;
  drift: Drift[]; compiledCandidate: string | null; contextImported: false; hostedAgentCreated: false;
  identityDiagnostic?: Readonly<StartupIdentityDiagnostic>;
  identityPolicy?: { algorithm: InstallationIdentityPolicy['algorithm']; target: PersistentIdentityComparison; bowerloom: PersistentIdentityComparison; limitation: string };
  /** Only when owners were given: every entry an owner verified, sorted by path. */
  owned?: OwnedEntry[];
}
export class StartupError extends Error { constructor(public readonly code: string) { super(code); this.name = 'StartupError'; } }
function fail(code: string): never { throw new StartupError(code); }
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const fold = (value: string) => value.normalize('NFC').toLowerCase();
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const RECEIPT = 'installation-receipt.json';
function record(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('STARTUP_INPUT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(descriptors).length || Object.entries(descriptors).some(([key, descriptor]) => !('value' in descriptor) || !descriptor.enumerable || ['__proto__', 'prototype', 'constructor'].includes(key)
    || ![...required, ...optional].includes(key)) || required.some(key => !Object.hasOwn(descriptors, key))) fail('STARTUP_INPUT');
}
function boundedText(value: unknown, max: number, multiline = false): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max || Buffer.from(value, 'utf8').toString('utf8') !== value || /[\p{Cc}\p{Cf}]/u.test(multiline ? value.replace(/[\r\n\t]/g, '') : value)) fail('STARTUP_TEXT');
  const normalized = value.trim().normalize('NFC');
  if (Buffer.byteLength(normalized) > max) fail('STARTUP_TEXT');
  return normalized;
}
function normalize(value: unknown, legacy = false): NormalizedInput {
  record(value, ['mode', 'targetDir', 'brief']);
  if (value.mode !== 'new' && value.mode !== 'existing') fail('STARTUP_MODE');
  if (typeof value.targetDir !== 'string') fail('STARTUP_TARGET');
  record(value.brief, ['projectName', 'goal'], ['assistantName', 'teamName', 'reviewMode', ...(legacy ? [] : ['profile'])]);
  const brief = value.brief;
  if (!legacy && brief.profile !== undefined && (typeof brief.profile !== 'string' || !Object.hasOwn(startupProfiles, brief.profile))) fail('STARTUP_PROFILE');
  if (brief.reviewMode !== undefined && !['milestones', 'handoff'].includes(String(brief.reviewMode))) fail('STARTUP_REVIEW_MODE');
  const normalized: NormalizedBrief = { projectName: boundedText(brief.projectName, 120), goal: boundedText(brief.goal, 6000, true), assistantName: brief.assistantName === undefined ? 'Personal assistant' : boundedText(brief.assistantName, 100), teamName: brief.teamName === undefined ? 'First team' : boundedText(brief.teamName, 120), reviewMode: (brief.reviewMode ?? 'milestones') as 'milestones' | 'handoff', ...(!legacy ? { profile: (brief.profile ?? 'engineer') as StartupProfile } : {}) };
  return { mode: value.mode, targetDir: canonicalTarget(value.targetDir), brief: normalized };
}
function canonicalTarget(value: string): string {
  if (!isAbsolute(value) || value !== resolve(value) || value !== value.normalize('NFC') || Buffer.byteLength(value) > 2048 || Buffer.from(value, 'utf8').toString('utf8') !== value || /[\p{Cc}\p{Cf}]/u.test(value)) fail('STARTUP_TARGET');
  const folded = fold(value), segments = folded.split(sep);
  if (folded === fold(homedir()) || value === sep || segments.some(segment => ['.git', '.codex', '.claude', '.agents', '.config', '.ssh', 'node_modules', 'library', '.bowerloom'].includes(segment) || segment.startsWith('nmaahc-sm'))
    || ['/usr', '/etc', '/bin', '/sbin', '/opt', '/system', '/library', '/applications', '/private/etc'].some(prefix => folded === prefix || folded.startsWith(prefix + sep))) fail('PROTECTED_TARGET');
  return value;
}
function identity(path: string): DirectoryIdentity {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_DIRECTORY');
  return { device: stat.dev.toString(), inode: stat.ino.toString(), birthtimeNs: stat.birthtimeNs.toString(), uid: Number(stat.uid), mode: Number(stat.mode) & 0o777 };
}
function ancestors(path: string, missingLeaf = false): void {
  let current: string = sep;
  const segments = path.split(sep).slice(1);
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    try { identity(current); }
    catch (error) { if (missingLeaf && index === segments.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  if (realpathSync(path) !== path) fail('NONCANONICAL_DIRECTORY');
}
function ownedDirectory(value: DirectoryIdentity): void {
  if (value.uid !== process.getuid?.() || (value.mode & 0o022)) fail('PRIVATE_OWNER_REQUIRED');
}
function names(path: string): string[] { const values = readdirSync(path); if (values.length > 10000) fail('DIRECTORY_LIMIT'); return values; }
function pathState(input: NormalizedInput): StartupPlan['binding'] {
  ancestors(input.targetDir, input.mode === 'new');
  const parent = identity(dirname(input.targetDir)); ownedDirectory(parent);
  const aliases = names(dirname(input.targetDir)).filter(name => fold(name) === fold(basename(input.targetDir)));
  if (input.mode === 'new') {
    if (aliases.length || existsSync(input.targetDir)) fail('TARGET_EXISTS');
    return { parent, target: null };
  }
  if (aliases.length !== 1 || aliases[0] !== basename(input.targetDir)) fail('TARGET_CASE_ALIAS');
  const target = identity(input.targetDir); ownedDirectory(target);
  if (names(input.targetDir).some(name => fold(name) === '.bowerloom-revision.json')) fail('REVISION_PENDING');
  if (target.device !== parent.device) fail('CROSS_DEVICE_TARGET');
  if (names(input.targetDir).some(name => fold(name) === '.bowerloom')) fail('BOWERLOOM_EXISTS');
  return { parent, target };
}
function legacyPlan(input: NormalizedInput, binding: StartupPlan['binding']): LegacyStartupPlan {
  const body = { format: STARTUP_FORMAT, templateVersion: TEMPLATE_VERSION, input, binding, ...scaffold(input.brief),
    specReady: true as const, runtimeReady: false as const, executionAuthorized: false as const, reviewRequired: true as const };
  return { ...body, revision: hash(canonicalJson(body)) };
}
function supportedIdentity(value: DirectoryIdentity): void { if (!snapshotPersistentIdentity(value)) fail('IDENTITY_POLICY_UNSUPPORTED'); }
function v2Plan(input: NormalizedInput, binding: StartupPlan['binding'], continuity: StartupContinuity | null = null): V2StartupPlan {
  if (!parseInstallationIdentityPolicy(INSTALLATION_IDENTITY_POLICY)) fail('IDENTITY_POLICY_UNSUPPORTED');
  supportedIdentity(binding.parent); if (binding.target) supportedIdentity(binding.target);
  const body = { format: STARTUP_V2_FORMAT, purpose: continuity ? 'revision' as const : 'first-install' as const,
    installationIdentityPolicy: INSTALLATION_IDENTITY_POLICY, continuity, templateVersion: TEMPLATE_VERSION, input, binding, ...scaffold(input.brief),
    specReady: true as const, runtimeReady: false as const, executionAuthorized: false as const, reviewRequired: true as const };
  return { ...body, revision: hash(canonicalJson(body)) };
}
export async function planStartup(input: StartupInput): Promise<StartupPlan> {
  const normalized = normalize(input), binding = pathState(normalized);
  return process.platform === 'darwin' ? v2Plan(normalized, binding) : legacyPlan(normalized, binding);
}
function makeReceipt(plan: StartupPlan, target: DirectoryIdentity, bowerloom: DirectoryIdentity): StartupReceipt {
  const body = { installedTargetIdentity: target, installedBowerloomIdentity: bowerloom,
    specReady: true as const, runtimeReady: false as const, executionAuthorized: false as const, reviewRequired: true as const };
  if (plan.format === STARTUP_FORMAT) return { format: 'bowerloom/startup-receipt/v1alpha1', plan, ...body };
  supportedIdentity(target); supportedIdentity(bowerloom);
  const receipt: V2StartupReceipt = { format: 'bowerloom/startup-receipt/v1beta2', plan, ...body,
    derivedBirthtimeNs: { target: canonicalBirthtimeNs(target.birthtimeNs)!, bowerloom: canonicalBirthtimeNs(bowerloom.birthtimeNs)! } };
  validateReceiptOrigin(receipt); return receipt;
}
function validateReceiptOrigin(receipt: V2StartupReceipt): void {
  const plan = receipt.plan;
  if (plan.purpose === 'revision') {
    if (!plan.continuity || !same(receipt.installedTargetIdentity, plan.continuity.retainedTargetBaseline)) fail('INVALID_RECEIPT');
  } else if (plan.input.mode === 'existing' && !same(receipt.installedTargetIdentity, plan.binding.target)) fail('INVALID_RECEIPT');
}
function matchesInstalled(receipt: StartupReceipt, key: 'installedTargetIdentity' | 'installedBowerloomIdentity', observed: DirectoryIdentity): boolean {
  return receipt.format === 'bowerloom/startup-receipt/v1alpha1' ? same(receipt[key], observed)
    : comparePersistentIdentity(receipt[key], observed, receipt.plan.installationIdentityPolicy) !== undefined;
}
function removeOwnDirectory(path: string, expected: DirectoryIdentity): void {
  try { if (same(identity(path), expected)) rmSync(path, { recursive: true, force: false }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
export async function applyStartup(input: StartupInput, exactRevision: string): Promise<StartupReceipt> {
  if (typeof exactRevision !== 'string' || !/^[a-f0-9]{64}$/.test(exactRevision)) fail('EXACT_APPROVAL_REQUIRED');
  const initial = await planStartup(input); if (initial.revision !== exactRevision) fail('STALE_APPROVAL');
  const parent = dirname(initial.input.targetDir), lock = join(parent, `.bowerloom-startup-${hash(fold(initial.input.targetDir)).slice(0, 24)}.lock`);
  let lockFd: number;
  try { lockFd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); } catch { fail('STARTUP_LOCKED'); }
  const lockStat = fstatSync(lockFd), stage = join(parent, `.bowerloom-startup-stage-${randomUUID()}`);
  let stageIdentity: DirectoryIdentity | undefined;
  try {
    const plan = await planStartup(input); if (plan.revision !== exactRevision) fail('STALE_APPROVAL');
    mkdirSync(stage, { mode: 0o700 }); stageIdentity = identity(stage);
    const bowerloom = join(stage, '.bowerloom'); mkdirSync(bowerloom, { mode: 0o700 });
    const createdBowerloomIdentity = plan.format === STARTUP_V2_FORMAT ? identity(bowerloom) : undefined;
    for (const file of plan.files) {
      const destination = join(bowerloom, file.path); mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, file.text, { flag: 'wx', mode: 0o600 });
    }
    const compiled = await compileCrew(join(bowerloom, TEAM_PATH));
    if (!same(compiled, plan.compiled)) fail('COMPILED_PLAN_CHANGED');
    if (plan.format === STARTUP_V2_FORMAT) {
      if (!same(pathState(plan.input), plan.binding)) fail('STALE_APPROVAL');
      ancestors(stage); ancestors(bowerloom);
      if (!same(identity(stage), stageIdentity) || !same(identity(bowerloom), createdBowerloomIdentity)) fail('STARTUP_STAGE_CHANGED');
    }
    const bowerloomIdentity = createdBowerloomIdentity ?? identity(bowerloom);
    const receipt = makeReceipt(plan, plan.input.mode === 'new' ? stageIdentity : plan.binding.target!, bowerloomIdentity);
    writeFileSync(join(bowerloom, RECEIPT), json(receipt), { flag: 'wx', mode: 0o600 });
    if ((await planStartup(input)).revision !== exactRevision) fail('STALE_APPROVAL');
    if (plan.format === STARTUP_V2_FORMAT && (!same(identity(stage), stageIdentity) || !same(identity(bowerloom), bowerloomIdentity))) fail('STARTUP_STAGE_CHANGED');
    if (plan.input.mode === 'new') { renameSync(stage, plan.input.targetDir); stageIdentity = undefined; }
    else renameSync(bowerloom, join(plan.input.targetDir, '.bowerloom'));
    if (plan.format === STARTUP_V2_FORMAT && (!same(identity(plan.input.targetDir), receipt.installedTargetIdentity)
      || !same(identity(join(plan.input.targetDir, '.bowerloom')), bowerloomIdentity))) fail('STARTUP_FINAL_IDENTITY_CHANGED');
    return receipt;
  } finally {
    try { if (stageIdentity) removeOwnDirectory(stage, stageIdentity); }
    finally {
      closeSync(lockFd);
      try { const now = lstatSync(lock); if (!now.isSymbolicLink() && now.dev === lockStat.dev && now.ino === lockStat.ino) unlinkSync(lock); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
}
function readManaged(path: string, max: number): Buffer {
  ancestors(dirname(path));
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o022) || before.size > max) fail('UNSAFE_MANAGED_FILE');
    const buffer = Buffer.alloc(max + 1); let size = 0;
    while (size < buffer.length) { const count = readSync(fd, buffer, size, buffer.length - size, null); if (!count) break; size += count; }
    const after = fstatSync(fd), current = lstatSync(path);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev) fail('MANAGED_FILE_CHANGED');
    return buffer.subarray(0, size);
  } finally { closeSync(fd); }
}
function validIdentity(value: unknown): boolean {
  try { record(value, ['device', 'inode', 'birthtimeNs', 'uid', 'mode']); return ['device', 'inode', 'birthtimeNs'].every(key => typeof value[key] === 'string' && /^[0-9]{1,30}$/.test(value[key])) && Number.isSafeInteger(value.uid) && Number.isInteger(value.mode) && Number(value.mode) >= 0 && Number(value.mode) <= 0o777; } catch { return false; }
}
function validatedPlan(p: unknown): StartupPlan {
  if (!p || typeof p !== 'object') fail('INVALID_RECEIPT');
  const v2 = Object.getOwnPropertyDescriptor(p, 'format')?.value === STARTUP_V2_FORMAT;
  record(p, ['format', 'templateVersion', 'input', 'binding', 'files', 'compiled', 'specReady', 'runtimeReady', 'executionAuthorized', 'reviewRequired', 'revision',
    ...(v2 ? ['purpose', 'installationIdentityPolicy', 'continuity'] : [])]);
  if (!v2 && p.format !== STARTUP_FORMAT) fail('INVALID_RECEIPT');
  record(p.binding, ['parent', 'target']);
  if (p.templateVersion !== TEMPLATE_VERSION && p.templateVersion !== LEGACY_TEMPLATE_VERSION && p.templateVersion !== ALPHA2_TEMPLATE_VERSION && p.templateVersion !== BETA1_TEMPLATE_VERSION && p.templateVersion !== BETA2_TEMPLATE_VERSION && p.templateVersion !== BETA3_TEMPLATE_VERSION) fail('INVALID_RECEIPT');
  const legacy = p.templateVersion === LEGACY_TEMPLATE_VERSION;
  const normalized = normalize(p.input, legacy), generated = legacy ? legacyScaffold(normalized.brief) : p.templateVersion === ALPHA2_TEMPLATE_VERSION ? alpha2Scaffold(normalized.brief) : p.templateVersion === BETA1_TEMPLATE_VERSION ? beta1Scaffold(normalized.brief) : p.templateVersion === BETA2_TEMPLATE_VERSION ? beta2Scaffold(normalized.brief) : p.templateVersion === BETA3_TEMPLATE_VERSION ? beta3Scaffold(normalized.brief) : scaffold(normalized.brief);
  if (!validIdentity(p.binding.parent) || (p.binding.target !== null && !validIdentity(p.binding.target)) || (normalized.mode === 'new') !== (p.binding.target === null)) fail('INVALID_RECEIPT');
  if (v2) {
    if (p.templateVersion !== TEMPLATE_VERSION || !parseInstallationIdentityPolicy(p.installationIdentityPolicy)) fail('IDENTITY_POLICY_UNSUPPORTED');
    supportedIdentity(p.binding.parent as DirectoryIdentity); if (p.binding.target) supportedIdentity(p.binding.target as DirectoryIdentity);
    if (p.purpose === 'first-install') { if (p.continuity !== null) fail('INVALID_RECEIPT'); }
    else if (p.purpose === 'revision') {
      if (normalized.mode !== 'existing') fail('INVALID_RECEIPT');
      record(p.continuity, ['predecessorReceiptSha256', 'predecessorPolicy', 'predecessorPlanRevision', 'retainedTargetBaseline']);
      if (![p.continuity.predecessorReceiptSha256, p.continuity.predecessorPlanRevision].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))
        || !parseInstallationIdentityPolicy(p.continuity.predecessorPolicy) || !validIdentity(p.continuity.retainedTargetBaseline)) fail('INVALID_RECEIPT');
      supportedIdentity(p.continuity.retainedTargetBaseline as DirectoryIdentity);
      if (!comparePersistentIdentity(p.continuity.retainedTargetBaseline, p.binding.target, p.installationIdentityPolicy)) fail('INVALID_RECEIPT');
    } else fail('INVALID_RECEIPT');
  }
  const expected = { format: v2 ? STARTUP_V2_FORMAT : STARTUP_FORMAT, ...(v2 ? { purpose: p.purpose, installationIdentityPolicy: INSTALLATION_IDENTITY_POLICY, continuity: p.continuity } : {}),
    templateVersion: p.templateVersion, input: normalized, binding: p.binding, ...generated,
    specReady: true, runtimeReady: false, executionAuthorized: false, reviewRequired: true };
  if (!same(p, { ...expected, revision: hash(canonicalJson(expected)) })) fail('INVALID_RECEIPT');
  return p as unknown as StartupPlan;
}
function receiptValue(raw: Buffer): StartupReceipt {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { fail('INVALID_RECEIPT'); }
  if (!value || typeof value !== 'object') fail('INVALID_RECEIPT');
  const v2 = Object.getOwnPropertyDescriptor(value, 'format')?.value === 'bowerloom/startup-receipt/v1beta2';
  record(value, ['format', 'plan', 'installedTargetIdentity', 'installedBowerloomIdentity', 'specReady', 'runtimeReady', 'executionAuthorized', 'reviewRequired', ...(v2 ? ['derivedBirthtimeNs'] : [])]);
  if ((!v2 && value.format !== 'bowerloom/startup-receipt/v1alpha1') || value.specReady !== true || value.runtimeReady !== false || value.executionAuthorized !== false || value.reviewRequired !== true || !validIdentity(value.installedTargetIdentity) || !validIdentity(value.installedBowerloomIdentity)) fail('INVALID_RECEIPT');
  const plan = validatedPlan(value.plan);
  if (v2 !== (plan.format === STARTUP_V2_FORMAT)) fail('INVALID_RECEIPT');
  if (v2) {
    supportedIdentity(value.installedTargetIdentity as DirectoryIdentity); supportedIdentity(value.installedBowerloomIdentity as DirectoryIdentity);
    record(value.derivedBirthtimeNs, ['target', 'bowerloom']);
    if (!same(value.derivedBirthtimeNs, { target: canonicalBirthtimeNs((value.installedTargetIdentity as DirectoryIdentity).birthtimeNs), bowerloom: canonicalBirthtimeNs((value.installedBowerloomIdentity as DirectoryIdentity).birthtimeNs) })) fail('INVALID_RECEIPT');
    validateReceiptOrigin(value as unknown as V2StartupReceipt);
  }
  return value as unknown as StartupReceipt;
}
function inspectionOwners(options: unknown): readonly OwnerVerifier[] | null {
  if (options === undefined) return null;
  record(options, [], ['owners']);
  const owners = (options as InspectStartupOptions).owners;
  if (owners === undefined) return null;
  if (!validOwners(owners)) fail('STARTUP_INPUT');
  // No verifiers: exactly the cc117ac result.
  return owners.length ? owners : null;
}
/**
 * Inspects an installed project. With `options.owners`, an entry inside `.bowerloom/` that the startup receipt does
 * not account for passes only when exactly one owner claims it and verifies it (build plan 01, M2); a claimed folder is
 * verified whole and not walked. A link or other special entry is unsafe and no owner is asked. Without owners, the
 * result is exactly as at cc117ac.
 */
export async function inspectStartup(targetDir: string, options?: InspectStartupOptions): Promise<StartupInspection> {
  const owners = inspectionOwners(options), ownerSignal = new AbortController().signal, owned: OwnedEntry[] = [];
  const target = canonicalTarget(targetDir); ancestors(target); ownedDirectory(identity(target));
  const result: StartupInspection = { format: 'bowerloom/startup-inspection/v1alpha1', status: 'drifted', targetDir: target, revision: null, specReady: false, runtimeReady: false, executionAuthorized: false, reviewRequired: true, drift: [], compiledCandidate: null, contextImported: false, hostedAgentCreated: false, ...(owners ? { owned } : {}) };
  if (names(target).some(name => fold(name) === '.bowerloom-revision.json')) { result.status = 'revision-pending'; result.drift.push({ path: '.bowerloom-revision.json', kind: 'revision-pending' }); return result; }
  const directory = join(target, '.bowerloom'), aliases = names(target).filter(name => fold(name) === '.bowerloom');
  if (aliases.length !== 1 || aliases[0] !== '.bowerloom') { result.drift.push({ path: '.bowerloom', kind: aliases.length ? 'unsafe' : 'missing' }); return result; }
  let receipt: StartupReceipt, receiptBytes: Buffer, initialTarget: DirectoryIdentity, initialBowerloom: DirectoryIdentity;
  try { initialTarget = identity(target); initialBowerloom = identity(directory); ownedDirectory(initialBowerloom); receiptBytes = readManaged(join(directory, RECEIPT), 1024 * 1024); receipt = receiptValue(receiptBytes); }
  catch { result.drift.push({ path: `.bowerloom/${RECEIPT}`, kind: 'invalid-receipt' }); return result; }
  result.revision = receipt.plan.revision;
  const observedTarget = receipt.format === 'bowerloom/startup-receipt/v1beta2' ? initialTarget : identity(target);
  const observedBowerloom = receipt.format === 'bowerloom/startup-receipt/v1beta2' ? initialBowerloom : identity(directory);
  if (receipt.plan.input.targetDir !== target || !matchesInstalled(receipt, 'installedTargetIdentity', observedTarget) || !matchesInstalled(receipt, 'installedBowerloomIdentity', observedBowerloom)) result.drift.push({ path: '.bowerloom', kind: 'installation-binding-changed' });
  for (const file of receipt.plan.files) {
    try { const bytes = readManaged(join(directory, file.path), 512 * 1024); if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) result.drift.push({ path: `.bowerloom/${file.path}`, kind: 'changed' }); }
    catch (error) { result.drift.push({ path: `.bowerloom/${file.path}`, kind: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unsafe' }); }
  }
  const expectedPaths = new Set([...receipt.plan.files.map(file => file.path), RECEIPT]);
  let count = 0;
  // An entry the receipt does not account for. Without owners it is unexpected, as at cc117ac.
  const unaccounted = async (path: string, kind: OwnedEntryKind | null): Promise<void> => {
    if (!owners) { result.drift.push({ path: `.bowerloom/${path}`, kind: 'unexpected' }); return; }
    if (kind === null) { result.drift.push({ path: `.bowerloom/${path}`, kind: 'unsafe' }); return; }
    const outcome = await askOwners(owners, path, kind, ownerSignal);
    if (outcome.result === 'unclaimed') result.drift.push({ path: `.bowerloom/${path}`, kind: 'unexpected' });
    else if (outcome.result === 'refused') result.drift.push({ path: `.bowerloom/${path}`, kind: 'owner-refused', code: outcome.code });
    else owned.push({ path: `.bowerloom/${path}`, owner: outcome.owner, state: outcome.result });
  };
  const walk = async (relative: string): Promise<void> => {
    const entries = readdirSync(join(directory, relative), { withFileTypes: true });
    if (owners) entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (++count > 256) fail('INSPECTION_LIMIT');
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (!receipt.plan.files.some(file => file.path.startsWith(path + '/'))) await unaccounted(path, 'directory');
        else await walk(path);
      } else if (!expectedPaths.has(path)) await unaccounted(path, entry.isFile() && !entry.isSymbolicLink() ? 'file' : null);
    }
  };
  try { await walk(''); } catch { result.drift.push({ path: '.bowerloom', kind: 'unsafe' }); }
  owned.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!result.drift.length) {
    try {
      const compiled = await compileCrew(join(directory, TEAM_PATH)); result.compiledCandidate = compiled.candidateRevision;
      if (!same(compiled, receipt.plan.compiled)) result.drift.push({ path: `.bowerloom/${TEAM_PATH}`, kind: 'changed' });
    } catch { result.drift.push({ path: `.bowerloom/${TEAM_PATH}`, kind: 'compiler-failed' }); }
  }
  if (names(target).some(name => fold(name) === '.bowerloom-revision.json')) { result.status = 'revision-pending'; result.drift.push({ path: '.bowerloom-revision.json', kind: 'revision-pending' }); return result; }
  if (!result.drift.length) {
    try {
      if (receipt.format === 'bowerloom/startup-receipt/v1beta2') {
        ancestors(target); ancestors(directory);
        const closingBytes = readManaged(join(directory, RECEIPT), 1024 * 1024);
        if (!closingBytes.equals(receiptBytes) || !same(receiptValue(closingBytes), receipt)
          || !same(identity(target), observedTarget) || !same(identity(directory), observedBowerloom)) result.drift.push({ path: '.bowerloom', kind: 'installation-binding-changed' });
        if (names(target).some(name => fold(name) === '.bowerloom-revision.json')) {
          result.status = 'revision-pending'; result.drift.push({ path: '.bowerloom-revision.json', kind: 'revision-pending' }); return result;
        }
      } else if (!same(identity(directory), receipt.installedBowerloomIdentity) || !same(receiptValue(readManaged(join(directory, RECEIPT), 1024 * 1024)), receipt)) result.drift.push({ path: '.bowerloom', kind: 'installation-binding-changed' });
    } catch { result.drift.push({ path: '.bowerloom', kind: 'unsafe' }); }
  }
  // Explanatory evidence only: exact identity refusal above remains mandatory.
  if (receipt.format === 'bowerloom/startup-receipt/v1alpha1' && receipt.plan.input.targetDir === target && result.drift.length === 1 && result.drift[0]!.kind === 'installation-binding-changed') {
    const detail = classifyStartupIdentityDiagnostic(receipt.installedTargetIdentity, observedTarget, receipt.installedBowerloomIdentity, observedBowerloom);
    if (detail) {
      try {
        ancestors(target); ancestors(directory);
        const closingTarget = identity(target), closingBowerloom = identity(directory);
        ownedDirectory(closingTarget); ownedDirectory(closingBowerloom);
        const closingReceipt = readManaged(join(directory, RECEIPT), 1024 * 1024);
        if (same(closingTarget, observedTarget) && same(closingBowerloom, observedBowerloom)
          && closingReceipt.equals(receiptBytes) && same(receiptValue(closingReceipt), receipt)
          && same(identity(target), closingTarget) && same(identity(directory), closingBowerloom)
          && !names(target).some(name => fold(name) === '.bowerloom-revision.json')) result.identityDiagnostic = detail;
      } catch { /* Unsafe or changing observations receive no diagnostic label. */ }
    }
  }
  if (!result.drift.length && receipt.format === 'bowerloom/startup-receipt/v1beta2') result.identityPolicy = {
    algorithm: receipt.plan.installationIdentityPolicy.algorithm,
    target: comparePersistentIdentity(receipt.installedTargetIdentity, observedTarget, receipt.plan.installationIdentityPolicy)!,
    bowerloom: comparePersistentIdentity(receipt.installedBowerloomIdentity, observedBowerloom, receipt.plan.installationIdentityPolicy)!,
    limitation: 'Accepted under the reviewed installation identity policy; the cause of any timestamp change is unknown. Project-root metadata changes can still invalidate existing enrollment and links. Runtime and execution remain separately controlled.',
  };
  result.specReady = result.drift.length === 0; result.status = result.specReady ? 'ready-for-review' : 'drifted';
  return result;
}

/** Human review is a projection of the exact plan; it never grants execution. */
export function renderStartupReview(plan: StartupPlan): string {
  const profile = startupProfiles[plan.input.brief.profile ?? 'engineer'];
  const team = plan.compiled.definition;
  const roles = team.owners.map(owner => `${owner.role}: ${profile.summaries[owner.id as keyof typeof profile.summaries]} Proposed write: ${owner.permissions.map(effect => 'path' in effect ? effect.path : effect.operation).join(', ')} (proposed local write; separate action approval)`);
  return [
    `Bowerloom setup review — ${profile.label}`,
    `Project: ${plan.input.brief.projectName}`,
    `Goal: ${plan.input.brief.goal.replace(/\r(?!\n)/g, '\\r')}`,
    `Target: ${plan.input.targetDir} (${plan.input.mode === 'new' ? 'new workspace' : 'existing project; add .bowerloom only'})`,
    '', 'Your existing personal agent remains your interface.',
    'Proposed team: ' + team.owners.map(owner => owner.role).join(' → '),
    ...roles, '',
    'Access: supplied brief assets and accepted task outputs only. No context or settings imported.',
    'Limits: at most 2 active workers; 25% capacity reserve; no paid fallback.',
    ...(plan.format === STARTUP_V2_FORMAT ? ['Installation identity: the reviewed Darwin policy accepts the saved birth time or its one directional floating-point conversion. Device, inode, owner, mode, paths and managed bytes must still match.', 'Project-root metadata changes can still invalidate existing enrollment and links. Active changes and recovery ownership stay exact.'] : []),
    'Installation approval: create only the reviewed .bowerloom files. No workers, backend, network, or project execution.',
    'Proposed task permissions are not granted by this approval. All future task writes require separate exact approval.',
    '', `Creates ${plan.files.length} setup files and a private installation receipt in .bowerloom. Keep the receipt out of shared definitions.`,
    'Read startup-review.md for roles, access, limits, and expandable technical contents. Review setup text for private information before sharing.',
    'For every file, content hash, and compiler detail, rerun this plan with --json before approval.',
    `Exact approval revision: ${plan.revision}`,
    'Review first. Apply with unchanged inputs and --approve followed by this exact revision.',
    'Setup is ready for review. No team has started and no execution permission was granted.',
  ].join('\n');
}

/** Package-internal primitives shared by exact startup revision; not a permission bypass. */
export const startupInternals = { canonicalTarget, ancestors, identity, ownedDirectory, names, hash, same, json, readManaged, receiptValue, normalize, record, validIdentity, legacyPlan, v2Plan, validatedPlan, makeReceipt, matchesInstalled };
export { planStartupRevision, applyStartupRevision, recoverStartupRevision, renderStartupRevisionReview } from './revision.js';
export type { RevisionInput, StartupRevisionPlan, StartupRevisionRecovery } from './revision.js';
export { planStartupDemo, verifyStartupDemoPlan, renderStartupDemoReview } from './demo.js';
export type { StartupDemoInput, StartupDemoPlan, StartupDemoHandoff } from './demo.js';
