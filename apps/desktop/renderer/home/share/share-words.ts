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
import { countWords } from '../../../shared/home/textbudget.js';

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
    createFile: 'Create share file',
    fileReady: 'Share file ready',
    lookInside: 'Look inside',
    showText: 'Show text',
    hideText: 'Hide text',
    textTravels: 'Text that travels',
    done: 'Done',
    cancel: 'Cancel',
    close: WORDS.label.close,
  },
  /** One line under a label: at most 12 words. */
  hint: {
    shareTip: 'Send your agents to someone else.',
    openTip: 'Add agents that someone shared with you.',
    secretsOut: 'Passwords and keys that Bowerloom keeps are left out.',
    textIn: 'Your own text is included, so read it first.',
    readyMadeOut: 'Ready-made items travel as a name only.',
    keysAsk: 'Tools that need a key will ask for one.',
    pickTip: 'Untick an agent to leave it out.',
    nothingPicked: 'Tick at least one agent to share.',
    unsaved: 'Changes you have not saved are not in the copy.',
    nothingWritten: 'Nothing was written to your computer in this preview.',
    tryIt: 'To try it, press Open a shared file.',
    noAgents: 'There are no agents to share yet.',
    lookTip: 'See every item and the text that goes in.',
    looksLikeKey: 'This text looks like it holds a key.',
    noText: 'There is no text to show.',
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

/**
 * "Left out: 3 passwords and keys", "Left out: 1 password or key and 1 agent", "Left out: 3 agents", "Left out: 3 passwords and keys, 1 agent, 1 item and 1 ready-made item"
 * or "Left out: nothing". `items` are the skills, tools and sets of notes that were unticked under "Look inside".
 */
export function leftOutLine(keys: number, agents: number, readyMade = 0, items = 0): string {
  const secrets = keys > 0 ? `${keys} ${keys === 1 ? 'password or key' : 'passwords and keys'}` : null;
  const parts = [
    secrets,
    agents > 0 ? plural(agents, 'agent', 'agents') : null,
    items > 0 ? plural(items, 'item', 'items') : null,
    readyMade > 0 ? plural(readyMade, 'ready-made item', 'ready-made items') : null,
  ].filter((p): p is string => p !== null);
  // The line is a hint of at most 12 words: when the kinds do not all fit, the things that are not secrets are counted together.
  const others = agents + items + readyMade;
  const together = [secrets, others > 0 ? `${others} other ${others === 1 ? 'thing' : 'things'}` : null].filter((p): p is string => p !== null);
  const text = (list: readonly string[]): string => `Left out: ${list.length === 0 ? 'nothing' : joinWords(list)}`;
  return text(countWords(text(parts)) <= 12 ? parts : together);
}

/**
 * What the sheet says about the items whose text looks like it holds a key: "1 item looks like it holds a key. It is left out." while every one of them is unticked,
 * "1 item looks like it holds a key. Look inside first." once one is ticked again. `flagged` is how many there are, `stillIn` how many are ticked.
 */
export function flaggedLine(flagged: number, stillIn: number): string {
  const lead = flagged === 1 ? '1 item looks like it holds a key.' : `${flagged} items look like they hold a key.`;
  return `${lead} ${stillIn > 0 ? 'Look inside first.' : flagged === 1 ? 'It is left out.' : 'They are left out.'}`;
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
