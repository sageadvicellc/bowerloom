// The screen words of the home app: every string obeys the banned list and the text budget, and no source file smuggles one in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BANNED, WORDS, agentsCount, stepAnnouncement } from '../renderer/home/words.js';
import { TOUR_STEPS } from '../renderer/home/tour/steps.js';
import { LIMITS, assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';
import { CARD_WORDS } from '../shared/home/cards.js';
import { PLAIN_NOTES, PLAIN_TOOLS } from '../shared/home/plain.js';
import { DESKTOP } from './support.js';

const groups = [['label', LIMITS.label], ['hint', LIMITS.hint], ['popover', LIMITS.popover]] as const;

test('WORDS is frozen all the way down and holds three groups', () => {
  assert.deepEqual(Object.keys(WORDS), ['label', 'hint', 'popover']);
  assert.equal(Object.isFrozen(WORDS), true);
  for (const [group] of groups) assert.equal(Object.isFrozen(WORDS[group]), true, group);
  assert.throws(() => { (WORDS.label as Record<string, string>).add = 'x'; }, TypeError);
});

for (const [group, limit] of groups) {
  test(`every ${group} in WORDS has at most ${limit} words and no banned word (case-insensitive, whole words)`, () => {
    const entries = Object.entries(WORDS[group]);
    assert.ok(entries.length >= 3, group);
    for (const [key, text] of entries) {
      assert.equal(typeof text, 'string', key);
      assert.ok(countWords(text) <= limit, `${group}.${key} has ${countWords(text)} words: ${text}`);
      assert.equal(bannedIn(text, group === 'popover'), null, `${group}.${key}: ${text}`);
      assert.equal(text, text.trim(), `${group}.${key} has stray space`);
    }
  });
}

test('MCP may appear only in a popover', () => {
  for (const group of ['label', 'hint'] as const) for (const [key, text] of Object.entries(WORDS[group])) assert.doesNotMatch(text, /\bMCP\b/i, `${group}.${key}`);
  assert.ok(Object.values(WORDS.popover).some(t => /\bMCP\b/.test(t)), 'the rule is shown in one popover');
});

test('the storyboard vocabulary is used as written, except where Hanna chose another word', () => {
  const l = WORDS.label;
  // Hanna renamed the storyboard's "Save points" to "Version history" on 2026-10-25. It is the one phrase that lets the word "version" through.
  assert.deepEqual([l.versionHistory, l.save, l.add, l.help, l.showTour, l.yourAgents], ['Version history', 'Save', 'Add', 'Help', 'Show me around', 'Your agents']);
  assert.equal(bannedIn(l.versionHistory), null); assert.notEqual(bannedIn('version'), null);
  assert.doesNotMatch(JSON.stringify(WORDS), /save point/i, 'no screen word still says save point');
  assert.deepEqual([l.skills, l.tools, l.notes], ['Skills', 'Tools', 'Notes']);
  assert.deepEqual([l.tourBack, l.tourNext, l.tourDone, l.tourSkip], ['Back', 'Next', 'Done', 'Skip tour']);
  assert.equal(BANNED.includes('harness'), true);
});

test('the words built from numbers, the card words and the tour sentences obey the same rules', () => {
  const built = [agentsCount(0), agentsCount(1), agentsCount(10), stepAnnouncement(2, 6), ...Object.values(CARD_WORDS), ...TOUR_STEPS.map(s => s.text), '2 different copies', '12 different copies'];
  for (const text of built) { assert.ok(countWords(text) <= LIMITS.hint, text); assert.equal(bannedIn(text), null, text); assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text); }
  assert.equal(agentsCount(1), '1 agent'); assert.equal(agentsCount(10), '10 agents'); assert.equal(stepAnnouncement(2, 6), 'Step 2 of 6');
});

test('the group a string sits in is the budget it is checked against: a hint that is a label would fail, and the reverse is checked by markup', () => {
  for (const text of Object.values(WORDS.label)) assert.deepEqual(assertTextBudget(`<button type="button">${text}</button>`), [], text);
  for (const text of Object.values(WORDS.hint)) assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text);
  for (const text of Object.values(WORDS.popover)) assert.deepEqual(assertTextBudget(`<div data-budget="popover"><p>${text}</p></div>`), [], text);
});

// ---- The source scan.
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function sources(dir: string): string[] {
  return readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.tsx?$/.test(e.name)).map(e => join((e as unknown as { parentPath: string }).parentPath, e.name));
}
/** The pieces of a source file that a person could read: string literals and JSX text. */
function readable(source: string): string[] {
  // The names of files in an import ("./home-tokens.css") are code, not words.
  const code = source.replace(/\b(?:from|import)\s*['"][^'"\n]*['"]/g, '');
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' '));
  for (const m of code.matchAll(/>([^<>{}=;()]*[A-Za-z][^<>{}=;()]*)</g)) out.push(m[1]!);
  return out;
}
// words.ts is checked by the tests above. The store's own action names ("apply") are code, not screen words, and live in one file.
// The data's own kind names ('mcp' is the kind of a tool in the sample data) are code too, and are let through whole.
// The sample's ids for the tools of that kind ('tool-mcp-01') and for the saved choices of pages ('slice-folders') are code too: the plain layer is keyed by them.
// They are listed one by one, so a screen word that only looks like an id ('slice-xyz') is still caught.
const DATA_KINDS = new Set(['mcp']);
const DATA_IDS: ReadonlySet<string> = new Set(['tool-mcp-missing', 'tool-mcp-present', 'tool-mcp-01', 'tool-mcp-02', 'tool-mcp-03', 'slice-folders', 'slice-kinds', 'slice-seeds']);
const EXEMPT = new Set(['words.ts', 'store-actions.ts', 'textbudget.ts']);

test('no source file under renderer/home or shared/home has a banned word in a string literal or in JSX text', () => {
  const files = [...sources('renderer/home'), ...sources('shared/home')].filter(f => !EXEMPT.has(f.slice(f.lastIndexOf('/') + 1)));
  assert.ok(files.length >= 6, `${files.length} files`);
  for (const file of files) for (const piece of readable(strip(readFileSync(file, 'utf8'))).filter(p => !DATA_KINDS.has(p) && !DATA_IDS.has(p))) assert.equal(bannedIn(piece), null, `${file}: ${piece}`);
});

test('the ids let through the scan are exactly ones the plain layer is keyed by, and a look-alike is not let through (review item 14)', () => {
  for (const id of DATA_IDS) assert.ok(id in PLAIN_TOOLS || id in PLAIN_NOTES, id);
  assert.equal(DATA_IDS.size, Object.keys(PLAIN_NOTES).length + Object.keys(PLAIN_TOOLS).filter(id => id.startsWith('tool-mcp')).length);
  assert.ok(!DATA_IDS.has('slice-xyz') && !DATA_IDS.has('tool-mcp-new'));
  assert.deepEqual(readable(strip(`const a = 'slice-xyz';`)).filter(p => !DATA_IDS.has(p) && bannedIn(p) !== null), ['slice-xyz']);
});

test('the source scan itself catches a banned word in a literal and in JSX text', () => {
  assert.deepEqual(readable(strip(`const a = 'Open the harness'; <b>The scope</b>`)).filter(p => bannedIn(p) !== null).length, 2);
  assert.deepEqual(readable(strip('// the harness\nconst a = 1;')), []);
  assert.deepEqual(readable('const a = `${w.slice(1)} items`;').filter(p => bannedIn(p) !== null), [], 'the code inside ${} is not text');
});
