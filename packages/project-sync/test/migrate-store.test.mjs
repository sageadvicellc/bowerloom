// Spec 08, 3.1 to 3.3: store migrate. It copies chosen skills, prompts, and teams from a project to the store, lists them
// with the source store in bowerloom.json, and deletes nothing. In a shared project a written item switches only after
// its pushed copy is proved. Section 10 numbers the tests.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork, npmPackage, writeManifest, localSkill } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, storePin, sha, code, pushStore, storeTransport, STORE_COMMIT } from './config-fixture.mjs';
import { planStoreMigrate, applyStoreMigrate, planLockUpdate, applyLockUpdate, STORE_MIGRATE_PLAN_FORMAT, STORE_MIGRATE_RESULT_FORMAT } from '../../../dist/packages/project-sync/src/index.js';
import { discoverProject, withProjectLock, withStoreForWrite } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';
import { readAuthoringState, receiptOf, recordText, pendingOf } from '../../../dist/packages/project-authoring/src/state.js';
import { parseManifest, serializeManifest, validateManifest, MANIFEST_LIMITS, STORE_MANIFEST_LIMITS } from '../../../dist/packages/skill-manifest/src/schema.js';
import { GithubToken } from '../../../dist/packages/skill-manifest/src/github-token.js';
import { manifestRefusal } from '../../../dist/packages/skill-manifest/src/refusal.js';
import { serializeConfig, readLock } from '../../../dist/packages/project-config/src/index.js';
import { compileCrew } from '../../../dist/packages/crew/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'every network read goes to a fake'));
const signal = () => new AbortController().signal;
/** A test crash: as it is before any write, or as the cause of a partial refusal after one (second security review L2). */
const crashed = e => e?.code === 'TEST_CRASH' || (e?.cause === 'TEST_CRASH' && /The run stopped part way\./.test(e.message));
const ctx = w => discoverProject(w.projectDir, w.home);
const bl = (w, rel = '') => path.join(w.projectDir, '.bowerloom', rel);
const TOKEN = () => GithubToken.fromEnv({ BOWERLOOM_GITHUB_TOKEN: `ghp_${'t'.repeat(36)}` });
const PLAN_KEYS = ['commit', 'config', 'executionAuthorized', 'folders', 'format', 'items', 'lock', 'manifest', 'network', 'notes', 'project', 'projectScratch', 'removeLines', 'revision', 'scratch', 'selectors', 'shared', 'skipped', 'staleLock', 'store', 'writesAuthorized'];
const ITEM_KEYS = ['candidate', 'entry', 'files', 'how', 'id', 'kind', 'lock', 'notSwitched', 'recorded', 'state', 'switch', 'teams'];

/** Creates one project item through the product's create path, under the project lock. */
async function projectItem(w, kind, id, extra = {}) {
  const input = kind === 'team' ? { kind, project: w.projectDir, name: id } : { kind, project: w.projectDir, name: id, teams: [], ...extra };
  const plan = await planCreate(input);
  return withProjectLock(w.projectDir, signal(), async held => applyCreate(input, plan.revision, held, undefined, ctx(w)));
}
/** The npm entry of `charts`, in the order skills.json keeps its fields and files. */
const normal = entry => validateManifest({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [entry] }, MANIFEST_LIMITS).skills[0];
const CHARTS = normal(npmPackage('charts').entry);
/**
 * A project with a pinned npm skill `charts`, a written skill `house-style`, a prompt `brief`, and a team `research`.
 * The items are made with a bowerloom.json, which `config: false` then removes: a beta.2 project has none.
 */
