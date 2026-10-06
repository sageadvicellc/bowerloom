import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import https from 'node:https';
import { planManagedSkill } from '../../../dist/packages/managed-skills/src/plan.js';
import { revisionOf } from '../../../dist/packages/skill-sources/src/validation.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const file = (path, text, sourcePath = `skills/example/${path}`) => ({ path, sourcePath, text, sha256: hash(text), mode: 0o644 });
function source(kind = 'npm', version = '1.0.0') {
  return { format: 'bowerloom/synthetic-skill-source/v1beta1', synthetic: true,
    source: kind === 'npm' ? { kind, registry: 'https://registry.npmjs.org', package: '@synthetic/example', version, integrity: 'sha512-' + Buffer.alloc(64, 1).toString('base64'), archiveSha256: 'a'.repeat(64), metadataSha256: 'b'.repeat(64), publisher: 'fixture', declaredLicense: 'MIT' } : { kind, host: 'github.com', repository: 'synthetic/example', commit: (version === '1.0.0' ? 'a' : 'd').repeat(40), tree: 'b'.repeat(40), metadataSha256: 'c'.repeat(64), declaredLicense: 'MIT' },
    skill: { id: 'synthetic-example', name: 'example', sourceRoot: 'skills/example' }, files: [file('SKILL.md', '---\nname: example\ndescription: Fixture only.\n---\nRead [guide](references/guide.md).\n'), file('references/guide.md', `# Guide ${version}\n`), file('LICENSE.txt', 'MIT License\nSynthetic fixture, no legal clearance claim.\n', 'LICENSE')], references: [{ from: 'SKILL.md', to: 'references/guide.md' }], license: { spdx: 'MIT', origin: 'included', files: ['LICENSE.txt'] } };
}
const identity = inode => ({ device: '1', inode: String(inode), birthtimeNs: '1791315600123456789', uid: 501, mode: 0o700 });
const inventoryFile = (path, text) => ({ path, kind: 'file', sha256: hash(text), bytes: Buffer.byteLength(text), mode: 0o644 });
const directory = path => ({ path, kind: 'directory', sha256: null, bytes: 0, mode: 0o700 });
function request(harness = 'codex', kind = 'npm') {
  return { format: 'bowerloom/synthetic-managed-skill-request/v1beta1', synthetic: true, operation: 'install', source: source(kind), target: { project: { path: '/synthetic/project', identity: identity(1) }, state: { path: '/synthetic/private-state', identity: identity(2) }, projectParentIdentity: identity(3), stateParentIdentity: identity(3), harness }, prior: null, currentInventory: [inventoryFile('README.md', 'unrelated'), directory('.bowerloom'), inventoryFile('.bowerloom/receipt.json', 'unchanged governance')] };
}
function update(harness = 'codex', kind = 'npm') { const input = request(harness, kind), installed = planManagedSkill(input); return { ...input, operation: 'update', source: source(kind, '1.1.0'), prior: clone(installed.proposedState), currentInventory: clone(installed.afterInventory) }; }
function refused(value, code) { assert.throws(() => planManagedSkill(value), e => e.message === e.code && (code ? e.code === code : /^SKILL_[A-Z_]+$/.test(e.code))); }

