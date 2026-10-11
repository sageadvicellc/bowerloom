/**
 * Resolves `github:<owner>/<repo>@<commit>:<path>` into a pinned skills.json entry. It reads only the selected skill
 * folder (owner decision, 2026-10-07), through the same public api.github.com reads that acquisition makes, in the same order:
 *   https://api.github.com/repos/<repo>/git/commits/<commit>
 *   https://api.github.com/repos/<repo>/git/trees/<tree>                one per folder on the path, without recursion
 *   https://api.github.com/repos/<repo>/git/trees/<skill tree>?recursive=1
 *   https://api.github.com/repos/<repo>/git/blobs/<sha>                 one per selected file, sorted by sha
 * Each listing is rebuilt to its tree SHA before the next read, so a wrong answer stops the walk early.
 *
 * License: the nearest LICENSE* file, in the skill folder or else beside a folder on the walked path, up to the
 * repository root. Git has no registry field, so the license comes from the exact header of that file. A license
 * outside the skill folder is always a direct child of a walked tree, which the Git planner requires.
 * The proposal is then checked by verifyGitPayload against the same bytes before it is returned.
 */
import { createHash } from 'node:crypto';
import { GIT_LIMITS, GitAcquisitionError, planGitAcquisition, verifyGitPayload } from '../../skill-sources/src/git.js';
import { SkillSourceError } from '../../skill-sources/src/validation.js';
import type { SkillLicense } from '../../skill-sources/src/types.js';
import { isManifestRefusal, manifestRefusal, refuse, requireManifest } from './refusal.js';
import { checkSpec } from './spec.js';
import type { GitSpec } from './spec.js';
import { GIT_HOST, compare, isCommit } from './schema.js';
import type { GitSource, PinnedContent } from './schema.js';
import type { PublicTransport } from './public-get.js';
import { CONTENT_LIMITS, LICENSE_NAME, checkBounds, fetchBytes, fetchedJson, licenseFolders, licenseHeader, pinnedContent, sha256, skillFilePath, text } from './content.js';
import type { SelectedFile } from './content.js';
import { toGitRequest, probeBinding } from './requests.js';

export type ResolvedGit = PinnedContent<GitSource>;
interface Row { path: string; mode: string; type: string; sha: string; size?: number }

