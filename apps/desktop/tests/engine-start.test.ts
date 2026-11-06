// The two Start calls in main (beta.2): showStartCommand and startCommandToClipboard. Start runs nothing. A call takes a folder id main gave out, an engine id, and the instruction.
// Main builds the command with the real folder path. The window gets the same command with ~ for the home folder (never a full path under home). Only startCommandToClipboard writes,
// and it writes only the clipboard. No call starts a process, reads a file, or writes a file. Synthetic folders in a temp home; no engine is ever run.
import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createEngineService, EngineCallRefusal } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import { registerEngineIpc } from '../main/engine-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { ENGINE_ARITY, ENGINE_CALLS, ENGINE_CHANNELS } from '../shared/engine/types.js';
import type { Answer, FolderInfo, StartCommandView } from '../shared/engine/types.js';
import { START_INSTRUCTION_LIMIT, START_MAIN_WORDS } from '../shared/engine/start-command.js';
import { createSampleEngine } from '../shared/engine/sample.js';
import { DESKTOP, tempDir } from './support.js';
import { filesOf, homeFolder, teamFolder } from './helpers-engine/folders.js';

const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null, 'an answer'); if (!a.ok) assert.fail(`refused: ${a.refusal.code} ${a.refusal.message}`); return a.value; };
const refusal = <T>(a: Answer<T>): { code: string; message: string; paths: readonly string[] } => { assert.equal(a.ok, false, 'a refusal'); return (a as Extract<Answer<T>, { ok: false }>).refusal; };

interface Setup { home: string; base: string; service: EngineService; clipboard: string[]; pick(dir: string | null): void }
function setup(t: test.TestContext, { clipboard = 'works' }: { clipboard?: 'works' | 'missing' | 'throws' } = {}): Setup {
  const base = realpathSync(tempDir(t, 'bowerloom-start-'));
  const home = homeFolder(base);
  const written: string[] = [];
  let next: string | null = null;
  const service = createEngineService({
    home, stateRoot: join(home, '.local', 'state', 'bowerloom'), who: 'tester', now: () => new Date('2026-11-06T12:00:00Z'),
    chooseFolder: async () => next, confirm: async (): Promise<boolean> => assert.fail('Start never asks a dialog'),
    ...(clipboard === 'missing' ? {} : { writeClipboard: (text: string) => { if (clipboard === 'throws') throw new Error('the clipboard is locked'); written.push(text); } }),
  });
  return { home, base, service, clipboard: written, pick: d => { next = d; } };
}
async function choose(s: Setup, dir: string): Promise<FolderInfo> { s.pick(dir); return value(await s.service.chooseFolder()); }
const noHome = (s: Setup, v: unknown): void => assert.equal(JSON.stringify(v).includes(s.home), false, JSON.stringify(v));
/** What a real shell passes to a program named `program` for this command: the argument count and the arguments. */
function argsOf(command: string, program: string, home = '/nonexistent'): string[] {
  const run = spawnSync('/bin/sh', ['-c', `${program}() { printf '%s\\0' "$#" "$@"; }\n${command}`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: home } });
  assert.equal(run.status, 0, run.stderr);
  const parts = run.stdout.split('\0'); parts.pop();
  return parts.slice(1);
}

test('the two Start calls are listed, take three arguments each, and have a channel of their own', () => {
  for (const call of ['showStartCommand', 'startCommandToClipboard'] as const) {
    assert.ok((ENGINE_CALLS as readonly string[]).includes(call), call);
    assert.equal(ENGINE_ARITY[call], 3, call);
    assert.equal(ENGINE_CHANNELS[call], `bowerloom-engine:${call}`);
  }
});

