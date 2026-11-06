// Shared helpers for the diagnostics tests. Synthetic data only.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const HOME = '/home/test-person';
export const PLAN = 'a'.repeat(64);

/** A state root in a fresh temp folder, removed when the test ends. */
export function stateRoot(t) {
  const base = mkdtempSync(join(tmpdir(), 'bowerloom-diagnostics-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return join(base, 'bowerloom');
}
export const at = (iso = '2026-10-30T14:00:00Z') => new Date(iso);
