/**
 * The made-up local models for the sample launch: two servers up, one down, as the fixtures of the package use. Example-9B is not a real model.
 * The sample bridge answers the same two calls as the real one, from memory, and reads nothing.
 */
import type { LocalBridge } from '../api/local.js';
import type { ExtensionManifest } from '../extensions/types.js';
import type { LocalModel, LocalModelsReport } from './types.js';

/** The manifest of the bundled extension, as in apps/desktop/extensions/local-models/manifest.json (a test holds the two equal). */
export const LOCAL_MODELS_MANIFEST: ExtensionManifest = Object.freeze({ id: 'local-models', title: 'Local models', kind: 'ui', routes: Object.freeze(['local-models']), protected: false });

const base = (port: number): Omit<LocalModel, 'id' | 'state' | 'stateReason' | 'sampledAt'> => ({
  provider: 'llama-server', port, modelName: null, modelFile: null, quantization: null, parameterCount: null, fileBytes: null, contextSize: null, contextTrain: null, contextUsedPeak: null, notes: [],
  slotsTotal: null, activeRequests: null, deferredRequests: null, promptTokensPerSecond: null, generationTokensPerSecond: null, processMemoryBytes: null, uptimeSeconds: null, build: null,
});

export function sampleLocalReport(sampledAt: string): LocalModelsReport {
  const at = { sampledAt };
  return {
    sampledAt, endpointsConfigured: 3, notes: [],
    models: [
      { ...base(8091), ...at, id: 'llama-server:8091', state: 'up', stateReason: null, modelName: 'Example-9B-Q8_0.gguf', modelFile: 'Example-9B-Q8_0.gguf', quantization: 'Q8_0', parameterCount: 8955900928, fileBytes: 9518764032,
        contextSize: 32768, contextTrain: 131072, contextUsedPeak: 8192, slotsTotal: 2, activeRequests: 1, deferredRequests: 0, promptTokensPerSecond: 412.6, generationTokensPerSecond: 38.4, build: 'b12110' },
      { ...base(8092), ...at, id: 'llama-server:8092', state: 'up', stateReason: null, modelName: 'Example-20B-MXFP4.gguf', modelFile: 'Example-20B-MXFP4.gguf', quantization: 'MXFP4', parameterCount: 20914757184, fileBytes: 12109566560,
        contextSize: 65536, contextTrain: 131072, contextUsedPeak: 1024, slotsTotal: 4, activeRequests: 0, deferredRequests: 0, promptTokensPerSecond: 0, generationTokensPerSecond: 61.2, build: 'b12110' },
      { ...base(8093), ...at, id: 'llama-server:8093', state: 'down', stateReason: 'CONNECTION_REFUSED' },
    ],
  };
}

/** The bridge of the sample launch. `now` gives the time of each read as an ISO text: the page passes its clock (renderer/harness/clock.ts), and a test passes a fixed one. This file reads no clock. */
export function createSampleLocal(now: () => string): LocalBridge {
  return {
    localModels: async () => sampleLocalReport(now()),
    listExtensions: async () => ({ extensions: [LOCAL_MODELS_MANIFEST], skipped: [] }),
  };
}
