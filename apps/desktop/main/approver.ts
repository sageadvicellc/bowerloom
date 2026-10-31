/**
 * The name the app writes in the `who` field of an approval record. The record needs a name of 1 to 256 characters, and the app never uses the account name of the
 * computer (owner decision, 2026-10-31). A fixed word keeps the record valid and keeps the account name out of the private state folder.
 */
export const APPROVER_NAME = 'this Mac';
