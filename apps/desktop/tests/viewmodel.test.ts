// What each screen says. A drifted project says why, in plain words, and no screen shows a command line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_CHIP, cacheSummary, configLines, folderRows, homeModel, itemDetail, libraryRows, lockSentence, pinWords, powerfulSettings, projectDetail, projectRows, sliceGroups, sliceModels, sliceReason, slicesByProject, storeSummary } from '../shared/viewmodel.js';
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
  assert.deepEqual(Object.values(STATUS_CHIP).map(c => c.label), ['Ready', 'Drifted', 'Lock problem', 'Not set up', 'Cannot open']);
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
  for (const part of ['"client-archive" is missing', 'cannot be used', 'not shared on GitHub', 'may share private files', 'tracked by git', 'Leftover files', 'cannot be searched', 'Not every project is shown', 'Part of the library could not be read', 'Bowerloom cannot open locked', 'cloud-synced']) assert.ok(text.includes(part), part);
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
  assert.equal(slicesByProject(s).length, 2); assert.equal(slicesByProject(s).find(g => g.project.name === 'newsletter')!.slices.length, 2, 'grouped by folder');
  assert.deepEqual(sliceModels(s.projects.find(p => p.name === 'studio-site')!)[0]!.bars, [], 'no agent reads it, so no comparison');
});

test('knowledge folders: state, who may read, and what to do about an empty list', async () => {
  const s = await sampleSnapshot(), rows = folderRows(s);
  assert.equal(rows[0]!.note, 'No project is allowed to read this folder yet.'); assert.equal(rows[1]!.note, '2 projects can read it.'); assert.deepEqual(rows[1]!.allowed.map(a => a.name), ['newsletter', 'studio-site']);
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
  assert.match(lines[0]!, /^It uses 1 team: research-desk \(from your library\)\.$/); assert.match(lines[1]!, /^It uses 3 skills: brand-voice \(from your library\), house-style/);
  assert.ok(projectDetail(p).lock.includes('Skill brand-voice: npm package @synthetic/brand-voice@1.2.0'));
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

test('slice cards: name, folder, files, Live or Held, and one plain sentence of reason when held', async () => {
  const s = await sampleSnapshot(), cards = sliceModels(s.projects.find(p => p.name === 'newsletter')!), by = (id: string) => cards.find(c => c.id === id)!;
  assert.deepEqual(cards.map(c => `${c.id}:${c.stateLabel}`), ['client-history:Held', 'team-notes:Live', 'team-titles:Live']);
  const held = by('client-history'); assert.equal(held.reason, 'This folder has not been allowed for this project yet.'); assert.equal(held.where, 'the knowledge folder "client-archive"'); assert.equal(held.tone, 'warn'); assert.equal(held.technical, 'FOLDER_NOT_ALLOWED');
  const live = by('team-notes'); assert.equal(live.reason, null); assert.equal(live.tone, 'good'); assert.equal(live.files, '4 files'); assert.equal(live.wants, 'Wants to show each file\'s first heading.');
  assert.equal(by('team-titles').wants, 'Wants to show each file\'s `title`.');
  assert.equal(sliceModels(s.projects.find(p => p.name === 'studio-site')!)[0]!.stateLabel, 'Live');
  assert.match(folderRows(s)[0]!.styleNote!, /records only that a project may read the folder/);
});

test('slice cards: a permission style that is too narrow, or missing, is explained; two styles on one folder are shown together with the note', async () => {
  const s = clone(await sampleSnapshot()), p = s.projects.find(x => x.name === 'newsletter')!;
  const notes = p.slices.filter(x => x.folder === 'team-notes'); notes[0]!.grantStyle = 'heading'; notes[1]!.grantStyle = 'heading';
  // team-titles wants a frontmatter key, but the permission allows headings only.
  const titles = p.slices.find(x => x.id === 'team-titles')!;
  assert.equal(sliceReason(titles), 'This reading list wants to show each file\'s `title`, but this project was only allowed to show headings.');
  const g = sliceGroups(p).find(x => x.folder === 'team-notes')!;
  assert.equal(g.slices.length, 2); assert.equal(g.conflict, 'A folder permission holds one style per project, so only one of these can be live.');
  assert.deepEqual(g.slices.map(c => c.stateLabel).sort(), ['Held', 'Live']);
  titles.grantStyle = 'unset'; assert.equal(sliceReason(titles), 'An older permission without a style needs to be set again.');
  // The same style on every slice of a folder is no conflict.
  for (const x of notes) { x.grantStyle = 'frontmatter'; x.grantKey = 'title'; x.wants = 'frontmatter'; x.wantsKey = 'title'; }
  assert.equal(sliceGroups(p).find(x => x.folder === 'team-notes')!.conflict, null);
  assert.equal(sliceReason(notes[0]!), null);
  assert.equal(folderRows(s).find(f => f.name === 'team-notes')!.styleNote, null); assert.match(folderRows(s).find(f => f.name === 'team-notes')!.styles.map(x => x.text).join(), /May show/);
});
