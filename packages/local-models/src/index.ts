/**
 * Local models: a loopback-only reader of the model servers that run on this computer, for the local models dashboard. The package holds the guard, the one GET helper, the
 * readers, the endpoint file and the cache. It imports no Electron, no page code and no other package. It starts no program and reads no process: memory and uptime come in
 * a later version. Nothing is written to disk and no prompt or slot text is read.
 */
export type { LocalModel, LocalModelRowNote, LocalModelsNote, LocalModelsReport, ModelState, ProviderId } from './types.js';
export { PROVIDER_IDS } from './types.js';
export { LOOPBACK_HOST, checkEndpoint, isLoopbackHost, parsePort } from './guard.js';
export type { EndpointCheck, EndpointRefusal } from './guard.js';
export { DEFAULT_CAP, DEFAULT_TIMEOUT_MS, capFor, createGet } from './http.js';
export { parsePrometheus } from './prometheus.js';
export type { BoundGet, GetFailure, GetResult, LocalModelProvider, ProviderFailure, ProviderProbe, ProviderResult, ProviderSuccess } from './provider.js';
export { failureOf } from './provider.js';
export { PROVIDERS, providerFor } from './providers.js';
export { llamaServer } from './providers/llama-server.js';
export { CONFIG_FILE_NAME, MAX_ENDPOINTS, WELL_KNOWN_ENDPOINTS, readEndpointConfig } from './config.js';
export type { EndpointConfig, EndpointSpec } from './config.js';
export { DEFAULT_TTL_MS, createReportCache } from './cache.js';
export type { ReportCache, ReportCacheOptions } from './cache.js';
export { collectReport, createLocalModels } from './report.js';
export type { LocalModels, LocalModelsOptions } from './report.js';
