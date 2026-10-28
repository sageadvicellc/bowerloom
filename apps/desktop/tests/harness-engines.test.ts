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

// ---- Review of e1bbce9: I4 and CR6.
import { hasWriter, noWriterWords } from '../shared/harness/types.js';
import { libraryCounts } from '../shared/harness/status.js';
import { bannedHere, LIMITS, countWords } from '../shared/harness/words.js';

test('I4. OpenCode has no writer yet, and the words say it is not written yet', () => {
  assert.deepEqual(INTERFACE_IDS.filter(hasWriter), ['claude-code', 'codex']);
  const words = noWriterWords('OpenCode');
  assert.match(words, /^Not written yet\./); assert.match(words, /OpenCode/);
  assert.equal(bannedHere(words), null);
  assert.ok(countWords(words) <= LIMITS.paragraph, `${countWords(words)} words`);
});

test('CR6. the sample world has no Hermes source, agent or skill, and the Library counts follow', () => {
  const world = createSampleWorld();
  assert.deepEqual(world.sources.map(s => s.id), ['src-caveman', 'src-claude', 'src-codex']);
  assert.equal(world.parts.some(p => p.origin === 'src-hermes'), false);
  assert.equal(world.parts.some(p => p.name === 'Note taker'), false);
  assert.deepEqual(libraryCounts(world), { agent: 12, skill: 41, tool: 2, context: 3 });
});
