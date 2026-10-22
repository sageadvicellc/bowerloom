/**
 * The one writer of an authoring receipt (spec 08, 4.4). `applyCreate`, `store migrate`, and `receipt clean` use it.
 * Internal to the Bowerloom packages; the package index exports it.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { lstatOrNull, sha256, syncFolder, writeNewFile } from './files.js';
import { ensure, refuse } from './refusal.js';
import { RECEIPT, parseReceipt, receiptOf, recordText, tempName } from './state.js';
import type { AuthoredItem, Read } from './state.js';

/**
 * Writes the receipt that lists `next`, in the folder `auth` (`.bowerloom/authoring` or `~/.bowerloom/authoring`).
 * The text is parsed back first, and a record that would not read back refuses AUTHORING_RECEIPT_INVALID. The record is
 * written to the temporary `tempName(planRevision, 'receipt')`. Then `live()` runs, and the receipt must still have the
 * hash `before` that the plan read (`readNow()` reads it); a change refuses STALE_APPROVAL. A null `before` links the
 * temporary file, so a receipt that appeared meanwhile is never overwritten; any other `before` renames it. The folder
 * is flushed, and the Read of the new bytes is returned. No temporary file stays, whatever happens.
 */
export function writeReceiptRecord(auth: string, planRevision: string, before: Read | null, next: readonly AuthoredItem[], live: () => void, readNow: () => Read | null): Read {
  const text = recordText(receiptOf(next));
  // parseReceipt checks every item and that the bytes are exactly the record's serialization.
  parseReceipt(Buffer.from(text));
  const temp = join(auth, tempName(planRevision, 'receipt')), target = join(auth, RECEIPT);
  writeNewFile(temp, text);
  try {
    live();
    const now = readNow();
    ensure((now?.sha256 ?? null) === (before?.sha256 ?? null), 'STALE_APPROVAL');
    if (before === null) {
      try { fs.linkSync(temp, target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') refuse('STALE_APPROVAL'); throw error; }
      fs.unlinkSync(temp);
    } else fs.renameSync(temp, target);
  } finally { if (lstatOrNull(temp) !== null) fs.unlinkSync(temp); }
  syncFolder(auth);
  return { sha256: sha256(text), bytes: Buffer.byteLength(text) };
}
