import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the v2 guard map names v1 transaction.ts lines that hold the functions it lists', () => {
  const v2 = fs.readFileSync('packages/managed-skills/src/v2-transaction.ts', 'utf8'), v1 = fs.readFileSync('packages/managed-skills/src/transaction.ts', 'utf8').split('\n');
  const map = v2.slice(v2.indexOf('Guard map, v1 transaction.ts line'), v2.indexOf('*/'));
  const entries = [...map.matchAll(/^ \* - (\d+)(?:-(\d+))? `(\w+)`/gm)];
  assert.ok(entries.length >= 20, 'the map lists the v1 functions');
  for (const [, start, end, name] of entries) {
    const at = Number(start), last = end === undefined ? at : Number(end);
    assert.match(v1[at - 1] ?? '', new RegExp(`(?:function|const) ${name}\\b`), `${name} starts at v1 line ${at}`);
    assert.ok(last >= at && last <= v1.length, `${name} range ${at}-${last}`);
  }
  for (let i = 1; i < entries.length; i++) assert.ok(Number(entries[i]![1]) > Number(entries[i - 1]![2] ?? entries[i - 1]![1]), `entry ${entries[i]![3]} follows the one before`);
});
