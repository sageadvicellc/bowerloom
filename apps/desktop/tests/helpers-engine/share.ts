// Set-up for the tests of export and import in main (journey 4): real packages, a real worker thread, made-up folders and made-up values only.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { TestContext } from 'node:test';
import { dirname, join } from 'node:path';
import { createEngineService } from '../../main/engine-service.js';
import type { EngineService, EngineServiceDeps } from '../../main/engine-service.js';
import type { Ask } from '../../main/engine-consent.js';
import type { Answer, FolderInfo, ImportNoteChoices } from '../../shared/engine/types.js';
import { tempDir } from '../support.js';
import { homeFolder } from './folders.js';

export const WHEN = new Date('2026-10-31T12:00:00Z');
export const NO_CHOICES: ImportNoteChoices = { link: {}, leave: [] };
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
export const put = (dir: string, rel: string, text: string | Uint8Array, mode?: number): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
  if (mode !== undefined) chmodSync(join(dir, rel), mode);
};

export function value<T>(a: Answer<T> | null): T {
  if (a === null) throw new Error('expected an answer, got null');
  if (!a.ok) throw new Error(`refused: ${a.refusal.code} ${a.refusal.message}`);
  return a.value;
}
export function refused<T>(a: Answer<T> | null): { code: string; message: string; paths: readonly string[] } {
  if (a === null) throw new Error('expected a refusal, got null');
  if (a.ok) throw new Error('expected a refusal, got an answer');
  return a.refusal;
}
/** The short code a call is refused with before it runs (BAD_ARGUMENT, UNKNOWN_BUNDLE, ...), or null when it did not throw. */
export async function codeOf(run: () => Promise<unknown>): Promise<string | null> {
  try { await run(); return null; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; }
}

/**
 * A harness that holds every kind of thing a bundle reports: instructions, two skills (one with a script that can run), two agents (one reads the notes `yard-wiki`),
 * a stdio server that reads `${YARD_REGION}`, a remote server that sends `${ORDERS_KEY}` in a header, a hook, a rule, and a notes source.
 */
