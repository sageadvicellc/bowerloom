/**
 * The report cache. A report younger than the time to live (2 seconds) is returned as it is. Callers that arrive while a probe is running share that one probe. The cache
 * holds one report, in memory, and writes nothing: there is no history and nothing is kept past the process. A probe that fails is never cached and never rejects: the
 * caller gets a report with the note PROBE_FAILED, and the next call tries again.
 */
import type { LocalModelsReport } from './types.js';

export const DEFAULT_TTL_MS = 2000;

export interface ReportCacheOptions {
  /** Makes a fresh report. It should not reject, but if it does the cache answers PROBE_FAILED. */
  readonly collect: () => Promise<LocalModelsReport>;
  /** The clock, in milliseconds. A test gives a fake one. */
  readonly now: () => number;
  readonly ttlMs?: unknown;
}

export interface ReportCache {
  get(): Promise<LocalModelsReport>;
}

/** The class of a failure as a short code. Never the message, which can hold a path or a body. */
export function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return 'NOT_AN_ERROR';
  switch (error.name) {
    case 'TypeError': return 'TYPE_ERROR';
    case 'RangeError': return 'RANGE_ERROR';
    case 'SyntaxError': return 'SYNTAX_ERROR';
    case 'ReferenceError': return 'REFERENCE_ERROR';
    case 'AggregateError': return 'AGGREGATE_ERROR';
    default: return 'ERROR';
  }
}

const failedReport = (at: number, reason: string): LocalModelsReport => Object.freeze({
  sampledAt: new Date(at).toISOString(),
  models: Object.freeze([]),
  endpointsConfigured: 0,
  notes: Object.freeze([Object.freeze({ code: 'PROBE_FAILED', text: 'The probe of the local model servers failed. It will be tried again.', reason })]),
});

export function createReportCache(options: ReportCacheOptions): ReportCache {
  const { collect, now } = options;
  const ttl = typeof options.ttlMs === 'number' && Number.isFinite(options.ttlMs) && options.ttlMs >= 0 ? options.ttlMs : DEFAULT_TTL_MS;
  let held: { readonly report: LocalModelsReport; readonly at: number } | undefined;
  let inFlight: Promise<LocalModelsReport> | undefined;

  const probe = async (): Promise<LocalModelsReport> => {
    try {
      const report = await collect();
      held = { report, at: now() };
      return report;
    } catch (error) {
      return failedReport(now(), reasonOf(error));
    }
  };

  return {
    get(): Promise<LocalModelsReport> {
      if (held !== undefined && now() - held.at < ttl) return Promise.resolve(held.report);
      if (inFlight === undefined) {
        // The slot is cleared in a later turn, so a probe that fails at once cannot clear it before it is set.
        inFlight = probe().finally(() => { inFlight = undefined; });
      }
      return inFlight;
    },
  };
}
