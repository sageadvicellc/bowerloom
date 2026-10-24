// The versions and export screen drawn with a provider: no versions, some versions, unsaved changes, the Share tab, and no provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProtoProvider, useProtoStore } from '../renderer/proto/session.js';
import { VersionsScreen, VersionsView } from '../renderer/proto/VersionsScreen.js';
import type { TabId } from '../renderer/proto/VersionsScreen.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import { createStore } from '../shared/proto/store.js';
import type { Store } from '../shared/proto/store.js';
import { DESKTOP } from './support.js';

const COMMAND = /\bbowerloom (ls|status|use|unuse|lock|apply|skills|skill|prompt|team|store|folder|slice|context|cache|up|help)\b|\bnpm (run|install)\b|\bgit (push|init|add|commit|remote)\b|\bcd \S|\bchmod\b|--[a-z]{3,}|terminal|command line|\$ /i;
const BANNED = /\bhelpers?\b|\bteams?\b/i;
const world = generateWorld(1);
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

function Probe({ tab }: { tab: TabId }) { return createElement(VersionsView, { session: useProtoStore(), initialTab: tab }); }
const draw = (store: Store, tab: TabId = 'history'): string => renderToStaticMarkup(createElement(ProtoProvider, { store }, createElement(Probe, { tab })));

/** A store with `n` applied versions, each one an edit to an agent. */
function withVersions(n: number): Store {
  const store = createStore(generateWorld(1));
  const agent = world.items.find(i => i.kind === 'agent' && i.library === null)!;
  const skills = world.items.filter(i => i.kind === 'skill' && i.library === null).slice(0, n);
  skills.forEach((s, i) => { store.dispatch({ type: 'attachSkill', agentId: agent.id, skillId: s.id }); store.dispatch({ type: 'apply', label: `Edit ${i + 1}` }); });
  return store;
}

test('with no provider the screen shows its title and the count line, and does not throw', () => {
  const markup = renderToStaticMarkup(createElement(VersionsScreen, { world }));
  assert.equal(textOf(markup), 'Versions 0 versions');
  assert.match(markup, /<h1[^>]*>Versions<\/h1>/);
});

test('with no versions it says so in plain words and explains that applying makes the first one', () => {
  const t = textOf(draw(createStore(generateWorld(1))));
  assert.match(t, /No versions yet\./);
  assert.match(t, /Applying makes the first one\./);
  assert.match(t, /Comparing needs two versions\. There are none yet\./);
  assert.doesNotMatch(t, /Unsaved changes/);
  assert.doesNotMatch(t, /Restore this version/);
});

test('with versions it lists them newest first with the label, the parent and how many items changed', () => {
  const markup = draw(withVersions(3)), t = textOf(markup);
  const order = [...markup.matchAll(/<h3>Version (\d+)<\/h3>/g)].map(m => Number(m[1]));
  assert.deepEqual(order, [3, 2, 1]);
  assert.match(t, /Edit 3/); assert.match(t, /Based on version 2\. 1 item changed\./); assert.match(t, /First version\. Nothing came before it\./);
  assert.equal([...markup.matchAll(/Restore this version<\/button>/g)].length, 2, 'the current version has nothing to restore');
  assert.match(t, /Current/); assert.match(t, /This is the version you have now\./);
  assert.match(markup, /<ol[^>]*aria-label="Versions, newest first"/);
});

test('with one version, comparing is explained, and with two there are two labelled pickers', () => {
  assert.match(textOf(draw(withVersions(1))), /Comparing needs two versions\. There is one so far\./);
  const markup = draw(withVersions(2));
  assert.equal([...markup.matchAll(/<select/g)].length, 2);
  assert.match(markup, /<label[^>]*><span>Compare this version<\/span><select/);
  assert.match(markup, /<label[^>]*><span>with this version<\/span><select/);
  assert.match(markup, /<button[^>]*>Compare<\/button>/);
  assert.match(textOf(markup), /Version 2: Edit 2/);
});

