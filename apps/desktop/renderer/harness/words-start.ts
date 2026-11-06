/**
 * The fixed words of the real Start sheet (beta.2): on the person's own folders, Start shows a command and runs nothing. The same shape and limits as WORDS (words.ts): a label at most
 * 5 words, a hint at most 12, a paragraph at most 25, and none of the banned words. The words that come from main (a refusal) are shown as main wrote them
 * (START_MAIN_WORDS in shared/engine/start-command.ts). tests/start-words.test.ts holds the table and the builders to the rules.
 */
import type { EngineId } from '../../shared/engine/types.js';
import { ENGINE_NAMES } from '../../shared/engine/types.js';
import type { StartStatus } from '../../shared/harness/start-real.js';
import { START_INSTRUCTION_LIMIT, subcommandWords } from '../../shared/engine/start-command.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const START = deepFreeze({
  label: {
    title: 'Start in a project', project: 'Project', engines: 'Engines', instruction: 'Instruction', show: 'Show the command', copy: 'Copy', copied: 'Copied',
    working: 'Building the command', copying: 'Copying', commands: 'Commands to paste', close: 'Close',
  },
  hint: {
    needFolder: 'Choose a project that has a harness.', needEngine: 'Tick at least one engine.', needInstruction: 'Write an instruction.',
    tooLong: 'The instruction is over 4,000 characters.', dash: 'The instruction cannot start with a dash.', chars: 'Remove the control characters from the instruction.',
    limit: 'Up to 4,000 characters.', placeholder: 'What should the engine do?',
    ready: 'Install recorded', notInstalled: 'Not installed here', stopped: 'Install stopped part way',
    noFolders: 'No folder has a harness yet. Make one first.', loading: 'Looking at your folders.',
    copiedLine: 'Copied. Paste it into your Terminal.', noBridge: 'This window cannot reach Bowerloom. Close it and open the app again.',
    hidden: 'The instruction has hidden characters. Remove them and try again.', notChecked: 'Not checked for changes since the install.',
    chooseProject: 'Choose a project', noneCanStart: 'No folder can start yet. Each reason is below.',
  },
  paragraph: {
    note: 'Bowerloom does not run an engine. It shows the command, and you paste it into your own Terminal.',
    noRun: 'Bowerloom does not run this. Paste it into your own Terminal.',
    noFolderForHarness: 'This harness is not in a project folder. Choose the project to start in.',
    differs: 'The copy has the full folder path where this shows ~.',
  },
} as const);

const names = (engines: readonly EngineId[]): string => engines.map(e => ENGINE_NAMES[e]).join(' and ');

/** "Codex is not installed here. The install review opens first." The line beside the button when an engine must be installed first. */
export const installFirstWords = (engines: readonly EngineId[]): string => `${names(engines)} ${engines.length === 1 ? 'is' : 'are'} not ready here. The install review opens first.`;

/** The line beside the button while it cannot show a command, or null. The install line is not a block: the button still works and opens the review. */
export function whyWords(status: StartStatus): string | null {
  switch (status.kind) {
    case 'no-project': case 'no-harness': return START.hint.needFolder;
    case 'no-engine': return START.hint.needEngine;
    case 'no-instruction': return START.hint.needInstruction;
    case 'too-long': return START.hint.tooLong;
    case 'bad-text': return status.code === 'START_INSTRUCTION_DASH' ? START.hint.dash : status.code === 'START_INSTRUCTION_HIDDEN' ? START.hint.hidden : START.hint.chars;
    case 'subcommand': return subcommandWords(status.word, status.engine);
    case 'needs-install': return installFirstWords(status.engines);
    case 'ready': return null;
  }
}

/** "Command for Claude Code": the name of one command block. */
export const commandFor = (engine: EngineId): string => `Command for ${ENGINE_NAMES[engine]}`;
/** "Copy the Codex command": the name of one Copy button. */
export const copyName = (engine: EngineId): string => `Copy the ${ENGINE_NAMES[engine]} command`;
/** "4,000": the limit as the words write it. */
export const limitWords = (): string => START_INSTRUCTION_LIMIT.toLocaleString('en-US');
