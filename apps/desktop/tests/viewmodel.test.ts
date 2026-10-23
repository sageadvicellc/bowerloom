// What each screen says. A drifted project says why, in plain words, and no screen shows a command line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_CHIP, STATUS_SENTENCE, cacheSummary, configLines, folderRows, foldersProblem, homeModel, itemDetail, libraryRows, lockSentence, pinWords, powerfulSettings, projectDetail, projectRows, sliceGroups, sliceModels, sliceReason, slicesByProject, storeSummary } from '../shared/viewmodel.js';
import { codeWords, humanBytes, titleOf } from '../shared/words.js';
import { safeLine, safeText } from '../shared/text.js';
import type { Snapshot } from '../shared/types.js';
import { clone, sampleSnapshot } from './support.js';

const COMMAND = /\bbowerloom (ls|status|use|unuse|lock|apply|skills|skill|prompt|team|store|folder|slice|context|cache|up|help)\b|\bnpm (run|install)\b|\bgit (push|init|add|commit|remote)\b|\bcd \S|\bchmod\b|--[a-z]{3,}|terminal|command line|\$ /i;
const allWords = (s: Snapshot): string[] => {
  const out: string[] = [];
  const home = homeModel(s); out.push(home.sentence, ...home.attention.flatMap(a => [a.title, a.body, a.todo]));
  for (const k of ['skill', 'prompt', 'team'] as const) for (const r of libraryRows(s, k)) out.push(r.label, r.origin, r.version, r.used, r.problem ?? '');
  for (const r of projectRows(s)) out.push(r.name, r.chip.label, r.summary);
  for (const p of s.projects) { const d = projectDetail(p); out.push(d.sentence, ...d.reasons, d.lockSentence, ...d.config, ...d.lock, ...d.items.flatMap(i => [i.label, i.origin, i.version, i.match.text, i.hold ?? '']), ...d.agents.flatMap(a => [a.status, ...a.powers]), ...d.slices.flatMap(g => g.slices).flatMap(x => [x.where, x.state, x.hold ?? '', x.reason ?? '', x.wants ?? '', ...x.bars.map(b => b.sentence)])); }
  for (const f of folderRows(s)) out.push(f.state, f.note);
  const st = storeSummary(s.store); out.push(st.state, st.git, st.token, ...st.lines, cacheSummary(s.cache));
  return out.filter(Boolean);
};

test('a drifted project says what is different and why, in plain words', async () => {
  const s = await sampleSnapshot(), d = projectDetail(s.projects.find(p => p.name === 'newsletter')!);
  assert.equal(d.chip.label, 'Drifted'); assert.match(d.sentence, /drifted/i);
  assert.ok(d.reasons.includes('Prompt "launch-checklist" changed in your library after the lock was written.'), d.reasons.join('|'));
  assert.ok(d.reasons.some(r => /Skill "old-rules": This project asks for an item that is not in your library any more/.test(r)));
  assert.ok(d.reasons.some(r => /Agent "publisher": This helper asks for powerful permissions/.test(r)));
  assert.ok(d.reasons.includes('The lock file and the project list name different items.'));
  const changed = d.items.find(i => i.id === 'launch-checklist')!; assert.equal(changed.match.text, 'Changed since it was locked'); assert.equal(changed.match.tone, 'warn');
  assert.equal(d.items.find(i => i.id === 'old-rules')!.match.text, 'Not in the lock');
  assert.equal(d.items.find(i => i.id === 'weekly-digest')!.match.text, 'Matches the lock');
  assert.equal(d.items.find(i => i.id === 'newsroom')!.match.text, 'No lock needed'); assert.equal(d.items.find(i => i.id === 'newsroom')!.from, 'This project');
});

test('a healthy project says it is ready and lists no reasons', async () => {
  const s = await sampleSnapshot(), d = projectDetail(s.projects.find(p => p.name === 'studio-site')!);
  assert.deepEqual(d.chip, { label: 'Ready', tone: 'good' }); assert.deepEqual(d.reasons, []); assert.match(d.sentence, /in place and matches/);
  assert.match(d.lockSentence, /lock file is good/);
});