async function fourItems(t, { config = false } = {}) {
  const w = configWorld(t, { folder: true }); writeConfig(w, {});
  await projectItem(w, 'team', 'research'); await projectItem(w, 'skill', 'house-style'); await projectItem(w, 'prompt', 'brief');
  const skills = parseManifest(fs.readFileSync(bl(w, 'skills.json')), MANIFEST_LIMITS).skills;
  writeManifest({ projectDir: w.projectDir }, [CHARTS, ...skills]);
  if (config) writeConfig(w, { skills: [{ id: 'charts', source: 'project' }, { id: 'house-style', source: 'project' }], prompts: [{ id: 'brief', source: 'project' }], teams: [{ id: 'research', source: 'project' }] });
  else fs.rmSync(path.join(w.projectDir, 'bowerloom.json'));
  return w;
}
const selectors = (o = {}) => ({ skills: o.skills ?? [], prompts: o.prompts ?? [], teams: o.teams ?? [] });
const plan = (w, o = {}) => planStoreMigrate({ project: ctx(w), home: w.home, selectors: selectors(o), all: o.all === true, commit: o.commit ?? null, githubToken: o.token ?? null, ...(o.transport ? { storeTransport: o.transport } : {}), signal: signal() });
const apply = (w, p, o = {}) => applyStoreMigrate(p, o.revision ?? p.revision, { signal: signal(), githubToken: o.token ?? null, project: ctx(w), home: w.home, ...(o.hooks ? { hooks: o.hooks } : {}) });
async function migrate(w, o = {}) { const p = await plan(w, o); return { plan: p, result: await apply(w, p, o) }; }
/** Every path under a folder with the bytes of each file. */
function snapshot(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const rel of fs.readdirSync(dir, { recursive: true }).map(String).sort()) { const s = fs.lstatSync(path.join(dir, rel)); out[rel] = s.isSymbolicLink() ? 'link' : s.isFile() ? sha(fs.readFileSync(path.join(dir, rel))) : 'dir'; }
  return out;
}
const tree = (dir, rel) => Object.fromEntries(Object.entries(snapshot(path.join(dir, rel))).filter(([, v]) => v !== 'dir'));
const configOf = w => JSON.parse(fs.readFileSync(path.join(w.projectDir, 'bowerloom.json'), 'utf8'));
const storeSkills = w => parseManifest(fs.readFileSync(path.join(w.store, 'skills.json')), STORE_MANIFEST_LIMITS).skills;
const storeReceipt = w => readAuthoringState(w.store).receipt?.value.items ?? [];
const pairs = p => p.items.map(i => `${i.kind} ${i.id}`);
/** A store whose repository has an origin and a pushed branch, as git leaves it. */
function gitStore(w, repo, { head } = {}) {
  const git = path.join(w.store, '.git'); fs.rmSync(git, { recursive: true, force: true });
  fs.mkdirSync(path.join(git, 'refs/remotes/origin'), { recursive: true, mode: 0o755 }); fs.mkdirSync(path.join(git, 'refs/heads'), { recursive: true });
  fs.writeFileSync(path.join(git, 'config'), '[remote "origin"]\n\turl = git@github.com:SageAdviceLLC/store.git\n');
  fs.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(git, 'refs/remotes/origin/main'), `${repo.commit}\n`); fs.writeFileSync(path.join(git, 'refs/heads/main'), `${head ?? repo.commit}\n`);
}
/** Pushes the store (without its .git) to a fake repository and gives the store the git files of that push. */
function push(w, options) {
  const git = path.join(w.store, '.git'), moved = path.join(w.base, `git-${Date.now()}`);
  if (fs.existsSync(git)) fs.renameSync(git, moved);
  const repo = pushStore(w); gitStore(w, repo, options); fs.rmSync(moved, { recursive: true, force: true }); return repo;
}
const originProject = w => { fs.mkdirSync(path.join(w.projectDir, '.git'), { mode: 0o755 }); fs.writeFileSync(path.join(w.projectDir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/o/app.git\n'); };

test('1. --all plans one line for each of a pinned skill, a written skill, a prompt and a team, each a copy; the plan matches 4.1', async t => {
  const w = await fourItems(t);
  const p = await plan(w, { all: true });
  assert.deepEqual(Object.keys(p).sort(), PLAN_KEYS);
  assert.equal(p.format, STORE_MIGRATE_PLAN_FORMAT);
  assert.deepEqual(pairs(p), ['skill charts', 'skill house-style', 'prompt brief', 'team research']);
  for (const item of p.items) { assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS); assert.equal(item.state, 'copy'); assert.equal(item.switch, true); assert.equal(item.notSwitched, null); assert.equal(item.lock, null); }
  const [charts, style, brief, research] = p.items;
  assert.equal(charts.how, 'pinned'); assert.deepEqual(charts.files, []); assert.deepEqual(charts.entry, CHARTS); assert.equal(charts.candidate, null);
  assert.equal(style.how, 'local'); assert.deepEqual(style.entry, { id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } });
  assert.deepEqual(style.files.map(f => f.path), ['skills/house-style/SKILL.md']);
  assert.deepEqual(brief.files.map(f => f.path), ['prompts/brief.md']); assert.equal(brief.entry, null);
  assert.equal(research.candidate, (await compileCrew(bl(w, 'teams/research/team.yaml'))).candidateRevision);
  assert.ok(research.files.every(f => f.path.startsWith('teams/research/')) && research.files.length > 3);
  assert.deepEqual(p.store, { create: true, dir: w.store, identity: null, skills: null, authoring: null });
  assert.deepEqual(p.folders, ['authoring', 'skills', 'prompts', 'teams']);
  assert.deepEqual(p.manifest.steps.map(s => s.id), ['charts', 'house-style']); assert.equal(p.manifest.steps[0].before, null);
  assert.equal(p.shared, false); assert.deepEqual(p.network, { hosts: [], credentials: null }); assert.equal(p.commit, null); assert.equal(p.lock, null);
  assert.deepEqual(p.selectors, { skills: [], prompts: [], teams: [], all: true, commit: null });
  assert.equal(p.writesAuthorized, false); assert.equal(p.executionAuthorized, false);
  assert.equal((await plan(w, { all: true })).revision, p.revision, 'the same state gives the same revision');
  assert.equal(fs.existsSync(w.store), false, 'a plan writes nothing');
});

test('2, 3 and 4. apply copies each item with its bytes, records the written ones, writes bowerloom.json, and changes nothing in .bowerloom', async t => {
  const w = await fourItems(t);
  const before = snapshot(bl(w));
  const { plan: p, result } = await migrate(w, { all: true });
  // 2. The store holds the same bytes, and the receipt and skills.json.
  assert.deepEqual(tree(w.store, 'skills/house-style'), tree(bl(w), 'skills/house-style'));
  assert.deepEqual(tree(w.store, 'teams/research'), tree(bl(w), 'teams/research'));
  assert.deepEqual(fs.readFileSync(path.join(w.store, 'prompts/brief.md')), fs.readFileSync(bl(w, 'prompts/brief.md')));
  assert.deepEqual(storeReceipt(w).map(i => [i.kind, i.id, i.teams, i.planRevision]), [['prompt', 'brief', [], p.revision], ['skill', 'house-style', [], p.revision], ['team', 'research', [], p.revision]]);
  for (const i of storeReceipt(w)) assert.deepEqual(i.files, p.items.find(x => x.kind === i.kind && x.id === i.id).files);
  assert.deepEqual(storeSkills(w), [CHARTS, { id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }]);
  assert.equal(fs.statSync(path.join(w.store, 'skills/house-style')).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(w.store, 'skills/house-style/SKILL.md')).mode & 0o777, 0o600);
  // 3. Nothing in .bowerloom changed, byte for byte.
  assert.deepEqual(snapshot(bl(w)), before);
  // 4. bowerloom.json: every project item, with the chosen ones from the store, in the exact serialization.
  const expected = serializeConfig({ format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'charts', source: 'store' }, { id: 'house-style', source: 'store' }], prompts: [{ id: 'brief', source: 'store' }], teams: [{ id: 'research', source: 'store' }] });
  assert.equal(fs.readFileSync(path.join(w.projectDir, 'bowerloom.json'), 'utf8'), expected);
  assert.equal(p.config.created, true); assert.equal(p.config.text, expected);
  assert.equal(fs.existsSync(path.join(w.projectDir, 'bowerloom.lock.json')), false);
  assert.deepEqual(result, { format: STORE_MIGRATE_RESULT_FORMAT, planRevision: p.revision, moved: p.items.map(i => ({ kind: i.kind, id: i.id, state: 'copy' })), copied: [], notSwitched: [], skipped: [], complete: true, configSha256: sha(expected), configBytes: Buffer.byteLength(expected), lockSha256: null, lockBytes: null, removeLines: p.removeLines, executionAuthorized: false });
  // 18. The staging folder is gone.
  assert.deepEqual(fs.readdirSync(path.join(w.store, 'authoring')), ['receipt.json']);
});

test('4b. a selection of one item lists every project item in the new bowerloom.json and flips only that one', async t => {
  const w = await fourItems(t);
  await migrate(w, { prompts: ['brief'] });
  assert.deepEqual(configOf(w), { format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'charts', source: 'project' }, { id: 'house-style', source: 'project' }], prompts: [{ id: 'brief', source: 'store' }], teams: [{ id: 'research', source: 'project' }] });
  assert.deepEqual(fs.readdirSync(w.store).sort(), ['.gitignore', 'authoring', 'prompts', 'store.json']);
});

test('5. an existing bowerloom.json: chosen items flip, a named unlisted item is added, others stay; --all leaves an unlisted item with its line', async t => {
  const w = await fourItems(t, { config: true });
  writeConfig(w, { skills: [{ id: 'house-style', source: 'project' }], prompts: [{ id: 'brief', source: 'project' }], teams: [{ id: 'research', source: 'project' }] });
  const all = await plan(w, { all: true });
  assert.deepEqual(pairs(all), ['skill house-style', 'prompt brief', 'team research']);
  assert.deepEqual(all.skipped, [{ kind: 'skill', id: 'charts', line: 'not listed in bowerloom.json, so it stays as it is.' }]);
  await migrate(w, { skills: ['charts'], prompts: ['brief'] });
  assert.deepEqual(configOf(w), { format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'charts', source: 'store' }, { id: 'house-style', source: 'project' }], prompts: [{ id: 'brief', source: 'store' }], teams: [{ id: 'research', source: 'project' }] });
});

test('6. tags: a team that is not in the store refuses MIGRATE_TEAM_MISSING; with the team selected it passes; first-team refuses or stays', async t => {
  const w = await fourItems(t);
  await projectItem(w, 'prompt', 'review', { teams: ['research'] });
  await assert.rejects(plan(w, { prompts: ['review'] }), e => e.code === 'MIGRATE_TEAM_MISSING' && /research/.test(e.message));
  const both = await plan(w, { prompts: ['review'], teams: ['research'] });
  assert.deepEqual(pairs(both), ['prompt review', 'team research']); assert.deepEqual(both.items[0].teams, ['research']);
  await apply(w, both);
  assert.deepEqual(storeReceipt(w).find(i => i.id === 'review').teams, ['research'], 'the tag holds');
  // first-team is never in the store.
  fs.mkdirSync(bl(w, 'teams/first-team'), { recursive: true, mode: 0o755 });
  await projectItem(w, 'skill', 'lead-notes', { teams: ['first-team'] });
  await assert.rejects(plan(w, { skills: ['lead-notes'] }), code('MIGRATE_TEAM_MISSING'));
  const all = await plan(w, { all: true });
  assert.ok(!pairs(all).includes('skill lead-notes'));
  assert.deepEqual(all.skipped.find(s => s.id === 'lead-notes'), { kind: 'skill', id: 'lead-notes', line: 'stays in this project. Its team first-team is not in the store.' });
});

