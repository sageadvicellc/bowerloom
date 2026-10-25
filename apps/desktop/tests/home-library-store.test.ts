// The Library's store actions: each is one draft change and one step to undo, removal takes the item off every agent, adding dedupes and flags a second copy,
// an own copy is marked as the person's, and an update pins the newer release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore, reduceStore } from '../shared/proto/store.js';
import type { StoreAction, StoreState } from '../shared/proto/store.js';
import type { AgentItem, HarnessItem, World } from '../shared/proto/types.js';
import { distinctTexts } from '../shared/proto/conflicts.js';
import { hashText } from '../shared/proto/sample.js';
import { UPDATE_ITEM_ID } from '../shared/home/library-sample.js';
import { textOfItem, infoOf, SAMPLE_SOURCES, newItemOf } from '../shared/home/library-sources.js';
import { DESKTOP } from './support.js';
import { libraryWorld } from './home-library-world.js';

const start = (): StoreState => { const w = libraryWorld(); return { committed: w, draft: w, undoStack: [], redoStack: [], headVersionId: null }; };
const run = (state: StoreState, ...actions: StoreAction[]): StoreState => actions.reduce(reduceStore, state);
const item = (w: World, id: string): HarnessItem | undefined => w.items.find(i => i.id === id);
const owned = (w: World): AgentItem[] => w.items.filter((i): i is AgentItem => i.kind === 'agent' && i.library === null);
const office = SAMPLE_SOURCES[0]!;

test('removing a skill takes it out of the world and off every agent that holds it, in one step', () => {
  const s = start();
  const holders = owned(s.draft).filter(a => a.definition.skillIds.includes('skill-010'));
  assert.equal(holders.length, 3, 'the sample gives Compare two options three holders');
  const next = reduceStore(s, { type: 'removeFromLibrary', itemId: 'skill-010' });
  assert.equal(item(next.draft, 'skill-010'), undefined);
  for (const a of next.draft.items) if (a.kind === 'agent') assert.equal(a.definition.skillIds.includes('skill-010'), false, a.id);
  assert.equal(next.undoStack.length, 1, 'one step to undo');
  assert.equal(reduceStore(next, { type: 'undo' }).draft, s.draft, 'undo brings back the very same draft');
  assert.notEqual(next.draft, s.draft);
  assert.equal(next.committed, s.committed, 'nothing is saved yet');
});

test('removing a tool takes away its attachments and the overrides that point at it', () => {
  let s = start();
  s = run(s, { type: 'setOverride', scopeId: 'scope-reedmarsh', itemId: 'tool-mcp-01', mode: 'hide' });
  assert.equal(s.draft.overrides.length >= 1, true);
  const next = reduceStore(s, { type: 'removeFromLibrary', itemId: 'tool-mcp-01' });
  assert.equal(item(next.draft, 'tool-mcp-01'), undefined);
  assert.equal(next.draft.overrides.some(o => o.itemId === 'tool-mcp-01'), false);
  for (const a of next.draft.items) if (a.kind === 'agent') assert.equal(a.definition.toolAttachments.some(t => t.toolId === 'tool-mcp-01'), false);
});

test('removing a set of notes by its id removes the choice, its list item, and every agent\'s reading of it', () => {
  const s = start();
  const next = reduceStore(s, { type: 'removeFromLibrary', itemId: 'slice-folders' });
  assert.equal(next.draft.slices.some(x => x.id === 'slice-folders'), false);
  assert.equal(next.draft.items.some(i => 'sliceId' in i && i.sliceId === 'slice-folders'), false);
  for (const a of owned(next.draft)) assert.equal(a.definition.sliceId === 'slice-folders', false);
  assert.equal(next.draft.slices.length, s.draft.slices.length - 1);
  assert.equal(next.undoStack.length, 1);
});

test('removing an agent removes just that agent', () => {
  const s = start();
  const next = reduceStore(s, { type: 'removeFromLibrary', itemId: 'agent-03' });
  assert.equal(item(next.draft, 'agent-03'), undefined);
  assert.equal(next.draft.items.length, s.draft.items.length - 1);
});

test('removing something that is not there changes nothing, and the same state comes back', () => {
  const s = start();
  assert.equal(reduceStore(s, { type: 'removeFromLibrary', itemId: 'nope' }), s);
});

