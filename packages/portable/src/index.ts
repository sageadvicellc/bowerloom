import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

export const SCHEMA_VERSION = 'bowerloom/v1alpha1' as const;
export const ADAPTER_VERSION = 'codex/local-skills/v1alpha1' as const;
export const LIMITS = { parts: 32, files: 128, fileBytes: 65536, totalBytes: 2097152 } as const;
export class PortableError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'PortableError'; }
}
const fail = (code: string): never => { throw new PortableError(code); };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export interface PortablePart { id: string; kind: 'skill' | 'team'; files: string[]; dependsOn: string[]; requiredControls?: string[] }
export interface BundleManifest { schemaVersion: typeof SCHEMA_VERSION; parts: PortablePart[] }
export interface FileDigest { path: string; sha256: string; bytes: number }
export interface BundleValidation { schemaVersion: typeof SCHEMA_VERSION; manifest: BundleManifest; manifestSha256: string; files: FileDigest[]; bundleRevision: string; executionAuthorized: false }
export interface InstallationInput { bundleDir: string; selected: string[]; harness: string; targetDir: string }
export interface Projection extends FileDigest { partId: string; targetPath: string }
export interface InstallationPlan {
  schemaVersion: typeof SCHEMA_VERSION; adapterVersion: typeof ADAPTER_VERSION; harness: 'codex'; targetDir: string;
  selected: string[]; dependencies: string[]; parts: string[]; bundleRevision: string; manifestSha256: string;
  files: Projection[]; generatedFiles: string[]; controlScope: 'installer-only'; executionAuthorized: false; revision: string;
}
export interface InstallationReceipt { schemaVersion: typeof SCHEMA_VERSION; adapterVersion: typeof ADAPTER_VERSION; plan: InstallationPlan; installedFiles: FileDigest[]; executionAuthorized: false }
const ID = /^[a-z][a-z0-9-]{0,47}$/;
const allowedControls = new Set(['installer-local-files-only', 'installer-explicit-review']);
function exact(value: unknown, keys: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('MANIFEST_SHAPE');
  const record = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(record, key)) || Object.keys(record).some(key => !keys.includes(key) && !optional.includes(key))) fail('UNSUPPORTED_FIELD_OR_CONTROL');
}
function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string') || new Set(value).size !== value.length) fail('INVALID_LIST');
  return [...(value as string[])];
}
function safePath(path: string): void {
  if (path.length > 240 || path.includes('\\') || isAbsolute(path) || !/^[A-Za-z0-9_./-]+$/.test(path)
    || path.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))
    || !/\.(md|txt|json|yaml|yml|csv)$/i.test(path)
    || /(^|[/_.-])(secrets?|credentials?|tokens?|passwords?|id_rsa|private[_-]?keys?)([./_-]|$)/i.test(path)
    || /(^|\/)(hooks?|scripts?|node_modules|\.git)(\/|$)/i.test(path)) fail('UNSAFE_SOURCE_PATH');
}
function noSymlinkAncestors(path: string, allowMissingLeaf = false): void {
  const full = resolve(path), parsed = full.split(sep);
  let current: string = sep;
  for (let i = 1; i < parsed.length; i++) {
    current = join(current, parsed[i]!);
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if (allowMissingLeaf && i === parsed.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      fail('PATH_UNAVAILABLE');
    }
    if (stat!.isSymbolicLink()) fail('SYMLINK_FORBIDDEN');
    if (i < parsed.length - 1 && !stat!.isDirectory()) fail('ANCESTOR_NOT_DIRECTORY');
  }
}
function readText(path: string): string {
  noSymlinkAncestors(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > LIMITS.fileBytes || before.nlink !== 1 || (before.mode & 0o111) !== 0) fail('UNSAFE_SOURCE_FILE');
    const buffer = Buffer.alloc(LIMITS.fileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const bytes = buffer.subarray(0, length);
    const after = fstatSync(fd);
    if (bytes.length > LIMITS.fileBytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('SOURCE_CHANGED');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail('SOURCE_NOT_UTF8'); }
    if (text!.includes('\0') || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(text!)) fail('SECRET_OR_BINARY_CONTENT');
    return text!;
  } finally { closeSync(fd); }
}
function snapshot(bundleDir: string): { validation: BundleValidation; texts: Map<string, string> } {
  if (typeof bundleDir !== 'string' || !bundleDir) fail('BUNDLE_DIRECTORY_REQUIRED');
  const root = resolve(bundleDir, '.bowerloom');
  const raw = readText(join(root, 'manifest.json'));
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail('MANIFEST_JSON'); }
  exact(value, ['schemaVersion', 'parts']);
  if (value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.parts) || !value.parts.length || value.parts.length > LIMITS.parts) fail('UNSUPPORTED_SCHEMA');
  const ids = new Set<string>(), paths = new Set<string>(), texts = new Map<string, string>();
  const parts: PortablePart[] = [];
  let total = Buffer.byteLength(raw);
  for (const candidate of value.parts as unknown[]) {
    exact(candidate, ['id', 'kind', 'files', 'dependsOn'], ['requiredControls']);
    if (typeof candidate.id !== 'string' || !ID.test(candidate.id) || ids.has(candidate.id) || typeof candidate.kind !== 'string' || !['skill', 'team'].includes(candidate.kind)) fail('INVALID_PART');
    ids.add(candidate.id as string);
    const files = strings(candidate.files, LIMITS.files), deps = strings(candidate.dependsOn, LIMITS.parts);
    const controls = candidate.requiredControls === undefined ? [] : strings(candidate.requiredControls, 8);
    if (controls.some(control => !allowedControls.has(control))) fail('UNSUPPORTED_CONTROL');
    if (!files.length || deps.some(dep => !ID.test(dep))) fail('INVALID_PART');
    const prefix = `${candidate.kind === 'skill' ? 'skills' : 'teams'}/${candidate.id}/`;
    if (candidate.kind === 'skill' && !files.includes(`${prefix}SKILL.md`)) fail('SKILL_ENTRY_REQUIRED');
    for (const file of files) {
      safePath(file);
      if (!file.startsWith(prefix) || paths.has(file.toLowerCase())) fail('SOURCE_PATH_COLLISION');
      paths.add(file.toLowerCase());
      if (paths.size > LIMITS.files) fail('BUNDLE_FILE_LIMIT');
      const text = readText(join(root, file)); total += Buffer.byteLength(text);
      if (total > LIMITS.totalBytes) fail('BUNDLE_BYTE_LIMIT');
      texts.set(file, text);
    }
    parts.push({ id: candidate.id as string, kind: candidate.kind as 'skill' | 'team', files: [...files].sort(), dependsOn: [...deps].sort(), requiredControls: [...controls].sort() });
  }
  const byId = new Map(parts.map(part => [part.id, part]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) fail('DEPENDENCY_CYCLE');
    if (visited.has(id)) return;
    const part = byId.get(id); if (!part) fail('MISSING_DEPENDENCY');
    visiting.add(id); for (const dep of part!.dependsOn) visit(dep); visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
  const manifest: BundleManifest = { schemaVersion: SCHEMA_VERSION, parts: parts.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
  const files = [...texts].map(([path, text]) => ({ path, sha256: hash(text), bytes: Buffer.byteLength(text) })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const body = { schemaVersion: SCHEMA_VERSION, manifest, manifestSha256: hash(raw), files, executionAuthorized: false as const };
  return { validation: { ...body, bundleRevision: hash(canonical(body)) }, texts };
}
export function validateBundle(bundleDir: string): BundleValidation { return snapshot(bundleDir).validation; }
function targetPath(input: InstallationInput): string {
  if (typeof input.targetDir !== 'string' || !isAbsolute(input.targetDir)) fail('ABSOLUTE_TARGET_REQUIRED');
  const target = resolve(input.targetDir), home = resolve(homedir()), source = resolve(input.bundleDir);
  const foldedTarget = target.normalize('NFC').toLowerCase(), foldedHome = home.normalize('NFC').toLowerCase(), foldedSource = source.normalize('NFC').toLowerCase();
  if (foldedTarget === foldedHome || target === sep || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(basename(target))
    || ['/usr', '/etc', '/bin', '/sbin', '/opt', '/System', '/Library', '/Applications'].some(path => foldedTarget === path.toLowerCase() || foldedTarget.startsWith(path.toLowerCase() + sep))
    || foldedTarget === foldedSource || foldedTarget.startsWith(foldedSource + sep) || foldedSource.startsWith(foldedTarget + sep)
    || target.split(sep).some(segment => ['.agents', '.codex', '.config', '.git', 'node_modules'].includes(segment.toLowerCase()))) fail('UNSAFE_TARGET');
  noSymlinkAncestors(target, true);
  if (existsSync(target)) fail('TARGET_EXISTS');
  const parent = lstatSync(dirname(target));
  if (!parent.isDirectory() || (typeof process.getuid === 'function' && parent.uid !== process.getuid()) || (parent.mode & 0o022) !== 0) fail('TARGET_PARENT_NOT_PRIVATE');
  return target;
}
function makePlan(input: InstallationInput, validation: BundleValidation): InstallationPlan {
  if (input.harness !== 'codex') fail('UNSUPPORTED_HARNESS');
  const selected = strings(input.selected, LIMITS.parts).sort(); if (!selected.length) fail('SELECTION_REQUIRED');
  const targetDir = targetPath(input), byId = new Map(validation.manifest.parts.map(part => [part.id, part])), closure = new Set<string>();
  const include = (id: string) => { const part = byId.get(id); if (!part) fail('UNKNOWN_PART'); if (closure.has(id)) return; closure.add(id); part!.dependsOn.forEach(include); };
  selected.forEach(include);
  const parts = [...closure].sort();
  const files: Projection[] = parts.flatMap(id => {
    const part = byId.get(id)!;
    const prefix = `${part.kind === 'skill' ? 'skills' : 'teams'}/${id}/`;
    return part.files.map(path => ({ ...validation.files.find(file => file.path === path)!, partId: id,
      targetPath: `${part.kind === 'skill' ? `.agents/skills/bowerloom-${id}` : `.bowerloom/teams/${id}`}/${path.slice(prefix.length)}` }));
  });
  const body = { schemaVersion: SCHEMA_VERSION, adapterVersion: ADAPTER_VERSION, harness: 'codex' as const, targetDir, selected,
    dependencies: parts.filter(id => !selected.includes(id)), parts, bundleRevision: validation.bundleRevision, manifestSha256: validation.manifestSha256,
    files, generatedFiles: ['START-HERE.md', '.bowerloom/installation-receipt.json'], controlScope: 'installer-only' as const, executionAuthorized: false as const };
  return { ...body, revision: hash(canonical(body)) };
}
export function planInstallation(input: InstallationInput): InstallationPlan { return makePlan(input, snapshot(input.bundleDir).validation); }
export function installBundle(input: InstallationInput, approvalRevision: string): InstallationReceipt {
  if (typeof approvalRevision !== 'string' || !/^[a-f0-9]{64}$/.test(approvalRevision)) fail('EXACT_APPROVAL_REQUIRED');
  const source = snapshot(input.bundleDir), plan = makePlan(input, source.validation);
  if (plan.revision !== approvalRevision) fail('STALE_APPROVAL');
  const target = plan.targetDir, parent = dirname(target), lock = join(parent, `.bowerloom-install-${basename(target)}.lock`);
  let lockFd: number;
  try { lockFd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); } catch { fail('INSTALL_LOCKED'); }
  const stage = join(parent, `.bowerloom-stage-${randomUUID()}`);
  let staged = false;
  try {
    targetPath(input);
    mkdirSync(stage, { mode: 0o700 }); staged = true;
    for (const file of plan.files) {
      const destination = join(stage, file.targetPath);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, source.texts.get(file.path)!, { flag: 'wx', mode: 0o600 });
    }
    const start = `# Bowerloom local installation\n\nThis workspace contains selected portable parts for Codex.\n\nPlan revision: ${plan.revision}\nBundle revision: ${plan.bundleRevision}\nSchema: ${SCHEMA_VERSION}\nAdapter: ${ADAPTER_VERSION}\n\nSelected: ${plan.selected.join(', ')}\nDependencies: ${plan.dependencies.join(', ') || 'none'}\n\nSkill projections are under .agents/skills/. Codex can discover these instructions when you open this workspace. Review SKILL.md before invoking a skill.\n\nTeam definitions under .bowerloom/teams/ are data. This installer does not execute teams, start workers, grant permissions, or approve actions. Installation approval authorizes only these new files. Declared installer controls do not enforce future Codex skill behavior. Review instructions before use and retain the personal agent permission controls.\n\nOrigin hashes and projections are in .bowerloom/installation-receipt.json. No global or home configuration changed.\n`;
    writeFileSync(join(stage, 'START-HERE.md'), start, { flag: 'wx', mode: 0o600 });
    const receipt: InstallationReceipt = { schemaVersion: SCHEMA_VERSION, adapterVersion: ADAPTER_VERSION, plan,
      installedFiles: [...plan.files.map(file => ({ path: file.targetPath, sha256: file.sha256, bytes: file.bytes })), { path: 'START-HERE.md', sha256: hash(start), bytes: Buffer.byteLength(start) }], executionAuthorized: false };
    mkdirSync(join(stage, '.bowerloom'), { recursive: true, mode: 0o700 });
    writeFileSync(join(stage, '.bowerloom/installation-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const fresh = snapshot(input.bundleDir);
    if (makePlan(input, fresh.validation).revision !== approvalRevision) fail('SOURCE_CHANGED');
    noSymlinkAncestors(parent);
    renameSync(stage, target); staged = false;
    return receipt;
  } finally {
    if (staged) rmSync(stage, { recursive: true, force: true });
    closeSync(lockFd!); rmSync(lock, { force: true });
  }
}
