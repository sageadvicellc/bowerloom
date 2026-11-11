/**
 * Builds the local models report. It reads the endpoint file, probes each endpoint in parallel through its provider, and turns each answer into `LocalModel` rows. A dead
 * server is a state of its row, never a throw. A configured endpoint that fails shows as down, unreachable or unsupported. A well-known default that fails is left out.
 * Every row is built field by field from what a provider returned, so a provider cannot pass a field the report does not name.
 */
import { readEndpointConfig } from './config.js';
import type { EndpointSpec } from './config.js';
import { createReportCache } from './cache.js';
import { createGet } from './http.js';
import { providerFor, PROVIDERS } from './providers.js';
import type { BoundGet, LocalModelProvider, ProviderProbe, ProviderResult } from './provider.js';
import { baseName, clean } from './text.js';
import type { LocalModel, LocalModelsNote, LocalModelsReport, ModelState } from './types.js';

export interface LocalModelsOptions {
  /** The state folder that holds `local-models.json`. */
  readonly stateRoot: string;
  /** Test use: another list of providers. */
  readonly providers?: readonly LocalModelProvider[];
  /** The clock in milliseconds. Defaults to Date.now. */
  readonly now?: () => number;
  /** Test use: another way to read a port. Defaults to a GET to 127.0.0.1 and that port. */
  readonly makeGet?: (port: number) => BoundGet;
  /** Test use: a shorter time limit for each GET. */
  readonly timeoutMs?: number;
  /** Test use: another time to live for the cache. */
  readonly ttlMs?: number;
}

const CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

const NOTE_TEXT: Readonly<Record<string, string>> = Object.freeze({
  METRICS_OFF: 'A server runs without metrics, so its request and speed figures are not reported.',
  NO_ENDPOINTS: 'No local model server answered. Add a port to the local models file.',
});

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const shown = (value: unknown): string | null => {
  if (typeof value !== 'string' || value === '') return null;
  const text = clean(value);
  return text === '' ? null : text;
};
const fileOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? shown(baseName(value)) : null);
const codeOf = (value: unknown, fallback: string): string => (typeof value === 'string' && CODE.test(value) ? value : fallback);

interface Probed {
  readonly rows: readonly LocalModel[];
  readonly notes: readonly string[];
}

function failureRow(spec: EndpointSpec, state: ModelState, reason: string, sampledAt: string): LocalModel {
  return rowOf(spec, 0, { state, reason }, sampledAt);
}

function rowOf(spec: EndpointSpec, index: number, probe: { readonly state: ModelState; readonly reason?: unknown } & Partial<Record<keyof ProviderProbe, unknown>>, sampledAt: string): LocalModel {
  const state = probe.state;
  return Object.freeze({
    id: index === 0 ? `${spec.provider}:${spec.port}` : `${spec.provider}:${spec.port}#${index + 1}`,
    provider: spec.provider,
    port: spec.port,
    state,
    stateReason: state === 'up' ? null : codeOf(probe.reason, state === 'starting' ? 'LOADING' : 'BAD_RESPONSE'),
    modelName: shown(probe.modelName),
    modelFile: fileOf(probe.modelFile),
    quantization: shown(probe.quantization),
    parameterCount: count(probe.parameterCount),
    fileBytes: count(probe.fileBytes),
    contextSize: count(probe.contextSize),
    contextTrain: count(probe.contextTrain),
    contextUsedPeak: count(probe.contextUsedPeak),
    slotsTotal: count(probe.slotsTotal),
    activeRequests: count(probe.activeRequests),
    deferredRequests: count(probe.deferredRequests),
    promptTokensPerSecond: count(probe.promptTokensPerSecond),
    generationTokensPerSecond: count(probe.generationTokensPerSecond),
    processMemoryBytes: null,
    uptimeSeconds: null,
    build: shown(probe.build),
    sampledAt,
  });
}

