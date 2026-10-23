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
  assert.deepEqual(h.items.map(i => `${i.kind}:${i.id}`), ['skill:house-style', 'skill:meeting-notes', 'prompt:weekly-update', 'team:research-desk']);
  assert.ok(h.items.every(i => i.lock === 'same' && i.hold === null && i.from === 'store'));
  assert.equal(h.lockRows.length, 4); assert.equal(h.shared, true);
  assert.deepEqual(h.slices.map(x => x.id), ['brief-titles', 'team-notes']); const tn = h.slices.find(x => x.id === 'team-notes')!; assert.equal(tn.rootKind, 'registered'); assert.equal(tn.rootName, 'team-notes'); assert.equal(tn.members, 4); assert.ok(h.slices.every(x => x.hold === null), 'both are live');
});

test('drifted project: a changed item, a missing item, a held agent, and the reasons', async () => {
  const d = (await byName()).p('newsletter');
  assert.equal(d.lockState, 'mismatch'); assert.equal(d.lockCode, 'LOCK_CONFIG_MISMATCH');
  assert.equal(d.items.find(i => i.id === 'launch-checklist')!.lock, 'changed');
  const gone = d.items.find(i => i.id === 'old-rules')!; assert.equal(gone.lock, 'missing'); assert.equal(gone.hold!.code, 'STORE_ITEM_MISSING');
  assert.equal(d.items.find(i => i.id === 'weekly-digest')!.lock, 'same');
  assert.equal(d.items.find(i => i.id === 'newsroom')!.from, 'project');
  assert.ok(d.drift.some(x => x.kind === 'unexpected'));
  assert.deepEqual(d.held.map(h => `${h.kind}:${h.id}`).sort(), ['agent:publisher', 'slice:client-history', 'slice:meeting-archive-all', 'slice:old-reports-list', 'slice:team-titles']);
});

test('agents per project: the powerful settings are named, and the slice an agent loads', async () => {
  const d = (await byName()).p('newsletter');
  const publisher = d.agents.find(a => a.role === 'publisher')!, editor = d.agents.find(a => a.role === 'editor')!;
  assert.ok(publisher.notices.includes('permissionMode:bypassPermissions')); assert.equal(publisher.hold!.code, 'AGENT_GRANT_REVIEW_REQUIRED'); assert.equal(publisher.team, 'newsroom');
  assert.deepEqual(editor.slices, ['team-notes']); assert.deepEqual(editor.notices, []); assert.equal(editor.hold, null);
});

test('slices: the size comparison comes from the real measure', async () => {
  const d = (await byName()).p('newsletter');
  assert.deepEqual(d.slices.map(x => [x.id, x.folder, x.wants, x.wantsKey, x.grantStyle, x.grantKey]), [
    ['client-history', 'client-archive', 'heading', null, 'absent', null], ['meeting-archive-all', 'meeting-archive', 'heading', null, 'heading', null], ['old-reports-list', 'old-reports', 'heading', null, 'unset', null],
    ['team-notes', 'team-notes', 'heading', null, 'heading', null], ['team-titles', 'team-notes', 'frontmatter', 'title', 'heading', null]]);
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
  assert.deepEqual(s.folders.map(f => f.name), ['client-archive', 'meeting-archive', 'old-reports', 'project-briefs', 'team-notes']);
  const f = (n: string) => s.folders.find(x => x.name === n)!;
  assert.deepEqual(f('client-archive').allowed, []); assert.deepEqual(f('team-notes').allowed.sort(), [key('newsletter'), key('studio-site')].sort());
  assert.deepEqual(f('team-notes').styles.map(x => x.style), ['heading', 'heading']); assert.deepEqual(f('project-briefs').styles, [{ key: key('studio-site'), style: 'frontmatter', styleKey: 'title' }]);
  assert.deepEqual(f('old-reports').allowed, [], 'an older grant is not a permission'); assert.deepEqual(f('old-reports').unstyled, [key('newsletter')]);
  assert.ok(s.folders.every(x => x.state === 'ready' && x.outdated.length === 0));
});

