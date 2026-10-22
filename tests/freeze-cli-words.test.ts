// Review of F (b68f557): the words of the CLI. Findings 6, 8, 9, 10, 11, 13, 15, 16 and 18. Every run is
// an agent's (no terminal), so a refusal is the JSON envelope on stderr. The network is denied in every child process.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { readInstalledRelease } from '../apps/cli/src/release.js';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/fake-network.js', import.meta.url))).href;
const release = readInstalledRelease();

function fresh(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-freeze-words-'))); t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'alpha'); mkdirSync(dir);
  const log = join(home, 'network.log'), plan = join(home, 'network.json'); writeFileSync(log, ''); writeFileSync(plan, JSON.stringify({ log }));
  return { home, dir, env: { HOME: home, XDG_STATE_HOME: join(home, 'state'), TEST_FAKE_NETWORK_PLAN: plan }, network: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}
type Fresh = ReturnType<typeof fresh>;
function run(p: Fresh, args: string[], cwd = p.dir) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...p.env } });
  assert.equal(r.error, undefined); return r;
}
const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
const revisionIn = (stdout: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };
function approve(p: Fresh, args: string[]) {
  const planned = run(p, args); assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const applied = run(p, [...args, '--approve', revisionIn(planned.stdout)]); assert.ok(applied.status === 0 || applied.status === 4 || applied.status === 3, applied.stderr); return applied;
}
function upAll(p: Fresh, team: string, ...extra: string[]) {
  for (let i = 0; i < 6; i++) { const r = run(p, ['up', '--team', team, ...extra]); if (r.status === 4) return r; assert.equal(r.status, 3, r.stderr + r.stdout); approve(p, ['up', '--team', team, ...extra]); }
  assert.fail('up did not reach exit 4');
}
const usage = (r: ReturnType<typeof run>) => { assert.equal(r.status, 2, r.stderr); assert.equal(r.stdout, ''); const e = errorOf(r.stderr); assert.equal(e.code, 'USAGE'); return e.message; };

test('finding 6: an unknown first word, bare up and a bad status flag get their own usage; plumbing keeps its words', t => {
  const p = fresh(t);
  for (const [args, word] of [[['stauts'], 'stauts'], [['ups', '--team', 'x'], 'ups'], [['skils', 'sync'], 'skils'], [['lss'], 'lss']] as const) {
    assert.equal(usage(run(p, [...args])), `Unknown command ${word}. Run bowerloom help.`);
  }
  assert.match(usage(run(p, ['up'])), /^Use bowerloom up --team <name>/);
  assert.match(usage(run(p, ['status', '--verbose'])), /^Use bowerloom status \[--json\]/);
  // Plumbing words stay exactly as they were at cc117ac.
  const old = 'Use an explicit installation file and the documented command arguments.';
  for (const args of [['up', '--demo'], ['up', '--pro'], ['up', '--installation', 'x.json'], ['status', '--installation'], ['status', '--registry', 'x'], ['review'], ['cancel'], ['approve']]) assert.equal(usage(run(p, args)), old, args.join(' '));
  // F' code review C: bare bowerloom prints the short help, as bowerloom help does (exit 0).
  const bare = run(p, []); assert.equal(bare.status, 0, bare.stderr); assert.equal(bare.stderr, ''); assert.equal(bare.stdout, run(p, ['help']).stdout);
  assert.equal(usage(run(p, ['validate'])), 'Use bowerloom validate <crew.yaml> or bowerloom plan <crew.yaml>, with optional --root <directory>.');
  assert.equal(usage(run(p, ['plan', 'a', 'b'])), 'Use bowerloom validate <crew.yaml> or bowerloom plan <crew.yaml>, with optional --root <directory>.');
  assert.equal(usage(run(p, ['skills'])), 'Use the exact skills source, plan, apply, inspect, update plan, or recover command shown in help. Explicit records and approvals are required.');
  assert.equal(usage(run(p, ['authoring'])), 'Use bowerloom authoring validate|export <authoring.json> --scenario <frozen-scenario.json>, with optional --root.');
  // A folder with no project: the next step is up, not plumbing (finding 5). The JSON envelope is unchanged.
  const none = run(p, ['status']); assert.equal(none.status, 1); assert.equal(errorOf(none.stderr).code, 'PROJECT_NOT_FOUND');
  assert.deepEqual(p.network(), []);
});

