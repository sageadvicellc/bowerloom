// Shared fixtures for the skills sync tests (build plan 01, M5). Not a test file: npm test runs *.test.mjs only.
// Every test file imports this first: HOME becomes a private folder of the test process, and `denyNetwork` makes
// every name lookup and HTTP call throw. Third-party bytes come from synthetic packages built here, in memory, and
// reach the private cache only through the product's own cache operation (openNpmCacheOperation), the way an
// acquisition stores them.
import '../../../dist/tests/support/isolate-home.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import { discoverProject } from '../../../dist/packages/project-context/src/index.js';
import { observeSkillCacheRoot, openNpmCacheOperation } from '../../../dist/packages/skill-sources/src/cache.js';
import { NpmAcquisitionError, planNpmAcquisition } from '../../../dist/packages/skill-sources/src/npm.js';
import { serializeManifest, validateManifest } from '../../../dist/packages/skill-manifest/src/schema.js';
import { entryRequest, cacheOperationId } from '../../../dist/packages/project-sync/src/cache-index.js';

export const hash = b => createHash('sha256').update(b).digest('hex');

/** dns.lookup (both APIs, except the literal 127.0.0.1 the project lock listens on), https and http throw and are counted. */
export function denyNetwork() {
  const calls = [];
  const deny = name => (...args) => { calls.push({ name, target: String(args[0]) }); throw new Error('TEST_NETWORK_DENIED'); };
  const original = dns.lookup, denied = deny('dns.lookup');
  dnsPromises.lookup = deny('dns.promises.lookup'); dns.lookup = (host, ...rest) => host === '127.0.0.1' ? original(host, ...rest) : denied(host, ...rest);
  https.request = deny('https.request'); https.get = deny('https.get'); http.request = deny('http.request'); http.get = deny('http.get');
  syncBuiltinESMExports();
  return calls;
}

