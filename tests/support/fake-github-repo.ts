// A Git repository as the GitHub REST API shows it, for tests of spec 06. Not a test file, and not part of the product.
//
// buildFakeRepo(owner, repo, files, commit, dir) computes real git object ids, as resolve-git.ts rebuilds them: a blob
// id is SHA-1 of `blob <len>\0<bytes>`, a tree id is SHA-1 of its sorted rows. It writes one fixture file per API URL
// into `dir`, a folder the caller made and removes (this helper makes none), and returns:
//   commit     the commit sha given
//   tree       the root tree id
//   routes     each `https://api.github.com/repos/<o>/<r>/git/...` URL mapped to its fixture file, for
//              tests/support/fake-network.ts through TEST_FAKE_NETWORK_PLAN
//   responses  the same URLs mapped to their bytes, for a fake PublicTransport in process
//   treeAt     the tree id of a folder ('' is the root)
//   blobId     the blob id of a text
// A file value is its text, or { text, mode } for another mode, { link } for a symlink, { submodule: true } for a gitlink.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type FakeFile = string | { text: string; mode?: string } | { link: string } | { submodule: true };
export interface FakeRepo {
  commit: string; tree: string; routes: Record<string, string>; responses: Map<string, Buffer>;
  treeAt(dir: string): string; blobId(text: string | Buffer): string;
}
interface Row { name: string; type: 'blob' | 'tree' | 'commit'; mode: string; sha: string; size?: number; dir?: string }

const oid = (kind: string, bytes: Buffer): string => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
const order = (a: Row, b: Row): number => Buffer.compare(Buffer.from(a.name + (a.type === 'tree' ? '/' : '')), Buffer.from(b.name + (b.type === 'tree' ? '/' : '')));

export function buildFakeRepo(owner: string, repo: string, files: Readonly<Record<string, FakeFile>>, commit: string, dir: string): FakeRepo {
  const out = dir;
  const dirs = new Map<string, Row[]>([['', []]]), blobs = new Map<string, Buffer>();
  const parentOf = (p: string): string => { const d = path.posix.dirname(p); return d === '.' ? '' : d; };
  const ensure = (d: string): void => {
    if (dirs.has(d)) return;
    dirs.set(d, []); const parent = parentOf(d); ensure(parent);
    dirs.get(parent)!.push({ name: path.posix.basename(d), type: 'tree', mode: '040000', sha: '', dir: d });
  };
  for (const [p, value] of Object.entries(files)) {
    const parent = parentOf(p), name = path.posix.basename(p); ensure(parent);
    if (typeof value === 'object' && 'submodule' in value) { dirs.get(parent)!.push({ name, type: 'commit', mode: '160000', sha: createHash('sha1').update(`submodule ${p}`).digest('hex') }); continue; }
    const bytes = Buffer.from(typeof value === 'string' ? value : 'link' in value ? value.link : value.text), sha = oid('blob', bytes);
    blobs.set(sha, bytes);
    const mode = typeof value === 'string' ? '100644' : 'link' in value ? '120000' : value.mode ?? '100644';
    dirs.get(parent)!.push({ name, type: 'blob', mode, sha, size: bytes.length });
  }
  const trees = new Map<string, { sha: string; rows: Row[] }>();
  const build = (d: string): string => {
    const rows = dirs.get(d)!.map(e => e.type === 'tree' ? { ...e, sha: build(e.dir!) } : e).sort(order);
    const sha = oid('tree', Buffer.concat(rows.flatMap(e => [Buffer.from(`${e.type === 'tree' ? '40000' : e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')])));
    trees.set(d, { sha, rows }); return sha;
  };
  const root = build('');
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const row = (e: Row, p: string) => ({ path: p, mode: e.mode, type: e.type, sha: e.sha, ...(e.type === 'blob' ? { size: e.size } : {}), url: `${api}/git/${e.type === 'tree' ? 'trees' : 'blobs'}/${e.sha}` });
  const responses = new Map<string, Buffer>();
  const who = { name: 'Synthetic', email: 'synthetic@example.invalid', date: '2026-10-01T00:00:00Z' };
  responses.set(`${api}/git/commits/${commit}`, Buffer.from(JSON.stringify({ sha: commit, node_id: 'C_synthetic', url: `${api}/git/commits/${commit}`, author: who, committer: who, tree: { sha: root, url: `${api}/git/trees/${root}` }, message: 'Synthetic store commit.', parents: [] })));
  for (const [d, t] of trees) {
    responses.set(`${api}/git/trees/${t.sha}`, Buffer.from(JSON.stringify({ sha: t.sha, url: `${api}/git/trees/${t.sha}`, tree: t.rows.map(e => row(e, e.name)), truncated: false })));
    const all: ReturnType<typeof row>[] = [];
    const walk = (at: string, prefix: string): void => { for (const e of trees.get(at)!.rows) { all.push(row(e, prefix + e.name)); if (e.type === 'tree') walk(e.dir!, `${prefix}${e.name}/`); } };
    walk(d, '');
    responses.set(`${api}/git/trees/${t.sha}?recursive=1`, Buffer.from(JSON.stringify({ sha: t.sha, url: `${api}/git/trees/${t.sha}`, tree: all, truncated: false })));
  }
  for (const [sha, bytes] of blobs) {
    const content = bytes.toString('base64').replace(/.{1,60}/g, line => `${line}\n`);
    responses.set(`${api}/git/blobs/${sha}`, Buffer.from(JSON.stringify({ sha, node_id: 'B_synthetic', size: bytes.length, url: `${api}/git/blobs/${sha}`, content, encoding: 'base64' })));
  }
  const routes: Record<string, string> = {};
  let n = 0;
  for (const [url, bytes] of responses) { const file = path.join(out, `route-${String(n++).padStart(5, '0')}.json`); fs.writeFileSync(file, bytes); routes[url] = file; }
  return {
    commit, tree: root, routes, responses,
    treeAt: (d: string) => { const t = trees.get(d); if (!t) throw new Error(`fake-github-repo: no folder ${d}`); return t.sha; },
    blobId: (text: string | Buffer) => oid('blob', Buffer.from(text)),
  };
}
