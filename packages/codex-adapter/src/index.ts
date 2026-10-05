import { CodexAdapterCore } from './adapter-core.js';
import { CodexProposalBoundary, type CodexBetaBoundaryOptions } from './boundary.js';
import type { CodexAdapterOptions } from './adapter-core.js';
import type { ModelAdapter, ModelProcess } from './types.js';
export { proposalPrompt } from './adapter-core.js';
export type { CodexAdapterOptions } from './adapter-core.js';
export { planCodexProposalLaunch, codexBoundaryAccountRevision, codexArtifactRevision, measureCodexInstalledArtifact, codexQualificationRevision, refuseCodexQualificationProbe } from './boundary.js';
export type { CodexArtifactBinding, CodexBetaBoundaryOptions, CodexBoundaryQualification } from './boundary.js';
export { CodexObservationReader } from './reader.js';
export { accountBindingDigest } from './observation.js';
export { AdapterError } from './safe.js';
export { POLICY_VERSION,MODEL_ROUTE,CODEX_VERSION,SUPPORTED_NATIVE_SHA256 } from './policy.js';
export type * from './types.js';
// Public constructors deliberately cannot receive a private admission gate.
export class CodexAdapter implements ModelAdapter {
  readonly #adapter: CodexAdapterCore;
  constructor(options:CodexAdapterOptions){ this.#adapter=new CodexAdapterCore(options); }
  start(input:{launcherId:string;taskInput:string;modelRoute:string},signal:AbortSignal):Promise<ModelProcess>{return this.#adapter.start(input,signal);}
}
/** Explicit beta selection. Missing qualification never selects the historical alpha route. */
export class CodexBetaAdapter implements ModelAdapter {
  readonly #adapter: CodexAdapterCore;
  constructor(options:CodexAdapterOptions & {boundary:CodexBetaBoundaryOptions}) {
    this.#adapter=new CodexAdapterCore(options,new CodexProposalBoundary(options.boundary,options.installation,options.binding,options.accountAlias));
  }
  start(input:{launcherId:string;taskInput:string;modelRoute:string},signal:AbortSignal):Promise<ModelProcess>{return this.#adapter.start(input,signal);}
}
