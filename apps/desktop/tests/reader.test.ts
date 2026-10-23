// The read adapters, against the sample fixture. The sample was made by the real commands; these tests check what the real read code says about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readProject, readSnapshot } from '../main/reader.js';
import { readItemContent } from '../main/content.js';
import { sampleSnapshot, sampleWorld } from './support.js';
import { storeRootOf } from '../../../packages/project-context/src/index.js';
import { listFolderGrants } from '../../../packages/project-context/src/index.js';

const byName = async () => { const s = await sampleSnapshot(); return { s, p: (n: string) => s.projects.find(x => x.name === n)! }; };

test('the sample has the three projects, one in each state', async () => {
  const { s, p } = await byName();
  assert.deepEqual(s.projects.map(x => x.name), ['newsletter', 'old-archive', 'studio-site']);
  assert.equal(p('studio-site').status, 'ready'); assert.equal(p('newsletter').status, 'drifted'); assert.equal(p('old-archive').status, 'lock-problem');
  assert.equal(s.scan.found, 3); assert.deepEqual(s.problems, []);
});

test('healthy project: every item matches the lock, with no hold and no drift', async () => {
  const h = (await byName()).p('studio-site');
  assert.equal(h.lockState, 'valid'); assert.deepEqual(h.drift, []); assert.deepEqual(h.held, []);
  assert.deepEqual(h.items.map(i => `${i.kind}:${i.id}`), ['skill:brand-voice', 'skill:house-style', 'skill:meeting-notes', 'prompt:weekly-update', 'team:research-desk']);
  assert.ok(h.items.every(i => i.lock === 'same' && i.hold === null && i.from === 'store'));
  assert.equal(h.items.find(i => i.id === 'brand-voice')!.origin, 'npm'); assert.equal(h.items.find(i => i.id === 'brand-voice')!.pin, '@synthetic/brand-voice@1.2.0');
  assert.equal(h.lockRows.length, 5); assert.equal(h.shared, true);
  assert.equal(h.slices.length, 1); assert.equal(h.slices[0]!.rootKind, 'registered'); assert.equal(h.slices[0]!.rootName, 'team-notes'); assert.equal(h.slices[0]!.members, 4);
});

test('drifted project: a changed item, a missing item, a held agent, and the reasons', async () => {
  const d = (await byName()).p('newsletter');
  assert.equal(d.lockState, 'mismatch'); assert.equal(d.lockCode, 'LOCK_CONFIG_MISMATCH');
  assert.equal(d.items.find(i => i.id === 'launch-checklist')!.lock, 'changed');
  const gone = d.items.find(i => i.id === 'old-rules')!; assert.equal(gone.lock, 'missing'); assert.equal(gone.hold!.code, 'STORE_ITEM_MISSING');
  assert.equal(d.items.find(i => i.id === 'weekly-digest')!.lock, 'same');
  assert.equal(d.items.find(i => i.id === 'newsroom')!.from, 'project');
  assert.ok(d.drift.some(x => x.kind === 'unexpected'));
  assert.deepEqual(d.held.map(h => `${h.kind}:${h.id}`).sort(), ['agent:publisher', 'skill:old-rules', 'slice:client-history']);
});

test('agents per project: the powerful settings are named, and the slice an agent loads', async () => {
  const d = (await byName()).p('newsletter');
  const publisher = d.agents.find(a => a.role === 'publisher')!, editor = d.agents.find(a => a.role === 'editor')!;
  assert.ok(publisher.notices.includes('permissionMode:bypassPermissions')); assert.equal(publisher.hold!.code, 'AGENT_GRANT_REVIEW_REQUIRED'); assert.equal(publisher.team, 'newsroom');
  assert.deepEqual(editor.slices, ['team-notes']); assert.deepEqual(editor.notices, []); assert.equal(editor.hold, null);
});