/** The row or rows of one provider answer. A state a provider may not return, or an answer of the wrong shape, is `unsupported`. */
function rowsOf(spec: EndpointSpec, result: ProviderResult, sampledAt: string): Probed {
  if (typeof result !== 'object' || result === null) return { rows: [failureRow(spec, 'unsupported', 'PROVIDER_ERROR', sampledAt)], notes: [] };
  if (!result.ok) {
    const state: ModelState = result.state === 'down' || result.state === 'unreachable' ? result.state : 'unsupported';
    return { rows: [failureRow(spec, state, codeOf(result.reason, 'BAD_RESPONSE'), sampledAt)], notes: [] };
  }
  const probes = Array.isArray(result.rows) ? (result.rows as readonly ProviderProbe[]) : [];
  const notes = Array.isArray(result.notes) ? (result.notes as readonly unknown[]).filter((n): n is string => typeof n === 'string' && CODE.test(n)) : [];
  if (probes.length === 0) return { rows: [rowOf(spec, 0, { state: 'up' }, sampledAt)], notes };
  const rows = probes.map((probe, index) => {
    const state: ModelState = probe?.state === 'up' || probe?.state === 'starting' ? probe.state : 'unsupported';
    return rowOf(spec, index, state === probe?.state ? probe : { state, reason: 'BAD_RESPONSE' }, sampledAt);
  });
  return { rows, notes };
}

async function probeEndpoint(spec: EndpointSpec, providers: readonly LocalModelProvider[], makeGet: (port: number) => BoundGet, sampledAt: string): Promise<Probed> {
  const provider = providerFor(spec.provider, providers);
  // No provider yet for this kind: a configured endpoint says so, a default is left out. No connection is made either way.
  if (provider === undefined) return { rows: spec.configured ? [failureRow(spec, 'unsupported', 'PROVIDER_NOT_AVAILABLE', sampledAt)] : [], notes: [] };
  let probed: Probed;
  try {
    probed = rowsOf(spec, await provider.probe(makeGet(spec.port)), sampledAt);
  } catch {
    probed = { rows: [failureRow(spec, 'unsupported', 'PROVIDER_ERROR', sampledAt)], notes: [] };
  }
  // A default that does not answer is not a finding. Only a default that is up or starting is shown.
  if (!spec.configured) return { rows: probed.rows.filter(row => row.state === 'up' || row.state === 'starting'), notes: probed.notes };
  return probed;
}

/** Makes one report now, without the cache. It never rejects for a probe failure. */
export async function collectReport(options: LocalModelsOptions): Promise<LocalModelsReport> {
  const now = options.now ?? Date.now;
  const sampledAt = new Date(now()).toISOString();
  const providers = options.providers ?? PROVIDERS;
  const makeGet = options.makeGet ?? ((port: number): BoundGet => createGet(port, options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }));
  const config = readEndpointConfig(options.stateRoot);
  const probed = await Promise.all(config.endpoints.map(spec => probeEndpoint(spec, providers, makeGet, sampledAt)));
  const models = probed.flatMap(p => p.rows);
  const notes: LocalModelsNote[] = config.notes.map(n => ({ code: n.code, text: n.text }));
  const seen = new Set(notes.map(n => n.code));
  const add = (code: string): void => { if (!seen.has(code)) { seen.add(code); notes.push({ code, text: NOTE_TEXT[code] ?? `A server reported the condition ${code}.` }); } };
  for (const p of probed) for (const code of p.notes) add(code);
  if (models.length === 0 && !config.unreadable) add('NO_ENDPOINTS');
  return Object.freeze({
    sampledAt,
    models: Object.freeze(models),
    endpointsConfigured: config.endpointsConfigured,
    notes: Object.freeze(notes.map(n => Object.freeze(n))),
  });
}

export interface LocalModels {
  /** The report, from the cache when it is under 2 seconds old. It never rejects for a probe failure. */
  localModels(): Promise<LocalModelsReport>;
}

/** The service behind the `localModels` call: the report, cached and single-flight. */
export function createLocalModels(options: LocalModelsOptions): LocalModels {
  const now = options.now ?? Date.now;
  const cache = createReportCache({ collect: () => collectReport(options), now, ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }) });
  return { localModels: () => cache.get() };
}
