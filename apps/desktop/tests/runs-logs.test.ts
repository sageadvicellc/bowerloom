// The reader of an engine's own session log (main/run-logs.ts). The logs here are made up, in a made-up home. The line formats are the shapes Bowerloom is written to expect; the repository
// holds no vendor log and no vendor page that states them, so the reader is tolerant and these tests hold the tolerance: an unknown shape is a visible state, never a crash and never a zero.
// A prompt or a reply in a log never reaches the answer: the answer is numbers and short words, and the tests look for a marker text that is in every log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { claudeFolderName, readFigures } from '../main/run-logs.js';
import { tempDir } from './support.js';

const MARK = 'SECRET-CHAT-TEXT-9f3a';
const START = '2026-11-11T10:30:00.000Z';
const FIGURE_KEYS = ['durationMs', 'endedAt', 'inputTokens', 'model', 'outcome', 'outputTokens', 'startedAt', 'state'];

interface Rig { readonly home: string; readonly project: string }
function rig(t: TestContext): Rig {
  const home = tempDir(t);
  const project = join(home, 'Projects', 'team.app');
  mkdirSync(project, { recursive: true });
  return { home, project };
}
const lines = (rows: readonly unknown[]): string => `${rows.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`;
const put = (file: string, text: string): string => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); return file; };
const at = (minutes: number, seconds = 0): string => new Date(Date.parse(START) + minutes * 60_000 + seconds * 1000).toISOString();

const claudeRows = (cwd: string, first = 1): unknown[] => [
  { type: 'user', timestamp: at(first), cwd, message: { role: 'user', content: `${MARK} please fix` } },
  { type: 'assistant', timestamp: at(first, 20), cwd, message: { id: 'm1', model: 'claude-test-1', role: 'assistant', content: [{ type: 'text', text: MARK }], stop_reason: 'tool_use', usage: { input_tokens: 3, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 10 } } },
  { type: 'assistant', timestamp: at(first, 20), cwd, message: { id: 'm1', model: 'claude-test-1', role: 'assistant', content: [{ type: 'text', text: MARK }], stop_reason: 'tool_use', usage: { input_tokens: 3, output_tokens: 8, cache_creation_input_tokens: 2, cache_read_input_tokens: 10 } } },
  { type: 'assistant', timestamp: at(first + 4), cwd, message: { id: 'm2', model: 'claude-test-1', role: 'assistant', content: [{ type: 'text', text: MARK }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 6 } } },
];
const claudeLog = (r: Rig, name = 's1.jsonl', rows = claudeRows(r.project)): string => put(join(r.home, '.claude', 'projects', claudeFolderName(r.project), name), lines(rows));

const codexRows = (cwd: string, first = 1): unknown[] => [
  { timestamp: at(first), type: 'session_meta', payload: { id: 'abc', cwd, cli_version: '0.0.1', instructions: MARK } },
  { timestamp: at(first, 1), type: 'turn_context', payload: { cwd, model: 'gpt-test-1', summary: MARK } },
  { timestamp: at(first, 5), type: 'event_msg', payload: { type: 'user_message', message: MARK } },
  { timestamp: at(first, 30), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } } } },
  { timestamp: at(first + 6), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 250, output_tokens: 90, total_tokens: 340 } } } },
  { timestamp: at(first + 6, 1), type: 'event_msg', payload: { type: 'task_complete', last_agent_message: MARK } },
];
const codexLog = (r: Rig, name = 'rollout-2026-11-11T10-31-00-abc.jsonl', rows = codexRows(r.project), day = '2026/11/11'): string => put(join(r.home, '.codex', 'sessions', ...day.split('/'), name), lines(rows));

const q = (r: Rig, engine: string, startedAt = START): { engine: never; projectDir: string; startedAt: string } => ({ engine: engine as never, projectDir: r.project, startedAt });
const noText = (value: unknown): void => assert.equal(JSON.stringify(value).includes(MARK), false, 'chat text reached the answer');

// ---- Claude Code

test('a Claude Code log gives the times, the duration, the tokens, the model and the outcome, and no chat text', async t => {
  const r = rig(t); claudeLog(r);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.deepEqual(f, { state: 'found', startedAt: at(1), endedAt: at(5), durationMs: 4 * 60_000, inputTokens: 3 + 2 + 10 + 4, outputTokens: 8 + 6, model: 'claude-test-1', outcome: 'finished' });
  assert.deepEqual(Object.keys(f).sort(), FIGURE_KEYS);
  noText(f);
});

