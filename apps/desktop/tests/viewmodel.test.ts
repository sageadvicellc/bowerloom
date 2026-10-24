// What each screen says. A drifted project says why, in plain words, and no screen shows a command line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OLDER_NOTE, lockSourceWords, representatives, STATUS_CHIP, STATUS_SENTENCE, cacheSummary, configLines, folderRows, foldersProblem, homeModel, itemDetail, libraryRows, lockSentence, pinWords, projectDetail, projectRows, sliceGroups, sliceModels, sliceReason, slicesByProject, storeSummary } from '../shared/viewmodel.js';
import { GENERIC_CODE_WORDS, codeWords, humanBytes, isPowerful, powerWords, titleOf } from '../shared/words.js';
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
  assert.ok(d.reasons.some(r => /Helper "publisher": This helper asks for powerful permissions/.test(r)));
  assert.ok(d.reasons.includes('The lock file and the project list name different items.'));
  assert.ok(d.reasons.includes('Reading list "client-history": This folder has not been allowed for this project yet.')); assert.ok(d.reasons.some(r => /^Reading list "meeting-archive-all": This reading list is too big/.test(r)));
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
  assert.equal(h.sentence, 'You have 2 teams, 4 skills and 2 prompts in your library, used by 4 projects.');
  assert.deepEqual(h.counts.map(c => [c.label, c.value]), [['Teams', 2], ['Skills', 4], ['Prompts', 2], ['Projects', 4]]);
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
  s.projects.push({ ...clone(s.projects[0]!), key: '/x/locked', name: 'locked', gitCommon: null, status: 'unreadable', openCode: 'PROJECT_IN_CLOUD_FOLDER', items: [], agents: [] });
  const text = homeModel(s).attention.map(a => `${a.title} ${a.body} ${a.todo}`).join('\n');
  for (const part of ['"client-archive" is missing', 'cannot be used', 'not shared on GitHub', 'may share private files', 'tracked by git', 'Leftover files', 'cannot be searched', 'Some projects may be missing', 'Part of the library could not be read', 'Bowerloom cannot open locked', 'cloud-synced']) assert.ok(text.includes(part), part);
  for (const a of homeModel(s).attention) { assert.ok(a.todo.length > 10, a.id); assert.ok(a.body.length > 10, a.id); }
});

