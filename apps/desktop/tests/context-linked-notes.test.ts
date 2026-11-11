// Context items (beta.2 Context page): the pages of a notes folder the person linked to a harness. They run on small homes made here and never read the real HOME.
// The harness package stores a linked folder as `.` (the harness folder), a path below it, or `~/` and a path below the home folder; those are the forms the module takes.
// The reader of main/real-scan.ts is the frozen library of the base, so the linked folders are read by main/linked-notes.ts, which adds to the result the reader made.
// A `~/` link is read only for a folder the person picked: the approval is recorded by packages/notes-source (`approveFolder`) at the pick, by the real path of the folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { addLinkedNotes, collectLinked, linkedWatchText, withLinkedNotes, approvalsOf } from '../main/linked-notes.js';
import type { LinkedLimits } from '../main/linked-notes.js';
import { makeBudget, newTally } from '../main/real-fs.js';
import { approvalsFileOf, approveFolder } from '../../../packages/notes-source/src/index.js';
import { storedKnowledgePath } from '../../../packages/harness-definition/src/index.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { realToHarnessState } from '../shared/harness/real-map.js';
import { contextEmpty, linkProblems } from '../shared/harness/library-add.js';
import { linkProblemWords } from '../renderer/harness/words.js';
import { hashText } from '../shared/world/sample.js';
import { tempDir } from './support.js';

const NOW_MS = Date.UTC(2026, 10, 11);
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const harness = (id: string): string => json({ format: 'bowerloom/harness/v1beta1', id, description: 'A harness.', engines: [{ id: 'claude-code' }], parts: { skills: 'skills/', subagents: 'agents/' } });
const page = (title: string): string => `# ${title}\n\nA page about ${title}.\n`;
const link = (path: string, name = 'journal'): string => json({ sources: [{ name, kind: 'wiki-folder', path }] });

/** The private state folder of a made-up home: the approvals of linked home folders are kept below it. */
const stateOf = (home: string): string => join(home, '.made-up-state');
/** `approved` lists folders below home the person picked in the notes chooser, by their path below home. */
const approve = (home: string, approved: readonly string[]): void => { for (const dir of approved) assert.equal(approveFolder(stateOf(home), join(home, dir)), 'kept', dir); };
interface Read { result: RealResult; places: readonly RealPlace[] }
async function read(home: string, approved: readonly string[] = [], limits?: LinkedLimits): Promise<Read> {
  approve(home, approved);
  const scanner = createScanner({ home });
  const found = await scanner.discover();
  const places: RealPlace[] = [...found.places, ...(await scanner.addFolder(join(home, 'work'))).places];
  const batch = await scanner.read(places.map(p => p.id));
  const built = buildRealResult(batch.reads, batch.tally, { nowMs: NOW_MS, foldExtraApps: true });
  return { result: addLinkedNotes(built, places, { home, stateRoot: stateOf(home), ...(limits === undefined ? {} : { limits }) }), places };
}
const titles = (r: Read | RealResult): string[] => ('result' in r ? r.result : r).world.wikiPages.map(p => p.title).sort();
const sliceNames = (r: RealResult): string[] => r.world.items.filter(i => i.kind === 'context-slice').map(i => i.name);
const problemsOf = (r: Read): string[] => (r.result.harnessPlaces ?? []).flatMap(h => (h.harness as { linkProblems?: { reason: string; label: string }[] }).linkProblems ?? []).map(p => `${p.reason}:${p.label}`);
const setup = (t: TestContext, make: (home: string) => void): string => { const home = tempDir(t, 'bowerloom-ctx-'); make(home); return home; };
const proj = (h: string, sources: unknown): void => {
  put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
  put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), json({ sources }));
};
const wiki = (path: string, name = 'journal'): { name: string; kind: string; path: string } => ({ name, kind: 'wiki-folder', path });

