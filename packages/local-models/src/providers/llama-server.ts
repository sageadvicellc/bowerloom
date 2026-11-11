/**
 * The llama-server provider. It reads /health, /props, /slots, /metrics and /v1/models and keeps only the fields the report names. Nothing is copied by spread or by loop:
 * each field is picked by name, checked for its type, and cleaned. A prompt, an output, a chat template, a token text or a generation setting is never read, so it cannot
 * reach the report, the cache or a file. A model file is shown by its base name. A field the server did not give is left out, never set to 0.
 */
import { parsePrometheus } from '../prometheus.js';
import { failureOf } from '../provider.js';
import type { BoundGet, GetResult, LocalModelProvider, ProviderProbe, ProviderResult } from '../provider.js';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Json = Readonly<Record<string, unknown>>;

/** The text shown for any name or build is cut at this many characters. */
const SHOWN_MAX = 120;
/** Control characters, format characters, invisible and look-alike spaces: replaced with a question mark, as the extension loader does. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u17b4\u17b5\ufffc\u{1d173}-\u{1d17a}\u00a0\u2000-\u200a\u2800]/gu;

function clean(text: string): string {
  const chars = [...text.replace(UNSAFE, '?')];
  return chars.length > SHOWN_MAX ? `${chars.slice(0, SHOWN_MAX).join('')}…` : chars.join('');
}

/** The last part of a path written with / or \. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(part => part !== '');
  return parts.length === 0 ? '' : (parts[parts.length - 1] as string);
}

/** An absolute path, a home path or a Windows path: it can hold a user name, so only its base name is shown. */
const isAbsolute = (text: string): boolean => text.startsWith('/') || text.startsWith('~') || text.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(text);

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
/** A count: a whole number, zero or more. */
const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined);
/** A rate: a number, zero or more, that is not infinite. */
const rate = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined);

/** The body as JSON, only for a 200 answer. Anything else gives undefined. */
function jsonOf(result: GetResult): unknown {
  if (!result.ok || result.status !== 200) return undefined;
  try { return JSON.parse(result.body) as unknown; } catch { return undefined; }
}

/** A name for display: a path that could hold a user name is cut to its base name; a relative name stays as the server gave it. */
function shownName(value: unknown): string | undefined {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const name = clean(isAbsolute(raw) ? baseName(raw) : raw);
  return name === '' ? undefined : name;
}

function shownFile(value: unknown): string | undefined {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const name = clean(baseName(raw));
  return name === '' ? undefined : name;
}

function shownText(value: unknown): string | undefined {
  const raw = text(value);
  return raw === undefined ? undefined : clean(raw);
}

const METRIC = {
  peak: 'llamacpp:n_tokens_max', processing: 'llamacpp:requests_processing', deferred: 'llamacpp:requests_deferred',
  promptRate: 'llamacpp:prompt_tokens_seconds', generationRate: 'llamacpp:predicted_tokens_seconds',
} as const;

/** Only the HTTP answers that say "this endpoint is switched off". */
const isOff = (result: GetResult): boolean => result.ok && (result.status === 404 || result.status === 501);

async function probe(get: BoundGet): Promise<ProviderResult> {
  const [health, props, slots, metrics, models] = await Promise.all([get('/health'), get('/props'), get('/slots'), get('/metrics'), get('/v1/models')]);

  if (!health.ok) return failureOf(health.code);
  const unsupported: ProviderResult = { ok: false, state: 'unsupported', reason: 'BAD_RESPONSE' };
  const healthJson = (() => { try { return JSON.parse(health.body) as unknown; } catch { return undefined; } })();
  if (health.status === 503) {
    const error = isObject(healthJson) ? healthJson['error'] : undefined;
    if (isObject(error) && error['code'] === 503) return { ok: true, rows: [{ state: 'starting', reason: 'LOADING' }], notes: [] };
    return unsupported;
  }
  if (health.status !== 200 || !isObject(healthJson) || healthJson['status'] !== 'ok') return unsupported;

  const row: Mutable<ProviderProbe> = { state: 'up' };
  const notes: string[] = [];

  const propsJson = jsonOf(props);
  const props_: Json = isObject(propsJson) ? propsJson : {};
  const modelsJson = jsonOf(models);
  const list = isObject(modelsJson) && Array.isArray(modelsJson['data']) ? (modelsJson['data'] as readonly unknown[]) : [];
  const first: Json = isObject(list[0]) ? list[0] : {};
  const meta: Json = isObject(first['meta']) ? first['meta'] : {};
  const slotsJson = jsonOf(slots);
  const slotList: readonly Json[] = Array.isArray(slotsJson) ? (slotsJson as readonly unknown[]).filter(isObject) : [];

  const name = shownName(props_['model_alias']) ?? shownName(first['id']);
  if (name !== undefined) row.modelName = name;
  const file = shownFile(props_['model_path']);
  if (file !== undefined) row.modelFile = file;
  const quantization = shownText(props_['model_ftype']) ?? shownText(meta['ftype']);
  if (quantization !== undefined) row.quantization = quantization;
  const parameterCount = count(meta['n_params']);
  if (parameterCount !== undefined) row.parameterCount = parameterCount;
  const fileBytes = count(meta['size']);
  if (fileBytes !== undefined) row.fileBytes = fileBytes;
  const contextSize = count(meta['n_ctx']) ?? count(slotList[0]?.['n_ctx']);
  if (contextSize !== undefined) row.contextSize = contextSize;
  const contextTrain = count(meta['n_ctx_train']);
  if (contextTrain !== undefined) row.contextTrain = contextTrain;
  const slotsTotal = count(props_['total_slots']) ?? (slotList.length > 0 ? slotList.length : undefined);
  if (slotsTotal !== undefined) row.slotsTotal = slotsTotal;
  const build = shownText(props_['build_info']);
  if (build !== undefined) row.build = build;

  if (isOff(metrics)) notes.push('METRICS_OFF');
  else if (metrics.ok && metrics.status === 200) {
    const found = parsePrometheus(metrics.body, Object.values(METRIC));
    const peak = count(found.get(METRIC.peak));
    if (peak !== undefined) row.contextUsedPeak = peak;
    const processing = count(found.get(METRIC.processing));
    if (processing !== undefined) row.activeRequests = processing;
    const deferred = count(found.get(METRIC.deferred));
    if (deferred !== undefined) row.deferredRequests = deferred;
    const promptRate = rate(found.get(METRIC.promptRate));
    if (promptRate !== undefined) row.promptTokensPerSecond = promptRate;
    const generationRate = rate(found.get(METRIC.generationRate));
    if (generationRate !== undefined) row.generationTokensPerSecond = generationRate;
  }
  return { ok: true, rows: [row], notes };
}

export const llamaServer: LocalModelProvider = Object.freeze({ id: 'llama-server' as const, defaultPort: 8080, probe });
