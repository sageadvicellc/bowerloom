/**
 * Every word a person reads in Share (the section of the Version history drawer and the Share sheet), in one frozen table of the same shape as `WORDS`
 * (renderer/home/words.ts): a label has at most 5 words, a hint at most 12, and no banned word appears. The storyboard names the action "Share" and
 * "Open a shared file"; the words "export" and "import" never reach a screen. `tests/home-share-words.test.ts` holds this table, the builders at the
 * bottom and the markup of both parts to those rules. The counts of what goes in use the same words as the Add drawer's "From a shared file" tab
 * (`kindCount`), so a copy and its preview read alike. No file path is drawn anywhere.
 */
import type { ShareCounts } from '../../../shared/home/share-model.js';
import { kindCount } from '../add/add-words.js';
import { joinWords } from '../../../shared/proto/words.js';
import { WORDS } from '../words.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const SHARE_WORDS = deepFreeze({
  /** Names of things and buttons: at most 5 words each. */
  label: {
    share: 'Share',
    shareAgents: 'Share my agents',
    openFile: 'Open a shared file',
    sheetTitle: 'Share my agents',
    pickAgents: 'Agents to include',
    goesIn: 'What goes in',
    saveCopy: 'Save a copy',
    copyReady: 'Copy ready',
    done: 'Done',
    cancel: 'Cancel',
    close: WORDS.label.close,
  },
  /** One line under a label: at most 12 words. */
  hint: {
    shareTip: 'Send your agents to someone else.',
    openTip: 'Add agents that someone shared with you.',
    secretsOut: 'Keys that Bowerloom keeps are left out.',
    textIn: 'Your own text is included, so read it first.',
    readyMadeOut: 'Ready-made items travel as a name only.',
    keysAsk: 'Tools that need a key will ask for one.',
    pickTip: 'Untick an agent to leave it out.',
    nothingPicked: 'Tick at least one agent to share.',
    unsaved: 'Changes you have not saved are not in the copy.',
    nothingWritten: 'Nothing was written to your computer in this preview.',
    tryIt: 'To try it, press Open a shared file.',
    noAgents: 'There are no agents to share yet.',
  },
  popover: {},
});

/** "29 skills, 10 agents, 8 tools, 3 sets of notes": what a copy holds. A kind with none is left out. Empty text when nothing goes in. */
export function countsLine(counts: ShareCounts): string {
  const parts = [
    counts.skills > 0 ? kindCount('skill', counts.skills) : null,
    counts.agents > 0 ? kindCount('agent', counts.agents) : null,
    counts.tools > 0 ? kindCount('tool', counts.tools) : null,
    counts.noteSets > 0 ? kindCount('note', counts.noteSets) : null,
  ];
  return parts.filter((p): p is string => p !== null).join(', ');
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Left out: 2 keys", "Left out: 2 keys and 1 agent", "Left out: 3 agents", "Left out: 2 keys, 1 agent and 1 ready-made item" or "Left out: nothing". */
export function leftOutLine(keys: number, agents: number, readyMade = 0): string {
  const parts = [keys > 0 ? plural(keys, 'key', 'keys') : null, agents > 0 ? plural(agents, 'agent', 'agents') : null, readyMade > 0 ? plural(readyMade, 'ready-made item', 'ready-made items') : null].filter((p): p is string => p !== null);
  return `Left out: ${parts.length === 0 ? 'nothing' : joinWords(parts)}`;
}

/** "Under 1 KB", "About 33 KB" or "About 1.4 MB". */
export function sizeLine(bytes: number): string {
  if (bytes < 1024) return 'Under 1 KB';
  if (bytes < 1024 * 1024) return `About ${Math.round(bytes / 1024)} KB`;
  return `About ${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The hint under an agent in the list: what it brings along. "5 skills, 2 tools" or "Nothing added yet". */
export function bringsLine(skills: number, tools: number): string {
  const parts = [skills > 0 ? plural(skills, 'skill', 'skills') : null, tools > 0 ? plural(tools, 'tool', 'tools') : null].filter((p): p is string => p !== null);
  return parts.length === 0 ? 'Nothing added yet' : parts.join(', ');
}
