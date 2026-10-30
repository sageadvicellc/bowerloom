// The result of "Finish a stopped harness": when the harness does not load after the recovery, the window says so and lists the files to check by hand,
// instead of reporting success over a broken harness. Drawn as markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecoveredResult } from '../renderer/harness/sheets/AdoptSheet.js';
import { ENGINE_WORDS } from '../renderer/harness/words-engine.js';

const base = { removed: [], restored: ['.bowerloom/agents/reader.md'], kept: [], leftFolders: [] };

test('a recovery after which the harness loads shows the files and no warning', () => {
  const html = renderToStaticMarkup(createElement(RecoveredResult, { kind: 'save', done: { ...base, revision: `sha256:${'a'.repeat(64)}`, check: [] } }));
  assert.ok(html.includes('.bowerloom/agents/reader.md'));
  assert.doesNotMatch(html, /data-not-loading/);
});

test('a save or merge recovery after which the harness does not load says so, and lists each file to check', () => {
  for (const kind of ['save', 'merge'] as const) {
    const html = renderToStaticMarkup(createElement(RecoveredResult, { kind, done: { ...base, kept: ['.bowerloom/agents/reader.md'], revision: null, check: ['.bowerloom/agents/reader.md', '.bowerloom/harness.json'] } }));
    assert.match(html, /data-not-loading=""/, kind);
    assert.ok(html.includes(ENGINE_WORDS.hint.notLoading), kind);
    assert.match(html, /data-check-file="\.bowerloom\/harness\.json"/, kind);
    assert.match(html, /data-check-file="\.bowerloom\/agents\/reader\.md"/, kind);
  }
});

test('an adoption taken back leaves no harness: that is no warning, unless files are left to check', () => {
  const gone = renderToStaticMarkup(createElement(RecoveredResult, { kind: 'adoption', done: { ...base, restored: [], removed: ['.bowerloom/harness.json'], revision: null, check: [] } }));
  assert.doesNotMatch(gone, /data-not-loading/);
  const left = renderToStaticMarkup(createElement(RecoveredResult, { kind: 'adoption', done: { ...base, restored: [], revision: null, check: ['.bowerloom/skills/x/SKILL.md'] } }));
  assert.match(left, /data-not-loading=""/);
});
