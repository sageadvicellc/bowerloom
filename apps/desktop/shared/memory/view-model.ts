/**
 * The display logic of the Memory explorer, pure: no React, no Node, no clock. The words live here, and they obey the preview's word rules (tests/harness-words.test.ts scans this folder).
 * Memory is the notes the person approved for this module. The harness context is what the Context tab of the Library shows: the agents, skills, tools and sets of notes the reader found.
 */
import type { Part } from '../harness/types.js';
import type { MemoryAnalytics } from './analytics.js';

export const MEMORY_WORDS = Object.freeze({
  title: 'Memory',
  hint: 'Your notes beside the harness context. Bowerloom only reads. Nothing leaves this computer.',
  memory: 'Your notes',
  context: 'Harness context',
  notes: 'Notes',
  links: 'Links',
  tags: 'Tags',
  missingLinks: 'Links to a missing note',
  agents: 'Agents',
  skills: 'Skills',
  tools: 'Tools',
  contextSets: 'Sets of notes',
  contextPages: 'Pages in those sets',
  totalNotes: 'Notes in all folders',
  topTags: 'Most used tags',
  missingList: 'Missing notes that links point at',
  noTags: 'No tags.',
  noMissing: 'Every link finds its note.',
  noFolders: 'No folder is approved for Memory. Approve a folder of notes to see them here.',
  noContext: 'No harness context was found.',
  approve: 'Approve a folder',
  remove: 'Remove',
  reading: 'Reading your notes.',
  noBridge: 'This window keeps no approvals, so no notes can be read.',
  sample: 'Sample launch. Approvals are kept only in the app on your own folders.',
  bridgeMissing: 'The window did not give Memory its folder calls. Folders cannot be approved or read.',
  loading: 'Reading the approved folders.',
  linkedNote: 'A notes folder linked on the Context tab shows in the harness context. Approve the same folder here to read its links and tags.',
});

export interface MemoryRow { readonly key: 'notes' | 'links' | 'tags' | 'missing-links'; readonly label: string; readonly value: number }

/** The four layers, in the order a person reads them. */
export function memoryRows(a: MemoryAnalytics): readonly MemoryRow[] {
  return [
    { key: 'notes', label: MEMORY_WORDS.notes, value: a.notes },
    { key: 'links', label: MEMORY_WORDS.links, value: a.links },
    { key: 'tags', label: MEMORY_WORDS.tags, value: a.tags },
    { key: 'missing-links', label: MEMORY_WORDS.missingLinks, value: a.missingLinks },
  ];
}

export interface ContextSet { readonly id: string; readonly name: string; /** The pages of the set, or null when its summary does not say. */ readonly pages: number | null }
export interface ContextSummary { readonly agents: number; readonly skills: number; readonly tools: number; readonly sets: readonly ContextSet[] }

/** What the Context tab holds, counted from the parts of the world. A set's page count is read from its summary ("12 pages."), which the reader wrote from the pages it found. */
export function contextSummary(parts: readonly Part[]): ContextSummary {
  let agents = 0, skills = 0, tools = 0;
  const sets: ContextSet[] = [];
  for (const part of parts) {
    if (part.kind === 'agent') agents += 1;
    else if (part.kind === 'skill') skills += 1;
    else if (part.kind === 'tool') tools += 1;
    else if (part.kind === 'context') {
      const pages = /^(\d+) pages?\.?$/.exec(part.summary.trim());
      sets.push({ id: part.id, name: part.name, pages: pages === null ? null : Number(pages[1]) });
    }
  }
  return { agents, skills, tools, sets };
}

/** The pages of all sets, counting only the sets that say how many. */
export const contextPages = (summary: ContextSummary): number => summary.sets.reduce((sum, s) => sum + (s.pages ?? 0), 0);

/** The words for a note count that could not be read: "3 notes could not be read (TOO_LARGE)." */
export const unreadableWords = (count: number, code: string): string => `${count} ${count === 1 ? 'note' : 'notes'} could not be read (${code}).`;
export const notShownWords = (count: number): string => `${count} more ${count === 1 ? 'note is' : 'notes are'} not shown.`;
export const truncatedWords = 'The folder holds more notes than were listed.';
export const failedWords = (code: string): string => `This folder could not be read. Code: ${code}.`;