test('7. MIGRATE_RESERVED, MIGRATE_ITEM_NOT_FOUND, MIGRATE_ITEM_UNSUPPORTED, CONFIG_ITEM_SELECTED; a prompt named first-team is ordinary', async t => {
  const w = await fourItems(t);
  await assert.rejects(plan(w, { teams: ['first-team'] }), code('MIGRATE_RESERVED'));
  await assert.rejects(plan(w, { skills: ['personal-assistant'] }), code('MIGRATE_RESERVED'));
  await assert.rejects(plan(w, { skills: ['nope'] }), code('MIGRATE_ITEM_NOT_FOUND'));
  await assert.rejects(plan(w, { teams: ['nope'] }), code('MIGRATE_ITEM_NOT_FOUND'));
  await projectItem(w, 'prompt', 'first-team');
  assert.deepEqual(pairs(await plan(w, { prompts: ['first-team'] })), ['prompt first-team']);
  // A registered prompt whose file is gone: explicit refuses, --all skips it.
  await projectItem(w, 'prompt', 'gone'); fs.rmSync(bl(w, 'prompts/gone.md'));
  await assert.rejects(plan(w, { prompts: ['gone'] }), code('MIGRATE_ITEM_NOT_FOUND'));
  const goneAll = await plan(w, { all: true });
  assert.ok(!pairs(goneAll).includes('prompt gone'));
  assert.deepEqual(goneAll.skipped.find(s => s.id === 'gone'), { kind: 'prompt', id: 'gone', line: 'its files are gone, so it stays as it is.' }, 'review M1: --all names an item whose files are gone');
  // A skill with an empty file, and one with a script: explicit refuses with the reason, --all keeps it with a line.
  await projectItem(w, 'skill', 'empty'); fs.writeFileSync(bl(w, 'skills/empty/notes.md'), '');
  await assert.rejects(plan(w, { skills: ['empty'] }), e => e.code === 'MIGRATE_ITEM_UNSUPPORTED' && e.message.endsWith('It holds an empty file, which a store item cannot hold.'));
  localSkill({ projectDir: w.projectDir }, 'big', { 'SKILL.md': '# big\n', 'references/a.md': 'x'.repeat(70000) });
  const manifest = parseManifest(fs.readFileSync(bl(w, 'skills.json')), MANIFEST_LIMITS).skills;
  writeManifest({ projectDir: w.projectDir }, [...manifest, { id: 'big', source: { kind: 'local', path: 'skills/big' } }]);
  await assert.rejects(plan(w, { skills: ['big'] }), e => e.code === 'MIGRATE_ITEM_UNSUPPORTED' && e.message.endsWith('It is larger than a store item can be.'));
  const all = await plan(w, { all: true });
  assert.deepEqual(all.skipped.filter(s => s.id === 'empty' || s.id === 'big'), [
    // Round 3 of the reviews of PR 101: the skip names the file and gives its step.
    { kind: 'skill', id: 'big', line: 'stays in this project. It is larger than a store item can be. .bowerloom/skills/big/references/a.md is larger than 65536 bytes, the most a lock records for one file. Make it smaller, or split it into smaller files. Then run the command again.' },
    { kind: 'skill', id: 'empty', line: 'stays in this project. It holds an empty file, which a store item cannot hold. .bowerloom/skills/empty/notes.md is empty. Add content to it, or delete it if you do not need it. Then run the command again.' },
  ]);
  // CONFIG_ITEM_SELECTED: the config lists the item from the store already. --all skips it.
  await migrate(w, { prompts: ['brief'] });
  await assert.rejects(plan(w, { prompts: ['brief'] }), e => e.code === 'CONFIG_ITEM_SELECTED' && e.next === 'git rm .bowerloom/prompts/brief.md', 'review H2: the next step removes the old copy');
  assert.ok(!pairs(await plan(w, { all: true })).includes('prompt brief'));
});

test('7b. MIGRATE_ID_EXISTS for each kind, a pinned entry that differs, a store record whose path is gone, and a store folder of a pinned id', async t => {
  const w = await fourItems(t);
  // A store skill, prompt and team with the same ids and other bytes.
  await storeItem(w, 'team', 'research'); await storeItem(w, 'skill', 'house-style'); await storeItem(w, 'prompt', 'brief');
  fs.appendFileSync(path.join(w.store, 'skills/house-style/SKILL.md'), 'edited\n');
  fs.appendFileSync(path.join(w.store, 'prompts/brief.md'), 'edited\n');
  fs.appendFileSync(path.join(w.store, 'teams/research/assets/milestones.md'), 'edited\n');
  for (const o of [{ skills: ['house-style'] }, { prompts: ['brief'] }, { teams: ['research'] }]) await assert.rejects(plan(w, o), code('MIGRATE_ID_EXISTS'), JSON.stringify(o));
  const before = snapshot(w.store);
  await assert.rejects(migrate(w, { all: true }), code('MIGRATE_ID_EXISTS'));
  assert.deepEqual(snapshot(w.store), before, 'nothing is written');
  // A pinned skill whose store entry has another version.
  storePin(w, npmPackage('charts', { version: '2.0.0' }).entry);
  await assert.rejects(plan(w, { skills: ['charts'] }), code('MIGRATE_ID_EXISTS'));
  // A store folder skills/<id> for a pinned project skill.
  const other = configWorld(t, { folder: true }); writeManifest({ projectDir: other.projectDir }, [CHARTS]);
  await storeItem(other, 'skill', 'charts');
  await assert.rejects(plan(other, { skills: ['charts'] }), code('MIGRATE_ID_EXISTS'));
  // A store record whose file is gone: the next step names receipt clean --global.
  fs.rmSync(path.join(w.store, 'prompts/brief.md'));
  await assert.rejects(plan(w, { prompts: ['brief'] }), e => e.code === 'MIGRATE_ID_EXISTS' && e.next === 'bowerloom receipt clean --global');
  // A pinned project entry whose pin another store id holds: SKILLS_ADD_EXISTS at plan time.
  const third = configWorld(t, { folder: true }); writeManifest({ projectDir: third.projectDir }, [CHARTS]);
  await storeItem(third, 'skill', 'seed'); storePin(third, { ...CHARTS, id: 'charts-copy' });
  await assert.rejects(plan(third, { skills: ['charts'] }), code('SKILLS_ADD_EXISTS'));
});

test('7c and 13 (limit). MIGRATE_LIMIT past 512 store records, with --all too; nothing is written', async t => {
  const w = await fourItems(t);
  await storeItem(w, 'skill', 'seed');
  const item = storeReceipt(w)[0], many = Array.from({ length: 510 }, (_, i) => ({ ...item, id: `filler-${i}`, files: [{ ...item.files[0], path: `skills/filler-${i}/SKILL.md` }] }));
  fs.writeFileSync(path.join(w.store, 'authoring/receipt.json'), recordText(receiptOf([item, ...many])));
  assert.equal((await plan(w, { prompts: ['brief'] })).items.length, 1, '511 + 1 is 512: allowed');
  await assert.rejects(plan(w, { prompts: ['brief'], teams: ['research'] }), code('MIGRATE_LIMIT'));
  await assert.rejects(plan(w, { all: true }), code('MIGRATE_LIMIT'));
});

