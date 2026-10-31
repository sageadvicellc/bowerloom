// The Knowledge screen drawn with a provider and the sample world, in several states, and drawn with no provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgeFlow, KnowledgeScreen } from '../renderer/proto/KnowledgeScreen.js';
import { ProtoProvider, useProtoStore } from '../renderer/proto/session.js';
import { countLine } from '../renderer/proto/words.js';
import { EMPTY_RULE, initialKnowledge, reduceKnowledge } from '../shared/proto/knowledge-state.js';
import type { KnowledgeState } from '../shared/proto/knowledge-state.js';
import { generateWorld } from '../shared/proto/sample.js';
import { LIST_LIMIT } from '../renderer/proto/knowledge-panels.js';
import { createStore } from '../shared/proto/store.js';
import { countMatches, describeRule } from '../shared/proto/slicerule.js';
import { DESKTOP } from './support.js';

const COMMAND = /\bbowerloom (ls|status|use|unuse|lock|apply|skills|skill|prompt|team|store|folder|slice|context|cache|up|help)\b|\bnpm (run|install)\b|\bgit (push|init|add|commit|remote)\b|\bcd \S|\bchmod\b|--[a-z]{3,}|terminal|command line|\$ /i;
const BANNED = /\bhelpers?\b|\bteams?\b|\bglob\b|\bregex\b|\bregular expression|\bpatterns?\b/i;
const world = generateWorld(1);
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function Probe({ initial }: { initial?: KnowledgeState }) {
  return createElement(KnowledgeFlow, { session: useProtoStore(), ...(initial === undefined ? {} : { initial }) });
}
const draw = (initial?: KnowledgeState, setup?: (store: ReturnType<typeof createStore>) => void): string => {
  const store = createStore(generateWorld(1));
  setup?.(store);
  return renderToStaticMarkup(createElement(ProtoProvider, { store }, createElement(Probe, initial === undefined ? {} : { initial })));
};
const countOn = (markup: string): number => Number(/data-testid="slice-count">(\d+)</.exec(markup)![1]);
const startOn = (n: number): KnowledgeState => initialKnowledge([world.slices[n]!, ...world.slices.filter((_, i) => i !== n)]);

test('with no provider the screen shows its title and the count line, as the stub did', () => {
  const markup = renderToStaticMarkup(createElement(KnowledgeScreen, { world }));
  assert.equal(textOf(markup), `Knowledge ${countLine('knowledge', world)}`);
  assert.match(markup, /<h1[^>]*>Knowledge<\/h1>/);
});

test('with a provider the page count shown is the count of the rule engine, for every sample slice', () => {
  for (let n = 0; n < world.slices.length; n += 1) {
    const slice = world.slices[n]!, markup = draw(startOn(n));
    assert.equal(countOn(markup), countMatches(slice.rule, slice.seeds, world.wikiPages), slice.id);
    assert.ok(textOf(markup).includes(describeRule(slice.rule, world.wikiPages)), 'the rule is in plain words');
    assert.match(markup, new RegExp(`<option value="${slice.id}" selected`));
  }
});

test('the preview says the numbers in plain words, with the estimate called rough', () => {
  const text = textOf(draw());
  assert.match(text, /\d+ pages are in this slice/);
  assert.match(text, /The pages add up to about [\d,]+ tokens, a rough measure of size\./);
  assert.equal([...text.matchAll(/rough measure of size/g)].length, 1, 'tokens are explained once');
  assert.match(text, /The map alone is about [\d,]+ tokens\./);
  assert.match(text, /The agent gets a map of \d+ pages: a title and one line for each\./);
  assert.match(text, /3 pages joined since your last visit\./);
  assert.match(text, /\d+ links leave this slice\. They are drawn as dashed lines on the graph\./);
  assert.match(text, /The outside pages that most links point to:/);
  assert.match(text, /Changes you save here wait in the draft\. Apply them on the Harness screen\./);
});

