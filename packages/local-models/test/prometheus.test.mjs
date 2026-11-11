// The Prometheus text parser reads only the metric names it is asked for, and only plain finite numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePrometheus } from '../../../dist/packages/local-models/src/prometheus.js';

const fixture = name => fs.readFileSync(fileURLToPath(new URL(`./fixtures/llama-server/${name}`, import.meta.url)), 'utf8');
const asObject = map => Object.fromEntries(map);

test('it reads the wanted names from the recorded idle metrics and ignores every other name', () => {
  const got = parsePrometheus(fixture('example-9b/metrics.txt'), ['llamacpp:n_tokens_max', 'llamacpp:requests_processing', 'llamacpp:predicted_tokens_seconds']);
  assert.deepEqual(asObject(got), { 'llamacpp:n_tokens_max': 0, 'llamacpp:requests_processing': 0, 'llamacpp:predicted_tokens_seconds': 0 });
});

test('it reads busy numbers, whole and fractional', () => {
  const got = parsePrometheus(fixture('derived/metrics-busy.txt'), ['llamacpp:n_tokens_max', 'llamacpp:requests_processing', 'llamacpp:requests_deferred', 'llamacpp:prompt_seconds_total', 'llamacpp:predicted_tokens_seconds']);
  assert.deepEqual(asObject(got), {
    'llamacpp:n_tokens_max': 2362, 'llamacpp:requests_processing': 1, 'llamacpp:requests_deferred': 2, 'llamacpp:prompt_seconds_total': 3.04, 'llamacpp:predicted_tokens_seconds': 40,
  });
});

test('a name that is not asked for is not in the result, and a name asked for that is absent is not in it either', () => {
  const got = parsePrometheus('a 1\nb 2\n', ['a', 'missing']);
  assert.deepEqual(asObject(got), { a: 1 });
  assert.equal(got.has('b'), false);
  assert.equal(got.has('missing'), false);
});

test('comments, blank lines and carriage returns are skipped', () => {
  const text = '# HELP a help text 9\n# TYPE a gauge\n\n   \r\na 5\r\n#a 7\n';
  assert.deepEqual(asObject(parsePrometheus(text, ['a'])), { a: 5 });
});

test('NaN, infinity, a number too large to hold, and words are dropped, never turned into a number', () => {
  const text = ['a NaN', 'b +Inf', 'c -Inf', 'd Inf', 'e 1e999', 'f abc', 'g 0x10', 'h 1_000', 'i', 'j  ', 'k 1,5', 'l --1'].join('\n');
  assert.deepEqual(asObject(parsePrometheus(text, 'abcdefghijkl'.split(''))), {});
});

test('scientific notation, a sign, a leading dot and a trailing dot are numbers', () => {
  const text = 'a 1.5e3\nb -2\nc +4\nd .5\ne 7.\nf 1E2\n';
  assert.deepEqual(asObject(parsePrometheus(text, 'abcdef'.split(''))), { a: 1500, b: -2, c: 4, d: 0.5, e: 7, f: 100 });
});

test('a timestamp after the value is allowed and ignored', () => {
  assert.deepEqual(asObject(parsePrometheus('a 3 1700000000000\n', ['a'])), { a: 3 });
});

test('a metric with labels is skipped: the server has none, and which series would count is not known', () => {
  assert.deepEqual(asObject(parsePrometheus('a{slot="0"} 3\na 4\n', ['a'])), { a: 4 });
  assert.deepEqual(asObject(parsePrometheus('a{slot="0"} 3\n', ['a'])), {});
});

test('a duplicate name keeps the first value', () => {
  assert.deepEqual(asObject(parsePrometheus('a 1\na 2\na 3\n', ['a'])), { a: 1 });
});

test('an unwanted name is never confused with a wanted one that it starts with', () => {
  assert.deepEqual(asObject(parsePrometheus('abc 9\nab 1\n', ['a', 'ab'])), { ab: 1 });
});

test('a name such as constructor or __proto__ is only data', () => {
  const got = parsePrometheus('constructor 1\n__proto__ 2\n', ['constructor', '__proto__']);
  assert.deepEqual(asObject(got), { constructor: 1, ['__proto__']: 2 });
  assert.equal(Object.getPrototypeOf({}).constructor, Object);
});

test('empty input and no wanted names give an empty result', () => {
  assert.equal(parsePrometheus('', ['a']).size, 0);
  assert.equal(parsePrometheus('a 1\n', []).size, 0);
});

test('1 MiB of junk is read quickly and gives nothing, and a very long line is skipped', () => {
  const junk = `${'x'.repeat(63)}\n`.repeat(16384);
  assert.ok(junk.length >= 1024 * 1024);
  const started = Date.now();
  assert.equal(parsePrometheus(junk, ['a']).size, 0);
  assert.equal(parsePrometheus(`a ${'9'.repeat(100000)}\na 2\n`, ['a']).get('a'), 2);
  assert.ok(Date.now() - started < 2000);
});

test('a non-string input gives an empty result and does not throw', () => {
  for (const input of [null, undefined, 5, {}, []]) assert.equal(parsePrometheus(input, ['a']).size, 0);
});