test('8. states present and register; a folder with no skills.json entry is register; a pinned skill is never register', async t => {
  const w = await fourItems(t);
  // The store items made by create have the same bytes as the project items made by create.
  await storeItem(w, 'team', 'research'); await storeItem(w, 'skill', 'house-style'); await storeItem(w, 'prompt', 'brief');
  storePin(w, CHARTS);
  const p = await plan(w, { all: true });
  assert.deepEqual(p.items.map(i => i.state), ['present', 'present', 'present', 'present']);
  assert.equal(p.manifest, null); assert.deepEqual(p.folders, []);
  // Not in the receipt, and no skills.json entry: register; the entry is added.
  const rest = storeReceipt(w).filter(i => i.id !== 'house-style' && i.id !== 'brief');
  fs.writeFileSync(path.join(w.store, 'authoring/receipt.json'), recordText(receiptOf(rest)));
  fs.writeFileSync(path.join(w.store, 'skills.json'), serializeManifest(validateManifest({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [CHARTS] }, STORE_MANIFEST_LIMITS), STORE_MANIFEST_LIMITS));
  const q = await plan(w, { all: true });
  assert.deepEqual(q.items.map(i => `${i.id} ${i.state}`), ['charts present', 'house-style register', 'brief register', 'research present']);
  assert.deepEqual(q.manifest.steps.map(s => s.id), ['house-style']);
  await apply(w, q);
  assert.deepEqual(storeReceipt(w).map(i => i.id).sort(), ['brief', 'house-style', 'research']);
  assert.deepEqual(storeSkills(w).map(s => s.id), ['charts', 'house-style']);
  // Review C1: a store record whose skills.json entry is missing: the entry is added, and no second record is written.
  const c = await fourItems(t); await storeItem(c, 'skill', 'house-style');
  fs.writeFileSync(path.join(c.store, 'skills.json'), serializeManifest(validateManifest({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [] }, STORE_MANIFEST_LIMITS), STORE_MANIFEST_LIMITS));
  const cp = await plan(c, { skills: ['house-style'] });
  assert.deepEqual(cp.items.map(i => [i.state, i.recorded]), [['register', true]]);
  await apply(c, cp);
  assert.equal(storeReceipt(c).filter(i => i.id === 'house-style').length, 1);
  assert.deepEqual(storeSkills(c).map(s => s.id), ['house-style']);
  // Review M3 of the mutation list: a prompt's store record must carry the project tag.
  const m = await fourItems(t); await storeItem(m, 'team', 'ops'); await storeItem(m, 'prompt', 'brief', { teams: ['ops'] });
  await assert.rejects(plan(m, { prompts: ['brief'] }), code('MIGRATE_ID_EXISTS'));
  // Mutant M4: a pinned project skill and an orphan store folder skills/<id> with no entry and no record.
  const o = await fourItems(t); await storeItem(o, 'skill', 'seed'); fs.mkdirSync(path.join(o.store, 'skills/charts'), { mode: 0o700 }); fs.writeFileSync(path.join(o.store, 'skills/charts/SKILL.md'), '# charts\n', { mode: 0o600 });
  await assert.rejects(plan(o, { skills: ['charts'] }), code('MIGRATE_ID_EXISTS'));
  // A local store entry with another tag refuses.
  const v = await fourItems(t); await storeItem(v, 'team', 'ops'); await storeItem(v, 'skill', 'house-style', { teams: ['ops'] });
  await assert.rejects(plan(v, { skills: ['house-style'] }), code('MIGRATE_ID_EXISTS'));
});

test('9. a team copies whole with agents/, its candidate equals the source; a staged file changed before the move refuses STALE_APPROVAL', async t => {
  const w = await fourItems(t);
  fs.mkdirSync(bl(w, 'teams/research/agents'), { mode: 0o755 }); fs.writeFileSync(bl(w, 'teams/research/agents/lead.md'), '---\nname: lead\ndescription: Leads.\n---\nLead.\n');
  const p = await plan(w, { teams: ['research'] });
  assert.ok(p.items[0].files.some(f => f.path === 'teams/research/agents/lead.md'));
  const changed = await plan(w, { teams: ['research'] });
  await assert.rejects(apply(w, changed, { hooks: { afterStage: (kind, id, dir) => { if (kind === 'team') fs.appendFileSync(path.join(dir, 'assets/milestones.md'), 'changed\n'); } } }), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(path.join(w.store, 'teams/research')), false, 'nothing was moved');
  // A skill has no compile step: the staged files themselves are checked against the plan before the move.
  const skill = await plan(w, { skills: ['house-style'] });
  await assert.rejects(apply(w, skill, { hooks: { afterStage: (kind, id, dir) => { if (kind === 'skill') fs.writeFileSync(path.join(dir, 'extra.md'), 'not planned\n', { mode: 0o600 }); } } }), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(path.join(w.store, 'skills/house-style')), false, 'the changed skill was not moved');
  await apply(w, await plan(w, { teams: ['research'] }));
  assert.deepEqual(tree(w.store, 'teams/research'), tree(bl(w), 'teams/research'));
  assert.equal((await compileCrew(path.join(w.store, 'teams/research/team.yaml'))).candidateRevision, p.items[0].candidate);
});

test('10. not shared: every item switches, no lock is written, no network is read, and --commit is accepted and unused', async t => {
  const w = await fourItems(t);
  const p = await plan(w, { all: true, commit: 'a'.repeat(40) });
  assert.equal(p.shared, false); assert.ok(p.items.every(i => i.switch)); assert.equal(p.commit, null); assert.equal(p.lock, null);
  await apply(w, p);
  assert.equal(fs.existsSync(path.join(w.projectDir, 'bowerloom.lock.json')), false);
  await assert.rejects(plan(w, { all: true, commit: 'A'.repeat(40) }), code('USAGE'));
  await assert.rejects(plan(w, {}), code('USAGE'));
  await assert.rejects(plan(w, { all: true, skills: ['charts'] }), code('USAGE'));
  await assert.rejects(plan(w, { skills: ['charts', 'charts'] }), code('USAGE'));
});