test('the folder name of Claude Code is the folder path with every character that is not a letter or a digit as a dash', () => {
  assert.equal(claudeFolderName('/Users/a.b/My Projects/x_y'), '-Users-a-b-My-Projects-x-y');
  assert.equal(claudeFolderName('/'), '-');
});

test('a log that was written for another folder is not matched, even when it sits in this folder', async t => {
  const r = rig(t); claudeLog(r, 's1.jsonl', claudeRows(join(r.home, 'Projects', 'other')));
  assert.equal((await readFigures({ home: r.home }, q(r, 'claude-code'))).state, 'not-found');
});

test('of several logs the one that began nearest the recorded start is read, and one outside the window is not', async t => {
  const r = rig(t);
  claudeLog(r, 'far.jsonl', claudeRows(r.project, 240));
  claudeLog(r, 'early.jsonl', claudeRows(r.project, -30));
  claudeLog(r, 'near.jsonl', claudeRows(r.project, 2));
  claudeLog(r, 'next.jsonl', claudeRows(r.project, 20));
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.equal(f.startedAt, at(2));
  const none = rig(t); claudeLog(none, 'far.jsonl', claudeRows(none.project, 240));
  assert.equal((await readFigures({ home: none.home }, q(none, 'claude-code'))).state, 'not-found');
});

test('no log folder, no engine home, or a folder that is gone is "not found", with every figure null', async t => {
  const r = rig(t);
  for (const f of [await readFigures({ home: r.home }, q(r, 'claude-code')), await readFigures({ home: r.home }, q(r, 'codex')), await readFigures({ home: join(r.home, 'nope') }, q(r, 'claude-code'))]) {
    assert.deepEqual(f, { state: 'not-found', startedAt: null, endedAt: null, durationMs: null, inputTokens: null, outputTokens: null, model: null, outcome: 'unknown' });
  }
});

test('an engine with no log reader says "not available", and does not look at any folder', async t => {
  const r = rig(t); claudeLog(r);
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) assert.equal((await readFigures({ home: r.home }, q(r, engine))).state, 'not-available', engine);
});

test('a log that is not lines of JSON is "unreadable", never a crash and never a zero', async t => {
  const r = rig(t);
  claudeLog(r, 's1.jsonl', ['not json at all', '{"broken":', '\u0000\u0001\u0002'] as never);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.equal(f.state, 'unreadable');
  assert.deepEqual([f.durationMs, f.inputTokens, f.outputTokens, f.model, f.startedAt], [null, null, null, null, null]);
  const bin = rig(t); put(join(bin.home, '.claude', 'projects', claudeFolderName(bin.project), 'b.jsonl'), Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x01, 0x02]).toString('latin1'));
  assert.equal((await readFigures({ home: bin.home }, q(bin, 'claude-code'))).state, 'unreadable');
});

test('a log with some bad lines still gives the figures of the good ones', async t => {
  const r = rig(t); claudeLog(r, 's1.jsonl', ['garbage', ...claudeRows(r.project), '{"type":', '[]', '5', 'null'] as never);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.equal(f.state, 'found'); assert.equal(f.outputTokens, 14); assert.equal(f.outcome, 'finished');
});

test('a log with times and no usage keeps the tokens null, not zero, and no model is null too', async t => {
  const r = rig(t); claudeLog(r, 's1.jsonl', [{ type: 'user', timestamp: at(1), cwd: r.project, message: { content: MARK } }, { type: 'assistant', timestamp: at(3), cwd: r.project, message: { content: MARK } }]);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.deepEqual(f, { state: 'found', startedAt: at(1), endedAt: at(3), durationMs: 120_000, inputTokens: null, outputTokens: null, model: null, outcome: 'unknown' });
});

test('numbers that cannot be tokens (strings, negatives, fractions, huge, not finite) are ignored and never added as zero', async t => {
  const r = rig(t);
  const row = (id: string, usage: unknown): unknown => ({ type: 'assistant', timestamp: at(2), cwd: r.project, message: { id, model: 'm', usage } });
  claudeLog(r, 's1.jsonl', [row('a', { input_tokens: '5', output_tokens: -3 }), row('b', { input_tokens: 1.5, output_tokens: 1e30 }), row('c', { input_tokens: null, output_tokens: [1] }), row('d', 'x'), row('e', { input_tokens: 7, output_tokens: 9 })]);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.equal(f.inputTokens, 7); assert.equal(f.outputTokens, 9);
});

