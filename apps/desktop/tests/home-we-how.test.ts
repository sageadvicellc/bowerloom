// Wave E, group I: "How it will work". The sheet states only what the 0.8 specification decided, shows each statement's source as "Decided in the plan", and keeps a
// second list, "Not decided yet", for what testers asked about and the specification does not settle. Plain words, at most 25 words in a paragraph.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECIDED, HOW_WORDS, NOT_DECIDED } from '../renderer/home/trust/how-words.js';
import { HowItWorks } from '../renderer/home/trust/HowItWorks.js';
import { HelpPopover } from '../renderer/home/kit/HelpPopover.js';
import { assertTextBudget, bannedIn, countWords, extractText } from '../shared/home/textbudget.js';
import { DESKTOP } from './support.js';

const html = (leaving = false): string => renderToStaticMarkup(createElement(HowItWorks, { leaving, onClose: () => undefined }));

test('the decided statements are the ones the specification makes, each at most 25 words in plain words, with no banned word', () => {
  assert.deepEqual(DECIDED.map(d => d.id), ['looking', 'originals', 'writes', 'preview-undo', 'history-place', 'secrets', 'sharing', 'opening', 'hooks', 'no-cloud']);
  for (const d of DECIDED) {
    assert.match(d.section, /^\d+(\.\d+)?(, \d+(\.\d+)?)*$/, `${d.id} says which part of the specification it comes from`);
    assert.ok(d.paragraphs.length >= 1);
    for (const text of d.paragraphs) {
      assert.ok(countWords(text) <= 25, `${d.id}: ${countWords(text)} words: ${text}`);
      assert.equal(bannedIn(text), null, `${d.id}: ${text}`);
      assert.equal(text, text.trim());
      assert.doesNotMatch(text, /\b(scan|export|import|adopt|interface|harness|global|MCP)\b/i, text);
    }
  }
});

test('every statement is in the specification: its section exists there, and the key words of it are in that section (read from the file when it is at hand)', () => {
  // The specification is on another branch of another repository; the test reads it when it is beside this checkout and says so when it is not.
  const specs = [process.env.BOWERLOOM_SPEC, join(DESKTOP, '../../../../../knowledge-base/specs/2026-10-24-bowerloom-0-8-spec.md')].filter((p): p is string => p !== undefined);
  let spec: string | null = null;
  for (const path of specs) { try { spec = readFileSync(path, 'utf8'); break; } catch { /* not here */ } }
  if (spec === null) return;
  const claims: Record<string, RegExp[]> = {
    looking: [/two steps/, /approves each scan/, /reads no file contents/], originals: [/Adopt copies/, /original files stay unchanged until the user approves a cleanup/],
    writes: [/registered roots/, /interface folders the user approved/], 'preview-undo': [/previewed, versioned, and reversible/],
    'history-place': [/version history in its own data folder/, /works without git/], secrets: [/never stores a secret value/, /It never reads the value/],
    sharing: [/no secret values and no wiki page content/], opening: [/every secret the person must add/, /Nothing runs on import/],
    hooks: [/runs code with no prompt/, /never writes executable code of its own/], 'no-cloud': [/Cloud sharing, accounts, and sync/],
  };
  for (const [id, patterns] of Object.entries(claims)) for (const pattern of patterns) assert.match(spec, pattern, `${id}: the specification says ${pattern}`);
});

test('the open questions are the four the testers asked, in plain words, each at most 25 words, and none of them promises anything', () => {
  assert.deepEqual(NOT_DECIDED.map(q => q.id), ['network', 'history-who', 'signed', 'secret-check']);
  assert.deepEqual(NOT_DECIDED.map(q => q.text), [
    'Which network connections the app may make, and a list of them that you can read.',
    'Who made each entry in the version history, and on which device.',
    'Whether skills and agents from outside must be signed, and whether you can limit sources to a list you trust.',
    'Whether the app looks for secrets inside the text of your files, beyond checking the names of keys.',
  ]);
  for (const q of NOT_DECIDED) {
    assert.ok(countWords(q.text) <= 25, q.text); assert.equal(bannedIn(q.text), null, q.text);
    assert.doesNotMatch(q.text, /\b(will|always|never|guarantee|promise|safe)\b/i, 'a question that is open makes no promise');
  }
  // Where the history is kept is decided (the app's own data folder), so it is in the first list and not in the second.
  assert.ok(DECIDED.some(d => d.id === 'history-place'));
  assert.ok(!NOT_DECIDED.some(q => /where .*history|history .*stored|stored/i.test(q.text)));
});

