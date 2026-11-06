// The states of the real Start sheet, as one pure model: which folders can start, which engines a folder offers and in what state each is, and what the button does.
// Start on the person's own folders shows a command and runs nothing, so the model has no "run" state. An engine that is not ready sends the person to the install review first.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FolderInfo } from '../shared/engine/types.js';
import { START_INSTRUCTION_LIMIT } from '../shared/engine/start-command.js';
import { engineStateOf, firstStartEngines, firstStartFolder, offeredEngines, startFolderLine, startStatus } from '../shared/harness/start-real.js';

const folder = (over: Partial<FolderInfo> = {}): FolderInfo => ({
  id: 'folder-1', label: '~/Projects/demo', name: 'demo', hasDefinition: true, engines: ['claude-code', 'codex'], previewEngines: false, installedEngines: ['claude-code', 'codex'],
  problem: null, projected: true, unfinished: { projection: false, adoption: false }, ...over,
});

test('a folder offers Claude Code and Codex when its harness lists them, in the harness order, and never a preview engine', () => {
  assert.deepEqual(offeredEngines(folder()), ['claude-code', 'codex']);
  assert.deepEqual(offeredEngines(folder({ engines: ['codex', 'claude-code'] })), ['codex', 'claude-code']);
  assert.deepEqual(offeredEngines(folder({ engines: ['codex', 'opencode', 'pi', 'deepseek-harness'], previewEngines: true })), ['codex'], 'Start has a command for two engines only');
  assert.deepEqual(offeredEngines(folder({ engines: [] })), []);
  assert.deepEqual(offeredEngines(folder({ hasDefinition: false, engines: [] })), []);
  assert.deepEqual(offeredEngines(undefined), []);
});

test('an engine is ready when the install record lists it, not installed when it does not, and stopped while an install stopped part way', () => {
  assert.equal(engineStateOf(folder(), 'codex'), 'ready');
  assert.equal(engineStateOf(folder({ installedEngines: ['claude-code'] }), 'codex'), 'not-installed');
  assert.equal(engineStateOf(folder({ installedEngines: [], projected: false }), 'claude-code'), 'not-installed');
  assert.equal(engineStateOf(folder({ unfinished: { projection: true, adoption: false } }), 'codex'), 'stopped');
});

test('the first folder is the one asked for if it can start, else the first that holds a harness, else none', () => {
  const a = folder({ id: 'folder-1', hasDefinition: false, engines: [] }), b = folder({ id: 'folder-2' }), c = folder({ id: 'folder-3' });
  assert.equal(firstStartFolder([a, b, c], null), 'folder-2');
  assert.equal(firstStartFolder([a, b, c], 'folder-3'), 'folder-3');
  assert.equal(firstStartFolder([a, b, c], 'folder-1'), 'folder-2', 'a folder with no harness cannot start');
  assert.equal(firstStartFolder([a, b, c], 'folder-9'), 'folder-2');
  assert.equal(firstStartFolder([a], null), '');
  assert.equal(firstStartFolder([], null), '');
});

test('the first ticks are the engines already installed, else the first one offered', () => {
  assert.deepEqual(firstStartEngines(folder()), ['claude-code', 'codex']);
  assert.deepEqual(firstStartEngines(folder({ installedEngines: ['codex'] })), ['codex']);
  assert.deepEqual(firstStartEngines(folder({ installedEngines: [] })), ['claude-code']);
  assert.deepEqual(firstStartEngines(undefined), []);
});

test('the line under a folder says why it cannot start, or what it offers', () => {
  assert.equal(startFolderLine(folder({ hasDefinition: false, engines: [] })).off, true);
  assert.equal(startFolderLine(folder({ problem: 'The harness does not load.' })).off, true);
  assert.equal(startFolderLine(folder({ engines: ['opencode'], previewEngines: true })).off, true, 'only a preview engine: nothing to show');
  assert.deepEqual(startFolderLine(folder()), { words: 'Claude Code and Codex', off: false });
  assert.deepEqual(startFolderLine(folder({ engines: ['codex'] })), { words: 'Codex', off: false });
});

test('startStatus walks the states in order: no project, no harness, no engine, no instruction, too long, a bad character, install first, ready', () => {
  const ok = 'fix the login';
  assert.deepEqual(startStatus(undefined, ['codex'], ok), { kind: 'no-project' });
  assert.deepEqual(startStatus(folder({ hasDefinition: false, engines: [] }), ['codex'], ok), { kind: 'no-harness' });
  assert.deepEqual(startStatus(folder({ problem: 'Bad.' }), ['codex'], ok), { kind: 'no-harness' });
  assert.deepEqual(startStatus(folder(), [], ok), { kind: 'no-engine' });
  assert.deepEqual(startStatus(folder({ engines: ['claude-code'] }), ['codex'], ok), { kind: 'no-engine' }, 'a tick for an engine the folder does not offer is dropped');
  assert.deepEqual(startStatus(folder(), ['codex'], ''), { kind: 'no-instruction' });
  assert.deepEqual(startStatus(folder(), ['codex'], '  \n '), { kind: 'no-instruction' });
  assert.deepEqual(startStatus(folder(), ['codex'], 'x'.repeat(START_INSTRUCTION_LIMIT + 1)), { kind: 'too-long' });
  assert.deepEqual(startStatus(folder(), ['codex'], 'a\u0000b'), { kind: 'bad-text', code: 'START_INSTRUCTION_CHARACTERS' });
  assert.deepEqual(startStatus(folder(), ['codex'], '-n'), { kind: 'bad-text', code: 'START_INSTRUCTION_DASH' });
  assert.deepEqual(startStatus(folder(), ['claude-code', 'codex'], ok), { kind: 'ready', engines: ['claude-code', 'codex'] });
});

test('an engine that is not installed, out of the record, or stopped sends the person to the install review first, listing exactly those engines', () => {
  const ok = 'fix the login';
  assert.deepEqual(startStatus(folder({ installedEngines: ['claude-code'] }), ['claude-code', 'codex'], ok), { kind: 'needs-install', engines: ['codex'] });
  assert.deepEqual(startStatus(folder({ installedEngines: [], projected: false }), ['codex', 'claude-code'], ok), { kind: 'needs-install', engines: ['claude-code', 'codex'] }, 'in the harness order');
  assert.deepEqual(startStatus(folder({ unfinished: { projection: true, adoption: false } }), ['codex'], ok), { kind: 'needs-install', engines: ['codex'] });
  assert.deepEqual(startStatus(folder({ installedEngines: [] }), ['codex'], ''), { kind: 'no-instruction' }, 'the instruction is asked for before the install review opens');
});

test('the longest allowed instruction is ready', () => {
  assert.deepEqual(startStatus(folder(), ['codex'], 'x'.repeat(START_INSTRUCTION_LIMIT)), { kind: 'ready', engines: ['codex'] });
});
