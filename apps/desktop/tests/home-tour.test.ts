// The guided tour engine: the pure state machine, the once-per-session switch, the seven steps, and where the popover sits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTour, createTourSession, currentStep, intersects, isFirst, isLast, placePopover, progressText, sentenceOf, tourReduce, replayTour, skipTour, startTour, stepBack, stepNext, spotlightBox } from '../renderer/home/tour/tour.js';
import type { Box, TourState, TourStep } from '../renderer/home/tour/tour.js';
import { TOUR_STEPS, TOUR_TARGETS } from '../renderer/home/tour/steps.js';
import { assertTextBudget, countWords } from '../shared/home/textbudget.js';

const steps: TourStep[] = [{ id: 'a', target: 'a', text: 'One.' }, { id: 'b', target: 'b', text: 'Two.' }, { id: 'c', target: 'c', text: 'Three.' }];
const running = (): TourState => startTour(createTour(steps));

test('a new tour is idle on its first step and has no current step', () => {
  const t = createTour(steps);
  assert.deepEqual({ index: t.index, status: t.status }, { index: 0, status: 'idle' });
  assert.equal(currentStep(t), null);
  assert.equal(progressText(t), 'Step 1 of 3');
});

test('start runs the tour from step one; next and back walk it', () => {
  let t = running();
  assert.equal(t.status, 'running'); assert.equal(currentStep(t)?.id, 'a'); assert.equal(isFirst(t), true); assert.equal(isLast(t), false);
  t = stepNext(t); assert.equal(currentStep(t)?.id, 'b'); assert.equal(progressText(t), 'Step 2 of 3'); assert.equal(isFirst(t), false);
  t = stepNext(t); assert.equal(currentStep(t)?.id, 'c'); assert.equal(isLast(t), true);
  t = stepBack(t); assert.equal(currentStep(t)?.id, 'b');
  t = stepBack(t); assert.equal(currentStep(t)?.id, 'a');
  assert.equal(stepBack(t), t, 'back on the first step changes nothing');
});

test('next on the last step finishes the tour; a finished tour shows no step', () => {
  let t = running(); t = stepNext(stepNext(t));
  const done = stepNext(t);
  assert.equal(done.status, 'finished'); assert.equal(currentStep(done), null);
  assert.equal(stepNext(done), done); assert.equal(stepBack(done), done);
});

test('skip ends the tour from any step, once, and only a running tour can be skipped', () => {
  const t = stepNext(running());
  const s = skipTour(t);
  assert.equal(s.status, 'skipped'); assert.equal(currentStep(s), null);
  assert.equal(skipTour(s), s); assert.equal(skipTour(createTour(steps)).status, 'idle');
  assert.equal(stepNext(s), s);
});

test('replay starts again at step one from a finished or a skipped tour', () => {
  const finished = stepNext(stepNext(stepNext(running())));
  for (const from of [finished, skipTour(running()), createTour(steps)]) {
    const r = replayTour(from); assert.equal(r.status, 'running'); assert.equal(r.index, 0); assert.equal(currentStep(r)?.id, 'a');
  }
  const midway = stepNext(running());
  assert.equal(replayTour(midway).index, 0);
});

test('the machine never changes its input', () => {
  const t = running(); const before = JSON.stringify(t);
  stepNext(t); stepBack(t); skipTour(t); replayTour(t);
  assert.equal(JSON.stringify(t), before);
  assert.throws(() => { (t as { index: number }).index = 5; }, TypeError, 'a state is frozen');
});

test('a tour with no steps finishes at once and never crashes', () => {
  const t = startTour(createTour([]));
  assert.equal(currentStep(t), null); assert.equal(stepNext(t).status, 'finished'); assert.equal(progressText(t), 'Step 0 of 0');
});

test('the session runs the tour on its own once, and only once', () => {
  const session = createTourSession();
  assert.equal(session.claimAutoStart(), true); assert.equal(session.claimAutoStart(), false); assert.equal(session.claimAutoStart(), false);
  assert.equal(createTourSession().claimAutoStart(), true, 'another session starts fresh');
});

