// Round trip "adopt from Codex, install to Codex" through the real binary. A project that holds only a Codex config
// and AGENTS.md is adopted, and install takes the server tables over: it plans `take-over`, writes nothing to that
// file, and removal leaves the folder as it was. The tables are synthetic: a command server in the shape a person
// writes (multi-line array with a trailing comma, a literal string, an env sub-table) and a URL server.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { removeAll, run } from './support/config-cli.js';

const CONFIG = `model = "model-a"

[mcp_servers.example]
command = "sh"
args = [
    "-c",
    '. "$HOME/.config/example/.env"; EXAMPLE_TOKEN="$EXAMPLE_TOKEN" exec some-mcp-server',
]

[mcp_servers.example.env]
EXAMPLE_FLAG_A = "true"
EXAMPLE_FLAG_B = "false"
EXAMPLE_TOOLSETS = "messages,channels"

[mcp_servers.other]
url = "https://example.invalid/mcp"
`;
const FILES: Record<string, string> = { 'AGENTS.md': '# Demo\n\nStanding fact: the demo uses npm.\n', '.codex/config.toml': CONFIG };
const CODEX = ['--engine', 'codex@0.157.0'];
const OPENCODE = ['--engine', 'opencode@1.18.30'];
/** Install reads the version from harness.json, so it names the engine only. */
const INSTALL_CODEX = ['--engine', 'codex'];
const INSTALL_BOTH = ['--engine', 'codex', '--engine', 'opencode'];

interface W { base: string; dir: string; env: Record<string, string> }
function world(t: TestContext, files: Record<string, string> = FILES): W {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-codex-takeover-')));
  t.after(() => removeAll(base));
  const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 });
  const dir = join(home, 'Projects', 'e2e'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text, { mode: 0o644 }); }
  return { base, dir, env: { HOME: home, XDG_STATE_HOME: join(base, 'state'), BOWERLOOM_PREVIEW_ENGINES: '1' } };
}
const bl = (w: W, args: string[]) => run(w.dir, ['harness', ...args], w.env);
const json = <T>(text: string): T => JSON.parse(text) as T;

/** Every file and folder of the project outside `.bowerloom`, with mode, content hash, inode, and times: a write changes at least one. */
function snapshot(w: W): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(w.dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (r === '.bowerloom') continue;
      const st = lstatSync(join(w.dir, r), { bigint: true }), mode = (Number(st.mode) & 0o7777).toString(8);
      if (st.isDirectory()) { out[`${r}/`] = mode; walk(r); }
      else out[r] = `${mode} ${createHash('sha256').update(readFileSync(join(w.dir, r))).digest('hex')} ${st.ino}:${st.mtimeNs}`;
    }
  };
  walk(''); return out;
}

function adopt(w: W, engines: string[]): void {
  const args = ['adopt', ...engines, '--every-engine', 'mcp'];
  const planned = bl(w, [...args, '--json']);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = json<{ revision: string; plan: { ready: boolean; approvalsRequired: string[]; unmapped: { id: string; gate: string }[] } }>(planned.stdout);
  assert.equal(body.plan.ready, true, planned.stdout);
  const confirms = body.plan.approvalsRequired.flatMap(k => ['--confirm', k]);
  const acks = body.plan.unmapped.filter(u => u.gate === 'acknowledge').flatMap(u => ['--acknowledge', u.id]);
  const applied = bl(w, [...args, ...confirms, ...acks, '--approve', body.revision]);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
}
type Plan = { revision: string; plan: { changes: { path: string; action: string }[]; takenOver: { path: string; entry?: string }[] } };
function plan(w: W, verb: 'install' | 'remove', engines: string[]): Plan {
  const planned = bl(w, [verb, ...engines, '--json']);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  return json<Plan>(planned.stdout);
}
const apply = (w: W, verb: 'install' | 'remove', engines: string[], revision: string): Record<string, unknown> => {
  const done = bl(w, [verb, ...engines, '--approve', revision, '--json']);
  assert.equal(done.status, 0, done.stderr + done.stdout);
  return json<Record<string, unknown>>(done.stdout);
};

