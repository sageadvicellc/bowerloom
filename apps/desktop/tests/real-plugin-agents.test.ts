// Agents are plain markdown files. Claude Code keeps the ones that plug-ins bring under plugins/cache/<source>/<plug-in>/<version>/agents/, and the reader must count them
// without entering any other part of plugins/. Everything here is made up in a temporary folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createScanner } from '../main/real-scan.js';
import { classify, walkEnter, walkPrune } from '../shared/real/adapters.js';
import { tempDir } from './support.js';

const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const agent = (name: string): string => `---\nname: ${name}\ndescription: Does ${name} work.\n---\nBody.\n`;

test('a plug-in agent is an agent, and only the agents branch of a plug-in is entered', () => {
  assert.equal(classify('claude-code', 'plugins/cache/src/pack/1.0.0/agents/planner.md')?.what, 'agent');
  assert.equal(classify('claude-code', 'plugins/cache/src/pack/1.0.0/agents/README.md'), null);
  assert.equal(classify('claude-code', 'plugins/cache/src/pack/1.0.0/docs/agents/x.md'), null);
  assert.equal(walkEnter('claude-code', 'plugins'), true);
  assert.equal(walkEnter('claude-code', 'plugins/cache'), true);
  assert.equal(walkEnter('claude-code', 'cache'), false);
  assert.equal(walkEnter('codex', 'plugins'), false);
  assert.equal(walkPrune('claude-code', 'plugins/marketplaces'), true);
  assert.equal(walkPrune('claude-code', 'plugins/cache/src/pack/1.0.0/skills'), true);
  assert.equal(walkPrune('claude-code', 'plugins/cache/src/pack/1.0.0/agents'), false);
  assert.equal(walkPrune('claude-code', 'plugins/cache/src/pack'), false);
});

test('step one counts the agents of the home folder and of its plug-ins, and nothing from the other parts of plugins/', async t => {
  const home = tempDir(t, 'bowerloom-plugin-agents-');
  put(join(home, '.claude', 'agents', 'mine.md'), agent('mine'));
  put(join(home, '.claude', 'plugins', 'cache', 'src', 'pack', '1.0.0', 'agents', 'planner.md'), agent('planner'));
  put(join(home, '.claude', 'plugins', 'cache', 'src', 'pack', '1.0.0', 'docs', 'agents', 'not-one.md'), agent('not-one'));
  put(join(home, '.claude', 'plugins', 'marketplaces', 'src', 'agents', 'copy.md'), agent('copy'));
  put(join(home, '.claude', 'cache', 'agents', 'stale.md'), agent('stale'));
  const d = await createScanner({ home }).discover();
  assert.equal(d.places.length, 1);
  assert.equal(d.places[0]!.counts.agents, 2);
  assert.equal(d.stoppedEarly, false);
  assert.equal(d.notes.length, 0, 'pruned folders are not reported as cut short');
});
