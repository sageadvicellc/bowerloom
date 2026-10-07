/**
 * Resolves `npm:<package>@<version>:<path>` into a pinned skills.json entry, through the two GETs acquisition makes:
 *   https://registry.npmjs.org/<package>/<version>
 *   https://registry.npmjs.org/<package>/-/<name>-<version>.tgz
 * The archive is read in memory with the strict USTAR reader of skill-sources (enumerateNpmTar). No file is written,
 * no package script runs, and no other file of the package is read as skill content.
 *
 * License: the registry metadata must declare exactly MIT or Apache-2.0 (acquisition checks the same field). The
 * license file is the nearest LICENSE* file: in the skill folder, or else in the folder above it, up to the package
 * root. That is how a multi-skill package such as @tanstack/db-skills ships one LICENSE at its root, outside every
 * skill folder. A license file outside the skill folder keeps its package path as `sourcePath`, and its file name as
 * `path`, which the npm planner accepts for a license file anywhere in the package.
 * The proposal is then checked by verifyNpmPayload against the same bytes before it is returned.
 */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { posix } from 'node:path';
import { NPM_LIMITS, NpmAcquisitionError, enumerateNpmTar, planNpmAcquisition, verifyNpmPayload } from '../../skill-sources/src/npm.js';
import { SkillSourceError, boundedText } from '../../skill-sources/src/validation.js';
import type { SkillLicense } from '../../skill-sources/src/types.js';
import { isManifestRefusal, manifestRefusal, refuse, requireManifest } from './refusal.js';
import { checkSpec } from './spec.js';
import type { NpmSpec } from './spec.js';
import { NPM_REGISTRY } from './schema.js';
import type { NpmSource, PinnedContent } from './schema.js';
import type { PublicTransport } from './public-get.js';
import { LICENSE_NAME, LICENSE_TEXT, fetchBytes, fetchedJson, licenseFolders, pinnedContent, sha256, skillFilePath, text } from './content.js';
import type { SelectedFile } from './content.js';
import { toNpmRequest, probeBinding } from './requests.js';

export type ResolvedNpm = PinnedContent<NpmSource>;

/** The license the registry declares, or a refusal: another SPDX id is unsupported; anything else is unknown. */
function declaredLicense(value: unknown): SkillLicense {
  if (value === 'MIT' || value === 'Apache-2.0') return value;
  requireManifest(!(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(value)), 'MANIFEST_LICENSE_UNSUPPORTED');
  return refuse('SKILLS_ADD_LICENSE_UNKNOWN');
}
const unsafe = (work: () => void): void => { try { work(); } catch (error) { if (error instanceof SkillSourceError) refuse('SKILLS_ADD_UNSAFE_CONTENT'); throw error; } };