test('a wiki under the home folder that a harness links shows its pages as context items, once the person picked it', async t => {
  const home = setup(t, h => {
    proj(h, [wiki('~/journal')]);
    put(join(h, 'journal', 'one.md'), page('One'));
    put(join(h, 'journal', 'deep', 'two.md'), page('Two'));
  });
  const got = await read(home, ['journal']);
  assert.deepEqual(titles(got), ['One', 'Two']);
  assert.ok(sliceNames(got.result).some(n => /linked notes$/.test(n)), `a context item: ${sliceNames(got.result).join(', ')}`);
  assert.equal(got.result.counts.notes, 2);
  assert.deepEqual(problemsOf(got), []);
});

test('a notes folder in the home folder that nothing links is never read on its own', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'journal', 'one.md'), page('One'));
    put(join(h, 'Documents', 'two.md'), page('Two'));
  });
  const got = await read(home, ['journal', 'Documents']);
  assert.deepEqual(titles(got), []);
  assert.deepEqual(sliceNames(got.result), []);
});

test('a link in ~/ form is read only for the folder the person picked; until then it is a problem that says so, and a pick of another folder does not help', async t => {
  const home = setup(t, h => { proj(h, [wiki('~/journal')]); put(join(h, 'journal', 'one.md'), page('One')); put(join(h, 'other', 'x.md'), page('X')); });
  const before = await read(home);
  assert.deepEqual(titles(before), []);
  assert.deepEqual(problemsOf(before), ['approval:~/journal']);
  assert.deepEqual(problemsOf(await read(home, ['other'])), ['approval:~/journal']);
  const after = await read(home, ['journal']);
  assert.deepEqual(titles(after), ['One']);
  assert.deepEqual(problemsOf(after), []);
});

test('a swapped shortcut needs a new pick: the stored path is the same, the folder it leads to is not', async t => {
  const home = setup(t, h => { proj(h, [wiki('~/notes', 'n')]); put(join(h, 'real-one', 'one.md'), page('One')); put(join(h, 'real-two', 'two.md'), page('Two')); symlinkSync(join(h, 'real-one'), join(h, 'notes')); });
  assert.deepEqual(titles(await read(home, ['notes'])), ['One']);
  rmSync(join(home, 'notes')); symlinkSync(join(home, 'real-two'), join(home, 'notes'));
  const got = await read(home);
  assert.deepEqual(titles(got), []);
  assert.deepEqual(problemsOf(got), ['approval:~/notes']);
});

test('a link below the harness folder is part of the project and needs no pick; a subfolder with a tool folder is read whole', async t => {
  const home = setup(t, h => { proj(h, [wiki('docs')]); put(join(h, 'work', 'proj', 'docs', 'sub', '.claude', 'settings.json'), '{}\n'); put(join(h, 'work', 'proj', 'docs', 'sub', 'deep.md'), page('Deep')); });
  const got = await read(home);
  assert.ok(titles(got).includes('Deep'), titles(got).join(', '));
  assert.deepEqual(problemsOf(got), []);
});

test('a linked folder is read even when a subfolder holds a tool folder', async t => {
  const home = setup(t, h => {
    proj(h, [wiki('~/journal')]);
    put(join(h, 'journal', 'top.md'), page('Top'));
    put(join(h, 'journal', 'sub', '.claude', 'settings.json'), '{}\n');
    put(join(h, 'journal', 'sub', 'inside.md'), page('Inside'));
  });
  assert.deepEqual(titles(await read(home, ['journal'])), ['Inside', 'Top']);
});