test('a model name that is not a short plain token is null, and a synthetic model is not a model', async t => {
  for (const [model, want] of [['claude-test-1', 'claude-test-1'], ['<synthetic>', null], ['has space', null], ['a'.repeat(81), null], ['/Users/x/y', null], [5, null], ['', null]] as const) {
    const r = rig(t); claudeLog(r, 's1.jsonl', [{ type: 'assistant', timestamp: at(1), cwd: r.project, message: { id: 'a', model, usage: { input_tokens: 1, output_tokens: 1 } } }]);
    assert.equal((await readFigures({ home: r.home }, q(r, 'claude-code'))).model, want, String(model));
  }
});

test('an outcome is "stopped" for a log that ends on a token limit, and "unknown" for one that ends on a tool call', async t => {
  const end = (reason: string): unknown[] => [{ type: 'assistant', timestamp: at(1), cwd: '', message: { id: 'a', model: 'm', stop_reason: reason, usage: { input_tokens: 1, output_tokens: 1 } } }];
  for (const [reason, want] of [['end_turn', 'finished'], ['max_tokens', 'stopped'], ['refusal', 'stopped'], ['tool_use', 'unknown'], ['whatever', 'unknown']] as const) {
    const r = rig(t); claudeLog(r, 's1.jsonl', end(reason).map(x => ({ ...(x as object), cwd: r.project })));
    assert.equal((await readFigures({ home: r.home }, q(r, 'claude-code'))).outcome, want, reason);
  }
});

test('a log over the size cap is "unreadable", and a single line over the line cap is skipped without stopping the read', async t => {
  const r = rig(t); claudeLog(r);
  assert.equal((await readFigures({ home: r.home, maxBytes: 100 }, q(r, 'claude-code'))).state, 'unreadable');
  const big = rig(t); claudeLog(big, 's1.jsonl', [JSON.stringify({ type: 'user', timestamp: at(1), cwd: big.project, message: { content: 'x'.repeat(3_000_000) } }), ...claudeRows(big.project)] as never);
  const f = await readFigures({ home: big.home }, q(big, 'claude-code'));
  assert.equal(f.state, 'found'); assert.equal(f.outcome, 'finished');
});

test('a link is never followed: a log that is a link, or a folder that is a link, is not read', async t => {
  const r = rig(t); const real = put(join(r.home, 'elsewhere', 'real.jsonl'), lines(claudeRows(r.project)));
  const folder = join(r.home, '.claude', 'projects', claudeFolderName(r.project)); mkdirSync(folder, { recursive: true });
  symlinkSync(real, join(folder, 'link.jsonl'));
  assert.equal((await readFigures({ home: r.home }, q(r, 'claude-code'))).state, 'not-found');
  const f2 = rig(t); const target = join(f2.home, 'elsewhere'); mkdirSync(target, { recursive: true }); put(join(target, 's.jsonl'), lines(claudeRows(f2.project)));
  mkdirSync(join(f2.home, '.claude', 'projects'), { recursive: true }); symlinkSync(target, join(f2.home, '.claude', 'projects', claudeFolderName(f2.project)));
  assert.equal((await readFigures({ home: f2.home }, q(f2, 'claude-code'))).state, 'not-found');
  const f3 = rig(t); mkdirSync(join(f3.home, '.claude'), { recursive: true }); symlinkSync(target, join(f3.home, '.claude', 'projects'));
  assert.equal((await readFigures({ home: f3.home }, q(f3, 'claude-code'))).state, 'not-found');
});

test('files that are not .jsonl logs in the folder are ignored, and so is the history file of the engine home', async t => {
  const r = rig(t);
  put(join(r.home, '.claude', 'projects', claudeFolderName(r.project), 'notes.txt'), lines(claudeRows(r.project)));
  put(join(r.home, '.claude', 'history.jsonl'), lines(claudeRows(r.project)));
  put(join(r.home, '.claude', 'projects', 'history.jsonl'), lines(claudeRows(r.project)));
  assert.equal((await readFigures({ home: r.home }, q(r, 'claude-code'))).state, 'not-found');
});

test('a log that cannot be opened for its mode is "unreadable" (skipped when the tests run as root)', async t => {
  if (process.getuid?.() === 0) { t.skip('root can open any file'); return; }
  const r = rig(t); const file = claudeLog(r); chmodSync(file, 0o000);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.equal(f.state, 'unreadable'); assert.equal(f.durationMs, null);
});

test('a folder with many logs is read in bounded time: only the newest few hundred are looked at', async t => {
  const r = rig(t);
  const folder = join(r.home, '.claude', 'projects', claudeFolderName(r.project)); mkdirSync(folder, { recursive: true });
  for (let i = 0; i < 700; i += 1) { const f = join(folder, `old-${i}.jsonl`); writeFileSync(f, lines(claudeRows(r.project, 300 + i))); utimesSync(f, new Date(2020, 0, 1), new Date(2020, 0, 1)); }
  claudeLog(r, 'fresh.jsonl');
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.equal(f.state, 'found'); assert.equal(f.startedAt, at(1));
});

