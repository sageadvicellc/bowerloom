import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, dirname, join, parse } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../contracts/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { inspectStartup } from '../../startup/src/index.js';
import { compileCrew } from '../../crew/src/index.js';

const MAX_EXPORT_BYTES = 512 * 1024;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const exportsAllowed = ['brief.json', 'startup-review.md', 'working-agreement.md', 'milestones.md', 'teams/first-team/team.yaml'];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export class ConnectionError extends Error { constructor(public code: string) { super(code); } }
function fail(code: string): never { throw new ConnectionError(code); }
export interface LinkInput { from: string; to: string; file: string; output: string }
type Identity = { device: string; inode: string; birthtimeNs: string; uid: number };
type Root = { path: string; identity: Identity; setupRevision: string; teamRevision: string };
export interface LinkPlan {
  format: 'bowerloom/link/v1alpha1'; input: LinkInput;
  source: Root; recipient: Root; parent: Identity;
  disclosure: { relativePath: string; sha256: string; bytes: number; text: string };
  permissions: { readPinnedDefinition: true; writeSource: false; execute: false; stopSource: false; followLinks: false };
  revision: string;
}
function absolute(value: string): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value !== resolve(value) || value !== value.normalize('NFC') || Buffer.byteLength(value) > 2048 || /[\p{Cc}\p{Cf}]/u.test(value)) fail('LINK_PATH');
  return value;
}
async function directory(path: string, privateOwner = false): Promise<Identity> {
  absolute(path);
  if (await realpath(path) !== path) fail('LINK_SYMLINK');
  // Inspect each ancestor as well as the selected directory.
  for (let current = path;; current = dirname(current)) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('LINK_DIRECTORY');
    if (current === parse(current).root) break;
  }
  const stat = await lstat(path, { bigint: true });
  if (privateOwner && (Number(stat.uid) !== process.getuid?.() || Number(stat.mode) & 0o077)) fail('LINK_PRIVATE_DIRECTORY');
  return { device: String(stat.dev), inode: String(stat.ino), birthtimeNs: String(stat.birthtimeNs), uid: Number(stat.uid) };
}
async function read(path: string, max: number): Promise<Buffer> {
  await directory(dirname(path));
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || before.mode & 0o022 || before.size > max) fail('LINK_UNSAFE_FILE');
    const data = Buffer.alloc(max + 1); let size = 0;
    while (size < data.length) { const chunk = await handle.read(data, size, data.length - size, null); if (!chunk.bytesRead) break; size += chunk.bytesRead; }
    const after = await handle.stat(), current = await lstat(path);
    if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== current.ino || before.dev !== current.dev) fail('LINK_CHANGED');
    return data.subarray(0, size);
  } finally { await handle.close(); }
}
async function absent(path: string): Promise<boolean> {
  try { await lstat(path); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
}
async function root(path: string, sharedFile?: string): Promise<Root> {
  absolute(path);
  const before = await directory(path);
  const result = await inspectStartup(path);
  // An edited export can receive a new disclosure approval. All other setup
  // files and installation bindings must still match their reviewed receipt.
  if (!result.revision || (!result.specReady && (!sharedFile || !result.drift.length || result.drift.some(d => d.kind !== 'changed' || d.path !== `.bowerloom/${sharedFile}`)))) fail('LINK_SETUP_NOT_READY');
  const compiled = await compileCrew(join(path, '.bowerloom/teams/first-team/team.yaml'));
  if (canonicalJson(before) !== canonicalJson(await directory(path))) fail('LINK_ROOT_CHANGED');
  return { path, identity: before, setupRevision: result.revision, teamRevision: compiled.candidateRevision };
}
function input(value: LinkInput): LinkInput {
  if (!value || Object.keys(value).sort().join() !== 'file,from,output,to' || !exportsAllowed.includes(value.file)) fail('LINK_EXPORT_NOT_ALLOWED');
  const result = { from: absolute(value.from), to: absolute(value.to), file: value.file, output: absolute(value.output) };
  if (result.from === result.to) fail('LINK_DISTINCT_ROOTS');
  // Private connection state cannot alter either portable setup or its project.
  for (const selected of [result.from, result.to]) if (result.output === selected || result.output.startsWith(selected + '/')) fail('LINK_OUTPUT_INSIDE_ROOT');
  return result;
}
async function body(value: LinkInput): Promise<Omit<LinkPlan, 'revision'>> {
  const normalized = input(value);
  const source = await root(normalized.from, normalized.file), recipient = await root(normalized.to);
  const parent = await directory(dirname(normalized.output), true);
  const bytes = await read(join(source.path, '.bowerloom', normalized.file), MAX_EXPORT_BYTES);
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('LINK_UTF8'); }
  if (/[\p{Cc}\p{Cf}]/u.test(text.replace(/\r\n|[\t\n]/g, ''))) fail('LINK_UNSAFE_TEXT');
  // Reinspect after disclosure reads so a concurrent source edit cannot be approved.
  if (canonicalJson(source) !== canonicalJson(await root(source.path, normalized.file)) || canonicalJson(recipient) !== canonicalJson(await root(recipient.path))) fail('LINK_ROOT_CHANGED');
  return { format: 'bowerloom/link/v1alpha1', input: normalized, source, recipient, parent,
    disclosure: { relativePath: normalized.file, sha256: hash(bytes), bytes: bytes.length, text },
    permissions: { readPinnedDefinition: true, writeSource: false, execute: false, stopSource: false, followLinks: false } };
}
export async function planLink(value: LinkInput): Promise<LinkPlan> {
  const result = await body(value);
  if (!await absent(result.input.output) || !await absent(result.input.output + '.revoked')) fail('LINK_OUTPUT_EXISTS');
  return { ...result, revision: hash(canonicalJson(result)) };
}
export async function applyLink(value: LinkInput, approval: string): Promise<LinkPlan> {
  if (!/^[a-f0-9]{64}$/.test(approval)) fail('LINK_EXACT_APPROVAL_REQUIRED');
  const plan = await planLink(value);
  if (plan.revision !== approval) fail('LINK_STALE_APPROVAL');
  const handle = await open(plan.input.output, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(plan, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
  return plan;
}
async function receipt(path: string): Promise<LinkPlan> {
  absolute(path); await directory(dirname(path), true);
  const data = await read(path, MAX_RECEIPT_BYTES);
  let parsed: LinkPlan;
  try { parsed = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(data), MAX_RECEIPT_BYTES) as LinkPlan; } catch { return fail('LINK_RECEIPT'); }
  if (parsed?.input?.output !== path || !/^[a-f0-9]{64}$/.test(parsed.revision ?? '')) fail('LINK_RECEIPT');
  const { revision, ...record } = parsed;
  if (hash(canonicalJson(record)) !== revision) fail('LINK_RECEIPT');
  return parsed;
}
export async function readLink(path: string, target: string): Promise<{ source: string; target: string; file: string; text: string; revision: string; executionAuthorized: false }> {
  const approved = await receipt(path);
  if (absolute(target) !== approved.input.to) fail('LINK_WRONG_RECIPIENT');
  if (!await absent(path + '.revoked')) fail('LINK_REVOKED');
  const current = await body(approved.input);
  if (canonicalJson({ ...current, revision: hash(canonicalJson(current)) }) !== canonicalJson(approved)) fail('LINK_CHANGED');
  if (!await absent(path + '.revoked')) fail('LINK_REVOKED');
  return { source: approved.input.from, target, file: approved.input.file, text: current.disclosure.text, revision: approved.revision, executionAuthorized: false };
}
export async function revokeLink(path: string): Promise<{ revoked: true; revision: string; preserved: true }> {
  const approved = await receipt(path);
  try {
    const handle = await open(path + '.revoked', constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(JSON.stringify({ revision: approved.revision, revoked: true }) + '\n'); await handle.sync(); } finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return { revoked: true, revision: approved.revision, preserved: true };
}
export function renderLinkReview(plan: LinkPlan): string {
  return `Connection review\n\nFrom: ${plan.input.from}\nTo: ${plan.input.to}\nShare: .bowerloom/${plan.input.file}\n\nApproval lets the receiving team read this exact file through Bowerloom.\nIt grants no source writes, execution, emergency-stop access, or access through other links.\nThe command saves one private receipt at ${plan.input.output}. Both projects stay unchanged.\n\nShared contents:\n${plan.disclosure.text}\n\nApproval revision: ${plan.revision}\n`;
}
