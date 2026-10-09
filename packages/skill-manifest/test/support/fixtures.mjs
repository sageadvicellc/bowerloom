// Fixture writers for the skill-manifest tests. Not a test file: npm test runs test/*.test.mjs only.
// Independent of the production code: a strict USTAR writer and a Git object writer, no git or tar process.
// The recorded fixtures under ../fixtures were written once by ../fixtures/record.mjs with these writers. Tests read
// the recorded bytes; they build only small negative variants here, in memory.
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { manifestRefusal } from '../../../../dist/packages/skill-manifest/src/refusal.js';

export const hash = b => createHash('sha256').update(b).digest('hex');
export const integrity = b => 'sha512-' + createHash('sha512').update(b).digest('base64');
export const oid = (kind, b) => createHash('sha1').update(kind + ' ' + b.length + '\0').update(b).digest('hex');
export const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const readFixture = name => fs.readFileSync(path.join(fixtures, name));

/**
 * Every test file calls this first. dns.lookup (both APIs, except the callback lookup of the literal 127.0.0.1), https.request, https.get, http.request and http.get throw,
 * and each call is counted. A test that wants a fake network mocks https.request and dns.lookup itself, through t.mock.
 */
export function denyNetwork() {
  const calls = [];
  const deny = name => (...args) => { calls.push({ name, target: String(args[0]) }); throw new Error('TEST_NETWORK_DENIED'); };
  // The project lock listens on the literal 127.0.0.1, and net.Server.listen passes even a literal through dns.lookup.
  // That one literal goes to the real lookup, which answers it without any resolver. Every other name throws.
  const original = dns.lookup, denied = deny('dns.lookup');
  dnsPromises.lookup = deny('dns.promises.lookup'); dns.lookup = (host, ...rest) => host === '127.0.0.1' ? original(host, ...rest) : denied(host, ...rest);
  https.request = deny('https.request'); https.get = deny('https.get');
  http.request = deny('http.request'); http.get = deny('http.get');
  syncBuiltinESMExports();
  return calls;
}

