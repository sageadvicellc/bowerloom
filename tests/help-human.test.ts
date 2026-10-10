import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstalledRelease } from '../apps/cli/src/release.js';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
// The help text of commit cc117ac, without its two-line release heading. It is the contract of `help advanced`.
const advanced = readFileSync(new URL('../../tests/fixtures/help-advanced-cc117ac.txt', import.meta.url), 'utf8');
const release = readInstalledRelease();
// Review finding 8: the heading says open beta, without the record's state.
const heading = `Bowerloom ${release.version}: open beta\n${release.execution}\n\n`;

// The first screen a person sees. It lists only commands that exist at this commit.
// Each later milestone adds its lines here and to the command table in apps/cli/src/human.ts.
const short = `Set up agent teams, skills, and prompts for Claude Code and Codex.

Start here
  bowerloom up --team <name>            Prepare this project for a team. Shows each plan first.
  bowerloom ls [teams|skills|prompts]   List what this project holds.
  bowerloom status                      Show whether this project is ready.

Skills and setup
  bowerloom skills add npm:<package>@<version>:<path>
  bowerloom skills add github:<owner>/<repo>@<40-char-commit>:<path>
  bowerloom skills check                Check the pins in .bowerloom/skills.json.
  bowerloom skills sync [--offline]     Install the pinned skills on this machine.
  bowerloom apply [--harness claude|codex|both]

Create (mostly used by agents)
  bowerloom team create <name> [--profile engineer|founder|research]
  bowerloom skill create <name> [--team <team>]
  bowerloom prompt create <name> [--team <team>]

Every change shows a plan first. Agents pass --approve <revision> or --json.
No command here starts workers yet.

  bowerloom help <command>   bowerloom help advanced
`;

function run(cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined); return result;
}
function folder(t: test.TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-help-human-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}

test('--help, -h and help print the short help and write nothing', t => {
  const root = folder(t), before = readdirSync(root);
  for (const args of [['--help'], ['-h'], ['help']]) {
    const r = run(root, args); assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ''); assert.equal(r.stdout, heading + short, args.join(' '));
  }
  assert.deepEqual(readdirSync(root), before);
});

test('help advanced prints the cc117ac help byte for byte, under the release heading', t => {
  const root = folder(t), before = readdirSync(root);
  assert.equal(createHash('sha256').update(advanced).digest('hex'), 'e54b0442cb62f029a539a4ef141cf4ac7a24ca2b4753188ef443127d7fb192eb');
  const r = run(root, ['help', 'advanced']); assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, '');
  assert.equal(r.stdout, heading + advanced);
  assert.ok(r.stdout.startsWith(`Bowerloom ${release.version}: open beta\n`));
  assert.deepEqual(readdirSync(root), before);
});

test('the short help is shorter than the advanced help and lists no plumbing', () => {
  // DESIGN-01 section B's first screen: with M1 to M6 it fills 24 entries, the last one the empty string after the final newline.
  assert.ok(short.split('\n').length <= 24); assert.doesNotMatch(short, /skills source|bowerloom harness|portable|recipe|backend|--installation/);
});

test('the short help lists only commands that exist at this commit, and each has help of its own', t => {
  const root = folder(t);
  const listed = [...short.matchAll(/^ {2}bowerloom (\w+)/gm)].map(m => m[1]!);
  assert.deepEqual([...new Set(listed)].sort(), ['apply', 'help', 'ls', 'prompt', 'skill', 'skills', 'status', 'team', 'up']);
  for (const name of ['init', 'ls', 'status', 'skills', 'team', 'skill', 'prompt', 'up', 'apply']) { const r = run(root, ['help', name]); assert.equal(r.status, 0, name + r.stderr); assert.match(r.stdout, new RegExp(`bowerloom ${name}`)); }
});

test('help <command> and <command> --help agree, and an unknown topic is a usage error', t => {
  const root = folder(t);
  for (const name of ['ls', 'status', 'skills', 'team', 'skill', 'prompt', 'up', 'apply']) { const a = run(root, ['help', name]), b = run(root, [name, '--help']); assert.equal(a.status, 0); assert.equal(a.stdout, b.stdout, name); assert.ok(a.stdout.startsWith(`Bowerloom ${release.version}:`)); }
  assert.equal(run(root, ['help', 'init']).stdout, run(root, ['init', '--help']).stdout);
  const unknown = run(root, ['help', 'nonsense']); assert.equal(unknown.status, 2); assert.equal(unknown.stdout, '');
  assert.equal(JSON.parse(unknown.stderr).error.code, 'USAGE');
  assert.equal(run(root, ['help', 'advanced', 'extra']).status, 2);
  assert.equal(run(root, ['help', 'ls', 'extra']).status, 2);
});
