// Wave C, group 9: the trust text. What a tool reaches, who made a skill from outside, the time on a save point, and the words of the Preview popover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { skillTrust, toolTrust } from '../shared/home/details-trust.js';
import { savePointRows } from '../shared/home/points.js';
import { plainNameOfSaved } from '../shared/home/plain-names.js';
import { SavePoints } from '../renderer/home/points/SavePoints.js';
import { DetailsPanel } from '../renderer/home/details/DetailsPanel.js';
import { detailsOf } from '../shared/home/details.js';
import { ownedAgents } from '../shared/home/cards.js';
import { saveAction, goBackAction } from '../renderer/home/store-actions.js';
import { WORDS } from '../renderer/home/words.js';
import { createStore } from '../shared/proto/store.js';
import { withStartPoint } from '../shared/home/savebar.js';
import { UPDATE_ITEM_ID } from '../shared/home/library-sample.js';
import { assertTextBudget, countWords } from '../shared/home/textbudget.js';
import { libraryWorld } from './home-library-world.js';

const world = libraryWorld();

test('the Preview popover says what the preview sends, stores and writes, in at most 25 words', () => {
  assert.equal(WORDS.popover.preview, 'This is a preview. It sends nothing, stores nothing, and writes nothing to your computer.');
  assert.ok(countWords(WORDS.popover.preview) <= 25);
});

test('a skill from outside has its maker and release from the Library facts; a skill of the person\'s own has none', () => {
  assert.deepEqual(skillTrust(world, UPDATE_ITEM_ID), { madeBy: 'Priya Raman', release: 'v1.2' });
  const own = world.items.find(i => i.kind === 'skill' && i.library === null)!;
  assert.equal(skillTrust(world, own.id), null);
  assert.equal(skillTrust(world, 'nothing-here'), null);
});

test('a tool has the host it reaches (or "This computer only", or nothing outside) and "Can only read" or "Can change things"', () => {
  assert.deepEqual(toolTrust(world, 'tool-mcp-missing'), { reaches: 'calendar.example.com', can: 'Can only read' }, 'a tool named Read says it can only read');
  assert.equal(toolTrust(world, 'tool-hook-guard')?.can, 'Can change things', 'a tool that runs code can change things');
  assert.deepEqual(toolTrust(world, 'tool-mcp-present'), { reaches: 'search.example.com', can: 'Can only read' });
  assert.equal(toolTrust(world, 'tool-hook-guard')?.reaches, 'This computer only');
  assert.match(toolTrust(world, 'tool-prompt-01')?.reaches ?? '', /^Nothing outside/);
  assert.equal(toolTrust(world, 'skill-001'), null);
  for (const t of ['tool-mcp-missing', 'tool-prompt-01', 'tool-hook-guard']) { const x = toolTrust(world, t)!; assert.ok(countWords(x.reaches) <= 12 && countWords(x.can) <= 12); }
});

test('the details panel draws the maker and release of a skill and the reach of a tool, and nothing for the person\'s own', () => {
  const agents = ownedAgents(world), none = (): void => undefined;
  const draw = (kind: 'skill' | 'tool', id: string, owner: string): string => {
    const d = detailsOf(world, agents, { kind, id, ownerAgentId: owner });
    return renderToStaticMarkup(createElement(DetailsPanel, { details: d, onSelect: none, onRemove: none, onBadgePress: none, onChoose: none, skillTrust: kind === 'skill' ? skillTrust(world, id) : null, toolTrust: kind === 'tool' ? toolTrust(world, id) : null }));
  };
  const skill = draw('skill', UPDATE_ITEM_ID, 'agent-01');
  assert.match(skill, /<dt>Made by<\/dt><dd[^>]*data-field="author"[^>]*>Priya Raman<\/dd><dt>Release<\/dt><dd[^>]*data-field="release"[^>]*>v1\.2<\/dd>/);
  assert.deepEqual(assertTextBudget(skill), []);
  const tool = draw('tool', 'tool-mcp-missing', 'agent-01');
  assert.match(tool, /<h3 class="dt-sub"[^>]*>Reaches<\/h3><p data-reaches=""[^>]*>calendar\.example\.com<\/p><p class="kit-hint" data-can="">Can only read<\/p>/);
  assert.deepEqual(assertTextBudget(tool), []);
  const own = world.items.find(i => i.kind === 'skill' && i.library === null && agents.some(a => a.definition.skillIds.includes(i.id)))!;
  const mine = draw('skill', own.id, agents.find(a => a.definition.skillIds.includes(own.id))!.id);
  assert.doesNotMatch(mine, /Made by<\/dt>|data-origin/);
});

test('the clock time travels in the save action and lands on the save point, and the point the session starts with has none', () => {
  assert.deepEqual(saveAction('Removed A'), { type: 'apply', label: 'Removed A' });
  assert.deepEqual(saveAction('Removed A', 'Today, 8:42 AM'), { type: 'apply', label: 'Removed A', madeAt: 'Today, 8:42 AM' });
  assert.deepEqual(goBackAction('v1', 'Today, 9:05 AM'), { type: 'restore', versionId: 'v1', madeAt: 'Today, 9:05 AM' });
  const store = createStore(withStartPoint(world));
  const agent = ownedAgents(store.getState().draft)[0]!;
  store.dispatch({ type: 'detachSkill', agentId: agent.id, skillId: agent.definition.skillIds[0]! });
  store.dispatch(saveAction('Removed a skill', 'Today, 8:42 AM'));
  const rows = savePointRows(store.getState().committed, plainNameOfSaved(store.getState().committed));
  assert.deepEqual(rows.map(r => [r.when, r.madeAt]), [['just now', 'Today, 8:42 AM'], ['when you began', '']]);
});

test('a row of the history shows the time first, then how long ago in words; a row with no time shows only the words', () => {
  const rows = [
    { id: 'v2', name: 'Removed a skill', when: 'just now', changes: 'Removed A', current: true, madeAt: 'Today, 8:42 AM' },
    { id: 'v1', name: 'How it started', when: 'when you began', changes: '', current: false, madeAt: '' },
  ];
  const m = renderToStaticMarkup(createElement(SavePoints, { rows, unsaved: false, onGoBack: () => undefined, onShare: () => undefined, onOpenFile: () => undefined }));
  assert.match(m, /<p class="pt-name"[^>]*>Removed a skill<\/p><p class="pt-clock" data-clock="">Today, 8:42 AM<\/p><p class="kit-hint pt-when">just now<\/p>/);
  assert.equal([...m.matchAll(/data-clock=""/g)].length, 1);
  assert.deepEqual(assertTextBudget(m), []);
});