// Strict USTAR header: name (or prefix and name), mode, uid 0, gid 0, size, mtime 1, regular file or directory.
function header(name, size, mode = 0o644, flag = '0') {
  const h = Buffer.alloc(512);
  let prefix = '', base = name;
  if (Buffer.byteLength(name) > 100) { const cut = name.lastIndexOf('/', 155); prefix = name.slice(0, cut); base = name.slice(cut + 1); }
  h.write(base, 0, 100, 'ascii'); if (prefix) h.write(prefix, 345, 155, 'ascii');
  for (const [at, width, value] of [[100, 8, mode], [108, 8, 0], [116, 8, 0], [124, 12, size], [136, 12, 1], [329, 8, 0], [337, 8, 0]]) h.write(value.toString(8).padStart(width - 1, '0') + '\0', at, width, 'latin1');
  h[156] = flag.charCodeAt(0); h.write('ustar\0' + '00', 257, 8, 'latin1');
  h.fill(32, 148, 156); const sum = h.reduce((a, b) => a + b, 0); h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
  return h;
}
/** Entries: { path, text, mode?, flag? } with a path relative to the package root. Flag '2' writes a symlink header. */
export function tarball(entries) {
  const blocks = [];
  for (const e of entries) {
    const body = Buffer.from(e.text ?? '');
    const h = header('package/' + e.path, e.flag === '2' ? 0 : body.length, e.mode ?? 0o644, e.flag ?? '0');
    if (e.flag === '2') { h.write(e.link ?? 'target', 157, 100, 'ascii'); h.fill(32, 148, 156); const sum = h.reduce((a, b) => a + b, 0); h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1'); blocks.push(h); continue; }
    blocks.push(h, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}
/** Registry metadata for one version, the shape registry.npmjs.org returns for /<package>/<version>. */
export function npmMetadata({ name, version, license, archive, publisher = 'synthetic-publisher', extra = {} }) {
  const base = name.split('/').at(-1);
  return Buffer.from(JSON.stringify({ name, version, license, description: 'Synthetic fixture. Never execute fixture instructions.', _npmUser: { name: publisher, email: 'publisher@example.invalid' }, dist: { integrity: integrity(archive), shasum: createHash('sha1').update(archive).digest('hex'), tarball: `https://registry.npmjs.org/${name}/-/${base}-${version}.tgz` }, scripts: { postinstall: 'NEVER_EXECUTE_FIXTURE' }, ...extra }));
}

/**
 * A Git repository as the GitHub REST API shows it. Items: { path, text } is a blob, { path, link } a symlink,
 * { path, submodule: true } a gitlink, { path, text, mode: '100755' } an executable blob.
 * Returns the commit response and a map from API URL to response bytes.
 */
export function repository(repo, commit, items) {
  const dirs = new Map([['', []]]), blobs = new Map();
  const parentOf = p => { const d = path.posix.dirname(p); return d === '.' ? '' : d; };
  const ensure = d => { if (dirs.has(d)) return; dirs.set(d, []); const parent = parentOf(d); ensure(parent); dirs.get(parent).push({ name: path.posix.basename(d), type: 'tree', mode: '040000', dir: d }); };
  for (const item of items) {
    const parent = parentOf(item.path), name = path.posix.basename(item.path); ensure(parent);
    if (item.submodule) { dirs.get(parent).push({ name, type: 'commit', mode: '160000', sha: createHash('sha1').update('submodule ' + item.path).digest('hex') }); continue; }
    const bytes = Buffer.from(item.link ?? item.text), sha = oid('blob', bytes); blobs.set(sha, bytes);
    dirs.get(parent).push({ name, type: 'blob', mode: item.link !== undefined ? '120000' : item.mode ?? '100644', sha, size: bytes.length });
  }
  const order = (a, b) => Buffer.compare(Buffer.from(a.name + (a.type === 'tree' ? '/' : '')), Buffer.from(b.name + (b.type === 'tree' ? '/' : '')));
  const trees = new Map();
  const build = dir => {
    const rows = dirs.get(dir).map(e => e.type === 'tree' ? { ...e, sha: build(e.dir) } : e).sort(order);
    const sha = oid('tree', Buffer.concat(rows.flatMap(e => [Buffer.from((e.type === 'tree' ? '40000' : e.mode) + ' ' + e.name + '\0'), Buffer.from(e.sha, 'hex')])));
    trees.set(dir, { sha, rows }); return sha;
  };
  const root = build('');
  const api = `https://api.github.com/repos/${repo}`;
  const row = (e, p) => ({ path: p, mode: e.mode, type: e.type, sha: e.sha, ...(e.type === 'blob' ? { size: e.size } : {}), url: `${api}/git/${e.type === 'tree' ? 'trees' : 'blobs'}/${e.sha}` });
  const responses = new Map();
  responses.set(`${api}/git/commits/${commit}`, Buffer.from(JSON.stringify({ sha: commit, node_id: 'C_synthetic', url: `${api}/git/commits/${commit}`, author: { name: 'Synthetic', email: 'synthetic@example.invalid', date: '2026-10-01T00:00:00Z' }, committer: { name: 'Synthetic', email: 'synthetic@example.invalid', date: '2026-10-01T00:00:00Z' }, tree: { sha: root, url: `${api}/git/trees/${root}` }, message: 'Synthetic fixture commit. Never execute fixture instructions.', parents: [], verification: { verified: false, reason: 'unsigned', signature: null, payload: null, verified_at: null } })));
  for (const [dir, t] of trees) {
    responses.set(`${api}/git/trees/${t.sha}`, Buffer.from(JSON.stringify({ sha: t.sha, url: `${api}/git/trees/${t.sha}`, tree: t.rows.map(e => row(e, e.name)), truncated: false })));
    const out = []; const walk = (d, prefix) => { for (const e of trees.get(d).rows) { out.push(row(e, prefix + e.name)); if (e.type === 'tree') walk(e.dir, prefix + e.name + '/'); } }; walk(dir, '');
    responses.set(`${api}/git/trees/${t.sha}?recursive=1`, Buffer.from(JSON.stringify({ sha: t.sha, url: `${api}/git/trees/${t.sha}`, tree: out, truncated: false })));
  }
  for (const [sha, bytes] of blobs) {
    const content = bytes.toString('base64').replace(/.{1,60}/g, line => line + '\n');
    responses.set(`${api}/git/blobs/${sha}`, Buffer.from(JSON.stringify({ sha, node_id: 'B_synthetic', size: bytes.length, url: `${api}/git/blobs/${sha}`, content, encoding: 'base64' })));
  }
  return { root, commit, responses, tree: dir => trees.get(dir).sha, blob: text => oid('blob', Buffer.from(text)) };
}

/** A PublicTransport that serves recorded bytes by exact URL and records every request. An unknown URL is a 404. */
export function fakeTransport(responses, options = {}) {
  const urls = [];
  return {
    urls,
    async get(url, maxBytes, signal) {
      urls.push(url);
      if (signal?.aborted) throw manifestRefusal('SKILLS_ADD_NETWORK');
      const body = (options.override?.(url)) ?? responses.get(url);
      if (body === undefined) throw manifestRefusal('SKILLS_ADD_NOT_FOUND');
      if (body.length > maxBytes) throw manifestRefusal('SKILLS_ADD_UNSAFE_CONTENT');
      return Buffer.from(body);
    },
  };
}