test('11. shared by origin: a pinned skill locks; a copy is copy-only with no network; present without .git, pushed and equal, and edited after', async t => {
  const w = await fourItems(t); originProject(w);
  const first = await plan(w, { all: true });
  assert.equal(first.shared, true);
  assert.equal((await plan(w, { prompts: ['brief'] })).config, null, 'review C3: only written items in a shared project: no config change');
  assert.deepEqual(first.items.map(i => [i.id, i.switch, i.notSwitched?.sentence ?? null]), [['charts', true, null], ['house-style', false, 'It is new in your store and not pushed yet'], ['brief', false, 'It is new in your store and not pushed yet'], ['research', false, 'It is new in your store and not pushed yet']]);
  assert.deepEqual(first.network, { hosts: [], credentials: null });
  const firstResult = await apply(w, first);
  // Review M2: moved names only what switched; the copies are named apart, and the result is not complete.
  assert.deepEqual(firstResult.moved, [{ kind: 'skill', id: 'charts', state: 'copy' }]);
  assert.deepEqual(firstResult.copied.map(i => `${i.kind} ${i.id}`), ['skill house-style', 'prompt brief', 'team research']);
  assert.equal(firstResult.complete, false);
  assert.deepEqual(configOf(w).skills, [{ id: 'charts', source: 'store' }, { id: 'house-style', source: 'project' }]);
  assert.deepEqual(readLock(ctx(w)).lock.skills, [{ id: 'charts', from: 'store', pin: CHARTS }]);
  // Present, and the store is not a git repository: copy-only with that sentence; nothing reads the network.
  const none = await plan(w, { all: true });
  assert.deepEqual(none.items.map(i => [i.id, i.state, i.switch, i.notSwitched?.sentence]), [['house-style', 'present', false, 'The store is not a git repository'], ['brief', 'present', false, 'The store is not a git repository'], ['research', 'present', false, 'The store is not a git repository']]);
  assert.equal(none.config, null); assert.equal(none.lock, null);
  // Pushed and equal: each switches and is locked after its proof.
  const repo = push(w), urls = [];
  const proved = await plan(w, { all: true, transport: storeTransport(repo, urls) });
  assert.ok(proved.items.every(i => i.switch)); assert.deepEqual(proved.network, { hosts: ['api.github.com'], credentials: null });
  assert.equal(proved.commit, STORE_COMMIT); assert.ok(urls.length > 0);
  assert.match(proved.notes[0], /^Network: reads api\.github\.com, to check the pushed copy of 3 items, about \d+ requests to api\.github\.com\.$/);
  assert.deepEqual(proved.items.map(i => i.lock), ['sageadvicellc/store commit 01234567, hash ' + readHash(proved, 'skill', 'house-style'), 'sageadvicellc/store commit 01234567, hash ' + readHash(proved, 'prompt', 'brief'), 'sageadvicellc/store commit 01234567, hash ' + readHash(proved, 'team', 'research')]);
  // Edited after the push, in the store and the project alike: copy-only with the pushed-copy sentence.
  fs.appendFileSync(path.join(w.store, 'prompts/brief.md'), 'edited\n'); fs.appendFileSync(bl(w, 'prompts/brief.md'), 'edited\n');
  const edited = await plan(w, { all: true, transport: storeTransport(repo) });
  assert.deepEqual(edited.items.find(i => i.id === 'brief').notSwitched, { code: 'LOCK_STORE_NOT_PUSHED', sentence: 'The pushed copy differs from your store' });
});
const readHash = (p, kind, id) => JSON.parse(p.lock.text)[`${kind}s`].find(i => i.id === id).authored.hash.slice(0, 8);

test('11a. a lock and no origin is shared: written copies are copy-only, and pinned items lock', async t => {
  const w = await fourItems(t, { config: true }); writeLock(w, {});
  const p = await plan(w, { all: true });
  assert.equal(p.shared, true);
  assert.deepEqual(p.items.map(i => [i.id, i.switch]), [['charts', true], ['house-style', false], ['brief', false], ['research', false]]);
  await apply(w, p);
  assert.deepEqual(readLock(ctx(w)).lock.skills.map(i => i.id), ['charts']);
});

test('11b. shared: a private remote refuses STORE_REMOTE_PRIVATE, no network refuses SKILLS_OFFLINE; a token names the repository', async t => {
  const w = await fourItems(t); originProject(w);
  await apply(w, await plan(w, { all: true }));
  const repo = push(w);
  const before = { store: snapshot(w.store), project: snapshot(w.projectDir) };
  await assert.rejects(plan(w, { all: true, transport: storeTransport({ responses: new Map() }) }), code('STORE_REMOTE_PRIVATE'));
  await assert.rejects(plan(w, { all: true, transport: storeTransport(repo, [], { override: () => { throw manifestRefusal('SKILLS_ADD_NETWORK'); } }) }), e => e.code === 'SKILLS_OFFLINE' && e.message.endsWith(' Checking skill house-style, prompt brief, team research needs api.github.com, and the network was not reachable.') && e.next === 'Connect to the network and run the command again.');
  assert.deepEqual({ store: snapshot(w.store), project: snapshot(w.projectDir) }, before, 'nothing is written');
  const withToken = await plan(w, { all: true, transport: storeTransport(repo), token: TOKEN() });
  assert.deepEqual(withToken.network.credentials, { variable: 'BOWERLOOM_GITHUB_TOKEN', host: 'api.github.com', repositories: ['sageadvicellc/store'] });
  assert.equal(JSON.stringify(withToken).includes('t'.repeat(36)), false, 'the plan never holds the token');
  // A --commit that is not on the remote makes the items copy-only.
  const missing = await plan(w, { all: true, transport: storeTransport({ responses: new Map() }), commit: 'c'.repeat(40) });
  assert.deepEqual(missing.items[0].notSwitched, { code: 'LOCK_COMMIT_UNREACHABLE', sentence: 'The commit is not on the remote. Fix this, then run this command again' });
});

test('12. rerun after the push: every item is present, switches and locks, with no copy', async t => {
  const w = await fourItems(t); originProject(w);
  await apply(w, await plan(w, { all: true }));
  const repo = push(w);
  const { plan: p } = await migrate(w, { all: true, transport: storeTransport(repo) });
  assert.ok(p.items.every(i => i.state === 'present' && i.switch));
  assert.deepEqual(configOf(w).prompts, [{ id: 'brief', source: 'store' }]);
  assert.deepEqual(readLock(ctx(w)).lock.teams.map(i => [i.id, i.authored.commit]), [['research', STORE_COMMIT]]);
  assert.equal(fs.readFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), 'utf8'), p.lock.text);
});

test('13 and 18. crash points after steps 3, 4 and 5: a rerun reaches the final state, and no staging folder stays', async t => {
  const finalOf = w => ({ store: snapshot(w.store), config: fs.readFileSync(path.join(w.projectDir, 'bowerloom.json'), 'utf8') });
  const clean = await fourItems(t); await migrate(clean, { all: true });
  const strip = s => Object.fromEntries(Object.entries(s.store).filter(([k]) => k !== 'authoring/receipt.json'));
  for (const step of [3, 4, 5]) {
    const w = await fourItems(t), boom = Object.assign(new Error('crash'), { code: 'TEST_CRASH' });
    await assert.rejects(migrate(w, { all: true, hooks: { afterStep: n => { if (n === step) throw boom; } } }), crashed);
    const again = await plan(w, { all: true });
    if (step === 3) assert.deepEqual(again.items.map(i => i.state), ['copy', 'register', 'register', 'register']);
    if (step === 4) assert.deepEqual(again.items.map(i => i.state), ['present', 'register', 'register', 'register']);
    if (step === 5) assert.deepEqual(again.items.map(i => i.state), ['present', 'present', 'present', 'present']);
    assert.ok(again.scratch.every(n => n.startsWith('.stage-')), 'a leftover stage is scratch');
    await apply(w, again);
    assert.deepEqual(fs.readdirSync(path.join(w.store, 'authoring')), ['receipt.json'], `${step}: no staging folder stays`);
    assert.deepEqual(strip(finalOf(w)), strip(finalOf(clean)), `${step}: the same store files`);
    assert.equal(finalOf(w).config, finalOf(clean).config);
  }
  // A crash while copying the second item: the first is register, the second is copied.
  const w = await fourItems(t), boom = Object.assign(new Error('crash'), { code: 'TEST_CRASH' });
  await assert.rejects(migrate(w, { prompts: ['brief'], teams: ['research'], hooks: { afterItem: kind => { if (kind === 'prompt') throw boom; } } }), crashed);
  assert.deepEqual((await plan(w, { prompts: ['brief'], teams: ['research'] })).items.map(i => i.state), ['register', 'copy']);
});