test('the seven steps are the storyboard steps and "Share and history", in order, one sentence of at most 12 words each', () => {
  assert.deepEqual(TOUR_STEPS.map(s => s.target), ['map', 'agent', 'details', 'add', 'save', 'share', 'help']);
  assert.deepEqual(TOUR_STEPS.map(s => s.id), ['map', 'agent', 'details', 'add', 'save', 'share', 'help'], 'the ids of the six old steps are kept');
  assert.deepEqual([...TOUR_TARGETS], ['map', 'agent', 'details', 'add', 'save', 'share', 'help']);
  assert.deepEqual(TOUR_STEPS.map(s => s.text), [
    'These are your AI agents, from every tool.', 'Click an agent to see what it can do.', 'Skills show what the agent you picked can do.',
    'Add skills, tools, and notes here.', 'This bar shows your changes. Press Save to keep them.', 'Share your agents or go back in time here.', 'Replay this tour any time.',
  ]);
  for (const s of TOUR_STEPS) { assert.ok(countWords(s.text) <= 12, s.text); assert.equal((s.text.match(/[.!?]/g) ?? []).length, s.id === 'save' ? 2 : 1, s.id === 'save' ? 'Hanna set the bar step as two short sentences (2026-10-25)' : 'one sentence'); assert.deepEqual(assertTextBudget(`<p>${s.text}</p>`), []); }
  assert.equal(new Set(TOUR_STEPS.map(s => s.id)).size, 7);
  assert.equal(Object.isFrozen(TOUR_STEPS), true);
});

// ---- Where the popover goes.
const viewport = { w: 1000, h: 700 }, pop = { w: 300, h: 140 };
const inside = (b: Box, v = viewport): boolean => b.x >= 0 && b.y >= 0 && b.x + b.w <= v.w && b.y + b.h <= v.h;
const boxOf = (p: { x: number; y: number }): Box => ({ x: p.x, y: p.y, w: pop.w, h: pop.h });

test('intersects is true only when two boxes share area', () => {
  assert.equal(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), true);
  assert.equal(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false, 'touching edges do not count');
  assert.equal(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 50, w: 1, h: 1 }), false);
});

test('the popover goes below a target when there is room, above when there is not', () => {
  const top = placePopover({ x: 400, y: 50, w: 100, h: 40 }, pop, viewport);
  assert.equal(top.side, 'bottom'); assert.ok(top.y >= 90);
  const low = placePopover({ x: 400, y: 600, w: 100, h: 40 }, pop, viewport);
  assert.equal(low.side, 'top'); assert.ok(low.y + pop.h <= 600);
  for (const p of [top, low]) assert.equal(inside(boxOf(p)), true);
});

test('a wide target pushes the popover to the side that is free', () => {
  const target = { x: 0, y: 60, w: 640, h: 640 };
  const p = placePopover(target, pop, viewport);
  assert.equal(p.side, 'right'); assert.equal(intersects(boxOf(p), target), false); assert.equal(inside(boxOf(p)), true);
});

test('a target at the right edge puts the popover on its left, and the popover stays on the screen', () => {
  const target = { x: 700, y: 20, w: 300, h: 660 };
  const p = placePopover(target, pop, viewport);
  assert.equal(p.side, 'left'); assert.equal(intersects(boxOf(p), target), false); assert.equal(inside(boxOf(p)), true);
});

test('with no target, or none that can be found, the popover is centered', () => {
  const p = placePopover(null, pop, viewport);
  assert.equal(p.side, 'center'); assert.equal(p.x, (viewport.w - pop.w) / 2); assert.equal(p.y, (viewport.h - pop.h) / 2);
});

test('when the target fills the screen the popover still stays inside it', () => {
  const p = placePopover({ x: 0, y: 0, w: 1000, h: 700 }, pop, viewport);
  assert.equal(inside(boxOf(p)), true);
});