test('showStartCommand answers the command with ~ for the home folder, the folder label, and the engine name, and touches nothing', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), before = filesOf(s.home);
  const f = await choose(s, dir), settled = filesOf(s.home);
  const view = value(await s.service.showStartCommand(f.id, 'claude-code', 'fix the login'));
  assert.deepEqual(view, { engine: 'claude-code', engineName: 'Claude Code', folder: '~/Projects/team', command: "cd ~/Projects/team && claude 'fix the login'", copied: false, differs: true });
  const codex = value(await s.service.showStartCommand(f.id, 'codex', 'fix the login'));
  assert.equal(codex.command, "cd ~/Projects/team && codex 'fix the login'");
  assert.equal(codex.engineName, 'Codex');
  noHome(s, [view, codex]);
  assert.deepEqual(s.clipboard, [], 'showing writes nothing to the clipboard');
  assert.deepEqual(filesOf(s.home), settled, 'showing writes no file');
  assert.ok(Object.keys(settled).length >= Object.keys(before).length);
  assert.equal(s.service.busy(), false);
});

test('startCommandToClipboard writes the clipboard with the real folder path, and answers the same command with ~', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir), settled = filesOf(s.home);
  const view = value(await s.service.startCommandToClipboard(f.id, 'codex', 'fix the login'));
  assert.deepEqual(s.clipboard, [`cd ${dir} && codex 'fix the login'`], 'the clipboard holds the full path');
  assert.deepEqual(view, { engine: 'codex', engineName: 'Codex', folder: '~/Projects/team', command: "cd ~/Projects/team && codex 'fix the login'", copied: true, differs: true });
  noHome(s, view);
  const shown = value(await s.service.showStartCommand(f.id, 'codex', 'fix the login'));
  assert.equal(shown.command, view.command, 'the shown command and the copied one are the same command');
  assert.equal(s.clipboard[0]!.replace(dir, '~/Projects/team'), view.command, 'they differ only in the folder path');
  assert.deepEqual(filesOf(s.home), settled, 'copying writes no file');
});

test('the copied command and the shown command pass the same single argument to the engine, for a folder name with a space and a quote', async t => {
  const s = setup(t);
  const dir = join(s.home, 'Projects', "it's a demo");
  mkdirSync(dir, { recursive: true });
  const f = await choose(s, dir);
  const text = "say \"hi\" && touch x; $(y) `z`\nnext 🎉";
  const view = value(await s.service.startCommandToClipboard(f.id, 'claude-code', text));
  assert.deepEqual(argsOf(s.clipboard[0]!, 'claude'), [text]);
  assert.deepEqual(argsOf(view.command, 'claude', s.home), [text], 'the shown form holds the same single argument, once the shell reads ~ as the home folder');
  assert.match(view.command, /^cd ~\/'Projects\/it'\\''s a demo' && claude '/);
});

test('a folder outside home keeps its full path in both forms, and says they do not differ', async t => {
  const s = setup(t);
  const outside = join(s.base, 'elsewhere');
  mkdirSync(outside);
  const f = await choose(s, outside);
  const shown = value(await s.service.showStartCommand(f.id, 'codex', 'go'));
  const copied = value(await s.service.startCommandToClipboard(f.id, 'codex', 'go'));
  assert.equal(shown.differs, false); assert.equal(copied.differs, false);
  assert.equal(shown.command, `cd ${outside} && codex 'go'`);
  assert.deepEqual(s.clipboard, [shown.command]);
});

test('a bad argument is refused with a code before anything is built: a folder id main never gave, a path, an engine without a command, a non-text instruction', async t => {
  const s = setup(t);
  const f = await choose(s, teamFolder(s.home));
  const bad = (code: string) => (e: unknown): boolean => e instanceof EngineCallRefusal && e.code === code;
  for (const call of ['showStartCommand', 'startCommandToClipboard'] as const) {
    await assert.rejects(s.service[call]('folder-99', 'codex', 'go'), bad('UNKNOWN_FOLDER'));
    await assert.rejects(s.service[call]('notes-1', 'codex', 'go'), bad('BAD_ARGUMENT'));
    await assert.rejects(s.service[call]('/etc', 'codex', 'go'), bad('BAD_ARGUMENT'));
    await assert.rejects(s.service[call](dirOf(s), 'codex', 'go'), bad('BAD_ARGUMENT'));
    await assert.rejects(s.service[call]({ id: f.id }, 'codex', 'go'), bad('BAD_ARGUMENT'));
    for (const engine of ['opencode', 'pi', 'deepseek-harness', 'claude', 'CODEX', '', 7, null, undefined, {}, ['codex']]) await assert.rejects(s.service[call](f.id, engine, 'go'), bad('BAD_ARGUMENT'), String(engine));
    for (const instruction of [7, null, undefined, {}, ['go']]) await assert.rejects(s.service[call](f.id, 'codex', instruction), bad('BAD_ARGUMENT'), String(instruction));
  }
  assert.deepEqual(s.clipboard, []);
});
const dirOf = (s: Setup): string => join(s.home, 'Projects', 'team');