function archive(files) {
  const blocks = [];
  for (const file of files) {
    const bytes = Buffer.from(file.text), h = Buffer.alloc(512); h.write('package/' + file.sourcePath, 0, 100, 'ascii');
    for (const [at, size, n] of [[100, 8, 420], [108, 8, 0], [116, 8, 0], [124, 12, bytes.length], [136, 12, 1], [329, 8, 0], [337, 8, 0]]) h.write(n.toString(8).padStart(size - 1, '0') + '\0', at, size, 'latin1');
    h[156] = 48; h.write('ustar\0' + '00', 257, 8, 'latin1'); h.fill(32, 148, 156); h.write(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
    blocks.push(h, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

/** A synthetic npm package holding one MIT skill, and its exact skills.json entry. */
export function npmPackage(id, { version = '1.0.0', name = 'synthetic-' + id, guide = 'Version ' + version, teams } = {}) {
  const root = `skills/${id}`;
  const files = [
    { path: 'SKILL.md', sourcePath: `${root}/SKILL.md`, text: `---\nname: ${name}\ndescription: Synthetic safe fixture.\nlicense: MIT\n---\nRead [guide](references/guide.md).\n` },
    { path: 'references/guide.md', sourcePath: `${root}/references/guide.md`, text: `# Guide\n${guide}\n` },
    { path: 'LICENSE', sourcePath: 'LICENSE', text: 'MIT License\nSynthetic notice.\n' },
  ];
  const compressed = archive(files), integrity = 'sha512-' + createHash('sha512').update(compressed).digest('base64'), pkg = '@synthetic/' + id;
  const metadata = Buffer.from(JSON.stringify({ name: pkg, version, license: 'MIT', _npmUser: { name: 'synthetic' }, dist: { integrity, tarball: `https://registry.npmjs.org/${pkg}/-/${id}-${version}.tgz` } }));
  const entry = {
    id, ...(teams ? { teams } : {}),
    source: { kind: 'npm', registry: 'https://registry.npmjs.org', package: pkg, version, integrity, metadataSha256: hash(metadata), publisher: 'synthetic' },
    skill: { name, sourceRoot: root }, license: { spdx: 'MIT', files: ['LICENSE'] },
    files: files.map(f => ({ path: f.path, sourcePath: f.sourcePath, sha256: hash(f.text), bytes: Buffer.byteLength(f.text) })),
    references: [{ from: 'SKILL.md', to: 'references/guide.md' }],
  };
  return { id, name, entry, metadata, archive: compressed, files, urls: { metadata: `https://registry.npmjs.org/${pkg}/${version}`, archive: `https://registry.npmjs.org/${pkg}/-/${id}-${version}.tgz` } };
}
export const localEntry = (id, teams) => ({ id, ...(teams ? { teams } : {}), source: { kind: 'local', path: 'skills/' + id } });

/** A project folder with `.bowerloom/` under a fresh folder in HOME. Private state is not created: sync creates it. */
export function syncProject(t, prefix = '.bowerloom-sync-') {
  const home = fs.realpathSync(os.homedir()), base = fs.mkdtempSync(path.join(home, prefix)); fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const projectDir = path.join(base, 'project'); fs.mkdirSync(projectDir, { mode: 0o755 }); fs.mkdirSync(path.join(projectDir, '.bowerloom'), { mode: 0o755 });
  fs.writeFileSync(path.join(projectDir, 'AGENTS.md'), 'Keep founder governance.\n', { mode: 0o644 });
  const stateRoot = path.join(base, 'state', 'bowerloom');
  const project = () => discoverProject(projectDir, home);
  const input = (extra = {}) => ({ project: project(), stateRoot, team: null, offline: false, ...extra });
  const ctx = project(), privateRoot = path.join(stateRoot, ctx.projectId);
  return { home, base, projectDir, stateRoot, project, input, privateRoot, cacheRoot: path.join(privateRoot, 'cache'), itemsRoot: path.join(privateRoot, 'items') };
}

/** Writes `.bowerloom/skills.json` in canonical form. */
export function writeManifest(f, entries, harnesses = ['claude', 'codex']) {
  const file = path.join(f.projectDir, '.bowerloom/skills.json');
  fs.writeFileSync(file, serializeManifest(validateManifest({ format: 'bowerloom/skills/v1beta1', harnesses, skills: entries })), { mode: 0o644 }); fs.chmodSync(file, 0o644);
}
/** An authored local skill at .bowerloom/skills/<id>/. */
export function localSkill(f, id, files = { 'SKILL.md': `---\nname: ${id}\ndescription: Authored fixture.\n---\nUse the house style.\n`, 'references/notes.md': '# Notes\nOne.\n' }) {
  const root = path.join(f.projectDir, '.bowerloom/skills', id);
  for (const [rel, text] of Object.entries(files)) { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 }); fs.writeFileSync(file, text, { mode: 0o644 }); fs.chmodSync(file, 0o644); }
  return root;
}

/** Stores a package in a cache operation through the product's cache code, as an acquisition would. */
export async function store(plan, approval, signal, pkg) {
  const op = openNpmCacheOperation(plan, approval, signal);
  try { op.receiving(); await op.stage(pkg.metadata, pkg.archive, signal); return await op.complete(signal); } finally { op.release(); }
}
/**
 * The test Acquirer: no network. `packages` serves bytes by package name. A package in `fail` behaves like a real
 * network fault: the cache operation opens, then is held, and NPM_NETWORK is thrown. Every call is recorded.
 */
export function fakeAcquirer(packages, { fail = new Set(), calls = [] } = {}) {
  const byName = new Map(packages.map(p => [p.entry.source.package, p]));
  return {
    calls,
    async npm(plan, approval, signal) {
      calls.push({ kind: 'npm', id: plan.request.skill.id, operationId: plan.cache.operationId, approval, planRevision: plan.revision });
      const pkg = byName.get(plan.request.package);
      if (!pkg || fail.has(pkg.id)) { const op = openNpmCacheOperation(plan, approval, signal); op.receiving(); op.hold(); op.release(); throw new NpmAcquisitionError('NPM_NETWORK'); }
      return store(plan, approval, signal, pkg);
    },
    async git() { calls.push({ kind: 'git' }); throw new Error('TEST_NO_GIT'); },
  };
}
/** An Acquirer that must not be called: each call is recorded and throws before any write. */
export function noAcquirer() {
  const calls = [], refuse = kind => async () => { calls.push({ kind }); throw new Error('TEST_ACQUIRER_CALLED'); };
  return { calls, npm: refuse('npm'), git: refuse('git') };
}

/** The private folders as sync creates them: mode 0700, every level. */
export function privateFolders(f) { for (const p of [path.dirname(f.stateRoot), f.stateRoot, f.privateRoot, f.cacheRoot, f.itemsRoot]) if (!fs.existsSync(p)) fs.mkdirSync(p, { mode: 0o700 }); }
/** Fills the sync cache for one package at its attempt-0 operation id, as an earlier sync would have. */
export async function prefill(f, pkg, attempt = 0) {
  privateFolders(f); const { request, digest } = entryRequest(pkg.entry), operationId = cacheOperationId(digest, attempt);
  const plan = planNpmAcquisition(request, observeSkillCacheRoot(f.cacheRoot, operationId, 33554432));
  return store(plan, plan.revision, new AbortController().signal, pkg);
}

/** Every entry under a folder with inode, mode, mtime and content hash: any write shows. */
export function exactTree(dir) {
  if (!fs.existsSync(dir)) return null;
  const rows = [];
  const visit = p => { const s = fs.lstatSync(p, { bigint: true }); rows.push([path.relative(dir, p), String(s.ino), Number(s.mode) & 0o7777, String(s.mtimeNs), s.isFile() ? hash(fs.readFileSync(p)) : s.isSymbolicLink() ? 'link' : 'dir']); if (s.isDirectory()) for (const n of fs.readdirSync(p).sort()) visit(path.join(p, n)); };
  visit(dir); return JSON.stringify(rows);
}
/** Content only: paths, kinds, modes and hashes. Two machines that sync the same manifest agree on it. */
export function contentTree(dir) {
  const rows = [];
  const visit = p => { const s = fs.lstatSync(p); rows.push([path.relative(dir, p), s.mode & 0o7777, s.isFile() ? hash(fs.readFileSync(p)) : s.isSymbolicLink() ? 'link' : 'dir']); if (s.isDirectory()) for (const n of fs.readdirSync(p).sort()) visit(path.join(p, n)); };
  visit(dir); return hash(JSON.stringify(rows));
}
export const read = (f, rel) => fs.readFileSync(path.join(f.projectDir, rel), 'utf8');
export const exists = (f, rel) => fs.existsSync(path.join(f.projectDir, rel));
export const deps = (acquirer, extra = {}) => ({ acquirer, signal: new AbortController().signal, ...extra });
export const code = expected => e => { if (e?.code !== expected) throw new Error(`expected ${expected}, got ${e?.code ?? e} ${e?.message ?? ''}`); return true; };
export const byId = plan => Object.fromEntries(plan.items.map(i => [i.id, i]));
