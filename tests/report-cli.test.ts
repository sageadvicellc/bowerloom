// `bowerloom report`: the bundle a person reads before anything is sent. Synthetic data only, no real engine is called.
import './support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, world } from './support/config-cli.js';
import type { World } from './support/config-cli.js';

const TOKEN = `ghp_${'Q1w2E3r4T5'.repeat(4)}`;

/** A folder of fake engines. Each prints the given text for any arguments. A missing name is an engine that is not installed. */
function fakeEngines(w: World, outputs: Readonly<Record<string, string>>): string {
  const bin = join(w.base, 'bin'); mkdirSync(bin, { recursive: true });
  for (const [name, text] of Object.entries(outputs)) {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${text}'\n`); chmodSync(file, 0o755);
  }
  return bin;
}
const envOf = (w: World, bin: string): Record<string, string> => ({ ...w.env, XDG_STATE_HOME: '', PATH: `${bin}:/usr/bin:/bin`, BOWERLOOM_EVENT_LOG: '' });
const json = <T>(text: string): T => JSON.parse(text) as T;

test('report prints the bundle, says nothing was sent, and gives the issue link', t => {
  const w = world(t), bin = fakeEngines(w, { claude: 'claude 2.1.4 (Claude Code)' });
  // Remove a stray engine of this machine: only our folder plus system tools are on PATH, and codex is not in them.
  const r = run(w.work, ['report'], envOf(w, bin));
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, '');
  assert.match(r.stdout, /^Bowerloom problem report \(bowerloom\/report\/v1\)$/m);
  assert.match(r.stdout, /^Claude Code: 2\.1\.4$/m);
  assert.match(r.stdout, /^Last error: none$/m);
  assert.match(r.stdout, /\n\nNothing was sent\. To file an issue, read the bundle above, then open this link:\nhttps:\/\/github\.com\/sageadvicellc\/bowerloom\/issues\/new\?template=bug\.yml&bundle=\S+\n$/);
  assert.equal(r.stdout.includes(w.home), false, 'no home path');
  assert.equal(r.stdout.includes(w.base), false, 'no local path');
  assert.equal(existsSync(join(w.home, '.local', 'state', 'bowerloom', 'events')), false, 'reading the bundle writes no log');
});

test('report --json prints the bundle and the link as JSON; --template picks the form', t => {
  const w = world(t), bin = fakeEngines(w, { claude: 'claude 2.1.4', codex: 'codex-cli 0.157.0' });
  const r = run(w.work, ['report', '--json', '--template', 'engine-change'], envOf(w, bin));
  assert.equal(r.status, 0, r.stderr);
  const out = json<{ bundle: { schema: string; engines: Record<string, string> }; issueUrl: string }>(r.stdout);
  assert.equal(out.bundle.schema, 'bowerloom/report/v1');
  assert.deepEqual(out.bundle.engines, { 'claude-code': '2.1.4', codex: '0.157.0' });
  assert.match(out.issueUrl, /template=engine-change\.yml&bundle=/);
  assert.equal(r.stdout.endsWith('\n'), true);
});

test('report refuses an unknown template and extra words with a usage error, and sends nothing', t => {
  const w = world(t), bin = fakeEngines(w, {});
  for (const args of [['report', '--template', 'other'], ['report', 'now'], ['report', '--template']]) {
    const r = run(w.work, args, envOf(w, bin));
    assert.equal(r.status, 2, args.join(' ')); assert.match(r.stderr, /USAGE/);
  }
});

test('a token or home path printed by an engine never reaches the bundle', t => {
  const w = world(t), bin = fakeEngines(w, { claude: `claude 2.1.4-${TOKEN} ${w.home}/tools`, codex: 'codex 0.1.0' });
  const r = run(w.work, ['report', '--json'], envOf(w, bin));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.includes(TOKEN), false); assert.equal(r.stdout.includes(w.home), false);
  assert.match(r.stdout, /redacted/);
});

test('report shows the last error that an earlier failing command recorded', t => {
  const w = world(t), bin = fakeEngines(w, {}), env = envOf(w, bin);
  assert.equal(run(w.work, ['skills', 'nonsense-word'], env).status !== 0, true);
  const r = run(w.work, ['report', '--json'], env);
  const { bundle } = json<{ bundle: { lastError: string; recent: { kind: string }[] } }>(r.stdout);
  assert.notEqual(bundle.lastError, 'none');
  assert.equal(bundle.recent.at(-1)!.kind, 'error');
});
