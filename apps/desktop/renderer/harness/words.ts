/**
 * Every fixed word a person reads in the harness-first preview, in one frozen table. The words are copied from the design pictures. A screen takes its words from here, so one test
 * (tests/harness-words.test.ts) holds them all to the rules: a label at most 5 words, a hint at most 12, a paragraph or a popover at most 25, and no banned word (shared/harness/words.ts).
 * Words that are built from a number or a name ("3 agents", "Install Weekly report crew") are built by the functions at the bottom, which the same test runs.
 */
import type { PartKind } from '../../shared/harness/types.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const WORDS = deepFreeze({
  /** Names of things and buttons: at most 5 words each. */
  label: {
    appName: 'Bowerloom', newHarness: 'New harness', workspace: 'Workspace', mainMenu: 'Main menu', libraryPages: 'Library pages',
    harnesses: 'Harnesses', library: 'Library', agents: 'Agents', skills: 'Skills', tools: 'Tools', context: 'Context', projects: 'Projects', runs: 'Runs', interfaces: 'Interfaces',
    versionHistory: 'Version history', help: 'Help', preview: 'Preview', aboutPreview: 'About this preview',
    hideNav: 'Hide navigation', showNav: 'Show navigation', hideDetails: 'Hide details', showDetails: 'Show details',
    search: 'Search', close: 'Close', cancel: 'Cancel', add: 'Add', sort: 'Sort', sortGroup: 'Order of the list',
    start: 'Start', openInBuilder: 'Open in builder', assignToProject: 'Assign to project', runsIn: 'Runs in', installedIn: 'Installed in',
    addPart: 'Add part', addParts: 'Add parts', startFromScan: 'Start from a scan', graphView: 'Graph view', listView: 'List view', views: 'View',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', fitView: 'Fit to window', zoomControls: 'Zoom', smallMap: 'Small map', graph: 'Graph', legend: 'Legend',
    viewFile: 'View file', removeFromHarness: 'Remove from this harness', fix: 'Fix', linkFrom: 'Link from this agent', new: 'New',
    worksIn: 'Works in', file: 'File', uses: 'Uses', usedIn: 'Used in', usedBy: 'Used by', frontMatter: 'Front matter', rawFile: 'Raw file',
    name: 'Name', description: 'Description', model: 'Model', toolsField: 'Tools', skillsField: 'Skills',
    addToHarness: 'Add to a harness', back: 'Back', nothingSelected: 'Nothing selected', noFrontMatter: 'No front matter', search2: 'Search by name or summary',
    kindAgent: 'Agent', kindSkill: 'Skill', kindTool: 'Tool', kindContext: 'Context', detailsPanel: 'Details', mainRegion: 'Main', partsList: 'Parts',
    emptyTitle: 'This harness is empty', pickHarness: 'Pick a harness', addPartTitle: 'Add a part', previewNot: 'Not in this preview', fixSheetAdd: 'Add to harness',
    linkTo: 'Link to...', undo: 'Undo', installed: 'Installed.', toast: 'Notice', harness: 'Harness',
  },
  /** Short lines: at most 12 words each. */
  hint: {
    pickToSee: 'Pick one to see what holds.',
    removeNote: 'This does not delete the file.',
    readOnlyRelease: 'Read-only in this release',
    legendNew: 'New in this harness', legendMissing: 'Missing. Fix shows the change first.',
    missingNode: 'Missing. Needed.', newMark: 'New',
    emptyBody: 'Add agents, skills, tools and context from your Library.',
    noParts: 'Nothing here yet.', noMatch: 'Nothing matches that search.', noneUsed: 'No harness uses it yet.', noUses: 'It does not use another part yet.',
    linkPick: 'Pick a part to link.', linked: 'Linked. Press Escape to stop.', linkDone: 'The link is saved in the manifest.',
    fixSaid: 'Writer will use it.', fixManifest: 'Only the manifest changes. Your files stay as they are.',
    nothingToAdd: 'Every part of this kind is in the harness.', previewOnly: 'Not in this preview.',
    libraryAddHint: 'Pick the harness that gets this part.', helpOne: 'A harness is a saved bundle of your AI helpers.', libraryEmpty: 'Nothing in the Library matches.',
    fileHidden: 'Secrets in this file are hidden here.',
    noHarness: 'That harness is not here.', noPart: 'That part is not here.', noFile: 'That file is not in the sample.', alreadyIn: 'Already in it.', notInstalledYet: 'Not installed in a project yet.',
  },
  /** A short paragraph or a popover: at most 25 words each. */
  paragraph: {
    pickAPart: 'Pick a part to see its file, what it uses and where else it is used.',
    fileNote: 'Secrets in this file are hidden here. Bowerloom keeps what it reads on this computer.',
    previewAbout: 'This is a preview. It runs on sample data. Nothing is written to your disk.',
    previewFull: 'In the full app, Start opens the interface for you.',
    welcomeLine: 'Bowerloom only reads. Nothing changes until you press Install.',
    helpOne: 'A harness is a saved bundle of your AI helpers.', helpTwo: 'Build one from your agents and skills. Then run it in any interface you use.',
    helpThree: 'Pick a harness to see where it is installed. Open it in the builder to change what it holds.',
    helpFour: 'Bowerloom only reads until you press Install. You can undo an install in Version history.',
  },
  /** The list of the Preview mark's popover: each line at most 25 words. */
  notInPreview: ['The confirm sheet for a community skill', 'Real files', 'Real runs'],
} as const);

