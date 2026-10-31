/**
 * The banned-word rule of the harness-first preview. It is the rule of the home app (shared/home/textbudget.ts) with the words that the design itself is built on taken out:
 * "harness", "project", "conflict", "scan", "helper", "plan" and "version" are the vocabulary of these screens (the pictures say "Harnesses", "Projects", "Conflict in 1 project",
 * "Engines", "Start from a scan", "your AI helpers", "Plans sections." and "Skill from Caveman plug-in, version 1"). Every other banned word stays banned, and the limits stay:
 * a label at most 5 words, a hint at most 12, a paragraph or a popover at most 25.
 */
import { ALLOWED_PHRASES, BANNED, LIMITS, countWords } from '../home/textbudget.js';

/** The words of the design's own vocabulary. "interface" left it on 2026-10-31: the screens say "engine", so the old word is banned again. */
export const DESIGN_WORDS: readonly string[] = Object.freeze(['harness', 'project', 'conflict', 'scan', 'helper', 'plan', 'version']);

/** The words that must not reach a screen of the preview. */
export const HARNESS_BANNED: readonly string[] = Object.freeze(BANNED.filter(word => !DESIGN_WORDS.includes(word)));

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERN = new RegExp(`\\b(?:${HARNESS_BANNED.map(w => escape(w).replace(/ /g, '\\s+')).join('|')})(?:e?s)?\\b`, 'i');
const ALLOWED = new RegExp(ALLOWED_PHRASES.map(p => escape(p).replace(/ /g, '\\s+')).join('|'), 'gi');

/** The banned word in `text`, or null. */
export function bannedHere(text: string): string | null {
  const found = PATTERN.exec(text.replace(ALLOWED, ' '));
  return found === null ? null : found[0];
}

export { LIMITS, countWords };