test('13b. a crash after the config write in a shared project: --all prints the stale-lock line and nothing to move; lock update heals it', async t => {
  const w = await fourItems(t); originProject(w);
  await apply(w, await plan(w, { all: true }));
  const repo = push(w), boom = Object.assign(new Error('crash'), { code: 'TEST_CRASH' });
  const lockBefore = fs.readFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), 'utf8');
  await assert.rejects(migrate(w, { all: true, transport: storeTransport(repo), hooks: { afterStep: n => { if (n === 7) throw boom; } } }), crashed);
  assert.equal(fs.readFileSync(path.join(w.projectDir, 'bowerloom.lock.json'), 'utf8'), lockBefore, 'the lock was not written');
  const rerun = await plan(w, { all: true, transport: storeTransport(repo) });
  assert.deepEqual(rerun.items, []);
  assert.deepEqual(rerun.staleLock, ['prompt brief', 'skill house-style', 'team research']);
  const update = await planLockUpdate({ project: ctx(w), home: w.home, items: null, commit: null, storeTransport: storeTransport(repo), signal: signal() });
  await withProjectLock(w.projectDir, signal(), async held => applyLockUpdate(update, update.revision, held, ctx(w), w.home));
  assert.deepEqual((await plan(w, { all: true })).staleLock, []);
  assert.deepEqual(readLock(ctx(w)).lock.prompts.map(i => i.id), ['brief']);
});

test('13c. a crash after step 7 in a project that is not shared: the config is written and a rerun has nothing to move', async t => {
  const w = await fourItems(t), boom = Object.assign(new Error('crash'), { code: 'TEST_CRASH' });
  await assert.rejects(migrate(w, { all: true, hooks: { afterStep: n => { if (n === 7) throw boom; } } }), crashed);
  assert.equal(configOf(w).teams[0].source, 'store');
  const rerun = await plan(w, { all: true });
  assert.deepEqual(rerun.items, []);
  // Review H2: the old copies are still in the project, so the plan names them and gives the lines that remove them.
  assert.deepEqual(rerun.skipped.map(s => `${s.kind} ${s.id}: ${s.line}`), ['skill charts', 'skill house-style', 'prompt brief', 'team research'].map(x => `${x}: already listed from the store; its old copy is still in this project.`));
  assert.deepEqual(rerun.removeLines, ['  git rm -r .bowerloom/skills/house-style', '  git rm .bowerloom/prompts/brief.md', '  git rm -r .bowerloom/teams/research', 'Bowerloom does not edit .bowerloom/skills.json. Remove the line for skill charts yourself.']);
});

test('14. a stale plan refuses STALE_APPROVAL: a project file, the store skills.json or receipt, bowerloom.json, the lock, a switched item, or the token', async t => {
  const cases = [
    ['project file', w => fs.appendFileSync(bl(w, 'skills/house-style/SKILL.md'), 'x\n')],
    ['store skills.json', w => storePin(w, npmPackage('other').entry)],
    ['store receipt', async w => { await storeItem(w, 'prompt', 'late'); }],
    ['config', w => writeConfig(w, { skills: [{ id: 'charts', source: 'project' }] })],
    ['lock', w => writeLock(w, {})],
  ];
  for (const [name, change] of cases) {
    const w = await fourItems(t); await storeItem(w, 'skill', 'seed');
    const p = await plan(w, { all: true });
    await change(w);
    const before = { store: snapshot(w.store), project: snapshot(w.projectDir) };
    await assert.rejects(apply(w, p), code('STALE_APPROVAL'), name);
    assert.deepEqual({ store: snapshot(w.store), project: snapshot(w.projectDir) }, before, `${name}: nothing was written`);
  }
  // A switched item that changed after its proof.
  const w = await fourItems(t); originProject(w); await apply(w, await plan(w, { all: true }));
  const repo = push(w), p = await plan(w, { all: true, transport: storeTransport(repo) });
  fs.appendFileSync(path.join(w.store, 'teams/research/assets/milestones.md'), 'x\n');
  await assert.rejects(apply(w, p), code('STALE_APPROVAL'), 'a switched item');
  fs.writeFileSync(path.join(w.store, 'teams/research/assets/milestones.md'), fs.readFileSync(bl(w, 'teams/research/assets/milestones.md')));
  // The token: set after a plan without one, removed after a plan with one.
  await assert.rejects(apply(w, await plan(w, { all: true, transport: storeTransport(repo) }), { token: TOKEN() }), code('STALE_APPROVAL'), 'a token set after the plan');
  await assert.rejects(apply(w, await plan(w, { all: true, transport: storeTransport(repo), token: TOKEN() })), code('STALE_APPROVAL'), 'a token removed after the plan');
  await apply(w, await plan(w, { all: true, transport: storeTransport(repo), token: TOKEN() }), { token: TOKEN() });
  assert.equal(configOf(w).teams[0].source, 'store');
  // A revision that is not the plan's own.
  const v = await fourItems(t), q = await plan(v, { all: true });
  await assert.rejects(apply(v, { ...q, commit: 'f'.repeat(40) }), code('STALE_APPROVAL'));
  await assert.rejects(apply(v, q, { revision: 'f'.repeat(64) }), code('STALE_APPROVAL'));
});

test('15. the remove lines list only switched items; the skills.json line is for a switched pinned skill or one not in the project receipt', async t => {
  const w = await fourItems(t);
  localSkill({ projectDir: w.projectDir }, 'hand-made');
  writeManifest({ projectDir: w.projectDir }, [...parseManifest(fs.readFileSync(bl(w, 'skills.json')), MANIFEST_LIMITS).skills, { id: 'hand-made', source: { kind: 'local', path: 'skills/hand-made' } }]);
  const p = await plan(w, { all: true });
  assert.deepEqual(p.removeLines, [
    '  git rm -r .bowerloom/skills/hand-made', '  git rm -r .bowerloom/skills/house-style', '  git rm .bowerloom/prompts/brief.md', '  git rm -r .bowerloom/teams/research',
    'Bowerloom does not edit .bowerloom/skills.json. Remove the line for skill charts yourself.',
    'Bowerloom does not edit .bowerloom/skills.json. Remove the line for skill hand-made yourself.',
  ]);
  const shared = await fourItems(t); originProject(shared);
  assert.deepEqual((await plan(shared, { all: true })).removeLines, ['Bowerloom does not edit .bowerloom/skills.json. Remove the line for skill charts yourself.'], 'copy-only items have no line');
});

test('16. the 257th store skill refuses MANIFEST_LIMIT, and nothing is written', async t => {
  const w = await fourItems(t); await storeItem(w, 'skill', 'seed');
  const filler = Array.from({ length: 255 }, (_, i) => ({ id: `filler-${i}`, source: { kind: 'local', path: `skills/filler-${i}` } }));
  fs.writeFileSync(path.join(w.store, 'skills.json'), serializeManifest(validateManifest({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'seed', source: { kind: 'local', path: 'skills/seed' } }, ...filler] }, STORE_MANIFEST_LIMITS), STORE_MANIFEST_LIMITS));
  const before = snapshot(w.store);
  await assert.rejects(plan(w, { skills: ['charts'] }), code('MANIFEST_LIMIT'));
  assert.deepEqual(snapshot(w.store), before);
});

