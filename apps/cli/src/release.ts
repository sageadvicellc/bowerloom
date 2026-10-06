import { readFileSync } from 'node:fs';
import { DefinitionError } from '../../../packages/contracts/src/index.js';

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}

export function validateReleaseIdentity(value: unknown, metadata: unknown): { version: string; state: string; execution: string } {
  try {
    const record = object(value), pkg = object(metadata), npm = object(record.npm), capabilities = object(record.capabilities);
    if (record.schema !== 'bowerloom/release/v1' || record.product !== 'Bowerloom' || record.release !== 'v0.7-beta'
      || typeof record.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(record.version)
      || record.version !== pkg.version || npm.packageName !== 'bowerloom' || npm.packageName !== pkg.name
      || !['unreleased', 'published'].includes(String(record.state)) || typeof record.state !== 'string'
      || npm.published !== (record.state === 'published') || typeof capabilities.execution !== 'string'
      || npm.installCommand !== `npm install --global ${npm.packageName}@${record.version}`) throw new Error();
    return { version: record.version, state: record.state, execution: capabilities.execution };
  } catch {
    throw new DefinitionError('RELEASE_METADATA', 'The installed release record does not match this package. Inspect this installation before using it.');
  }
}

export function readInstalledRelease(): { version: string; state: string; execution: string } {
  try {
    return validateReleaseIdentity(
      JSON.parse(readFileSync(new URL('../../../../release/beta.json', import.meta.url), 'utf8')),
      JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')),
    );
  } catch {
    throw new DefinitionError('RELEASE_METADATA', 'The installed release record does not match this package. Inspect this installation before using it.');
  }
}
