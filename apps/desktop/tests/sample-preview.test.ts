// Beta.1, demo mode: the sample world locks the preview engines like the real app does. Only an explicit launch argument of main turns them on, for the
// e2e specs that install to OpenCode; the page gets one attribute from main and has no way to set it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLE_PREVIEW_ATTRIBUTE, SAMPLE_PREVIEW_FLAG, withSamplePreviewEngines } from '../shared/engine/sample-switch.js';
import { SAMPLE_FOLDERS, createSampleEngine } from '../shared/engine/sample.js';
import { DESKTOP } from './support.js';

const read = (rel: string): string => readFileSync(join(DESKTOP, rel), 'utf8');

test('the default sample world locks the preview engines in every folder, and weekly-report still lists OpenCode', async () => {
  const folders = await createSampleEngine().folders();
  assert.ok(folders.length >= 3);
  for (const f of folders) assert.equal(f.previewEngines, false, f.name);
  assert.ok(folders.find(f => f.id === SAMPLE_FOLDERS.defined)!.engines.includes('opencode'));
});

test('a sample world made with the switch on has it on in every folder', async () => {
  for (const f of await createSampleEngine({ previewEngines: true }).folders()) assert.equal(f.previewEngines, true, f.name);
});

test('the sample source no longer explains a switch that is on', () => {
  assert.doesNotMatch(read('shared/engine/sample.ts'), /previewEngines: true/);
});

test('main marks the page only when asked: the attribute is added to the body once, and never when off', () => {
  const html = '<!doctype html><html><head></head><body>\n<div id="root"></div></body></html>';
  assert.equal(withSamplePreviewEngines(html, false), html);
  const on = withSamplePreviewEngines(html, true);
  assert.match(on, new RegExp(`<body ${SAMPLE_PREVIEW_ATTRIBUTE}="1">`));
  assert.equal(withSamplePreviewEngines(on, true), on, 'adding it twice changes nothing');
  assert.equal(withSamplePreviewEngines('<html>no body</html>', true), '<html>no body</html>');
  assert.equal(SAMPLE_PREVIEW_FLAG, '--sample-preview-engines');
});

test('the shipped page does not carry the attribute, and main reads the launch argument for the sample launch only', () => {
  assert.doesNotMatch(read('renderer/index.html'), new RegExp(SAMPLE_PREVIEW_ATTRIBUTE));
  const main = read('main/main.ts');
  assert.match(main, /const samplePreviewEngines = prototypeV3 && !prototypeV3Real && argv\.includes\(SAMPLE_PREVIEW_FLAG\);/);
  assert.equal([...main.matchAll(/SAMPLE_PREVIEW_FLAG/g)].length >= 2, true);
  assert.doesNotMatch(main, /process\.env[^\n]*SAMPLE_PREVIEW|SAMPLE_PREVIEW[^\n]*process\.env/, 'the environment cannot turn it on');
});

test('the page reads the attribute once, to make its sample world', () => {
  const app = read('renderer/harness/HarnessApp.tsx');
  assert.match(app, /createSampleEngine\(\{ previewEngines: document\.body\.getAttribute\(SAMPLE_PREVIEW_ATTRIBUTE\) === '1' \}\)/);
});