test('the sheet is a labelled modal dialog with the two lists, the source on every statement, and the words in budget', () => {
  const m = html();
  assert.match(m, /role="dialog" aria-modal="true" aria-labelledby/);
  assert.match(m, /<h2 class="kit-heading"[^>]*>How it will work<\/h2>/);
  assert.deepEqual([...m.matchAll(/<h3 class="kit-heading"[^>]*>([^<]*)<\/h3>/g)].map(x => x[1]), ['What is decided', 'Not decided yet']);
  assert.equal([...m.matchAll(/data-statement="/g)].length, DECIDED.length);
  assert.equal([...m.matchAll(/data-source=""/g)].length, DECIDED.length, 'every statement shows its source');
  assert.equal([...m.matchAll(/<span>Decided in the plan<\/span>/g)].length, DECIDED.length);
  assert.equal([...m.matchAll(/data-open-question="/g)].length, NOT_DECIDED.length);
  assert.ok(m.indexOf('What is decided') < m.indexOf('Not decided yet'));
  assert.doesNotMatch(m.slice(m.indexOf('Not decided yet')), /Decided in the plan/, 'an open question has no source: nothing decided it');
  assert.deepEqual(assertTextBudget(m), []);
  assert.equal([...m.matchAll(/data-budget="paragraph"/g)].length, DECIDED.reduce((n, d) => n + d.paragraphs.length, 0) + NOT_DECIDED.length);
  assert.match(m, /<button[^>]*>Done<\/button>/);
  assert.match(m, /<button[^>]*aria-label="Close"/);
  assert.doesNotMatch(m, /<a [^>]*href|dangerouslySetInnerHTML|style=/);
  assert.match(html(true), /data-leaving=""/);
});

test('only the exact source line may say "plan"; anywhere else it is still a banned word', () => {
  assert.equal(bannedIn('Decided in the plan'), null);
  assert.equal(bannedIn('decided  in the plan'), null);
  assert.notEqual(bannedIn('Our plan for you'), null);
  assert.notEqual(bannedIn('The plan is decided'), null);
  assert.equal(HOW_WORDS.label.source, 'Decided in the plan');
  for (const text of Object.values(HOW_WORDS.label)) assert.ok(countWords(text) <= 5 && bannedIn(text) === null, text);
  for (const text of Object.values(HOW_WORDS.hint)) assert.ok(countWords(text) <= 12 && bannedIn(text) === null, text);
});

test('a paragraph budget lets 25 words through and no more, keeps the banned words, and does not widen a hint', () => {
  const twenty = Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ');
  assert.deepEqual(assertTextBudget(`<p data-budget="paragraph">${twenty}</p>`), []);
  assert.equal(assertTextBudget(`<p data-budget="paragraph">${twenty} extra</p>`).length, 1);
  assert.equal(assertTextBudget(`<p>${twenty}</p>`).length, 1, 'a hint outside a paragraph keeps twelve');
  assert.equal(assertTextBudget('<p data-budget="paragraph">We apply it.</p>').length, 1, 'a banned word is still found');
  assert.equal(assertTextBudget('<p data-budget="paragraph">We have a plan.</p>').length, 1, 'and so is "plan" by itself');
  assert.equal(assertTextBudget('<p data-budget="paragraph">The MCP way.</p>').length, 1, 'MCP is for a popover only');
  assert.deepEqual(extractText('<div data-budget="paragraph"><p>A b c.</p></div>').map(p => p.paragraph), [true]);
  assert.equal(assertTextBudget(`<div data-budget="paragraph"><button>${twenty}</button></div>`).length, 1, 'a button keeps five words');
});

test('the Preview popover carries the link as a quiet text button, and it says only what it said before', () => {
  const m = renderToStaticMarkup(createElement(HelpPopover, { pill: 'Preview', label: 'About this preview', text: 'This is a preview. It sends nothing, stores nothing, and writes nothing to your computer.', action: { label: HOW_WORDS.label.link, onAction: () => undefined, quiet: true }, defaultOpen: true }));
  assert.match(m, /<button[^>]*data-variant="text"[^>]*>How it will work<\/button>/);
  assert.doesNotMatch(m, /data-variant="primary"/);
  assert.deepEqual(assertTextBudget(m), []);
});

test('the style sheet of the sheet takes every size and colour from the tokens', () => {
  const css = readFileSync(join(DESKTOP, 'renderer/home/trust/how.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  for (const m of css.matchAll(/font-size\s*:\s*([^;]+);/g)) assert.match(m[1]!.trim(), /^var\(--hm-text-(base|small|heading|display)\)$/);
  assert.doesNotMatch(css, /border-radius\s*:\s*[^;]*(?:999|\d+(?:px|rem))/);
});