test('an instruction that cannot be sent is refused in words, and nothing is copied: empty, too long, NUL, a control character, a leading dash', async t => {
  const s = setup(t);
  const f = await choose(s, teamFolder(s.home));
  const cases: readonly (readonly [string, string])[] = [
    ['', 'START_INSTRUCTION_EMPTY'], ['  \n', 'START_INSTRUCTION_EMPTY'], ['x'.repeat(START_INSTRUCTION_LIMIT + 1), 'START_INSTRUCTION_TOO_LONG'],
    ['a\u0000b', 'START_INSTRUCTION_CHARACTERS'], ['a\rb', 'START_INSTRUCTION_CHARACTERS'], ['a\u001bb', 'START_INSTRUCTION_CHARACTERS'], ['a\u202eb', 'START_INSTRUCTION_CHARACTERS'],
    ['-n', 'START_INSTRUCTION_DASH'], ['--help', 'START_INSTRUCTION_DASH'],
    ['a\u{e0041}b', 'START_INSTRUCTION_HIDDEN'], ['a\u200bb', 'START_INSTRUCTION_HIDDEN'], ['a\ufeffb', 'START_INSTRUCTION_HIDDEN'],
  ];
  for (const call of ['showStartCommand', 'startCommandToClipboard'] as const) {
    for (const [text, code] of cases) {
      const r = refusal(await s.service[call](f.id, 'claude-code', text));
      assert.equal(r.code, code, `${call} ${JSON.stringify(text.slice(0, 12))}`);
      assert.equal(r.message, START_MAIN_WORDS[code as keyof typeof START_MAIN_WORDS]);
      assert.doesNotMatch(r.message, /copied/i, 'a show copies nothing, so no refusal says it was not copied');
      assert.deepEqual(r.paths, []);
    }
  }
  assert.deepEqual(s.clipboard, [], 'a refused call never reaches the clipboard');
  value(await s.service.startCommandToClipboard(f.id, 'claude-code', 'x'.repeat(START_INSTRUCTION_LIMIT)));
  assert.equal(s.clipboard.length, 1, 'the longest allowed instruction is copied');
});

test('a folder whose name hides characters gets no command, because the shown form could not match the copied one', async t => {
  const s = setup(t);
  const dir = join(s.home, 'Projects', 'a\u202eb');
  mkdirSync(dir, { recursive: true });
  const f = await choose(s, dir);
  for (const call of ['showStartCommand', 'startCommandToClipboard'] as const) assert.equal(refusal(await s.service[call](f.id, 'codex', 'go')).code, 'START_FOLDER_HIDDEN');
  assert.deepEqual(s.clipboard, []);
});

test('a clipboard that is missing or throws is a refusal in words, and showing still works', async t => {
  for (const mode of ['missing', 'throws'] as const) {
    const s = setup(t, { clipboard: mode });
    const f = await choose(s, teamFolder(s.home, mode));
    const r = refusal(await s.service.startCommandToClipboard(f.id, 'codex', 'go'));
    assert.equal(r.code, 'START_COPY_FAILED'); assert.equal(r.message, START_MAIN_WORDS.START_COPY_FAILED);
    assert.equal(JSON.stringify(r).includes('locked'), false, 'the reason of the clipboard is not passed on');
    assert.equal(value(await s.service.showStartCommand(f.id, 'codex', 'go')).copied, false);
  }
});

