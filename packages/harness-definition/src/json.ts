/**
 * Strict JSON (section 8, rule 1) and YAML frontmatter (rule 2). The JSON parser is the codex-adapter `strictJson`: it
 * refuses duplicate keys, comments, trailing commas, and numbers that are not finite. Values come back as plain objects.
 */
import { parseDocument } from 'yaml';
import { AdapterError, strictJson } from '../../codex-adapter/src/safe.js';
import { splitFrontmatter } from '../../context-slices/src/frontmatter.js';
import { strictUtf8 } from '../../skill-sources/src/cache.js';
import type { JsonValue } from './types.js';
import { DEFINITION_LIMITS } from './words.js';

export type StrictJsonCode =
  | 'DUPLICATE_JSON_KEY' | 'INVALID_JSON' | 'JSON_BOUND' | 'JSON_COMPLEXITY' | 'NONFINITE_JSON' | 'INVALID_UNICODE' | 'UNSAFE_KEY';
export type StrictJsonResult = { readonly ok: true; readonly value: JsonValue } | { readonly ok: false; readonly code: StrictJsonCode };

/** Parses strict JSON. A refusal names its kind and never repeats the input. */
export function parseStrictJson(text: string): StrictJsonResult {
  let raw: unknown;
  try { raw = strictJson(text, DEFINITION_LIMITS.fileBytes); } catch (error) {
    if (error instanceof AdapterError) return { ok: false, code: error.code as StrictJsonCode };
    throw error;
  }
  const value = toJsonValue(raw);
  return value === undefined ? { ok: false, code: 'UNSAFE_KEY' } : { ok: true, value };
}

/**
 * A plain copy of a JSON value, or undefined when the value is not JSON: a non-finite number, a key `__proto__`, a class
 * instance, a cycle, or nesting deeper than 48.
 */
export function toJsonValue(value: unknown, depth = 0): JsonValue | undefined {
  if (depth > 48) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (const item of value) { const v = toJsonValue(item, depth + 1); if (v === undefined) return undefined; out.push(v); }
    return out;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return undefined;
    const entries: [string, JsonValue][] = [];
    for (const key of Object.keys(value)) {
      if (key === '__proto__') return undefined;
      const v = toJsonValue((value as Record<string, unknown>)[key], depth + 1);
      if (v === undefined) return undefined;
      entries.push([key, v]);
    }
    return Object.fromEntries(entries);
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Strict UTF-8 text with no byte order mark and no NUL, or null. */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return null;
  const text = strictUtf8(bytes);
  return text === null || text.includes('\0') ? null : text;
}

export function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export type FrontmatterResult =
  | { readonly ok: true; readonly data: Readonly<Record<string, JsonValue>>; readonly body: string }
  | { readonly ok: false; readonly code: 'FRONTMATTER_MISSING' | 'FRONTMATTER_INVALID'; readonly message: string };

/**
 * The YAML frontmatter and the body of a Markdown file. Line endings become LF first. The YAML must be one mapping with
 * unique keys, no alias, no unresolved tag, and only JSON values.
 */
export function readFrontmatter(text: string): FrontmatterResult {
  const split = splitFrontmatter(toLf(text));
  if (split === null) return { ok: false, code: 'FRONTMATTER_MISSING', message: 'The file does not open with a --- frontmatter block that closes.' };
  const block = split.block;
  if (Buffer.byteLength(block) > DEFINITION_LIMITS.frontmatterBytes) return invalid('The frontmatter is larger than 64 KiB.');
  const doc = parseDocument(block, { uniqueKeys: true });
  if (doc.errors.length) return invalid('The frontmatter is not valid YAML, or repeats a key.');
  if (doc.warnings.length) return invalid('The frontmatter holds a tag or a value that YAML cannot resolve.');
  let raw: unknown;
  try { raw = doc.toJS({ maxAliasCount: 0 }); } catch { return invalid('The frontmatter uses an alias, or a value that YAML cannot convert.'); }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return invalid('The frontmatter must be one YAML mapping.');
  const data = toJsonValue(raw);
  if (!isRecord(data)) return invalid('The frontmatter holds a value that is not JSON, or the key __proto__.');
  return { ok: true, data, body: split.rest };
}
function invalid(message: string): FrontmatterResult { return { ok: false, code: 'FRONTMATTER_INVALID', message }; }
