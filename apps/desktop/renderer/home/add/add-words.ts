/**
 * Every word a person reads in the Add drawer, the "two different copies" dialog and the Add test page, in one frozen table of the same shape as `WORDS`
 * (renderer/home/words.ts): a label has at most 5 words, a hint at most 12, a popover at most 25, and no banned word appears. `tests/home-add-words.test.ts`
 * holds this table, the builders at the bottom and the markup of both components to those rules. A screen takes its words from here and nowhere else.
 * Words that U1's shell already has (Add, Skills, Tools, Notes, Close, Show more) are taken from `WORDS`, so they stay one word in one place.
 */
import { ADD_MODEL_WORDS } from '../../../shared/home/add-model.js';
import type { FileThingKind } from '../../../shared/home/add-file.js';
import { WORDS } from '../words.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const ADD_WORDS = deepFreeze({
  /** Names of things and buttons: at most 5 words each. */
  label: {
    tabs: 'What to add',
    skills: WORDS.label.skills,
    tools: WORDS.label.tools,
    notes: WORDS.label.notes,
    agents: 'Agents',
    file: 'From a shared file',
    addTo: 'Add to',
    addAgent: 'Add agent',
    pickAgent: 'Add to which agent?',
    alreadyAdded: 'Already added',
    readyMade: ADD_MODEL_WORDS.readyMade,
    chooseFile: 'Choose a file',
    chooseAnother: 'Choose another file',
    tryFile: 'Try a sample file',
    openLastCopy: 'Open my last copy',
    dropArea: 'Shared file drop area',
    addThese: 'Add these',
    willAdd: 'Will be added',
    alreadyHere: 'Already here',
    differentCopies: 'Two different copies',
    keepThis: 'Keep this copy',
    changedMark: 'Changed',
    close: WORDS.label.close,
    showMore: WORDS.label.showMore,
    showLess: WORDS.label.showLess,
    // The Add test page.
    pageTitle: 'Add test page',
    yourAgents: WORDS.label.yourAgents,
    yourSkills: 'Your skills',
    add: WORDS.label.add,
    goBack: 'Go back',
    changes: 'Changes waiting',
    brand: WORDS.label.appName,
    addDrawer: WORDS.label.addDrawer,
  },
  /** One line under a label: at most 12 words. */
  hint: {
    dragTip: 'Drag a card onto an agent, or press Add to.',
    agentsTip: 'Each one becomes an agent of your own.',
    nothingHere: 'Nothing to add here yet.',
    fileTip: 'Drop a shared file here, or choose one.',
    fileOver: 'Let go to open this file.',
    fileReading: 'Reading the file.',
    fileUnreadable: 'Bowerloom cannot read this file.',
    fileTooLarge: 'This file is too large.',
    fileTooMany: 'This file has too many things to read.',
    fileTooDeep: 'This file is nested too deeply.',
    fileSameId: 'Two parts of this file share one id.',
    fileEmpty: 'There is nothing in this file.',
    firstFileOnly: 'Only the first file was read.',
    nothingAdded: 'Nothing was added.',
    didNotWork: 'That did not work.',
    fileNothing: 'Everything in this file is already here.',
    bothKept: 'Both copies are kept.',
    notAgain: 'Not added again.',
    copiesTip: 'Pick the copy to keep. The other one goes away.',
    copiesLookAlike: 'Line by line, these copies look the same.',
    dropMiss: 'Drop it on an agent card.',
    pageTip: 'Press Add, then drag a card onto an agent.',
    skillsTip: 'The badge opens the two copies.',
    noAgents: 'There is no agent to add to yet.',
    keysTip: 'Add the key in the tool when you have it.',
  },
  popover: {},
});

/** Words for a number of things, built here so the same test runs them. */
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Added to Meeting note taker." */
export const addedTo = (agent: string): string => `Added to ${agent}.`;
/** "Meeting note taker already has it." */
export const alreadyOn = (agent: string): string => `${agent} already has it.`;
/** "Added Study buddy to your agents." */
export const agentAdded = (name: string): string => `Added ${name} to your agents.`;
/** "Copy 2". */
export const copyNumber = (n: number): string => `Copy ${n}`;
/** "Found in Claude Code and Codex". */
export const foundIn = (place: string): string => `Found in ${place}`;
/** "3 lines changed", "1 line changed" or "No lines changed". */
export const linesChanged = (n: number): string => (n === 0 ? 'No lines changed' : `${plural(n, 'line', 'lines')} changed`);
/** "Kept Copy 2 of Weekly review." */
export const keptCopy = (n: number, name: string): string => `Kept ${copyNumber(n)} of ${name}.`;
/** "No changes yet", "1 change" or "3 changes". */
export const changesCount = (n: number): string => (n === 0 ? 'No changes yet' : plural(n, 'change', 'changes'));
/** "and 3 more". */
export const moreCount = (n: number): string => `and ${n} more`;
/** "Added 5 things from the file." */
export const fileAdded = (n: number): string => `Added ${plural(n, 'thing', 'things')} from the file.`;
/** "1 thing this file points to is not here." or "4 things this file points to are not here." */
export const pointsToMissing = (n: number): string => `${n} ${n === 1 ? 'thing this file points to is' : 'things this file points to are'} not here.`;
/** "1 tool needs a key." */
export const keysNeeded = (n: number): string => `${n} ${n === 1 ? 'tool needs' : 'tools need'} a key.`;
/** "3 skills", "1 agent", "2 tools", "1 set of notes". */
export function kindCount(kind: FileThingKind, n: number): string {
  switch (kind) {
    case 'skill': return plural(n, 'skill', 'skills');
    case 'agent': return plural(n, 'agent', 'agents');
    case 'tool': return plural(n, 'tool', 'tools');
    case 'note': return plural(n, 'set of notes', 'sets of notes');
  }
}
/** The word for one kind, for a screen reader beside a name. */
export const kindWord = (kind: FileThingKind): string => (kind === 'note' ? 'Notes' : kind === 'skill' ? 'Skill' : kind === 'agent' ? 'Agent' : 'Tool');