/** The names of the kinds, for a title and a detail line. */
export const KIND_NAME: Readonly<Record<PartKind, string>> = Object.freeze({ agent: 'Agent', skill: 'Skill', tool: 'Tool', context: 'Context' });
/** The names of the kinds in the plural, for a tab and a group heading. */
export const KIND_PLURAL: Readonly<Record<PartKind, string>> = Object.freeze({ agent: 'Agents', skill: 'Skills', tool: 'Tools', context: 'Context' });

/** "Missing skill", the line under the name of a missing part. */
export const missingKind = (kind: PartKind): string => `Missing ${kind}`;
/** "Writer names it. This harness does not hold it." */
export const namedBy = (names: readonly string[]): string => `${names.join(', ')} names it. This harness does not hold it.`;
/** "Writer will use it." */
export const willUse = (names: readonly string[]): string => `${names.join(', ')} will use it.`;
/** "Add to Weekly report crew": the name of a button in the pick sheet. */
export const addTo = (name: string): string => `${WORDS.label.add} to ${name}`;
/** "4 harnesses. Pick one to see what holds." */
export const harnessListHint = (n: number): string => `${n} ${n === 1 ? 'harness' : 'harnesses'}. ${WORDS.hint.pickToSee}`;
/** "5 projects. Each shows where a harness is installed." */
export const projectsHint = (n: number): string => `${n} ${n === 1 ? 'project' : 'projects'}. Each shows where a harness is installed.`;
/** "Start Weekly report crew", the name of a play button. */
export const startName = (name: string): string => `Start ${name}`;
/** "Fix Translate". */
export const fixName = (name: string): string => `Fix ${name}`;
/** "Add Translate". */
export const addName = (name: string): string => `Add ${name}`;
/** "Install Weekly report crew". */
export const installTitle = (name: string): string => `Install ${name}`;
/** "Skill from Caveman plug-in, version 1.2". */
export const fromWords = (kind: PartKind, source: string, version: string | undefined): string => `${KIND_NAME[kind]} from ${source}${version === undefined ? '' : `, version ${version}`}`;
/** "Pick a part to link from Researcher." */
export const linkFromWords = (name: string): string => `Pick a part to link from ${name}.`;
/** "Add Spreadsheet to Weekly report crew": the name of a button in the drawer. */
export const addToWords = (part: string, harness: string): string => `Add ${part} to ${harness}`;
/** "Used in 1 other harness" lives in shared/harness/status.ts. The words of a count of parts: "11 parts". */
export const partsCount = (n: number): string => `${n} ${n === 1 ? 'part' : 'parts'}`;
/** The name of a graph node for a screen reader: "Researcher, agent. Finds sources." */
export const nodeName = (name: string, kind: PartKind, summary: string): string => `${name}, ${kind}. ${summary}`;
/** The count in a tab: "Skills 49". */
export const tabWords = (kind: PartKind, n: number): string => `${KIND_PLURAL[kind]} ${n}`;