test('a folder that holds its own harness and is linked to itself adds the pages below a subfolder with a tool folder', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'wiki', '.bowerloom', 'harness.json'), harness('wiki'));
    put(join(h, 'work', 'wiki', '.bowerloom', 'knowledge.json'), link('.', 'wiki'));
    put(join(h, 'work', 'wiki', 'index.md'), page('Index'));
    put(join(h, 'work', 'wiki', 'deep', '.claude', 'settings.json'), '{}\n');
    put(join(h, 'work', 'wiki', 'deep', 'inside.md'), page('Inside'));
  });
  const got = await read(home);
  // `deep` is a place of its own too, so the page is told apart by the set it belongs to: the wiki's own linked set holds it.
  assert.ok(got.result.world.wikiPages.some(p => p.title === 'Inside' && p.folder === 'wiki/deep'), got.result.world.wikiPages.map(p => `${p.folder}:${p.title}`).join(', '));
  assert.equal(titles(got).filter(x => x === 'Index').length, 1, 'a page of the automatic walk is not added twice');
});

// One case for each shape that is refused. The decoy pages sit where the path would lead if it were followed.
const REFUSED: readonly (readonly [string, string])[] = [
  ['home alone: ~/', '~/'], ['home alone: ~/.', '~/.'], ['home alone: ~//', '~//'], ['dot segment: ./x', './x'], ['dotdot inside: a/../b', 'a/../b'], ['dotdot after: ~/a/..', '~/a/..'],
  ['other user: ~foo', '~foo'], ['drive letter', 'C:\\x'], ['backslash', 'a\\b'], ['absolute', '/etc'], ['hidden segment: ~/.hidden', '~/.hidden'], ['hidden below: ~/a/.b', '~/a/.b'], ['hidden relative: .hid/x', '.hid/x'],
  ['a hidden name in another case: ~/.HIDDEN', '~/.HIDDEN'], ['empty', ''],
];
for (const [name, stored] of REFUSED) {
  test(`refused shape, ${name}: nothing is read and the problem says the path is not read`, async t => {
    const home = setup(t, h => {
      proj(h, [wiki(stored)]);
      put(join(h, 'top.md'), page('Top')); put(join(h, 'a', 'b.md'), page('AB')); put(join(h, '.hidden', 'secret.md'), page('Secret')); put(join(h, 'work', 'proj', '.hid', 'x', 'h.md'), page('Hid'));
    });
    const got = await read(home, ['a']);
    assert.deepEqual(titles(got).filter(x => ['Top', 'AB', 'Secret', 'Hid'].includes(x)), [], `no decoy page for ${JSON.stringify(stored)}`);
    assert.equal(problemsOf(got).length, 1, problemsOf(got).join(' | '));
    assert.match(problemsOf(got)[0]!, /^form:/);
  });
}

test('refused shape, a shortcut that leaves its base: to a hidden folder, to a folder outside home, to the home folder itself, to an ancestor of home, and a relative one to home', async t => {
  const outside = (h: string): string => join(dirname(h), `${h.split('/').pop()}-outside`);
  const home = setup(t, h => {
    proj(h, [wiki('~/tossh', 'a'), wiki('~/tooutside', 'b'), wiki('~/self', 'c'), wiki('~/up', 'd'), wiki('tohome', 'e')]);
    put(join(h, '.ssh', 'key.md'), page('Key')); put(join(outside(h), 'out.md'), page('Out')); put(join(h, 'top.md'), page('Top'));
    symlinkSync(join(h, '.ssh'), join(h, 'tossh')); symlinkSync(outside(h), join(h, 'tooutside')); symlinkSync(h, join(h, 'self')); symlinkSync(dirname(h), join(h, 'up')); symlinkSync(h, join(h, 'work', 'proj', 'tohome'));
  });
  t.after(() => rmSync(join(dirname(home), `${home.split('/').pop()}-outside`), { recursive: true, force: true }));
  const got = await read(home, ['tossh', 'tooutside', 'self', 'up']);
  assert.deepEqual(titles(got).filter(x => ['Key', 'Out', 'Top'].includes(x)), []);
  assert.deepEqual(problemsOf(got), ['form:~/tossh', 'form:~/tooutside', 'form:~/self', 'form:~/up', 'form:tohome']);
});