test('a project with a damaged lock says so and offers what a person would do', async () => {
  const s = await sampleSnapshot(), d = projectDetail(s.projects.find(p => p.name === 'old-archive')!);
  assert.equal(d.chip.label, 'Lock problem'); assert.match(d.lockSentence, /cannot be read/); assert.match(d.reasons[0]!, /damaged|leftover marks/);
  const a = homeModel(s).attention.find(x => x.title.includes('old-archive'))!;
  assert.equal(a.tone, 'bad'); assert.match(a.todo, /rebuild the lock file/); assert.equal(a.technical, 'LOCK_INVALID'); assert.deepEqual(a.link, { screen: 'project', key: s.projects.find(p => p.name === 'old-archive')!.key });
});

test('status chips: Ready, Drifted, Lock problem, Not set up', () => {
  assert.deepEqual(Object.values(STATUS_CHIP).map(c => c.label), ['Ready', 'Nothing locked yet', 'Drifted', 'Lock problem', 'Not set up', 'Cannot open']);
});

test('home: a sentence, four counts that link to their screens, and the list that needs attention', async () => {
  const s = await sampleSnapshot(), h = homeModel(s);
  assert.equal(h.sentence, 'You have 2 teams, 4 skills and 2 prompts in your library, used by 3 projects.');
  assert.deepEqual(h.counts.map(c => [c.label, c.value]), [['Teams', 2], ['Skills', 4], ['Prompts', 2], ['Projects', 3]]);
  assert.deepEqual(h.counts.map(c => c.link.screen), ['library', 'library', 'library', 'projects']);
  const titles = h.attention.map(a => a.title);
  assert.ok(titles.includes('The lock file of old-archive has a problem')); assert.ok(titles.includes('newsletter has drifted')); assert.ok(titles.includes('Helper "publisher" is waiting for a review'));
  assert.ok(!titles.some(t => t.includes('studio-site')));
  assert.equal(h.attention[0]!.tone, 'bad', 'the worst comes first');
});

test('home: each kind of problem gets a plain explanation and a thing to do', async () => {
  const base = await sampleSnapshot();
  const s = clone(base);
  s.folders[0]!.state = 'missing'; s.folders[1]!.state = 'refused'; s.folders[1]!.code = 'FOLDER_UNSAFE';
  s.store.git!.problem = 'unpushed'; s.store.gitignoreMissing = true; s.store.foldersTracked = true; s.store.leftovers = ['.store.json.0123456789abcdef.tmp'];
  s.scan.roots.push({ path: '/gone', ok: false, reason: 'This folder is not there any more.' }); s.scan.truncated = true; s.problems.push({ area: 'library', code: 'STORE_UNREADABLE' });
  s.projects.push({ ...clone(s.projects[0]!), key: '/x/locked', name: 'locked', status: 'unreadable', openCode: 'PROJECT_IN_CLOUD_FOLDER', items: [], agents: [] });
  const text = homeModel(s).attention.map(a => `${a.title} ${a.body} ${a.todo}`).join('\n');
  for (const part of ['"client-archive" is missing', 'cannot be used', 'not shared on GitHub', 'may share private files', 'tracked by git', 'Leftover files', 'cannot be searched', 'Some projects may be missing', 'Part of the library could not be read', 'Bowerloom cannot open locked', 'cloud-synced']) assert.ok(text.includes(part), part);
  for (const a of homeModel(s).attention) { assert.ok(a.todo.length > 10, a.id); assert.ok(a.body.length > 10, a.id); }
});

test('home: a store that is absent, foreign, or refused is explained', async () => {
  const s = clone(await sampleSnapshot()); s.projects = [];
  s.store.state = 'absent'; assert.equal(homeModel(s).sentence, 'There is no Bowerloom library on this computer yet.'); assert.match(homeModel(s).attention[0]!.title, /No library yet/);
  s.store.state = 'foreign'; assert.match(homeModel(s).attention.find(a => a.id === 'store:problem')!.body, /not a Bowerloom library/);
  s.store.state = 'refused'; s.store.code = 'STORE_UNSAFE'; assert.match(homeModel(s).attention.find(a => a.id === 'store:problem')!.body, /not safe to use/);
});

