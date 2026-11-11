// The reader of an engine's own session log (main/run-logs.ts). The logs here are made up, in a made-up home. The line shapes are the ones observed on 2026-11-11 (key names only); how Claude Code names
// the folder of a non-ASCII or very long path, and which time zone the Codex day folders use, are not verified, so the reader is tolerant and these tests hold the tolerance: an unknown shape is a visible state, never a crash and never a zero.
// A prompt or a reply in a log never reaches the answer: the answer is numbers and short words, and the tests look for a marker text that is in every log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { claudeFolderName, readFigures } from '../main/run-logs.js';
import { tempDir } from './support.js';

const MARK = 'SECRET-CHAT-TEXT-9f3a';
const START = '2026-11-11T10:30:00.000Z';
const FIGURE_KEYS = ['durationMs', 'endedAt', 'inputTokens', 'model', 'outcome', 'outputTokens', 'reason', 'startedAt', 'state'];

interface Rig { readonly home: string; readonly project: string }
function rig(t: TestContext): Rig {
  const home = tempDir(t);
  const project = join(home, 'Projects', 'team.app');
  mkdirSync(project, { recursive: true });
  return { home, project };
}
const lines = (rows: readonly unknown[]): string => `${rows.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`;
/** Every made-up log was last changed an hour after the recorded start, so the clock of the machine never decides which logs are new enough. */
const CHANGED = new Date(Date.parse(START) + 3_600_000);
const put = (file: string, text: string): string => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); utimesSync(file, CHANGED, CHANGED); return file; };
const at = (minutes: number, seconds = 0): string => new Date(Date.parse(START) + minutes * 60_000 + seconds * 1000).toISOString();