test('over many targets the popover never covers its target while any free place exists, and always stays on the screen', () => {
  let seed = 12345;
  const rand = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let checked = 0;
  for (let i = 0; i < 400; i += 1) {
    const w = 20 + rand(700), h = 20 + rand(500);
    const target = { x: rand(viewport.w - w + 1), y: rand(viewport.h - h + 1), w, h };
    const p = placePopover(target, pop, viewport), b = boxOf(p);
    assert.equal(inside(b), true, JSON.stringify(target));
    const free = intersects(b, target) === false;
    if (!free) {
      // No free place was left: the target is so large that every spot around it is too small.
      const gap = 12;
      const fits = target.y - gap >= pop.h + 12 || viewport.h - (target.y + target.h) - gap >= pop.h + 12 || target.x - gap >= pop.w + 12 || viewport.w - (target.x + target.w) - gap >= pop.w + 12;
      assert.equal(fits, false, `a free place existed for ${JSON.stringify(target)}`);
    } else checked += 1;
  }
  assert.ok(checked > 200, `${checked} free placements`);
});

test('spotlightBox pads the target and keeps the result inside the screen', () => {
  assert.deepEqual(spotlightBox({ x: 100, y: 100, w: 50, h: 20 }, viewport, 6), { x: 94, y: 94, w: 62, h: 32 });
  assert.deepEqual(spotlightBox({ x: 0, y: 0, w: 50, h: 20 }, viewport, 6), { x: 0, y: 0, w: 56, h: 26 });
  assert.deepEqual(spotlightBox({ x: 950, y: 690, w: 100, h: 50 }, viewport, 6), { x: 944, y: 684, w: 56, h: 16 });
});

test('tourReduce maps each action to its function, and start only starts a tour that has not started', () => {
  let t = createTour(steps);
  t = tourReduce(t, 'start'); assert.equal(t.status, 'running');
  t = tourReduce(t, 'next'); assert.equal(t.index, 1);
  assert.equal(tourReduce(t, 'start'), t, 'start does not restart a tour that is under way');
  t = tourReduce(t, 'back'); assert.equal(t.index, 0);
  t = tourReduce(t, 'skip'); assert.equal(t.status, 'skipped');
  assert.equal(tourReduce(t, 'start'), t, 'a skipped tour is not started again by start');
  t = tourReduce(t, 'replay'); assert.equal(t.status, 'running'); assert.equal(t.index, 0);
});

test('a target that leaves only a narrow strip gets a narrower popover in that strip, and never when a full one fits', () => {
  const wide = { x: 32, y: 170, w: 520, h: 724 };
  const strip = placePopover(wide, { w: 368, h: 200 }, { w: 900, h: 600 }, 12, 12, 280);
  assert.equal(strip.side, 'right'); assert.ok(strip.w !== undefined && strip.w >= 280 && strip.w < 368);
  assert.equal(strip.x + strip.w!, 900 - 12); assert.ok(strip.x >= wide.x + wide.w + 12);
  assert.equal(placePopover(wide, { w: 368, h: 200 }, { w: 900, h: 600 }).w, undefined, 'without a minimum width nothing is narrowed');
  assert.equal(placePopover({ x: 0, y: 60, w: 300, h: 100 }, { w: 368, h: 200 }, { w: 1440, h: 900 }, 12, 12, 280).w, undefined, 'a full popover that fits is not narrowed');
  const tooNarrow = placePopover({ x: 0, y: 0, w: 700, h: 700 }, { w: 368, h: 200 }, { w: 900, h: 700 }, 12, 12, 280);
  assert.equal(tooNarrow.w, undefined, 'a strip under the minimum is not used');
  const left = placePopover({ x: 360, y: 0, w: 540, h: 700 }, { w: 368, h: 200 }, { w: 900, h: 700 }, 12, 12, 280);
  assert.equal(left.side, 'left'); assert.ok(left.x + left.w! <= 360 - 12 + 0.5);
});

// ---- U3: a step that waits for the person to do the thing it points at.
import { hintOf, isWaiting, stepActed } from '../renderer/home/tour/tour.js';

const waitSteps: TourStep[] = [{ id: 'a', target: 'a', text: 'One.' }, { id: 'b', target: 'b', text: 'Click one.', wait: true, hint: 'Click any agent.' }, { id: 'c', target: 'c', text: 'Three.' }];
const waiting = (): TourState => stepNext(startTour(createTour(waitSteps)));

