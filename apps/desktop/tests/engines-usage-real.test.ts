// The Engines and usage view on what the real reader gives: parts of a harness folder are no orphans, a connection string is a secret and a base address is not, and a summary that was cut says
// "not checked". It runs on small homes made here, in a temporary folder that the test removes. It never reads the real HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { partOfItem, realToHarnessState } from '../shared/harness/real-map.js';
import type { HarnessState } from '../shared/harness/types.js';
import type { HarnessItem } from '../shared/world/types.js';
import { ENGINES_WORDS, enginesView } from '../shared/engines-usage/model.js';
import type { UsageSource } from '../shared/engines-usage/model.js';
import { tempDir } from './support.js';

const NOW_MS = Date.UTC(2026, 10, 13);
const none: UsageSource = { kind: 'ready', runs: [], reads: new Map(), total: 0 };
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const harness = (id: string): string => json({ format: 'bowerloom/harness/v1beta1', id, description: 'A harness.', engines: [{ id: 'claude-code' }], parts: { skills: 'skills/', subagents: 'agents/' } });
const agent = (name: string): string => `---\nname: ${name}\ndescription: Is ${name}.\n---\nBody.\n`;

async function read(t: TestContext, setup: (home: string) => void): Promise<{ result: RealResult; places: readonly RealPlace[]; state: HarnessState }> {
  const home = tempDir(t, 'bowerloom-engines-real-');
  setup(home);
  const scanner = createScanner({ home });
  const places: RealPlace[] = [...(await scanner.discover()).places, ...(await scanner.addFolder(join(home, 'work'))).places];
  const batch = await scanner.read(places.map(p => p.id));
  const result = buildRealResult(batch.reads, batch.tally, { nowMs: NOW_MS, foldExtraApps: true });
  return { result, places, state: realToHarnessState(result, places) };
}

test('a folder with a Bowerloom harness (an agent and a notes folder it holds) gives no "no known folder" note, through the real library shape', async t => {
  const { state } = await read(t, home => {
    const dir = join(home, 'work', 'proj', '.bowerloom');
    put(join(dir, 'harness.json'), harness('proj'));
    put(join(dir, 'agents', 'wiki-keeper.md'), agent('wiki-keeper'));
    put(join(dir, 'knowledge.json'), json({ sources: [{ name: 'journal', kind: 'wiki-folder', path: '~/journal' }] }));
  });
  const held = state.parts.filter(p => p.fromHarness !== undefined);
  assert.ok(held.length >= 2, 'the shape the library gives: a place id as origin, and fromHarness set');
  assert.ok(held.every(p => !state.sources.some(s => s.id === p.origin)), 'and no source has that origin, which is what made the false note');
  const view = enginesView(state, none);
  assert.equal(view.notes.some(n => /no known folder/.test(n)), false, view.notes.join(' | '));
});

const serverHome = (servers: Record<string, unknown>) => (home: string): void => { put(join(home, 'work', 'alpha', '.mcp.json'), JSON.stringify({ mcpServers: servers })); };
const flagsOf = (state: HarnessState): Map<string, boolean> => new Map(enginesView(state, none).rows.flatMap(r => r.connections).map(c => [c.name, c.secretSet] as const));

test('a base address or an API address is no secret, and a connection string, a PAT and a DSN are', async t => {
  const { state } = await read(t, serverHome({
    baseurl: { command: 'a', env: { BASE_URL: 'https://a.example.test' } }, apiurl: { command: 'a', env: { API_URL: 'https://a.example.test' } }, jira: { command: 'a', env: { JIRA_URL: 'https://a.example.test' } },
    ollama: { command: 'a', env: { OLLAMA_BASE_URL: 'http://127.0.0.1:11434' } },
    database: { command: 'a', env: { DATABASE_URL: 'postgres://u:p@h/db' } }, redis: { command: 'a', env: { REDIS_URL: 'redis://h' } }, mongo: { command: 'a', env: { MONGODB_URL: 'mongodb://h' } },
    postgres: { command: 'a', env: { POSTGRES_URL: 'postgres://h' } }, dsn: { command: 'a', env: { SENTRY_DSN: 'https://k@h/1' } }, conn: { command: 'a', env: { DB_CONNECTION_STRING: 'Server=h' } },
    pat: { command: 'a', env: { GITHUB_PAT: 'x' } },
  }));
  const flags = flagsOf(state);
  for (const name of ['baseurl', 'apiurl', 'jira', 'ollama']) assert.equal(flags.get(name), false, name);
  for (const name of ['database', 'redis', 'mongo', 'postgres', 'dsn', 'conn', 'pat']) assert.equal(flags.get(name), true, name);
});

test('a connection that the whole read found nothing secret in is not marked "not checked"', async t => {
  const { state } = await read(t, serverHome({ plain: { command: 'plain-server' } }));
  const plain = enginesView(state, none).rows.flatMap(r => r.connections).find(c => c.name === 'plain')!;
  assert.deepEqual([plain.secretSet, plain.secretNotChecked], [false, false]);
});

test('a connection whose summary was cut or cannot be read says "not checked"', async t => {
  const { result, state } = await read(t, serverHome({ plain: { command: 'plain-server' } }));
  const item = result.world.items.find(i => i.kind === 'tool' && i.name === 'plain') as HarnessItem;
  assert.ok(item, 'the connection was read');
  for (const text of ['{"server":"plain","env":["A', '', 'not json']) {
    const cutItem = { ...item, foundAt: item.foundAt.map(f => ({ ...f, text })) } as HarnessItem;
    const part = partOfItem(cutItem, 'src-x', 'label', result.world);
    assert.equal(part.secretUnchecked, true, JSON.stringify(text));
    assert.equal(part.hasSecret, undefined);
  }
  const whole = state.parts.find(p => p.name === 'plain')!;
  assert.equal(whole.secretUnchecked, undefined, 'a summary that parses is checked');
  assert.ok(ENGINES_WORDS.secretNotChecked.length > 0);
});

test('a connection string written as an address with URI is a secret, a bare CONNECTION_STRING is too, and BASE_URI and API_URL are not', async t => {
  const { state } = await read(t, serverHome({
    mongouri: { command: 'a', env: { MONGODB_URI: 'mongodb://h' } }, dburi: { command: 'a', env: { DATABASE_URI: 'postgres://h' } }, redisuri: { command: 'a', env: { REDIS_URI: 'redis://h' } },
    bare: { command: 'a', env: { CONNECTION_STRING: 'Server=h' } },
    baseuri: { command: 'a', env: { BASE_URI: 'https://a.example.test' } }, apiurl2: { command: 'a', env: { API_URL: 'https://a.example.test' } },
  }));
  const flags = flagsOf(state);
  for (const name of ['mongouri', 'dburi', 'redisuri', 'bare']) assert.equal(flags.get(name), true, name);
  for (const name of ['baseuri', 'apiurl2']) assert.equal(flags.get(name), false, name);
});
