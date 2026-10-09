// Synthetic npm skill packages for the M5 CLI tests. Not a test file: npm test runs dist/tests/*.test.js only.
// Independent of the product: a minimal strict USTAR writer. Bytes reach a cache only through the product's own
// cache operation, the way an acquisition stores them.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { observeSkillCacheRoot, openNpmCacheOperation, inspectSkillCache } from '../../packages/skill-sources/src/cache.js';
import type { AcquiredSkillCacheSelector } from '../../packages/skill-sources/src/cache.js';
import { planNpmAcquisition } from '../../packages/skill-sources/src/npm.js';
import type { NpmAcquisitionRequest } from '../../packages/skill-sources/src/npm.js';

export const sha256 = (b: string | Buffer): string => createHash('sha256').update(b).digest('hex');
interface File { path: string; sourcePath: string; text: string }
function archive(files: File[]): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const bytes = Buffer.from(file.text), h = Buffer.alloc(512); h.write('package/' + file.sourcePath, 0, 100, 'ascii');
    for (const [at, size, n] of [[100, 8, 420], [108, 8, 0], [116, 8, 0], [124, 12, bytes.length], [136, 12, 1], [329, 8, 0], [337, 8, 0]] as const) h.write(n.toString(8).padStart(size - 1, '0') + '\0', at, size, 'latin1');
    h[156] = 48; h.write('ustar\0' + '00', 257, 8, 'latin1'); h.fill(32, 148, 156); h.write(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
    blocks.push(h, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
export interface SyntheticPackage { id: string; name: string; entry: Record<string, unknown>; request: NpmAcquisitionRequest; metadata: Buffer; archive: Buffer }
/** One MIT skill in a synthetic npm package, its skills.json entry and its acquisition request. */
export function npmPackage(id: string, version = '1.0.0'): SyntheticPackage {
  const name = 'synthetic-' + id, root = `skills/${id}`, pkg = '@synthetic/' + id;
  const files: File[] = [
    { path: 'SKILL.md', sourcePath: `${root}/SKILL.md`, text: `---\nname: ${name}\ndescription: Synthetic safe fixture.\nlicense: MIT\n---\nRead [guide](references/guide.md).\n` },
    { path: 'references/guide.md', sourcePath: `${root}/references/guide.md`, text: `# Guide\nVersion ${version}\n` },
    { path: 'LICENSE', sourcePath: 'LICENSE', text: 'MIT License\nSynthetic notice.\n' },
  ];
  const compressed = archive(files), integrity = 'sha512-' + createHash('sha512').update(compressed).digest('base64');
  const metadata = Buffer.from(JSON.stringify({ name: pkg, version, license: 'MIT', _npmUser: { name: 'synthetic' }, dist: { integrity, tarball: `https://registry.npmjs.org/${pkg}/-/${id}-${version}.tgz` } }));
  const rows = files.map(f => ({ path: f.path, sourcePath: f.sourcePath, sha256: sha256(f.text), bytes: Buffer.byteLength(f.text) }));
  const entry = { id, source: { kind: 'npm', registry: 'https://registry.npmjs.org', package: pkg, version, integrity, metadataSha256: sha256(metadata), publisher: 'synthetic' }, skill: { name, sourceRoot: root }, license: { spdx: 'MIT', files: ['LICENSE'] }, files: rows, references: [{ from: 'SKILL.md', to: 'references/guide.md' }] };
  const request: NpmAcquisitionRequest = { package: pkg, version, integrity, metadataSha256: sha256(metadata), publisher: 'synthetic', declaredLicense: 'MIT', skill: { id, name, sourceRoot: root }, files: rows.map(r => ({ ...r, mode: 420 as const })), references: [{ from: 'SKILL.md', to: 'references/guide.md' }], license: { spdx: 'MIT', origin: 'included', files: ['LICENSE'] } };
  return { id, name, entry, request, metadata, archive: compressed };
}
/** Stores a package in a new cache operation under `cacheRoot` (a private 0700 folder) and returns its selector. */
export async function cachePackage(cacheRoot: string, pkg: SyntheticPackage, operationId = 'a'.repeat(32)): Promise<AcquiredSkillCacheSelector> {
  const plan = planNpmAcquisition(pkg.request, observeSkillCacheRoot(cacheRoot, operationId, 33554432)), signal = new AbortController().signal;
  const op = openNpmCacheOperation(plan, plan.revision, signal);
  try { op.receiving(); await op.stage(pkg.metadata, pkg.archive, signal); await op.complete(signal); } finally { op.release(); }
  const seen = await inspectSkillCache({ root: cacheRoot, operationId });
  return { root: cacheRoot, operationId, expectedSnapshotRevision: seen.snapshotRevision, expectedReceiptRevision: seen.receipt!.revision };
}