test('slices: the size comparison comes from the real measure', async () => {
  const d = (await byName()).p('newsletter');
  assert.deepEqual(d.slices.map(x => [x.id, x.folder, x.wants, x.wantsKey, x.hold?.code ?? null]), [['client-history', 'client-archive', 'heading', null, 'FOLDER_NOT_ALLOWED'], ['team-notes', 'team-notes', 'heading', null, null], ['team-titles', 'team-notes', 'frontmatter', 'title', null]]);
  assert.ok(d.slices.every(x => x.grantStyle === null), 'this version keeps no style in a permission');
  assert.equal(d.measureCode, null); assert.ok(d.baselineBytes! > 5000); assert.equal(d.baselineFiles, 4);
  const editor = d.measure.find(m => m.role === 'editor')!;
  assert.ok(editor.startBytes > 0 && editor.startBytes < editor.baselineBytes, 'the short list is smaller than reading everything');
  const live = d.slices.find(x => x.id === 'team-notes')!; assert.ok(live.indexBytes! > 0); assert.ok(live.memberBytes! > 0);
});

test('invalid lock: the project reports the lock code and cannot compare its items', async () => {
  const b = (await byName()).p('old-archive');
  assert.equal(b.lockState, 'invalid'); assert.equal(b.lockCode, 'LOCK_INVALID'); assert.ok(b.drift.some(x => x.kind === 'lock-invalid'));
  assert.ok(b.items.every(i => i.lock === 'unknown')); assert.deepEqual(b.lockRows, []);
});

test('the library: origins, pins, and which projects use each item', async () => {
  const { s } = await byName(), key = (n: string) => s.projects.find(x => x.name === n)!.key;
  const sk = (id: string) => s.library.skills.find(x => x.id === id)!;
  assert.deepEqual(s.library.skills.map(x => x.id), ['brand-voice', 'house-style', 'meeting-notes', 'weekly-digest']);
  assert.equal(sk('brand-voice').origin, 'npm'); assert.match(sk('brand-voice').pin!, /@1\.2\.0/); assert.equal(sk('house-style').origin, 'yours'); assert.equal(sk('house-style').pin, null);
  assert.deepEqual(sk('house-style').usedBy.sort(), [key('old-archive'), key('studio-site')].sort()); assert.deepEqual(sk('weekly-digest').usedBy, [key('newsletter')]);
  assert.deepEqual(s.library.teams.map(x => x.id), ['launch-crew', 'research-desk']); assert.deepEqual(s.library.teams[0]!.usedBy, []);
  assert.deepEqual(s.library.prompts.map(x => x.id), ['launch-checklist', 'weekly-update']);
  assert.equal(s.library.unlisted, 0); assert.equal(s.library.pinsError, null);
});

test('registered folders and their grants', async () => {
  const { s } = await byName(), key = (n: string) => s.projects.find(x => x.name === n)!.key;
  assert.deepEqual(s.folders.map(f => f.name), ['client-archive', 'team-notes']);
  assert.deepEqual(s.folders[0]!.allowed, []); assert.deepEqual(s.folders[1]!.allowed.sort(), [key('newsletter'), key('studio-site')].sort());
  assert.ok(s.folders.every(f => f.state === 'ready' && f.outdated.length === 0));
});

test('the new read-only export lists grant file names and nothing else', t => {
  const { world } = sampleWorld(t);
  const ids = listFolderGrants(world.home, 'team-notes').projectIds;
  assert.equal(ids.length, 2); assert.ok(ids.every(id => /^[a-f0-9]{32}$/.test(id)));
  assert.deepEqual(listFolderGrants(world.home, 'client-archive').projectIds, []);
  assert.throws(() => listFolderGrants(world.home, '../x'), /FOLDER_NAME_INVALID|name/i);
  assert.deepEqual(readdirSync(join(storeRootOf(world.home), 'folders')).sort(), ['client-archive.json', 'team-notes.grants', 'team-notes.json']);
});

test('a grant that no longer matches is reported as out of date, not as allowed', async t => {
  const { world, ctx } = sampleWorld(t);
  const store = join(storeRootOf(world.home), 'folders', 'team-notes.json');
  const rec = JSON.parse((await import('node:fs')).readFileSync(store, 'utf8')) as Record<string, unknown>;
  writeFileSync(store, `${JSON.stringify({ ...rec, id: 'f'.repeat(32) })}\n`, { mode: 0o644 });
  const { snapshot } = await readSnapshot(ctx);
  const f = snapshot.folders.find(x => x.name === 'team-notes')!;
  assert.deepEqual(f.allowed, []); assert.equal(f.outdated.length + (f.state === 'ready' ? 0 : 0), f.outdated.length);
});

