// Wave E, group H: "Show where it lives". The sample paths of an agent, a skill and a tool, one for each program that holds it, written from the sample world's own
// folders with the home folder as "~", never from the machine the preview runs on; and the disclosure that shows them, closed until it is pressed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { homedir } from 'node:os';
import { placesOf, placesOfItem, samplePath, slugOf } from '../shared/home/where-it-lives.js';
import { detailsOf } from '../shared/home/details.js';
import { ownedAgents } from '../shared/home/cards.js';
import { libraryDetails, libraryRows } from '../shared/home/library-model.js';
import { DetailsPanel } from '../renderer/home/details/DetailsPanel.js';
import { LibraryDetails } from '../renderer/home/library/LibraryDetails.js';
import { WhereItLives } from '../renderer/home/details/WhereItLives.js';
import { copyText } from '../renderer/home/kit/clipboard.js';
import { WORDS } from '../renderer/home/words.js';
import { assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';
import { libraryWorld } from './home-library-world.js';

const world = libraryWorld();
const none = (): void => undefined;

test('a name is written as the words of a file name, and a stored name becomes the plain one in the path', () => {
  assert.equal(slugOf('Write a reply'), 'write-a-reply');
  assert.equal(slugOf('  Fix spelling & grammar!  '), 'fix-spelling-grammar');
  assert.equal(slugOf('???'), 'item');
  assert.equal(samplePath('/Users/sample/Studio/.claude/skills/silken-kettle/SKILL.md', 'silken-kettle', 'Write a reply'), '~/Studio/.claude/skills/write-a-reply.md');
  assert.equal(samplePath('/Users/sample/Studio/.codex/agents/velvet-weaver.toml', 'velvet-weaver', 'Meeting assistant'), '~/Studio/.codex/agents/meeting-assistant.toml');
  assert.equal(samplePath('/Users/sample/Studio/.claude/commands/lunar-wicker.md', 'lunar-wicker', 'Draft a polite message'), '~/Studio/.claude/commands/draft-a-polite-message.md');
  assert.equal(samplePath('/Users/sample/Studio/.claude/settings.json', 'quiet-lantern', 'Read my calendar'), '~/Studio/.claude/settings.json', 'a file that holds several things keeps its name');
  assert.equal(samplePath('/Users/sample/.cache/evergreen-kit/2.3.0/agents/hollow-scribe.md', 'hollow-scribe', 'Note taker'), '~/.cache/evergreen-kit/2.3.0/agents/note-taker.md');
});

test('an agent, a skill and a tool each have one sample path for each program that holds it, in the order of the programs, and none from this machine', () => {
  const real = homedir();
  let seen = 0;
  for (const item of world.items) {
    if (item.kind !== 'agent' && item.kind !== 'skill' && item.kind !== 'tool') continue;
    const places = placesOfItem(item, 'Some Name');
    const programs = new Set(item.foundAt.map(f => f.interface));
    assert.equal(places.length, programs.size, item.id);
    assert.equal(new Set(places.map(p => p.app)).size, places.length, 'one for each program');
    for (const p of places) {
      assert.match(p.path, /^~\//, `${item.id}: ${p.path}`);
      assert.doesNotMatch(p.path, /\/Users\/|\\/, p.path);
      if (real !== '/' && real !== '') assert.equal(p.path.includes(real), false, 'not from this machine');
      assert.ok(['Claude Code', 'Codex', 'OpenCode'].includes(p.app), p.app);
      assert.equal(bannedIn(p.path), null, `no screen may say a banned word, in a path too: ${p.path}`);
      seen += 1;
    }
  }
  assert.ok(seen > 100);
  const skill = placesOf(world, 'skill', 'skill-022', 'Write a reply');
  assert.ok(skill.length >= 1 && skill.every(p => p.path.endsWith('/write-a-reply.md')), JSON.stringify(skill));
  assert.deepEqual(placesOf(world, 'note', 'slice-folders', 'Client list'), [], 'a set of notes lives in no file');
  assert.deepEqual(placesOf(world, 'skill', 'skill-nowhere', 'x'), []);
  // The kinds the screens ask about all have places.
  for (const [kind, id] of [['agent', 'agent-01'], ['skill', 'skill-042'], ['tool', 'tool-mcp-present'], ['tool', 'tool-prompt-01']] as const) assert.ok(placesOf(world, kind, id, 'Some Name').length >= 1, id);
});

test('the disclosure is closed with aria-expanded false, draws nothing for a thing with no place, and its words pass the budget', () => {
  const places = placesOf(world, 'skill', 'skill-022', 'Write a reply');
  const m = renderToStaticMarkup(createElement(WhereItLives, { places }));
  assert.match(m, /<button[^>]*aria-expanded="false"[^>]*data-variant="text"[^>]*>Show where it lives<\/button>/);
  assert.doesNotMatch(m, /<code|Copy path|<ul/, 'closed: no path is in the page');
  assert.equal(renderToStaticMarkup(createElement(WhereItLives, { places: [] })), '');
  assert.deepEqual(assertTextBudget(m), []);
  for (const text of [WORDS.label.showWhere, WORDS.label.hideWhere, WORDS.label.copyPath, WORDS.label.copied]) assert.ok(countWords(text) <= 5 && bannedIn(text) === null, text);
  assert.ok(countWords(WORDS.hint.copyBlocked) <= 12 && bannedIn(WORDS.hint.copyBlocked) === null);
  assert.equal(WORDS.label.showWhere, 'Show where it lives');
  assert.equal(WORDS.label.copyPath, 'Copy path');
  assert.equal(WORDS.label.copied, 'Copied');
});

test('the details of an agent, a skill and a tool, on the map and in the Library, carry the disclosure; a set of notes does not', () => {
  const agents = ownedAgents(world);
  for (const [kind, id] of [['agent', 'agent-01'], ['skill', 'skill-042'], ['tool', 'tool-mcp-present']] as const) {
    const d = detailsOf(world, agents, { kind, id, ...(kind === 'agent' ? {} : { ownerAgentId: agents.find(a => (kind === 'skill' ? a.definition.skillIds.includes(id) : a.definition.toolAttachments.some(t => t.toolId === id)))!.id }) })!;
    const places = placesOf(world, kind, id, d.name);
    const panel = renderToStaticMarkup(createElement(DetailsPanel, { details: d, places, onSelect: none, onRemove: none, onBadgePress: none, onChoose: none }));
    assert.match(panel, /Show where it lives/, `${kind} on the map`);
    assert.deepEqual(assertTextBudget(panel), [], kind);
    const lib = libraryDetails(world, kind, id)!;
    const shown = renderToStaticMarkup(createElement(LibraryDetails, { details: lib, choices: [], say: '', onPickAgent: none, onOpenAgent: none, onRemove: none, onCopy: none, onUpdate: none, onBadgePress: none, places }));
    assert.match(shown, /Show where it lives/, `${kind} in the Library`);
    assert.deepEqual(assertTextBudget(shown), [], kind);
  }
  const note = libraryRows(world, 'note')[0]!;
  const lib = libraryDetails(world, 'note', note.id)!;
  assert.doesNotMatch(renderToStaticMarkup(createElement(LibraryDetails, { details: lib, choices: [], say: '', onPickAgent: none, onOpenAgent: none, onRemove: none, onCopy: none, onUpdate: none, onBadgePress: none, places: [] })), /Show where it lives/);
});

test('copying with no window to copy in is an answer, not an error', async () => {
  assert.equal(await copyText('~/Studio/.claude/skills/write-a-reply.md'), false);
});
