/**
 * The wire types of the local models report. This is the one place they are written. `apps/desktop/shared/local-models/types.ts` re-exports them for the app, so the
 * window, main and this package read the same shapes. The file holds types and two small lists. It imports nothing.
 *
 * Every field except the identity and `state` can be null. A missing figure is null, never 0: the screen says "not reported".
 */

/** The servers the package knows how to read. Only `llama-server` has a provider in this version. */
export const PROVIDER_IDS = ['llama-server', 'ollama', 'lm-studio'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Whether the server answered, and how. */
export type ModelState = 'up' | 'down' | 'unreachable' | 'unsupported' | 'starting';

export interface LocalModel {
  /** Stable: `${provider}:${port}`. A second model of the same endpoint gets `#2`, `#3` after it. */
  readonly id: string;
  readonly provider: ProviderId;
  /** Loopback only. The host is never held: it is always 127.0.0.1. */
  readonly port: number;
  readonly state: ModelState;
  /** A short code: CONNECTION_REFUSED, TIMEOUT, BAD_RESPONSE, LOADING and the like. Null when the server is up. */
  readonly stateReason: string | null;
  readonly modelName: string | null;
  /** The file name only, never a folder. */
  readonly modelFile: string | null;
  readonly quantization: string | null;
  readonly parameterCount: number | null;
  readonly fileBytes: number | null;
  readonly contextSize: number | null;
  readonly contextTrain: number | null;
  /** The largest sequence length the server has seen (`n_tokens_max`). It is a high-water mark, not live use. */
  readonly contextUsedPeak: number | null;
  readonly slotsTotal: number | null;
  readonly activeRequests: number | null;
  readonly deferredRequests: number | null;
  readonly promptTokensPerSecond: number | null;
  readonly generationTokensPerSecond: number | null;
  /** Always null in this version: no process is read. */
  readonly processMemoryBytes: number | null;
  /** Always null in this version: no process is read. */
  readonly uptimeSeconds: number | null;
  readonly build: string | null;
  /** The conditions of this row alone. Empty when the row was read in full. The report-level `notes` stays as it is. */
  readonly notes: readonly LocalModelRowNote[];
  /** ISO time of the probe. */
  readonly sampledAt: string;
}

export interface LocalModelsNote {
  readonly code: string;
  readonly text: string;
  /** A short code that says why, such as PARSE or NOT_FILE for CONFIG_UNREADABLE, or an error class for PROBE_FAILED. Absent when the note has no sub-cause. Never message text. */
  readonly reason?: string;
}

/** The paths a row note may name. A fixed list: a path is never built from what a server sent. */
export const ROW_NOTE_PATHS = ['/health', '/props', '/slots', '/metrics', '/v1/models'] as const;
export type RowNotePath = (typeof ROW_NOTE_PATHS)[number];

/** A condition of one row: PARTIAL_READ, METRICS_OFF or METRICS_UNREADABLE, with the paths that caused it. No body text. */
export interface LocalModelRowNote {
  readonly code: string;
  readonly paths: readonly RowNotePath[];
}

export interface LocalModelsReport {
  readonly sampledAt: string;
  readonly models: readonly LocalModel[];
  /** How many endpoints the person set up in the local models file. Zero when the file is absent. */
  readonly endpointsConfigured: number;
  readonly notes: readonly LocalModelsNote[];
}
