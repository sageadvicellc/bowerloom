/**
 * The words of "How it will work", the sheet that the Preview popover links to: what the plan for the full app has decided about a person's files, and what it has not
 * decided yet. Two lists, and nothing else. A statement is here only when the specification of 0.8 says it (`section` names the part of the specification, for the
 * person who checks this file; a screen never shows it). The source of every statement on screen is "Decided in the plan". What a tester asked and the specification
 * does not settle goes in "Not decided yet", and the preview makes no promise about it. Nothing here is policy that was not decided.
 * Each paragraph has at most 25 words and uses plain words; no banned word appears ("scan" is said as "looking for your files", "export" as "sharing").
 * `tests/home-we-how.test.ts` holds this table to those rules and to the specification.
 */
import { WORDS } from '../words.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

/** One thing the plan has decided. `section` is the number of the part of the specification that says it. */
export interface Decided { readonly id: string; readonly section: string; readonly paragraphs: readonly string[] }

export const HOW_WORDS = deepFreeze({
  /** Names of things and buttons: at most 5 words each. */
  label: {
    link: 'How it will work',
    title: 'How it will work',
    decided: 'What is decided',
    notDecided: 'Not decided yet',
    source: 'Decided in the plan',
    close: WORDS.label.close,
    done: 'Done',
  },
  /** One line under a label: at most 12 words. */
  hint: {
    intro: 'This preview shows the app. These are its rules for your files.',
    notDecidedTip: 'These are open. The preview promises nothing about them.',
  },
});

/** What the specification has decided. The words are plain, and every paragraph is at most 25 words. */
export const DECIDED: readonly Decided[] = deepFreeze([
  { id: 'looking', section: '6.1', paragraphs: ['Looking for your files needs your OK, every time. It happens in two steps.', 'First it lists the places it found, with counts, and reads nothing inside them. Then it reads only the places you tick.'] },
  { id: 'originals', section: '6.2', paragraphs: ['Bowerloom copies what it finds. Your original files stay as they are until you approve a clean-up.'] },
  { id: 'writes', section: '8', paragraphs: ['It writes only inside the folders you registered, and the program folders you approved.'] },
  { id: 'preview-undo', section: '3, 6.5, 6.6', paragraphs: ['You see every change before it is written. Each change is saved in the version history, so you can undo it.'] },
  { id: 'history-place', section: '6.10', paragraphs: ['The version history is kept in the app\'s own data folder, not in the folders that hold your agents. It does not need git.'] },
  { id: 'secrets', section: '3, 6.8', paragraphs: ['Secrets are never stored. Bowerloom keeps only the name of a key, never its value, and it never reads the value.'] },
  { id: 'sharing', section: '6.7', paragraphs: ['A shared file leaves secrets out, and it leaves out the text of your notes.'] },
  { id: 'opening', section: '6.7, 8', paragraphs: ['Opening a shared file first shows every file it will write and every key you must add. Nothing in it runs.'] },
  { id: 'hooks', section: '6.13', paragraphs: ['Hooks run code on their own. Bowerloom shows each one with a Runs code mark, and never writes code of its own.'] },
  { id: 'no-cloud', section: '5, 6.7', paragraphs: ['The first release has no accounts, no cloud sharing, and no sync. Sharing is done with files.'] },
]);

/** What a tester asked about and the specification does not settle. Said as open questions, in plain words, and never as a promise. */
export const NOT_DECIDED: readonly { readonly id: string; readonly text: string }[] = deepFreeze([
  { id: 'network', text: 'Which network connections the app may make, and a list of them that you can read.' },
  { id: 'history-who', text: 'Who made each entry in the version history, and on which device.' },
  { id: 'signed', text: 'Whether skills and agents from outside must be signed, and whether you can limit sources to a list you trust.' },
  { id: 'secret-check', text: 'Whether the app looks for secrets inside the text of your files, beyond checking the names of keys.' },
]);
