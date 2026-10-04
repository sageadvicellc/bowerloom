import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { canonicalJson } from '../../contracts/src/index.js';
import type { CompiledPlan } from '../../contracts/src/index.js';
import { compileCrew } from '../../crew/src/index.js';
import { scaffold, TEAM_PATH, TEMPLATE_VERSION } from './scaffold.js';
import { scaffold as legacyScaffold, TEMPLATE_VERSION as LEGACY_TEMPLATE_VERSION } from './scaffold-v1alpha1.js';
import { startupProfiles } from './profiles.js';
import type { StartupProfile } from './profiles.js';
export { startupProfiles } from './profiles.js';
export type { StartupProfile } from './profiles.js';
import type { GeneratedFile, NormalizedBrief, StartupBrief } from './scaffold.js';
export type { StartupBrief, GeneratedFile } from './scaffold.js';
export const STARTUP_FORMAT = 'bowerloom/startup-plan/v1alpha1' as const;
export interface StartupInput { mode: 'new' | 'existing'; targetDir: string; brief: StartupBrief }
interface NormalizedInput { mode: 'new' | 'existing'; targetDir: string; brief: NormalizedBrief }
export interface DirectoryIdentity { device: string; inode: string; birthtimeNs: string; uid: number; mode: number }
export interface StartupPlan {
  format: typeof STARTUP_FORMAT; templateVersion: string; input: NormalizedInput;
  binding: { parent: DirectoryIdentity; target: DirectoryIdentity | null };
  files: GeneratedFile[]; compiled: CompiledPlan;
  specReady: true; runtimeReady: false; executionAuthorized: false; reviewRequired: true; revision: string;
}
export interface StartupReceipt {
  format: 'bowerloom/startup-receipt/v1alpha1'; plan: StartupPlan;
  installedTargetIdentity: DirectoryIdentity; installedBowerloomIdentity: DirectoryIdentity;
  specReady: true; runtimeReady: false; executionAuthorized: false; reviewRequired: true;
}
export interface Drift { path: string; kind: 'missing' | 'changed' | 'unsafe' | 'unexpected' | 'invalid-receipt' | 'installation-binding-changed' | 'compiler-failed' }
export interface StartupInspection {
  format: 'bowerloom/startup-inspection/v1alpha1'; status: 'ready-for-review' | 'drifted'; targetDir: string; revision: string | null;
  specReady: boolean; runtimeReady: false; executionAuthorized: false; reviewRequired: true;
  drift: Drift[]; compiledCandidate: string | null; contextImported: false; hostedAgentCreated: false;
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
  if (target.device !== parent.device) fail('CROSS_DEVICE_TARGET');
  if (names(input.targetDir).some(name => fold(name) === '.bowerloom')) fail('BOWERLOOM_EXISTS');
  return { parent, target };
}
export async function planStartup(input: StartupInput): Promise<StartupPlan> {
  const normalized = normalize(input), binding = pathState(normalized), generated = scaffold(normalized.brief);
  const body = { format: STARTUP_FORMAT, templateVersion: TEMPLATE_VERSION, input: normalized, binding, ...generated,
    specReady: true as const, runtimeReady: false as const, executionAuthorized: false as const, reviewRequired: true as const };
  return { ...body, revision: hash(canonicalJson(body)) };
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
    for (const file of plan.files) {
      const destination = join(bowerloom, file.path); mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, file.text, { flag: 'wx', mode: 0o600 });
    }
    const compiled = await compileCrew(join(bowerloom, TEAM_PATH));
    if (!same(compiled, plan.compiled)) fail('COMPILED_PLAN_CHANGED');
    const receipt: StartupReceipt = { format: 'bowerloom/startup-receipt/v1alpha1', plan,
      installedTargetIdentity: plan.input.mode === 'new' ? stageIdentity : plan.binding.target!, installedBowerloomIdentity: identity(bowerloom),
      specReady: true, runtimeReady: false, executionAuthorized: false, reviewRequired: true };
    writeFileSync(join(bowerloom, RECEIPT), json(receipt), { flag: 'wx', mode: 0o600 });
    if ((await planStartup(input)).revision !== exactRevision) fail('STALE_APPROVAL');
    if (plan.input.mode === 'new') { renameSync(stage, plan.input.targetDir); stageIdentity = undefined; }
    else renameSync(bowerloom, join(plan.input.targetDir, '.bowerloom'));
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
function receiptValue(raw: Buffer): StartupReceipt {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { fail('INVALID_RECEIPT'); }
  record(value, ['format', 'plan', 'installedTargetIdentity', 'installedBowerloomIdentity', 'specReady', 'runtimeReady', 'executionAuthorized', 'reviewRequired']);
  if (value.format !== 'bowerloom/startup-receipt/v1alpha1' || value.specReady !== true || value.runtimeReady !== false || value.executionAuthorized !== false || value.reviewRequired !== true || !validIdentity(value.installedTargetIdentity) || !validIdentity(value.installedBowerloomIdentity)) fail('INVALID_RECEIPT');
  const p = value.plan;
  record(p, ['format', 'templateVersion', 'input', 'binding', 'files', 'compiled', 'specReady', 'runtimeReady', 'executionAuthorized', 'reviewRequired', 'revision']);
  record(p.binding, ['parent', 'target']);
  if (p.templateVersion !== TEMPLATE_VERSION && p.templateVersion !== LEGACY_TEMPLATE_VERSION) fail('INVALID_RECEIPT');
  const legacy = p.templateVersion === LEGACY_TEMPLATE_VERSION;
  const normalized = normalize(p.input, legacy), generated = legacy ? legacyScaffold(normalized.brief) : scaffold(normalized.brief);
  if (!validIdentity(p.binding.parent) || (p.binding.target !== null && !validIdentity(p.binding.target)) || (normalized.mode === 'new') !== (p.binding.target === null)) fail('INVALID_RECEIPT');
  const expected = { format: STARTUP_FORMAT, templateVersion: p.templateVersion, input: normalized, binding: p.binding, ...generated,
    specReady: true, runtimeReady: false, executionAuthorized: false, reviewRequired: true };
  if (!same(p, { ...expected, revision: hash(canonicalJson(expected)) })) fail('INVALID_RECEIPT');
  return value as unknown as StartupReceipt;
}
export async function inspectStartup(targetDir: string): Promise<StartupInspection> {
  const target = canonicalTarget(targetDir); ancestors(target); ownedDirectory(identity(target));
  const result: StartupInspection = { format: 'bowerloom/startup-inspection/v1alpha1', status: 'drifted', targetDir: target, revision: null, specReady: false, runtimeReady: false, executionAuthorized: false, reviewRequired: true, drift: [], compiledCandidate: null, contextImported: false, hostedAgentCreated: false };
  const directory = join(target, '.bowerloom'), aliases = names(target).filter(name => fold(name) === '.bowerloom');
  if (aliases.length !== 1 || aliases[0] !== '.bowerloom') { result.drift.push({ path: '.bowerloom', kind: aliases.length ? 'unsafe' : 'missing' }); return result; }
  let receipt: StartupReceipt;
  try { ownedDirectory(identity(directory)); receipt = receiptValue(readManaged(join(directory, RECEIPT), 1024 * 1024)); }
  catch { result.drift.push({ path: `.bowerloom/${RECEIPT}`, kind: 'invalid-receipt' }); return result; }
  result.revision = receipt.plan.revision;
  if (receipt.plan.input.targetDir !== target || !same(receipt.installedTargetIdentity, identity(target)) || !same(receipt.installedBowerloomIdentity, identity(directory))) result.drift.push({ path: '.bowerloom', kind: 'installation-binding-changed' });
  for (const file of receipt.plan.files) {
    try { const bytes = readManaged(join(directory, file.path), 512 * 1024); if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) result.drift.push({ path: `.bowerloom/${file.path}`, kind: 'changed' }); }
    catch (error) { result.drift.push({ path: `.bowerloom/${file.path}`, kind: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unsafe' }); }
  }
  const expectedPaths = new Set([...receipt.plan.files.map(file => file.path), RECEIPT]);
  let count = 0;
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
      if (++count > 256) fail('INSPECTION_LIMIT');
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (!receipt.plan.files.some(file => file.path.startsWith(path + '/'))) result.drift.push({ path: `.bowerloom/${path}`, kind: 'unexpected' });
        else walk(path);
      } else if (!expectedPaths.has(path)) result.drift.push({ path: `.bowerloom/${path}`, kind: 'unexpected' });
    }
  };
  try { walk(''); } catch { result.drift.push({ path: '.bowerloom', kind: 'unsafe' }); }
  if (!result.drift.length) {
    try {
      const compiled = await compileCrew(join(directory, TEAM_PATH)); result.compiledCandidate = compiled.candidateRevision;
      if (!same(compiled, receipt.plan.compiled)) result.drift.push({ path: `.bowerloom/${TEAM_PATH}`, kind: 'changed' });
    } catch { result.drift.push({ path: `.bowerloom/${TEAM_PATH}`, kind: 'compiler-failed' }); }
  }
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
    'Installation approval: create only the reviewed .bowerloom files. No workers, backend, network, or project execution.',
    'Proposed task permissions are not granted by this approval. All future task writes require separate exact approval.',
    '', `Creates ${plan.files.length} files, including startup-review.md with roles, access, limits, and expandable technical contents.`,
    'For every file, content hash, and compiler detail, rerun this plan with --json before approval.',
    `Exact approval revision: ${plan.revision}`,
    'Review first. Apply with unchanged inputs and --approve followed by this exact revision.',
    'Setup is ready for review. No team has started and no execution permission was granted.',
  ].join('\n');
}