test('a wait step is flagged and carries its own hint; an ordinary step is neither', () => {
  const t = startTour(createTour(waitSteps));
  assert.equal(isWaiting(t), false); assert.equal(hintOf(t), null);
  const w = waiting();
  assert.equal(currentStep(w)?.id, 'b'); assert.equal(isWaiting(w), true); assert.equal(hintOf(w), 'Click any agent.');
  assert.equal(isWaiting(createTour(waitSteps)), false, 'an idle tour waits for nothing');
  assert.equal(isWaiting(skipTour(w)), false); assert.equal(hintOf(skipTour(w)), null);
});

test('the person\'s action moves a waiting tour on, and does nothing to a tour that is not waiting', () => {
  const next = stepActed(waiting());
  assert.equal(currentStep(next)?.id, 'c'); assert.equal(next.status, 'running');
  const first = startTour(createTour(waitSteps));
  assert.equal(stepActed(first), first, 'a click on an agent at step one is not the step\'s action');
  assert.equal(stepActed(next), next);
  assert.equal(stepActed(createTour(waitSteps)).status, 'idle');
});

test('a wait step on the last step finishes the tour when it is done', () => {
  const t = stepNext(startTour(createTour([{ id: 'a', target: 'a', text: 'One.' }, { id: 'b', target: 'b', text: 'Two.', wait: true, hint: 'Click.' }])));
  assert.equal(stepActed(t).status, 'finished');
});

test('Back still works from a wait step and from the step after it, and the machine\'s own Next lets a caller skip a wait', () => {
  const w = waiting();
  assert.equal(currentStep(stepBack(w))?.id, 'a');
  assert.equal(currentStep(stepBack(stepActed(w)))?.id, 'b');
  assert.equal(isWaiting(stepBack(stepActed(w))), true, 'going back waits again');
  assert.equal(currentStep(stepNext(w))?.id, 'c');
});

test('the reducer has an "acted" action that does the same', () => {
  assert.equal(currentStep(tourReduce(waiting(), 'acted'))?.id, 'c');
  const first = startTour(createTour(waitSteps));
  assert.equal(tourReduce(first, 'acted'), first);
});

test('the real tour waits at step two for a click on an agent, with a hint that also names the keyboard, and no other step waits', () => {
  assert.deepEqual(TOUR_STEPS.map(s => s.wait === true), [false, true, false, false, false, false, false]);
  const step = TOUR_STEPS[1]!;
  assert.equal(step.target, 'agent'); assert.equal(step.hint, 'Click an agent, or select one and press Enter.');
  assert.ok(countWords(step.hint ?? '') <= 12); assert.deepEqual(assertTextBudget(`<p>${step.hint}</p>`), []);
  assert.ok(TOUR_STEPS.filter(s => s.wait !== true).every(s => s.hint === undefined));
});

// ---- Wave C: a card that keeps off more than its target.
test('a card keeps off the boxes it is asked to avoid, and every place it takes is inside the screen', () => {
  const small = { w: 900, h: 600 }, card = { w: 336, h: 150 };
  const panel = { x: 612, y: 52, w: 288, h: 500 }, picked = { x: 28, y: 150, w: 250, h: 92 };
  const plain = placePopover(panel, card, small, 12, 12, 280);
  assert.equal(intersects({ x: plain.x, y: plain.y, w: card.w, h: card.h }, picked), true, 'without the box to avoid, the card lands on the tile (the finding)');
  const p = placePopover(panel, card, small, 12, 12, 280, [picked]);
  const b = { x: p.x, y: p.y, w: p.w ?? card.w, h: card.h };
  assert.equal(intersects(b, panel), false); assert.equal(intersects(b, picked), false); assert.equal(inside(b, small), true);
  const big = { w: 1280, h: 800 };
  const wide = placePopover({ x: 960, y: 52, w: 320, h: 700 }, card, big, 12, 12, 280, [{ x: 28, y: 140, w: 250, h: 92 }]);
  const wb = { x: wide.x, y: wide.y, w: wide.w ?? card.w, h: card.h };
  assert.equal(intersects(wb, { x: 960, y: 52, w: 320, h: 700 }), false); assert.equal(intersects(wb, { x: 28, y: 140, w: 250, h: 92 }), false); assert.equal(inside(wb, big), true);
  assert.deepEqual(placePopover(panel, card, small, 12, 12, 280, []), plain, 'no boxes to avoid: the same place as before');
});

