// The tour of the harness-first window, ported from the home tour: the machine walks the seven steps (the six of section 9 and "What next"), the step that
// builds the keeper waits for the person and still lets Next move on, the card never covers its target while a free place exists, and the card's markup
// carries the sentence, the hint of a waiting step, the three ideas of the last step, and words for where the person is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createTour, currentStep, intersects, isWaiting, nextStepId, placePopover, progressText, spotlightBox, startTour, stepActed, stepBack, stepNext, tourReduce,
} from '../renderer/harness/tour/tour.js';
import { TourCard } from '../renderer/harness/tour/TourOverlay.js';
import { NEXT_IDEAS, NOTES, TOUR_STEPS } from '../renderer/harness/words-notes.js';

const noop = (): void => undefined;
const at = (index: number) => { let t = startTour(createTour(TOUR_STEPS)); for (let i = 0; i < index; i += 1) t = stepNext(t); return t; };

test('the tour is idle until started, then walks its seven steps in order and finishes on the last Next', () => {
  const idle = createTour(TOUR_STEPS);
  assert.equal(currentStep(idle), null);
  let t = startTour(idle);
  const seen: string[] = [];
  while (t.status === 'running') { seen.push(currentStep(t)!.id); t = stepNext(t); }
  assert.deepEqual(seen, ['map', 'notes', 'keeper', 'shelves', 'save', 'help', 'next']);
  assert.equal(t.status, 'finished');
  assert.equal(stepBack(at(0)).index, 0);
  assert.equal(tourReduce(t, 'replay').index, 0);
  assert.equal(tourReduce(t, 'replay').status, 'running');
  assert.equal(tourReduce(at(2), 'skip').status, 'skipped');
  assert.equal(progressText(at(2)), 'Step 3 of 7');
});

test('the keeper step is next after the notes step, so the window adds the keeper before it lights it', () => {
  assert.equal(nextStepId(at(1)), 'keeper');
  assert.equal(nextStepId(at(6)), null, 'Done ends the tour');
  assert.equal(nextStepId(createTour(TOUR_STEPS)), null, 'a tour that has not started goes nowhere');
});

test('only the shelves step waits; the build moves it on, and Next still does', () => {
  assert.deepEqual(TOUR_STEPS.map((_, i) => isWaiting(at(i))), [false, false, false, true, false, false, false]);
  assert.equal(currentStep(stepActed(at(3)))!.id, 'save');
  assert.equal(currentStep(stepActed(at(2)))!.id, 'keeper', 'a build outside the waiting step moves nothing');
  assert.equal(currentStep(stepNext(at(3)))!.id, 'save');
});

test('the card goes beside its target and never covers it while a free place exists; with no target it is centered', () => {
  const view = { w: 1280, h: 800 }, pop = { w: 336, h: 180 };
  const target = { x: 300, y: 200, w: 400, h: 200 };
  const below = placePopover(target, pop, view);
  assert.equal(below.side, 'bottom');
  assert.equal(intersects({ x: below.x, y: below.y, ...pop }, target), false);
  const low = placePopover({ x: 300, y: 600, w: 400, h: 150 }, pop, view);
  assert.equal(low.side, 'top');
  assert.deepEqual(placePopover(null, pop, view), { x: 472, y: 310, side: 'center' });
  for (let x = 0; x < view.w; x += 97) for (let y = 0; y < view.h; y += 83) {
    const t = { x, y, w: 180, h: 120 }, p = placePopover(t, pop, view, 12, 12, 256);
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + (p.w ?? pop.w) <= view.w && p.y + pop.h <= view.h, `${x},${y} stays on screen`);
  }
  assert.deepEqual(spotlightBox({ x: 2, y: 2, w: 10, h: 10 }, view), { x: 0, y: 0, w: 18, h: 18 });
});

test('the card: the sentence, Skip, Back from step two, Next, and "Step n of 7" in words', () => {
  const html = renderToStaticMarkup(createElement(TourCard, { state: at(1), onNext: noop, onBack: noop, onSkip: noop }));
  assert.match(html, /data-tour-step="notes"/);
  assert.ok(html.includes('Your notes are what your agents can read.'));
  assert.ok(html.includes(NOTES.label.tourSkip)); assert.ok(html.includes(NOTES.label.tourBack)); assert.ok(html.includes(NOTES.label.tourNext));
  assert.ok(html.includes('Step 2 of 7'));
  assert.doesNotMatch(renderToStaticMarkup(createElement(TourCard, { state: at(0), onNext: noop, onBack: noop, onSkip: noop })), />Back</);
});

test('the waiting step shows what to do next, and only that step does', () => {
  const html = renderToStaticMarkup(createElement(TourCard, { state: at(3), hint: 'Drag add-source onto Skills, or press its Add button.', onNext: noop, onBack: noop, onSkip: noop }));
  assert.match(html, /data-wait=""/);
  assert.match(html, /data-tour-hint="">Drag add-source onto Skills/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(TourCard, { state: at(2), hint: 'x', onNext: noop, onBack: noop, onSkip: noop })), /data-tour-hint/);
});

test('What next: centered, with the three ideas, where Help lives, and Done', () => {
  const html = renderToStaticMarkup(createElement(TourCard, { state: at(6), onNext: noop, onBack: noop, onSkip: noop }));
  assert.match(html, /data-centered=""/);
  for (const idea of NEXT_IDEAS) assert.ok(html.includes(idea), idea);
  assert.ok(html.includes(NOTES.hint.helpLives));
  assert.ok(html.includes(`>${NOTES.label.tourDone}<`));
  // A finished tour draws nothing.
  assert.equal(renderToStaticMarkup(createElement(TourCard, { state: stepNext(at(6)), onNext: noop, onBack: noop, onSkip: noop })), '');
});
