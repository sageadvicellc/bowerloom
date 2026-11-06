// Which section the navigation marks as current. The pure rule and the observer wiring, with a fake IntersectionObserver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSection, navSections, watchSections } from '../src/nav-current.ts';

test('the first section in page order that is in the band is current, and none is current while no section is', () => {
  assert.equal(currentSection({}), null);
  assert.equal(currentSection({ app: true }), 'app');
  assert.equal(currentSection({ install: true, app: true }), 'app', 'page order decides, not the order of the events');
  assert.equal(currentSection({ app: false, install: false }), null);
});

test('the navigation can mark only anchors on this page, never Docs or Articles', () => {
  assert.deepEqual([...navSections], ['how-it-works', 'app', 'command-line', 'install']);
});

test('watching observes each section it can find, reports the current one on every change, and stops on cleanup', () => {
  const elements = { 'how-it-works': { id: 'how-it-works' }, app: { id: 'app' }, 'command-line': null, install: { id: 'install' } };
  const seen = [], observed = [];
  let callback, options, disconnected = 0;
  const stop = watchSections(id => elements[id], id => seen.push(id), (cb, opts) => { callback = cb; options = opts; return { observe: element => observed.push(element.id), disconnect: () => { disconnected += 1; } }; });
  assert.deepEqual(observed, ['how-it-works', 'app', 'install'], 'a missing section is skipped');
  assert.equal(options.rootMargin, '-40% 0px -55% 0px', 'a thin band 40% down the screen');
  callback([{ target: elements.app, isIntersecting: true }]);
  callback([{ target: elements['how-it-works'], isIntersecting: true }]);
  callback([{ target: elements.app, isIntersecting: false }, { target: elements['how-it-works'], isIntersecting: false }]);
  assert.deepEqual(seen, ['app', 'how-it-works', null]);
  stop();
  assert.equal(disconnected, 1);
});