test('home: the token is mentioned only when it matters, and never its value', async () => {
  const s = clone(await sampleSnapshot());
  s.store.token = 'not-set'; assert.ok(homeModel(s).attention.some(a => a.id === 'token'), 'relevant: the store has a GitHub remote');
  s.store.git = { problem: 'none', remote: null, branch: null, head: null, pushed: null }; s.projects.forEach(p => { p.shared = false; });
  assert.ok(!homeModel(s).attention.some(a => a.id === 'token'), 'not relevant: nothing is shared');
  s.store.git = clone((await sampleSnapshot()).store.git); s.store.token = 'set'; assert.ok(!homeModel(s).attention.some(a => a.id === 'token'));
  s.store.token = 'invalid'; assert.match(homeModel(s).attention.find(a => a.id === 'token')!.title, /looks wrong/);
});

test('home: when everything is fine, it says so', async () => {
  const s = clone(await sampleSnapshot()); s.projects = s.projects.filter(p => p.status === 'ready'); s.store.token = 'set';
  s.library.skills.forEach(i => { i.usedBy = []; });
  assert.deepEqual(homeModel(s).attention, []);
});

test('library rows: a plain label, where it came from, the version in words, and who uses it', async () => {
  const s = await sampleSnapshot(), skills = libraryRows(s, 'skill'), brand = skills.find(r => r.id === 'brand-voice')!, house = skills.find(r => r.id === 'house-style')!;
  assert.equal(brand.label, 'Brand voice'); assert.equal(brand.origin, 'From npm'); assert.equal(brand.version, 'Fixed to version 1.2.0 from npm'); assert.equal(brand.used, 'Used by 1 project');
  assert.equal(house.origin, 'Yours'); assert.equal(house.version, 'Not fixed. It follows your own folder.'); assert.equal(house.used, 'Used by 2 projects');
  assert.equal(skills.find(r => r.id === 'weekly-digest')!.used, 'Used by 1 project');
  assert.equal(libraryRows(s, 'team').find(r => r.id === 'launch-crew')!.used, 'Not used by any project');
});

test('pin words', () => {
  assert.equal(pinWords('@synthetic/brand-voice@1.2.0:skills/brand-voice', 'npm'), 'Fixed to version 1.2.0 from npm');
  assert.equal(pinWords('owner/repo@0123456789abcdef', 'github'), 'Fixed to GitHub copy 01234567');
  assert.equal(pinWords(null, 'yours'), 'Not fixed. It follows your own folder.'); assert.equal(pinWords(null, 'npm'), 'Not fixed to a version.');
});

test('powerful agent settings are found in the file head, and only there', () => {
  assert.deepEqual(powerfulSettings('---\nname: a\npermissionMode: bypassPermissions\n---\nbody'), ['Skips permission questions (bypassPermissions)']);
  assert.deepEqual(powerfulSettings('---\nname: a\nhooks:\n  x: y\nmcpServers:\n  s: {}\n---\n'), ['Runs commands by itself (hooks)', 'Connects to outside tools (mcpServers)']);
  assert.deepEqual(powerfulSettings('---\nname: a\n---\nhooks:\npermissionMode: bypassPermissions\n'), [], 'words in the body are not settings');
  assert.deepEqual(powerfulSettings('no head'), []); assert.deepEqual(powerfulSettings(null), []); assert.deepEqual(powerfulSettings('---\nname: a\npermissionMode: plan\n---'), []);
});