test('17. the store lock is taken before the project lock', async t => {
  const w = await fourItems(t), order = [];
  const p = await plan(w, { prompts: ['brief'] });
  await apply(w, p, { hooks: { locked: name => order.push(name) } });
  assert.deepEqual(order, ['store', 'project']);
  // A store that exists already: another holder of the project lock gives PROJECT_LOCKED, not STORE_LOCKED, and no write.
  const v = await fourItems(t); await storeItem(v, 'skill', 'seed');
  const q = await plan(v, { prompts: ['brief'] }), before = snapshot(v.store);
  await withProjectLock(v.projectDir, signal(), async () => assert.rejects(apply(v, q), e => e.code === 'PROJECT_LOCKED' && !/made the store/.test(e.message)));
  assert.deepEqual(snapshot(v.store), before);
});

test('19. lock rules: an old lock item that is not a store entry is dropped; a store entry neither switched nor locked refuses LOCK_CONFIG_MISMATCH', async t => {
  const w = await fourItems(t, { config: true });
  writeLock(w, { skills: [{ id: 'old', from: 'store', pin: { ...CHARTS, id: 'old' } }] });
  const p = await plan(w, { skills: ['charts'] });
  assert.deepEqual(JSON.parse(p.lock.text).skills.map(i => i.id), ['charts']);
  await apply(w, p);
  // A store entry from an earlier use that the lock lacks.
  const v = await fourItems(t, { config: true });
  await storeItem(v, 'prompt', 'weekly');
  writeConfig(v, { skills: [{ id: 'charts', source: 'project' }], prompts: [{ id: 'brief', source: 'project' }, { id: 'weekly', source: 'store' }] });
  writeLock(v, {});
  await assert.rejects(plan(v, { skills: ['charts'] }), e => e.code === 'LOCK_CONFIG_MISMATCH' && /prompt weekly/.test(e.message));
});

test('20. a pending record in the store or the project refuses AUTHORING_PENDING; a revision file REVISION_PENDING; store scratch goes at step 1', async t => {
  const w = await fourItems(t); await storeItem(w, 'skill', 'seed');
  const item = storeReceipt(w)[0];
  fs.writeFileSync(path.join(w.store, 'authoring/pending.json'), recordText(pendingOf(item)));
  await assert.rejects(plan(w, { all: true }), code('AUTHORING_PENDING'));
  fs.rmSync(path.join(w.store, 'authoring/pending.json'));
  fs.writeFileSync(bl(w, 'authoring/pending.json'), recordText(pendingOf(readAuthoringState(bl(w)).receipt.value.items[0])));
  await assert.rejects(plan(w, { all: true }), code('AUTHORING_PENDING'));
  fs.rmSync(bl(w, 'authoring/pending.json'));
  fs.writeFileSync(path.join(w.projectDir, '.bowerloom-revision.json'), '{}');
  await assert.rejects(plan(w, { all: true }), code('REVISION_PENDING'));
  fs.rmSync(path.join(w.projectDir, '.bowerloom-revision.json'));
  const stage = `.stage-${'d'.repeat(64)}`; fs.mkdirSync(path.join(w.store, 'authoring', stage, 'skills/x'), { recursive: true, mode: 0o700 });
  const p = await plan(w, { prompts: ['brief'] });
  assert.deepEqual(p.scratch, [stage]);
  await apply(w, p);
  assert.equal(fs.existsSync(path.join(w.store, 'authoring', stage)), false);
});

test('21 and 3a. nothing to copy and no change; nothing to move; a project with no .bowerloom', async t => {
  const w = await fourItems(t); originProject(w);
  await apply(w, await plan(w, { all: true }));
  const p = await plan(w, { all: true });
  assert.ok(p.items.every(i => i.state === 'present' && !i.switch)); assert.equal(p.config, null); assert.equal(p.lock, null);
  // Only first-team and personal-assistant: nothing to move.
  const v = configWorld(t, { folder: true }); fs.mkdirSync(path.join(v.projectDir, '.bowerloom/teams/first-team'), { recursive: true });
  assert.deepEqual((await plan(v, { all: true })).items, []);
  const bare = configWorld(t); writeConfig(bare, {});
  assert.deepEqual((await plan(bare, { all: true })).items, []);
  await assert.rejects(plan(bare, { skills: ['x'] }), code('MIGRATE_ITEM_NOT_FOUND'));
});

test('4c (review C3). a shared project with only written items: no bowerloom.json is created', async t => {
  const w = await fourItems(t); originProject(w);
  const p = await plan(w, { prompts: ['brief'], teams: ['research'] });
  assert.equal(p.config, null); assert.equal(p.lock, null);
  const result = await apply(w, p);
  assert.equal(fs.existsSync(path.join(w.projectDir, 'bowerloom.json')), false);
  assert.deepEqual(result.moved, []); assert.equal(result.complete, false);
});

test('S1. a link at .bowerloom/skills, teams or prompts refuses AUTHORING_UNSAFE_PATH and copies nothing from outside the project', async t => {
  for (const [area, selector] of [['skills', { skills: ['house-style'] }], ['teams', { teams: ['research'] }], ['prompts', { prompts: ['brief'] }]]) {
    const w = await fourItems(t), outside = path.join(w.base, `outside-${area}`);
    fs.renameSync(bl(w, area), outside); fs.symlinkSync(outside, bl(w, area));
    for (const o of [{ all: true }, selector]) await assert.rejects(plan(w, o), e => e.code === 'AUTHORING_UNSAFE_PATH' && e.message.includes(`.bowerloom/${area}`), `${area} ${JSON.stringify(o)}`);
    assert.equal(fs.existsSync(w.store), false, `${area}: nothing reached the store`);
  }
  // A dangling link refuses too.
  const d = await fourItems(t); fs.rmSync(bl(d, 'teams'), { recursive: true }); fs.symlinkSync(path.join(d.base, 'nowhere'), bl(d, 'teams'));
  await assert.rejects(plan(d, { all: true }), code('AUTHORING_UNSAFE_PATH'));
});

test('S1b. a link swapped in after the plan: apply refuses STALE_APPROVAL with the cause, and copies nothing', async t => {
  const w = await fourItems(t), p = await plan(w, { skills: ['house-style'] });
  const copy = path.join(w.base, 'copy'); fs.cpSync(bl(w, 'skills'), copy, { recursive: true }); fs.rmSync(bl(w, 'skills'), { recursive: true }); fs.symlinkSync(copy, bl(w, 'skills'));
  await assert.rejects(apply(w, p), e => e.code === 'STALE_APPROVAL' && e.cause === 'AUTHORING_UNSAFE_PATH' && /^The plan changed after you saw it: AUTHORING_UNSAFE_PATH\. /.test(e.message));
  assert.equal(fs.existsSync(path.join(w.store, 'skills/house-style')), false);
});

test('S2. a store prompt that appears after the staging is never overwritten', async t => {
  const w = await fourItems(t), p = await plan(w, { prompts: ['brief'] });
  await assert.rejects(apply(w, p, { hooks: { afterStage: kind => { if (kind === 'prompt') { fs.mkdirSync(path.join(w.store, 'prompts'), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(w.store, 'prompts/brief.md'), 'theirs\n', { mode: 0o600 }); } } } }), code('STALE_APPROVAL'));
  assert.equal(fs.readFileSync(path.join(w.store, 'prompts/brief.md'), 'utf8'), 'theirs\n');
});

