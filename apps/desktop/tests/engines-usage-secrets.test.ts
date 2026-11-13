// The config view never shows a secret. These tests build made-up home folders for the three engines, with fake keys, tokens, passwords and `env` values in every place a config can hold them,
// read them with the real reader, and run the view on what the reader gave. No fake value, and no name of a variable that holds one, may appear in the view or in the markup. The view says only
// that a connection has a secret set. Nothing is read from the real home folder: the folders are made here, in a temporary folder that the test removes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createScanner } from '../main/real-scan.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealPlace } from '../shared/real/types.js';
import { realToHarnessState } from '../shared/harness/real-map.js';
import type { HarnessState } from '../shared/harness/types.js';
import { ENGINES_WORDS, enginesView } from '../shared/engines-usage/model.js';
import type { UsageSource } from '../shared/engines-usage/model.js';
import { EnginesUsageBody } from '../renderer/harness/engines-usage/EnginesUsage.js';
import { tempDir } from './support.js';
import { FAKE_KEY } from './engines-usage-fixture.js';

const SECRET = 'zq9-N5-FAKE-VALUE-4410';
/** The names of the variables and headers that hold a secret. A view may say a secret is set. It must not say what holds it. */
const SECRET_NAMES = ['TRACKER_API_KEY', 'ALPHA_PASSWORD', 'DOCS_TOKEN', 'CODEXDB_SECRET_KEY', 'OPENCODE_API_KEY', 'Authorization', 'SOME_VALUE'];
const NOW_MS = Date.UTC(2026, 10, 12);

const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

/** A made-up home with the three engines. Each connection has a name of its own, so that no two engines share one. */
function makeHome(t: TestContext): { home: string; work: string } {
  const home = tempDir(t, 'bowerloom-engines-usage-'), work = join(home, 'work');
  put(join(home, '.claude', 'skills', 'write-reply', 'SKILL.md'), '---\nname: Write a reply\ndescription: Drafts a reply for you to check.\n---\nWrite.\n');
  put(join(home, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reads a change and says what is risky.\nmodel: sonnet\n---\nReview.\n');
  put(join(home, '.claude', 'commands', 'ship.md'), '---\ndescription: Run the checks and ship.\n---\nRun the checks.\n');
  put(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: `./format.sh ${SECRET}` }] }] }, env: { SOME_VALUE: SECRET } }));
  put(join(home, '.claude.json'), JSON.stringify({
    userID: SECRET, oauthAccount: { emailAddress: 'someone@example.test', accessToken: SECRET },
    mcpServers: {
      tracker: { command: '/usr/local/bin/node', args: ['server.js', `--token=${SECRET}`], env: { TRACKER_API_KEY: SECRET, REGION: 'eu' } },
      remote: { type: 'http', url: `https://api.example.test/mcp?key=${SECRET}`, headers: { Authorization: `Bearer ${SECRET}` } },
      plainserver: { command: 'plain-server' },
    },
  }));
  put(join(home, '.codex', 'config.toml'), `model = "m"\n\n[mcp_servers.codexdb]\ncommand = "node"\nargs = ["db.js", "--key=${SECRET}"]\nenv = { CODEXDB_SECRET_KEY = "${SECRET}" }\n\n[mcp_servers.docs]\nurl = "https://docs.example.test/mcp"\nbearer_token_env_var = "DOCS_TOKEN"\n`);
  put(join(home, '.codex', 'skills', 'summarize', 'SKILL.md'), '---\nname: Summarize\ndescription: Summarizes a page.\n---\nSummarize.\n');
  put(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ mcp: { search: { type: 'remote', url: 'https://search.example.test/x', headers: { Authorization: SECRET } } }, agent: { docs: { description: 'Writes docs.', model: 'm1' } } }));
  put(join(work, 'alpha', '.mcp.json'), JSON.stringify({ mcpServers: { alphadb: { command: 'alphadb', env: { ALPHA_PASSWORD: SECRET } } } }));
  put(join(work, 'alpha', '.claude', 'skills', 'alpha-skill', 'SKILL.md'), '---\nname: Alpha skill\ndescription: Only for the alpha folder.\n---\nAlpha.\n');
  return { home, work };
}

