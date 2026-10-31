import test from 'node:test';
import assert from 'node:assert/strict';
import { release, installAvailable, releasePresentation } from '../src/release.ts';

const keys = ['setup', 'adopt', 'install', 'fidelity', 'drift', 'remove', 'save', 'notes', 'skills', 'desktop', 'execution'];
const record = {
  version: '9.9.9-test', release: 'v9-test', state: 'unreleased',
  npm: { installCommand: 'npm install -g example@beta', published: false },
  capabilities: { ...Object.fromEntries(keys.map(key => [key, `${key} wording`])), limits: ['one limit', 'another limit'] },
};
const withNpm = (state, published) => ({ ...record, state, npm: { ...record.npm, published } });

test('the release presentation passes the 0.8 capability keys through unchanged', () => {
  const view = releasePresentation(record);
  assert.deepEqual(Object.keys(view.capabilities), keys);
  for (const key of keys) assert.equal(view.capabilities[key], `${key} wording`);
  assert.deepEqual(view.limits, ['one limit', 'another limit']);
  assert.equal(view.label, 'Open beta');
  assert.equal(view.installCommand, 'npm install -g example@beta');
});

test('the npm gate needs both the published flag and the published state', () => {
  assert.equal(releasePresentation(record).installAvailable, false);
  assert.equal(releasePresentation(withNpm('published', true)).installAvailable, true);
  assert.equal(releasePresentation(withNpm('unreleased', true)).installAvailable, false);
  assert.equal(releasePresentation(withNpm('published', false)).installAvailable, false);
});

test('the presentation has no 0.7 capability keys or wording', () => {
  const view = releasePresentation(record);
  for (const key of ['revision', 'harnesses', 'connections', 'company']) assert.equal(Object.hasOwn(view.capabilities, key), false, key);
  assert.doesNotMatch(JSON.stringify(view), /Synthetic configuration|personal-agent profile|working agreement|team specification/i);
});

test('when the release record carries the 0.8 keys, the presentation uses its wording unchanged', () => {
  if (!Object.hasOwn(release.capabilities, 'adopt')) return; // The 0.8 record arrives when the release branch merges.
  const view = releasePresentation();
  for (const key of keys) assert.equal(view.capabilities[key], release.capabilities[key], key);
  assert.deepEqual(view.limits, release.capabilities.limits);
  assert.equal(view.installAvailable, installAvailable);
});