test('calls run one at a time, in the order they came', async t => {
  const s = setup(t);
  const f = await choose(s, teamFolder(s.home));
  const calls = ['one', 'two', 'three'].map(text => s.service.startCommandToClipboard(f.id, 'claude-code', text));
  assert.equal(s.service.busy(), true);
  await Promise.all(calls);
  assert.deepEqual(s.clipboard.map(c => c.slice(c.indexOf('&&') + 3)), ["claude 'one'", "claude 'two'", "claude 'three'"]);
  assert.equal(s.service.busy(), false);
});

test('the Start calls start no process: a spy on every way to start one sees nothing, while a control call is seen', async t => {
  const s = setup(t);
  const f = await choose(s, teamFolder(s.home));
  const names = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;
  const seen: string[] = [];
  for (const name of names) t.mock.method(cp, name, () => { seen.push(name); throw new Error(`${name} must not run`); });
  syncBuiltinESMExports();
  try {
    for (const engine of ['claude-code', 'codex'] as const) {
      value(await s.service.showStartCommand(f.id, engine, 'go'));
      value(await s.service.startCommandToClipboard(f.id, engine, 'go'));
    }
    assert.deepEqual(seen, [], 'nothing started');
    const live = await import('node:child_process');
    assert.throws(() => live.spawn('true'), /spawn must not run/, 'the spy does see a spawn through the live module');
    assert.deepEqual(seen, ['spawn']);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('the Start answer reads no file, writes no file, and imports no way to start a process or reach the network', () => {
  const source = readFileSync(join(DESKTOP, 'shared', 'engine', 'start-answer.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map(m => m[1]!);
  assert.ok(imports.length >= 1, 'the scan sees the imports');
  for (const name of imports) assert.match(name, /^\.\.?\//, `only Bowerloom's own modules: ${name}`);
  assert.doesNotMatch(source, /child_process|worker_threads|cluster|\bfs\b|node:net|node:http|fetch\(|WebSocket|shell\.|spawn|execFile|\bexec\(/);
  assert.doesNotMatch(source, /writeFile|appendFile|mkdir|rmSync|unlink|rename|createWriteStream|readFile|readdir|lstat|stat\(/);
  const shared = readFileSync(join(DESKTOP, 'shared', 'engine', 'start-command.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.deepEqual([...shared.matchAll(/from '([^']+)'/g)].map(m => m[1]!).filter(name => !/^\.\.?\//.test(name)), [], 'the shared builder imports nothing from outside Bowerloom');
});

test('the handler answers the Start calls only to the app page, in its main frame, with exactly three arguments, and gives the window a short code on refusal', async t => {
  const home = homeFolder(realpathSync(tempDir(t, 'bowerloom-start-ipc-')));
  const dir = teamFolder(home), written: string[] = [];
  const handlers = new Map<string, (event: { senderFrame: unknown }, ...args: unknown[]) => unknown>();
  registerEngineIpc({
    ipc: { handle: (c, l) => { handlers.set(c, l as never); } }, appIndexUrl: APP_INDEX, home, stateRoot: join(home, '.local', 'state', 'bowerloom'), who: 't', confirm: async () => false,
    chooseFolder: async () => dir, writeClipboard: text => { written.push(text); },
  });
  const page = { senderFrame: { url: APP_INDEX, parent: null } };
  const choose = handlers.get(ENGINE_CHANNELS.chooseFolder)!;
  const id = ((await choose(page)) as Extract<Answer<FolderInfo>, { ok: true }>).value.id;
  const reason = async (call: 'showStartCommand' | 'startCommandToClipboard', event: { senderFrame: unknown }, ...args: unknown[]): Promise<string> => { try { await handlers.get(ENGINE_CHANNELS[call])!(event, ...args); return 'ok'; } catch (e) { return (e as Error).message; } };
  for (const call of ['showStartCommand', 'startCommandToClipboard'] as const) {
    assert.equal(await reason(call, { senderFrame: { url: 'https://example.com/', parent: null } }, id, 'codex', 'go'), 'NOT_ALLOWED');
    assert.equal(await reason(call, { senderFrame: { url: APP_INDEX, parent: {} } }, id, 'codex', 'go'), 'NOT_ALLOWED');
    assert.equal(await reason(call, { senderFrame: null }, id, 'codex', 'go'), 'NOT_ALLOWED');
    assert.equal(await reason(call, page, id, 'codex'), 'BAD_ARGUMENT');
    assert.equal(await reason(call, page, id, 'codex', 'go', 'extra'), 'BAD_ARGUMENT');
    assert.equal(await reason(call, page, 'folder-99', 'codex', 'go'), 'UNKNOWN_FOLDER');
    assert.equal(await reason(call, page, id, 'opencode', 'go'), 'BAD_ARGUMENT');
  }
  assert.deepEqual(written, [], 'every refused call left the clipboard alone');
  assert.equal(await reason('startCommandToClipboard', page, id, 'codex', 'go'), 'ok');
  assert.deepEqual(written, [`cd ${dir} && codex 'go'`]);
});

test('the sample answers the same calls in memory: it builds the command, copies nothing, and starts nothing', async () => {
  const engine = createSampleEngine();
  const folders = await engine.folders();
  assert.ok(folders.length > 0);
  const view = value(await engine.startCommandToClipboard(folders[0]!.id, 'codex', 'go'));
  assert.equal(view.copied, false, 'the sample copies nothing');
  assert.match(view.command, /^cd .+ && codex 'go'$/);
  const shown = value(await engine.showStartCommand(folders[0]!.id, 'claude-code', 'go')) as StartCommandView;
  assert.equal(shown.engineName, 'Claude Code');
  await assert.rejects(async () => engine.showStartCommand('folder-999', 'codex', 'go'), /UNKNOWN_FOLDER/);
  await assert.rejects(async () => engine.showStartCommand(folders[0]!.id, 'opencode', 'go'), /BAD_ARGUMENT/);
  assert.equal(refusal(await engine.showStartCommand(folders[0]!.id, 'codex', '')).code, 'START_INSTRUCTION_EMPTY');
});

test('an instruction that is also a command of the engine is refused for that engine, with the word and the engine named, and copied for the other', async t => {
  const s = setup(t);
  const f = await choose(s, teamFolder(s.home));
  for (const call of ['showStartCommand', 'startCommandToClipboard'] as const) {
    const r = refusal(await s.service[call](f.id, 'codex', 'login'));
    assert.equal(r.code, 'START_INSTRUCTION_SUBCOMMAND'); assert.equal(r.message, "'login' is also a command of Codex. Add more words to your instruction.");
    const c = refusal(await s.service[call](f.id, 'claude-code', 'update'));
    assert.equal(c.message, "'update' is also a command of Claude Code. Add more words to your instruction.");
  }
  assert.deepEqual(s.clipboard, []);
  value(await s.service.startCommandToClipboard(f.id, 'claude-code', 'login'));
  assert.equal(s.clipboard.length, 1, 'login is not a Claude Code command');
});

test('a folder whose name holds a tab or a line feed gets no command, so the command stays one line', async t => {
  const s = setup(t);
  for (const name of ['x\ny', 'x\ty']) {
    const dir = join(s.home, 'Projects', name);
    mkdirSync(dir, { recursive: true });
    const f = await choose(s, dir);
    for (const call of ['showStartCommand', 'startCommandToClipboard'] as const) {
      const r = refusal(await s.service[call](f.id, 'codex', 'go'));
      assert.equal(r.code, 'START_FOLDER_NAME'); assert.equal(r.message, START_MAIN_WORDS.START_FOLDER_NAME);
    }
  }
  assert.deepEqual(s.clipboard, []);
});
