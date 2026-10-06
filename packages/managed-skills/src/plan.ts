import { posix } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { projectionFor } from '../../portable/src/harness-projection.js';
import { captureSkillData, closed, boundedText, digest, freezeSkillData, hashValue, requireSkill, revisionOf, validateSkillSource } from '../../skill-sources/src/validation.js';
import type { SkillSourceValidation } from '../../skill-sources/src/types.js';
import type { ManagedSkillPlan, ManagedSkillSnapshot, ManagedSkillTarget, SkillInventoryEntry } from './types.js';

const POLICY = 'bowerloom/managed-skill-projection/v1beta1' as const;
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const ordered = <T extends { path: string }>(values: T[]): T[] => values.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
function absolute(value: unknown): asserts value is string {
  boundedText(value, 2048);
  requireSkill(value.startsWith('/') && value !== '/' && posix.normalize(value) === value && !value.endsWith('/') && !value.includes('\\'), 'SKILL_TARGET');
  requireSkill(!value.split('/').some(p => ['.git', '.ssh', '.config', '.claude', '.codex', '.agents', 'node_modules'].includes(p.toLowerCase())) && !/^\/(?:etc|usr|bin|sbin|system|var\/root)(?:\/|$)/i.test(value), 'SKILL_TARGET');
}
function directoryIdentity(value: unknown): void {
  const id = closed(value, ['device', 'inode', 'birthtimeNs', 'uid', 'mode']);
  for (const key of ['device', 'inode', 'birthtimeNs']) requireSkill(typeof id[key] === 'string' && /^(0|[1-9]\d{0,24})$/.test(id[key]), 'SKILL_TARGET_IDENTITY');
  requireSkill(Number.isSafeInteger(id.uid) && (id.uid as number) >= 0 && Number.isSafeInteger(id.mode) && (id.mode as number) >= 0 && (id.mode as number) <= 0o777 && !((id.mode as number) & 0o022), 'SKILL_TARGET_IDENTITY');
}
function targetValue(value: unknown): ManagedSkillTarget {
  const target = closed(value, ['project', 'state', 'projectParentIdentity', 'stateParentIdentity', 'harness']);
  for (const key of ['project', 'state']) { const selected = closed(target[key], ['path', 'identity']); absolute(selected.path); directoryIdentity(selected.identity); }
  directoryIdentity(target.projectParentIdentity); directoryIdentity(target.stateParentIdentity);
  requireSkill(target.harness === 'codex' || target.harness === 'claude', 'SKILL_HARNESS');
  const result = target as unknown as ManagedSkillTarget, project = result.project.path, state = result.state.path;
  requireSkill(project !== state && !project.startsWith(state + '/') && !state.startsWith(project + '/'), 'SKILL_TARGET_OVERLAP');
  requireSkill(result.state.identity.mode === 0o700 && result.project.identity.uid === result.state.identity.uid && result.project.identity.uid === result.projectParentIdentity.uid && result.project.identity.uid === result.stateParentIdentity.uid, 'SKILL_TARGET_IDENTITY');
  return result;
}
function inventoryPath(value: unknown): asserts value is string {
  boundedText(value, 1024);
  requireSkill(!value.startsWith('/') && !value.includes('\\') && value.split('/').every(p => p !== '' && p !== '.' && p !== '..') && posix.normalize(value) === value, 'SKILL_INVENTORY_PATH');
}
function inventory(value: unknown): SkillInventoryEntry[] {
  requireSkill(Array.isArray(value) && value.length <= 1024, 'SKILL_INVENTORY');
  const keys = new Set<string>(), entries: SkillInventoryEntry[] = [];
  for (const raw of value) {
    const entry = closed(raw, ['path', 'kind', 'sha256', 'bytes', 'mode']); inventoryPath(entry.path);
    requireSkill(!keys.has(entry.path.toLowerCase()), 'SKILL_INVENTORY_COLLISION'); keys.add(entry.path.toLowerCase());
    requireSkill(entry.kind === 'file' || entry.kind === 'directory', 'SKILL_INVENTORY');
    requireSkill(Number.isSafeInteger(entry.bytes) && (entry.bytes as number) >= 0 && (entry.bytes as number) <= 16 * 1024 * 1024 && Number.isSafeInteger(entry.mode) && (entry.mode as number) >= 0 && (entry.mode as number) <= 0o777 && !((entry.mode as number) & 0o022), 'SKILL_INVENTORY');
    if (entry.kind === 'file') hashValue(entry.sha256); else requireSkill(entry.sha256 === null && entry.bytes === 0, 'SKILL_INVENTORY');
    entries.push(entry as unknown as SkillInventoryEntry);
  }
  const map = new Map(entries.map(e => [e.path, e]));
  for (const e of entries) for (let parent = posix.dirname(e.path); parent !== '.'; parent = posix.dirname(parent)) requireSkill(map.get(parent)?.kind === 'directory', 'SKILL_INVENTORY_PARENT');
  return ordered(entries);
}
function roots(source: SkillSourceValidation, target: ManagedSkillTarget): { canonical: string; projected: string } {
  return { canonical: `.bowerloom-skills/skills/${source.input.skill.id}`, projected: `${projectionFor(target.harness)!.skillRoot}/${source.input.skill.name}` };
}
function generated(source: SkillSourceValidation, target: ManagedSkillTarget): { managed: SkillInventoryEntry[]; writes: ManagedSkillPlan['writes'] } {
  const locations = roots(source, target), nodes = new Map<string, SkillInventoryEntry>();
  const writes: ManagedSkillPlan['writes'] = [];
  const directory = (path: string): void => { if (!nodes.has(path)) nodes.set(path, { path, kind: 'directory', sha256: null, bytes: 0, mode: 0o700 }); };
  directory('.bowerloom-skills'); directory('.bowerloom-skills/skills');
  for (const [root, ownedBase] of [[locations.canonical, '.bowerloom-skills'], [locations.projected, locations.projected]] as const) {
    directory(root);
    for (const file of source.input.files) {
      const path = `${root}/${file.path}`;
      for (let parent = posix.dirname(path); parent === ownedBase || parent.startsWith(ownedBase + '/'); parent = posix.dirname(parent)) directory(parent);
      nodes.set(path, { path, kind: 'file', sha256: file.sha256, bytes: Buffer.byteLength(file.text), mode: file.mode }); writes.push({ path, text: file.text, sha256: file.sha256, mode: file.mode });
    }
  }
  const catalog = {
    format: 'bowerloom/managed-skill-catalog/v1beta1', policyVersion: POLICY,
    skill: source.input.skill, source: source.input.source, sourceRevision: source.revision,
    license: source.input.license, references: source.input.references, harness: target.harness,
    files: source.input.files.map(({ text: _text, ...file }) => file), executionAuthorized: false,
  };
  const text = canonicalJson(catalog) + '\n', path = '.bowerloom-skills/catalog.json';
  nodes.set(path, { path, kind: 'file', sha256: digest(text), bytes: Buffer.byteLength(text), mode: 0o644 }); writes.push({ path, text, sha256: digest(text), mode: 0o644 });
  return { managed: ordered([...nodes.values()]), writes: ordered(writes) };
}
function priorValue(value: unknown): { snapshot: ManagedSkillSnapshot; source: SkillSourceValidation } {
  const raw = closed(value, ['format', 'synthetic', 'policyVersion', 'source', 'target', 'managedInventory', 'previousRevision', 'executionAuthorized', 'writesAuthorized', 'grantsAuthority', 'revision']);
  requireSkill(raw.format === 'bowerloom/synthetic-managed-skill-snapshot/v1beta1' && raw.synthetic === true && raw.policyVersion === POLICY && raw.executionAuthorized === false && raw.writesAuthorized === false && raw.grantsAuthority === false, 'SKILL_PRIOR');
  hashValue(raw.revision); if (raw.previousRevision !== null) hashValue(raw.previousRevision);
  const { revision, ...body } = raw; requireSkill(revisionOf(body) === revision, 'SKILL_PRIOR_REVISION');
  const target = targetValue(raw.target), source = validateSkillSource(raw.source);
  // Generated managed inventory intentionally omits shared harness ancestors.
  requireSkill(same(raw.managedInventory, generated(source, target).managed), 'SKILL_PRIOR_INVENTORY');
  return { snapshot: raw as unknown as ManagedSkillSnapshot, source };
}
function origin(source: SkillSourceValidation): string {
  const s = source.input.source; return s.kind === 'npm' ? `${s.kind}:${s.registry}:${s.package}` : `${s.kind}:${s.host}:${s.repository}`;
}
/** Plans synthetic file claims only. It never reads a path, writes, acquires, or approves. */
export function planManagedSkill(value: unknown): ManagedSkillPlan {
  const input = closed(captureSkillData(value), ['format', 'synthetic', 'operation', 'source', 'target', 'prior', 'currentInventory']);
  requireSkill(input.format === 'bowerloom/synthetic-managed-skill-request/v1beta1' && input.synthetic === true && ['install', 'update'].includes(input.operation as string), 'SKILL_REQUEST');
  const source = validateSkillSource(input.source), target = targetValue(input.target), current = inventory(input.currentInventory);
  const next = generated(source, target), locations = roots(source, target);
  const selected = (path: string): boolean => path === '.bowerloom-skills' || path.startsWith('.bowerloom-skills/') || path === locations.projected || path.startsWith(locations.projected + '/');
  const observedManaged = current.filter(e => selected(e.path));
  let prior: ManagedSkillSnapshot | null = null;
  if (input.operation === 'install') {
    requireSkill(input.prior === null && observedManaged.length === 0, 'SKILL_DESTINATION_COLLISION');
  } else {
    const previous = priorValue(input.prior); prior = previous.snapshot;
    requireSkill(same(prior.target, target) && previous.source.input.skill.id === source.input.skill.id && previous.source.input.skill.name === source.input.skill.name && origin(previous.source) === origin(source), 'SKILL_UPDATE_BINDING');
    const old = previous.source.input.source, fresh = source.input.source;
    requireSkill(old.kind === 'npm' && fresh.kind === 'npm' ? old.version !== fresh.version : old.kind === 'git' && fresh.kind === 'git' && old.commit !== fresh.commit, 'SKILL_IMMUTABLE_SOURCE');
    requireSkill(same(observedManaged, prior.managedInventory), 'SKILL_LOCAL_DRIFT');
  }
  const after = new Map(current.filter(e => !selected(e.path)).map(e => [e.path, e]));
  for (const entry of next.managed) {
    requireSkill(![...after.keys()].some(path => path.toLowerCase() === entry.path.toLowerCase()), 'SKILL_DESTINATION_COLLISION'); after.set(entry.path, entry);
  }
  // Create missing shared ancestors explicitly; preserve existing directory modes.
  for (let parent = posix.dirname(locations.projected); parent !== '.'; parent = posix.dirname(parent)) {
    const existing = after.get(parent);
    requireSkill(![...after.keys()].some(path => path !== parent && path.toLowerCase() === parent.toLowerCase()), 'SKILL_DESTINATION_COLLISION');
    requireSkill(!existing || existing.kind === 'directory', 'SKILL_DESTINATION_COLLISION');
    if (!existing) after.set(parent, { path: parent, kind: 'directory', sha256: null, bytes: 0, mode: 0o700 });
  }
  const afterInventory = inventory([...after.values()]);
  const beforeMap = new Map(current.map(e => [e.path, e])), afterMap = new Map(afterInventory.map(e => [e.path, e]));
  const changes: ManagedSkillPlan['changes'] = [];
  for (const path of [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort()) {
    const before = beforeMap.get(path) ?? null, nextEntry = afterMap.get(path) ?? null;
    if (!same(before, nextEntry)) changes.push({ path, action: before === null ? 'add' : nextEntry === null ? 'remove' : 'change', before, after: nextEntry });
  }
  const snapshotBody = { format: 'bowerloom/synthetic-managed-skill-snapshot/v1beta1' as const, synthetic: true as const, policyVersion: POLICY, source: source.input, target, managedInventory: next.managed, previousRevision: prior?.revision ?? null, executionAuthorized: false as const, writesAuthorized: false as const, grantsAuthority: false as const };
  const proposedState: ManagedSkillSnapshot = { ...snapshotBody, revision: revisionOf(snapshotBody) };
  const changedPaths = new Set(changes.filter(c => c.after?.kind === 'file').map(c => c.path));
  const body = { format: 'bowerloom/synthetic-managed-skill-plan/v1beta1' as const, operation: input.operation as 'install' | 'update', evidence: 'synthetic-caller-supplied' as const, policyVersion: POLICY, target, source, priorRevision: prior?.revision ?? null, beforeInventory: current, afterInventory, changes, writes: next.writes.filter(w => changedPaths.has(w.path)), proposedState, acquisitionVerified: false as const, filesystemObserved: false as const, installationVerified: false as const, executionAuthorized: false as const, writesAuthorized: false as const, grantsAuthority: false as const };
  return freezeSkillData({ ...body, revision: revisionOf(body) });
}
