/**
 * Every word a person reads on the Library page and in its sheet and dialogs, in one frozen table of the same shape as `WORDS` (renderer/home/words.ts): a label
 * has at most 5 words, a hint at most 12, a popover at most 25, and no banned word appears. `tests/home-library-words.test.ts` holds this table, the builders at
 * the bottom and the markup of every part to those rules. A screen takes its words from here and nowhere else. Words the shell already has (Skills, Tools, Close,
 * Show the full text) come from `WORDS`, so each stays one word in one place. Release tags such as "v2.1" and author names are the item's own data, not our words:
 * the screens mark them `data-budget="content"`. The word "update" is used for a newer release of an item.
 */
import { LIBRARY_MODEL_WORDS } from '../../../shared/home/library-model.js';
import type { LibraryKind } from '../../../shared/home/library-model.js';
import { WORDS } from '../words.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const LIBRARY_WORDS = deepFreeze({
  /** Names of things and buttons: at most 5 words each. */
  label: {
    title: 'Library',
    tabs: 'What to show',
    skills: WORDS.label.skills,
    agents: 'Agents',
    tools: WORDS.label.tools,
    notes: WORDS.label.notes,
    search: 'Search the library',
    searchPlaceholder: 'Search by name or hint',
    sortGroup: 'Order of the list',
    sortBy: WORDS.label.sortBy,
    byName: WORDS.label.byName,
    byAdded: 'Recently added',
    byUsed: 'Most used',
    filterGroup: 'Filter the list',
    addFromWeb: 'Add from the web',
    listName: 'Everything you own',
    pickSomething: 'Pick something',
    kindSkill: WORDS.label.kindSkill,
    kindAgent: 'Agent',
    kindTool: WORDS.label.kindTool,
    kindNotes: WORDS.label.kindNotes,
    whatItDoes: WORDS.label.whatItDoes,
    whatItCovers: WORDS.label.whatItCovers,
    someNotes: WORDS.label.someNotes,
    usedBy: WORDS.label.usedBy,
    whereItWorks: WORDS.label.whereItWorks,
    whereItCameFrom: WORDS.label.whereItCameFrom,
    whatItReaches: WORDS.label.whatItReaches,
    whatItCanDo: 'What it can do',
    whatItHas: 'What it has',
    source: 'Source',
    madeBy: 'Made by',
    release: 'Release',
    added: 'Added',
    changed: 'Last changed',
    showFullText: WORDS.label.showFullText,
    hideFullText: WORDS.label.hideFullText,
    fullText: WORDS.label.fullText,
    skillsHeld: WORDS.label.skills,
    toolsHeld: WORDS.label.tools,
    notesHeld: WORDS.label.notes,
    addToAgent: 'Add to an agent',
    pickAgent: 'Add to which agent?',
    hasIt: 'Has it',
    selected: 'Selected',
    removeFromLibrary: 'Remove from library',
    makeCopy: 'Make my own copy',
    update: 'Update',
    useUpdate: 'Use the update',
    cancel: 'Cancel',
    close: WORDS.label.close,
    removeTitle: 'Remove from the library?',
    updateTitle: 'What the update changes',
    now: 'Now',
    afterUpdate: 'After the update',
    runsCode: WORDS.label.runsCode,
    needsKey: 'Needs a key',
    canChange: 'Can change things',
    updateAvailable: LIBRARY_MODEL_WORDS.updateAvailable,
    // The web sheet.
    webTitle: 'Add from the web',
    pasteLink: 'Paste a link',
    openLink: 'Open link',
    starterSources: 'Starter sources',
    open: 'Open',
    backToSources: 'Back to sources',
    aboutSample: 'About sample sources',
    changedMark: 'Changed',
    // The test page.
    brand: WORDS.label.appName,
    preview: WORDS.label.preview,
    aboutPreview: WORDS.label.aboutPreview,
    saveBar: WORDS.label.saveBar,
  },
  /** One line under a label: at most 12 words. */
  hint: {
    pageTip: 'Everything you own is here, even what no agent uses.',
    agentsNote: LIBRARY_MODEL_WORDS.readyMadeNote,
    pickTip: 'Pick something to see its details.',
    noMatch: 'Nothing matches your search.',
    emptyKind: 'Nothing here yet.',
    honest: 'This preview opens sample sources only. Nothing is downloaded.',
    fromWeb: 'From the web. Read it before you add it.',
    badLink: 'That does not look like a link to a collection.',
    unknownLink: 'This preview cannot open that link. Try a sample source.',
    emptyLink: 'Paste a link first.',
    linkExample: 'It starts with https://github.com/ and has two names.',
    tickTip: 'Items that run code start unticked. Others start ticked.',
    saysRunsCode: 'it can run steps on its own.',
    saysChanges: 'it can edit, not just read.',
    saysNeedsKey: 'you add a key when asked.',
    nothingToAdd: 'Everything you ticked is already here.',
    pickOne: 'Tick at least one item first.',
    removeTip: 'Nothing changes until you press Save.',
    updateTip: 'Lines that change are marked.',
    hookNoAdd: 'It runs on its own, so it joins no agent.',
    needsKeyLine: WORDS.hint.needsKeyLine,
    keyReady: WORDS.hint.keyReady,
    noUsers: WORDS.hint.noUsers,
    noPrograms: WORDS.hint.noPrograms,
    noText: LIBRARY_MODEL_WORDS.noText,
    noAgentsToPick: 'You have no agents yet.',
    agentHasNothing: 'Nothing added yet.',
    copyTip: 'It was made by someone else. Make a copy to keep it.',
    ownCopyMade: 'Made your own copy.',
    updated: 'Updated.',
  },
  /** The text behind a "?" button: at most 25 words. */
  popover: {
    sample: 'Sample sources show how adding from the web will look. Nothing leaves this computer in the preview.',
  },
});

