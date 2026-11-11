/**
 * The provider seam. A provider reads one kind of local model server. It never sees a host, never builds a URL and never opens a socket: the engine gives it a `get(path)` that
 * is already bound to 127.0.0.1 and one port, with the time and size limits applied. A provider is then a pure reading of text, easy to test with a fixture and easy to audit.
 */
import type { ProviderId } from './types.js';

/** Why a read failed before an answer came. REDIRECT: the server answered with a redirect, which is never followed. */
export type GetFailure = 'CONNECTION_REFUSED' | 'CONNECTION_FAILED' | 'TIMEOUT' | 'TOO_LARGE' | 'REDIRECT' | 'BAD_PATH' | 'BAD_PORT';

/** The answer of one GET. A status such as 404 or 503 is still an answer (`ok: true`): the provider decides what it means. */
export type GetResult =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | { readonly ok: false; readonly code: GetFailure };

/** `get('/props')`: one GET on the bound port. It never rejects. */
export type BoundGet = (path: string) => Promise<GetResult>;

/** Everything a provider can learn about one model. Every field is optional: a field the server did not report is left out, never set to 0. */
export interface ProviderProbe {
  readonly modelName?: string;
  readonly modelFile?: string;
  readonly quantization?: string;
  readonly parameterCount?: number;
  readonly fileBytes?: number;
  readonly contextSize?: number;
  readonly contextTrain?: number;
  readonly contextUsedPeak?: number;
  readonly slotsTotal?: number;
  readonly activeRequests?: number;
  readonly deferredRequests?: number;
  readonly promptTokensPerSecond?: number;
  readonly generationTokensPerSecond?: number;
  readonly build?: string;
  readonly state: 'up' | 'starting';
  /** For `starting`: why, as a short code. */
  readonly reason?: string;
}

/** The read worked. One endpoint can hold several models, so `rows` is a list. `notes` are note codes, such as METRICS_OFF. */
export interface ProviderSuccess {
  readonly ok: true;
  readonly rows: readonly ProviderProbe[];
  readonly notes: readonly string[];
}

/** The read did not work. The state says how, the reason is a short code. */
export interface ProviderFailure {
  readonly ok: false;
  readonly state: 'down' | 'unreachable' | 'unsupported';
  readonly reason: string;
}

export type ProviderResult = ProviderSuccess | ProviderFailure;

export interface LocalModelProvider {
  readonly id: ProviderId;
  readonly defaultPort: number;
  /** Reads one port through `get`. It never throws: a dead server is a `ProviderFailure`. */
  probe(get: BoundGet): Promise<ProviderResult>;
}

/** The failure a failed GET stands for. A refused connection is `down`. A timeout or a broken connection is `unreachable`. Anything else is `unsupported`. */
export function failureOf(code: GetFailure): ProviderFailure {
  switch (code) {
    case 'CONNECTION_REFUSED': return { ok: false, state: 'down', reason: 'CONNECTION_REFUSED' };
    case 'TIMEOUT': return { ok: false, state: 'unreachable', reason: 'TIMEOUT' };
    case 'CONNECTION_FAILED': return { ok: false, state: 'unreachable', reason: 'CONNECTION_FAILED' };
    default: return { ok: false, state: 'unsupported', reason: 'BAD_RESPONSE' };
  }
}