test('a shortcut inside a linked folder that leads out of it is not followed', async t => {
  const home = setup(t, h => {
    proj(h, [wiki('~/journal')]);
    put(join(h, 'journal', 'one.md'), page('One')); put(join(h, 'secret', 'out.md'), page('Out')); symlinkSync(join(h, 'secret'), join(h, 'journal', 'leak'));
  });
  assert.deepEqual(titles(await read(home, ['journal'])), ['One']);
});

test('each form is read: `.`, a path below the harness folder, and ~/ once picked', async t => {
  const home = setup(t, h => {
    proj(h, [wiki('.', 'self'), wiki('docs', 'docs'), wiki('~/journal', 'journal')]);
    put(join(h, 'work', 'proj', 'own.md'), page('Own')); put(join(h, 'work', 'proj', 'docs', 'd.md'), page('D')); put(join(h, 'journal', 'j.md'), page('J'));
  });
  const got = await read(home, ['journal']);
  assert.deepEqual(titles(got), ['D', 'J', 'Own']);
  assert.deepEqual(problemsOf(got), []);
});

test('round trip: every path the writer can produce is read back, and a folder it cannot store is refused by the writer, not saved and hidden', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'work', 'proj', 'docs', 'd.md'), page('Docs')); put(join(h, 'work', 'proj', 'own.md'), page('Own')); put(join(h, 'journal', 'deep', 'j.md'), page('Journal'));
  });
  const root = join(home, 'work', 'proj'), where = { root, home };
  const made = [root, join(root, 'docs'), join(home, 'journal'), join(home, 'journal', 'deep')].map(dir => storedKnowledgePath(dir, where));
  assert.deepEqual(made.map(m => (m.ok ? m.path : m.code)), ['.', 'docs', '~/journal', '~/journal/deep']);
  // Outside both folders, and the home folder itself, have no stored form: the writer refuses them before anything is written.
  const outside = storedKnowledgePath(join(dirname(home), 'elsewhere'), where), whole = storedKnowledgePath(home, where), above = storedKnowledgePath(dirname(home), where);
  assert.deepEqual([outside.ok, whole.ok, above.ok], [false, false, false]);
  assert.equal(outside.ok ? '' : outside.code, 'KNOWLEDGE_PATH_OUTSIDE');
  const stored = made.filter(m => m.ok).map(m => (m.ok ? m.path : ''));
  put(join(root, '.bowerloom', 'knowledge.json'), json({ sources: stored.map((path, i) => wiki(path, `s${i}`)) }));
  const got = await read(home, ['journal', 'journal/deep']);
  assert.deepEqual(problemsOf(got), [], 'each stored path was read');
  for (const want of ['Docs', 'Own', 'Journal']) assert.ok(titles(got).includes(want), `${want} in ${titles(got).join(', ')}`);
});

test('a page of the same file name in the place and in two linked folders keeps its own id, and none is lost', async t => {
  const home = setup(t, h => {
    proj(h, [wiki('~/a/notes', 'one'), wiki('~/b/notes', 'two')]);
    for (const dir of [join(h, 'work', 'proj'), join(h, 'a', 'notes'), join(h, 'b', 'notes')]) put(join(dir, 'index.md'), page(`Index of ${dir.split('/').slice(-2).join('-')}`));
  });
  const got = await read(home, ['a/notes', 'b/notes']);
  const pages = got.result.world.wikiPages.filter(p => p.title.startsWith('Index of'));
  assert.equal(pages.length, 3);
  assert.equal(new Set(pages.map(p => p.id)).size, 3, 'three ids');
  assert.ok(pages.every(p => !/-\d+$/.test(p.id)), 'no id needed a number to stay apart');
  const again = await read(home);
  assert.deepEqual(again.result.world.wikiPages.filter(p => p.title.startsWith('Index of')).map(p => p.id).sort(), pages.map(p => p.id).sort(), 'the same ids on the next read');
});

