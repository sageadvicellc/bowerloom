/**
 * The approval of a linked notes folder that lives in the home folder (`~/` form). A `knowledge.json` can come from a cloned repository, so a home folder it names is read only
 * when this machine's own record holds an approval for that harness folder and that stored path. The link flow writes the record when the person approves the save
 * (main/linked-approvals.ts); the reader only reads it (main/real-scan.ts). A folder below the harness folder is part of the project and needs none. Pure: no file is touched here.
 */
import { hashText } from '../world/sample.js';

export const APPROVALS_VERSION = 1;
/** The most approvals one record keeps. A longer record is not read at all. */
export const APPROVALS_MAX = 2000;
/** The most bytes the record may take. */
export const APPROVALS_MAX_BYTES = 256 * 1024;

/** The key of one approval: the real harness folder and the stored path, hashed together, so the record names no folder. */
export const approvalKey = (harnessFolder: string, stored: string): string => hashText(`${harnessFolder}\u0000${stored}`).slice(0, 24);

const KEY = /^[0-9a-z]{6,64}$/;

/** The keys of a record, or an empty set for text that is not a record of this version. */
export function parseApprovals(text: string): ReadonlySet<string> {
  try {
    const v = JSON.parse(text) as { version?: unknown; keys?: unknown } | null;
    if (v === null || typeof v !== 'object' || v.version !== APPROVALS_VERSION || !Array.isArray(v.keys) || v.keys.length > APPROVALS_MAX) return new Set();
    return new Set(v.keys.filter((k): k is string => typeof k === 'string' && KEY.test(k)));
  } catch { return new Set(); }
}

export const serializeApprovals = (keys: ReadonlySet<string>): string => `${JSON.stringify({ version: APPROVALS_VERSION, keys: [...keys].sort() })}\n`;
