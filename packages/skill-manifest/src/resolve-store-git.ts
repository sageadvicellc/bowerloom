/**
 * Authored store items on github.com (spec 06, 3.10 and 3.11): a skill, prompt, or team written in the store, at one
 * commit of the store's git remote. Bowerloom never runs git. It reads the public api.github.com, through the shared
 * public transport, one transport for the whole item:
 *   GET /repos/<o>/<r>/git/commits/<commit>
 *   GET /repos/<o>/<r>/git/trees/<root>                    the top folder: skills, teams, or prompts
 *   GET /repos/<o>/<r>/git/trees/<area>                    the item folder (skill, team), or the prompt file (prompt)
 *   GET /repos/<o>/<r>/git/trees/<item>?recursive=1        skill and team only; a prompt reads its area listing again
 *   GET /repos/<o>/<r>/git/blobs/<sha>                     one per distinct blob
 * Each listing is rebuilt to its tree id before the next read. Every file passes the store file rules a lock can record.
 * Fetched text is data only: it is hashed and copied, never followed or run.
 *
 * This module does not read the store. Its policy is narrower than skill-sources/src/git.ts, which takes only licensed
 * skills: a skill from `skill create` has no license, and a prompt or a team is not a skill.
 */
import { GIT_LIMITS } from '../../skill-sources/src/git.js';
import { revisionOf } from '../../skill-sources/src/validation.js';
import { blob, listing, proveRecursive, treeId, unsafeKind } from './resolve-git.js';
import type { Row } from './resolve-git.js';
import { STORE_FILE_LIMITS, fetchBytes, fetchedJson, sha256, skillFilePath, text } from './content.js';
import { isManifestRefusal, manifestRefusal, refuse, requireManifest } from './refusal.js';
import { compare, isCommit } from './schema.js';
import type { PublicTransport } from './public-get.js';
import { GITHUB_REMOTE as REMOTE } from './github-repository.js';

/** Where an authored store item's bytes come from, and the hash that proves them (spec 06, 4.1). */
export interface AuthoredPin {
  remote: string; commit: string; path: string; tree: string;
  files: { path: string; sha256: string; bytes: number }[];
  hash: string;
  teams?: string[];
}
export type AuthoredKind = 'skill' | 'prompt' | 'team';
/**
 * Section 12, item 11 of spec 06 (the named fallback, applied): blobs are read in groups of 40. The first transport carries
 * the 4 metadata requests and the first 40 blobs; `next`, when given, makes a new transport for each further group, for
 * the same approved host, and each is closed after its group. Without `next`, one transport serves the whole item.
 */
export const BLOBS_PER_TRANSPORT = 40;
export type NextTransport = () => PublicTransport & { close(): void };
export interface AuthoredFetch { tree: string; files: { path: string; bytes: Buffer }[] }
export interface AuthoredTarget { remote: string; commit: string; kind: AuthoredKind; id: string }
/** The object id the item must have at the commit (the lock's `tree`), and the refusal of another one. */
export interface ExpectedTree { sha: string; refuse: () => never }

/** The path of an item in the store repository, relative to its root. */
export const authoredPath = (kind: AuthoredKind, id: string): string => kind === 'prompt' ? `prompts/${id}.md` : `${kind}s/${id}`;
/** The inventory rows of an item's files, sorted by path in byte order, and their hash: revisionOf(rows). */
export function authoredRows(files: readonly { path: string; bytes: Buffer }[]): { rows: AuthoredPin['files']; hash: string } {
  const rows = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))).map(f => ({ path: f.path, sha256: sha256(f.bytes), bytes: f.bytes.length }));
  return { rows, hash: revisionOf(rows) };
}
/** The api.github.com base of a normal remote, or a refusal. */
function apiOf(remote: string): string {
  const m = typeof remote === 'string' ? REMOTE.exec(remote) : null;
  requireManifest(m !== null && m[2] !== '.' && m[2] !== '..', 'SKILLS_ADD_HOST_REFUSED');
  return `https://api.github.com/repos/${m[1]}/${m[2]}/git`;
}
function target(value: AuthoredTarget): { api: string; segments: [string, string]; kind: AuthoredKind; id: string; commit: string } {
  requireManifest(value !== null && typeof value === 'object' && isCommit(value.commit) && ['skill', 'prompt', 'team'].includes(value.kind) && typeof value.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) && value.id.length <= 64, 'SKILLS_ADD_SPEC_INVALID');
  const area = value.kind === 'prompt' ? 'prompts' : `${value.kind}s`;
  return { api: apiOf(value.remote), segments: [area, value.kind === 'prompt' ? `${value.id}.md` : value.id], kind: value.kind, id: value.id, commit: value.commit };
}
/** One listing of `sha`, proved: its rows rebuild to `sha`. */
async function folder(transport: PublicTransport, api: string, sha: string, signal: AbortSignal): Promise<Row[]> {
  const rows = listing(await fetchBytes(transport, `${api}/trees/${sha}`, GIT_LIMITS.treeBytes, signal), sha, false);
  requireManifest(treeId(rows.map(r => ({ name: r.path, mode: r.mode, type: r.type, sha: r.sha }))) === sha, 'SKILLS_ADD_UNSAFE_CONTENT');
  return rows;
}

