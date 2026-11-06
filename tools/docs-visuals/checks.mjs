/** Checks that the capture scripts share, kept free of the app so that they can be tested alone. */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The shot ids to capture: every `shot` of the plan, or the ids of the comma list `only`. An id that is not a shot of the plan is an error. */
export function requestedIds(plan, only = '') {
  const all = plan.filter(entry => entry.kind === 'shot').map(entry => entry.id);
  const named = only.split(',').map(id => id.trim()).filter(id => id !== '');
  if (named.length === 0) return all;
  const unknown = named.filter(id => !all.includes(id));
  if (unknown.length > 0) throw new Error(`DOCS_SHOTS_ONLY names ids that are not shots of the plan: ${unknown.join(', ')}`);
  return named;
}

/** The problems with the pictures of `ids`: a light or dark file that is missing or older than `since` (milliseconds). An empty list means every picture is new. */
export function staleShots(ids, dir, since) {
  const problems = [];
  for (const id of ids) {
    for (const theme of ['light', 'dark']) {
      const file = join(dir, `${id}-${theme}.webp`);
      if (!existsSync(file)) problems.push(`${id}-${theme}.webp is missing`);
      else if (statSync(file).mtimeMs < since) problems.push(`${id}-${theme}.webp was not written by this run`);
    }
  }
  return problems;
}

/**
 * Throws unless a finished command did what the step expected: it started, it was not stopped by a signal, it exited with the expected code, and it wrote nothing to
 * standard error (unless `stderr` is `'allowed'`). `ran` is the result of `spawnSync`.
 */
export function assertStep(label, ran, { exit, stderr = 'none' }) {
  if (ran.error) throw new Error(`${label}: the command did not run: ${ran.error.message}`);
  if (ran.signal) throw new Error(`${label}: the command was stopped by ${ran.signal}`);
  if (ran.status !== exit) throw new Error(`${label}: expected exit ${exit} and got ${ran.status}\n${ran.stdout ?? ''}${ran.stderr ?? ''}`);
  if (stderr === 'none' && (ran.stderr ?? '').trim() !== '') throw new Error(`${label}: the command wrote to standard error:\n${ran.stderr}`);
}
