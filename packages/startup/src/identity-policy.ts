import type { DirectoryIdentity } from './index.js';
export const INSTALLATION_IDENTITY_POLICY = Object.freeze({
  format: 'bowerloom/installation-identity-policy/v1', algorithm: 'darwin-directional-f64-seconds/v1', platform: 'darwin',
  minimumBirthtimeNs: '946684800000000000', exclusiveMaximumBirthtimeNs: '4102444800000000000',
  scope: Object.freeze(['installed-target', 'installed-bowerloom'] as const), operationIdentity: 'exact-raw/v1',
} as const);
export type InstallationIdentityPolicy = typeof INSTALLATION_IDENTITY_POLICY;
export type PersistentIdentityComparison = 'exact' | 'approved-timestamp-alternate';
const lower = 946684800000000000n, upper = 4102444800000000000n, billion = 1000000000n;
const fields = ['device', 'inode', 'birthtimeNs', 'uid', 'mode'] as const;
function data(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !descriptors[key] || !('value' in descriptors[key]) || !descriptors[key].enumerable)) return;
  return Object.fromEntries(keys.map(key => [key, descriptors[key]!.value]));
}
export function parseInstallationIdentityPolicy(value: unknown, platform: string = process.platform): InstallationIdentityPolicy | undefined {
  try {
    if (platform !== 'darwin') return;
    const input = data(value, Object.keys(INSTALLATION_IDENTITY_POLICY)); if (!input) return;
    for (const key of Object.keys(INSTALLATION_IDENTITY_POLICY) as (keyof InstallationIdentityPolicy)[]) {
      if (key === 'scope') {
        if (!Array.isArray(input.scope) || Object.getPrototypeOf(input.scope) !== Array.prototype) return;
        const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(input.scope) as unknown as Record<string, PropertyDescriptor>;
        if (Reflect.ownKeys(input.scope).length !== 3 || descriptors.length?.value !== 2
          || descriptors['0']?.value !== 'installed-target' || descriptors['1']?.value !== 'installed-bowerloom') return;
      } else if (input[key] !== INSTALLATION_IDENTITY_POLICY[key]) return;
    }
    return INSTALLATION_IDENTITY_POLICY;
  } catch { return; }
}
export function canonicalBirthtimeNs(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{17,18}$/.test(raw)) return;
  const value = BigInt(raw); if (value < lower || value >= upper) return;
  const seconds = value / billion, nanos = value % billion;
  return String(seconds * billion + BigInt(Math.trunc(((Number(seconds) + Number(nanos) / 1e9) - Number(seconds)) * 1e9)));
}
export function snapshotPersistentIdentity(value: unknown): DirectoryIdentity | undefined {
  try {
    const input = data(value, fields); if (!input || ![input.device, input.inode].every(v => typeof v === 'string' && /^[0-9]{1,30}$/.test(v))
      || !Number.isSafeInteger(input.uid) || Number(input.uid) < 0 || !Number.isInteger(input.mode) || Number(input.mode) < 0 || Number(input.mode) > 0o777
      || canonicalBirthtimeNs(input.birthtimeNs) === undefined) return;
    return input as unknown as DirectoryIdentity;
  } catch { return; }
}
/** Prospective receipt policy only. Never use for active-operation, stage or cleanup ownership. */
export function comparePersistentIdentity(saved: unknown, current: unknown, policy: unknown, platform: string = process.platform): PersistentIdentityComparison | undefined {
  if (!parseInstallationIdentityPolicy(policy, platform)) return;
  const a = snapshotPersistentIdentity(saved), b = snapshotPersistentIdentity(current); if (!a || !b) return;
  if (fields.some(key => key !== 'birthtimeNs' && a[key] !== b[key])) return;
  if (a.birthtimeNs === b.birthtimeNs) return 'exact';
  return b.birthtimeNs === canonicalBirthtimeNs(a.birthtimeNs) && b.birthtimeNs === canonicalBirthtimeNs(b.birthtimeNs) ? 'approved-timestamp-alternate' : undefined;
}
