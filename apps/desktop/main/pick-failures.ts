/**
 * The last failure to approve a notes folder at its pick, kept in memory for this session only, by the approval key of the folder. main/notes-pick.ts records and clears it; main/linked-notes.ts reads
 * it, so a link to a folder whose approval could not be saved says so ("could not save approvals on this computer") and never "link it again", which cannot work until the cause is gone. No file is
 * written: a marker would be a second record to keep true. A restart forgets it, and the next pick tries again. At most `MAX` folders are remembered, the oldest forgotten first. No fs name here.
 */
export type PickFailure = 'full' | 'failed' | 'not-a-folder' | 'not-moved';
const MAX = 2000;
const failures = new Map<string, PickFailure>();

export function recordPickFailure(key: string, why: PickFailure): void {
  failures.delete(key);
  failures.set(key, why);
  while (failures.size > MAX) failures.delete(failures.keys().next().value as string);
}
export const clearPickFailure = (key: string): void => { failures.delete(key); };
export const pickFailureOf = (key: string): PickFailure | undefined => failures.get(key);
/** For a test: forget everything. */
export const forgetPickFailures = (): void => { failures.clear(); };
