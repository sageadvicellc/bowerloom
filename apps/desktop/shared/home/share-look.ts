/**
 * "Look inside" in the Share sheet: every skill, agent, tool and set of notes that goes into a share file, by name, with the text that travels with it, and a plain
 * check of that text for anything shaped like a key or a password. A key a person pasted into a skill would travel in the file, so an item whose text looks like it
 * holds one is marked, and starts unticked (left out) until the person looks and ticks it on purpose. The check looks at shapes only (a prefix such as "sk-" or
 * "ghp_", an Amazon key id, a long run of mixed letters and digits, a "password=" line, a private key block); it can miss a key and can flag a harmless string,
 * and the sheet says what it found, not that the file is safe. Pure: no React, no DOM, no clock.
 */
import type { Bundle, WikiPage } from '../world/types.js';
import { buildTopics } from './notes-topics.js';
import { joinWords } from '../world/words.js';

export type LookKind = 'skill' | 'agent' | 'tool' | 'note';

/** One thing that goes in. `text` is what travels with it (its full text; for a tool, its name and the name of its key; for notes, the rule). */
export interface LookItem { readonly id: string; readonly kind: LookKind; readonly name: string; readonly text: string; readonly flagged: boolean }

/** The shapes the check looks for. Each is tried on the whole text. */
const SHAPES: readonly RegExp[] = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|pwd|api[_-]?key|secret)\s*[=:]\s*['"]?[^\s'"]{4,}/i,
]);

/** A run of 32 or more letters, digits, plus, dash or underscore that holds a lower case letter, an upper case letter and a digit: it reads like a random token, not like a word. */
const LONG_RUN = /[A-Za-z0-9+_-]{32,}={0,2}/g;
const looksRandom = (run: string): boolean => /[a-z]/.test(run) && /[A-Z]/.test(run) && /[0-9]/.test(run);

/** True when the text holds something shaped like a key or a password. */
export function looksLikeKey(text: string): boolean {
  if (SHAPES.some(shape => shape.test(text))) return true;
  for (const run of text.matchAll(LONG_RUN)) if (looksRandom(run[0])) return true;
  return false;
}

const unique = (texts: readonly string[]): string[] => [...new Set(texts.map(t => t.trim()).filter(t => t !== ''))];

/** The topic a folder of a set of notes stands for, in words ("Clients", "Company, Furrow"): a person is never shown a folder path. A folder no topic knows is shown by its last word. */
function topicWords(pages: readonly WikiPage[]): (folder: string) => string {
  const topics = buildTopics(pages);
  return folder => {
    const clean = folder.replace(/\/+$/, '');
    const topic = topics.find(t => clean === t.id || clean.startsWith(`${t.id}/`));
    if (topic === undefined) return clean.split('/').pop() ?? clean;
    const part = topic.parts.find(p => p.folder === clean);
    return part === undefined || part.name === topic.name ? topic.name : `${topic.name}, ${part.name}`;
  };
}

/**
 * The things a share file holds, in the order a person reads them: agents, skills, tools, notes. `nameOf` turns a stored name into the words a card shows, and `pages`
 * (the pages of the world) let a set of notes name its topics in words.
 */
export function lookItems(bundle: Bundle, nameOf: (name: string) => string, pages: readonly WikiPage[] = []): LookItem[] {
  const topic = topicWords(pages);
  const out: LookItem[] = [];
  const make = (id: string, kind: LookKind, name: string, texts: readonly string[]): void => {
    const text = unique(texts).join('\n\n');
    out.push({ id, kind, name, text, flagged: looksLikeKey(text) });
  };
  for (const i of bundle.items) if (i.kind === 'agent') make(i.id, 'agent', nameOf(i.name), [i.definition.instructions, ...i.foundAt.map(f => f.text)]);
  for (const i of bundle.items) if (i.kind === 'skill') make(i.id, 'skill', nameOf(i.name), [i.description, ...i.foundAt.map(f => f.text)]);
  // A tool's text is its plain name and the name of its key (never a value): the stored name of a sample tool is a made-up word pair that reads like a password.
  for (const t of bundle.toolRefs) make(t.toolId, 'tool', nameOf(t.name), [nameOf(t.name), t.secret === null ? '' : `Key name: ${t.secret.name}`]);
  for (const s of bundle.sliceRules) {
    const hops = s.rule.linksFromSeeds === null ? [] : [`Links: ${s.rule.linksFromSeeds.hops === 1 ? 'one step' : 'two steps'} from the notes picked one by one`];
    make(s.sliceId, 'note', nameOf(s.name), [[...s.rule.folders.map(f => `Topic: ${topic(f)}`), ...s.rule.pageTypesAndTags.types.map(t => `Kind: ${t}`), ...s.rule.pageTypesAndTags.tags.map(t => `Label: ${t}`), ...hops].join('\n')]);
  }
  return out;
}

/** The ids of the items that start left out: every one whose text looks like it holds a key. */
export const flaggedIds = (items: readonly LookItem[]): string[] => items.filter(i => i.flagged).map(i => i.id);

/** The words for a kind, beside a name. */
export const LOOK_KIND_WORDS: Readonly<Record<LookKind, string>> = Object.freeze({ skill: 'Skill', agent: 'Agent', tool: 'Tool', note: 'Notes' });

/** "Skill, Agent and Tool", for the test that holds the words. */
export const lookKindsLine = (): string => joinWords(Object.values(LOOK_KIND_WORDS));