export function richFolder(home: string, name = 'rope-yard', extra: Record<string, string | Uint8Array> = {}): string {
  const dir = join(home, 'Projects', name);
  put(dir, '.bowerloom/harness.json', json({
    format: 'bowerloom/harness/v1beta1', id: name, description: 'Checks the rope orders and tallies the stock.', engines: [{ id: 'claude-code' }, { id: 'codex' }],
    parts: { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/', subagents: 'agents/', guardrails: 'guardrails.json', hooks: 'hooks.json', mcp: 'mcp.json', scripts: 'scripts/' },
  }));
  put(dir, '.bowerloom/instructions/AGENTS.md', '# Rope yard\n\nCount the coils before you report.\n');
  put(dir, '.bowerloom/skills/check-orders/SKILL.md', '---\nname: check-orders\ndescription: Checks each order against the stock.\n---\n\nCheck every order.\n');
  put(dir, '.bowerloom/skills/tally-stock/SKILL.md', '---\nname: tally-stock\ndescription: Counts the coils in the yard.\n---\n\nRun scripts/tally.sh, then report.\n');
  put(dir, '.bowerloom/skills/tally-stock/scripts/tally.sh', '#!/bin/sh\necho 12\n', 0o755);
  put(dir, '.bowerloom/agents/clerk.md', '---\nname: clerk\ndescription: Handles the orders.\nskills:\n  - check-orders\nnotes:\n  - yard-wiki\n---\n\nHandle the orders.\n');
  put(dir, '.bowerloom/agents/counter.md', '---\nname: counter\ndescription: Counts the stock.\nskills:\n  - tally-stock\n---\n\nCount the stock.\n');
  put(dir, '.bowerloom/guardrails.json', json({ rules: [{ id: 'no-force-push', action: 'shell', pattern: 'git push --force *', effect: 'deny', strength: 'enforced' }] }));
  put(dir, '.bowerloom/hooks.json', json({ hooks: [{ id: 'format-check', event: 'PostToolUse', matcher: 'Edit', command: './scripts/format-check.sh', strength: 'advisory' }] }));
  put(dir, '.bowerloom/mcp.json', json({ servers: [
    { name: 'stock-db', transport: 'stdio', command: 'npx', args: ['-y', 'stock-db-server@2.0.1'], env: { YARD_REGION: '${YARD_REGION}' } },
    { name: 'orders-api', transport: 'http', url: 'https://orders.example.test/mcp', headers: { 'X-Key': '${ORDERS_KEY}' } },
  ] }));
  put(dir, '.bowerloom/scripts/format-check.sh', '#!/bin/sh\nexit 0\n', 0o755);
  put(dir, '.bowerloom/knowledge.json', json({ sources: [{ kind: 'wiki-folder', name: 'yard-wiki', path: '~/Documents/yard-wiki' }] }));
  for (const [rel, text] of Object.entries(extra)) put(dir, rel, text);
  return dir;
}

/** A harness with parts but nothing that runs, reads a name from this computer, or names a path: an import of it asks for no acknowledgement. */
export function quietFolder(home: string, name = 'quiet'): string {
  const dir = join(home, 'Projects', name);
  put(dir, '.bowerloom/harness.json', json({ format: 'bowerloom/harness/v1beta1', id: name, description: 'A quiet harness.', engines: [{ id: 'claude-code' }], parts: { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/' } }));
  put(dir, '.bowerloom/instructions/AGENTS.md', '# Quiet\n\nBe brief.\n');
  put(dir, '.bowerloom/skills/brief/SKILL.md', '---\nname: brief\ndescription: Keeps a reply short.\n---\n\nKeep it short.\n');
  return dir;
}

/** A folder with an empty harness: what "Make an empty harness here" writes. */
export function emptyHarnessFolder(home: string, name = 'empty'): string {
  const dir = join(home, 'Projects', name);
  put(dir, '.bowerloom/harness.json', json({ format: 'bowerloom/harness/v1beta1', id: name, description: 'Adopted from the engine files of this project.', engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: {} }));
  return dir;
}

export function plainFolder(home: string, name = 'plain', files: Record<string, string> = { 'README.md': '# Plain\n' }): string {
  const dir = join(home, 'Projects', name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) put(dir, rel, text);
  return dir;
}

export interface Share {
  readonly home: string; readonly base: string; readonly service: EngineService;
  readonly asks: Ask[]; readonly saved: string[]; readonly records: Record<string, unknown>[];
  /** What the dialogs answer next. */
  folder: string | null; open: string | null; save: string | null; notes: string | null; yes: boolean;
  /** Runs before the person's yes, to change the world between the question and the write. */
  beforeYes: (() => void) | null;
  choose(dir: string): Promise<FolderInfo>;
  /** The made-up folder as the file tree it holds. */
  read(rel: string): string;
}

/** One app: its own made-up home, its own state root, its own service and worker. */
export function shareSetup(t: TestContext, name = 'share', extra: Partial<EngineServiceDeps> = {}): Share {
  const base = tempDir(t, `bowerloom-${name}-`);
  const home = homeFolder(base);
  const asks: Ask[] = [], saved: string[] = [], records: Record<string, unknown>[] = [];
  const s: Share = {
    home, base, asks, saved, records, folder: null, open: null, save: null, notes: null, yes: true, beforeYes: null,
    service: undefined as unknown as EngineService,
    choose: async dir => { s.folder = dir; return value(await s.service.chooseFolder()); },
    read: rel => readFileSync(join(base, rel), 'utf8'),
  };
  (s as { service: EngineService }).service = createEngineService({
    home, stateRoot: join(home, '.local', 'state', 'bowerloom'), who: 'tester', now: () => WHEN,
    chooseFolder: async () => s.folder,
    confirm: async ask => { asks.push(ask); s.beforeYes?.(); return s.yes; },
    chooseBundleOpen: async () => s.open,
    chooseBundleSave: async suggested => { saved.push(suggested); return s.save; },
    chooseNotesFolder: async () => s.notes,
    record: input => { records.push({ ...input }); return true; },
    ...extra,
  });
  t.after(() => s.service.close());
  return s;
}

export const exists = (path: string): boolean => existsSync(path);
