// The spring solver and its CSS linear() output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPRINGS, describeSpring, peakOvershoot, settleTime, springPosition, toLinear } from '../src/spring.ts';
import { STAGGER_CAP, staggerDelay } from '../src/reveal.ts';

const parse = easing => {
  const match = /^linear\((.*)\)$/.exec(easing);
  assert.ok(match, `not a linear() function: ${easing}`);
  return match[1].split(',').map(part => Number(part.trim()));
};

test('every spring starts at 0 and settles to 1 within tolerance', () => {
  for (const [name, spring] of Object.entries(SPRINGS)) {
    assert.equal(springPosition(spring, 0), 0, name);
    const settle = settleTime(spring);
    assert.ok(settle > 0.2 && settle < 1.2, `${name} settles in ${settle} s`);
    assert.ok(Math.abs(springPosition(spring, settle + 0.5) - 1) < 0.003, `${name} rests at 1`);
    assert.ok(Math.abs(springPosition(spring, 10) - 1) < 1e-6, `${name} is at 1 after 10 s`);
  }
});

test('the three damping cases (under, critical, over) all converge to 1', () => {
  for (const damping of [8, 2 * Math.sqrt(100), 40]) assert.ok(Math.abs(springPosition({ mass: 1, stiffness: 100, damping }, 6) - 1) < 1e-3, `damping ${damping}`);
});

test('the soft spring overshoots by 3 to 6 percent, and the text spring by less than 1 percent', () => {
  const soft = peakOvershoot(SPRINGS.soft);
  assert.ok(soft >= 0.03 && soft <= 0.06, `soft overshoot is ${soft}`);
  assert.ok(peakOvershoot(SPRINGS.text) < 0.01, 'text overshoot');
  assert.equal(peakOvershoot({ mass: 1, stiffness: 100, damping: 40 }), 0, 'an overdamped spring never overshoots');
});

test('linear() output is valid: numbers only, starts at 0, ends at 1, and the soft curve passes above 1', () => {
  for (const spring of Object.values(SPRINGS)) {
    const values = parse(toLinear(spring));
    assert.ok(values.length >= 10);
    assert.ok(values.every(Number.isFinite));
    assert.equal(values[0], 0);
    assert.equal(values.at(-1), 1);
  }
  assert.ok(Math.max(...parse(toLinear(SPRINGS.soft))) > 1);
  assert.ok(Math.max(...parse(toLinear(SPRINGS.text))) < 1.01);
});

test('the duration comes from the settle time', () => {
  for (const spring of Object.values(SPRINGS)) assert.equal(describeSpring(spring).durationMs, Math.round(settleTime(spring) * 1000));
  assert.ok(describeSpring(SPRINGS.soft).durationMs > describeSpring(SPRINGS.text).durationMs, 'the soft spring is the slower one');
});

test('the stagger is 60 ms apart and stops after six items', () => {
  assert.deepEqual([0, 1, 2].map(staggerDelay), [0, 60, 120]);
  assert.equal(staggerDelay(5), 300);
  assert.equal(staggerDelay(6), 300);
  assert.equal(staggerDelay(40), 300);
  assert.equal(STAGGER_CAP, 6);
});