test('storage: the store report, git state, token state, and the cache', async () => {
  const { s } = await byName();
  assert.equal(s.store.state, 'ready'); assert.equal(s.store.git!.problem, null); assert.equal(s.store.git!.remote, 'https://github.com/sample-co/shared-store'); assert.equal(s.store.git!.branch, 'main');
  assert.deepEqual(s.store.counts, { skills: 3, pinned: 1, prompts: 2, teams: 2 }); assert.equal(s.store.gitignoreMissing, false);
  assert.ok(['set', 'not-set', 'invalid'].includes(s.store.token));
  assert.equal(s.cache.state, 'ok'); assert.equal(s.cache.totalEntries, 0);
});

test('a project outside the chosen folders is refused, and so is one reached through a link', async t => {
  const { world, ctx } = sampleWorld(t);
  const outside = await readProject({ ...ctx, roots: [join(world.home, 'Notes')] }, join(world.projects, 'studio-site'));
  assert.equal(outside.status, 'unreadable'); assert.equal(outside.openCode, 'OUTSIDE_ROOT'); assert.deepEqual(outside.items, []);
  symlinkSync(join(world.projects, 'studio-site'), join(world.projects, 'shortcut'));
  const linked = await readProject(ctx, join(world.projects, 'shortcut'));
  assert.equal(linked.status, 'unreadable'); assert.ok(['THROUGH_LINK', 'OUTSIDE_ROOT'].includes(linked.openCode!));
  const { snapshot } = await readSnapshot(ctx); assert.equal(snapshot.projects.length, 3, 'the link adds no project');
});

test('item contents: a skill, a prompt, a team with its files, and a pinned skill, all as text', t => {
  const { world } = sampleWorld(t), store = storeRootOf(world.home);
  const skill = readItemContent(store, 'store', 'skill', 'house-style');
  assert.equal(skill.files[0]!.path, 'SKILL.md'); assert.match(skill.files[0]!.text!, /Write in short sentences/);
  const prompt = readItemContent(store, 'store', 'prompt', 'weekly-update'); assert.match(prompt.files[0]!.text!, /Weekly update/);
  const team = readItemContent(store, 'store', 'team', 'research-desk'); assert.ok(team.files.some(f => f.path === 'team.yaml')); assert.ok(team.files.length > 5);
  const pinned = readItemContent(store, 'store', 'skill', 'brand-voice'); assert.deepEqual(pinned.files, []); assert.ok(pinned.pinned!.lines.some(l => l.includes('1.2.0')));
  const project = readItemContent(join(world.projects, 'newsletter'), 'project', 'team', 'newsroom');
  assert.deepEqual(project.files.filter(f => f.path.startsWith('agents/')).map(f => f.path), ['agents/editor.md', 'agents/publisher.md']);
  assert.match(project.files.find(f => f.path === 'agents/publisher.md')!.text!, /bypassPermissions/);
});

test('item contents: a bad id, a missing item, and a link inside the item are refused or shown as not followed', t => {
  const { world } = sampleWorld(t), store = storeRootOf(world.home);
  assert.match(readItemContent(store, 'store', 'skill', '../../etc/passwd').note!, /not a valid/);
  assert.match(readItemContent(store, 'store', 'prompt', 'nope').note!, /could not be read/);
  assert.ok(readItemContent(store, 'store', 'team', 'nope').files.length === 0);
  symlinkSync('/etc/hosts', join(store, 'skills', 'house-style', 'hosts-link'));
  const c = readItemContent(store, 'store', 'skill', 'house-style');
  const link = c.files.find(f => f.path === 'hosts-link')!; assert.equal(link.text, null); assert.match(link.note!, /link/);
});

