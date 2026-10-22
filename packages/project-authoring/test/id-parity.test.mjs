import test from 'node:test';
import assert from 'node:assert/strict';
import { isSkillId, isPromptId, isTeamId } from '../../../dist/packages/project-authoring/src/state.js';
import { isStoreSkillId, isStorePromptId, isStoreTeamId } from '../../../dist/packages/project-config/src/schema.js';

const sample = ['house-style', 'personal-assistant', 'first-team', 'prompt-x', 'a'.repeat(57), 'a'.repeat(58), 'a'.repeat(64), 'a'.repeat(65), 'Upper', '-lead', 'dou--ble', ''];

test('the store id tests answer as the authoring id tests do', () => {
  for (const id of sample) {
    assert.equal(isStoreSkillId(id), isSkillId(id), `skill ${JSON.stringify(id)}`);
    assert.equal(isStorePromptId(id), isPromptId(id), `prompt ${JSON.stringify(id)}`);
    assert.equal(isStoreTeamId(id), isTeamId(id), `team ${JSON.stringify(id)}`);
  }
  for (const value of [undefined, null, 1, {}, []]) { assert.equal(isStoreSkillId(value), isSkillId(value)); assert.equal(isStorePromptId(value), isPromptId(value)); assert.equal(isStoreTeamId(value), isTeamId(value)); }
});