test('home: a store that is absent, foreign, or refused is explained', async () => {
  const s = clone(await sampleSnapshot()); s.projects = [];
  s.store.state = 'absent'; assert.match(homeModel(s).sentence, /shared library .* is not set up yet, and that is normal/); assert.equal(homeModel(s).attention[0]!.title, 'The shared library is not set up yet'); assert.match(homeModel(s).attention[0]!.body, /This is normal/);
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

test('item detail: powerful settings come from the plan\'s notices, in plain sentences, and the raw names stay in the details', async () => {
  const s = await sampleSnapshot(), news = s.projects.find(p => p.name === 'newsletter')!;
  const content = { kind: 'team' as const, id: 'newsroom', where: 'project' as const, pinned: null, note: null, files: [{ path: 'agents/publisher.md', text: 'permissionMode: bypassPermissions', note: null, bytes: 10 }, { path: 'agents/editor.md', text: 'hooks:\nmcpServers:', note: null, bytes: 10 }, { path: 'team.yaml', text: 'x', note: null, bytes: 1 }] };
  const d = itemDetail(s, 'team', 'newsroom', content, news.key);
  assert.deepEqual(d.powers, ['Can act without asking.', 'Can use every tool it is given.']); assert.deepEqual(d.rawPowers, ['permissionMode:bypassPermissions', 'all-tools']);
  assert.deepEqual(d.files[0]!.powers, ['Can act without asking.', 'Can use every tool it is given.']); assert.deepEqual(d.files[1]!.powers, [], 'words in a file are not settings: only the plan decides'); assert.deepEqual(d.files[2]!.powers, []);
  assert.equal(d.title, 'Newsroom'); assert.match(d.what, /group of AI helpers/);
  const lib = itemDetail(s, 'skill', 'house-style', null, null); assert.equal(lib.origin, 'Yours'); assert.equal(lib.usedBy.map(u => u.name).sort().join(), 'old-archive,studio-site');
  assert.equal(itemDetail(s, 'skill', 'brand-voice', null, null).origin, 'From npm');
  const fm = projectDetail(news).agents.find(a => a.role === 'publisher')!;
  assert.deepEqual(fm.powers, ['Can act without asking.', 'Can use every tool it is given.']); assert.deepEqual(fm.rawPowers, ['permissionMode:bypassPermissions', 'all-tools']); assert.match(fm.hold!, /powerful permissions/); assert.equal(fm.holdCode, 'AGENT_GRANT_REVIEW_REQUIRED');
});

test('power words: each setting has a plain sentence, an unknown one is still a sentence, and asking before acting is not a warning', () => {
  assert.equal(powerWords('hooks'), 'Can run commands on your computer.'); assert.equal(powerWords('mcpServers'), 'Can connect to other tools.'); assert.equal(powerWords('permissionMode:bypassPermissions'), 'Can act without asking.');
  assert.match(powerWords('something-new'), /cannot describe yet/); assert.equal(isPowerful('permissionMode:manual'), false); assert.equal(isPowerful('hooks'), true);
});

test('the main words carry no codes, paths, file names, or hashes: those are in the details', async () => {
  const s = clone(await sampleSnapshot());
  s.store.git!.problem = 'unpushed'; s.folders[0]!.state = 'missing';
  const JARGON = /\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b|bowerloom\.json|bowerloom\.lock|\.bowerloom|\/Users\/|\/private\/|\bhash\b|\bcommit [0-9a-f]{6}|\.md\b|\.yaml\b/;
  const words = [...allWords(s)]; const home = homeModel(s); words.push(...home.attention.map(a => a.title));
  for (const w of words) assert.doesNotMatch(w, JARGON, w);
  for (const p of s.projects) { const d = projectDetail(p); assert.ok(d.details.some(x => x.startsWith('Folder: ')), 'the folder path is in the details'); for (const line of d.lock) assert.doesNotMatch(line, JARGON, line); }
  assert.ok(projectDetail(s.projects.find(x => x.name === 'old-archive')!).details.some(x => x.includes('LOCK_INVALID')));
  assert.ok(projectDetail(s.projects.find(x => x.name === 'studio-site')!).details.some(x => /^Lock: .*hash [0-9a-f]{8}/.test(x)));
  assert.match(lockSourceWords('sample-co/shared-store commit 5a3c9e1d, hash 5e8c1ea7'), /^a saved copy from sample-co\/shared-store$/); assert.equal(lockSourceWords('npm @a/b@1.0.0'), 'fixed to the npm package @a/b@1.0.0');
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
  assert.ok(projectDetail(s.projects.find(x => x.name === 'newsletter')!).lock.includes('Skill brand-voice: fixed to the npm package @synthetic/brand-voice@1.2.0'));
  assert.match(lockSentence(p), /good/);
  for (const line of [...lines, ...projectDetail(p).lock]) assert.doesNotMatch(line, /[{}"\[\]]/, 'no JSON');
});

test('no screen shows a command line or asks anyone to open a terminal', async () => {
  const s = clone(await sampleSnapshot());
  s.store.git!.problem = 'unpushed'; s.store.gitignoreMissing = true; s.store.foldersTracked = true; s.folders[0]!.state = 'missing';
  for (const w of allWords(s)) assert.doesNotMatch(w, COMMAND, w);
  for (const code of ['LOCK_INVALID', 'LOCK_UNSAFE', 'LOCK_LIMIT', 'LOCK_CONFIG_MISMATCH', 'LOCK_STORE_NOT_PUSHED', 'CONFIG_INVALID', 'STORE_ITEM_MISSING', 'AGENT_GRANT_REVIEW_REQUIRED', 'FOLDER_NOT_ALLOWED', 'SKILLS_OFFLINE', 'PROJECT_UNSAFE', 'PROJECT_IN_CLOUD_FOLDER', 'STORE_UNSAFE', 'NOT_FOUND', 'OUTSIDE_ROOT', 'THROUGH_LINK']) { assert.doesNotMatch(codeWords(code), COMMAND, code); assert.notEqual(codeWords(code), GENERIC_CODE_WORDS, code); }
  assert.equal(codeWords('SOMETHING_NEW'), GENERIC_CODE_WORDS); assert.match(GENERIC_CODE_WORDS, /cannot describe in plain words yet.*copy them/); assert.equal(codeWords(null), '');
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
  const front = card(studio, 'brief-titles'); assert.equal(front.stateLabel, 'Live'); assert.equal(front.wants, 'Wants to show each file\'s title.'); assert.equal(front.permission, 'This project may show the title of each file from this folder.');
  // Held: the folder is not allowed for this project.
  const none = card(news, 'client-history'); assert.equal(none.stateLabel, 'Held'); assert.equal(none.reason, 'This folder has not been allowed for this project yet.'); assert.equal(none.where, 'the knowledge folder "client-archive"'); assert.equal(none.tone, 'warn');
  // Held: the permission is for another style.
  const other = card(news, 'team-titles'); assert.equal(other.stateLabel, 'Held'); assert.equal(other.reason, 'This reading list wants to show each file\'s title, but this project was only allowed to show headings.');
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
  const t = p.slices.find(x => x.id === 'team-titles')!; t.wantsKey = 'summary'; assert.match(sliceReason(t)!, /summary.*only allowed to show the title/);
});

test('folder cards: the permission style of each project, and the older permission', async () => {
  const s = await sampleSnapshot(), rows = folderRows(s), r = (n: string) => rows.find(x => x.name === n)!;
  assert.deepEqual(r('team-notes').styles.map(x => `${x.name}: ${x.text}`), ['newsletter: May show headings', 'studio-site: May show headings']);
  assert.deepEqual(r('project-briefs').styles.map(x => x.text), ['May show the title of each file']);
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
  const u = clone(base); u.scan.truncated = true; u.scan.depthReached = true; u.scan.depthFolders = ['code/deep']; u.scan.unopenedFolders = 1; u.scan.linkedFolders = ['shared-notes']; u.scan.linkedFoldersTotal = 1;
  const missing = homeModel(u).attention.find(a => a.id === 'scan:limits')!;
  assert.equal(missing.title, 'Some projects may be missing'); for (const part of ['stopped early', '4 folders deep', 'reached that limit in "code/deep"', '1 folder could not be opened', '1 folder that is a shortcut was not searched: shared-notes']) assert.ok(missing.body.includes(part), part);
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
  for (const code of ['REVISION_PENDING', 'MANAGED_SKILL_RECOVERY_REQUIRED', 'MANAGED_SKILL_LEGACY_PRESENT']) { p.unavailable = code; assert.ok(projectDetail(p).reasons.length > 0, code); assert.doesNotMatch(projectDetail(p).reasons.join(' '), /cannot describe in plain words/); }
});

test('field names are plain words, never literal backticks, anywhere in what the screens say', async () => {
  const s = clone(await sampleSnapshot());
  for (const w of allWords(s)) assert.doesNotMatch(w, /`/, w);
  const p = s.projects.find(x => x.name === 'newsletter')!, t = p.slices.find(x => x.id === 'team-titles')!;
  t.wantsKey = 'summary'; t.grantStyle = 'frontmatter'; t.grantKey = 'title';
  assert.equal(sliceReason(t), "This reading list wants to show each file's summary, but this project was only allowed to show the title of each file.");
  for (const c of sliceModels(p)) for (const text of [c.reason, c.wants, c.permission, c.note]) if (text !== null) assert.doesNotMatch(text, /`/, text);
  for (const f of folderRows(s)) for (const text of [...f.styles.map(x => x.text), f.styleNote ?? '']) assert.doesNotMatch(text, /`/, text);
});

test('a held reading list that has no counted files says so, not "no files yet"', async () => {
  const s = await sampleSnapshot(), cards = sliceModels(s.projects.find(x => x.name === 'newsletter')!), by = (id: string) => cards.find(c => c.id === id)!;
  for (const id of ['client-history', 'meeting-archive-all', 'old-reports-list', 'team-titles']) { assert.equal(by(id).stateLabel, 'Held', id); assert.equal(by(id).files, 'Not counted while held', id); }
  assert.equal(by('team-notes').files, '4 files');
  const t = clone(s), live = t.projects.find(x => x.name === 'newsletter')!.slices.find(x => x.id === 'team-notes')!; live.members = 0; assert.equal(sliceModels(t.projects.find(x => x.name === 'newsletter')!).find(c => c.id === 'team-notes')!.files, '0 files', 'a live list with none really has none');
});

test('a project set up the older way says so, never talks about a library, and lists what differs', async () => {
  const s = await sampleSnapshot(), p = s.projects.find(x => x.name === 'studio-office')!, d = projectDetail(p);
  assert.equal(p.layout, 'older'); assert.equal(d.older, true); assert.equal(d.olderNote, 'Set up the older way (a .bowerloom folder). The shared library from beta.3 is not used here yet.'); assert.equal(OLDER_NOTE, d.olderNote);
  assert.equal(d.chip.label, 'Drifted'); assert.deepEqual(d.reasons, ['This folder moved, or was copied, since it was set up.']);
  assert.match(d.sentence, /Something differs from what Bowerloom set up here\. What differs is listed below\./);
  for (const text of [d.sentence, ...d.reasons, ...d.config, ...d.items.map(i => `${i.match.text} ${i.from}`)]) assert.doesNotMatch(text, /library|lock/i, text);
  assert.deepEqual(d.items.map(i => `${i.kind}:${i.id}:${i.match.text}`), ['team:first-team:Part of this project']); assert.equal(d.config[0], 'It uses 1 team: first-team (in this project).');
  assert.ok(d.details.includes('Set up: the older way (a .bowerloom folder, no bowerloom.json)'));
  const card = homeModel(s).attention.find(a => a.title === 'studio-office differs from what was set up')!; assert.match(card.body, /moved, or was copied/);
  // A drifted older project with nothing reported still says what it knows, and that nothing was named.
  const t = clone(s), q = t.projects.find(x => x.name === 'studio-office')!; q.drift = []; assert.match(projectDetail(q).reasons[0]!, /did not say what/);
  q.drift = [{ kind: 'changed', path: '.bowerloom/x', code: null }, { kind: 'missing', path: '.bowerloom/y', code: null }]; q.ownedEdited = ['.bowerloom/a', '.bowerloom/b'];
  assert.deepEqual(projectDetail(q).reasons, ['A file that Bowerloom set up has changed.', 'A file that Bowerloom set up is missing.', '2 files that Bowerloom manages were edited by hand.']);
  q.status = 'ready'; q.drift = []; assert.equal(projectDetail(q).sentence, 'Everything that Bowerloom set up here is in place.'); assert.deepEqual(projectDetail(q).reasons, []);
});

test('with no shared library the numbers are what the projects hold, and the library is called not set up yet, which is normal', async () => {
  const s = clone(await sampleSnapshot()); s.store.state = 'absent'; s.library = { skills: [], prompts: [], teams: [], unlisted: 0, pinsError: null, failed: null };
  const h = homeModel(s); assert.equal(h.countsFrom, 'projects');
  assert.deepEqual(h.counts.map(c => [c.label, c.value]), [['Teams', 3], ['Skills', 6], ['Prompts', 2], ['Projects', 4]]);
  assert.match(h.sentence, /Across your 4 projects, you have 3 teams, 6 skills and 2 prompts\. The shared library .* is not set up yet, and that is normal\./);
  assert.ok(h.attention.some(a => a.title === 'The shared library is not set up yet' && /This is normal/.test(a.body)));
});

test('identical problems are one card with the list of projects, and the badge counts cards', async () => {
  const s = clone(await sampleSnapshot()), base = s.projects.find(x => x.name === 'studio-office')!;
  for (let i = 0; i < 5; i++) s.projects.push({ ...clone(base), key: `/x/copy${i}`, dir: `/x/copy${i}`, name: `copy${i}`, gitCommon: null });
  const h = homeModel(s), group = h.attention.find(a => a.members !== undefined)!;
  assert.equal(group.title, '6 projects share this problem'); assert.equal(group.members!.length, 6); assert.deepEqual(group.members!.map(m => m.name).sort(), ['copy0', 'copy1', 'copy2', 'copy3', 'copy4', 'studio-office']);
  assert.equal(h.attention.filter(a => a.title.includes('studio-office') || a.title.includes('copy')).length, 0, 'no copy of the same card is left');
  assert.equal(h.attention.length, 5, 'the old-archive, helper, newsletter, the group, and the token: five cards, not eleven');
  assert.equal(h.counts.find(c => c.label === 'Projects')!.value, 9);
});

test('checkouts of one repository are one row with a count of the other places', async () => {
  const s = clone(await sampleSnapshot()); const [a, b, c] = s.projects;
  a!.gitCommon = '/repo/.git'; b!.gitCommon = '/repo/.git'; c!.gitCommon = '/repo/.git'; b!.dir = `${b!.dir}-other`; c!.dir = `${c!.dir}-another-place`;
  const reps = representatives(s.projects); assert.equal(reps.length, 2); assert.equal(reps.find(r => r.alsoIn > 0)!.alsoIn, 2);
  const rows = projectRows(s); assert.equal(rows.length, 2); assert.match(rows.find(r => /Also checked out/.test(r.summary))!.summary, /Also checked out in 2 other places/);
  assert.equal(homeModel(s).counts.find(x => x.label === 'Projects')!.value, 2);
});

test('example folders that hid a project are named in a notice, and only then', async () => {
  const s = clone(await sampleSnapshot()); assert.ok(!homeModel(s).attention.some(a => a.id === 'scan:examples'));
  s.scan.exampleFolders = ['examples', 'code/tests']; s.scan.exampleFoldersTotal = 3;
  const a = homeModel(s).attention.find(x => x.id === 'scan:examples')!; assert.equal(a.title, '3 example folders were skipped'); assert.match(a.todo, /Also look inside example and test folders/);
});