test('findings 8 and 18: the help heading says open beta; help sync and help skills sync have a topic', t => {
  const p = fresh(t);
  for (const args of [['help'], ['help', 'advanced'], ['help', 'up'], ['init', '--help']]) {
    const r = run(p, args); assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith(`Bowerloom ${release.version}: open beta\n${release.execution}\n`), args.join(' ') + r.stdout.slice(0, 80));
    assert.doesNotMatch(r.stdout.split('\n')[0]!, /unreleased/);
  }
  const skills = run(p, ['help', 'skills']).stdout;
  for (const args of [['help', 'sync'], ['help', 'skills', 'sync'], ['help', 'skills', 'add'], ['help', 'skills', 'check']]) { const r = run(p, args); assert.equal(r.status, 0, args.join(' ') + r.stderr); assert.equal(r.stdout, skills, args.join(' ')); }
  for (const noun of ['team', 'skill', 'prompt']) { const r = run(p, ['help', noun, 'create']); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, run(p, ['help', noun]).stdout); }
  const unknown = usage(run(p, ['help', 'nonsense']));
  assert.doesNotMatch(unknown, /every form/); assert.match(unknown, /bowerloom help/);
  assert.equal(run(p, ['help', 'skills', 'nonsense']).status, 2); assert.equal(run(p, ['help', 'ls', 'extra']).status, 2);
});

test('findings 9, 10, 11, 15 and 16: apply names only the chosen harness; check, ls and status name what they mean', t => {
  const p = fresh(t);
  upAll(p, 'research-desk', '--goal', 'Ship a weekly market brief.');
  approve(p, ['skill', 'create', 'tone-guide']); approve(p, ['prompt', 'create', 'standup']);
  approve(p, ['skills', 'sync']);

  // 9: --harness claude names .claude and CLAUDE.md only; --harness codex names .agents and AGENTS.md only.
  const claude = run(p, ['apply', '--harness', 'claude']); assert.equal(claude.status, 3, claude.stderr);
  assert.match(claude.stdout, /^Copies go to \.bowerloom\/managed and \.claude, and stay on this machine\. Apply adds copies and removes none\.$/m);
  assert.match(claude.stdout, /^Bowerloom never edits AGENTS\.md or CLAUDE\.md\. To point Claude Code at these copies, add a line like this to CLAUDE\.md yourself:$/m);
  assert.match(claude.stdout, /^ {2}Project skills are in \.claude\/skills\. Prompts are Claude Code commands in \.claude\/commands\.$/m);
  assert.doesNotMatch(claude.stdout, /\.agents|Codex/);
  approve(p, ['apply', '--harness', 'claude']);
  const codex = run(p, ['apply', '--harness', 'codex']); assert.equal(codex.status, 3, codex.stderr);
  assert.match(codex.stdout, /^Copies go to \.bowerloom\/managed and \.agents, and stay on this machine\./m);
  assert.match(codex.stdout, /^Bowerloom never edits AGENTS\.md or CLAUDE\.md\. To point Codex at these copies, add a line like this to AGENTS\.md yourself:$/m);
  assert.match(codex.stdout, /^ {2}Project skills are in \.agents\/skills\. Prompts are Codex skills named prompt-<name>\.$/m);
  assert.doesNotMatch(codex.stdout, /\.claude|Claude Code commands/);
  approve(p, ['apply']);

  // 10: skills check says Claude Code and Codex, with aligned columns.
  writeFileSync(join(p.dir, '.bowerloom/skills.json'), JSON.stringify({
    format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [
      { id: 'cached-notes', source: { kind: 'npm', registry: 'https://registry.npmjs.org', package: '@synthetic/cached-notes', version: '1.0.0', integrity: 'sha512-' + 'A'.repeat(86) + '==', metadataSha256: 'a'.repeat(64), publisher: 'synthetic' },
        skill: { name: 'cached-notes', sourceRoot: 'skills/cached-notes' }, license: { spdx: 'MIT', files: ['LICENSE'] },
        files: [{ path: 'LICENSE', sourcePath: 'LICENSE', sha256: 'b'.repeat(64), bytes: 10 }, { path: 'SKILL.md', sourcePath: 'skills/cached-notes/SKILL.md', sha256: 'c'.repeat(64), bytes: 20 }], references: [] },
      { id: 'tone-guide', source: { kind: 'local', path: 'skills/tone-guide' } },
    ],
  }, null, 2) + '\n');
  const check = run(p, ['skills', 'check']); assert.equal(check.status, 0, check.stderr);
  assert.equal(check.stdout, 'skills.json is valid: 2 skills, for Claude Code and Codex.\n  cached-notes  npm @synthetic/cached-notes@1.0.0:skills/cached-notes\n  tone-guide    local skills/tone-guide\n');

  // 11: ls teams shows the name the person typed for first-team; ls skills includes the pinned skills.
  const teams = run(p, ['ls', 'teams']); assert.equal(teams.status, 0, teams.stderr);
  assert.equal(teams.stdout, 'Teams\n  first-team (research-desk)\n');
  assert.deepEqual(JSON.parse(run(p, ['ls', 'teams', '--json']).stdout).teams, ['first-team']);
  const skills = run(p, ['ls', 'skills']); assert.equal(skills.status, 0, skills.stderr);
  assert.match(skills.stdout, /^ {2}cached-notes +pinned: npm @synthetic\/cached-notes@1\.0\.0$/m); assert.match(skills.stdout, /^ {2}tone-guide$/m);
  const listed = JSON.parse(run(p, ['ls', 'skills', '--json']).stdout) as { skills: string[]; pinned: string[] };
  assert.deepEqual(listed.pinned, ['cached-notes']); assert.ok(listed.skills.includes('tone-guide'));
  // F' code review B: a skills.json that cannot be read is pinned: null in JSON, never an empty list.
  const good = readFileSync(join(p.dir, '.bowerloom/skills.json'));
  writeFileSync(join(p.dir, '.bowerloom/skills.json'), '{ not json');
  const broken = JSON.parse(run(p, ['ls', 'skills', '--json']).stdout) as { pinned: unknown };
  assert.ok(Object.hasOwn(broken, 'pinned')); assert.equal(broken.pinned, null);
  assert.match(run(p, ['ls', 'skills']).stdout, /^Pinned skills are not listed: \.bowerloom\/skills\.json cannot be read\./m);
  writeFileSync(join(p.dir, '.bowerloom/skills.json'), good);
  writeFileSync(join(p.dir, '.bowerloom/skills.json'), JSON.stringify({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'tone-guide', source: { kind: 'local', path: 'skills/tone-guide' } }] }, null, 2) + '\n');

  // 16: status names the edited file, and the held item with its next step. 15: the step for a prompt copy changed by
  // hand names the prompt's own source, never "a skill of your own".
  appendFileSync(join(p.dir, '.bowerloom/prompts/standup.md'), 'One more line.\n');
  appendFileSync(join(p.dir, '.claude/commands/standup.md'), 'Changed by hand.\n');
  const status = run(p, ['status']); assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /^ {2}edited: \.bowerloom\/prompts\/standup\.md$/m);
  assert.doesNotMatch(status.stdout, /^ {2}edited: \.bowerloom\/prompts$/m);
  assert.match(status.stdout, /^ {2}prompt standup: held \(MANAGED_SKILL_LOCAL_DRIFT\)\. Next: Undo your edits in \.claude\/commands\/standup\.md/m);
  assert.match(status.stdout, /\.bowerloom\/prompts\/standup\.md, the source of the copies/);
  assert.doesNotMatch(status.stdout, /skill of your own/);
  assert.match(run(p, ['help', 'status']).stdout, /names each changed file or folder/);
  assert.deepEqual(p.network(), []);
});

