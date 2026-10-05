import type { DirectoryIdentity } from './index.js';

export interface StartupIdentityDiagnostic {
  classification: 'darwin-birthtime-f64-seconds-signature';
  explanation: string;
}
const diagnostic: Readonly<StartupIdentityDiagnostic> = Object.freeze({
  classification: 'darwin-birthtime-f64-seconds-signature',
  explanation: 'The birth time differs in a way consistent with a floating-point timestamp conversion. This installation remains blocked because its saved identity no longer matches. The cause is unknown.',
});
const fields = ['device', 'inode', 'birthtimeNs', 'uid', 'mode'] as const;
const lower = 946684800000000000n, upper = 4102444800000000000n, billion = 1000000000n;

// This diagnostic never accepts an identity or grants authority. Supported birth times
// are [2000-01-01, 2100-01-01) UTC on Darwin. Other values receive no classification.
function snapshot(value: unknown): DirectoryIdentity | undefined {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== fields.length || fields.some(key => !descriptors[key] || !('value' in descriptors[key]) || !descriptors[key].enumerable)) return;
  const result = Object.fromEntries(fields.map(key => [key, descriptors[key]!.value])) as unknown as DirectoryIdentity;
  if (![result.device, result.inode].every(v => typeof v === 'string' && /^[0-9]{1,30}$/.test(v))
    || !Number.isSafeInteger(result.uid) || result.uid < 0 || !Number.isInteger(result.mode) || result.mode < 0 || result.mode > 0o777
    || typeof result.birthtimeNs !== 'string' || !/^[1-9][0-9]{17,18}$/.test(result.birthtimeNs)) return;
  const birth = BigInt(result.birthtimeNs);
  return birth >= lower && birth < upper ? result : undefined;
}
function converted(ns: string): bigint {
  const value = BigInt(ns), seconds = value / billion, nanos = value % billion;
  return seconds * billion + BigInt(Math.trunc(((Number(seconds) + Number(nanos) / 1e9) - Number(seconds)) * 1e9));
}

/** Directional measured signature only; callers must independently establish safe,
 * stable inspection and suppress this detail whenever any other drift exists. */
export function classifyStartupIdentityDiagnostic(
  savedTarget: unknown, currentTarget: unknown, savedBowerloom: unknown, currentBowerloom: unknown,
  platform: string = process.platform,
): Readonly<StartupIdentityDiagnostic> | undefined {
  if (platform !== 'darwin') return;
  try {
    const snapshots = [savedTarget, currentTarget, savedBowerloom, currentBowerloom].map(snapshot);
    if (snapshots.some(value => !value)) return;
    let changed = false;
    for (const [saved, current] of [[snapshots[0]!, snapshots[1]!], [snapshots[2]!, snapshots[3]!]] as const) {
      if (fields.some(key => key !== 'birthtimeNs' && saved[key] !== current[key])) return;
      if (saved.birthtimeNs === current.birthtimeNs) continue;
      if (BigInt(current.birthtimeNs) !== converted(saved.birthtimeNs) || converted(current.birthtimeNs) !== BigInt(current.birthtimeNs)) return;
      changed = true;
    }
    return changed ? diagnostic : undefined;
  } catch { return; }
}
