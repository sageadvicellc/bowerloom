import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';
import { renderRefusal } from '../apps/cli/src/human.js';

// `bowerloom skills add --replace`: moves one pin to a new npm version or GitHub commit of the same source.
const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/fake-network.js', import.meta.url))).href;
const manifestTest = fileURLToPath(new URL('../../packages/skill-manifest/test/', import.meta.url));
const fixtures = join(manifestTest, 'fixtures');
const COMMIT = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00';
const COMMIT2 = 'c0ffee01'.repeat(5);
const NPM_SPEC = 'npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections';
const NPM_SPEC2 = 'npm:@synthetic/db-skills@0.0.2:skills/synthetic-db/collections';
const GIT_SPEC = `github:synthetic-owner/skills-repo@${COMMIT}:skills/verification-loop`;
const GIT_SPEC2 = `github:synthetic-owner/skills-repo@${COMMIT2}:skills/verification-loop`;

// The independent fixture writers of the skill-manifest tests. They build the second version and the second commit in
// memory, from the recorded items with one SKILL.md changed. Nothing here reads the network.
interface Item { path: string; text?: string; link?: string }
const writers = await import(pathToFileURL(join(manifestTest, 'support', 'fixtures.mjs')).href) as {
  tarball(items: Item[]): Buffer;
  npmMetadata(o: { name: string; version: string; license: string; archive: Buffer }): Buffer;
  repository(repo: string, commit: string, items: Item[]): { responses: Map<string, Buffer> };
};
const recorded = await import(pathToFileURL(join(fixtures, 'record.mjs')).href) as { NPM_FILES: Item[]; GIT_ITEMS: Item[]; GIT_REPO: string };
const NPM_SKILL = 'skills/synthetic-db/collections/SKILL.md', GIT_SKILL = 'skills/verification-loop/SKILL.md';
const changed = (items: Item[], file: string, mark: string) => items.map(i => i.path === file ? { ...i, text: `${i.text!}\n${mark}\n` } : i.path === 'package.json' ? { ...i, text: i.text!.replace('"0.0.1"', '"0.0.2"') } : i);

