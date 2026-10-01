# Authorized synthetic retrieval

`packages/roots` provides the alpha keyword retrieval service. A trusted controller registers a fixed synthetic corpus and current grants. A reader authenticates each request through an injected `IdentityProvider` and returns bounded, literal quotations from sources that principal can currently read. The service is usable from a CLI or coordinator without loading files, connecting to a database, or calling a model.

This package sends no telemetry. It contains no network, filesystem, embedding, or model client and accepts no telemetry callback. Its injected identity provider remains trusted application code; the controller is responsible for that provider's authentication, timeouts, and side effects. The package does not establish whole-process network isolation.

## Controller and reader

After `npm run build`, a controller can use the compiled module as follows. This standalone example uses only synthetic text and an in-memory demonstration credential. Production caller identity must come from the controller's authenticated transport, not a subject selected by a worker.

```js
import {
  pinSyntheticSource, pinSyntheticCorpus, registerSyntheticCorpus,
} from './dist/packages/roots/src/index.js';

const source = pinSyntheticSource('endor-orders', '1',
  'The Endor craft shop reviews new orders each morning.');
const sourcePin = {
  sourceId: source.sourceId, revision: source.revision, digest: source.digest,
};
const snapshot = pinSyntheticCorpus('endor-demo', '1', [source]);
const controller = registerSyntheticCorpus(snapshot, [{
  subject: 'agent:coda', source: sourcePin, expiresAtMs: Date.now() + 60_000,
}], {
  identity: {
    async authenticate(credential) {
      if (credential !== 'synthetic-demo-credential') throw new Error('Denied');
      return {
        subject: 'agent:coda', proofRef: 'synthetic-demo-proof',
        expiresAtMs: Date.now() + 30_000,
      };
    },
  },
});

// Give the caller only this reader and the corpus pin, never the controller.
const result = await controller.reader.query({
  format: 'trellis/keyword-query/v0.7-alpha',
  corpus: controller.pin,
  text: 'craft orders',
  sources: [sourcePin], // Optional narrowing to already granted sources.
  limit: 3,
}, 'synthetic-demo-credential');
console.log(JSON.stringify(result));

controller.replaceGrants([]); // All subsequent reads are denied.
```

The controller owns document content, source IDs, revisions, digest verification, the identity provider, and the complete grant list. `replaceGrants` is a control-plane capability. The reader exposes only `query`. Grant replacement validates the entire list before swapping it; an invalid replacement leaves existing grants intact. Registration copies document and grant data, so later mutation of the original objects cannot alter the registered corpus.

Source pins bind the exact UTF-8 text with SHA-256. A corpus pin binds its format, classification, ID, revision, and source pins sorted by source ID. Changed content needs a newly pinned corpus registration. The required `synthetic` classification is a trusted-controller assertion, not a detector for private data. No old wiki or customer-data import is implemented.

Each query authenticates afresh, then reads current grants. Revocation while authentication is pending takes effect before retrieval. The service checks the authenticated principal's expiration, grant expiration, and grant generation again before returning. A backward or invalid clock fails closed. Quotes already returned cannot be retracted; downstream caches must not bypass later authorization checks.

The caller cannot supply a principal, grants, paths, retrieval strategy, or arbitrary options. An optional source list only narrows existing grants. Requests for hidden and nonexistent sources return the same `SOURCE_UNAVAILABLE` code; a mixed authorized/unauthorized list denies the whole request. Wrong pins for an authorized source or corpus fail with `STALE_SOURCE_PIN` or `STALE_CORPUS_PIN`. Unauthorized sources never participate in scores, excerpts, hit counts, or truncation.

## Quotes, scoring, and limits

Results use `trellis/quoted-sources/v0.7-alpha` and `kind: untrusted-source-quotes`. Each hit includes its source ID, revision, digest, matched terms, integer score, and a literal contiguous excerpt with UTF-16 offsets into the original source. Source text is not interpreted, escaped into instructions, executed, or fetched. A consumer must keep these quotes in a data field and safely render them; the label alone cannot stop a downstream model from following malicious text.

`keyword-coverage-v1` splits Unicode letter/number words with combining marks, applies NFKC normalization and lowercase, and removes duplicate query terms. Matching uses OR semantics, without stemming or semantic similarity. A hit receives 1,000 points per distinct matched query term plus each term's source frequency capped at eight. Ties sort by source ID using codepoint comparison. The excerpt starts at the earliest matching word and ends at a Unicode boundary within the byte limit. The supported Node runtime supplies Unicode normalization behavior.

| Resource | Limit |
| --- | ---: |
| Sources / UTF-8 bytes per source / corpus bytes | 64 / 32,768 / 1,048,576 |
| Indexed distinct terms per source / summed across sources | 4,096 / 32,768 |
| Grants / distinct principals | 1,024 / 64 |
| Query UTF-8 bytes / distinct terms | 256 / 16 |
| Normalized term codepoints | 64 |
| Returned hits / UTF-8 bytes per excerpt | 5 / 512 |
| Serialized JSON response bytes | 16,384 |

Source words exceeding the term limit are not indexed; a query containing such a word is rejected. Empty, malformed, sparse, accessor-bearing, or unexpected-field input is rejected. Queries are copied before asynchronous authentication. The service accepts plain data, not executable object proxies; the calling transport must parse and bound request bodies before constructing requests. It must also limit request concurrency and authenticate within a bounded deadline. `RootsError` exposes fixed codes without echoing credentials, queries, or source content.

Responses are frozen and limited after JSON escaping. If necessary, lower-ranked hits are removed until the byte cap holds. `truncated` reports omitted authorized matches only. An authorized query with no matches returns an empty result.

## Beta embedding boundary

The exported `EmbeddingProvider` types describe a portable versioned model space, local or remote deployment, input/content digests, source pins, batch limits, an abort signal, and input-associated vectors. They are a contract for future work only. Alpha neither instantiates providers nor performs semantic retrieval, paid requests, caching, or vector validation.

A beta implementation must authorize sources before embedding or retrieval, validate dimensions and finite values, bind model and source revisions to cached results, enforce cancellation and resource limits, and establish consent and retention rules for any remote transfer. This package does not claim those beta controls are implemented.

Run `npm run test:roots` for the synthetic authorization and retrieval tests. The shared test command also includes them. This package adds no dependencies and does not wire the CLI or the live worker adapter; that integration receives only the reader capability.
