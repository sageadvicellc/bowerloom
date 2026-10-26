/**
 * The sample world of the home view. Seed 1 of the sample (shared/proto/sample.ts, which this file does not touch) has exactly one skill found with
 * different texts, and no agent holds it, so no shelf would ever show the "2 different copies" badge. This gives one skill that an agent does hold a
 * second copy, in plain lines, so the badge shows on a shelf and the copies dialog has something real to open. It is deterministic: no clock, no random
 * number. A world that already has such a skill, or that lacks the skill, comes back as it is.
 */
import type { HarnessItem, SkillItem, World } from '../proto/types.js';
import { distinctTexts } from '../proto/conflicts.js';
import { hashText } from '../proto/sample.js';
import { ownedAgents } from './cards.js';

/** The sample skill that gets the second copy: "Sort mail by topic", held by the Inbox sorter. */
export const SAMPLE_COPY_SKILL = 'skill-014';

const COPY_A = ['Read the new mail.', 'Group it by topic.', 'Put the newest group first.'].join('\n');
const COPY_B = ['Read the new mail.', 'Group it by topic and by sender.', 'Put the newest group first.', 'Keep it to ten groups at most.'].join('\n');

/** How many days ago each place of an item with copies was changed, by the order the places were found: the first is the newest. Sample dates, so the dialog can say which copy is newer. */
export const SAMPLE_COPY_DAYS: readonly number[] = Object.freeze([3, 9, 17, 30]);

/** An id that was made in this preview (added from the web, copied, a saved choice of pages): it has no sample date, because it has no history yet. */
const MADE_HERE = /^web-|-mine(?:-\d+)?$|-copy(?:-\d+)?$|^slice-\d+$/;

/**
 * How many days ago each place of an item was changed, in the order of its `foundAt`, or null for an item made in this preview. The dates are invented for the sample
 * (the real app would read them from the files), and they live here, beside the sample copies, not in the data of the world.
 */
export function sampleCopyDays(item: Pick<HarnessItem, 'id' | 'foundAt'>): readonly number[] | null {
  return MADE_HERE.test(item.id) ? null : item.foundAt.map((_, at) => SAMPLE_COPY_DAYS[at % SAMPLE_COPY_DAYS.length]!);
}

const heldByAnAgent = (world: World, id: string): boolean => ownedAgents(world).some(a => a.definition.skillIds.includes(id));

/** The world with one skill that an agent holds found in two different texts. */
export function withSampleCopies(world: World): World {
  if (world.items.some(i => i.kind === 'skill' && heldByAnAgent(world, i.id) && distinctTexts(i) >= 2)) return world;
  const skill = world.items.find((i): i is SkillItem => i.id === SAMPLE_COPY_SKILL && i.kind === 'skill');
  const first = skill?.foundAt[0];
  if (skill === undefined || first === undefined) return world;
  const place = (face: 'claude-code' | 'codex' | 'opencode', text: string) => ({ interface: face, path: first.path.replace(/\.claude|\.codex|\.opencode/, `.${face}`), contentHash: hashText(text), text });
  const next: SkillItem = { ...skill, foundAt: [place('claude-code', COPY_A), place('codex', COPY_B), place('opencode', COPY_A)] };
  return { ...world, items: world.items.map(i => (i.id === skill.id ? next : i)) };
}