test('both fixed harness roots preserve text, governance, and three explicit write surfaces', () => {
  for (const harness of ['codex', 'claude']) {
    const input = request(harness), result = planManagedSkill(input), root = harness === 'codex' ? '.agents/skills/example' : '.claude/skills/example';
    assert.equal(result.policyVersion, 'bowerloom/managed-skill-projection/v1beta1');
    for (const key of ['acquisitionVerified', 'filesystemObserved', 'installationVerified', 'executionAuthorized', 'writesAuthorized', 'grantsAuthority']) assert.equal(result[key], false);
    assert.ok(result.writes.some(w => w.path === '.bowerloom-skills/catalog.json'));
    for (const f of input.source.files) for (const base of ['.bowerloom-skills/skills/synthetic-example', root]) assert.equal(result.writes.find(w => w.path === `${base}/${f.path}`).text, f.text);
    for (const f of input.currentInventory) assert.deepEqual(result.afterInventory.find(a => a.path === f.path), f);
    assert.equal(result.changes.some(c => c.path === '.bowerloom' || c.path.startsWith('.bowerloom/')), false);
    assert.equal(result.writes.find(w => w.path.endsWith('catalog.json')).text.includes('/synthetic/'), false);
    assert.ok(Object.isFrozen(result.proposedState.target.project.identity));
    input.target.project.path = '/changed'; assert.equal(result.target.project.path, '/synthetic/project');
  }
});
test('source and current inventory permutations yield identical deterministic plans', () => {
  const a = request(), b = clone(a); b.source.files.reverse(); b.currentInventory.reverse();
  assert.deepEqual(planManagedSkill(a), planManagedSkill(b));
});
test('all target identity fields, paths, harness and current inventory bind revision', () => {
  const baseline = planManagedSkill(request()).revision;
  for (const field of ['device', 'inode', 'birthtimeNs', 'mode']) { const x = request(); x.target.project.identity[field] = field === 'mode' ? 0o755 : field === 'birthtimeNs' ? '1791315600123456790' : '9'; assert.notEqual(planManagedSkill(x).revision, baseline); }
  for (const field of ['projectParentIdentity', 'stateParentIdentity']) { const x = request(); x.target[field].inode = '7'; assert.notEqual(planManagedSkill(x).revision, baseline); }
  const state = request(); state.target.state.identity.inode = '8'; assert.notEqual(planManagedSkill(state).revision, baseline);
  const moved = request(); moved.target.project.path += '-other'; assert.notEqual(planManagedSkill(moved).revision, baseline);
  const statePath = request(); statePath.target.state.path += '-other'; assert.notEqual(planManagedSkill(statePath).revision, baseline);
  const uid = request(); for (const selected of [uid.target.project.identity, uid.target.state.identity, uid.target.projectParentIdentity, uid.target.stateParentIdentity]) selected.uid = 502; assert.notEqual(planManagedSkill(uid).revision, baseline);
  assert.notEqual(planManagedSkill(request('claude')).revision, baseline);
  const extra = request(); extra.currentInventory.push(inventoryFile('other.md', 'data')); assert.notEqual(planManagedSkill(extra).revision, baseline);
});
test('npm and Git updates show additions, modifications and removals without touching siblings', () => {
  for (const kind of ['npm', 'git']) {
    const x = update('codex', kind);
    x.currentInventory.push(directory('.agents/skills/unrelated'), inventoryFile('.agents/skills/unrelated/SKILL.md', 'preserve me'));
    x.source.files = x.source.files.filter(f => f.path !== 'references/guide.md');
    x.source.files[0] = file('SKILL.md', '---\nname: example\ndescription: Fixture only.\n---\n[New](references/new.md)\n');
    x.source.files.push(file('references/new.md', 'New reference')); x.source.references = [{ from: 'SKILL.md', to: 'references/new.md' }];
    const plan = planManagedSkill(x);
    for (const action of ['add', 'change', 'remove']) assert.ok(plan.changes.some(c => c.action === action));
    assert.ok(plan.changes.some(c => c.path === '.bowerloom-skills/skills/synthetic-example/references/guide.md' && c.action === 'remove'));
    assert.ok(plan.changes.some(c => c.path === '.agents/skills/example/references/guide.md' && c.action === 'remove'));
    assert.equal(plan.changes.some(c => c.path.includes('/unrelated')), false);
    assert.equal(plan.proposedState.previousRevision, x.prior.revision);
  }
});
test('managed edits, missing files, extra files and modes all refuse updates', () => {
  for (const mutate of [x => x.currentInventory.find(e => e.path.endsWith('example/SKILL.md')).sha256 = 'f'.repeat(64), x => x.currentInventory = x.currentInventory.filter(e => e.path !== '.bowerloom-skills/catalog.json'), x => x.currentInventory.push(inventoryFile('.agents/skills/example/local-note.md', 'do not delete')), x => x.currentInventory.find(e => e.path.endsWith('example/SKILL.md')).mode = 0o600, x => x.currentInventory.find(e => e.path.endsWith('example/SKILL.md')).bytes++]) { const x = update(); mutate(x); refused(x, 'SKILL_LOCAL_DRIFT'); }
});
test('collisions refuse even with equal bytes, case aliases, empty directories or blocked ancestors', () => {
  for (const additions of [[directory('.bowerloom-skills')], [directory('.BOWERLOOM-SKILLS')], [directory('.agents'), directory('.agents/skills'), directory('.agents/skills/example')], [inventoryFile('.agents', 'not a directory')], [directory('.AGENTS')]]) { const x = request(); x.currentInventory.push(...additions); refused(x); }
});
test('old formats, changed prior inventory, forged revisions and stale bindings refuse', () => {
  for (const mutate of [x => x.prior.format = 'bowerloom/installation-receipt/v1alpha1', x => x.prior.policyVersion = 'codex/local-skills/v1alpha1', x => x.prior.revision = '0'.repeat(64), x => x.prior.managedInventory.pop(), x => x.target.project.identity.inode = '99', x => x.target.harness = 'claude', x => x.source.skill.id = 'another-id', x => x.source.source.package = '@another/source']) { const x = update(); mutate(x); refused(x); }
  const inconsistent = update(); inconsistent.prior.managedInventory[0].mode = 0o755; const { revision: _r, ...body } = inconsistent.prior; inconsistent.prior.revision = revisionOf(body); refused(inconsistent, 'SKILL_PRIOR_INVENTORY');
});
test('same immutable version or commit cannot represent a different update', () => {
  for (const kind of ['npm', 'git']) { const x = update('codex', kind); x.source.source = clone(x.prior.source.source); refused(x, 'SKILL_IMMUTABLE_SOURCE'); }
});
test('synthetic inputs cannot request execution or substitute protected/private target paths', () => {
  for (const mutate of [x => x.synthetic = false, x => x.execute = true, x => x.target.project.path = '/usr/share/project', x => x.target.state.path = '/synthetic/project/private', x => x.target.project.path = '/synthetic/project/../other', x => x.target.state.identity.mode = 0o755, x => x.target.state.identity.uid = 502, x => x.target.harness = 'unknown']) { const x = request(); mutate(x); refused(x); }
});
test('hostile nested Proxy/accessor never runs and errors carry no supplied text', () => {
  let calls = 0; const x = request(); x.target = new Proxy({}, { get() { calls++; throw Error('PRIVATE'); }, ownKeys() { calls++; throw Error('PRIVATE'); } }); refused(x, 'SKILL_OBJECT');
  const getter = update(); Object.defineProperty(getter.prior, 'revision', { enumerable: true, get() { calls++; throw Error('PRIVATE'); } }); refused(getter, 'SKILL_ACCESSOR'); assert.equal(calls, 0);
});
test('planning reaches no filesystem, network, or process boundary', t => {
  const deny = () => { throw Error('SIDE_EFFECT_REACHED'); };
  for (const [owner, name] of [[fs, 'readFileSync'], [fs, 'writeFileSync'], [fs, 'openSync'], [https, 'request'], [https, 'get'], [childProcess, 'spawn'], [childProcess, 'execSync']]) t.mock.method(owner, name, deny);
  assert.equal(planManagedSkill(request()).writesAuthorized, false);
  assert.equal(planManagedSkill(update()).executionAuthorized, false);
});

