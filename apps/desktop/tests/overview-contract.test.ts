// The contract of the Overview (Task 2, stage 1): the route, the navigation key, the optional fields of a scan source and a part, the limits, and the words.
// Lanes G and H build behind these names; this file stays true when they do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRoute, navKeyOf, parseRoute } from '../shared/harness/route.js';
import type { NavKey, Route } from '../shared/harness/route.js';
import { OVERVIEW_LIMITS } from '../shared/harness/overview.js';
import type { Overview, OverviewGroup, OverviewNode } from '../shared/harness/overview.js';
import type { LaidNode } from '../shared/harness/overview-layout.js';
import type { GraphNode } from '../shared/harness/layout.js';
import type { Part, ScanSource } from '../shared/harness/types.js';
import { LIMITS, countWords } from '../shared/home/textbudget.js';
import { bannedHere } from '../shared/harness/words.js';
import { WORDS } from '../renderer/harness/words.js';
import { OVERVIEW, alsoInWords, countsWords, moreWords, nodeName, selectedWords, usesWords } from '../renderer/harness/words-overview.js';

test('the Overview route: #app/overview and #sample/overview go both ways, and its navigation key is overview', () => {
  const route: Route = { name: 'overview' };
  assert.deepEqual(parseRoute('#app/overview'), route);
  assert.deepEqual(parseRoute('#sample/overview'), route);
  assert.equal(formatRoute(route, '#app'), '#app/overview');
  assert.equal(formatRoute(route), '#sample/overview');
  assert.deepEqual(parseRoute(formatRoute(route, '#app')), route);
  const key: NavKey | null = navKeyOf(route);
  assert.equal(key, 'overview');
  // An id after the name is ignored, and the other routes did not move.
  assert.deepEqual(parseRoute('#app/overview/folder-1'), route);
  assert.deepEqual(parseRoute('#app/harnesses'), { name: 'harnesses' });
  assert.equal(navKeyOf({ name: 'harnesses' }), 'harnesses');
});

test('a scan source and a part take the new fields, and they are optional', () => {
  const bare: ScanSource = { id: 's', name: 'n', interfaceName: 'i', harnessName: 'h', partIds: [] };
  const filled: ScanSource = { ...bare, scope: 'project', label: '~/Projects/alpha' };
  assert.equal(bare.scope, undefined); assert.equal(filled.scope, 'project');
  const part: Part = { id: 'p', kind: 'tool', name: 'n', summary: '', description: '', path: '', source: '', origin: 's', fileText: '', cannotUse: [], inLibrary: true, toolKind: 'hook', contentHash: 'abc' };
  assert.equal(part.toolKind, 'hook');
});

test('the shapes fit together: a laid node is a graph node, so edgePath and the small map draw it', () => {
  const node: OverviewNode = { id: 'g/p', partId: 'p', kind: 'skill', name: 'n', summary: '', sharedWith: [] };
  const group: OverviewGroup = { id: 'g', name: 'n', label: '~', scope: 'home', programs: [], inBowerloom: false, folderId: null, counts: { agent: 0, skill: 1, tool: 0, context: 0 }, nodes: [node], edges: [] };
  const overview: Overview = { groups: [group], sharedKeys: new Map() };
  const laid: LaidNode = { id: node.id, kind: node.kind, name: node.name, summary: node.summary, missing: false, isNew: false, x: 0, y: 0, w: 216, h: 60, groupId: 'g', sharedWith: [] };
  const graphNode: GraphNode = laid;
  assert.equal(overview.groups[0]!.nodes[0]!.id, graphNode.id);
});

test('the limits are the numbers of the plan', () => {
  assert.equal(Object.isFrozen(OVERVIEW_LIMITS), true);
  assert.deepEqual({ ...OVERVIEW_LIMITS }, { expandedNodes: 150, expandAllMax: 400, domNodes: 400, detailZoom: 0.5, cullMargin: 200, clusterWidth: 720, smallScreen: 900 });
});

test('the words: the navigation label, the table within the limits, no banned word, frozen', () => {
  assert.equal(WORDS.label.overview, 'Overview');
  assert.equal(Object.isFrozen(OVERVIEW), true); assert.equal(Object.isFrozen(OVERVIEW.label), true);
  for (const [key, text] of Object.entries(OVERVIEW.label)) { assert.ok(countWords(text) <= LIMITS.label, `label.${key}: ${text}`); assert.equal(bannedHere(text), null, `label.${key}: ${text}`); }
  for (const [key, text] of Object.entries(OVERVIEW.hint)) { assert.ok(countWords(text) <= LIMITS.hint, `hint.${key}: ${text}`); assert.equal(bannedHere(text), null, `hint.${key}: ${text}`); }
  for (const [key, text] of Object.entries(OVERVIEW.paragraph)) { assert.ok(countWords(text) <= LIMITS.paragraph, `paragraph.${key}: ${text}`); assert.equal(bannedHere(text), null, `paragraph.${key}: ${text}`); }
  assert.equal(OVERVIEW.hint.wrongFolder, 'That is not the folder shown.');
});

test('the word builders', () => {
  assert.equal(countsWords({ agent: 3, skill: 5, tool: 2, context: 1 }), '3 agents, 5 skills, 2 tools, 1 set of notes');
  assert.equal(countsWords({ agent: 1, skill: 0, tool: 0, context: 2 }), '1 agent, 2 sets of notes');
  assert.equal(countsWords({ agent: 0, skill: 0, tool: 0, context: 0 }), 'Nothing found');
  assert.equal(alsoInWords(1), 'Also in 1 place'); assert.equal(alsoInWords(3), 'Also in 3 places');
  assert.equal(usesWords(1, 'skill'), 'Uses 1 skill'); assert.equal(usesWords(2, 'tool'), 'Uses 2 tools');
  assert.equal(nodeName({ name: 'Check facts', kind: 'skill', group: 'Your Claude Code folder', uses: 0, sharedWith: 1 }), 'Check facts, skill, Your Claude Code folder, shared with 1 place');
  assert.equal(nodeName({ name: 'Tidy', kind: 'agent', group: 'alpha (Codex)', uses: 2, usesKind: 'skill', sharedWith: 0 }), 'Tidy, agent, alpha (Codex), uses 2 skills');
  assert.equal(nodeName({ name: 'Guard', kind: 'tool', toolKind: 'hook', group: 'Home', uses: 0, runsCode: true, sharedWith: 0 }), 'Guard, hook, Home, runs code');
  assert.equal(selectedWords(null), 'Nothing selected'); assert.equal(selectedWords('Tidy'), 'Selected Tidy'); assert.equal(moreWords(12), 'and 12 more');
  for (const text of [countsWords({ agent: 3, skill: 5, tool: 2, context: 1 }), alsoInWords(2), usesWords(3, 'skill'), selectedWords('X'), moreWords(5)]) assert.equal(bannedHere(text), null, text);
});
