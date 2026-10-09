// Shared fixtures for the managed v1beta2 tests. Not a test file: npm test runs *.test.mjs only.
import '../../../dist/tests/support/isolate-home.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { planNpmAcquisition } from '../../../dist/packages/skill-sources/src/npm.js';
import { observeSkillCacheRoot, openNpmCacheOperation, inspectSkillCache } from '../../../dist/packages/skill-sources/src/cache.js';

export const hash = b => createHash('sha256').update(b).digest('hex');
export const IGNORE_TEXT = '*\n';

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

/** A project with `.bowerloom/`, a private state root and a cache root, all under a fresh folder in HOME. */
export function project(t, prefix = '.bowerloom-managed-v2-') {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()), prefix)); fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const projectDir = path.join(base, 'project'), stateRoot = path.join(base, 'state'), itemsRoot = path.join(stateRoot, 'items'), cacheDir = path.join(base, 'cache');
  for (const p of [projectDir, stateRoot, itemsRoot, cacheDir]) fs.mkdirSync(p, { mode: 0o700 });
  fs.mkdirSync(path.join(projectDir, '.bowerloom'), { mode: 0o700 });
  fs.writeFileSync(path.join(projectDir, 'AGENTS.md'), 'Keep founder governance.\n', { mode: 0o644 });
  return { base, projectDir, stateRoot, itemsRoot, cacheDir };
}

/** The private state folder of one item, created as the sync orchestrator would. */
export function itemState(f, itemId) {
  const dir = path.join(f.itemsRoot, itemId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
  return dir;
}

/** A completed npm cache operation for one synthetic skill. Returns the cache selector. */
export async function cacheSkill(f, { version = '1.0.0', operationId = 'b'.repeat(32), id = 'collections', name = 'synthetic-collections' } = {}) {
  const files = [
    { path: 'SKILL.md', sourcePath: `skills/${id}/SKILL.md`, text: `---\nname: ${name}\ndescription: Synthetic safe fixture.\nlicense: MIT\n---\nRead [guide](references/guide.md).\n` },
    { path: 'references/guide.md', sourcePath: `skills/${id}/references/guide.md`, text: '# Guide\nVersion ' + version + '\n' },
    { path: 'LICENSE.txt', sourcePath: 'LICENSE', text: 'MIT License\nSynthetic notice.\n' },
  ];
  const compressed = archive(files), integrity = 'sha512-' + createHash('sha512').update(compressed).digest('base64');
  const pkg = '@synthetic/' + id;
  const metadata = Buffer.from(JSON.stringify({ name: pkg, version, license: 'MIT', _npmUser: { name: 'synthetic' }, dist: { integrity, tarball: `https://registry.npmjs.org/${pkg}/-/${id}-${version}.tgz` } }));
  const req = { package: pkg, version, integrity, metadataSha256: hash(metadata), publisher: 'synthetic', declaredLicense: 'MIT', skill: { id, name, sourceRoot: `skills/${id}` }, files: files.map(x => ({ path: x.path, sourcePath: x.sourcePath, sha256: hash(x.text), bytes: Buffer.byteLength(x.text), mode: 420 })), references: [{ from: 'SKILL.md', to: 'references/guide.md' }], license: { spdx: 'MIT', origin: 'included', files: ['LICENSE.txt'] } };
  const binding = observeSkillCacheRoot(f.cacheDir, operationId, 33554432), plan = planNpmAcquisition(req, binding), abort = new AbortController(), op = openNpmCacheOperation(plan, plan.revision, abort.signal);
  op.receiving(); await op.stage(metadata, compressed, abort.signal); await op.complete(abort.signal); op.release();
  const inspected = await inspectSkillCache({ root: f.cacheDir, operationId: binding.operationId });
  return { selector: { root: f.cacheDir, operationId: binding.operationId, expectedSnapshotRevision: inspected.snapshotRevision, expectedReceiptRevision: inspected.receipt.revision }, files };
}

/** An authored local skill at .bowerloom/skills/<id>/. */
export function localSkill(f, id, files = { 'SKILL.md': `---\nname: ${id}\ndescription: Authored fixture.\n---\nUse the house style.\n`, 'references/notes.md': '# Notes\nOne.\n' }) {
  const root = path.join(f.projectDir, '.bowerloom/skills', id);
  for (const [rel, text] of Object.entries(files)) { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 }); fs.writeFileSync(file, text, { mode: 0o644 }); }
  return root;
}

/** An authored prompt at .bowerloom/prompts/<name>.md. */
export function prompt(f, name, text = 'Summarize the open review comments.\n') {
  const dir = path.join(f.projectDir, '.bowerloom/prompts'); fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  const file = path.join(dir, name + '.md'); fs.writeFileSync(file, text, { mode: 0o644 }); return file;
}

export function request(f, { kind = 'skill', id, source, harnesses = ['claude', 'codex'], operation = 'install', previous = null, legacy = null }) {
  const itemId = kind === 'prompt' ? 'prompt-' + id : id;
  return { operation, projectDir: f.projectDir, stateDir: itemState(f, itemId), item: { kind, id }, harnesses, source, expectedPreviousRevision: previous, minFreeBytes: 33554432, legacy };
}
export const local = id => ({ kind: 'local', path: 'skills/' + id });
export const promptSource = name => ({ kind: 'prompt', name });
export const cached = selector => ({ kind: 'cache', selector });

/** Every entry under a folder: path, inode, mode and content hash. */
export function inventory(dir, { inodes = true } = {}) {
  const rows = [];
  const visit = p => { const s = fs.lstatSync(p); rows.push({ path: path.relative(dir, p), ...(inodes ? { inode: s.ino } : {}), mode: s.mode & 0o7777, link: s.isSymbolicLink(), hash: s.isFile() ? hash(fs.readFileSync(p)) : null }); if (s.isDirectory()) for (const n of fs.readdirSync(p).sort()) visit(path.join(p, n)); };
  visit(dir); return rows;
}
/** inventory plus mtime, for folders that must stay byte and identity exact. */
export function exactInventory(dir) {
  const rows = [];
  const visit = p => { const s = fs.lstatSync(p, { bigint: true }); rows.push({ path: path.relative(dir, p), inode: String(s.ino), mode: Number(s.mode) & 0o7777, mtimeNs: String(s.mtimeNs), birthtimeNs: String(s.birthtimeNs), hash: s.isFile() ? hash(fs.readFileSync(p)) : null }); if (s.isDirectory()) for (const n of fs.readdirSync(p).sort()) visit(path.join(p, n)); };
  visit(dir); return rows;
}
export const code = expected => e => { if (e?.code !== expected) throw new Error(`expected ${expected}, got ${e?.code ?? e}`); return true; };
