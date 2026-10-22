// Spec 05, section 10.7: the token estimate and its number formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, ratioPpm, formatThousands, formatPercent, parseBytesPerToken } from '../../../dist/packages/context-slices/src/estimate.js';

test('1. estimateTokens(10, 4000) is 3', () => assert.equal(estimateTokens(10, 4000), 3));
test('2. estimateTokens(0, 4000) is 0', () => assert.equal(estimateTokens(0, 4000), 0));
test('3. estimateTokens(7, 3500) is 2', () => assert.equal(estimateTokens(7, 3500), 2));
test('4. ratioPpm floors', () => { assert.equal(ratioPpm(1, 3), 333333); assert.equal(ratioPpm(2, 3), 666666); assert.equal(ratioPpm(1, 0), 0); assert.equal(ratioPpm(5, 5), 1000000); });
test('5. formatThousands(2848912) is 2,848.9k', () => { assert.equal(formatThousands(2848912), '2,848.9k'); assert.equal(formatThousands(0), '0.0k'); assert.equal(formatThousands(999), '0.9k'); assert.equal(formatThousands(15200), '15.2k'); });
test('6. formatPercent(8512) is 0.85%', () => { assert.equal(formatPercent(8512), '0.85%'); assert.equal(formatPercent(1000000), '100.00%'); assert.equal(formatPercent(0), '0.00%'); });
test('parseBytesPerToken takes 1.0 to 10.0 and returns thousandths', () => {
  assert.equal(parseBytesPerToken('3.5'), 3500); assert.equal(parseBytesPerToken('1'), 1000); assert.equal(parseBytesPerToken('10.0'), 10000);
  for (const bad of ['0.9', '10.1', 'abc', '', '3.5x', '-4', '1e1', '3.5555']) assert.equal(parseBytesPerToken(bad), null, bad);
});
test('integer math handles large byte counts', () => { assert.equal(estimateTokens(11301404, 4000), 2825351); });
