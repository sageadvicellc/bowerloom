// Shared fixtures for the spec 06 tests of project-sync: a project with bowerloom.json, a store of its own under a home
// folder of its own, and bowerloom.lock.json. Not a test file: npm test runs *.test.mjs only.
// Store items are made through the product's own create path (planCreate and applyCreate in the store scope), so their
// receipts and files are the ones a person gets.
import '../../../dist/tests/support/isolate-home.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { discoverProject, storeRootOf, withStoreForWrite } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';
import { serializeConfig, serializeLock, LOCK_FORMAT } from '../../../dist/packages/project-config/src/index.js';
import { STORE_MANIFEST_LIMITS, parseManifest, serializeManifest, validateManifest } from '../../../dist/packages/skill-manifest/src/schema.js';
import { authoredRows } from '../../../dist/packages/skill-manifest/src/resolve-store-git.js';

export const sha = b => createHash('sha256').update(b).digest('hex');
export const STORE_REMOTE = 'https://github.com/sageadvicellc/store';
export const STORE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

/**
 * A world: `home` (the store goes in `home/.bowerloom`), a project folder with `.bowerloom` when `folder`, and a private
 * state root. Everything is under a fresh folder in the test HOME, removed after the test.
 */
export function configWorld(t, { folder = false, prefix = '.bowerloom-config-' } = {}) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()), prefix)); fs.chmodSync(base, 0o700);
  t.after(() => { try { fs.chmodSync(path.join(base, 'home', '.bowerloom'), 0o700); } catch { /* gone */ } fs.rmSync(base, { recursive: true, force: true }); });
  const home = path.join(base, 'home'); fs.mkdirSync(home, { mode: 0o700 });
  const projectDir = path.join(base, 'project'); fs.mkdirSync(projectDir, { mode: 0o755 });
  if (folder) fs.mkdirSync(path.join(projectDir, '.bowerloom'), { mode: 0o755 });
  const stateRoot = path.join(base, 'state', 'bowerloom');
  const w = {
    base, home, projectDir, stateRoot, store: path.join(home, '.bowerloom'),
    cacheRoot: path.join(stateRoot, 'cache'), storeCacheRoot: path.join(stateRoot, 'store-cache'),
    project: () => discoverProject(projectDir, home),
  };
  return w;
}
/** Writes bowerloom.json in canonical form. Entries are { id, source, via? }. */
export function writeConfig(w, { skills = [], prompts = [], teams = [], harnesses = ['claude', 'codex'] } = {}) {
  const text = serializeConfig({ format: 'bowerloom/project/v1beta1', harnesses, skills, prompts, teams });
  fs.writeFileSync(path.join(w.projectDir, 'bowerloom.json'), text, { mode: 0o644 }); fs.chmodSync(path.join(w.projectDir, 'bowerloom.json'), 0o644);
  return text;
}
/** Writes bowerloom.lock.json in canonical form. */
export function writeLock(w, { skills = [], prompts = [], teams = [] } = {}) {
  const text = serializeLock({ format: LOCK_FORMAT, skills, prompts, teams });
  fs.writeFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), text, { mode: 0o644 }); fs.chmodSync(path.join(w.projectDir, 'bowerloom.lock.json'), 0o644);
  return text;
}
/** Creates one store item through the store create path. Teams first: a skill or prompt tag must name a store team. */
export async function storeItem(w, kind, id, { teams = [], profile } = {}) {
  const input = kind === 'team' ? { kind, scope: 'store', project: storeRootOf(w.home), name: id, ...(profile ? { profile } : {}) } : { kind, scope: 'store', project: storeRootOf(w.home), name: id, teams };
  const plan = await planCreate(input);
  return withStoreForWrite(w.home, new AbortController().signal, (context, held, created) => applyCreate(input, plan.revision, held, { context, created }));
}
/** Adds a pinned entry to the store skills.json (the store must exist). */
export function storePin(w, entry) {
  const file = path.join(w.store, 'skills.json');
  const current = fs.existsSync(file) ? parseManifest(fs.readFileSync(file), STORE_MANIFEST_LIMITS) : { format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [] };
  const next = validateManifest({ format: current.format, harnesses: [...current.harnesses], skills: [...current.skills.filter(s => s.id !== entry.id), entry] }, STORE_MANIFEST_LIMITS);
  fs.writeFileSync(file, serializeManifest(next, STORE_MANIFEST_LIMITS), { mode: 0o600 });
}
/** Rewrites one file of a store item, keeping its mode. */
export function editStore(w, rel, text) { const file = path.join(w.store, rel); fs.writeFileSync(file, text); }
/** The files of a store item as a lock records them, read from the live store. */
export function storeFiles(w, kind, id) {
  const root = kind === 'prompt' ? path.join(w.store, 'prompts') : path.join(w.store, `${kind}s`, id), out = [];
  if (kind === 'prompt') out.push({ path: `${id}.md`, bytes: fs.readFileSync(path.join(root, `${id}.md`)) });
  else { const walk = rel => { for (const n of fs.readdirSync(path.join(root, rel)).sort()) { const r = rel ? `${rel}/${n}` : n; if (fs.lstatSync(path.join(root, r)).isDirectory()) walk(r); else out.push({ path: r, bytes: fs.readFileSync(path.join(root, r)) }); } }; walk(''); }
  return out;
}
/** A lock item for an authored store item, from the live store bytes (as `use` would record after a proof). */
export function authoredLockItem(w, kind, id, { teams, tree = 'b'.repeat(40), files } = {}) {
  const { rows, hash } = authoredRows(files ?? storeFiles(w, kind, id));
  return { id, from: 'store', authored: { remote: STORE_REMOTE, commit: STORE_COMMIT, path: kind === 'prompt' ? `prompts/${id}.md` : `${kind}s/${id}`, tree, files: rows, hash, ...(teams ? { teams } : {}) } };
}
export const code = expected => e => { if (e?.code !== expected) throw new Error(`expected ${expected}, got ${e?.code ?? e} ${e?.message ?? ''}`); return true; };