const KIND_NOUN: Readonly<Record<LibraryKind, readonly [one: string, many: string]>> = Object.freeze({
  skill: ['skill', 'skills'], agent: ['agent', 'agents'], tool: ['tool', 'tools'], note: ['note set', 'note sets'],
});

/** "53 skills", "1 note set", or, while a search is typed or the list is filtered, "5 of 53 skills". */
export function countLine(shown: number, total: number, kind: LibraryKind, searching: boolean): string {
  const noun = KIND_NOUN[kind][total === 1 ? 0 : 1];
  return searching ? `${shown} of ${total} ${noun}` : `${total} ${noun}`;
}

/** The name of the switch that keeps only what no agent uses: "Not used yet 22". */
export const notUsedLabel = (n: number): string => `${LIBRARY_MODEL_WORDS.notUsed} ${n}`;

/** "Add 7 items" or "Add 1 item". */
export const addItems = (n: number): string => `Add ${n} ${n === 1 ? 'item' : 'items'}`;

/** What a source holds, as counts: "3 skills, 1 agent, 4 tools". A kind with none is left out. */
export function sourceCounts(counts: Readonly<Record<'skill' | 'agent' | 'tool', number>>): string {
  return (['skill', 'agent', 'tool'] as const).filter(k => counts[k] > 0).map(k => `${counts[k]} ${KIND_NOUN[k][counts[k] === 1 ? 0 : 1]}`).join(', ');
}

/** "Made by Dana Whitfield" (the name is the item's own data). */
export const madeByLine = (author: string): string => `Made by ${author}`;

/** "3 skills" for the heading of a group in a source. */
export const groupHeading = (kind: 'skill' | 'agent' | 'tool'): string => KIND_NOUN[kind][1].charAt(0).toUpperCase() + KIND_NOUN[kind][1].slice(1);

/** "2 are already here." or "1 is already here." */
export const alreadyHere = (n: number): string => `${n} ${n === 1 ? 'is' : 'are'} already here.`;
/** "1 will show as two different copies." or "2 will show as different copies." */
export const willBeCopies = (n: number): string => (n === 1 ? '1 will show as two different copies.' : `${n} will show as two different copies.`);

/** What is said after adding to an agent: "Added to Meeting assistant." (at most 12 words for any name of five words). */
export const addedTo = (agent: string): string => `Added to ${agent}.`;
/** What is said after a removal: "Removed Compare two options." */
export const removedLine = (name: string): string => `Removed ${name}.`;
/** What is said after adding from the web: "Added 7 items to your library." */
export const addedItems = (n: number): string => `Added ${n} ${n === 1 ? 'item' : 'items'} to your library.`;
/** The name of the button that opens a source: "Open Everyday office kit". */
export const openSource = (name: string): string => `Open ${name}`;
/** "Lines that changed: 2" for a screen reader, beside a copy. */
export const changedLines = (n: number): string => `${n} ${n === 1 ? 'line' : 'lines'} changed`;
/** "Tick Triage my inbox" is the name of one tick box: the item's name. */
export const tickName = (name: string): string => name;
/** The name of a tab: "Skills 53". */
export const tabName = (label: string, n: number): string => `${label} ${n}`;
