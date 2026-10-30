import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { newEvent, parseEvent } from './schema.js';
import type { UsageEvent } from './schema.js';

/** The log grows to 1 MiB, then keeps its newest 2,000 lines. A read looks at the newest 4 MiB only. */
export const LOG_LIMIT_BYTES = 1024 * 1024;
export const LOG_KEEP_LINES = 2000;
export const LOG_READ_BYTES = 4 * 1024 * 1024;

export interface LogOptions {
  readonly stateRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly now: Date;
  /** The home folder (and any other folder to hide), replaced with `~` in a note before it is stored. */
  readonly home?: string | readonly string[];
}
/** `notice` is a sentence for the person when the write worked but something needs saying. */
export type RecordResult = { readonly ok: true; readonly written: boolean; readonly notice?: string } | { readonly ok: false; readonly code: string };

export const eventLogDir = (stateRoot: string): string => join(stateRoot, 'events');
export const eventLogPath = (stateRoot: string): string => join(eventLogDir(stateRoot), 'events.jsonl');

/** BOWERLOOM_EVENT_LOG=off (or 0, false, no, in any letter case) turns every write into a no-op. */
export const eventLogOff = (env: NodeJS.ProcessEnv): boolean => /^(?:off|0|false|no)$/i.test((env.BOWERLOOM_EVENT_LOG ?? '').trim());

export const errorCode = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'IO_ERROR';
};
const fault = (code: string): Error => Object.assign(new Error(code), { code });

/** The salt, and whether a bad one was replaced (that restarts the count of repositories). */
function saltOf(dir: string): { salt: Buffer; regenerated: boolean } {
  const path = join(dir, 'salt');
  const read = (): Buffer | null => {
    let fd: number;
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) { if ((error as { code?: string }).code === 'ENOENT') return null; throw error; }
    try { fchmodSync(fd, 0o600); const bytes = readFileSync(fd); return bytes.length === 32 ? bytes : null; } finally { closeSync(fd); }
  };
  const have = read(); if (have !== null) return { salt: have, regenerated: false };
  const fresh = randomBytes(32);
  try { writeFileSync(path, fresh, { flag: 'wx', mode: 0o600 }); return { salt: fresh, regenerated: false }; } catch (error) { if ((error as { code?: string }).code !== 'EEXIST') throw error; }
  const again = read(); if (again !== null) return { salt: again, regenerated: false };
  replaceFile(path, fresh);
  return { salt: fresh, regenerated: true };
}

/** Writes beside the target, then renames over it, so a reader sees the old file or the new one. The temp file goes on failure. */
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
    if (eventLogOff(options.env)) return { ok: true, written: false };
    const event = newEvent(input, options.now, options.home);
    if (event === null) return { ok: false, code: 'EVENT_INVALID' };
    const dir = eventLogDir(options.stateRoot);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // A folder that is a symbolic link is refused before anything is changed or written in it.
    if (!lstatSync(dir).isDirectory()) throw fault('EVENT_DIR_NOT_FOLDER');
    chmodSync(dir, 0o700);
    const root = (input as { targetRoot?: unknown }).targetRoot;
    let notice: string | undefined, stored: UsageEvent = event;
    if (typeof root === 'string' && isAbsolute(root) && !root.includes('\0')) {
      const { salt, regenerated } = saltOf(dir);
      stored = { ...event, target: targetId(salt, root) };
      if (regenerated) notice = 'Bowerloom made a new event-log salt because the old one was damaged, so its count of repositories restarts.';
    }
    const path = eventLogPath(options.stateRoot);
    // O_NOFOLLOW: a log that is a symbolic link is refused, not followed.
    const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    let size: number;
    try { fchmodSync(fd, 0o600); writeSync(fd, `${JSON.stringify(stored)}\n`); size = fstatSync(fd).size; } finally { closeSync(fd); }
    if (size > LOG_LIMIT_BYTES) {
      // The event is written. A trim that fails does not undo it. An append by another process between the read and the rename of a
      // trim can be lost; one lost usage line is accepted.
      try {
        const lines = readFileSync(path, 'utf8').split('\n').filter(line => line !== '');
        replaceFile(path, `${lines.slice(-LOG_KEEP_LINES).join('\n')}\n`);
      } catch (error) { notice = `The event log is over 1 MiB and could not be trimmed (${errorCode(error)}).`; }
    }
    return { ok: true, written: true, ...(notice !== undefined ? { notice } : {}) };
  } catch (error) {
    return { ok: false, code: errorCode(error) };
  }
}

export interface ReadResult { events: UsageEvent[]; malformed: number; /** Set when the log exists but could not be read. A missing log is empty, not an error. */ readError?: string }

/**
 * The valid events of the log, oldest first, and the number of lines that were not valid events. Only a missing log is
 * empty; any other failure sets `readError`. Only the newest 4 MiB is read.
 */
export function readEvents(stateRoot: string): ReadResult {
  let text: string;
  try {
    const fd = openSync(eventLogPath(stateRoot), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const size = fstatSync(fd).size, start = Math.max(0, size - LOG_READ_BYTES), buffer = Buffer.alloc(size - start);
      let got = 0; while (got < buffer.length) { const n = readSync(fd, buffer, got, buffer.length - got, start + got); if (n === 0) break; got += n; }
      text = buffer.subarray(0, got).toString('utf8');
      // A read that starts inside a line drops that partial line.
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    } finally { closeSync(fd); }
  } catch (error) {
    return (error as { code?: string }).code === 'ENOENT' ? { events: [], malformed: 0 } : { events: [], malformed: 0, readError: errorCode(error) };
  }
  const events: UsageEvent[] = []; let malformed = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let event: UsageEvent | null = null;
    try { event = parseEvent(JSON.parse(line)); } catch { event = null; }
    if (event === null) malformed += 1; else events.push(event);
  }
  return { events, malformed };
}