async function stateOf(t: TestContext): Promise<HarnessState> {
  const { home, work } = makeHome(t);
  const scanner = createScanner({ home });
  const places: RealPlace[] = [...(await scanner.discover()).places, ...(await scanner.addFolder(work)).places];
  const batch = await scanner.read(places.map(p => p.id));
  return realToHarnessState(buildRealResult(batch.reads, batch.tally, { nowMs: NOW_MS, foldExtraApps: true }), places);
}

const none: UsageSource = { kind: 'ready', runs: [], reads: new Map(), total: 0 };

test('what the reader found for the three engines reaches the view as counts and names, and a connection with a secret says only "set"', async t => {
  const view = enginesView(await stateOf(t), none);
  const claude = view.rows.find(r => r.id === 'claude-code')!, codex = view.rows.find(r => r.id === 'codex')!, opencode = view.rows.find(r => r.id === 'opencode')!;
  assert.deepEqual([claude.state, codex.state, opencode.state], ['ready', 'ready', 'ready']);
  const flag = (row: typeof claude, name: string): boolean | undefined => row.connections.find(c => c.name === name)?.secretSet;
  assert.equal(flag(claude, 'tracker'), true, 'a variable that holds a key');
  assert.equal(flag(claude, 'remote'), true, 'a header that holds a bearer value');
  assert.equal(flag(claude, 'alphadb'), true, 'a variable that holds a password, in a project folder');
  assert.equal(flag(claude, 'plainserver'), false, 'a connection with nothing to hide');
  assert.equal(flag(codex, 'codexdb'), true); assert.equal(flag(codex, 'docs'), true, 'a variable named by bearer_token_env_var');
  assert.equal(flag(opencode, 'search'), true, 'a header');
  assert.ok(claude.config.some(f => f.key === 'skills' && Number(f.value) >= 2), 'the skills of the home folder and of the project');
  assert.ok(claude.config.some(f => f.key === 'hooks' && f.value === '1'));
  assert.equal(codex.config.find(f => f.key === 'skills')!.value, '1');
});

test('no fake secret and no name of a variable that holds one is anywhere in the view', async t => {
  const state = await stateOf(t);
  const text = JSON.stringify(enginesView(state, none));
  assert.equal(text.includes(SECRET), false, 'the value');
  assert.equal(text.includes('zq9'), false);
  for (const name of SECRET_NAMES) assert.equal(text.includes(name), false, name);
  // The reader keeps the names of variables in the text of a connection's file, and the state holds that text. The view takes none of it.
  assert.ok(JSON.stringify(state).includes('TRACKER_API_KEY'), 'the state does hold a name, so this test can fail');
});

test('no fake secret and no name of one is in the markup the screen draws, and the markup says that the secret is set', async t => {
  const view = enginesView(await stateOf(t), none);
  const html = renderToStaticMarkup(createElement(EnginesUsageBody, { view }));
  assert.equal(html.includes(SECRET), false);
  for (const name of SECRET_NAMES) assert.equal(html.includes(name), false, name);
  assert.ok(html.includes(ENGINES_WORDS.secretSet), 'the markup says "set"');
  assert.ok((html.match(/data-secret="set"/g) ?? []).length >= 5, 'one flag for each connection with a secret');
});

test('a key in the text of a skill is hidden by the reader, and the view shows none of that text', async t => {
  const { home, work } = makeHome(t);
  put(join(home, '.claude', 'skills', 'leaky', 'SKILL.md'), `---\nname: Leaky skill ${FAKE_KEY}\ndescription: Has api_key = "${FAKE_KEY}" inside.\n---\nBody ${FAKE_KEY}\n`);
  const scanner = createScanner({ home });
  const places: RealPlace[] = [...(await scanner.discover()).places, ...(await scanner.addFolder(work)).places];
  const batch = await scanner.read(places.map(p => p.id));
  const state = realToHarnessState(buildRealResult(batch.reads, batch.tally, { nowMs: NOW_MS, foldExtraApps: true }), places);
  const text = JSON.stringify(enginesView(state, none)) + renderToStaticMarkup(createElement(EnginesUsageBody, { view: enginesView(state, none) }));
  assert.equal(text.includes(FAKE_KEY), false); assert.equal(text.includes('FAKEFAKE'), false);
});