test('adopt from Codex, install to Codex: the server tables are taken over, nothing is written to them, and removal leaves the folder as it was', t => {
  const w = world(t);
  const original = snapshot(w);
  adopt(w, CODEX);
  assert.deepEqual(snapshot(w), original, 'adoption writes only .bowerloom');
  const installed = plan(w, 'install', INSTALL_CODEX);
  const config = installed.plan.changes.find(c => c.path === '.codex/config.toml');
  assert.equal(config?.action, 'take-over', JSON.stringify(installed.plan.changes));
  assert.deepEqual(installed.plan.takenOver.filter(x => x.path === '.codex/config.toml' && x.entry !== undefined).map(x => x.entry).sort(), ['mcp_servers.example', 'mcp_servers.other']);
  apply(w, 'install', INSTALL_CODEX, installed.revision);
  assert.deepEqual(snapshot(w), original, 'install wrote nothing: same bytes, modes, inodes, and times');
  assert.equal(readFileSync(join(w.dir, '.codex/config.toml'), 'utf8'), CONFIG);
  const status = json<{ projected?: boolean }>(bl(w, ['status', '--json']).stdout);
  assert.ok(status.projected !== false, 'the install is recorded');
  const removal = plan(w, 'remove', []);
  const removed = apply(w, 'remove', [], removal.revision);
  assert.match(JSON.stringify(removed), /"kept":\[[^\]]*\.codex\/config\.toml/, `removal keeps the taken-over file: ${JSON.stringify(removed)}`);
  assert.deepEqual(snapshot(w), original, 'removal restores the folder byte for byte');
});

test('the same server adopted from Codex and projected to OpenCode as well: the Codex tables are taken over, OpenCode gets its own file, and removal restores the folder', t => {
  const w = world(t);
  const original = snapshot(w);
  adopt(w, [...CODEX, ...OPENCODE]);
  const both = INSTALL_BOTH;
  const installed = plan(w, 'install', both);
  assert.equal(installed.plan.changes.find(c => c.path === '.codex/config.toml')?.action, 'take-over', JSON.stringify(installed.plan.changes));
  const opencode = installed.plan.changes.find(c => c.path === 'opencode.json' || c.path === 'opencode.jsonc');
  assert.equal(opencode?.action, 'create', JSON.stringify(installed.plan.changes));
  apply(w, 'install', both, installed.revision);
  assert.equal(readFileSync(join(w.dir, '.codex/config.toml'), 'utf8'), CONFIG, 'the Codex file is as it was');
  const file = join(w.dir, opencode!.path);
  assert.ok(existsSync(file));
  const written = json<{ mcp: Record<string, { command?: string[]; url?: string }> }>(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(written.mcp).sort(), ['example', 'other']);
  assert.equal(written.mcp.other?.url, 'https://example.invalid/mcp');
  assert.deepEqual(written.mcp.example?.command?.slice(0, 2), ['sh', '-c']);
  const removal = plan(w, 'remove', []);
  apply(w, 'remove', [], removal.revision);
  assert.deepEqual(snapshot(w), original, 'removal restores the folder byte for byte');
});

test('a Codex table that differs from what the definition holds still refuses PORTABLE_CONFLICT, and nothing is written', t => {
  const w = world(t);
  adopt(w, CODEX);
  // The person edits a value after adoption: the table no longer means what the definition says.
  writeFileSync(join(w.dir, '.codex/config.toml'), CONFIG.replace('EXAMPLE_FLAG_B = "false"', 'EXAMPLE_FLAG_B = "true"'), { mode: 0o644 });
  const before = snapshot(w);
  const refused = bl(w, ['install', ...INSTALL_CODEX, '--json']);
  assert.equal(refused.status, 1, refused.stderr + refused.stdout);
  assert.equal((json<{ error: { code: string } }>(refused.stderr)).error.code, 'PORTABLE_CONFLICT');
  assert.deepEqual(snapshot(w), before);
});