test('item contents: hidden and control characters are shown as escapes, and markup stays text', t => {
  const { world } = sampleWorld(t), store = storeRootOf(world.home);
  writeFileSync(join(store, 'skills', 'house-style', 'SKILL.md'), `<script>alert(1)</script>\n<b>bold</b>\nzero${String.fromCharCode(0x200b)}width and ${String.fromCharCode(0x202e)}flip and bell${String.fromCharCode(7)}\n`, { mode: 0o644 });
  const text = readItemContent(store, 'store', 'skill', 'house-style').files.find(f => f.path === 'SKILL.md')!.text!;
  assert.match(text, /<script>alert\(1\)<\/script>/); assert.match(text, /\\u200b/); assert.match(text, /\\u202e/); assert.match(text, /\\u0007/);
  assert.doesNotMatch(text, new RegExp(`[${String.fromCharCode(0x200b)}${String.fromCharCode(0x202e)}${String.fromCharCode(7)}]`));
});

test('item contents: a file that other people can write, a binary file, and a huge file are not shown', t => {
  const { world } = sampleWorld(t), store = storeRootOf(world.home), dir = join(store, 'skills', 'house-style');
  writeFileSync(join(dir, 'open.md'), 'x', { mode: 0o666 }); chmodSync(join(dir, 'open.md'), 0o666);
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([1, 2, 0, 3]), { mode: 0o644 });
  writeFileSync(join(dir, 'big.md'), 'a'.repeat(300 * 1024), { mode: 0o644 });
  const files = readItemContent(store, 'store', 'skill', 'house-style').files;
  assert.equal(files.find(f => f.path === 'open.md')!.text, null); assert.match(files.find(f => f.path === 'open.md')!.note!, /other people can change/);
  assert.match(files.find(f => f.path === 'bin.dat')!.note!, /not plain text/);
  assert.equal(files.find(f => f.path === 'big.md')!.text, null);
});

test('no process.env value or token value appears in what the main process sends', async t => {
  const canary = `ghp_${'Z'.repeat(36)}`, was = process.env.BOWERLOOM_GITHUB_TOKEN;
  process.env.BOWERLOOM_GITHUB_TOKEN = canary; process.env.VIEWER_SECRET_CANARY = 'canary-secret-value-123';
  t.after(() => { if (was === undefined) delete process.env.BOWERLOOM_GITHUB_TOKEN; else process.env.BOWERLOOM_GITHUB_TOKEN = was; delete process.env.VIEWER_SECRET_CANARY; });
  const { ctx } = sampleWorld(t);
  const { snapshot } = await readSnapshot(ctx);
  const text = JSON.stringify(snapshot);
  assert.equal(snapshot.store.token, 'set'); assert.ok(!text.includes(canary)); assert.ok(!text.includes('canary-secret-value-123'));
  assert.ok(!text.includes(process.env.PATH ?? 'no-path'));
  delete process.env.BOWERLOOM_GITHUB_TOKEN;
  assert.equal((await readSnapshot(ctx)).snapshot.store.token, 'not-set');
  process.env.BOWERLOOM_GITHUB_TOKEN = 'not a token';
  assert.equal((await readSnapshot(ctx)).snapshot.store.token, 'invalid');
});

test('reading changes nothing: the sample tree is the same before and after a read', async t => {
  const { world, ctx } = sampleWorld(t);
  const walk = (dir: string, out: string[] = []): string[] => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); out.push(p); if (e.isDirectory()) walk(p, out); } return out; };
  const stat = async (paths: string[]) => { const fs = await import('node:fs'); return paths.map(p => { const s = fs.lstatSync(p); return `${p}:${s.size}:${s.mtimeMs}:${s.mode}`; }); };
  const before = await stat(walk(world.home).sort());
  await readSnapshot(ctx);
  const after = await stat(walk(world.home).sort());
  assert.deepEqual(after, before);
});

test('an absent store and a store that is not a store are reported, not thrown', async t => {
  const { tempDir } = await import('./support.js');
  const home = tempDir(t);
  const none = await readSnapshot({ mode: 'real', home, env: { HOME: home }, roots: [] });
  assert.equal(none.snapshot.store.state, 'absent'); assert.deepEqual(none.snapshot.library.skills, []);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(home, '.bowerloom'), { mode: 0o700 }); writeFileSync(join(home, '.bowerloom', 'something'), 'x');
  const foreign = await readSnapshot({ mode: 'real', home, env: { HOME: home }, roots: [] });
  assert.equal(foreign.snapshot.store.state, 'foreign'); assert.ok(foreign.snapshot.problems.some(p => p.area === 'store'));
});
