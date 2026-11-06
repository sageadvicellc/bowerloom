/**
 * Small word helpers that more than one prototype module needs, kept in one place so the words never drift apart.
 * Pure: no clock, no random number, no file.
 */
import type { InterfaceId } from './types.js';

/** A list in words: "a", "a and b", "a, b and c". `last` is the word before the final item ("and" by default, "or" for a choice). */
export function joinWords(items: readonly string[], last = 'and'): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`;
}

/** The one table of interface names as a person says them. */
export const INTERFACE_WORDS: Readonly<Record<InterfaceId, string>> = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode', hermes: 'Hermes', bowerloom: 'Bowerloom' });

/** The interface's name as a person says it. */
export const interfaceName = (id: InterfaceId): string => INTERFACE_WORDS[id];
