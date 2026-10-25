/**
 * What the Save bar says about the changes that wait. The number comes from `changeCount` (savebar.ts); this lists the same changes one by one, in plain
 * words, so a bar with one or two changes can say what they are ("Removed Write a reply", "Added Sort my inbox to Inbox sorter") and a bar with three or
 * more says "3 changes". It walks the saved world and the draft the way `changeCount` does, so the list is as long as the count. Pure: no React, no DOM.
 */
import type { AgentItem, HarnessItem, World } from '../proto/types.js';
import { distinctTexts } from '../proto/conflicts.js';
import { agentCard, itemTitle, readableName } from './cards.js';
import { absorbedSlices, isAbsorbedItem } from './notes-actions.js';
import { plainOf } from './plain.js';
import { countWords } from './textbudget.js';

/** The longest the bar's sentence may be, in words (the hint limit of the text budget). */
export const BAR_LIMIT = 12;
/** The most changes the bar names. From one more on it says "N changes". */
export const BAR_NAMES = 2;

/** One change. `to` is the agent that gained something, for "Added X to Y". */
export interface Change { readonly verb: 'removed' | 'added' | 'kept' | 'changed'; readonly what: string; readonly to?: string }

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const nameOfItem = (item: HarnessItem): string => {
  if (item.kind === 'agent') return agentCard(item).name;
  if (item.kind === 'skill' || item.kind === 'tool') return plainOf(item.kind, item.id)?.name ?? itemTitle(item.name);
  return itemTitle(item.name);
};
const noteName = (world: World, sliceId: string): string => plainOf('note', sliceId)?.name ?? readableName(world.slices.find(s => s.id === sliceId)?.name ?? '');
const skillName = (world: World, id: string): string => { const item = world.items.find(i => i.id === id); return item === undefined ? itemTitle(id) : nameOfItem(item); };

function agentChanges(committed: World, draft: World, before: AgentItem, after: AgentItem): Change[] {
  const b = before.definition, a = after.definition, to = agentCard(after).name, out: Change[] = [];
  for (const id of b.skillIds) if (!a.skillIds.includes(id)) out.push({ verb: 'removed', what: skillName(committed, id) });
  for (const id of a.skillIds) if (!b.skillIds.includes(id)) out.push({ verb: 'added', what: skillName(draft, id), to });
  const toolsBefore = b.toolAttachments.map(t => t.toolId), toolsAfter = a.toolAttachments.map(t => t.toolId);
  for (const id of toolsBefore) if (!toolsAfter.includes(id)) out.push({ verb: 'removed', what: skillName(committed, id) });
  for (const id of toolsAfter) if (!toolsBefore.includes(id)) out.push({ verb: 'added', what: skillName(draft, id), to });
  for (const t of a.toolAttachments) if (b.toolAttachments.some(o => o.toolId === t.toolId && o.access !== t.access)) out.push({ verb: 'changed', what: skillName(draft, t.toolId) });
  if (b.sliceId !== a.sliceId) out.push(a.sliceId === undefined ? { verb: 'removed', what: noteName(committed, b.sliceId ?? '') } : { verb: 'added', what: noteName(draft, a.sliceId), to });
  if (out.length > 0) return out;
  return sameJson(before, after) ? [] : [{ verb: 'changed', what: to }];
}

/** Every change between the saved world and the draft, one entry each. Its length is `changeCount` (a draft that differs always lists at least one). */
export function listChanges(committed: World, draft: World): Change[] {
  if (committed === draft) return [];
  const before = new Map(committed.items.map(i => [i.id, i])), after = new Map(draft.items.map(i => [i.id, i]));
  const absorbed = absorbedSlices(committed, draft), out: Change[] = [];
  for (const [id, item] of after) {
    const old = before.get(id);
    if (old === undefined) { if (!isAbsorbedItem(item, absorbed)) out.push({ verb: 'added', what: nameOfItem(item) }); }
    else if (item.kind === 'agent' && old.kind === 'agent') out.push(...agentChanges(committed, draft, old, item));
    else if (!sameJson(old, item)) out.push(distinctTexts(old) >= 2 && distinctTexts(item) < distinctTexts(old) ? { verb: 'kept', what: nameOfItem(item) } : { verb: 'changed', what: nameOfItem(item) });
  }
  for (const [id, item] of before) if (!after.has(id)) out.push({ verb: 'removed', what: nameOfItem(item) });
  const slices = new Map(committed.slices.map(s => [s.id, s]));
  for (const s of draft.slices) {
    const old = slices.get(s.id);
    if (old === undefined) { if (!absorbed.has(s.id)) out.push({ verb: 'added', what: noteName(draft, s.id) }); }
    else if (!sameJson(old, s)) out.push({ verb: 'changed', what: noteName(draft, s.id) });
  }
  const was = committed.overrides.map(o => JSON.stringify(o)), now = draft.overrides.map(o => JSON.stringify(o));
  for (const o of now) if (!was.includes(o)) out.push({ verb: 'changed', what: 'a choice' });
  for (const o of was) if (!now.includes(o)) out.push({ verb: 'changed', what: 'a choice' });
  return out;
}

const VERB: Readonly<Record<Change['verb'], string>> = { removed: 'Removed', added: 'Added', kept: 'Kept one copy of', changed: 'Changed' };
const lower = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
const say = (c: Change, withTarget: boolean): string => `${VERB[c.verb]} ${c.what}${withTarget && c.to !== undefined ? ` to ${c.to}` : ''}`;

/**
 * The sentence for a bar with one or two changes, or null when the bar should say "N changes": three or more changes, a list that does not match the
 * count, or a sentence that would pass 12 words. Two changes share one sentence: "Removed A and B", "Added A and B to C", or, when the verbs differ,
 * "Removed A and added B to C". A long sentence loses its "to <agent>" first; then two adds to different agents read "Added A and B".
 */
export function barSentence(changes: readonly Change[], count: number): string | null {
  if (count < 1 || count > BAR_NAMES || changes.length !== count) return null;
  const [a, b] = changes;
  for (const withTarget of [true, false]) {
    const to = (c: Change): string => (withTarget && c.to !== undefined ? ` to ${c.to}` : '');
    const text = a === undefined ? '' : b === undefined ? say(a, withTarget)
      : a.verb === b.verb && (a.to === b.to || !withTarget) ? `${VERB[a.verb]} ${a.what} and ${b.what}${to(a)}`
        : `${say(a, withTarget)} and ${lower(say(b, withTarget))}`;
    if (text !== '' && countWords(text) <= BAR_LIMIT) return text;
  }
  return null;
}
