// Shared command-line helpers for tools/gates.mjs, tools/lane-tree.mjs, and tools/public-scan.mjs. Never shipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact } from './safe-env.mjs';

export const TEST_MODE_VAR = 'BOWERLOOM_TOOLS_TEST_MODE';

/** True when the test seams (--root, --lock-dir, --source, --timeout-seconds) may be used. Only a test sets the variable. */
export const inTestMode = (env = process.env) => env[TEST_MODE_VAR] === '1';

/** Splits `--flag=value` into { flag, value }. `value` is null when there is no `=`. A short flag or a bare word is returned as it is. */
export function splitFlag(arg) {
  const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
  return eq > 0 ? { flag: arg.slice(0, eq), value: arg.slice(eq + 1) } : { flag: arg, value: null };
}

/** True when the command line asks for JSON output, even in the wrong form (`--json=x`), so that a usage error still prints one JSON object. */
export const jsonWanted = argv => argv.some(arg => arg === '--json' || arg.startsWith('--json='));

/** The error message for a seam flag used outside test mode, or null when it is allowed. */
export function seamRefusal(flag, env = process.env) {
  return inTestMode(env) ? null : `${flag} is a test seam and works only when ${TEST_MODE_VAR}=1 is set`;
}

/** The error message for a boolean flag given a value (`--apply=false`), or null. */
export const boolValueRefusal = (flag, value) => (value === null ? null : `${flag} takes no value (got ${JSON.stringify(value)}); write ${flag} alone`);

/** The error message for an inline value that looks like another flag (`--base=--upload-pack=x`), or null. */
export const flagLikeValueRefusal = (flag, value) => (value !== null && value.startsWith('--') ? `${flag} was given a value that starts with --` : null);

/** Writes a usage error: the message and the usage text on stderr, and one JSON object on stdout when `json` is true. Returns 2. */
export function reportUsage(tool, message, usageText, { json, out, err }) {
  err.write(`${tool}: ${message}\n${usageText}\n`);
  if (json) out.write(JSON.stringify({ ok: false, exit: 2, error: redact(message) }) + '\n');
  return 2;
}

/**
 * Runs `body()` and returns its exit code. An error that escapes it is reported as one JSON object (when `json`) and a line on stderr, and the exit code is 2,
 * so a crash never prints a stack to a caller that reads JSON.
 */
export async function guarded(tool, { json, out, err }, body) {
  try {
    return await body();
  } catch (error) {
    const message = redact(error?.message ?? String(error)).split('\n')[0].slice(0, 300);
    err.write(`${tool}: ${message}\n`);
    if (json) out.write(JSON.stringify({ ok: false, exit: 2, error: message }) + '\n');
    return 2;
  }
}

/**
 * Says whether the file at `selfUrl` (pass import.meta.url) is the program that node started: 'main', 'imported', or 'mismatch' (a different file that carries
 * this file's name, for example a wrapper that imports it). The two paths are compared as real paths, so a symlink to the file is 'main'.
 */
export function entryState(argv1, selfUrl) {
  if (!argv1) return 'imported';
  const script = fs.realpathSync(fileURLToPath(selfUrl));
  let real = null;
  try { real = fs.realpathSync(argv1); } catch { /* the path does not exist */ }
  if (real === script) return 'main';
  return path.basename(argv1) === path.basename(script) ? 'mismatch' : 'imported';
}

/** The stderr line for a 'mismatch' entry. The program does nothing and exits 2. */
export const mismatchMessage = (tool, argv1, selfUrl) => `${tool}: the program started as ${argv1} is not this script (${fileURLToPath(selfUrl)}); it did nothing\n`;