test('overlapping roots, ~/a and ~/a/b, are read once', async t => {
  const home = setup(t, h => { proj(h, [wiki('~/a', 'outer'), wiki('~/a/b', 'inner')]); put(join(h, 'a', 'x.md'), page('X')); put(join(h, 'a', 'b', 'y.md'), page('Y')); });
  assert.deepEqual(titles(await read(home, ['a', 'a/b'])), ['X', 'Y']);
});

const CAP_SETUP = (h: string): void => {
  proj(h, [wiki('~/a', 'a'), wiki('~/b', 'b'), wiki('~/c', 'c')]);
  for (const n of ['o1', 'o2']) put(join(h, 'work', 'proj', `${n}.md`), page(n));
  for (const n of ['a1', 'a2']) put(join(h, 'a', `${n}.md`), page(n));
  for (const n of ['b1', 'b2', 'b3', 'b4']) put(join(h, 'b', `${n}.md`), page(n));
  put(join(h, 'c', 'c1.md'), page('c1'));
};
const LOW: LinkedLimits = { filesPerPlace: 5, pagesPerPlace: 4 };

test('the caps hold for a place and its linked folders together; a folder that does not fit is a problem, and one with no room left is not walked', async t => {
  const home = setup(t, CAP_SETUP);
  const got = await read(home, ['a', 'b', 'c'], LOW);
  // Own pages: 2 files, so room 3 for the files and room 2 for pages. a: 2 pages, room 1. b: asked for room + 1 = 2 files, cut: 1 file fits but no page room is left. c: no room, not walked.
  assert.deepEqual(titles(got), ['a1', 'a2', 'o1', 'o2']);
  assert.deepEqual(problemsOf(got), ['limit:~/b', 'limit:~/c']);
  assert.ok(got.result.notes.includes('2 linked notes pages are not shown.'), got.result.notes.join(' | '));
  // The same cap, asked of the walk itself: nothing of c is listed.
  const budget = makeBudget(() => Date.now()), tally = newTally(), root = join(home, 'work', 'proj');
  const c = collectLinked(root, home, approvalsOf(stateOf(home)), LOW, budget, tally);
  assert.deepEqual(c.groups.map(g => [g.name, g.files.length, g.cut]), [['a', 2, false], ['b', 0, true]]);
  assert.equal(c.leftOut, 2);
});

test('the check and the read agree under low caps: a cut and a link with no room both show, and a change past the cap leaves the fingerprint as it was', async t => {
  const home = setup(t, CAP_SETUP);
  approve(home, ['a', 'b', 'c']);
  const scanner = createScanner({ home });
  const found = await scanner.addFolder(join(home, 'work'));
  const watched = found.places.map(p => ({ id: p.id, kind: p.kind, path: p.details.path }));
  const text = async (): Promise<string> => (await linkedWatchText(home, watched, { stateRoot: stateOf(home), limits: LOW })).text;
  const first = await text();
  const tag = (name: string): string => hashText(join(home, name)).slice(0, 8);
  assert.match(first, new RegExp(`l\\|${tag('b')}\\|cut`), 'b is cut');
  assert.match(first, new RegExp(`p\\|limit\\|${hashText('~/b').slice(0, 8)}`), 'the read names b');
  assert.match(first, new RegExp(`p\\|limit\\|${hashText('~/c').slice(0, 8)}`), 'c has no room, as in the read');
  assert.equal(first.includes(`l|${tag('c')}|`), false, 'a starved folder is not walked');
  assert.doesNotMatch(first, new RegExp(`l\\|${tag('a')}\\|cut`), 'a fits');
  assert.equal((await linkedWatchText(home, watched, { stateRoot: stateOf(home), limits: LOW })).complete, true);
  // b has room for one file in the files and none in the pages, so no b file is listed: any change in b past the cap changes nothing, and a change of a shows.
  writeFileSync(join(home, 'b', 'b4.md'), `${page('b4')}\nMore text that changes the size.\n`);
  assert.equal(await text(), first, 'a change past the cap changes nothing');
  writeFileSync(join(home, 'a', 'a1.md'), `${page('a1')}\nMore text that changes the size.\n`);
  assert.notEqual(await text(), first, 'a change inside the cap shows');
});