const MODES: Readonly<Record<string, string>> = Object.freeze({ '100644': 'blob', '100755': 'blob', '120000': 'blob', '040000': 'tree', '160000': 'commit' });
const objectId = (kind: 'blob' | 'tree', b: Buffer) => createHash('sha1').update(`${kind} ${b.length}\0`).update(b).digest('hex');
const order = (a: { name: string; type: string }, b: { name: string; type: string }) => Buffer.compare(Buffer.from(a.name + (a.type === 'tree' ? '/' : '')), Buffer.from(b.name + (b.type === 'tree' ? '/' : '')));
/** The Git object id of a tree with these rows, the way git.ts rebuilds it. */
function treeId(rows: { name: string; mode: string; type: string; sha: string }[]): string {
  return objectId('tree', Buffer.concat([...rows].sort(order).flatMap(e => [Buffer.from(`${e.type === 'tree' ? '40000' : e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')])));
}
function row(raw: unknown, nested: boolean): Row {
  const e = raw as Row;
  requireManifest(e !== null && typeof e === 'object' && typeof e.path === 'string' && e.path.length > 0 && Buffer.byteLength(e.path) <= (nested ? 512 : 1024) && isCommit(e.sha), 'SKILLS_ADD_UNSAFE_CONTENT');
  requireManifest(nested ? /^[A-Za-z0-9._/-]+$/.test(e.path) && e.path.split('/').every(p => p !== '' && p !== '.' && p !== '..') : !e.path.includes('/') && !e.path.includes('\0') && e.path !== '.' && e.path !== '..', 'SKILLS_ADD_UNSAFE_CONTENT');
  requireManifest(typeof e.mode === 'string' && Object.hasOwn(MODES, e.mode) && MODES[e.mode] === e.type && (e.type === 'blob' ? Number.isSafeInteger(e.size) && e.size! >= 0 : e.size === undefined), 'SKILLS_ADD_UNSAFE_CONTENT');
  return { path: e.path, mode: e.mode, type: e.type, sha: e.sha, ...(e.type === 'blob' ? { size: e.size! } : {}) };
}
function listing(bytes: Buffer, sha: string, nested: boolean): Row[] {
  const v = fetchedJson(bytes, GIT_LIMITS.treeBytes);
  requireManifest(v.sha === sha && v.truncated === false && Array.isArray(v.tree) && v.tree.length > 0 && v.tree.length <= GIT_LIMITS.records, 'SKILLS_ADD_UNSAFE_CONTENT');
  const rows = (v.tree as unknown[]).map(r => row(r, nested)), names = new Set(rows.map(r => nested ? r.path.toLowerCase() : r.path));
  requireManifest(names.size === rows.length, 'SKILLS_ADD_UNSAFE_CONTENT');
  return rows;
}
const parentOf = (p: string) => { const at = p.lastIndexOf('/'); return at < 0 ? '' : p.slice(0, at); };
/** Rebuilds every tree of a recursive listing up to its root SHA. */
function proveRecursive(rows: Row[], root: string): void {
  const byPath = new Map(rows.map(r => [r.path, r])), children = new Map<string, Row[]>([['', []]]);
  for (const r of rows) { const parent = parentOf(r.path); requireManifest(parent === '' || byPath.get(parent)?.type === 'tree', 'SKILLS_ADD_UNSAFE_CONTENT'); children.set(parent, [...(children.get(parent) ?? []), r]); if (r.type === 'tree' && !children.has(r.path)) children.set(r.path, []); }
  for (const [parent, list] of children) requireManifest(treeId(list.map(r => ({ name: r.path.slice(parent ? parent.length + 1 : 0), mode: r.mode, type: r.type, sha: r.sha }))) === (parent ? byPath.get(parent)!.sha : root), 'SKILLS_ADD_UNSAFE_CONTENT');
}
/** A blob response: its content must decode to exactly the bytes its SHA names. */
function blob(bytes: Buffer, id: string, size: number): Buffer {
  const v = fetchedJson(bytes, GIT_LIMITS.blobResponseBytes);
  requireManifest(v.sha === id && v.encoding === 'base64' && v.size === size && typeof v.content === 'string', 'SKILLS_ADD_UNSAFE_CONTENT');
  const b64 = v.content.replace(/\n/g, '');
  requireManifest(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64), 'SKILLS_ADD_UNSAFE_CONTENT');
  const out = Buffer.from(b64, 'base64');
  requireManifest(out.toString('base64') === b64 && out.length === size && objectId('blob', out) === id, 'SKILLS_ADD_UNSAFE_CONTENT');
  return out;
}
const unsafeKind = (r: Row) => { requireManifest(r.mode !== '120000' && r.mode !== '160000' && r.type !== 'commit', 'SKILLS_ADD_UNSAFE_CONTENT'); };

export async function resolveGit(specValue: unknown, transport: PublicTransport, signal: AbortSignal): Promise<ResolvedGit> {
  const spec = checkSpec(specValue, 'github') as GitSpec;
  requireManifest(signal instanceof AbortSignal && !signal.aborted, 'SKILLS_ADD_NETWORK');
  const api = `https://api.github.com/repos/${spec.repository}/git`, segments = spec.path.split('/');

  const metadata = await fetchBytes(transport, `${api}/commits/${spec.commit}`, GIT_LIMITS.metadataBytes, signal);
  const commit = fetchedJson(metadata, GIT_LIMITS.metadataBytes), rootTree = (commit.tree as { sha?: unknown } | null | undefined)?.sha;
  requireManifest(commit.sha === spec.commit && isCommit(rootTree), 'SKILLS_ADD_UNSAFE_CONTENT');

  // The walk: one listing per folder on the path. Each is proved before the next read.
  const listings: Buffer[] = [], pathTrees: string[] = [], outside = new Map<string, Row[]>();
  let current = rootTree;
  for (let level = 0; level < segments.length; level++) {
    const bytes = await fetchBytes(transport, `${api}/trees/${current}`, GIT_LIMITS.treeBytes, signal);
    const rows = listing(bytes, current, false);
    requireManifest(treeId(rows.map(r => ({ name: r.path, mode: r.mode, type: r.type, sha: r.sha }))) === current, 'SKILLS_ADD_UNSAFE_CONTENT');
    const next = rows.find(r => r.path === segments[level]); requireManifest(next, 'SKILLS_ADD_NOT_FOUND');
    unsafeKind(next); requireManifest(next.type === 'tree' && next.mode === '040000', 'SKILLS_ADD_NOT_FOUND');
    outside.set(segments.slice(0, level).join('/'), rows.filter(r => r.type === 'blob' && LICENSE_NAME.test(r.path)));
    listings.push(bytes); pathTrees.push(next.sha); current = next.sha;
  }
  const skillBytes = await fetchBytes(transport, `${api}/trees/${current}?recursive=1`, GIT_LIMITS.treeBytes, signal);
  const rows = listing(skillBytes, current, true); proveRecursive(rows, current); listings.push(skillBytes);
  const blobs = rows.filter(r => r.type === 'blob');
  requireManifest(blobs.some(r => r.path === 'SKILL.md'), 'SKILLS_ADD_SKILL_MISSING');
  for (const r of rows) { unsafeKind(r); if (r.type === 'blob') { requireManifest(r.mode === '100644', 'SKILLS_ADD_UNSAFE_CONTENT'); skillFilePath(r.path); } }
  checkBounds(blobs.map(r => ({ bytes: r.size! })));

  // The nearest folder with a LICENSE* file. Its candidates are read with the skill files, in one sorted pass.
  const inside = blobs.filter(r => !r.path.includes('/') && LICENSE_NAME.test(r.path));
  let folder = spec.path, candidates: { path: string; sourcePath: string; row: Row }[] = inside.map(r => ({ path: r.path, sourcePath: `${spec.path}/${r.path}`, row: r }));
  if (candidates.length === 0) for (const above of licenseFolders(spec.path).slice(1)) {
    const found = outside.get(above) ?? [];
    if (found.length) { folder = above; candidates = found.map(r => ({ path: r.path, sourcePath: above ? `${above}/${r.path}` : r.path, row: r })); break; }
  }
  requireManifest(candidates.length > 0 && candidates.length <= CONTENT_LIMITS.licenseFiles, 'SKILLS_ADD_LICENSE_UNKNOWN');
  const extra = folder === spec.path ? [] : candidates;
  for (const c of extra) { unsafeKind(c.row); requireManifest(c.row.mode === '100644', 'SKILLS_ADD_UNSAFE_CONTENT'); }
  checkBounds([...blobs, ...extra.map(c => c.row)].map(r => ({ bytes: r.size! })));
  const sizes = new Map<string, number>([...blobs, ...extra.map(c => c.row)].map(r => [r.sha, r.size!]));
  const read = new Map<string, { bytes: Buffer; response: Buffer }>();
  for (const id of [...sizes.keys()].sort(compare)) {
    const response = await fetchBytes(transport, `${api}/blobs/${id}`, GIT_LIMITS.blobResponseBytes, signal);
    read.set(id, { bytes: blob(response, id, sizes.get(id)!), response });
  }
  const headers = candidates.map(c => ({ ...c, spdx: licenseHeader(text(read.get(c.row.sha)!.bytes)) })).filter(c => c.spdx !== null);
  const kinds = new Set(headers.map(c => c.spdx));
  requireManifest(headers.length > 0 && kinds.size === 1, 'SKILLS_ADD_LICENSE_UNKNOWN');
  const spdx = [...kinds][0] as SkillLicense;

  const files: (SelectedFile & { sha: string })[] = blobs.map(r => ({ path: r.path, sourcePath: `${spec.path}/${r.path}`, bytes: read.get(r.sha)!.bytes, sha: r.sha }));
  if (folder !== spec.path) for (const c of headers) files.push({ path: c.path, sourcePath: c.sourcePath, bytes: read.get(c.row.sha)!.bytes, sha: c.row.sha });
  const source: GitSource = { kind: 'git', host: GIT_HOST, repository: spec.repository, commit: spec.commit, tree: rootTree, pathTrees, metadataSha256: sha256(metadata) };
  const { texts: _texts, ...content } = pinnedContent(source, spec.path, files.map(({ sha: _sha, ...f }) => f), spdx, headers.map(c => c.path));

  // The existing verifier decides, against the bytes that were read: the listings and only the selected blobs.
  try {
    const plan = planGitAcquisition(toGitRequest({ id: content.skill.name, ...content }), probeBinding());
    const selected = [...new Set(files.map(f => f.sha))].sort(compare);
    const payload = Buffer.from(JSON.stringify({ trees: listings.map(b => b.toString('base64')), blobs: selected.map(id => ({ sha: id, body: read.get(id)!.response.toString('base64') })) }));
    await verifyGitPayload(plan, metadata, payload, signal, () => { if (signal.aborted) throw manifestRefusal('SKILLS_ADD_NETWORK'); });
  } catch (error) { if (isManifestRefusal(error)) throw error; if (error instanceof GitAcquisitionError || error instanceof SkillSourceError) refuse('SKILLS_ADD_UNSAFE_CONTENT'); throw error; }
  return content;
}
