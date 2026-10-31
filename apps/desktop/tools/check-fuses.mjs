#!/usr/bin/env node
// Reads the fuses of a built app and fails unless they are the ones this app promises:
//   run as plain Node: off, NODE_OPTIONS: off, --inspect arguments: off, asar integrity check: on, load only from the asar: on.
// Usage: node tools/check-fuses.mjs [path to the app executable]. Default: the macOS arm64 build in release/.
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED = Object.freeze({
  [FuseV1Options.RunAsNode]: FuseState.DISABLE,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FuseState.DISABLE,
  [FuseV1Options.EnableNodeCliInspectArguments]: FuseState.DISABLE,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE,
  [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: FuseState.DISABLE,
});

export async function checkFuses(executable) {
  const wire = await getCurrentFuseWire(executable);
  const problems = [];
  for (const [option, want] of Object.entries(EXPECTED)) {
    if (wire[option] !== want) problems.push(`${FuseV1Options[option]} is ${FuseState[wire[option]] ?? wire[option]}, expected ${FuseState[want]}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
  const exe = process.argv[2] ?? join(desktop, 'release', 'mac-arm64', 'Bowerloom.app', 'Contents', 'MacOS', 'Bowerloom');
  if (!existsSync(exe)) { console.error(`No built app at ${exe}. Run npm run build first.`); process.exit(2); }
  const problems = await checkFuses(exe);
  if (problems.length) { console.error(`Fuses are wrong:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log('Fuses are as promised.');
}
