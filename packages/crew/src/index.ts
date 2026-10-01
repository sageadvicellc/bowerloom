import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument } from 'yaml';
import {
  assertPortablePath, canonicalJson, COMPILER_VERSION, DefinitionError, digest,
  graphOrder, PLAN_FORMAT, validateDefinition,
} from '../../contracts/src/index.js';
import type { CompiledPlan, CrewDefinition, PinnedAsset } from '../../contracts/src/index.js';

export const LIMITS = Object.freeze({ definitionBytes: 1024 * 1024, assetBytes: 2 * 1024 * 1024, totalAssetBytes: 16 * 1024 * 1024 });

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new DefinitionError('INVALID_ENCODING', 'The definition and text assets must use UTF-8.'); }
}

export function parseCrew(source: string): CrewDefinition {
  if (Buffer.byteLength(source) > LIMITS.definitionBytes) throw new DefinitionError('DEFINITION_LIMIT', 'The definition exceeds 1 MiB.');
  try {
    const document = parseDocument(source, { strict: true, uniqueKeys: true, version: '1.2', schema: 'core', merge: false, resolveKnownTags: false, prettyErrors: false });
    if (document.errors.length || document.warnings.length || document.directives.yaml.version !== '1.2') {
      throw new DefinitionError('YAML_INVALID', 'Use one valid YAML 1.2 document without parser warnings or duplicate keys.');
    }
    const pending: Array<{ node: unknown; depth: number }> = [{ node: document.contents, depth: 0 }];
    let nodeCount = 0;
    while (pending.length) {
      const { node, depth } = pending.pop()!;
      if (++nodeCount > 20000 || depth > 32) throw new DefinitionError('DEFINITION_LIMIT', 'The definition exceeds its node or depth limit.');
      if (isAlias(node) || (isNode(node) && (node.tag || ('anchor' in node && node.anchor)))) {
        throw new DefinitionError('YAML_FEATURE', 'Aliases, anchors, and explicit YAML tags are unsupported.');
      }
      if (isMap(node)) {
        for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new DefinitionError('YAML_INVALID', 'YAML mapping keys must be strings.');
          pending.push({ node: pair.key, depth: depth + 1 });
          pending.push({ node: pair.value, depth: depth + 1 });
        }
      } else if (isSeq(node)) {
        for (const child of node.items) pending.push({ node: child, depth: depth + 1 });
      }
    }
    return validateDefinition(document.toJS({ maxAliasCount: 0 }));
  } catch (error) {
    if (error instanceof DefinitionError) throw error;
    throw new DefinitionError('YAML_INVALID', 'The YAML parser refused the definition.');
  }
}

async function readPortableFile(root: string, path: string, limit: number): Promise<Buffer> {
  assertPortablePath(path);
  const components = path.split('/');
  let target = root;
  for (const [index, component] of components.entries()) {
    target = resolve(target, component);
    const entry = await lstat(target).catch(() => { throw new DefinitionError('FILE_UNAVAILABLE', 'A declared source file is unavailable.'); });
    if (entry.isSymbolicLink()) throw new DefinitionError('SYMLINK_FORBIDDEN', 'Declared source paths cannot contain symbolic links.');
    if (index < components.length - 1 && !entry.isDirectory()) throw new DefinitionError('FILE_TYPE', 'A source path parent must be a directory.');
    if (index === components.length - 1 && !entry.isFile()) throw new DefinitionError('FILE_TYPE', 'Declared sources must be regular files.');
  }
  const physicalPath = await realpath(target);
  if (physicalPath !== target) throw new DefinitionError('UNSAFE_PATH', 'A source path changed during loading.');
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => { throw new DefinitionError('FILE_UNAVAILABLE', 'A declared source file is unavailable.'); });
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new DefinitionError('FILE_TYPE', 'Declared sources must be regular files.');
    if (before.size > limit) throw new DefinitionError('FILE_LIMIT', 'A declared source exceeds its size limit.');
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(target);
    if (size > limit) throw new DefinitionError('FILE_LIMIT', 'A declared source exceeds its size limit.');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || current.ino !== after.ino || current.dev !== after.dev || await realpath(target) !== physicalPath) {
      throw new DefinitionError('SOURCE_CHANGED', 'A source changed during loading. Load a stable source snapshot.');
    }
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export async function compileCrew(definitionFile: string, configuration: { root?: string } = {}): Promise<CompiledPlan> {
  const file = resolve(definitionFile);
  const requestedRoot = configuration.root ? resolve(configuration.root) : dirname(file);
  let root: string;
  try { root = await realpath(requestedRoot); }
  catch { throw new DefinitionError('ROOT_UNAVAILABLE', 'The source root is unavailable.'); }
  const definitionPath = relative(requestedRoot, file);
  if (isAbsolute(definitionPath) || definitionPath === '..' || definitionPath.startsWith(`..${sep}`)) {
    throw new DefinitionError('UNSAFE_PATH', 'The definition must reside inside its source root.');
  }
  const definition = parseCrew(decodeUtf8(await readPortableFile(root, definitionPath.split(sep).join('/'), LIMITS.definitionBytes)));
  const assets: Record<string, PinnedAsset> = {};
  let totalBytes = 0;
  for (const assetId of Object.keys(definition.assets).sort()) {
    const asset = definition.assets[assetId]!;
    const bytes = await readPortableFile(root, asset.path, Math.min(LIMITS.assetBytes, LIMITS.totalAssetBytes - totalBytes));
    totalBytes += bytes.length;
    if (asset.mediaType.startsWith('text/')) decodeUtf8(bytes);
    assets[assetId] = { ...asset, bytes: bytes.length, digest: digest(bytes) };
  }
  const body = { format: PLAN_FORMAT, compilerVersion: COMPILER_VERSION, definition, assets, ...graphOrder(definition) };
  return freeze({ ...body, candidateRevision: digest(canonicalJson(body)) });
}
