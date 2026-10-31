// The place of a found file: the settings folder that holds it, or the cache of a library. Pure: it reads the path and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeIdOf } from '../shared/world/scan-places.js';
import { generateWorld } from '../shared/world/sample.js';
import type { FoundAt } from '../shared/world/types.js';
import { found } from './testworld.js';

const at = (face: FoundAt['interface'], path: string): string => placeIdOf(found(face, path, 'text'));

test('a file inside a settings folder belongs to that folder', () => {
  assert.equal(at('claude-code', '/Users/sample/Studio/.claude/skills/review/SKILL.md'), '/Users/sample/Studio/.claude');
  assert.equal(at('codex', '/Users/sample/Studio/.codex/agents/planner.toml'), '/Users/sample/Studio/.codex');
  assert.equal(at('opencode', '/Users/sample/Studio/reedmarsh/.opencode/agent/a.md'), '/Users/sample/Studio/reedmarsh/.opencode');
});

test('a file beside the settings folder belongs to the folder of its program', () => {
  assert.equal(at('claude-code', '/Users/sample/Studio/.mcp.json'), '/Users/sample/Studio/.claude');
  assert.equal(at('opencode', '/Users/sample/Studio/opencode.json'), '/Users/sample/Studio/.opencode');
});

test('an older Bowerloom layout is a place of its own', () => {
  assert.equal(at('claude-code', '/Users/sample/Studio/.bowerloom/skills/old/SKILL.md'), '/Users/sample/Studio/.bowerloom');
  assert.equal(at('claude-code', '/Users/sample/Studio/.bowerloom-store/skills/old/SKILL.md'), '/Users/sample/Studio/.bowerloom-store');
});

test('the files of one library version share one place, the cache folder of that version', () => {
  assert.equal(at('claude-code', '/Users/sample/.cache/evergreen-kit/2.3.0/agents/a1.md'), '/Users/sample/.cache/evergreen-kit/2.3.0');
  assert.equal(at('claude-code', '/Users/sample/.cache/evergreen-kit/2.3.0/agents/deep/a2.md'), '/Users/sample/.cache/evergreen-kit/2.3.0');
});

test('every found file of the sample has a place, the same file always gets the same one, and the sample has several places', () => {
  const world = generateWorld(1), places = new Set<string>();
  for (const item of world.items) for (const f of item.foundAt) { const id = placeIdOf(f); assert.ok(id.length > 0, f.path); assert.equal(placeIdOf(f), id); places.add(id); }
  assert.ok(places.size > 3);
});