test('finding 13: apply with a pin that is not cached says it never fetches, and says nothing changed once', t => {
  const p = fresh(t);
  upAll(p, 'research-desk', '--goal', 'Ship a weekly market brief.');
  writeFileSync(join(p.dir, '.bowerloom/skills.json'), JSON.stringify({
    format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [
      { id: 'uncached-charts', source: { kind: 'npm', registry: 'https://registry.npmjs.org', package: '@synthetic/uncached-charts', version: '1.0.0', integrity: 'sha512-' + 'A'.repeat(86) + '==', metadataSha256: 'a'.repeat(64), publisher: 'synthetic' },
        skill: { name: 'uncached-charts', sourceRoot: 'skills/uncached-charts' }, license: { spdx: 'MIT', files: ['LICENSE'] },
        files: [{ path: 'LICENSE', sourcePath: 'LICENSE', sha256: 'b'.repeat(64), bytes: 10 }, { path: 'SKILL.md', sourcePath: 'skills/uncached-charts/SKILL.md', sha256: 'c'.repeat(64), bytes: 20 }], references: [] },
    ],
  }, null, 2) + '\n');
  for (const args of [['apply'], ['skills', 'sync', '--offline']]) {
    const r = run(p, args); assert.equal(r.status, 1, r.stderr); const e = errorOf(r.stderr);
    assert.equal(e.code, 'SKILLS_OFFLINE'); assert.doesNotMatch(e.message, /could not fetch/);
    assert.equal(e.message.match(/nothing (?:in the project )?(?:was )?changed/gi)?.length, 1, e.message);
    assert.match(e.message, /uncached-charts/);
  }
  assert.deepEqual(p.network(), []);
});
