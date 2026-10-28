// Step 0 of Bowerloom 0.8: the first engine set of the harness-first preview. Hermes is not an engine of 0.8, so the preview offers Claude Code, Codex and OpenCode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INTERFACE_IDS } from '../shared/harness/types.js';
import { createSampleWorld } from '../shared/harness/sample.js';
import { agentFileOf, skillFileOf } from '../shared/harness/files.js';

test('the first engine set of the preview is Claude Code, Codex and OpenCode, in that order', () => {
  assert.deepEqual([...INTERFACE_IDS], ['claude-code', 'codex', 'opencode']);
  assert.equal((INTERFACE_IDS as readonly string[]).includes('hermes'), false);
});

test('the sample world offers those three engines and no part names Hermes as an engine that cannot use it', () => {
  const world = createSampleWorld();
  assert.deepEqual(world.interfaces.map(i => i.id), ['claude-code', 'codex', 'opencode']);
  assert.deepEqual(world.interfaces.map(i => i.name), ['Claude Code', 'Codex', 'OpenCode']);
  for (const part of world.parts) assert.equal((part.cannotUse as readonly string[]).includes('hermes'), false, part.id);
});

test('a harness is installed under the folders of the three engines only', () => {
  for (const id of INTERFACE_IDS) { assert.match(agentFileOf(id, 'helper'), /\/agents\//); assert.match(skillFileOf(id, 'helper'), /\/skills\/helper\/SKILL\.md$/); }
});