test('each interface gets a badge with its enforcement and one sentence on what it means', () => {
  const text = textOf(draw());
  for (const i of world.interfaces) {
    const name = { 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode', hermes: 'Hermes', bowerloom: 'Bowerloom' }[i.id];
    assert.ok(text.includes(`${name}: ${i.enforcement}`), `${name}: ${i.enforcement}`);
  }
  assert.ok(text.includes('Claude Code: blocks reads')); assert.ok(text.includes('Codex: advisory only'));
  assert.ok(text.includes('The agent cannot read pages outside this slice.')); assert.ok(text.includes('nothing stops it from reading other pages.'));
});

test('both ways to pick are on the screen, the lasso is a toggle, and the graph has a label and a text summary', () => {
  const markup = draw();
  assert.match(markup, /role="radiogroup" aria-label="Way to pick"/);
  assert.match(markup, /Pick on the graph/); assert.match(markup, /Build a rule/);
  assert.match(markup, /<button[^>]*aria-pressed="false"[^>]*>Lasso: (<!-- -->)?off<\/button>/);
  assert.match(markup, /role="img" aria-label="Graph of the wiki\. 700 pages, \d+ links, 8 domain folders\./);
  assert.match(markup, /id="kn-graph-summary"/);
  assert.match(markup, /aria-live="polite"/);
});

test('the rule builder shows the three handles: a folder checklist with counts, page types, tags, links, and the picked pages', () => {
  const s = reduceKnowledge(startOn(0), { type: 'way', way: 'rule' }, { pages: world.wikiPages });
  const markup = draw(s), text = textOf(markup);
  for (const legend of ['Folders', 'Page types', 'Tags', 'Links from your picked pages', 'Picked pages']) assert.ok(text.includes(legend), legend);
  assert.equal([...markup.matchAll(/data-folder="[^"/]+"/g)].length, 8, 'eight domain folders');
  assert.match(text, /\(\d+ pages\)/);
  assert.ok(text.includes('No links') && text.includes('1 hop:') && text.includes('2 hops:'));
  assert.ok(text.includes('A hop is one link followed from a page.'));
  assert.ok(text.includes('A page joins the slice when any one of the three choices below picks it.'));
});

test('the page list is limited to 200 rows and says how many more there are', () => {
  const s = reduceKnowledge(initialKnowledge([]), { type: 'list', list: 'all' }, { pages: world.wikiPages });
  const markup = draw(s);
  assert.equal([...markup.matchAll(/<li class="kn-row/g)].length, LIST_LIMIT);
  assert.ok(textOf(markup).includes(`and ${700 - LIST_LIMIT} more.`));
  assert.ok(textOf(markup).includes('700 pages in the list.'));
});

test('a frozen slice says "Frozen at N pages", shows how the rule differs, and locks the rule', () => {
  const markup = draw(undefined, store => store.dispatch({ type: 'pinSlice', sliceId: world.slices[0]!.id }));
  const n = countMatches(world.slices[0]!.rule, world.slices[0]!.seeds, world.wikiPages);
  assert.ok(textOf(markup).includes(`Frozen at ${n} pages. The rule picks the same pages today.`));
  assert.equal(countOn(markup), n);
  assert.match(markup, /<fieldset class="kn-lock" disabled/);
  assert.ok(textOf(markup).includes('Unfreeze, and follow the rule again'));
  assert.match(markup, /\(frozen\)/);
});

test('a new, empty slice says so, and save, freeze and give to an agent each say what to do first', () => {
  const text = textOf(draw(initialKnowledge([])));
  assert.match(text, /No pages are in this slice yet\./);
  assert.ok(text.includes('Nothing to save yet.'));
  assert.ok(text.includes('Save the slice first. A frozen slice keeps the pages that were saved.'));
  assert.ok(text.includes('Save the slice first. Then you can give it to an agent.'));
  assert.ok(text.includes('Name of the new slice'));
});

test('a slice that an agent has is named, and the agents that can be given a slice are the ones the person owns', () => {
  const owned = world.items.filter(i => i.kind === 'agent' && i.library === null);
  const holders = owned.filter(a => a.kind === 'agent' && a.definition.sliceId === world.slices[0]!.id).map(a => a.name);
  const text = textOf(draw());
  if (holders.length > 0) assert.ok(text.includes(`Agents that have this slice: ${holders.join(', ')}.`));
  else assert.ok(text.includes('No agent has this slice yet.'));
  const markup = draw();
  for (const a of owned) assert.ok(markup.includes(`>${a.name}`), a.name);
  assert.ok(text.includes('library agents come from a library and cannot be changed here.'));
});

test('the words are plain: no helper, no team, no command line, no code-like matching words, no dash', () => {
  const states = [draw(), draw(reduceKnowledge(startOn(1), { type: 'way', way: 'rule' }, { pages: world.wikiPages })), draw(initialKnowledge([])), draw(undefined, s => s.dispatch({ type: 'pinSlice', sliceId: world.slices[2]!.id }))];
  for (const markup of states) {
    const text = textOf(markup);
    assert.doesNotMatch(text, COMMAND); assert.doesNotMatch(text, BANNED); assert.doesNotMatch(text, /—|–/);
    assert.doesNotMatch(markup, /style=|<script|onclick/i);
  }
  const dir = join(DESKTOP, 'renderer', 'proto');
  for (const f of readdirSync(dir).filter(x => /^(knowledge-|Knowledge).*\.tsx?$/.test(x))) {
    const code = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bhelpers?\b|\bteams?\b|terminal|command line/i, f);
    assert.doesNotMatch(code, /—/, f);
  }
});

test('the screen state with a rule and picks draws the rule the app wrote and the reasons for it', () => {
  const pages = world.wikiPages;
  const inFolder = pages.filter(p => p.folder.split('/')[0] === pages[0]!.folder.split('/')[0]);
  let s = reduceKnowledge(initialKnowledge([]), { type: 'lassoResult', ids: inFolder.slice(0, Math.ceil(inFolder.length * 0.8)).map(p => p.id), mode: 'replace' }, { pages });
  s = reduceKnowledge(s, { type: 'hops', hops: 1 }, { pages });
  const text = textOf(draw(s));
  assert.ok(text.includes('The rule the app wrote'));
  assert.match(text, /You picked \d+ pages\./);
  assert.match(text, /so the rule uses the whole folder\./);
  assert.match(text, /\(1 hop\)/);
  assert.match(text, /\d+ pages picked\./);
  assert.equal(countOn(draw(s)), countMatches(s.rule, s.seeds, pages));
  assert.notDeepEqual(s.rule, EMPTY_RULE);
});