test('more than the most linked folders, an unreadable list, a missing folder and a list that is not a list are problems, not silence', async t => {
  const many = setup(t, h => { proj(h, Array.from({ length: 10 }, (_, i) => wiki(`n${i}`, `n${i}`))); for (let i = 0; i < 10; i += 1) put(join(h, 'work', 'proj', `n${i}`, 'p.md'), page(`P${i}`)); });
  assert.deepEqual(problemsOf(await read(many)), ['limit:n8', 'limit:n9']);
  const bad = setup(t, h => { put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj')); put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), '{ not json'); });
  assert.deepEqual(problemsOf(await read(bad)), ['unreadable:']);
  const shape = setup(t, h => { put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj')); put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), json({ sources: 'nope' })); });
  assert.deepEqual(problemsOf(await read(shape)), ['unreadable:']);
  const gone = setup(t, h => proj(h, [wiki('missing', 'm'), wiki('~/missing', 'n')]));
  assert.deepEqual(problemsOf(await read(gone)), ['gone:missing', 'gone:~/missing']);
  // Only the wiki folders are counted against the list limit: other kinds in front of them do not use it up.
  const kinds = setup(t, h => { proj(h, [...Array.from({ length: 250 }, (_, i) => ({ name: `k${i}`, kind: 'other', path: `k${i}` })), wiki('~/real', 'real')]); put(join(h, 'real', 'r.md'), page('R')); });
  assert.deepEqual(titles(await read(kinds, ['real'])), ['R']);
});

test('a link of another kind, a number as a path and no path are left out and harm nothing', async t => {
  const home = setup(t, h => {
    proj(h, [{ name: 'c', kind: 'wiki-folder', path: 42 }, { name: 'd', kind: 'wiki', path: '~/journal' }, { name: 'h', kind: 'wiki-folder' }]);
    put(join(h, 'journal', 'one.md'), page('One'));
  });
  const got = await read(home, ['journal']);
  assert.deepEqual(titles(got), []);
  assert.deepEqual(problemsOf(got), ['form:', 'form:']);
});

test('a problem reaches the Library: the rows name the folder and the reason, an empty tab with a problem shows it before any action, and the words are plain', async t => {
  const home = setup(t, h => { proj(h, [wiki('~/Notes', 'notes')]); put(join(h, 'Notes', 'n.md'), page('N')); });
  const got = await read(home);
  const state = realToHarnessState(got.result, got.places);
  const rows = linkProblems(state);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]!.reason, rows[0]!.label], ['approval', '~/Notes']);
  assert.match(rows[0]!.place, /^harness-/, 'the row carries the harness place, so its key is unique');
  assert.equal(linkProblemWords('~/Projects/team', 'gone', '~/Notes'), '~/Projects/team: Linked folder not found: ~/Notes');
  assert.match(linkProblemWords('x', 'approval', '~/Notes'), /Needs approval: ~\/Notes\. Link it again to approve\./);
  assert.match(linkProblemWords('x', 'damaged', '~/Notes'), /Saved approvals could not be read: ~\/Notes/);
  const empty = { kind: 'context', real: true, shown: 0, query: '' } as const;
  assert.equal(contextEmpty({ ...empty, problems: 0 }), 'link');
  assert.equal(contextEmpty({ ...empty, problems: 1 }), 'problem');
  assert.equal(contextEmpty({ ...empty, problems: 1, query: 'x' }), 'none');
  assert.equal(contextEmpty({ ...empty, kind: 'skill', problems: 1 }), 'none');
});

test('two places that each have the same problem get two rows with two keys', async t => {
  const home = setup(t, h => {
    for (const name of ['one', 'two']) { put(join(h, 'work', name, '.bowerloom', 'harness.json'), harness(name)); put(join(h, 'work', name, '.bowerloom', 'knowledge.json'), link('~/Notes')); }
    put(join(h, 'Notes', 'n.md'), page('N'));
  });
  const got = await read(home);
  const rows = linkProblems(realToHarnessState(got.result, got.places));
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(r => `${r.place}|${r.reason}|${r.label}`)).size, 2);
});