test('item detail: a team shows its helper files, and the powerful setting is a warning', async () => {
  const s = await sampleSnapshot();
  const content = { kind: 'team' as const, id: 'newsroom', where: 'project' as const, pinned: null, note: null, files: [{ path: 'agents/publisher.md', text: '---\nname: publisher\npermissionMode: bypassPermissions\n---\n', note: null, bytes: 10 }, { path: 'team.yaml', text: 'x', note: null, bytes: 1 }] };
  const d = itemDetail(s, 'team', 'newsroom', content, s.projects.find(p => p.name === 'newsletter')!.key);
  assert.deepEqual(d.powers, ['Skips permission questions (bypassPermissions)']); assert.equal(d.files[0]!.powers.length, 1); assert.equal(d.files[1]!.powers.length, 0);
  assert.equal(d.title, 'Newsroom'); assert.match(d.what, /group of AI helpers/);
  const lib = itemDetail(s, 'skill', 'house-style', null, null); assert.equal(lib.origin, 'Yours'); assert.equal(lib.usedBy.map(u => u.name).sort().join(), 'old-archive,studio-site');
  assert.equal(itemDetail(s, 'skill', 'brand-voice', null, null).origin, 'From npm');
});

test('slices: a simple bar compares what an agent reads at the start with reading everything', async () => {
  const s = await sampleSnapshot(), m = sliceModels(s.projects.find(p => p.name === 'newsletter')!).find(c => c.id === 'team-notes')!;
  assert.equal(m.id, 'team-notes'); assert.equal(m.where, 'the knowledge folder "team-notes"'); assert.equal(m.files, '4 files'); assert.deepEqual(m.agents, ['editor']);
  assert.equal(m.bars.length, 1); assert.ok(m.bars[0]!.percent > 0 && m.bars[0]!.percent < 50); assert.match(m.bars[0]!.sentence, /^editor reads .* at the start instead of .* if it read every note\.$/);
  assert.equal(slicesByProject(s).length, 2);
  assert.deepEqual(sliceModels(s.projects.find(p => p.name === 'studio-site')!)[0]!.bars, [], 'no agent reads it, so no comparison');
});

test('knowledge folders: state, who may read, and what to do about an empty list', async () => {
  const s = await sampleSnapshot(), rows = folderRows(s);
  assert.equal(rows[0]!.note, 'No project is allowed to read this folder yet.'); const tn = rows.find(x => x.name === 'team-notes')!; assert.equal(tn.note, '2 projects can read it.'); assert.deepEqual(tn.allowed.map(a => a.name), ['newsletter', 'studio-site']);
  const t = clone(s); t.folders[0]!.state = 'missing'; assert.equal(folderRows(t)[0]!.state, 'Missing');
});

test('storage words: location, sharing, token, saved copies', async () => {
  const s = await sampleSnapshot(), st = storeSummary(s.store);
  assert.equal(st.state, 'Ready'); assert.match(st.git, /Shared on GitHub at github\.com\/sample-co\/shared-store, on the branch "main"/);
  const t = clone(s.store); t.git!.problem = 'none'; assert.match(storeSummary(t).git, /Not shared/); t.token = 'set'; assert.match(storeSummary(t).token, /is set on this computer/); t.token = 'not-set'; assert.equal(storeSummary(t).token, 'No GitHub access key is set.');
  assert.match(cacheSummary(s.cache), /Nothing is saved yet/);
  assert.equal(cacheSummary({ ...s.cache, totalEntries: 2, totalBytes: 2048, unknownSize: 1 }), '2 saved copies, 2.0 KB and 1 of unknown size.');
  assert.match(cacheSummary({ ...s.cache, state: 'unavailable' }), /could not be listed/);
});

