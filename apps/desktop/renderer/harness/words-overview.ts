/**
 * The fixed words of the Overview (Task 2): the read-only graph of every place the first read found. The same shape and limits as WORDS in words.ts: a label at most
 * 5 words, a hint at most 12, a paragraph at most 25, no banned word. Words that WORDS already holds are not repeated here: "Overview" (`WORDS.label.overview`),
 * "Open in builder", "Graph view", "List view", "Zoom in", "Zoom out", "Fit to window", "Small map", and the kind names. The keys and the text are final; lane H builds the
 * screen from them. tests/overview-words.test.ts holds the table and the builders to the rules.
 */
import type { PartKind } from '../../shared/harness/types.js';
import type { OverviewCounts, OverviewToolKind } from '../../shared/harness/overview.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const OVERVIEW = deepFreeze({
  /** Names of things and buttons: at most 5 words each. */
  label: {
    graphList: 'Graph or list', expandAll: 'Expand all', collapseAll: 'Collapse all', expand: 'Expand', collapse: 'Collapse', chooseThisFolder: 'Choose this folder',
    inBowerloom: 'In Bowerloom', notInBowerloom: 'Not in Bowerloom yet', shared: 'Shared', runsCode: 'Runs code', home: 'Home', place: 'Place', places: 'Places',
    liveRegion: 'Selection', placeGroup: 'Place', nodeList: 'Parts in this place', details: 'Details', selectedPart: 'Selected part', alsoFoundIn: 'Also found in',
    uses: 'Uses', usedBy: 'Used by', kindMcp: 'Connection', kindPrompt: 'Saved prompt', kindHook: 'Hook',
  },
  /** Short lines: at most 12 words each. */
  hint: {
    empty: 'Nothing was found yet. Press Find my files.',
    emptyPlace: 'Nothing was found in this place.',
    readOnly: 'Read-only. Open a place in the builder to change it.',
    wrongFolder: 'That is not the folder shown.',
    tooManyToExpand: 'Too many parts to open every place at once.',
    zoomedOut: 'Zoom in to see the parts.',
    moreParts: 'More parts are out of view. Pan or zoom.',
    keys: 'Arrow keys move. Enter selects. Escape clears.',
    noRules: 'Rules are not shown yet.',
  },
  /** A short paragraph: at most 25 words each. */
  paragraph: {
    intro: 'Every place Bowerloom found, in one graph. A place marked In Bowerloom already has a harness you can open in the builder.',
  },
});

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const KIND_NAME: Readonly<Record<PartKind, readonly [string, string]>> = { agent: ['agent', 'agents'], skill: ['skill', 'skills'], tool: ['tool', 'tools'], context: ['set of notes', 'sets of notes'] };

/** "3 agents, 5 skills, 2 tools, 1 set of notes": the kinds with a count above zero, in that order. "Nothing found" when all are zero. */
export function countsWords(c: OverviewCounts): string {
  const parts = (['agent', 'skill', 'tool', 'context'] as const).filter(k => c[k] > 0).map(k => plural(c[k], KIND_NAME[k][0], KIND_NAME[k][1]));
  return parts.length === 0 ? 'Nothing found' : parts.join(', ');
}
/** "Also in 1 place", "Also in 3 places". */
export const alsoInWords = (n: number): string => `Also in ${plural(n, 'place', 'places')}`;
/** "Uses 3 skills". */
export const usesWords = (n: number, kind: PartKind): string => `Uses ${plural(n, KIND_NAME[kind][0], KIND_NAME[kind][1])}`;
/** The accessible name of a node: its name, its kind, its place, then what is true of it. "Check facts, skill, Your Claude Code folder, uses 2 tools, shared with 1 place". */
export function nodeName(input: { name: string; kind: PartKind; toolKind?: OverviewToolKind; group: string; uses: number; usesKind?: PartKind; runsCode?: boolean; sharedWith: number }): string {
  const kind = input.kind === 'tool' && input.toolKind !== undefined ? { mcp: 'connection', prompt: 'saved prompt', hook: 'hook' }[input.toolKind] : KIND_NAME[input.kind][0];
  const tail = [
    input.uses > 0 ? usesWords(input.uses, input.usesKind ?? 'skill').toLowerCase() : null,
    input.runsCode === true ? 'runs code' : null,
    input.sharedWith > 0 ? `shared with ${plural(input.sharedWith, 'place', 'places')}` : null,
  ].filter((x): x is string => x !== null);
  return [input.name, kind, input.group, ...tail].join(', ');
}
/** The line the polite live region says when a node is selected, or when nothing is. */
export const selectedWords = (name: string | null): string => (name === null ? 'Nothing selected' : `Selected ${name}`);
/** "and 12 more", for a list cut short. */
export const moreWords = (n: number): string => `and ${n} more`;