/**
 * The commit and the walk to the item, steps 1 and 2 of 3.11. Returns the item's object id and its rows (one row for a
 * prompt), or null when a segment row is missing at that commit.
 */
async function walk(transport: PublicTransport, t: ReturnType<typeof target>, signal: AbortSignal, onCommitMissing: () => never = () => refuse('SKILLS_ADD_NOT_FOUND'), expected?: ExpectedTree): Promise<{ sha: string; rows: Row[] } | null> {
  let metadata: Buffer;
  try { metadata = await fetchBytes(transport, `${t.api}/commits/${t.commit}`, GIT_LIMITS.metadataBytes, signal); }
  catch (error) { if (isManifestRefusal(error) && error.code === 'SKILLS_ADD_NOT_FOUND') onCommitMissing(); throw error; }
  const commit = fetchedJson(metadata, GIT_LIMITS.metadataBytes);
  const root = (commit.tree as { sha?: unknown } | null | undefined)?.sha;
  requireManifest(commit.sha === t.commit && isCommit(root), 'SKILLS_ADD_UNSAFE_CONTENT');
  const top = await folder(transport, t.api, root, signal), areaRow = top.find(r => r.path === t.segments[0]);
  if (areaRow === undefined) return null;
  unsafeKind(areaRow); requireManifest(areaRow.type === 'tree' && areaRow.mode === '040000', 'SKILLS_ADD_UNSAFE_CONTENT');
  const area = await folder(transport, t.api, areaRow.sha, signal), itemRow = area.find(r => r.path === t.segments[1]);
  if (itemRow === undefined) return null;
  // Second review L1: an item whose object id is not the one the lock names stops here, before its listing and its blobs.
  if (expected !== undefined && itemRow.sha !== expected.sha) expected.refuse();
  unsafeKind(itemRow);
  if (t.kind === 'prompt') {
    // A prompt is exactly one file: a blob of mode 100644, never a folder.
    requireManifest(itemRow.type === 'blob' && itemRow.mode === '100644', 'SKILLS_ADD_UNSAFE_CONTENT');
    return { sha: itemRow.sha, rows: [{ ...itemRow }] };
  }
  requireManifest(itemRow.type === 'tree' && itemRow.mode === '040000', 'SKILLS_ADD_UNSAFE_CONTENT');
  const rows = listing(await fetchBytes(transport, `${t.api}/trees/${itemRow.sha}?recursive=1`, GIT_LIMITS.treeBytes, signal), itemRow.sha, true);
  proveRecursive(rows, itemRow.sha);
  return { sha: itemRow.sha, rows };
}

/**
 * Steps 4 to 7 of 3.11: every row of the item is safe, every blob is mode 100644 with a path a lock can record, the
 * item is within the limits, a skill holds SKILL.md and a team team.yaml, and each distinct blob is read once.
 */
