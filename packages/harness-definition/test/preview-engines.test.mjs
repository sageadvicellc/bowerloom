// Beta.1 supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness are preview engines: one list, one test, one switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_IDS, PREVIEW_ENGINES_ENV, PREVIEW_ENGINE_IDS, SUPPORTED_ENGINE_IDS, isPreviewEngine, previewEnginesAllowed,
} from '../../../dist/packages/harness-definition/src/index.js';

test('the preview engines are opencode, pi, and deepseek-harness; the others are supported', () => {
  assert.deepEqual([...PREVIEW_ENGINE_IDS], ['opencode', 'pi', 'deepseek-harness']);
  assert.deepEqual([...SUPPORTED_ENGINE_IDS], ['claude-code', 'codex']);
  assert.deepEqual([...SUPPORTED_ENGINE_IDS, ...PREVIEW_ENGINE_IDS].sort(), [...ENGINE_IDS].sort(), 'every engine is in exactly one list');
  for (const id of PREVIEW_ENGINE_IDS) assert.equal(isPreviewEngine(id), true, id);
  for (const id of SUPPORTED_ENGINE_IDS) assert.equal(isPreviewEngine(id), false, id);
});

test('isPreviewEngine is false for anything that is not a preview engine id', () => {
  for (const v of [undefined, null, 0, {}, [], 'hermes', 'OpenCode', '', 'claude']) assert.equal(isPreviewEngine(v), false, String(v));
});

test('the switch is the variable BOWERLOOM_PREVIEW_ENGINES set to exactly 1', () => {
  assert.equal(PREVIEW_ENGINES_ENV, 'BOWERLOOM_PREVIEW_ENGINES');
  assert.equal(previewEnginesAllowed({ BOWERLOOM_PREVIEW_ENGINES: '1' }), true);
  for (const v of ['0', '', 'true', 'yes', '01', '1 ', ' 1', 'on', undefined]) assert.equal(previewEnginesAllowed({ BOWERLOOM_PREVIEW_ENGINES: v }), false, JSON.stringify(v));
  assert.equal(previewEnginesAllowed({}), false);
  assert.equal(previewEnginesAllowed({ OTHER: '1' }), false);
});

test('the lists cannot be changed', () => {
  assert.throws(() => { PREVIEW_ENGINE_IDS.push('x'); });
  assert.throws(() => { SUPPORTED_ENGINE_IDS.push('x'); });
});
