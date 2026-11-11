/**
 * The approval of a linked notes folder that lives in the home folder (`~/` form). A `knowledge.json` can come from a cloned repository, so a home folder it names is read only
 * when this machine's own record holds an approval for that harness folder and that stored path. The link flow writes the record when the person approves the save
 * (main/linked-approvals.ts); the reader only reads it (main/real-scan.ts). A folder below the harness folder is part of the project and needs none. Pure: no file is touched here.
 */
import { sha256Hex } from './sha256.js';

export const APPROVALS_VERSION = 1;
/** The most approvals one record keeps. A longer record is not read at all. */
export const APPROVALS_MAX = 2000;
/** The most bytes the record may take. */
export const APPROVALS_MAX_BYTES = 256 * 1024;

/**
 * The key of one approval: the real harness folder, the stored path and the real folder the path led to when the person approved, hashed together (SHA-256, cut to 32 characters), so the
 * record names no folder, and a stored path that later points somewhere else through a swapped shortcut needs a new approval.
 */
export const approvalKey = (harnessFolder: string, stored: string, target: string): string => sha256Hex(`${harnessFolder}\u0000${stored}\u0000${target}`).slice(0, 32);

const KEY = /^[0-9a-f]{32}$/;

/** The keys of a record, or null for text that is not a record of this version (a damaged record). */
export function parseApprovals(text: string): ReadonlySet<string> | null {
  try {
    const v = JSON.parse(text) as { version?: unknown; keys?: unknown } | null;
    if (v === null || typeof v !== 'object' || v.version !== APPROVALS_VERSION || !Array.isArray(v.keys) || v.keys.length > APPROVALS_MAX || !v.keys.every(k => typeof k === 'string' && KEY.test(k))) return null;
    return new Set(v.keys as string[]);
  } catch { return null; }
}

export const serializeApprovals = (keys: ReadonlySet<string>): string => `${JSON.stringify({ version: APPROVALS_VERSION, keys: [...keys].sort() })}\n`;