test('S4 (mutant M11). a store swapped after the first item, or a project swapped after step 5, refuses; nothing lands in the swapped folder', async t => {
  const w = await fourItems(t), p = await plan(w, { prompts: ['brief'], teams: ['research'] });
  const swapped = path.join(w.base, 'store-away');
  await assert.rejects(apply(w, p, { hooks: { afterItem: kind => { if (kind === 'prompt') { fs.renameSync(w.store, swapped); fs.cpSync(swapped, w.store, { recursive: true }); } } } }), e => ['STORE_LOCKED', 'STORE_UNSAFE'].includes(e.code));
  assert.equal(fs.existsSync(path.join(w.store, 'teams/research')), false, 'the team did not reach the swapped-in store');
  const v = await fourItems(t), q = await plan(v, { prompts: ['brief'] }), away = path.join(v.base, 'project-away');
  await assert.rejects(apply(v, q, { hooks: { afterStep: n => { if (n === 5) { fs.renameSync(v.projectDir, away); fs.cpSync(away, v.projectDir, { recursive: true }); } } } }), e => ['PROJECT_LOCKED', 'PROJECT_UNSAFE'].includes(e.code));
  assert.equal(fs.existsSync(path.join(v.projectDir, 'bowerloom.json')), false); assert.equal(fs.existsSync(path.join(away, 'bowerloom.json')), false);
});

test('H1. a refusal after a write says what was written and that a rerun finishes it', async t => {
  const w = await fourItems(t); await projectItem(w, 'prompt', 'notes');
  const p = await plan(w, { prompts: ['brief', 'notes'] });
  await assert.rejects(apply(w, p, { hooks: { afterItem: (kind, id) => { if (id === 'brief') fs.appendFileSync(bl(w, 'prompts/notes.md'), 'changed\n'); } } }), e => e.code === 'STALE_APPROVAL' && !/Nothing was applied/.test(e.message) && /prompt brief/.test(e.message) && /store migrate/.test(e.message));
  assert.deepEqual((await plan(w, { prompts: ['brief', 'notes'] })).items.map(i => `${i.id} ${i.state}`), ['brief register', 'notes copy']);
});

test('L2. a pushed copy with a file Bowerloom cannot check is copy-only with its own sentence', async t => {
  const w = await fourItems(t); originProject(w);
  await apply(w, await plan(w, { prompts: ['brief'] }));
  const repo = push(w);
  const p = await plan(w, { prompts: ['brief'], transport: storeTransport(repo, [], { override: url => url.includes('/git/blobs/') ? Buffer.alloc(300000, 97) : undefined }) });
  assert.deepEqual(p.items[0].notSwitched, { code: 'SKILLS_ADD_UNSAFE_CONTENT', sentence: 'The pushed copy holds a file that Bowerloom cannot check' });
});

test('L1. a team past the entry limit of a store item is larger than a store item can be', async t => {
  const w = await fourItems(t);
  for (let i = 0; i < 90; i++) { const dir = bl(w, `teams/research/extra/f${i}/g`); fs.mkdirSync(dir, { recursive: true, mode: 0o755 }); fs.writeFileSync(path.join(dir, 'n.md'), `${i}\n`); }
  await assert.rejects(plan(w, { teams: ['research'] }), e => e.code === 'MIGRATE_ITEM_UNSUPPORTED' && e.message.endsWith('It is larger than a store item can be.'));
});

test('round 3 L1 and L2. a stop between the link and the unlink of a prompt: the next migrate finishes it', async t => {
  const w = await fourItems(t), p = await plan(w, { prompts: ['brief'] });
  const original = fs.unlinkSync;
  fs.unlinkSync = target => { if (String(target).includes('/.stage-') && String(target).endsWith('/prompts/brief.md')) throw Object.assign(new Error('i/o'), { code: 'EIO' }); return original(target); };
  try { await assert.rejects(apply(w, p), e => e.code === 'IO_ERROR' && e.cause === 'EIO' && e.hint === 'partial' && e.next === 'bowerloom store migrate --prompt brief'); }
  finally { fs.unlinkSync = original; }
  assert.equal(fs.statSync(path.join(w.store, 'prompts/brief.md')).nlink, 2, 'the store prompt has its stage link');
  const again = await plan(w, { prompts: ['brief'] });
  assert.deepEqual(again.items.map(i => `${i.id} ${i.state}`), ['brief register']);
  await apply(w, again);
  assert.equal(fs.statSync(path.join(w.store, 'prompts/brief.md')).nlink, 1);
  assert.deepEqual(fs.readdirSync(path.join(w.store, 'authoring')), ['receipt.json']);
  assert.deepEqual(storeReceipt(w).map(i => i.id), ['brief']);
  // An unsafe file in the store is named, and the next step looks at the store.
  const u = await fourItems(t); await storeItem(u, 'prompt', 'brief');
  fs.linkSync(path.join(u.store, 'prompts/brief.md'), path.join(u.base, 'second-link.md'));
  await assert.rejects(plan(u, { prompts: ['brief'] }), e => e.code === 'AUTHORING_UNSAFE_PATH' && e.message.includes('~/.bowerloom/prompts/brief.md') && e.next === 'ls -la ~/.bowerloom');
});

test('round 3 L3. an item folder that is a link refuses at plan time; an area swapped to a link during apply refuses before its reads', async t => {
  const w = await fourItems(t), outside = path.join(w.base, 'outside-house-style');
  fs.renameSync(bl(w, 'skills/house-style'), outside); fs.symlinkSync(outside, bl(w, 'skills/house-style'));
  for (const o of [{ skills: ['house-style'] }, { all: true }]) await assert.rejects(plan(w, o), e => e.code === 'AUTHORING_UNSAFE_PATH' && e.message.includes('.bowerloom/skills'), JSON.stringify(o));
  const v = await fourItems(t), p = await plan(v, { prompts: ['brief'], teams: ['research'] });
  const swap = () => { const copy = path.join(v.base, 'teams-copy'); fs.cpSync(bl(v, 'teams'), copy, { recursive: true }); fs.rmSync(bl(v, 'teams'), { recursive: true }); fs.symlinkSync(copy, bl(v, 'teams')); };
  await assert.rejects(apply(v, p, { hooks: { afterItem: kind => { if (kind === 'prompt') swap(); } } }), e => e.code === 'AUTHORING_UNSAFE_PATH' && e.message.includes('.bowerloom/teams') && e.hint === 'partial');
  assert.equal(fs.existsSync(path.join(v.store, 'teams/research')), false, 'nothing was read through the link');
});

// Round 4 of the reviews of PR 101 (decided): at apply, a store fault surfaces with its code and next step, as in
// change.ts, and never as STALE_APPROVAL. A real change of the bytes stays STALE_APPROVAL.
test('round 4. apply keeps a store fault with its next step; a content change is STALE_APPROVAL', async t => {
  const w = await fourItems(t); originProject(w);
  await apply(w, await plan(w, { all: true }));
  const repo = push(w);
  const proved = await plan(w, { all: true, transport: storeTransport(repo) });
  assert.ok(proved.items.every(i => i.switch));
  const file = path.join(w.store, 'prompts', 'brief.md');
  fs.chmodSync(file, 0o755);
  await assert.rejects(apply(w, proved), e => e.code === 'STORE_ITEM_NOT_SHAREABLE' && e.next === 'Run chmod a-x ~/.bowerloom/prompts/brief.md. A lock records no file with an execute bit. Then run the command again. If you also changed the item, run the command again without --approve.');
  fs.chmodSync(file, 0o644);
  fs.appendFileSync(file, 'edited\n');
  await assert.rejects(apply(w, proved), code('STALE_APPROVAL'));
});