function folder(t: TestContext) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-skills-replace-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function routes(root: string): Record<string, string> {
  const dir = join(root, 'responses'); mkdirSync(dir);
  let n = 0; const put = (bytes: Buffer) => { const file = join(dir, `${n++}.bin`); writeFileSync(file, bytes); return file; };
  const archive = writers.tarball(changed(recorded.NPM_FILES, NPM_SKILL, 'Version two.'));
  const out: Record<string, string> = {
    'https://registry.npmjs.org/@synthetic/db-skills/0.0.1': join(fixtures, 'npm-db-skills', 'metadata.json'),
    'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz': join(fixtures, 'npm-db-skills', 'archive.tgz'),
    'https://registry.npmjs.org/@synthetic/db-skills/0.0.2': put(writers.npmMetadata({ name: '@synthetic/db-skills', version: '0.0.2', license: 'MIT', archive })),
    'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.2.tgz': put(archive),
  };
  const first = JSON.parse(readFileSync(join(fixtures, 'github-skills-repo.json'), 'utf8')) as { responses: Record<string, string> };
  for (const [url, body] of Object.entries(first.responses)) out[url] = put(Buffer.from(body, 'base64'));
  for (const [url, body] of writers.repository(recorded.GIT_REPO, COMMIT2, changed(recorded.GIT_ITEMS, GIT_SKILL, 'Commit two.')).responses) out[url] ??= put(body);
  return out;
}
function network(root: string, serve: boolean) {
  const log = join(root, `network-${serve ? 'serve' : 'deny'}.log`), planFile = join(root, `network-${serve ? 'serve' : 'deny'}.json`);
  writeFileSync(planFile, JSON.stringify({ log, ...(serve ? { routes: routes(root) } : {}) })); writeFileSync(log, '');
  return { env: { TEST_FAKE_NETWORK_PLAN: planFile }, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { name: string; target: string }) };
}
function run(cwd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
  assert.equal(r.error, undefined); return r;
}
/** A project made by the real init, with HOME as the outer folder and private state under HOME/state. */
function project(t: TestContext) {
  const home = folder(t), dir = join(home, 'studio'); mkdirSync(dir);
  const deny = network(home, false), serve = network(home, true), base = { HOME: home, XDG_STATE_HOME: join(home, 'state') };
  const args = ['--mode', 'existing', '--target', dir, '--name', 'Studio handbook', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  const plan = run(home, ['init', 'plan', ...args, '--json'], { ...base, ...deny.env }); assert.equal(plan.status, 0, plan.stderr);
  assert.equal(run(home, ['init', 'apply', ...args, '--approve', JSON.parse(plan.stdout).revision], { ...base, ...deny.env }).status, 0);
  return { home, dir, manifest: join(dir, '.bowerloom', 'skills.json'), deny: { ...base, ...deny.env }, serve: { ...base, ...serve.env }, denied: deny.calls };
}
function planOf(p: ReturnType<typeof project>, args: string[], env: Record<string, string>): { revision: string; plan: { change: Record<string, unknown> } } {
  const planned = run(p.dir, [...args, '--json'], env); assert.equal(planned.status, 3, planned.stderr); return JSON.parse(planned.stdout);
}
function approve(p: ReturnType<typeof project>, args: string[], env: Record<string, string>) {
  const applied = run(p.dir, [...args, '--approve', planOf(p, args, env).revision], env); assert.equal(applied.status, 0, applied.stderr); return applied;
}
const tree = (dir: string) => JSON.stringify(readdirSync(dir, { recursive: true }).map(String).sort().map(rel => { const s = lstatSync(join(dir, rel)); return [rel, s.isFile() ? createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex') : 'dir']; }));
const errorCode = (stderr: string) => (JSON.parse(stderr) as { error: { code: string } }).error.code;
type Skill = { id: string; teams?: string[]; source: { kind: string; version?: string; commit?: string; path?: string } };
const skills = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { skills: Skill[] }).skills;

test('--replace moves an npm skill to a new version: the plan shows the old and new pin, and skills sync then updates it', t => {
  const p = project(t);
  approve(p, ['skills', 'add', NPM_SPEC], p.serve); approve(p, ['skills', 'sync'], p.serve);
  const installed = join(p.dir, '.claude', 'skills', 'synthetic-db-collections', 'SKILL.md');
  assert.doesNotMatch(readFileSync(installed, 'utf8'), /Version two\./);
  const before = readFileSync(p.manifest), sha = createHash('sha256').update(before).digest('hex');
  const shown = run(p.dir, ['skills', 'add', NPM_SPEC2, '--replace'], p.serve);
  assert.equal(shown.status, 3, shown.stderr); assert.equal(shown.stderr, '');
  const revision = /Revision: ([a-f0-9]{64})\n/.exec(shown.stdout)?.[1]; assert.ok(revision, shown.stdout);
  assert.equal(shown.stdout, [
    'Replace the pin of skill synthetic-db-collections in .bowerloom/skills.json',
    '  Old pin: npm @synthetic/db-skills 0.0.1, folder skills/synthetic-db/collections',
    '  New pin: npm @synthetic/db-skills 0.0.2, folder skills/synthetic-db/collections',
    '  Skill name: synthetic-db-collections',
    '  License: MIT (LICENSE)',
    '  Files: 4',
    '  Teams: every team',
    `  skills.json: replaces the file with sha256 ${sha}`,
    'This records the new pin only. Nothing is installed or run. Run bowerloom skills sync to update the installed copies.',
    `Revision: ${revision}`,
    `Approval required. Run the same command again with --approve ${revision}`, '',
  ].join('\n'));
  assert.deepEqual(readFileSync(p.manifest), before, 'the plan writes nothing');
  const json = planOf(p, ['skills', 'add', NPM_SPEC2, '--replace'], p.serve);
  assert.equal(json.revision, revision); assert.deepEqual(Object.keys(json.plan.change), ['replace']);
  const change = json.plan.change.replace as { from: Skill; to: Skill };
  assert.equal(change.from.source.version, '0.0.1'); assert.equal(change.to.source.version, '0.0.2');
  const applied = run(p.dir, ['skills', 'add', NPM_SPEC2, '--replace', '--approve', revision], p.serve);
  assert.equal(applied.status, 0, applied.stderr); assert.equal(applied.stdout, `Applied plan ${revision}.\n`);
  assert.deepEqual(skills(p.manifest).map(s => [s.id, s.source.version]), [['synthetic-db-collections', '0.0.2']]);
  const sync = run(p.dir, ['skills', 'sync'], p.serve); assert.equal(sync.status, 3, sync.stderr);
  assert.match(sync.stdout, /^ {2}synthetic-db-collections +update to @synthetic\/db-skills@0\.0\.2:skills\/synthetic-db\/collections, fetched from registry\.npmjs\.org$/m);
  approve(p, ['skills', 'sync'], p.serve);
  assert.match(readFileSync(installed, 'utf8'), /Version two\./);
  const again = run(p.dir, ['skills', 'sync', '--offline'], p.deny); assert.equal(again.status, 0, again.stderr); assert.match(again.stdout, /Nothing to change\.\n$/);
});

test('--replace moves a GitHub skill to a new commit and keeps its teams when no --team is given', t => {
  const p = project(t);
  approve(p, ['skills', 'add', NPM_SPEC], p.serve); approve(p, ['skills', 'add', GIT_SPEC, '--id', 'verify', '--team', 'first-team'], p.serve);
  const shown = run(p.dir, ['skills', 'add', GIT_SPEC2, '--id', 'verify', '--replace'], p.serve); assert.equal(shown.status, 3, shown.stderr);
  assert.match(shown.stdout, new RegExp(`^Replace the pin of skill verify in \\.bowerloom/skills\\.json\\n  Old pin: GitHub synthetic-owner/skills-repo at ${COMMIT}, folder skills/verification-loop\\n  New pin: GitHub synthetic-owner/skills-repo at ${COMMIT2}, folder skills/verification-loop\\n  Skill name: verification-loop\\n  License: MIT \\(LICENSE\\)\\n  Files: 3\\n  Teams: first-team\\n`));
  approve(p, ['skills', 'add', GIT_SPEC2, '--id', 'verify', '--replace'], p.serve);
  assert.deepEqual(skills(p.manifest).map(s => [s.id, s.source.commit ?? s.source.version, s.teams ?? null]), [['synthetic-db-collections', '0.0.1', null], ['verify', COMMIT2, ['first-team']]]);
  const check = run(p.dir, ['skills', 'check'], p.deny); assert.equal(check.status, 0, check.stderr);
  // Review freeze finding 10: skills check pads the ids into one column.
  assert.match(check.stdout, new RegExp(`^ {2}verify +git synthetic-owner/skills-repo@${COMMIT2}:skills/verification-loop {2}\\(teams: first-team\\)$`, 'm'));
});

test('--replace refuses a change of source with SKILLS_ADD_SOURCE_CHANGED before any network call, and writes nothing', t => {
  const p = project(t);
  approve(p, ['skills', 'add', NPM_SPEC], p.serve); approve(p, ['skills', 'add', GIT_SPEC, '--id', 'verify'], p.serve);
  const before = tree(p.dir);
  for (const args of [
    [GIT_SPEC2, '--id', 'synthetic-db-collections'],
    ['npm:@synthetic/other-skills@0.0.2:skills/synthetic-db/collections', '--id', 'synthetic-db-collections'],
    [NPM_SPEC2, '--id', 'verify'],
    [`github:synthetic-owner/other-repo@${COMMIT2}:skills/verification-loop`, '--id', 'verify'],
  ]) {
    const r = run(p.dir, ['skills', 'add', ...args, '--replace'], p.deny); assert.equal(r.status, 1, args.join(' ')); assert.equal(errorCode(r.stderr), 'SKILLS_ADD_SOURCE_CHANGED', args.join(' '));
  }
  assert.deepEqual(p.denied(), []); assert.equal(tree(p.dir), before);
});

test('--replace refuses a local skill, a missing id and an unchanged pin; without --replace an existing id still refuses', t => {
  const p = project(t);
  approve(p, ['skill', 'create', 'house-style'], p.deny); approve(p, ['skills', 'add', NPM_SPEC], p.serve);
  const before = tree(p.dir);
  const local = run(p.dir, ['skills', 'add', NPM_SPEC2, '--id', 'house-style', '--replace'], p.deny); assert.equal(local.status, 1); assert.equal(errorCode(local.stderr), 'SKILLS_ADD_SOURCE_CHANGED');
  const missing = run(p.dir, ['skills', 'add', NPM_SPEC2, '--id', 'collections-next', '--replace'], p.deny); assert.equal(missing.status, 1); assert.equal(errorCode(missing.stderr), 'SKILLS_ADD_REPLACE_MISSING');
  const same = run(p.dir, ['skills', 'add', NPM_SPEC, '--id', 'synthetic-db-collections', '--replace'], p.deny); assert.equal(same.status, 1); assert.equal(errorCode(same.stderr), 'SKILLS_ADD_EXISTS');
  assert.deepEqual(p.denied(), []);
  const unnamed = run(p.dir, ['skills', 'add', NPM_SPEC, '--replace'], p.serve); assert.equal(unnamed.status, 1); assert.equal(errorCode(unnamed.stderr), 'SKILLS_ADD_EXISTS', 'the fetched name pins the same version');
  const plain = run(p.dir, ['skills', 'add', NPM_SPEC2], p.serve); assert.equal(plain.status, 1); assert.equal(errorCode(plain.stderr), 'SKILLS_ADD_EXISTS');
  const named = run(p.dir, ['skills', 'add', NPM_SPEC2, '--id', 'synthetic-db-collections'], p.deny); assert.equal(named.status, 1); assert.equal(errorCode(named.stderr), 'SKILLS_ADD_EXISTS');
  assert.match(JSON.parse(named.stderr).error.message, /add --replace/);
  assert.equal(run(p.dir, ['skills', 'add', NPM_SPEC2, '--replace', '--replace'], p.deny).status, 2);
  assert.equal(tree(p.dir), before);
});

test('a --replace approval is stale after a concurrent edit of skills.json; nothing is applied', t => {
  const p = project(t);
  approve(p, ['skills', 'add', NPM_SPEC], p.serve);
  const { revision } = planOf(p, ['skills', 'add', NPM_SPEC2, '--replace'], p.serve);
  approve(p, ['skills', 'add', GIT_SPEC], p.serve);
  const edited = readFileSync(p.manifest);
  const stale = run(p.dir, ['skills', 'add', NPM_SPEC2, '--replace', '--approve', revision], p.serve);
  assert.equal(stale.status, 1, stale.stderr); assert.equal(errorCode(stale.stderr), 'STALE_APPROVAL');
  assert.deepEqual(readFileSync(p.manifest), edited);
  assert.deepEqual(skills(p.manifest).map(s => [s.id, s.source.version ?? s.source.commit]), [['synthetic-db-collections', '0.0.1'], ['verification-loop', COMMIT]]);
  approve(p, ['skills', 'add', NPM_SPEC2, '--replace'], p.serve);
  assert.equal(skills(p.manifest)[0]!.source.version, '0.0.2');
});

test('help skills names --replace, and the plain words of SKILLS_ADD_EXISTS point to it', t => {
  const home = folder(t), deny = network(home, false), env = { HOME: home, ...deny.env };
  const topic = run(home, ['help', 'skills'], env); assert.equal(topic.status, 0, topic.stderr);
  assert.match(topic.stdout, /^ {2}bowerloom skills add npm:<package>@<version>:<path> \[--id <id>\] \[--team <team>\]\.\.\. \[--replace\] \[--approve <revision>\] \[--json\]$/m);
  assert.match(topic.stdout, /^ {2}bowerloom skills add github:<owner>\/<repo>@<40-char-commit>:<path> \[--id <id>\] \[--team <team>\]\.\.\. \[--replace\] \[--approve <revision>\] \[--json\]$/m);
  assert.match(topic.stdout, /^--replace moves an existing id to another version or commit of the same package or repository\./m);
  const words = renderRefusal('SKILLS_ADD_EXISTS', 'message');
  assert.match(words, /\nNext: bowerloom skills add <source> --id <id> --replace\n$/);
  assert.match(renderRefusal('SKILLS_ADD_SOURCE_CHANGED', 'message'), /\nNext: bowerloom skills check\n$/);
  assert.match(renderRefusal('SKILLS_ADD_REPLACE_MISSING', 'message'), /\nNext: bowerloom skills check\n$/);
  assert.deepEqual(deny.calls(), []);
});
