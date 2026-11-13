/** Stub for the red run: reads usage through the runs bridge. No behavior yet. */
import type { RunsBridge } from '../api/runs.js';
import type { UsageSource } from './model.js';

export type UsageRead = UsageSource | { readonly kind: 'stopped' };
export const initialSource = (_sample: boolean, _bridge: RunsBridge | null): UsageSource => ({ kind: 'loading' });
export async function readUsage(_bridge: RunsBridge, _alive: () => boolean): Promise<UsageRead> {
  return { kind: 'failed', code: 'FAILED' };
}
