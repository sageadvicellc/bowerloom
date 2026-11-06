// The states of the real Start sheet, as one pure model: which folders can start, which engines a folder offers and in what state each is, and what the button does.
// Start on the person's own folders shows a command and runs nothing, so the model has no "run" state. An engine that is not ready sends the person to the install review first.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FolderInfo } from '../shared/engine/types.js';
import { START_INSTRUCTION_LIMIT, START_MAIN_WORDS } from '../shared/engine/start-command.js';
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

test('the sheet opens on the folder asked for, even if it cannot start (its own reason is shown), and on no folder when none is asked for', () => {
  const a = folder({ id: 'folder-1', hasDefinition: false, engines: [] }), b = folder({ id: 'folder-2' }), c = folder({ id: 'folder-3' });
  assert.equal(firstStartFolder([a, b, c], null), '', 'a harness pressed in the list has no folder: nothing is chosen');
  assert.equal(firstStartFolder([a, b, c], 'folder-3'), 'folder-3');
  assert.equal(firstStartFolder([a, b, c], 'folder-1'), 'folder-1', 'no silent fall back to another folder');
  assert.equal(firstStartFolder([a, b, c], 'folder-9'), '', 'an id the list does not hold chooses nothing');
  assert.equal(firstStartFolder([], 'folder-1'), '');
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
  assert.deepEqual(startStatus(folder(), ['codex'], 'a\u0000b'), { kind: 'bad-text', code: 'START_INSTRUCTION_CHARACTERS', message: START_MAIN_WORDS.START_INSTRUCTION_CHARACTERS });
  assert.deepEqual(startStatus(folder(), ['codex'], '-n'), { kind: 'bad-text', code: 'START_INSTRUCTION_DASH', message: START_MAIN_WORDS.START_INSTRUCTION_DASH });
  assert.deepEqual(startStatus(folder(), ['claude-code', 'codex'], ok), { kind: 'ready', engines: ['claude-code', 'codex'] });
});

test('an instruction that is a command of a ticked engine is a state of its own, naming the first such engine and the word; hidden characters are a bad-text state', () => {
  assert.deepEqual(startStatus(folder(), ['claude-code', 'codex'], 'login'), { kind: 'subcommand', engine: 'codex', word: 'login' });
  assert.deepEqual(startStatus(folder(), ['claude-code'], 'login'), { kind: 'ready', engines: ['claude-code'] });
  assert.deepEqual(startStatus(folder(), ['claude-code', 'codex'], 'update'), { kind: 'subcommand', engine: 'claude-code', word: 'update' });
  assert.deepEqual(startStatus(folder(), ['codex'], 'a\u200bb'), { kind: 'bad-text', code: 'START_INSTRUCTION_HIDDEN', message: 'The instruction has a hidden character: U+200B (zero-width space) at position 2. Remove it and try again.' });
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
