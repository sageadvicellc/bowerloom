// The skip link must never turn real mode into the sample world: a window on a real page stays on it whatever the address becomes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { latchRealPage, realPageOf } from '../renderer/home/route-latch.js';

test('the two real addresses pick their page, and nothing else does', () => {
  assert.equal(realPageOf('#prototype-v2/real'), 'real');
  assert.equal(realPageOf('#prototype-v2/real-harness'), 'bare');
  for (const other of ['', '#main', '#prototype-v2', '#prototype-v2/map', '#prototype-v2/real/', '#prototype-v2/readonly', '#prototype-v2/kit']) assert.equal(realPageOf(other), null, other);
});

test('once on a real page, an address that is not a real page leaves the page as it is', () => {
  for (const hash of ['#main', '', '#prototype-v2', '#prototype-v2/map/readonly', '#prototype-v2/kit', '#prototype-v2/library', '#anything']) {
    assert.equal(latchRealPage('real', hash), 'real', `real after ${hash}`);
    assert.equal(latchRealPage('bare', hash), 'bare', `bare after ${hash}`);
  }
});

test('a real address still switches between the two real pages, and the sample window is not pulled anywhere by #main', () => {
  assert.equal(latchRealPage('real', '#prototype-v2/real-harness'), 'bare');
  assert.equal(latchRealPage('bare', '#prototype-v2/real'), 'real');
  assert.equal(latchRealPage(null, '#main'), null);
  assert.equal(latchRealPage(null, '#prototype-v2/real'), 'real');
});
