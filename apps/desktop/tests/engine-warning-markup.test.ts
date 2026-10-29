// The result of a write shows a warning in words (fix item 7): approval drafts that could not be cleared are said, and a result with none shows none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultStep } from '../renderer/harness/sheets/engine-parts.js';

const WARNING = 'approval drafts not cleared (EACCES); run bowerloom harness status';

test('a result step shows each warning as a status line, after the lists', () => {
  const html = renderToStaticMarkup(createElement(ResultStep, { nothing: false, lists: [{ title: 'Written', files: ['AGENTS.md'] }], warnings: [WARNING] }));
  assert.ok(html.includes(WARNING));
  assert.match(html, /role="status"[^>]*data-warning/);
  assert.ok(html.indexOf('AGENTS.md') < html.indexOf(WARNING));
});

test('a result step with no warning shows no status line', () => {
  const html = renderToStaticMarkup(createElement(ResultStep, { nothing: true, lists: [] }));
  assert.doesNotMatch(html, /data-warning/);
});