test('the new read-only export lists grant file names and nothing else', t => {
  const { world } = sampleWorld(t);
  const ids = listFolderGrants(world.home, 'team-notes').projectIds;
  assert.equal(ids.length, 2); assert.ok(ids.every(id => /^[a-f0-9]{32}$/.test(id)));
  assert.deepEqual(listFolderGrants(world.home, 'client-archive').projectIds, []);
  assert.throws(() => listFolderGrants(world.home, '../x'), /FOLDER_NAME_INVALID|name/i);
  assert.deepEqual(readdirSync(join(storeRootOf(world.home), 'folders')).sort(), ['client-archive.json', 'meeting-archive.grants', 'meeting-archive.json', 'old-reports.grants', 'old-reports.json', 'project-briefs.grants', 'project-briefs.json', 'team-notes.grants', 'team-notes.json']);
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

test('a reading list that is too large is held even though the permission matches', async () => {
  const d = (await byName()).p('newsletter'), big = d.slices.find(x => x.id === 'meeting-archive-all')!;
  assert.equal(big.hold!.code, 'SLICE_TOO_LARGE'); assert.equal(big.grantStyle, 'heading'); assert.equal(big.wants, 'heading');
});

test('status: Ready only when nothing is unavailable and the lock is used and matches; a plan that cannot run is a thing to look at', async () => {
  const { p } = await byName();
  assert.equal(p('studio-site').status, 'ready'); assert.equal(p('studio-site').unavailable, null); assert.equal(p('studio-site').lockState, 'valid');
  assert.equal(p('newsletter').unavailable, 'SKILLS_OFFLINE'); assert.equal(p('newsletter').status, 'drifted');
});

test('a project with nothing locked is "not locked", never Ready', async t => {
  const { tempDir } = await import('./support.js');
  const home = tempDir(t), dir = join(home, 'Projects', 'solo'); (await import('node:fs')).mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bowerloom.json'), `${JSON.stringify({ format: 'bowerloom/project/v1beta1', harnesses: ['claude', 'codex'], skills: [], prompts: [], teams: [] })}\n`);
  const ctx = { mode: 'real' as const, home, env: { HOME: home }, roots: [join(home, 'Projects')] };
  const solo = await readProject(ctx, dir);
  assert.equal(solo.lockState, 'not-used'); assert.equal(solo.status, 'not-locked');
});

test('a bowerloom.json that exists but cannot be read is "Cannot open", never "Not set up"', async t => {
  const { tempDir } = await import('./support.js');
  const home = tempDir(t), dir = join(home, 'Projects', 'odd'), fs = await import('node:fs'); fs.mkdirSync(dir, { recursive: true });
  writeFileSync(join(home, 'real.json'), '{}'); symlinkSync(join(home, 'real.json'), join(dir, 'bowerloom.json'));
  const ctx = { mode: 'real' as const, home, env: { HOME: home }, roots: [join(home, 'Projects')] };
  const p = await readProject(ctx, dir);
  assert.equal(p.status, 'unreadable'); assert.ok(p.openCode !== null && p.openCode !== undefined); assert.deepEqual(p.items, []);
  // A file that is there but that this user cannot open is found by the search, and is a project Bowerloom cannot open.
  const dir2 = join(home, 'Projects', 'locked'); fs.mkdirSync(dir2); writeFileSync(join(dir2, 'bowerloom.json'), '{}\n'); fs.chmodSync(join(dir2, 'bowerloom.json'), 0o000);
  try { const { snapshot } = await readSnapshot(ctx); const locked = snapshot.projects.find(x => x.name === 'locked')!; assert.equal(locked.status, 'unreadable'); assert.notEqual(locked.status as string, 'not-set-up'); }
  finally { fs.chmodSync(join(dir2, 'bowerloom.json'), 0o600); }
});

test('one project that cannot be read never fails the others', async t => {
  const { world, ctx } = sampleWorld(t);
  const fs = await import('node:fs'); fs.mkdirSync(join(world.projects, 'broken'));
  writeFileSync(join(world.projects, 'broken', 'bowerloom.json'), '{}\n'); fs.chmodSync(join(world.projects, 'broken'), 0o777);
  const { snapshot } = await readSnapshot(ctx);
  assert.equal(snapshot.projects.length, 4); assert.equal(snapshot.projects.find(x => x.name === 'studio-site')!.status, 'ready');
  assert.equal(snapshot.projects.find(x => x.name === 'broken')!.status, 'unreadable');
});

test('a permission that cannot be checked is "unknown", never "no permission" and never "headings"', async t => {
  const { grantOf } = await import('../main/reader.js'), { discoverProject } = await import('../../../packages/project-context/src/index.js');
  const { world } = sampleWorld(t), pc = discoverProject(join(world.projects, 'newsletter'), world.home);
  assert.deepEqual(grantOf(world.home, 'team-notes', pc), { state: 'kind', style: 'heading', key: null });
  assert.deepEqual(grantOf(world.home, 'client-archive', pc), { state: 'absent' });
  assert.deepEqual(grantOf(world.home, 'old-reports', pc), { state: 'legacy' });
  assert.equal(grantOf(world.home, 'no-such-folder', pc).state, 'unknown', 'a folder with no record is not "no permission"');
  assert.equal(grantOf(world.home, 'Not A Name', pc).state, 'unknown');
  // A damaged grant file is a fault to report, not "no permission".
  writeFileSync(join(storeRootOf(world.home), 'folders', 'team-notes.grants', pc.projectId), '{"damaged": true}\n', { mode: 0o644 });
  assert.equal(grantOf(world.home, 'team-notes', pc).state, 'unknown');
});

test('a folder list or grant list that cannot be read is reported, not shown as no folders or no permission', async t => {
  const { tempDir } = await import('./support.js'), fs = await import('node:fs');
  const home = tempDir(t); fs.mkdirSync(join(home, '.bowerloom'), { mode: 0o700 }); writeFileSync(join(home, '.bowerloom', 'something'), 'x');
  const { snapshot } = await readSnapshot({ mode: 'real', home, env: { HOME: home }, roots: [] });
  assert.ok(snapshot.problems.some(x => x.area === 'folders'), 'the folder list failed and says so'); assert.deepEqual(snapshot.folders, []);
  assert.notEqual(snapshot.library.failed, null, 'a library that could not be read is not a library of zero');
  // The grants folder of one registered folder is damaged: the permissions of that folder are unknown.
  const { world, ctx } = sampleWorld(t), grants = join(storeRootOf(world.home), 'folders', 'team-notes.grants');
  fs.chmodSync(grants, 0o777);
  const sample = await readSnapshot(ctx), f = sample.snapshot.folders.find(x => x.name === 'team-notes')!;
  assert.equal(f.allowed.length, 0); assert.equal(f.unknown.length, 3, 'every project is unknown, not "not allowed"');
});

test('the library read failing leaves the counts unknown', async t => {
  const { tempDir } = await import('./support.js'), fs = await import('node:fs');
  const home = tempDir(t); fs.mkdirSync(join(home, '.bowerloom'), { mode: 0o700 }); writeFileSync(join(home, '.bowerloom', 'x'), 'x');
  const { snapshot } = await readSnapshot({ mode: 'real', home, env: { HOME: home }, roots: [] });
  assert.equal(snapshot.library.failed, 'STORE_INVALID');
});
