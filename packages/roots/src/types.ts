import type { IdentityProvider } from '../../broker/src/types.js';
export interface SourcePin { readonly sourceId: string; readonly revision: string; readonly digest: string }
export interface SourceDocument extends SourcePin { readonly text: string }
export interface CorpusPin { readonly corpusId: string; readonly revision: string; readonly digest: string }
export interface SyntheticCorpus extends CorpusPin {
  readonly format: 'trellis/synthetic-corpus/v0.7-alpha';
  readonly classification: 'synthetic';
  readonly sources: readonly SourceDocument[];
}
export interface SourceGrant { readonly subject: string; readonly source: SourcePin; readonly expiresAtMs: number }
export interface KeywordQuery {
  readonly format: 'trellis/keyword-query/v0.7-alpha';
  readonly corpus: CorpusPin;
  readonly text: string;
  readonly sources?: readonly SourcePin[];
  readonly limit?: number;
}
export interface QuotedHit {
  readonly source: SourcePin;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly excerpt: { readonly text: string; readonly startUtf16: number; readonly endUtf16: number };
}
export interface QuotedResult {
  readonly format: 'trellis/quoted-sources/v0.7-alpha';
  readonly kind: 'untrusted-source-quotes';
  readonly corpus: CorpusPin;
  readonly scoreVersion: 'keyword-coverage-v1';
  readonly hits: readonly QuotedHit[];
  readonly truncated: boolean;
}
export interface RootsReader { query(request: KeywordQuery, credential: unknown): Promise<QuotedResult> }
export interface RootsController {
  readonly pin: CorpusPin;
  readonly reader: RootsReader;
  // Trusted control-plane capability. Never expose this handle to query callers.
  replaceGrants(grants: readonly SourceGrant[]): void;
}
export interface RootsDependencies { identity: IdentityProvider; now?: () => number }

// Portable beta contract only. Alpha never instantiates or calls an embedding provider.
export interface EmbeddingSpace {
  readonly providerId: string; readonly modelId: string; readonly modelRevision: string;
  readonly dimensions: number; readonly normalization: 'none' | 'unit-l2';
  readonly deployment: 'local' | 'remote';
}
export interface EmbeddingInput {
  readonly inputId: string; readonly text: string; readonly digest: string; readonly source: SourcePin | null;
}
export interface EmbeddingRequest {
  readonly format: 'trellis/embedding-request/v1-beta';
  readonly space: EmbeddingSpace; readonly purpose: 'document' | 'query'; readonly inputs: readonly EmbeddingInput[];
}
export interface EmbeddingResponse {
  readonly format: 'trellis/embedding-result/v1-beta'; readonly space: EmbeddingSpace;
  readonly vectors: readonly { readonly inputId: string; readonly digest: string; readonly values: readonly number[] }[];
}
export interface EmbeddingProvider {
  readonly space: EmbeddingSpace;
  readonly limits: { readonly maxInputs: number; readonly maxInputBytes: number };
  embed(request: EmbeddingRequest, signal: AbortSignal): Promise<EmbeddingResponse>;
}
