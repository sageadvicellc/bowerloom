/**
 * Every word a person reads in the Bowerloom 0.8 home app and its card kit, in one frozen table. A screen takes its words from here and nowhere else,
 * so one test can hold them all to the rules: a label has at most 5 words, a hint at most 12, a popover at most 25, and the banned words never appear.
 * The storyboard (knowledge-base/specs/2026-10-24-bowerloom-0-8-first-five-minutes.md, section 8) sets the vocabulary.
 * Words that a helper builds from a number ("10 agents", "2 of 6") are built by the functions at the bottom, which the same test runs.
 */
import { BANNED } from '../../shared/home/textbudget.js';
import { CARD_WORDS } from '../../shared/home/cards.js';
import { BAR_WORDS } from '../../shared/home/savebar.js';

/** The words and phrases that must not reach a screen (case-insensitive, whole words). The check itself is `assertTextBudget`. */
export { BANNED };

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const WORDS = deepFreeze({
  /** Names of things and buttons: at most 5 words each. */
  label: {
    appName: 'Bowerloom',
    savePoints: 'Save points',
    add: 'Add',
    help: 'Help',
    showTour: 'Show me around',
    preview: 'Preview',
    aboutPreview: 'About this preview',
    yourAgents: 'Your agents',
    pickAnAgent: 'Pick an agent',
    skills: 'Skills',
    tools: 'Tools',
    aboutTools: 'About tools',
    notes: 'Notes',
    showMore: 'Show more',
    showLess: 'Show less',
    save: 'Save',
    saveBar: 'Save bar',
    close: 'Close',
    selected: 'Selected',
    shelves: 'Shelves',
    tour: 'Tour',
    tourBack: 'Back',
    tourNext: 'Next',
    tourDone: 'Done',
    tourSkip: 'Skip tour',
    stepWord: 'Step',
    addDrawer: 'Add',
    needsKeyBadge: CARD_WORDS.needsKey,
    newBadge: CARD_WORDS.isNew,
    gallery: 'Card kit',
    galleryLight: 'Light',
    galleryDark: 'Dark',
    galleryCards: 'Cards',
    galleryBadges: 'Badges',
    galleryButtons: 'Buttons',
    galleryShelf: 'A shelf',
    galleryEmptyShelf: 'An empty shelf',
    galleryLongShelf: 'A long shelf',
    galleryAvatars: 'Avatars',
    galleryHelp: 'A help popover',
    galleryDrawer: 'A drawer',
    galleryNormal: 'Normal',
    galleryHover: 'Hovered',
    gallerySelected: 'Selected',
    galleryFocus: 'Focused',
    galleryBadge: 'With a badge',
    galleryPrimary: 'Primary',
    galleryQuiet: 'Quiet',
    galleryDisabled: 'Cannot press',
    galleryAgent: 'Agent card',
    gallerySkill: 'Skill card',
    galleryTool: 'Tool card',
    galleryNote: 'Note card',
    sampleAgent: 'Meeting assistant',
    sampleSkill: 'Summarize a meeting',
    sampleTool: 'Search the web',
    sampleNote: 'Client list',
    sampleLongName: 'The Quarterly Review Of Everything',
    remove: 'Remove',
    sortBy: 'Sort by',
    sortGroup: 'Order of the agents',
    byName: 'Name',
    byRecent: 'Recently changed',
    saved: BAR_WORDS.saved,
    wentBack: BAR_WORDS.back,
    goBack: 'Go back',
    goBackToThis: 'Go back to this',
    discard: 'Discard changes',
    savedTo: 'Saved to',
    claudeCode: 'Claude Code',
    codex: 'Codex',
    openCode: 'OpenCode',
    startPoint: CARD_WORDS.startPoint,
  },
  /** One line under a label: at most 12 words. */
  hint: {
    stage: 'Pick one to see what it can do.',
    panel: 'Its skills, tools, and notes show here.',
    emptyShelf: 'Nothing here yet.',
    addEmpty: 'Skills, tools, and notes will show here.',
    savePointsEmpty: 'No save points yet.',
    pointsDirty: 'Changes you have not saved will go away.',
    pointHere: 'You are here.',
    saveClean: CARD_WORDS.saveClean,
    saveDirty: CARD_WORDS.saveDirty,
    sampleAgent: 'Summarizes meetings and writes replies.',
    sampleSkill: 'Turns a long meeting into a few clear points.',
    sampleTool: 'Looks things up on the web for you.',
    sampleNote: 'Names and details of your clients.',
    agentNoSkills: CARD_WORDS.agentNoSkills,
    skillFallback: CARD_WORDS.skillFallback,
    toolFallback: CARD_WORDS.toolFallback,
    noteFallback: CARD_WORDS.noteFallback,
    galleryIntro: 'Every part of the kit, in every state, in both looks.',
    galleryDrawerBody: 'This is where a drawer shows its content.',
  },
  /** The text behind a "?" button: at most 25 words, and the only place a technical term may appear. */
  popover: {
    help: 'New here? The tour shows where everything is, and you can replay it.',
    preview: 'This is a preview. Nothing is written to your computer.',
    savePoint: 'A save point is a copy of your agents that you can go back to.',
    connection: 'A connection lets an agent use another program. Its technical name is MCP.',
  },
});

/** "10 agents" or "1 agent". */
export const agentsCount = (n: number): string => `${n} ${n === 1 ? 'agent' : 'agents'}`;
/** "1 change" or "3 changes". */
export const changesCount = (n: number): string => `${n} ${n === 1 ? 'change' : 'changes'}`;
/** "Step 2 of 6", for a screen reader. */
export const stepAnnouncement = (index: number, total: number): string => `${WORDS.label.stepWord} ${index} of ${total}`;