test('adding a source puts new items in the global harness on no agent, with new ids, in one step', () => {
  const s = start();
  const picked = office.items.filter(i => i.toolKind !== 'hook').map(i => newItemOf(i));
  const next = reduceStore(s, { type: 'addToLibrary', source: infoOf(office), items: picked });
  assert.equal(next.draft.items.length, s.draft.items.length + 6 + 1, 'seven items arrive; one of them (Summarize a meeting) is a new item here because the stored name differs');
  const ids = next.draft.items.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length, 'every id is unique');
  const added = next.draft.items.filter(i => !s.draft.items.some(o => o.id === i.id));
  for (const a of added) {
    assert.equal(a.library?.library, office.id);
    assert.equal(a.scopeId, 'global');
    if (a.kind === 'agent') assert.deepEqual([a.definition.skillIds, a.definition.toolAttachments], [[], []]);
  }
  for (const a of owned(next.draft)) assert.equal(a.definition.skillIds.length, owned(s.draft).find(o => o.id === a.id)!.definition.skillIds.length, 'no agent got any of them');
  assert.equal(next.draft.libraries.filter(l => l.id === office.id).length, 1);
  assert.equal(next.undoStack.length, 1);
  assert.equal(reduceStore(next, { type: 'undo' }).draft, s.draft);
});

test('adding the same items again changes nothing: same name and same text are skipped', () => {
  const s = start();
  const action: StoreAction = { type: 'addToLibrary', source: infoOf(office), items: office.items.map(i => newItemOf(i)) };
  const once = reduceStore(s, action);
  assert.notEqual(once, s);
  assert.equal(reduceStore(once, action), once, 'the very same state comes back');
});

test('the same name with other text becomes a second copy of the item that is there, which shows as two different copies', () => {
  const s = start();
  const first = office.items.find(i => i.slug === 'triage-inbox')!;
  const once = reduceStore(s, { type: 'addToLibrary', source: infoOf(office), items: [newItemOf(first)] });
  const changed = { ...first, lines: ['Read the mail.', 'Answer the urgent ones first.'] };
  const twice = reduceStore(once, { type: 'addToLibrary', source: infoOf(office), items: [newItemOf(changed)] });
  assert.equal(twice.draft.items.length, once.draft.items.length, 'no new item');
  const it = twice.draft.items.find(i => i.name === first.name)!;
  assert.equal(distinctTexts(it), 2);
  assert.equal(new Set(it.foundAt.map(f => f.interface)).size, 2, 'the second copy sits under another program');
});

test('a match the screen found by a name a person reads makes a second copy of that item', () => {
  const s = start();
  const summarize = office.items.find(i => i.slug === 'summarize-meeting')!;
  const next = reduceStore(s, { type: 'addToLibrary', source: infoOf(office), items: [newItemOf(summarize, 'skill-042')] });
  assert.equal(next.draft.items.length, s.draft.items.length);
  assert.equal(distinctTexts(next.draft.items.find(i => i.id === 'skill-042')!), 2);
  // the skill had no second copy before
  assert.equal(distinctTexts(s.draft.items.find(i => i.id === 'skill-042')!), 1);
});

test('a hook arrives as a hook that runs code, and a tool that needs a key arrives with its key missing', () => {
  const s = start();
  const next = reduceStore(s, { type: 'addToLibrary', source: infoOf(office), items: office.items.filter(i => ['tidy-files', 'send-chat'].includes(i.slug)).map(i => newItemOf(i)) });
  const hook = next.draft.items.find(i => i.id === 'web-officekit-everyday-kit-tidy-files');
  const chat = next.draft.items.find(i => i.id === 'web-officekit-everyday-kit-send-chat');
  assert.equal(hook?.kind === 'tool' && hook.toolKind === 'hook' && hook.runsCode, true);
  assert.equal(chat?.kind === 'tool' && chat.toolKind === 'mcp' ? chat.secret?.state : null, 'missing');
  assert.equal(chat?.kind === 'tool' && chat.toolKind === 'mcp' ? chat.secret?.name : null, 'CHAT_KEY');
});

test('an id that is taken gets the next free one', () => {
  const s = start();
  const one = newItemOf(office.items[0]!);
  const next = reduceStore(s, { type: 'addToLibrary', source: infoOf(office), items: [one, { ...one, name: 'Another name' }] });
  const ids = next.draft.items.filter(i => i.id.startsWith('web-officekit-everyday-kit-triage-inbox')).map(i => i.id);
  assert.deepEqual(ids, ['web-officekit-everyday-kit-triage-inbox', 'web-officekit-everyday-kit-triage-inbox-2']);
});

test('adding nothing, or items with no name or no text, changes nothing', () => {
  const s = start();
  assert.equal(reduceStore(s, { type: 'addToLibrary', source: infoOf(office), items: [] }), s);
  assert.equal(reduceStore(s, { type: 'addToLibrary', source: infoOf(office), items: [{ ...newItemOf(office.items[0]!), name: '  ' }] }), s);
  assert.equal(reduceStore(s, { type: 'addToLibrary', source: infoOf(office), items: [{ ...newItemOf(office.items[0]!), text: '' }] }), s);
});

