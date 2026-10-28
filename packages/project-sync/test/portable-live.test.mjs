// Portable parts spec, section 7, checks 1, 10, and 11: they need a real engine, so they run only on an explicit opt-in.
//
// Set BOWERLOOM_LIVE_ENGINES=1, and for each engine to test, a command that runs one prompt non-interactively in the
// current folder and prints the answer. The prompt is the last argument. Bowerloom does not guess these command lines:
//   BOWERLOOM_LIVE_CLAUDE_CODE, BOWERLOOM_LIVE_CODEX, BOWERLOOM_LIVE_OPENCODE, BOWERLOOM_LIVE_PI, BOWERLOOM_LIVE_DEEPSEEK_HARNESS
// Each value is a JSON list of words, for example ["claude","-p"]. An engine with no command is skipped.
// These tests call models, so they can cost money. npm test never sets the opt-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyPortable, planPortable } from '../../../dist/packages/project-sync/src/index.js';
import { ENGINE_IDS } from '../../../dist/packages/harness-definition/src/index.js';

const LIVE = process.env.BOWERLOOM_LIVE_ENGINES === '1';
const commandOf = engine => {
  const raw = process.env[`BOWERLOOM_LIVE_${engine.toUpperCase().replace(/-/g, '_')}`];
  if (!raw) return null;
  const words = JSON.parse(raw);
  assert.ok(Array.isArray(words) && words.length > 0 && words.every(w => typeof w === 'string'), `the command of ${engine} is a JSON list of words`);
  return words;
};
const skip = engine => !LIVE ? 'set BOWERLOOM_LIVE_ENGINES=1 to run live engine checks' : commandOf(engine) === null ? `no command for ${engine}` : false;
const MARK = 'bowerloom-live-7f3a';
const json = v => JSON.stringify(v, null, 2) + '\n';

async function projected(t, engine, skills = { 'live-check': `---\nname: live-check\ndescription: Answers the live check question.\n---\n\nWhen asked for the live check word, answer ${MARK}-skill.\n` }) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-live-'))); fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const dir = path.join(base, 'project'), def = path.join(dir, '.bowerloom');
  const files = {
    'harness.json': json({ format: 'bowerloom/harness/v1beta1', id: 'live', description: 'A live check.', engines: [{ id: engine }], parts: { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/' }, skills: {} }),
    'instructions/AGENTS.md': `# Live check\n\nWhen asked for the instruction word, answer ${MARK}-instructions.\n`,
    ...Object.fromEntries(Object.entries(skills).map(([id, text]) => [`skills/${id}/SKILL.md`, text])),
  };
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(def, rel)), { recursive: true }); fs.writeFileSync(path.join(def, rel), text); }
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const input = { projectDir: dir, definitionFolder: def, stateDir: path.join(base, 'state') };
  const plan = planPortable(input);
  await applyPortable(input, plan.revision);
  return { dir, plan };
}
function ask(engine, dir, prompt) {
  const [cmd, ...args] = commandOf(engine);
  const r = spawnSync(cmd, [...args, prompt], { cwd: dir, encoding: 'utf8', timeout: 300_000 });
  return `${r.stdout}\n${r.stderr}`;
}

for (const engine of ENGINE_IDS) {
  test(`check 1 (live): a tree with only AGENTS.md loads its instructions in ${engine}`, { skip: skip(engine) }, async t => {
    const { dir } = await projected(t, engine);
    assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);
    assert.match(ask(engine, dir, 'What is the instruction word? Answer with the word only.'), new RegExp(`${MARK}-instructions`));
  });
}

test('check 10 (live): a Pi project skill is reported pending trust until a person saves trust', { skip: skip('pi') }, async t => {
  const { dir, plan } = await projected(t, 'pi');
  assert.deepEqual(plan.pendingTrust, ['live-check']);
  // Before trust is saved, a non-interactive Pi run skips project .agents/skills.
  assert.doesNotMatch(ask('pi', dir, 'Use the live-check skill. What is the live check word?'), new RegExp(`${MARK}-skill`));
  // Saving trust is a person's step in Pi. Once the tester has saved it, set BOWERLOOM_LIVE_PI_TRUSTED=1 and run again.
  if (process.env.BOWERLOOM_LIVE_PI_TRUSTED === '1') {
    assert.deepEqual(planPortable({ projectDir: dir, definitionFolder: path.join(dir, '.bowerloom'), stateDir: plan.stateDir, piTrustSaved: true }).pendingTrust, []);
  }
});

test('check 11 (live): OpenCode gets the skill in .claude/skills and .agents/skills; the run reports how it handles the duplicate name', { skip: skip('opencode') }, async t => {
  const { dir } = await projected(t, 'opencode');
  for (const root of ['.claude/skills', '.agents/skills']) assert.ok(fs.existsSync(path.join(dir, root, 'live-check/SKILL.md')), root);
  const out = ask('opencode', dir, 'List the names of the skills you can use, one per line, and nothing else.');
  const count = out.split('\n').filter(line => line.includes('live-check')).length;
  t.diagnostic(`OpenCode listed live-check ${count} time(s).`);
  assert.ok(count >= 1, 'OpenCode loads the skill');
});