test('a damaged record of approvals is named by the Library, and the next pick moves it aside and starts a new list instead of writing over it', async t => {
  const home = setup(t, h => { proj(h, [wiki('~/journal', 'j')]); put(join(h, 'journal', 'one.md'), page('One')); });
  mkdirSync(join(stateOf(home), 'linked-notes'), { recursive: true });
  writeFileSync(approvalsFileOf(stateOf(home)), '{ damaged');
  const got = await read(home);
  assert.deepEqual(problemsOf(got), ['damaged:~/journal']);
  assert.deepEqual(titles(got), []);
  assert.equal(approveFolder(stateOf(home), join(home, 'journal')), 'kept');
  assert.deepEqual(readdirSync(join(stateOf(home), 'linked-notes')).filter(n => n.startsWith('approved.json.damaged-')).length, 1);
  assert.deepEqual(titles(await read(home)), ['One']);
});

test('an unexpected throw while the linked notes are read leaves the result as the reader made it and says so; the check becomes unresolved', async t => {
  const home = setup(t, h => { proj(h, [wiki('docs')]); put(join(h, 'work', 'proj', 'docs', 'd.md'), page('D')); });
  const scanner = createScanner({ home });
  const found = await scanner.addFolder(join(home, 'work'));
  const batch = await scanner.read(found.places.map(p => p.id));
  const built = buildRealResult(batch.reads, batch.tally, { nowMs: NOW_MS, foldExtraApps: true });
  const boom = { get filesPerPlace(): number { throw new Error('made-up failure'); }, pagesPerPlace: 4 };
  const lines: string[] = [], original = console.error;
  console.error = (line: string): void => { lines.push(String(line)); };
  try {
    const got = addLinkedNotes(built, found.places, { home, stateRoot: stateOf(home), limits: boom });
    assert.deepEqual(got.world.wikiPages, built.world.wikiPages, 'the result is as the reader made it');
    assert.deepEqual((got.harnessPlaces ?? []).flatMap(h => (h.harness as { linkProblems?: unknown[] }).linkProblems ?? []), [{ reason: 'unreadable', label: '' }]);
    const watched = found.places.map(p => ({ id: p.id, kind: p.kind, path: p.details.path }));
    assert.deepEqual(await linkedWatchText(home, watched, { stateRoot: stateOf(home), limits: boom }), { text: 'linked|unreadable', complete: false });
  } finally { console.error = original; }
  assert.equal(lines.length, 2);
  assert.ok(lines.every(l => /\(Error\)\.$/.test(l) && !l.includes('made-up failure') && !l.includes(home)), 'the class only, never the message or a path');
});