test('the raw files are rendered as readable sentences, not JSON', async () => {
  const s = await sampleSnapshot(), p = s.projects.find(x => x.name === 'studio-site')!;
  const lines = configLines(p);
  assert.match(lines[0]!, /^It uses 1 team: research-desk \(from your library\)\.$/); assert.match(lines[1]!, /^It uses 2 skills: house-style \(from your library\), meeting-notes/);
  assert.ok(projectDetail(s.projects.find(x => x.name === 'newsletter')!).lock.includes('Skill brand-voice: npm package @synthetic/brand-voice@1.2.0'));
  assert.match(lockSentence(p), /good/);
  for (const line of [...lines, ...projectDetail(p).lock]) assert.doesNotMatch(line, /[{}"\[\]]/, 'no JSON');
});

test('no screen shows a command line or asks anyone to open a terminal', async () => {
  const s = clone(await sampleSnapshot());
  s.store.git!.problem = 'unpushed'; s.store.gitignoreMissing = true; s.store.foldersTracked = true; s.folders[0]!.state = 'missing';
  for (const w of allWords(s)) assert.doesNotMatch(w, COMMAND, w);
  for (const code of ['LOCK_INVALID', 'LOCK_UNSAFE', 'LOCK_LIMIT', 'LOCK_CONFIG_MISMATCH', 'LOCK_STORE_NOT_PUSHED', 'CONFIG_INVALID', 'STORE_ITEM_MISSING', 'AGENT_GRANT_REVIEW_REQUIRED', 'FOLDER_NOT_ALLOWED', 'SKILLS_OFFLINE', 'PROJECT_UNSAFE', 'PROJECT_IN_CLOUD_FOLDER', 'STORE_UNSAFE', 'NOT_FOUND', 'OUTSIDE_ROOT', 'THROUGH_LINK']) { assert.doesNotMatch(codeWords(code), COMMAND, code); assert.doesNotMatch(codeWords(code), /Bowerloom reported a problem it has no plain words/, code); }
  assert.match(codeWords('SOMETHING_NEW'), /no plain words/); assert.equal(codeWords(null), '');
});

test('small helpers: bytes, titles, hidden characters', () => {
  assert.equal(humanBytes(10), '10 bytes'); assert.equal(humanBytes(2048), '2.0 KB'); assert.equal(humanBytes(5 * 1024 * 1024), '5.0 MB'); assert.equal(titleOf('house-style'), 'House style');
  const zw = String.fromCharCode(0x200b), rlo = String.fromCharCode(0x202e), zwj = String.fromCharCode(0x200d);
  assert.equal(safeLine(`a${zw}b${rlo}c\u0007\nd`), 'a\\u200bb\\u202ec\\u0007\\u000ad'); assert.equal(safeLine(`a${zwj}b`), `a${zwj}b`);
  assert.equal(safeText(`line1\n\tline2${rlo}\r\n`), `line1\n\tline2\\u202e\r\n`); assert.equal(safeText('<b>ok</b> & "quotes"'), '<b>ok</b> & "quotes"');
  assert.equal(safeLine(`ls${String.fromCharCode(0x2028)}x`), 'ls\\u2028x');
});

test('slice cards: every state is shown from the sample, with one plain sentence when held', async () => {
  const s = await sampleSnapshot(), news = s.projects.find(p => p.name === 'newsletter')!, studio = s.projects.find(p => p.name === 'studio-site')!;
  const card = (p: typeof news, id: string) => sliceModels(p).find(c => c.id === id)!;
  // Live, heading style.
  const heading = card(studio, 'team-notes'); assert.equal(heading.stateLabel, 'Live'); assert.equal(heading.reason, null); assert.equal(heading.tone, 'good'); assert.equal(heading.files, '4 files'); assert.equal(heading.wants, 'Wants to show each file\'s first heading.'); assert.equal(heading.permission, 'This project may show headings from this folder.');
  // Live, frontmatter style.
  const front = card(studio, 'brief-titles'); assert.equal(front.stateLabel, 'Live'); assert.equal(front.wants, 'Wants to show each file\'s `title`.'); assert.equal(front.permission, 'This project may show the `title` of each file from this folder.');
  // Held: the folder is not allowed for this project.
  const none = card(news, 'client-history'); assert.equal(none.stateLabel, 'Held'); assert.equal(none.reason, 'This folder has not been allowed for this project yet.'); assert.equal(none.where, 'the knowledge folder "client-archive"'); assert.equal(none.tone, 'warn');
  // Held: the permission is for another style.
  const other = card(news, 'team-titles'); assert.equal(other.stateLabel, 'Held'); assert.equal(other.reason, 'This reading list wants to show each file\'s `title`, but this project was only allowed to show headings.');
  // Held: an older permission with no style.
  const older = card(news, 'old-reports-list'); assert.equal(older.stateLabel, 'Held'); assert.equal(older.reason, 'An older permission without a style needs to be set again.');
  assert.equal(card(news, 'team-notes').stateLabel, 'Live');
});

test('slice cards: two slices on one folder that need different styles sit side by side with the note', async () => {
  const s = await sampleSnapshot(), groups = sliceGroups(s.projects.find(p => p.name === 'newsletter')!), g = groups.find(x => x.folder === 'team-notes')!;
  assert.equal(g.conflict, 'A folder permission holds one style per project, so only one of these can be live.');
  assert.deepEqual(g.slices.map(c => `${c.id}:${c.stateLabel}`), ['team-notes:Live', 'team-titles:Held']);
  for (const other of groups.filter(x => x.folder !== 'team-notes')) assert.equal(other.conflict, null, other.folder);
  assert.ok(sliceGroups(s.projects.find(p => p.name === 'studio-site')!).every(x => x.conflict === null));
  assert.equal(slicesByProject(s).find(x => x.project.name === 'newsletter')!.slices.length, 4, 'grouped by folder on the folders screen too');
});

test('slice cards: a slice that wants no text is never held by a permission; the same style on both is no conflict', async () => {
  const s = clone(await sampleSnapshot()), p = s.projects.find(x => x.name === 'newsletter')!;
  const none = p.slices.find(x => x.id === 'client-history')!; none.wants = 'none'; none.hold = null; assert.equal(sliceReason(none), null);
  for (const x of p.slices.filter(y => y.folder === 'team-notes')) { x.hold = null; x.wants = 'frontmatter'; x.wantsKey = 'title'; x.grantStyle = 'frontmatter'; x.grantKey = 'title'; }
  assert.equal(sliceGroups(p).find(x => x.folder === 'team-notes')!.conflict, null);
  assert.ok(sliceGroups(p).find(x => x.folder === 'team-notes')!.slices.every(c => c.stateLabel === 'Live'));
  const t = p.slices.find(x => x.id === 'team-titles')!; t.wantsKey = 'summary'; assert.match(sliceReason(t)!, /`summary`.*only allowed to show the `title`/);
});

test('folder cards: the permission style of each project, and the older permission', async () => {
  const s = await sampleSnapshot(), rows = folderRows(s), r = (n: string) => rows.find(x => x.name === n)!;
  assert.deepEqual(r('team-notes').styles.map(x => `${x.name}: ${x.text}`), ['newsletter: May show headings', 'studio-site: May show headings']);
  assert.deepEqual(r('project-briefs').styles.map(x => x.text), ['May show the `title` of each file']);
  assert.match(r('old-reports').styles[0]!.text, /older permission with no style/); assert.equal(r('old-reports').note, 'No project is allowed to read this folder yet.');
  assert.equal(r('client-archive').styleNote, null); assert.match(r('team-notes').styleNote!, /one style per project/);
});

test('a reading list is Held whenever Bowerloom holds it, even with a matching permission; every hold has a plain reason', async () => {
  const s = clone(await sampleSnapshot()), p = s.projects.find(x => x.name === 'studio-site')!, sl = p.slices.find(x => x.id === 'team-notes')!;
  assert.equal(sliceModels(p).find(c => c.id === 'team-notes')!.stateLabel, 'Live');
  const expected: Record<string, RegExp> = { SLICE_TOO_LARGE: /too big/, SLICE_ROOT_MISSING: /is not there/, SLICE_ROOT_UNSAFE: /not safe to read/, SLICE_EMPTY: /matches no files/, FOLDER_NOT_ALLOWED: /not been allowed/, SOMETHING_NEW: /cannot describe in plain words yet/ };
  for (const [code, re] of Object.entries(expected)) {
    sl.hold = { code, next: 'x' }; assert.equal(sl.grantStyle, 'heading'); assert.equal(sl.wants, 'heading');
    const c = sliceModels(p).find(x => x.id === 'team-notes')!;
    assert.equal(c.stateLabel, 'Held', code); assert.match(c.reason!, re, code); assert.equal(c.technical, code);
  }
  const real = sliceModels((await sampleSnapshot()).projects.find(x => x.name === 'newsletter')!).find(c => c.id === 'meeting-archive-all')!;
  assert.equal(real.stateLabel, 'Held'); assert.match(real.reason!, /too big to load at the start/);
});

test('a permission that could not be checked is said so in plain words, on the card and in the project reasons', async () => {
  const s = clone(await sampleSnapshot()), p = s.projects.find(x => x.name === 'studio-site')!, sl = p.slices[0]!;
  sl.grantStyle = 'unknown'; sl.grantCode = 'FOLDER_UNSAFE';
  const c = sliceModels(p)[0]!; assert.match(c.note!, /^Could not check this folder: /); assert.equal(c.stateLabel, 'Live', 'a check that failed is not a hold');
  assert.ok(projectDetail(p).reasons.some(r => /could not check the folder/.test(r)));
  const f = s.folders.find(x => x.name === 'team-notes')!; f.unknown = [{ key: p.key, code: 'FOLDER_UNSAFE' }];
  const row = folderRows(s).find(x => x.name === 'team-notes')!; assert.match(row.unknownNotes[0]!, /could not check the permission/); assert.match(row.note, /could not be fully checked/);
});

test('home: unknown counts, no folder chosen, the sample banner, a time, and limits of the search', async () => {
  const base = await sampleSnapshot(), s = clone(base);
  assert.equal(homeModel(s).sample, true); assert.match(homeModel(s).asOf, /^As of /);
  s.library.failed = 'STORE_UNREADABLE';
  assert.deepEqual(homeModel(s).counts.slice(0, 3).map(c => c.value), [null, null, null]); assert.match(homeModel(s).sentence, /could not be read, so the numbers/); assert.ok(homeModel(s).attention.some(a => a.id === 'library:failed'));
  const t = clone(base); t.mode = 'real'; t.projects = []; t.scan.roots = []; t.store.token = 'set';
  assert.equal(homeModel(t).needsFolder, true); assert.equal(homeModel(t).sample, false);
  const u = clone(base); u.scan.truncated = true; u.scan.depthReached = true; u.scan.skipped = [{ path: '/x', reason: 'cannot be opened' }, { path: '/y', reason: 'is a link, so it is not followed' }];
  const missing = homeModel(u).attention.find(a => a.id === 'scan:limits')!;
  assert.equal(missing.title, 'Some projects may be missing'); for (const part of ['stopped early', '4 folders deep', '1 folder could not be opened', '1 shortcut']) assert.ok(missing.body.includes(part), part);
  const v = clone(base); v.problems.push({ area: 'folders', code: 'STORE_UNREADABLE' }); v.folders = [];
  assert.match(homeModel(v).attention.find(a => a.id === 'problem:folders')!.title, /knowledge folders could not be read/); assert.match(foldersProblem(v)!, /not known/);
  assert.equal(foldersProblem(base), null);
});

test('words: Ready needs a lock that is used; Drifted never claims nothing is broken; things that cannot run are a thing to look at', async () => {
  assert.equal(STATUS_CHIP['not-locked'].label, 'Nothing locked yet'); assert.match(STATUS_SENTENCE['not-locked'], /Nothing is locked yet/);
  for (const sentence of Object.values(STATUS_SENTENCE)) assert.doesNotMatch(sentence, /Nothing is broken/);
  const s = await sampleSnapshot(), reasons = projectDetail(s.projects.find(x => x.name === 'newsletter')!).reasons;
  assert.ok(reasons.some(r => /fixed-version skills have not been downloaded/.test(r)), 'SKILLS_OFFLINE is shown');
  const t = clone(s), p = t.projects.find(x => x.name === 'studio-site')!;
  for (const code of ['REVISION_PENDING', 'MANAGED_SKILL_RECOVERY_REQUIRED', 'MANAGED_SKILL_LEGACY_PRESENT']) { p.unavailable = code; assert.ok(projectDetail(p).reasons.length > 0, code); assert.doesNotMatch(projectDetail(p).reasons.join(' '), /no plain words/); }
});
