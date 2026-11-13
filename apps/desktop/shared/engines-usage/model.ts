/** Stub for the red run: the types and names of the Engines and usage model, with no behavior yet. */
import type { HarnessState } from '../harness/types.js';
import type { RunFigures, RunView } from '../api/runs.js';

export const USAGE_RUN_CAP = 50;
export const CONNECTIONS_SHOWN = 12;
export const PLACES_SHOWN = 6;

export const ENGINES_WORDS = Object.freeze({
  title: '', sample: '', noBridge: '', loading: '', noRuns: '', countsLow: '', countedOnce: '', notRead: '', none: '', secretSet: '',
  cut: (_read: number, _total: number): string => '',
});

export type FigureRead = { readonly kind: 'figures'; readonly figures: RunFigures } | { readonly kind: 'refused'; readonly code: string };
export type UsageSource =
  | { readonly kind: 'sample' } | { readonly kind: 'no-bridge' } | { readonly kind: 'loading' } | { readonly kind: 'failed'; readonly code: string }
  | { readonly kind: 'ready'; readonly runs: readonly RunView[]; readonly reads: ReadonlyMap<string, FigureRead>; readonly total: number };

export interface Fact { readonly key: string; readonly label: string; readonly value: string; readonly reported: boolean }
export interface ConnectionView { readonly name: string; readonly summary: string; readonly secretSet: boolean }
export interface EngineRowView {
  readonly id: string; readonly name: string; readonly state: 'ready' | 'problem' | 'not-found'; readonly stateWords: string;
  readonly config: readonly Fact[]; readonly configNotes: readonly string[]; readonly places: readonly string[]; readonly morePlaces: number;
  readonly connections: readonly ConnectionView[]; readonly moreConnections: number;
  readonly usage: readonly Fact[]; readonly usageNotes: readonly string[];
}
export interface EnginesView { readonly rows: readonly EngineRowView[]; readonly notes: readonly string[] }

export function enginesView(_state: Pick<HarnessState, 'interfaces' | 'parts' | 'sources' | 'real'>, _source: UsageSource): EnginesView {
  return { rows: [], notes: [] };
}
