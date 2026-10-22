/**
 * The Claude Code copy of a team agent (spec 01a, section 4.4). Today the copy is the source, byte for byte.
 * `adopt`, `AGENT_TARGET_OCCUPIED`, drift and the closure text all compare against this function's output, never
 * against the raw source. Spec 01b changes only this function. Managed-skills must not import project-sync, so the
 * one definition lives here; project-sync re-exports it.
 */
export function claudeCopyBytes(source: string): string {
  return source;
}