test('with no free place around a target, the avoid boxes never push the card off the screen', () => {
  const v = { w: 400, h: 300 };
  const p = placePopover({ x: 0, y: 0, w: 400, h: 300 }, { w: 300, h: 120 }, v, 12, 12, undefined, [{ x: 50, y: 50, w: 100, h: 100 }]);
  assert.equal(inside({ x: p.x, y: p.y, w: 300, h: 120 }, v), true);
});

test('only the third step keeps its card off an agent, and it names the picked tile', () => {
  assert.deepEqual(TOUR_STEPS.filter(s => s.avoid !== undefined).map(s => s.id), ['details']);
  assert.match(TOUR_STEPS[2]!.avoid ?? '', /data-selected/);
});

// ---- Wave E, group E: a tour that is short to read, says where you are, and never picks an agent in silence.
test('every sentence of the tour has at most ten words, the hint of the waiting step too, and the sentence that says the tour picked an agent', () => {
  for (const s of TOUR_STEPS) {
    assert.ok(countWords(s.text) <= 10, `${s.id}: ${s.text}`);
    if (s.hint !== undefined) assert.ok(countWords(s.hint) <= 10, `${s.id} hint: ${s.hint}`);
    if (s.pickedText !== undefined) { assert.ok(countWords(s.pickedText) <= 10, `${s.id} picked: ${s.pickedText}`); assert.deepEqual(assertTextBudget(`<p>${s.pickedText}</p>`), []); }
  }
  const details = TOUR_STEPS.find(s => s.id === 'details')!;
  assert.match(details.text, /agent you picked/, 'a step that needs a pick says so');
  assert.match(details.pickedText ?? '', /^We picked an agent\./);
  assert.equal(sentenceOf(details, false), details.text);
  assert.equal(sentenceOf(details, true), details.pickedText);
  const plain = TOUR_STEPS.find(s => s.id === 'map')!;
  assert.equal(sentenceOf(plain, true), plain.text, 'a step with no second sentence says its own');
});

test('where the person is reads "Step 3 of 7", in words, on every step', () => {
  let t = startTour(createTour(TOUR_STEPS));
  for (let i = 1; i <= 7; i += 1) { assert.equal(progressText(t), `Step ${i} of 7`); t = stepNext(t); }
});

test('beside a large target with a box to avoid, the card narrows to fit between the box and the target instead of covering either', () => {
  const view = { w: 900, h: 600 }, pop = { w: 336, h: 190 };
  // The details panel at the right edge, the picked agent in the first column of the map to its left.
  const panel = { x: 612, y: 52, w: 288, h: 500 }, picked = { x: 28, y: 52, w: 250, h: 480 };
  // The picked agent leaves no height at which the full card clears it, so the card narrows.
  const wide = placePopover(panel, pop, view, 12, 12, 280, [picked]);
  assert.equal(wide.side, 'left');
  assert.ok(wide.w !== undefined && wide.w >= 280 && wide.w < pop.w, 'narrower than the full card');
  const box = { x: wide.x, y: wide.y, w: wide.w!, h: pop.h };
  assert.equal(intersects(box, panel), false); assert.equal(intersects(box, picked), false);
  assert.ok(box.x + box.w <= panel.x - 12 + 1, 'beside the panel');
  // With room for the full card it keeps its full width, still beside the panel, above or below the picked agent.
  const roomy = placePopover({ x: 960, y: 52, w: 320, h: 700 }, pop, { w: 1280, h: 800 }, 12, 12, 280, [{ x: 28, y: 120, w: 250, h: 92 }]);
  assert.equal(roomy.side, 'left'); assert.equal(roomy.w, undefined);
  assert.equal(intersects({ x: roomy.x, y: roomy.y, w: pop.w, h: pop.h }, { x: 28, y: 120, w: 250, h: 92 }), false);
  assert.ok(roomy.x + pop.w <= 960 - 12 + 1, 'beside the panel, not over it');
});