test('pinned upstream layout can differ from skill name; projection and prior inventory cannot', () => {
  const input = request(); input.source.skill.name = 'tanstack-db-collections'; input.source.skill.sourceRoot = 'skills/tanstack-db/collections';
  for (const f of input.source.files) {
    if (f.path === 'SKILL.md') { f.text = f.text.replace('name: example', 'name: tanstack-db-collections'); f.sha256 = hash(f.text); }
    if (f.path !== 'LICENSE.txt') f.sourcePath = `${input.source.skill.sourceRoot}/${f.path}`;
  }
  const result = planManagedSkill(input);
  assert.ok(result.writes.some(w => w.path === '.agents/skills/tanstack-db-collections/SKILL.md'));
  assert.equal(result.writes.some(w => w.path === '.agents/skills/collections/SKILL.md'), false);
  const wrongSource = clone(input); wrongSource.source.files.find(f => f.path === 'SKILL.md').sourcePath = 'skills/other/SKILL.md'; refused(wrongSource, 'SKILL_SOURCE_PATH');
  const next = { ...clone(input), operation: 'update', prior: clone(result.proposedState), currentInventory: clone(result.afterInventory) }; next.source.source.version = '1.1.0';
  for (const f of next.prior.managedInventory) f.path = f.path.replace('.agents/skills/tanstack-db-collections', '.agents/skills/collections');
  const { revision: _revision, ...body } = next.prior; next.prior.revision = revisionOf(body); refused(next, 'SKILL_PRIOR_INVENTORY');
});