test('an own copy is named, marked as the person\'s own, and leaves the original alone', () => {
  const s = start();
  const next = reduceStore(s, { type: 'makeOwnCopy', itemId: UPDATE_ITEM_ID, name: 'Tidy my meeting notes (mine)', description: 'Mine.', text: 'Line one.\nLine two.\n' });
  const copy = next.draft.items.find(i => i.name === 'Tidy my meeting notes (mine)');
  assert.ok(copy !== undefined);
  assert.equal(copy.library, null);
  assert.equal(copy.id, `${UPDATE_ITEM_ID}-mine`);
  assert.equal(copy.foundAt[0]!.contentHash, hashText('Line one.\nLine two.\n'));
  assert.equal(item(next.draft, UPDATE_ITEM_ID), item(s.draft, UPDATE_ITEM_ID), 'the original is the very same object');
  assert.equal(next.undoStack.length, 1);
  // a second copy of the same item gets another name and another id
  const again = reduceStore(next, { type: 'makeOwnCopy', itemId: UPDATE_ITEM_ID, name: 'Tidy my meeting notes (mine)', description: 'Mine.', text: 'x\n' });
  assert.deepEqual(again.draft.items.filter(i => i.name.startsWith('Tidy my meeting notes (mine')).map(i => i.name), ['Tidy my meeting notes (mine)', 'Tidy my meeting notes (mine 2)']);
});

test('an own copy of a note set, an unknown item or with an empty name is refused', () => {
  const s = start();
  assert.equal(reduceStore(s, { type: 'makeOwnCopy', itemId: 'item-slice-folders', name: 'x (mine)', description: '', text: 'a\n' }), s);
  assert.equal(reduceStore(s, { type: 'makeOwnCopy', itemId: 'zzz', name: 'x (mine)', description: '', text: 'a\n' }), s);
  assert.equal(reduceStore(s, { type: 'makeOwnCopy', itemId: UPDATE_ITEM_ID, name: ' ', description: '', text: 'a\n' }), s);
});

test('an update puts the new text in place, pins the newer release and clears the waiting mark, in one step', () => {
  const s = start();
  const before = item(s.draft, UPDATE_ITEM_ID)!;
  assert.equal(before.library?.newerVersion, 'v1.3');
  const next = reduceStore(s, { type: 'useUpdate', itemId: UPDATE_ITEM_ID, text: 'New text.\n', description: 'New hint.', release: 'v1.3' });
  const after = item(next.draft, UPDATE_ITEM_ID)!;
  assert.deepEqual(after.library, { library: 'open-skills', pinnedVersion: 'v1.3' });
  assert.equal(after.foundAt[0]!.text, 'New text.\n');
  assert.equal(after.kind === 'skill' ? after.description : '', 'New hint.');
  assert.equal(next.draft.libraries.find(l => l.id === 'open-skills')?.newerVersion, undefined, 'the source is up to date now');
  assert.equal(next.draft.libraries.find(l => l.id === 'open-skills')?.installedVersion, 'v1.3');
  assert.equal(next.undoStack.length, 1);
  assert.equal(reduceStore(next, { type: 'useUpdate', itemId: UPDATE_ITEM_ID, text: 'Again\n', description: '', release: 'v1.4' }), next, 'nothing is waiting any more');
});

test('an update for an item with nothing waiting is refused', () => {
  const s = start();
  assert.equal(reduceStore(s, { type: 'useUpdate', itemId: 'skill-042', text: 'x\n', description: '', release: 'v2' }), s);
  assert.equal(reduceStore(s, { type: 'useUpdate', itemId: 'nope', text: 'x\n', description: '', release: 'v2' }), s);
});

test('the Library actions go through createStore: subscribers hear one change each, and save and go back keep working', () => {
  const store = createStore(libraryWorld());
  let heard = 0;
  store.subscribe(() => { heard += 1; });
  store.dispatch({ type: 'removeFromLibrary', itemId: 'skill-010' });
  store.dispatch({ type: 'removeFromLibrary', itemId: 'skill-010' });
  assert.equal(heard, 1);
  store.dispatch({ type: 'apply', label: 'Removed Compare two options' });
  assert.equal(store.getState().committed.versions.length, 1);
  store.dispatch({ type: 'restore', versionId: store.getState().committed.versions[0]!.id });
  assert.equal(store.getState().committed.versions.length, 2);
});

test('the store sources of the Library read no clock and no random number', () => {
  const text = readFileSync(join(DESKTOP, 'shared', 'proto', 'store-library.ts'), 'utf8');
  for (const word of ['Date.', 'new Date', 'Math.random', 'window.bowerloom', 'node:fs', 'innerHTML', 'performance.now', 'crypto']) assert.equal(text.includes(word), false, word);
});

test('the text a source item carries is the text the store keeps', () => {
  const first = office.items[0]!;
  const next = reduceStore(start(), { type: 'addToLibrary', source: infoOf(office), items: [newItemOf(first)] });
  assert.equal(next.draft.items.find(i => i.id.endsWith('triage-inbox'))!.foundAt[0]!.text, textOfItem(first));
});
