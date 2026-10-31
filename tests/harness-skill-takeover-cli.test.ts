// Round trip "adopt from Codex and OpenCode, install to the same engines" through the real binary, for a skill whose
// SKILL.md holds keys beyond the open core fields (a version, a flag, a hint with a non-ASCII character). Adoption keeps
// those keys in the definition as private blocks. Install writes them back, takes the existing folder over (plan action
// `take-over`, nothing written), and removal leaves the folder as it was. A changed value still refuses. Synthetic only.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { removeAll, run } from './support/config-cli.js';

const HINT = '[shape · audit|critique] [target]';
const SKILL = `---\nname: example\ndescription: "Reviews a change before merge."\nversion: 4.2.2\nuser-invocable: true\nargument-hint: "${HINT}"\n---\n\n# Example\n\nUse it with care.\n`;
const SKILL_PATH = '.agents/skills/example/SKILL.md';
const FILES: Record<string, string> = {
  'AGENTS.md': '# Demo\n\nStanding fact: the demo uses npm.\n',
  [SKILL_PATH]: SKILL,
  '.agents/skills/example/reference/x.md': 'Reference notes.\n',
};
const ADOPT_ENGINES = ['--engine', 'codex@0.157.0', '--engine', 'opencode@1.18.30'];
const EVERY = ['--every-engine', 'guardrails', '--every-engine', 'hooks', '--every-engine', 'mcp'];
/** Install reads the version from harness.json, so it names the engines only. */
const INSTALL = ['--engine', 'codex', '--engine', 'opencode'];

interface W { base: string; dir: string; env: Record<string, string> }
function world(t: TestContext, files: Record<string, string> = FILES): W {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-skill-takeover-')));
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
const under = (snap: Record<string, string>, prefix: string): Record<string, string> => Object.fromEntries(Object.entries(snap).filter(([k]) => k.startsWith(prefix)));

function adopt(w: W): void {
  const args = ['adopt', ...ADOPT_ENGINES, ...EVERY];
  const planned = bl(w, [...args, '--json']);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = json<{ revision: string; plan: { ready: boolean; approvalsRequired: string[]; unmapped: { id: string; gate: string }[] } }>(planned.stdout);
  assert.equal(body.plan.ready, true, planned.stdout);
  const confirms = body.plan.approvalsRequired.flatMap(k => ['--confirm', k]);
  const acks = body.plan.unmapped.filter(u => u.gate === 'acknowledge').flatMap(u => ['--acknowledge', u.id]);
  const applied = bl(w, [...args, ...confirms, ...acks, '--approve', body.revision]);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
}
type Plan = { revision: string; plan: { changes: { path: string; action: string }[]; deferred: { part: string }[]; takenOver: { path: string }[] } };
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

test('adopt a skill with extra frontmatter keys, install to Codex and OpenCode: the folder is taken over, nothing is written to it, and removal restores the project byte for byte', t => {
  const w = world(t);
  const original = snapshot(w);
  adopt(w);
  assert.deepEqual(snapshot(w), original, 'adoption writes only .bowerloom');
  const installed = plan(w, 'install', INSTALL);
  const actions = Object.fromEntries(installed.plan.changes.map(c => [c.path, c.action]));
  assert.equal(actions[SKILL_PATH], 'take-over', JSON.stringify(installed.plan.changes));
  assert.equal(actions['.agents/skills/example/reference/x.md'], 'take-over');
  assert.equal(actions['AGENTS.md'], 'take-over');
  assert.equal(actions['.claude/skills/example/SKILL.md'], 'create', 'OpenCode also reads .claude/skills');
  assert.deepEqual(installed.plan.deferred.filter(d => d.part === 'skill-private'), [], 'the private keys are projected, not deferred');
  assert.ok(installed.plan.takenOver.some(x => x.path === SKILL_PATH));
  apply(w, 'install', INSTALL, installed.revision);
  assert.deepEqual(under(snapshot(w), '.agents'), under(original, '.agents'), 'install wrote nothing to the folder: same bytes, modes, inodes, and times');
  assert.equal(readFileSync(join(w.dir, SKILL_PATH), 'utf8'), SKILL);
  // The OpenCode copy carries the keys the definition holds as a private block.
  const copy = readFileSync(join(w.dir, '.claude/skills/example/SKILL.md'), 'utf8');
  assert.match(copy, /^version: "4\.2\.2"$/m);
  assert.match(copy, /^user-invocable: true$/m);
  assert.ok(copy.includes(`argument-hint: ${JSON.stringify(HINT)}`), copy);
  assert.ok(copy.endsWith('---\n\n# Example\n\nUse it with care.\n'));
  const again = bl(w, ['install', ...INSTALL, '--json']);
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.equal(json<{ noop: boolean }>(again.stdout).noop, true, 'a second install has nothing to do');
  const removal = plan(w, 'remove', []);
  const removed = apply(w, 'remove', [], removal.revision);
  assert.match(JSON.stringify(removed), /"kept":\[[^\]]*\.agents\/skills\/example\/SKILL\.md/, `removal keeps the taken-over file: ${JSON.stringify(removed)}`);
  assert.deepEqual(snapshot(w), original, 'removal restores the project byte for byte');
  assert.equal(existsSync(join(w.dir, '.claude')), false);
});

test('a SKILL.md that means the same in another key order and quoting style is taken over too', t => {
  const rewritten = `---\nargument-hint: '${HINT}'\nuser-invocable: true\nversion: "4.2.2"\ndescription: Reviews a change before merge.\nname: example\n---\n\n# Example\n\nUse it with care.\n`;
  const w = world(t);
  adopt(w);
  writeFileSync(join(w.dir, SKILL_PATH), rewritten);
  const before = snapshot(w);
  const installed = plan(w, 'install', INSTALL);
  assert.equal(installed.plan.changes.find(c => c.path === SKILL_PATH)?.action, 'take-over', JSON.stringify(installed.plan.changes));
  apply(w, 'install', INSTALL, installed.revision);
  assert.deepEqual(under(snapshot(w), '.agents'), under(before, '.agents'));
  assert.equal(readFileSync(join(w.dir, SKILL_PATH), 'utf8'), rewritten);
});

test('a changed value, a body change, an extra file, or a mode still refuses PORTABLE_PATH_OCCUPIED, and nothing is written', t => {
  const edits: Record<string, (w: W) => void> = {
    'a changed value': w => writeFileSync(join(w.dir, SKILL_PATH), SKILL.replace('4.2.2', '4.2.3')),
    'a body change': w => writeFileSync(join(w.dir, SKILL_PATH), SKILL.replace('with care', 'freely')),
    'an extra file': w => writeFileSync(join(w.dir, '.agents/skills/example/reference/y.md'), 'More.\n'),
    'a mode': w => chmodSync(join(w.dir, '.agents/skills/example/reference/x.md'), 0o755),
  };
  for (const [label, edit] of Object.entries(edits)) {
    const w = world(t);
    adopt(w);
    edit(w);
    const before = snapshot(w);
    const refused = bl(w, ['install', ...INSTALL, '--json']);
    assert.equal(refused.status, 1, `${label}: ${refused.stderr}${refused.stdout}`);
    assert.equal(json<{ error: { code: string } }>(refused.stderr).error.code, 'PORTABLE_PATH_OCCUPIED', label);
    assert.deepEqual(snapshot(w), before, label);
  }
});