const claudeRows = (cwd: string, first = 1): unknown[] => [
  { type: 'user', timestamp: at(first), cwd, message: { role: 'user', content: `${MARK} please fix` } },
  { type: 'assistant', timestamp: at(first, 20), cwd, message: { id: 'm1', model: 'claude-test-1', role: 'assistant', content: [{ type: 'text', text: MARK }], stop_reason: 'tool_use', usage: { input_tokens: 3, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 10 } } },
  { type: 'assistant', timestamp: at(first, 20), cwd, message: { id: 'm1', model: 'claude-test-1', role: 'assistant', content: [{ type: 'text', text: MARK }], stop_reason: 'tool_use', usage: { input_tokens: 3, output_tokens: 8, cache_creation_input_tokens: 2, cache_read_input_tokens: 10 } } },
  { type: 'assistant', timestamp: at(first + 4), cwd, message: { id: 'm2', model: 'claude-test-1', role: 'assistant', content: [{ type: 'text', text: MARK }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 6, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
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

const q = (r: Rig, engine: string, startedAt = START, siblings: readonly string[] = []): { engine: never; projectDir: string; startedAt: string; siblings: { startedAt: string }[] } => ({ engine: engine as never, projectDir: r.project, startedAt, siblings: siblings.map(x => ({ startedAt: x })) });
const noText = (value: unknown): void => assert.equal(JSON.stringify(value).includes(MARK), false, 'chat text reached the answer');

// ---- Claude Code

test('a Claude Code log gives the times, the duration, the tokens, the model and the outcome, and no chat text', async t => {
  const r = rig(t); claudeLog(r);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.deepEqual(f, { state: 'found', reason: null, startedAt: at(1), endedAt: at(5), durationMs: 4 * 60_000, inputTokens: 3 + 2 + 10 + 4, outputTokens: 8 + 6, model: 'claude-test-1', outcome: 'finished' });
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

test('of several logs of one run the one that began nearest the recorded start is read, and one outside the hour is not', async t => {
  const r = rig(t);
  claudeLog(r, 'far.jsonl', claudeRows(r.project, 240));
  claudeLog(r, 'early.jsonl', claudeRows(r.project, -90));
  claudeLog(r, 'near.jsonl', claudeRows(r.project, 2));
  claudeLog(r, 'next.jsonl', claudeRows(r.project, 90));
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.equal(f.startedAt, at(2));
  const none = rig(t); claudeLog(none, 'far.jsonl', claudeRows(none.project, 240));
  assert.equal((await readFigures({ home: none.home }, q(none, 'claude-code'))).state, 'not-found');
});

test('no log folder, no engine home, or a folder that is gone is "not found", with every figure null', async t => {
  const r = rig(t);
  for (const f of [await readFigures({ home: r.home }, q(r, 'claude-code')), await readFigures({ home: r.home }, q(r, 'codex')), await readFigures({ home: join(r.home, 'nope') }, q(r, 'claude-code'))]) {
    assert.deepEqual(f, { state: 'not-found', reason: null, startedAt: null, endedAt: null, durationMs: null, inputTokens: null, outputTokens: null, model: null, outcome: 'unknown' });
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

test('a log with a line that could not be read has no counts, says so, and keeps the times, the model and the outcome', async t => {
  const r = rig(t); claudeLog(r, 's1.jsonl', ['garbage', ...claudeRows(r.project), '{"type":'] as never);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.equal(f.state, 'found'); assert.equal(f.reason, 'partial');
  assert.deepEqual([f.inputTokens, f.outputTokens], [null, null], 'a count that may be short is not shown');
  assert.deepEqual([f.durationMs, f.model, f.outcome], [4 * 60_000, 'claude-test-1', 'finished']);
  const blank = rig(t); claudeLog(blank, 's1.jsonl', ['', '   ', ...claudeRows(blank.project)] as never);
  assert.equal((await readFigures({ home: blank.home }, q(blank, 'claude-code'))).outputTokens, 14, 'a blank line is not a skipped line');
});

test('a log with times and no usage keeps the tokens null, not zero, and no model is null too', async t => {
  const r = rig(t); claudeLog(r, 's1.jsonl', [{ type: 'user', timestamp: at(1), cwd: r.project, message: { content: MARK } }, { type: 'assistant', timestamp: at(3), cwd: r.project, message: { content: MARK } }]);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.deepEqual(f, { state: 'found', reason: null, startedAt: at(1), endedAt: at(3), durationMs: 120_000, inputTokens: null, outputTokens: null, model: null, outcome: 'unknown' });
});

test('numbers that cannot be counts (strings, negatives, fractions, huge, not finite) are never added as zero: a message with one of them has no count, and so has the total', async t => {
  const row = (id: string, usage: unknown): unknown => ({ type: 'assistant', timestamp: at(2), cwd: '', message: { id, model: 'm', usage } });
  const whole = { input_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 9 };
  const mk = (rows: unknown[]): Rig => { const r = rig(t); claudeLog(r, 's1.jsonl', rows.map(x => ({ ...(x as object), cwd: r.project }))); return r; };
  const ok = mk([row('e', whole)]);
  const good = await readFigures({ home: ok.home }, q(ok, 'claude-code'));
  assert.deepEqual([good.inputTokens, good.outputTokens], [7, 9]);
  for (const bad of [{ ...whole, input_tokens: '5' }, { ...whole, output_tokens: -3 }, { ...whole, input_tokens: 1.5 }, { ...whole, output_tokens: 1e30 }, { ...whole, input_tokens: null }, { ...whole, output_tokens: [1] }, 'x']) {
    const r = mk([row('e', whole), row('f', bad)]);
    const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
    if (typeof bad === 'object' && 'input_tokens' in bad && bad.input_tokens === whole.input_tokens) assert.equal(f.inputTokens, 14, 'the input of every message is whole');
    else if (bad !== 'x') assert.equal(f.inputTokens, null, JSON.stringify(bad));
    if (typeof bad === 'object' && bad.output_tokens !== whole.output_tokens) assert.equal(f.outputTokens, null, JSON.stringify(bad));
  }
});

test('a message that lacks a part of its input has no input total, and one that lacks its output has no output total, while the other stays', async t => {
  const r = rig(t);
  claudeLog(r, 's1.jsonl', [
    { type: 'assistant', timestamp: at(2), cwd: r.project, message: { id: 'a', model: 'm', usage: { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1, output_tokens: 5 } } },
    { type: 'assistant', timestamp: at(3), cwd: r.project, message: { id: 'b', model: 'm', usage: { input_tokens: 2, output_tokens: 6 } } },
  ]);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.deepEqual([f.inputTokens, f.outputTokens], [null, 11]);
});

test('lines of one message id are kept once, the most complete value of each count is kept, and a later line never lowers a known value', async t => {
  const r = rig(t);
  const line = (usage: unknown, s: number): unknown => ({ type: 'assistant', timestamp: at(s), cwd: r.project, message: { id: 'same', model: 'm', usage } });
  claudeLog(r, 's1.jsonl', [
    line({ input_tokens: 3, cache_creation_input_tokens: 2, cache_read_input_tokens: 10, output_tokens: 8 }, 2),
    line({ input_tokens: 3, cache_creation_input_tokens: 2, cache_read_input_tokens: 10, output_tokens: 1 }, 3),
    line({ input_tokens: 3, output_tokens: 9 }, 4),
  ]);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.deepEqual([f.inputTokens, f.outputTokens], [15, 9]);
});

test('a usage line with no message id makes the counts null, and the model and the times stay', async t => {
  const r = rig(t);
  claudeLog(r, 's1.jsonl', [{ type: 'assistant', timestamp: at(2), cwd: r.project, message: { model: 'm', usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } } }, ...claudeRows(r.project, 3)]);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.deepEqual([f.state, f.inputTokens, f.outputTokens, f.model], ['found', null, null, 'claude-test-1']);
});

test('the duration needs two different times: one timestamp gives none', async t => {
  const r = rig(t);
  claudeLog(r, 's1.jsonl', [{ type: 'user', timestamp: at(2), cwd: r.project, message: { content: MARK } }, { type: 'user', timestamp: at(2), cwd: r.project, message: { content: MARK } }]);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.deepEqual([f.state, f.durationMs, f.endedAt, f.startedAt], ['found', null, null, at(2)]);
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
  const big0 = await readFigures({ home: r.home, maxBytes: 100 }, q(r, 'claude-code'));
  assert.deepEqual([big0.state, big0.reason], ['unreadable', 'too-large']);
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

const manyLogs = (r: Rig, n: number): string => {
  const folder = join(r.home, '.claude', 'projects', claudeFolderName(r.project)); mkdirSync(folder, { recursive: true });
  for (let i = 0; i < n; i += 1) { const f = join(folder, `other-${i}.jsonl`); writeFileSync(f, lines(claudeRows(r.project, 300 + i))); utimesSync(f, CHANGED, CHANGED); }
  return folder;
};

test('a folder with many logs is read in bounded time: only the newest 300 are looked at, so a newer log is still found', async t => {
  const r = rig(t); manyLogs(r, 700);
  const f0 = claudeLog(r, 'fresh.jsonl'); const later = new Date(CHANGED.getTime() + 3_600_000); utimesSync(f0, later, later);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.equal(f.state, 'found'); assert.equal(f.startedAt, at(1));
});

test('when the cap of 300 is hit and no log matches, the answer says only the newest 300 were searched', async t => {
  const r = rig(t); manyLogs(r, 400);
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.deepEqual([f.state, f.reason], ['not-found', 'capped']);
  const few = rig(t); manyLogs(few, 10);
  assert.equal((await readFigures({ home: few.home }, q(few, 'claude-code'))).reason, null, 'under the cap there is nothing to say');
});

test('a log last changed before the window began is not looked at, so old logs never fill the cap or sit beside a match', async t => {
  const r = rig(t); const old = claudeLog(r, 'old.jsonl', claudeRows(r.project, 2)); const past = new Date(Date.parse(START) - 3 * 3_600_000); utimesSync(old, past, past);
  assert.equal((await readFigures({ home: r.home }, q(r, 'claude-code'))).state, 'not-found');
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
  assert.deepEqual(f, { state: 'found', reason: null, startedAt: at(1), endedAt: at(7, 1), durationMs: 6 * 60_000 + 1000, inputTokens: 250, outputTokens: 90, model: 'gpt-test-1', outcome: 'finished' });
  noText(f);
});

test('a Codex log of another folder is not matched, and one that names no folder is not a candidate at all', async t => {
  const r = rig(t); codexLog(r, 'rollout-a.jsonl', codexRows(join(r.home, 'Projects', 'other')));
  assert.equal((await readFigures({ home: r.home }, q(r, 'codex'))).state, 'not-found');
  const n = rig(t); codexLog(n, 'rollout-a.jsonl', [{ timestamp: at(1), type: 'session_meta', payload: { id: 'x' } }, { timestamp: at(3), type: 'event_msg', payload: { type: 'task_complete' } }]);
  assert.equal((await readFigures({ home: n.home }, q(n, 'codex'))).state, 'not-found');
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
  assert.deepEqual([f.state, f.reason], ['found', 'partial']); assert.deepEqual([f.inputTokens, f.outputTokens, f.model], [null, null, null]);
});

test('the reader reads only the two log folders: nothing else under the home is opened', async t => {
  const r = rig(t);
  // A log in the project folder itself, and one in the engine home outside the log folder, hold a matching run and must not be read.
  put(join(r.project, 's.jsonl'), lines(claudeRows(r.project)));
  put(join(r.home, '.claude', 'other', 's.jsonl'), lines(claudeRows(r.project)));
  put(join(r.home, '.codex', 'rollout-a.jsonl'), lines(codexRows(r.project)));
  for (const engine of ['claude-code', 'codex']) assert.equal((await readFigures({ home: r.home }, q(r, engine))).state, 'not-found', engine);
});

// ---- one log for one run

test('two runs in one folder each get their own log, the smallest gap first, and a run with no log of its own has none', async t => {
  const r = rig(t);
  claudeLog(r, 'a.jsonl', claudeRows(r.project, 1));
  claudeLog(r, 'b.jsonl', claudeRows(r.project, 31));
  const second = at(30);
  const one = await readFigures({ home: r.home }, q(r, 'claude-code', START, [second]));
  const two = await readFigures({ home: r.home }, q(r, 'claude-code', second, [START]));
  assert.equal(one.startedAt, at(1)); assert.equal(two.startedAt, at(31));
  // One log for two runs: the nearer run takes it, and the other has none of its own.
  const single = rig(t); claudeLog(single, 'a.jsonl', claudeRows(single.project, 1));
  assert.equal((await readFigures({ home: single.home }, q(single, 'claude-code', START, [at(20)]))).state, 'found');
  const loser = await readFigures({ home: single.home }, q(single, 'claude-code', at(20), [START]));
  assert.deepEqual([loser.state, loser.startedAt], ['not-found', null]);
});

test('a session of the person in the same folder that fits the run makes the answer "ambiguous", and nothing is read', async t => {
  const r = rig(t);
  claudeLog(r, 'mine.jsonl', claudeRows(r.project, 1));
  claudeLog(r, 'outside.jsonl', claudeRows(r.project, 5));
  const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.deepEqual(f, { state: 'ambiguous', reason: null, startedAt: null, endedAt: null, durationMs: null, inputTokens: null, outputTokens: null, model: null, outcome: 'unknown' });
  // Two logs and two runs: no log is left over, so neither run is ambiguous.
  const both = await readFigures({ home: r.home }, q(r, 'claude-code', START, [at(5)]));
  assert.equal(both.state, 'found');
});

test('a file that could not be placed in time beside a placed one is "ambiguous", and alone it is "unreadable: unplaced"', async t => {
  const r = rig(t); claudeLog(r, 's1.jsonl'); put(join(r.home, '.claude', 'projects', claudeFolderName(r.project), 'bad.jsonl'), 'not json\n');
  assert.equal((await readFigures({ home: r.home }, q(r, 'claude-code'))).state, 'ambiguous');
  const alone = rig(t); put(join(alone.home, '.claude', 'projects', claudeFolderName(alone.project), 'bad.jsonl'), 'not json\n');
  const f = await readFigures({ home: alone.home }, q(alone, 'claude-code'));
  assert.deepEqual([f.state, f.reason], ['unreadable', 'unplaced']);
});

test('the window is an hour before the start and an hour after it', async t => {
  for (const [minutes, want] of [[-59, 'found'], [-61, 'not-found'], [59, 'found'], [61, 'not-found']] as const) {
    const r = rig(t); claudeLog(r, 's1.jsonl', claudeRows(r.project, minutes));
    const f = await readFigures({ home: r.home }, q(r, 'claude-code'));
    assert.equal(f.state, want, `${minutes} minutes`);
  }
});

// ---- the folder, the engine homes

test('a project reached through a link is matched by its real place, and a log that names the other spelling is matched too', async t => {
  const r = rig(t);
  const link = join(r.home, 'via-link'); symlinkSync(join(r.home, 'Projects'), link);
  const real = join(r.home, 'Projects', 'team.app');
  claudeLog({ home: r.home, project: real }, 's1.jsonl');
  const f = await readFigures({ home: r.home }, { engine: 'claude-code', projectDir: join(link, 'team.app'), startedAt: START });
  assert.equal(f.state, 'found', 'the folder name of Claude Code is made from the real path');
  const codex = rig(t); const l2 = join(codex.home, 'via-link'); symlinkSync(join(codex.home, 'Projects'), l2);
  codexLog(codex, 'rollout-a.jsonl', codexRows(join(l2, 'team.app')));
  assert.equal((await readFigures({ home: codex.home }, { engine: 'codex', projectDir: codex.project, startedAt: START })).state, 'found', 'a cwd that is a link to the folder is the folder');
});

test('a home that is itself reached through a link is read, and so is an engine home that is a link: each is resolved once, and below it nothing is followed', async t => {
  const r = rig(t); claudeLog(r);
  const other = tempDir(t); const homeLink = join(other, 'home-link'); symlinkSync(r.home, homeLink);
  assert.equal((await readFigures({ home: homeLink }, q(r, 'claude-code'))).state, 'found');
  const dotfiles = tempDir(t); symlinkSync(join(r.home, '.claude'), join(dotfiles, '.claude'));
  assert.equal((await readFigures({ home: dotfiles }, q(r, 'claude-code'))).state, 'found');
});

test('a folder name with non-ASCII characters is matched through the same rule, and a very long one is not cut', async t => {
  const home = tempDir(t); const project = join(home, 'Projekte', `r\u00e9sum\u00e9-${'x'.repeat(150)}`); mkdirSync(project, { recursive: true });
  const r = { home, project };
  claudeLog(r, 's1.jsonl');
  assert.equal((await readFigures({ home }, q(r, 'claude-code'))).state, 'found');
  assert.equal(claudeFolderName('/a/r\u0065\u0301sum\u00e9'), claudeFolderName('/a/r\u00e9sum\u00e9'), 'a composed and a decomposed spelling give one name');
});

// ---- why a figure is missing

test('a log that ends on a tool call, or has no finished turn in Codex, says it may still be written; a log with nothing in it says so', async t => {
  const tool = rig(t); claudeLog(tool, 's1.jsonl', claudeRows(tool.project).slice(0, 3));
  assert.deepEqual([(await readFigures({ home: tool.home }, q(tool, 'claude-code'))).state, (await readFigures({ home: tool.home }, q(tool, 'claude-code'))).reason], ['found', 'still-writing']);
  const cx = rig(t); codexLog(cx, 'rollout-a.jsonl', codexRows(cx.project).slice(0, 5));
  assert.equal((await readFigures({ home: cx.home }, q(cx, 'codex'))).reason, 'still-writing');
  const done = rig(t); claudeLog(done);
  assert.equal((await readFigures({ home: done.home }, q(done, 'claude-code'))).reason, null);
  const empty = rig(t); claudeLog(empty, 's1.jsonl', [{ type: 'summary', timestamp: at(2), cwd: empty.project }]);
  const f = await readFigures({ home: empty.home }, q(empty, 'claude-code'));
  assert.deepEqual([f.state, f.reason, f.durationMs, f.model, f.inputTokens], ['found', 'no-figures', null, null, null]);
});

test('a log that cannot be opened for its mode is "unreadable: no permission", whether it fails when it is placed or when it is read (the open call is replaced, so root and others run it the same)', async t => {
  const r = rig(t); claudeLog(r);
  const denied = (): never => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  const f = await readFigures({ home: r.home, openFile: denied as never }, q(r, 'claude-code'));
  assert.deepEqual([f.state, f.reason, f.durationMs], ['unreadable', 'no-permission', null]);
  let calls = 0; const realOpen = (await import('node:fs/promises')).open;
  const late = (async (...args: Parameters<typeof realOpen>) => { calls += 1; if (calls > 1) throw Object.assign(new Error('denied'), { code: 'EPERM' }); return realOpen(...args); }) as typeof realOpen;
  const g = await readFigures({ home: r.home, openFile: late }, q(r, 'claude-code'));
  assert.deepEqual([g.state, g.reason], ['unreadable', 'no-permission']);
});

test('the reads are asynchronous: the answer is a promise, and the caller can do other work while a log is read', async t => {
  const r = rig(t); claudeLog(r);
  let ticked = false; const timer = setImmediate(() => { ticked = true; });
  const pending = readFigures({ home: r.home }, q(r, 'claude-code'));
  assert.ok(pending instanceof Promise);
  await pending; clearImmediate(timer);
  assert.equal(ticked, true, 'the event loop ran while the log was read');
});
