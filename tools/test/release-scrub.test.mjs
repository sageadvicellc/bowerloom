import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubUrls } from '../../scripts/release.mjs';

test('scrubUrls masks schemed URLs, user and token included, and keeps the words around them', () => {
  const user = ['ali', 'ce'].join('');
  const secret = ['tok', 'en', 'value'].join('');
  const out = scrubUrls(`fatal: unable to access 'https://${user}:${secret}@host.example/x': failed`);
  assert.ok(out.includes('[url]') && out.includes('fatal: unable to access'), out);
  assert.ok(!out.includes(secret) && !out.includes(user) && !out.includes('host.example'), out);
});

test('scrubUrls finishes fast on a very long run of scheme characters with no ://', () => {
  const started = Date.now();
  const out = scrubUrls('a.'.repeat(250_000));
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.equal(out.length, 500_000);
});

test('scrubUrls still masks a URL that follows a long scheme-like run', () => {
  const out = scrubUrls('a.'.repeat(5000) + 'https://example.com/path');
  assert.ok(out.includes('[url]') && !out.includes('example.com'));
});