test('one dangling link is a line of the check and leaves it complete: change detection works for the rest of the read', async t => {
  const home = setup(t, h => { proj(h, [wiki('~/journal', 'j'), wiki('gone', 'g'), wiki('../../x', 'x'), wiki('~/missing', 'm')]); put(join(h, 'journal', 'one.md'), page('One')); });
  const scanner = createScanner({ home });
  const found = await scanner.addFolder(join(home, 'work'));
  const watched = found.places.map(p => ({ id: p.id, kind: p.kind, path: p.details.path }));
  const check = (): ReturnType<typeof linkedWatchText> => linkedWatchText(home, watched, { stateRoot: stateOf(home) });
  const none = await check();
  assert.match(none.text, /gone\|link\|/, 'a gone link is a line');
  assert.match(none.text, /p\|form\|/, 'a path that is not read is a line');
  assert.match(none.text, /p\|approval\|/, 'the home link waits for a pick');
  assert.equal(none.complete, true, 'a dangling link does not make the check incomplete');
  approve(home, ['journal']);
  const picked = await check();
  assert.notEqual(picked.text, none.text, 'a pick changes the check');
  assert.equal(picked.complete, true);
  assert.match(picked.text, /l\|[0-9a-f]+\|one\.md\|/);
  put(join(home, 'journal', 'two.md'), page('Two'));
  const changed = await check();
  assert.notEqual(changed.text, picked.text, 'a new page is seen although a link is gone');
  assert.equal(changed.complete, true);
  // The fingerprinter that main uses: the base answer when nothing is watched, and complete when the base is, whatever dangles.
  const base = async (): Promise<{ fingerprint: string; complete: boolean }> => ({ fingerprint: 'base', complete: true });
  const plain = await withLinkedNotes(base, { stateRoot: join(home, '.nowhere') })(home, [], undefined, undefined);
  assert.deepEqual(plain, { fingerprint: 'base', complete: true }, 'nothing watched and no record: nothing added');
  const mixed = await withLinkedNotes(base, { stateRoot: stateOf(home) })(home, watched, undefined, undefined);
  assert.notEqual(mixed.fingerprint, 'base');
  assert.equal(mixed.complete, true);
  const slow = async (): Promise<{ fingerprint: string; complete: boolean }> => ({ fingerprint: 'base', complete: false });
  assert.equal((await withLinkedNotes(slow, { stateRoot: stateOf(home) })(home, watched, undefined, undefined)).complete, false, 'an incomplete base stays incomplete');
});

test('the check of the linked folders shares the budget of the launch check: a large linked folder cannot hold it past its budget, and the check is not complete', async t => {
  const home = setup(t, h => {
    proj(h, [wiki('docs', 'docs')]);
    for (let i = 0; i < 300; i += 1) put(join(h, 'work', 'proj', 'docs', `p${String(i).padStart(3, '0')}.md`), page(`P${i}`));
  });
  const scanner = createScanner({ home });
  const found = await scanner.addFolder(join(home, 'work'));
  const watched = found.places.map(p => ({ id: p.id, kind: p.kind, path: p.details.path }));
  const base = async (): Promise<{ fingerprint: string; complete: boolean }> => ({ fingerprint: 'base', complete: true });
  // A clock that moves one millisecond at each look: the launch check has 40 of them, and the base took none of its own.
  let calls = 0;
  const clock = (): number => { calls += 1; return calls; };
  const limited = await withLinkedNotes(base, { stateRoot: stateOf(home) })(home, watched, clock, 40);
  assert.equal(limited.complete, false, 'a budget that ran out is not a complete check');
  assert.ok(calls < 200, `the walk stopped at the budget: ${calls} looks at the clock`);
  // Given time, the same walk finishes and is complete; the budget was the only difference.
  let t2 = 0;
  const roomy = await withLinkedNotes(base, { stateRoot: stateOf(home) })(home, watched, () => (t2 += 1), 1_000_000);
  assert.equal(roomy.complete, true);
  assert.notEqual(roomy.fingerprint, limited.fingerprint);
  // A budget of nothing walks nothing.
  const none = await linkedWatchText(home, watched, { stateRoot: stateOf(home), budgetMs: 0 });
  assert.equal(none.complete, false);
  assert.doesNotMatch(none.text, /l\|/);
});

test('more than the most sources of a knowledge.json is one problem row, not silence', async t => {
  const home = setup(t, h => {
    proj(h, [...Array.from({ length: 205 }, (_, i) => wiki(`n${i}`, `n${i}`))]);
    for (let i = 0; i < 205; i += 1) put(join(h, 'work', 'proj', `n${i}`, 'p.md'), page(`P${i}`));
  });
  const problems = problemsOf(await read(home));
  assert.equal(problems.filter(p => p === 'limit:').length, 1, problems.slice(-3).join(' | '));
  assert.equal(problems.filter(p => p.startsWith('limit:n')).length, 192, 'the 8 first are read, the rest up to the list limit are over the folder limit');
});