test('a project folder that is not an absolute path, or holds a NUL, or a start that is not a time, is "not found"', async t => {
  const r = rig(t); claudeLog(r);
  for (const projectDir of ['relative/path', '', `${r.project}\u0000x`]) assert.equal((await readFigures({ home: r.home }, { engine: 'claude-code', projectDir, startedAt: START })).state, 'not-found', projectDir);
  assert.equal((await readFigures({ home: r.home }, { engine: 'claude-code', projectDir: r.project, startedAt: 'yesterday' })).state, 'not-found');
  assert.equal((await readFigures({ home: 'relative', }, q(r, 'claude-code'))).state, 'not-found');
});

// ---- Codex

test('a Codex log gives the times, the duration, the last token totals, the model and the outcome, and no chat text', async t => {
  const r = rig(t); codexLog(r);
  const f = await readFigures({ home: r.home }, q(r, 'codex'));
  assert.deepEqual(f, { state: 'found', startedAt: at(1), endedAt: at(7, 1), durationMs: 6 * 60_000 + 1000, inputTokens: 250, outputTokens: 90, model: 'gpt-test-1', outcome: 'finished' });
  noText(f);
});

test('a Codex log of another folder is not matched, and one that holds no folder is matched by its time alone', async t => {
  const r = rig(t); codexLog(r, 'rollout-a.jsonl', codexRows(join(r.home, 'Projects', 'other')));
  assert.equal((await readFigures({ home: r.home }, q(r, 'codex'))).state, 'not-found');
  const n = rig(t); codexLog(n, 'rollout-a.jsonl', [{ timestamp: at(1), type: 'session_meta', payload: { id: 'x' } }, { timestamp: at(3), type: 'event_msg', payload: { type: 'task_complete' } }]);
  assert.equal((await readFigures({ home: n.home }, q(n, 'codex'))).state, 'found');
});

test('a Codex run that was stopped by the person is "stopped"', async t => {
  const r = rig(t); codexLog(r, 'rollout-a.jsonl', codexRows(r.project).slice(0, 5).concat([{ timestamp: at(8), type: 'event_msg', payload: { type: 'turn_aborted' } }] as never));
  assert.equal((await readFigures({ home: r.home }, q(r, 'codex'))).outcome, 'stopped');
});

test('Codex logs are looked for in the days around the start, and in no other folder of the sessions tree', async t => {
  const r = rig(t); codexLog(r, 'rollout-a.jsonl', codexRows(r.project), '2026/11/10');
  assert.equal((await readFigures({ home: r.home }, q(r, 'codex'))).state, 'found', 'the day before');
  const far = rig(t); codexLog(far, 'rollout-a.jsonl', codexRows(far.project), '2026/10/01');
  assert.equal((await readFigures({ home: far.home }, q(far, 'codex'))).state, 'not-found');
  const odd = rig(t); codexLog(odd, 'rollout-a.jsonl', codexRows(odd.project), '2026/11/xx');
  assert.equal((await readFigures({ home: odd.home }, q(odd, 'codex'))).state, 'not-found');
});

test('a Codex log with no readable line is unreadable, and one with no usage keeps its figures null', async t => {
  const r = rig(t); codexLog(r, 'rollout-a.jsonl', ['zzz', '{'] as never);
  assert.equal((await readFigures({ home: r.home }, q(r, 'codex'))).state, 'unreadable', 'a log that no line can place is one that could not be read');
  const n = rig(t); codexLog(n, 'rollout-a.jsonl', [{ timestamp: at(1), type: 'session_meta', payload: { cwd: n.project } }, 'zzz', '{'] as never);
  const f = await readFigures({ home: n.home }, q(n, 'codex'));
  assert.equal(f.state, 'found'); assert.deepEqual([f.inputTokens, f.outputTokens, f.model], [null, null, null]);
});

test('the reader reads only the two log folders: nothing else under the home is opened', async t => {
  const r = rig(t);
  // A log in the project folder itself, and one in the engine home outside the log folder, hold a matching run and must not be read.
  put(join(r.project, 's.jsonl'), lines(claudeRows(r.project)));
  put(join(r.home, '.claude', 'other', 's.jsonl'), lines(claudeRows(r.project)));
  put(join(r.home, '.codex', 'rollout-a.jsonl'), lines(codexRows(r.project)));
  for (const engine of ['claude-code', 'codex']) assert.equal((await readFigures({ home: r.home }, q(r, engine))).state, 'not-found', engine);
});
