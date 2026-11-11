/**
 * Shared set-up for the specs of Runs and Compare on the person's own folders (harness-runs-real, harness-compare-real): made-up session logs in a made-up home, and the steps that register a folder and add a run
 * through the form. The logs are in the shapes the reader is written to expect (main/run-logs.ts); no real vendor log is used, and every log holds the marker text so a spec can prove no chat text reaches the page.
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeFolderName } from '../main/run-logs.js';
import { isoToLocalInput } from '../renderer/harness/clock.js';
import type { RealHarness } from './harness-real-page.js';
import { RUN_CHANNELS } from '../shared/api/runs.js';
import type { RunCall } from '../shared/api/runs.js';

/** Text that is in every made-up log, as if it were a prompt or a reply. It must never reach the window, the saved file or the log of the app. */
export const MARK = 'SECRET-CHAT-TEXT-9f3a';

const iso = (ms: number): string => new Date(ms).toISOString();
const put = (file: string, rows: readonly unknown[]): void => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, `${rows.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`); };

/** A Claude Code log for a folder: it begins one minute after `startMs`, runs four minutes, counts 19 in and 14 out, and ends in a finished turn. */
export function claudeLog(home: string, dir: string, startMs: number, name = 's1.jsonl'): void {
  const at = (s: number): string => iso(startMs + s * 1000);
  put(join(home, '.claude', 'projects', claudeFolderName(dir), name), [
    { type: 'user', timestamp: at(60), cwd: dir, message: { role: 'user', content: `${MARK} please fix` } },
    { type: 'assistant', timestamp: at(80), cwd: dir, message: { id: 'm1', model: 'claude-test-1', content: [{ type: 'text', text: MARK }], stop_reason: 'tool_use', usage: { input_tokens: 3, output_tokens: 8, cache_creation_input_tokens: 2, cache_read_input_tokens: 10 } } },
    { type: 'assistant', timestamp: at(300), cwd: dir, message: { id: 'm2', model: 'claude-test-1', content: [{ type: 'text', text: MARK }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 6, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
  ]);
}

/** A Codex log for a folder: it begins two minutes after `startMs`, runs six minutes, counts 250 in and 90 out, and ends in a finished turn. */
export function codexLog(home: string, dir: string, startMs: number): void {
  const at = (s: number): string => iso(startMs + s * 1000);
  const d = new Date(startMs + 120_000), two = (n: number): string => String(n).padStart(2, '0');
  put(join(home, '.codex', 'sessions', String(d.getUTCFullYear()), two(d.getUTCMonth() + 1), two(d.getUTCDate()), 'rollout-a.jsonl'), [
    { timestamp: at(120), type: 'session_meta', payload: { id: 'abc', cwd: dir, instructions: MARK } },
    { timestamp: at(121), type: 'turn_context', payload: { cwd: dir, model: 'gpt-test-1' } },
    { timestamp: at(125), type: 'event_msg', payload: { type: 'user_message', message: MARK } },
    { timestamp: at(480), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 250, output_tokens: 90 } } } },
    { timestamp: at(481), type: 'event_msg', payload: { type: 'task_complete', last_agent_message: MARK } },
  ]);
}

/** A Claude Code log that no line of can be placed in time. */
export function garbageClaudeLog(home: string, dir: string): void { put(join(home, '.claude', 'projects', claudeFolderName(dir), 'bad.jsonl'), ['not json at all', '{"broken":']); }

/** A start time one hour ago, to the minute, so every made-up log sits inside the window the reader looks in. */
export const startedMs = (): number => Math.floor((Date.now() - 3_600_000) / 60_000) * 60_000;

/** Registers a folder through main's chooser (answered by the test), from the Harnesses screen. */
export async function registerFolder(h: RealHarness, dir: string): Promise<void> {
  const p = h.page;
  await p.evaluate(() => { location.hash = '#app/harnesses'; });
  await h.pick(dir);
  await p.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await expect(p.locator('[data-folder-row]').first()).toBeVisible();
}

export const goTo = async (p: Page, hash: string): Promise<void> => { await p.evaluate(to => { location.hash = to; }, hash); };

export interface AddRun { readonly engine: string; readonly instruction: string; readonly startMs: number }

/** Opens "Add a run" and fills it, without saving. Returns the sheet. The folder is the first one in the list. */
export async function fillAddRun(p: Page, run: AddRun): Promise<Locator> {
  await goTo(p, '#app/runs');
  await p.locator('[data-add-run]').click();
  const sheet: Locator = p.locator('[data-slot="add-run"]');
  await expect(sheet.getByRole('heading', { name: 'Add a run', exact: true })).toBeVisible();
  await expect(sheet.locator('#har-project option')).not.toHaveCount(1);
  await sheet.locator('#har-project').selectOption({ index: 1 });
  await sheet.locator('#har-engine').selectOption({ label: run.engine });
  await sheet.locator('#har-instruction').fill(run.instruction);
  await sheet.locator('#har-when').fill(isoToLocalInput(run.startMs));
  await expect(sheet.locator('[data-save-run]')).toBeEnabled();
  return sheet;
}

/** Opens "Add a run", fills it and saves it. */
export async function addRun(p: Page, run: AddRun): Promise<void> {
  const sheet = await fillAddRun(p, run);
  await sheet.locator('[data-save-run]').click();
  await expect(sheet).toHaveCount(0);
}

/**
 * Holds the answers of one runs call in main until the test lets them go, and counts the calls that reached main. The handler main registered is wrapped, so the call still runs the real code when it is let go.
 * (Electron keeps its handlers in a map that the test reaches through the main process only.)
 */
export async function gateCall(h: RealHarness, call: RunCall, hold = true): Promise<void> {
  await h.app.evaluate(({ ipcMain }, [channel, held]) => {
    const g = globalThis as unknown as { __gates?: Record<string, { calls: number; open: boolean; waiters: (() => void)[] }> };
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (e: unknown, ...a: unknown[]) => unknown> })._invokeHandlers;
    const old = handlers.get(channel!);
    if (old === undefined) throw new Error(`no handler on ${channel}`);
    g.__gates ??= {};
    const st = { calls: 0, open: !held, waiters: [] as (() => void)[] };
    g.__gates[channel!] = st;
    ipcMain.removeHandler(channel!);
    ipcMain.handle(channel!, async (e, ...a) => { st.calls += 1; if (!st.open) await new Promise<void>(r => st.waiters.push(r)); return old(e, ...a); });
  }, [RUN_CHANNELS[call], hold] as const);
}
export const gateCalls = (h: RealHarness, call: RunCall): Promise<number> => h.app.evaluate((_e, channel) => (globalThis as unknown as { __gates: Record<string, { calls: number }> }).__gates[channel]!.calls, RUN_CHANNELS[call]);
export const gateRelease = (h: RealHarness, call: RunCall): Promise<void> => h.app.evaluate((_e, channel) => { const st = (globalThis as unknown as { __gates: Record<string, { open: boolean; waiters: (() => void)[] }> }).__gates[channel]!; st.open = true; for (const w of st.waiters.splice(0)) w(); }, RUN_CHANNELS[call]);