// --- Locked worlds: a fake github.com copy of the store, and lock items that point at it. ---
import { buildFakeRepo } from '../../../dist/tests/support/fake-github-repo.js';
import { fakeTransport } from '../../skill-manifest/test/support/fixtures.mjs';
/** Every file of the store, by path relative to the store, as a store repository holds them. */
export function storeTree(w) {
  const out = {};
  const walk = rel => { for (const n of fs.readdirSync(path.join(w.store, rel)).sort()) { const r = rel ? `${rel}/${n}` : n; if (fs.lstatSync(path.join(w.store, r)).isDirectory()) walk(r); else out[r] = fs.readFileSync(path.join(w.store, r), 'utf8'); } };
  walk(''); return out;
}
/** The fake github.com copy of the store as it stands now, pushed at STORE_COMMIT. */
export function pushStore(w) {
  const dir = fs.mkdtempSync(path.join(w.base, 'repo-'));
  return buildFakeRepo('sageadvicellc', 'store', storeTree(w), STORE_COMMIT, dir);
}
/** The lock item of an authored store item, pointing at the pushed copy. */
export function lockOfRepo(w, repo, kind, id, teams) {
  const tree = kind === 'prompt' ? repo.blobId(fs.readFileSync(path.join(w.store, 'prompts', `${id}.md`))) : repo.treeAt(`${kind}s/${id}`);
  return authoredLockItem(w, kind, id, { tree, ...(teams && teams.length ? { teams } : {}) });
}
/** A store transport factory over the pushed copy. Every request is recorded in `urls`. */
export function storeTransport(repo, urls = [], options = {}) {
  const factory = () => { const t = fakeTransport(repo.responses, options); return { get: async (url, max, signal) => { urls.push(url); return t.get(url, max, signal); }, close() {} }; };
  factory.urls = urls; return factory;
}
/** Moves the store away, as on a teammate's machine that has none. */
export function dropStore(w) { fs.renameSync(w.store, path.join(w.base, `store-moved-${Date.now()}`)); }
