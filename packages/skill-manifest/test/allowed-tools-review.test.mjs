import '../../../dist/tests/support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAddReview } from '../../../dist/apps/cli/src/manifest.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planManifestChange } from '../../../dist/packages/skill-manifest/src/add.js';
import { itemLine } from '../../../dist/apps/cli/src/sync.js';
import { npmCollections } from './support/expected.mjs';

const LINE = 'Allowed tools: Bash(npx:*) Bash(npm:*) (pre-approved in Claude Code while this skill is active)';
const entry = tools => { const e = { id: 'collections', ...npmCollections() }; if (tools) e.skill = { ...e.skill, allowedTools: tools }; return e; };
const plan = e => ({ manifest: '.bowerloom/skills.json', before: null, change: { add: e } });

test('the skills add review prints allowed-tools as its own line, and prints nothing for a skill without it', () => {
  const lines = renderAddReview(plan(entry('Bash(npx:*) Bash(npm:*)'))).split('\n');
  assert.ok(lines.includes('  ' + LINE), lines.join('\n'));
  assert.ok(!renderAddReview(plan(entry())).includes('Allowed tools'));
});
test('the review of a replace shows the new allowed-tools too', () => {
  const text = renderAddReview({ manifest: '.bowerloom/skills.json', before: null, change: { replace: { from: entry(), to: entry('Bash(npx:*) Bash(npm:*)') } } });
  assert.ok(text.includes(LINE));
});
test('the skills sync item lines show allowed-tools when the skill carries it', () => {
  const item = tools => ({ id: 'collections', kind: 'npm', pin: 'pkg@1.0.0:skills/x', state: 'needs-fetch', action: 'install', cache: null, allowedTools: tools, harnesses: ['claude'], hold: null });
  assert.ok(itemLine(item('Bash(npx:*) Bash(npm:*)'), 12).some(l => l.trim() === LINE));
  assert.ok(!itemLine(item(undefined), 12).some(l => l.includes('Allowed tools')));
});

test('allowed-tools changes the plan revision, so one approval cannot apply the other plan', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-allowed-tools-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.bowerloom'), { mode: 0o700 });
  const plain = planManifestChange(root, { add: entry() }), tools = planManifestChange(root, { add: entry('Bash(npx:*) Bash(npm:*)') });
  assert.notEqual(plain.revision, tools.revision);
  assert.ok(tools.text.includes('"allowedTools": "Bash(npx:*) Bash(npm:*)"')); assert.ok(!plain.text.includes('allowedTools'));
});