export async function resolveNpm(specValue: unknown, transport: PublicTransport, signal: AbortSignal): Promise<ResolvedNpm> {
  const spec = checkSpec(specValue, 'npm') as NpmSpec;
  requireManifest(signal instanceof AbortSignal && !signal.aborted, 'SKILLS_ADD_NETWORK');
  const base = spec.package.split('/').at(-1)!;
  const metadataUrl = `${NPM_REGISTRY}/${spec.package}/${spec.version}`, archiveUrl = `${NPM_REGISTRY}/${spec.package}/-/${base}-${spec.version}.tgz`;

  const metadata = await fetchBytes(transport, metadataUrl, NPM_LIMITS.metadataBytes, signal);
  const m = fetchedJson(metadata, NPM_LIMITS.metadataBytes);
  requireManifest(m.name === spec.package && m.version === spec.version, 'SKILLS_ADD_UNSAFE_CONTENT');
  const spdx = declaredLicense(m.license);
  const dist = m.dist as Record<string, unknown> | null | undefined, user = m._npmUser as Record<string, unknown> | null | undefined;
  requireManifest(dist !== null && typeof dist === 'object' && dist.tarball === archiveUrl && typeof dist.integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(dist.integrity), 'SKILLS_ADD_UNSAFE_CONTENT');
  requireManifest(user !== null && typeof user === 'object', 'SKILLS_ADD_UNSAFE_CONTENT');
  unsafe(() => boundedText(user.name, 128));
  const integrity = dist.integrity as string, publisher = user.name as string;

  const archive = await fetchBytes(transport, archiveUrl, NPM_LIMITS.compressedBytes, signal);
  requireManifest('sha512-' + createHash('sha512').update(archive).digest('base64') === integrity && archive[0] === 31 && archive[1] === 139, 'SKILLS_ADD_UNSAFE_CONTENT');
  let unpacked: Buffer;
  try { unpacked = gunzipSync(archive, { maxOutputLength: NPM_LIMITS.tarBytes }); } catch { return refuse('SKILLS_ADD_UNSAFE_CONTENT'); }
  let entries: Map<string, { bytes: Buffer; mode: number }>;
  try { entries = enumerateNpmTar(unpacked, () => { if (signal.aborted) throw manifestRefusal('SKILLS_ADD_NETWORK'); }).entries; }
  catch (error) { if (isManifestRefusal(error)) throw error; if (error instanceof NpmAcquisitionError) refuse('SKILLS_ADD_UNSAFE_CONTENT'); throw error; }

  // The skill folder: it must exist and hold SKILL.md before any file in it is judged.
  const prefix = spec.path + '/', inside = [...entries.keys()].filter(p => p.startsWith(prefix)).sort();
  requireManifest(inside.length > 0, 'SKILLS_ADD_NOT_FOUND');
  requireManifest(entries.has(prefix + 'SKILL.md'), 'SKILLS_ADD_SKILL_MISSING');
  const files: SelectedFile[] = inside.map(sourcePath => {
    const entry = entries.get(sourcePath)!, path = sourcePath.slice(prefix.length);
    skillFilePath(path); requireManifest(entry.mode === 0o644, 'SKILLS_ADD_UNSAFE_CONTENT');
    return { path, sourcePath, bytes: entry.bytes };
  });

  // The nearest folder that holds a LICENSE* file decides. Its files that carry the declared license's text are taken.
  let licenseFiles: string[] = [];
  for (const folder of licenseFolders(spec.path)) {
    const candidates = [...entries.keys()].filter(p => (posix.dirname(p) === '.' ? '' : posix.dirname(p)) === folder && LICENSE_NAME.test(posix.basename(p))).sort();
    if (candidates.length === 0) continue;
    for (const sourcePath of candidates) {
      const entry = entries.get(sourcePath)!;
      if (entry.mode !== 0o644 || entry.bytes.length === 0 || entry.bytes.length > 65536 || !text(entry.bytes).includes(LICENSE_TEXT[spdx])) continue;
      const path = folder === spec.path ? sourcePath.slice(prefix.length) : posix.basename(sourcePath);
      if (folder !== spec.path) files.push({ path, sourcePath, bytes: entry.bytes });
      licenseFiles.push(path);
    }
    break;
  }
  requireManifest(licenseFiles.length > 0, 'SKILLS_ADD_LICENSE_UNKNOWN');

  const source: NpmSource = { kind: 'npm', registry: NPM_REGISTRY, package: spec.package, version: spec.version, integrity, metadataSha256: sha256(metadata), publisher };
  const { texts: _texts, ...content } = pinnedContent(source, spec.path, files, spdx, licenseFiles);
  // The existing verifier decides: the proposal must pass verifyNpmPayload against the bytes that were read.
  try {
    const plan = planNpmAcquisition(toNpmRequest({ id: content.skill.name, ...content }), probeBinding());
    await verifyNpmPayload(plan, metadata, archive, signal, () => { if (signal.aborted) throw manifestRefusal('SKILLS_ADD_NETWORK'); });
  } catch (error) { if (isManifestRefusal(error)) throw error; if (error instanceof NpmAcquisitionError || error instanceof SkillSourceError) refuse('SKILLS_ADD_UNSAFE_CONTENT'); throw error; }
  return content;
}