async function files(transport: PublicTransport, t: ReturnType<typeof target>, item: { sha: string; rows: Row[] }, signal: AbortSignal, next?: NextTransport): Promise<AuthoredFetch> {
  const blobs = item.rows.filter(r => r.type === 'blob');
  for (const r of item.rows) { unsafeKind(r); if (r.type === 'blob') { requireManifest(r.mode === '100644', 'SKILLS_ADD_UNSAFE_CONTENT'); skillFilePath(t.kind === 'prompt' ? `${t.id}.md` : r.path); } }
  let total = 0;
  requireManifest(blobs.length > 0 && blobs.length <= STORE_FILE_LIMITS.files, 'SKILLS_ADD_UNSAFE_CONTENT');
  for (const r of blobs) requireManifest(Number.isSafeInteger(r.size) && r.size! > 0 && r.size! <= STORE_FILE_LIMITS.fileBytes && (total += r.size!) <= STORE_FILE_LIMITS.totalBytes, 'SKILLS_ADD_UNSAFE_CONTENT');
  if (t.kind === 'skill') requireManifest(blobs.some(r => r.path === 'SKILL.md'), 'SKILLS_ADD_UNSAFE_CONTENT');
  if (t.kind === 'team') requireManifest(blobs.some(r => r.path === 'team.yaml'), 'SKILLS_ADD_UNSAFE_CONTENT');
  const sizes = new Map(blobs.map(r => [r.sha, r.size!])), read = new Map<string, Buffer>(), ids = [...sizes.keys()].sort(compare);
  for (let group = 0; group * BLOBS_PER_TRANSPORT < ids.length; group++) {
    const own = group > 0 && next !== undefined ? next() : null, through = own ?? transport;
    try {
      for (const id of ids.slice(group * BLOBS_PER_TRANSPORT, (group + 1) * BLOBS_PER_TRANSPORT)) {
        const bytes = blob(await fetchBytes(through, `${t.api}/blobs/${id}`, GIT_LIMITS.blobResponseBytes, signal), id, sizes.get(id)!);
        text(bytes); read.set(id, bytes);
      }
    } finally { own?.close(); }
  }
  const out = blobs.map(r => ({ path: t.kind === 'prompt' ? `${t.id}.md` : r.path, bytes: read.get(r.sha)! }));
  return { tree: item.sha, files: out.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))) };
}

/**
 * Fetches one authored item at one commit (3.11). One transport serves the whole item: 4 requests plus one per distinct
 * blob for a skill or a team, 4 plus one for a prompt. A missing segment row is SKILLS_ADD_NOT_FOUND. Every refusal is a
 * manifest refusal: the transport's codes pass through.
 */
export async function fetchAuthored(transport: PublicTransport, value: AuthoredTarget, signal: AbortSignal, next?: NextTransport, expected?: ExpectedTree): Promise<AuthoredFetch> {
  const t = target(value);
  requireManifest(signal instanceof AbortSignal && !signal.aborted, 'SKILLS_ADD_NETWORK');
  const item = await walk(transport, t, signal, undefined, expected);
  if (item === null) return refuse('SKILLS_ADD_NOT_FOUND');
  return files(transport, t, item, signal, next);
}

export type ProveOutcome = { outcome: 'proved'; pin: AuthoredPin } | { outcome: 'not-pushed' } | { outcome: 'commit-missing' };
/**
 * Proves an authored item at a commit (3.10): fetches it and compares its hash with `localHash`, the hash of the live
 * store item. A 404 on the commit request is `commit-missing`; a missing item path, or another hash, is `not-pushed`.
 * It throws only manifest refusals. It does not read the store; `teams` is the item's tag, copied into the pin.
 */
export async function proveAuthored(transport: PublicTransport, value: AuthoredTarget & { teams?: string[] }, localHash: string, signal: AbortSignal, next?: NextTransport): Promise<ProveOutcome> {
  const t = target(value);
  requireManifest(signal instanceof AbortSignal && !signal.aborted, 'SKILLS_ADD_NETWORK');
  // A 404 on the commit request is an unknown commit or a private repository. A 404 later is thrown, and change.ts maps it.
  const missing = Symbol('commit-missing');
  let item: { sha: string; rows: Row[] } | null;
  try { item = await walk(transport, t, signal, () => { throw missing; }); }
  catch (error) { if (error === missing) return { outcome: 'commit-missing' }; throw isManifestRefusal(error) ? error : manifestRefusal('SKILLS_ADD_NETWORK'); }
  if (item === null) return { outcome: 'not-pushed' };
  const fetched = await files(transport, t, item, signal, next), { rows, hash } = authoredRows(fetched.files);
  if (hash !== localHash) return { outcome: 'not-pushed' };
  const teams = value.teams !== undefined && t.kind !== 'team' ? [...value.teams].sort(compare) : undefined;
  return { outcome: 'proved', pin: { remote: value.remote, commit: t.commit, path: authoredPath(t.kind, t.id), tree: fetched.tree, files: rows, hash, ...(teams && teams.length ? { teams } : {}) } };
}
