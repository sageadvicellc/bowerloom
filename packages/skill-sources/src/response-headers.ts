/**
 * Response header names the npm and Git transports guard (decision D11).
 * The transports read content-length, content-encoding and location.
 * Content-type, transfer-encoding and content-range change how a body is framed or interpreted.
 * A repeat of any of these names is ambiguous, so the response refuses.
 * A repeat of any other name, such as set-cookie, is ignored, because nothing reads it.
 * This is an allowlist of guarded names. A name added here becomes guarded; no other name is.
 */
export const GUARDED_RESPONSE_HEADERS: readonly string[] = Object.freeze(['content-encoding', 'content-length', 'content-range', 'content-type', 'location', 'transfer-encoding']);
const GUARDED = new Set(GUARDED_RESPONSE_HEADERS);

/**
 * The most raw header pairs a response may carry.
 * Node's parser keeps about 1000 pairs and drops the rest without an error, so a guarded repeat placed after them is never seen.
 * A list this short is far below that cap, so a list that passes was not truncated. The registry sends about 10 pairs.
 */
export const MAX_RESPONSE_HEADER_PAIRS = 128;

/**
 * Reads the guarded headers from Node's raw name/value list, keyed by lower-case name.
 * It returns null when a guarded name repeats, the list holds more than MAX_RESPONSE_HEADER_PAIRS pairs, or the list is malformed.
 * It also returns null when transfer-encoding is present and its trimmed value is not exactly `chunked` (lead decision, 2026-10-07).
 * The caller refuses with its own code.
 * Values are returned to the caller only. Nothing here logs or reports a header value.
 */
export function guardedResponseHeaders(raw: unknown): Map<string, string> | null {
  if (!Array.isArray(raw) || raw.length % 2 !== 0 || raw.length > MAX_RESPONSE_HEADER_PAIRS * 2) return null;
  const headers = new Map<string, string>();
  for (let i = 0; i < raw.length; i += 2) {
    const name: unknown = raw[i], value: unknown = raw[i + 1];
    if (typeof name !== 'string' || typeof value !== 'string') return null;
    const key = name.toLowerCase();
    if (!GUARDED.has(key)) continue;
    if (headers.has(key)) return null;
    headers.set(key, value);
  }
  const framing = headers.get('transfer-encoding');
  if (framing !== undefined && framing.trim() !== 'chunked') return null;
  return headers;
}