test('unsaved changes show only when the draft is dirty', () => {
  const store = withVersions(1);
  assert.doesNotMatch(textOf(draw(store)), /Unsaved changes/);
  store.dispatch({ type: 'setOverride', scopeId: 'scope-tallowbrook', itemId: CASE_IDS.hiddenSkill, mode: 'hide' });
  const t = textOf(draw(store));
  assert.match(t, /Unsaved changes/); assert.match(t, /Restoring a version replaces them\./);
  assert.match(t, /Restore this version/, 'the current version can be restored over unsaved changes');
});

test('the tabs are real buttons with aria-selected, and the panel is named by the tab', () => {
  const markup = draw(withVersions(1));
  const tabs = [...markup.matchAll(/<button[^>]*role="tab"[^>]*>(.*?)<\/button>/g)];
  assert.deepEqual(tabs.map(m => m[1]), ['History', 'Share']);
  assert.equal([...markup.matchAll(/role="tab"[^>]*aria-selected="true"|aria-selected="true"[^>]*role="tab"/g)].length, 1);
  assert.match(markup, /role="tablist"/); assert.match(markup, /role="tabpanel"/);
  assert.match(draw(withVersions(1), 'share'), /<h2[^>]*>Share<\/h2>/);
});

test('share: export has scope ticks, counts, tool references, slice rules, the promise and a Save file button', () => {
  const markup = draw(withVersions(1), 'share'), t = textOf(markup);
  assert.match(t, /Export/); assert.match(t, /Harnesses to export/);
  assert.equal([...markup.matchAll(/type="checkbox"/g)].length, world.scopes.length);
  assert.match(t, /\d+ skills, \d+ agents, \d+ tool references, 3 slice rules\./);
  assert.match(t, /Tool references/); assert.match(t, /Needs a secret: LANTERN_TOKEN, an environment variable\./);
  assert.match(t, /hook \(runs code\)/);
  assert.match(t, /Slice rules/); assert.match(t, /Library items are not in the file\./);
  assert.match(t, /No secrets and no wiki page text are in this file\./);
  assert.match(markup, /<button[^>]*>Save file<\/button>/);
  assert.doesNotMatch(t, /Saved as a file/, 'nothing is saved before the button is pressed');
});

test('share: the colleague\'s Bowerloom starts empty, and its file buttons wait for a saved file', () => {
  const markup = draw(withVersions(1), 'share'), t = textOf(markup);
  assert.match(t, /Colleague's Bowerloom/);
  assert.match(t, /Their harness now has 0 skills, 0 agents, 0 tools, and 0 slices\./);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Open an exported file<\/button>/);
  assert.match(t, /Save a file under Export first\./);
  assert.doesNotMatch(t, /Files that would be written|Install\b/);
});

test('the headings go in order on both tabs, and the words are plain', () => {
  for (const tab of ['history', 'share'] as const) {
    for (const store of [createStore(generateWorld(1)), withVersions(3)]) {
      const markup = draw(store, tab), t = textOf(markup);
      const levels = [...markup.matchAll(/<h([1-6])[ >]/g)].map(m => Number(m[1]));
      assert.equal(levels[0], 1); assert.equal(levels.filter(l => l === 1).length, 1);
      for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i]! <= levels[i - 1]! + 1, `${tab}: h${levels[i]} after h${levels[i - 1]}`);
      assert.doesNotMatch(t, COMMAND, tab); assert.doesNotMatch(t, BANNED, tab); assert.doesNotMatch(t, /[–—]/, `${tab} has a dash`);
      assert.doesNotMatch(markup, /style=|onclick/i);
      const inputs = [...markup.matchAll(/<(?:input|select) /g)].length, labelled = [...markup.matchAll(/<label[^>]*>[\s\S]*?<\/label>/g)].filter(m => /<(?:input|select) /.test(m[0])).length;
      assert.equal(labelled, inputs, `${tab}: every control sits in a label`);
    }
  }
});

test('the style sheet uses tokens for colour and the versions token for motion', () => {
  const css = readFileSync(join(DESKTOP, 'renderer', 'proto', 'versions-screen.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  assert.match(css, /--motion-versions-ms/); assert.match(css, /--motion-versions-ease/); assert.match(css, /prefers-reduced-motion/);
});
