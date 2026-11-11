/**
 * The shape rules of the arguments of the `bowerloomRuns` calls (shared/api/runs.ts names the calls). Main checks every argument with these before it acts on it; the page uses them too, so a form never sends what
 * main would refuse. Pure functions: no Electron and no Node module. The preload does not load this file: it only forwards what the page passes, and main refuses a bad shape.
 */
import { ENGINE_IDS } from '../engine/engines.js';
import type { EngineId } from '../engine/types.js';
import { RECORDED_STATUSES, RUN_INSTRUCTION_LIMIT, RUN_NOTES_LIMIT, RUN_RATINGS, RUN_REFUSAL_CODES } from './runs.js';
import type { RecordRunInput, RecordedStatus, RunPatch, RunRating, RunRefusalCode } from './runs.js';

export const RUN_ID = /^run-[0-9]{1,6}$/;
export const FOLDER_ID = /^folder-[0-9]{1,6}$/;
const plain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every(k => keys.includes(k));
// A control character other than a tab or a line break, or a lone surrogate, is not text a person wrote.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const cleanText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !CONTROL.test(value) && !LONE_SURROGATE.test(value);

/** The short code in an error from a runs call, or 'FAILED'. The same rule as `runsCodeOf` of the client (renderer/api/client.ts), here so a screen can read a code without reaching the client. */
const CODE_PATTERN = new RegExp(`\\b(${RUN_REFUSAL_CODES.filter(c => c !== 'FAILED').join('|')})\\b`);
export function runsCode(error: unknown): RunRefusalCode {
  const found = String(error instanceof Error ? error.message : error).match(CODE_PATTERN);
  return found === null ? 'FAILED' : (found[1] as RunRefusalCode);
}

export const isRunId = (value: unknown): value is string => typeof value === 'string' && RUN_ID.test(value);
export const isEngineIdValue = (value: unknown): value is EngineId => typeof value === 'string' && (ENGINE_IDS as readonly string[]).includes(value);

/** An ISO time the page and main accept: valid, written with `Z`, not before 2020 and not more than a day ahead of `nowMs`. Returns the canonical ISO text, or null. */
export function cleanStartedAt(value: unknown, nowMs: number): string | null {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < Date.parse('2020-01-01T00:00:00Z') || ms > nowMs + 24 * 3600 * 1000) return null;
  return new Date(ms).toISOString();
}

/** The input of `recordRun`, checked, or null. The instruction is trimmed and must not be empty. */
export function parseRecordInput(value: unknown, nowMs: number): RecordRunInput | null {
  if (!plain(value) || !onlyKeys(value, ['folderId', 'engine', 'instruction', 'startedAt'])) return null;
  const { folderId, engine, instruction, startedAt } = value;
  if (typeof folderId !== 'string' || !FOLDER_ID.test(folderId) || !isEngineIdValue(engine) || !cleanText(instruction, RUN_INSTRUCTION_LIMIT)) return null;
  const text = instruction.trim();
  if (text === '') return null;
  if (startedAt === null || startedAt === undefined) return { folderId, engine, instruction: text, startedAt: null };
  const at = cleanStartedAt(startedAt, nowMs);
  return at === null ? null : { folderId, engine, instruction: text, startedAt: at };
}

/** The patch of `updateRun`, checked, or null. At least one field, and no other. */
export function parseRunPatch(value: unknown): RunPatch | null {
  if (!plain(value) || !onlyKeys(value, ['status', 'rating', 'notes']) || Object.keys(value).length === 0) return null;
  const out: { status?: RecordedStatus; rating?: RunRating | null; notes?: string } = {};
  if ('status' in value) { if (!(RECORDED_STATUSES as readonly unknown[]).includes(value.status)) return null; out.status = value.status as RecordedStatus; }
  if ('rating' in value) { if (value.rating !== null && !(RUN_RATINGS as readonly unknown[]).includes(value.rating)) return null; out.rating = value.rating as RunRating | null; }
  if ('notes' in value) { if (!cleanText(value.notes, RUN_NOTES_LIMIT)) return null; out.notes = value.notes; }
  return out;
}
