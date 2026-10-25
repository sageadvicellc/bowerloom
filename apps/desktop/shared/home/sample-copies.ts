/**
 * The sample world of the home view. Seed 1 of the sample (shared/proto/sample.ts, which this file does not touch) has exactly one skill found with
 * different texts, and no agent holds it, so no shelf would ever show the "2 different copies" badge. This gives one skill that an agent does hold a
 * second copy, in plain lines, so the badge shows on a shelf and the copies dialog has something real to open. It is deterministic: no clock, no random
 * number. A world that already has such a skill, or that lacks the skill, comes back as it is.
 */
import type { SkillItem, World } from '../proto/types.js';
import { distinctTexts } from '../proto/conflicts.js';
import { hashText } from '../proto/sample.js';
import { ownedAgents } from './cards.js';

/** The sample skill that gets the second copy: "Sort mail by topic", held by the Inbox sorter. */
export const SAMPLE_COPY_SKILL = 'skill-014';

const COPY_A = ['Read the new mail.', 'Group it by topic.', 'Put the newest group first.'].join('\n');
const COPY_B = ['Read the new mail.', 'Group it by topic and by sender.', 'Put the newest group first.', 'Keep it to ten groups at most.'].join('\n');

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
