import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { newEvent, parseEvent } from './schema.js';
import type { UsageEvent } from './schema.js';

/** The log grows to 1 MiB, then keeps its newest 2,000 lines. */
export const LOG_LIMIT_BYTES = 1024 * 1024;
export const LOG_KEEP_LINES = 2000;

export interface LogOptions { readonly stateRoot: string; readonly env: NodeJS.ProcessEnv; readonly now: Date }
export type RecordResult = { readonly ok: true; readonly written: boolean } | { readonly ok: false; readonly code: string };

export const eventLogDir = (stateRoot: string): string => join(stateRoot, 'events');
export const eventLogPath = (stateRoot: string): string => join(eventLogDir(stateRoot), 'events.jsonl');

const codeOfError = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'IO_ERROR';
};

function saltOf(dir: string): Buffer {
  const path = join(dir, 'salt');
  const read = (): Buffer | null => {
    try { const bytes = readFileSync(path); return bytes.length === 32 ? bytes : null; } catch (error) { if ((error as { code?: string }).code === 'ENOENT') return null; throw error; }
  };
  const have = read(); if (have !== null) return have;
  const fresh = randomBytes(32);
  try { writeFileSync(path, fresh, { flag: 'wx', mode: 0o600 }); return fresh; } catch (error) { if ((error as { code?: string }).code !== 'EEXIST') throw error; }
  const again = read(); if (again !== null) return again;
  replaceFile(path, fresh);
  return fresh;
}

/** Writes beside the target, then renames over it, so a reader sees the old file or the new one. */
function replaceFile(path: string, data: Buffer | string): void {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try { writeFileSync(temp, data, { flag: 'wx', mode: 0o600 }); renameSync(temp, path); } catch (error) { try { unlinkSync(temp); } catch { /* not there */ } throw error; }
}

/** The pseudonym of a project folder: the first 16 hex characters of HMAC-SHA256 under the local salt. Used to count folders, never shown. */
export function targetId(salt: Buffer, root: string): string { return createHmac('sha256', salt).update(root).digest('hex').slice(0, 16); }

/**
 * Appends one event to `<stateRoot>/events/events.jsonl`. It never throws: a failure comes back as `{ ok: false, code }`.
 * With BOWERLOOM_EVENT_LOG=off it writes nothing. `input.targetRoot` is an absolute project folder, stored only as a pseudonym.
 */
export function recordEvent(options: LogOptions, input: unknown): RecordResult {
  try {
    if (options.env.BOWERLOOM_EVENT_LOG === 'off') return { ok: true, written: false };
    const event = newEvent(input, options.now);
    if (event === null) return { ok: false, code: 'EVENT_INVALID' };
    const dir = eventLogDir(options.stateRoot);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const root = (input as { targetRoot?: unknown }).targetRoot;
    const stored: UsageEvent = typeof root === 'string' && isAbsolute(root) && !root.includes('\0') ? { ...event, target: targetId(saltOf(dir), root) } : event;
    const path = eventLogPath(options.stateRoot);
    // O_NOFOLLOW: a log that is a symbolic link is refused, not followed.
    const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    let size: number;
    try { fchmodSync(fd, 0o600); writeSync(fd, `${JSON.stringify(stored)}\n`); size = fstatSync(fd).size; } finally { closeSync(fd); }
    if (size > LOG_LIMIT_BYTES) {
      const lines = readFileSync(path, 'utf8').split('\n').filter(line => line !== '');
      replaceFile(path, `${lines.slice(-LOG_KEEP_LINES).join('\n')}\n`);
    }
    return { ok: true, written: true };
  } catch (error) {
    return { ok: false, code: codeOfError(error) };
  }
}

/** The valid events of the log, oldest first, and the number of lines that were not valid events. A missing or unreadable log is empty. */
export function readEvents(stateRoot: string): { events: UsageEvent[]; malformed: number } {
  let text: string;
  try { text = readFileSync(eventLogPath(stateRoot), 'utf8'); } catch { return { events: [], malformed: 0 }; }
  const events: UsageEvent[] = []; let malformed = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let event: UsageEvent | null = null;
    try { event = parseEvent(JSON.parse(line)); } catch { event = null; }
    if (event === null) malformed += 1; else events.push(event);
  }
  return { events, malformed };
}
