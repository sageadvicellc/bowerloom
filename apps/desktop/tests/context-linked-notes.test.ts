// Context items (beta.2 Context page): the pages of a notes folder the person linked to a harness. They run on small homes made here and never read the real HOME.
// The harness package stores a linked folder as `.` (the harness folder), a path below it, or `~/` and a path below the home folder; those are the forms the reader takes.
// Cause 1: the automatic notes walk never runs for the home folder and stops at any subfolder with a tool folder, and a linked folder (knowledge.json) was never walked at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner, findPlacesUnder, readPlace, watchTextOf } from '../main/real-scan.js';
import { approvalKey } from '../shared/real/linked-approvals.js';
import { approvalsFileOf, isApproved, recordApprovals } from '../main/linked-approvals.js';
import { makeBudget, newTally } from '../main/real-fs.js';
import { storedKnowledgePath } from '../../../packages/harness-definition/src/index.js';
import { realToHarnessState } from '../shared/harness/real-map.js';
import { contextEmpty, linkProblems } from '../shared/harness/library-add.js';
import { linkProblemWords } from '../renderer/harness/words.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { tempDir } from './support.js';

const NOW_MS = Date.UTC(2026, 10, 11);
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const harness = (id: string): string => json({ format: 'bowerloom/harness/v1beta1', id, description: 'A harness.', engines: [{ id: 'claude-code' }], parts: { skills: 'skills/', subagents: 'agents/' } });
const page = (title: string): string => `# ${title}\n\nA page about ${title}.\n`;
const link = (path: string, name = 'journal'): string => json({ sources: [{ name, kind: 'wiki-folder', path }] });

/** The private state folder of a made-up home: the approvals of linked home folders are kept below it. */
const stateOf = (home: string): string => join(home, '.made-up-state');
/** `approved` lists `[harness folder below home, stored path]`: what the person approved in the link flow. */
type Approved = readonly (readonly [string, string])[];
const approve = (home: string, approved: Approved): void => { for (const [folder, stored] of approved) assert.equal(recordApprovals(stateOf(home), join(home, folder), [stored]), true); };
async function read(home: string, approved: Approved = []): Promise<{ result: RealResult; places: readonly RealPlace[]; reads: Awaited<ReturnType<ReturnType<typeof createScanner>['read']>>['reads'] }> {
  approve(home, approved);
  const scanner = createScanner({ home, approvalsFile: approvalsFileOf(stateOf(home)) });
  const found = await scanner.discover();
  const places: RealPlace[] = [...found.places, ...(await scanner.addFolder(join(home, 'work'))).places];
  const batch = await scanner.read(places.map(p => p.id));
  return { result: buildRealResult(batch.reads, batch.tally, { nowMs: NOW_MS, foldExtraApps: true }), places, reads: batch.reads };
}
const problemsOf = (r: Awaited<ReturnType<typeof read>>): string[] => r.reads.flatMap(x => x.harness?.linkProblems ?? []).map(p => `${p.reason}:${p.label}`);
const titles = (r: RealResult): string[] => r.world.wikiPages.map(p => p.title).sort();
const sliceNames = (r: RealResult): string[] => r.world.items.filter(i => i.kind === 'context-slice').map(i => i.name);
const setup = (t: TestContext, make: (home: string) => void): string => { const home = tempDir(t, 'bowerloom-ctx-'); make(home); return home; };

test('a wiki under the home folder that a harness links shows its pages as context items', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), link('~/journal'));
    put(join(h, 'journal', 'one.md'), page('One'));
    put(join(h, 'journal', 'deep', 'two.md'), page('Two'));
  });
  const { result } = await read(home, [['work/proj', '~/journal']]);
  assert.deepEqual(titles(result), ['One', 'Two']);
  assert.ok(sliceNames(result).length > 0, `a context item: ${sliceNames(result).join(', ')}`);
  assert.equal(result.counts.notes, 2);
});

test('a notes folder in the home folder that nothing links is never read on its own', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'journal', 'one.md'), page('One'));
    put(join(h, 'Documents', 'two.md'), page('Two'));
  });
  const { result } = await read(home);
  assert.deepEqual(titles(result), []);
  assert.deepEqual(sliceNames(result), []);
});

test('a linked folder is read even when a subfolder holds a tool folder', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), link('~/journal'));
    put(join(h, 'journal', 'top.md'), page('Top'));
    put(join(h, 'journal', 'sub', '.claude', 'settings.json'), '{}\n');
    put(join(h, 'journal', 'sub', 'inside.md'), page('Inside'));
  });
  const { result } = await read(home, [['work/proj', '~/journal']]);
  assert.deepEqual(titles(result), ['Inside', 'Top']);
});

test('a link that is not a stored form, is gone, has no path, is hidden, or is not a wiki folder is left out and harms nothing', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), json({ sources: [
      { name: 'a', kind: 'wiki-folder', path: join(h, 'journal') }, { name: 'b', kind: 'wiki-folder', path: '~/missing' }, { name: 'c', kind: 'wiki-folder', path: 42 }, { name: 'd', kind: 'wiki', path: '~/journal' },
      { name: 'e', kind: 'wiki-folder', path: '~/.hidden' }, { name: 'f', kind: 'wiki-folder', path: '~/../outside' }, { name: 'g', kind: 'wiki-folder', path: '../../journal' }, { name: 'h', kind: 'wiki-folder' },
    ] }));
    put(join(h, 'journal', 'one.md'), page('One'));
    put(join(h, '.hidden', 'secret.md'), page('Secret'));
    put(join(h, 'work', 'proj', 'own.md'), page('Own'));
  });
  const { result } = await read(home);
  assert.deepEqual(titles(result), ['Own'], 'only the place\'s own notes; no link of these shapes is read');
});

test('a linked folder with the same pages as the place is counted once, and the cap on pages holds', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), json({ sources: [
      { name: 'self', kind: 'wiki-folder', path: '.' }, { name: 'j', kind: 'wiki-folder', path: '~/journal' }, { name: 'again', kind: 'wiki-folder', path: '~/journal' },
    ] }));
    put(join(h, 'work', 'proj', 'own.md'), page('Own'));
    put(join(h, 'journal', 'one.md'), page('One'));
  });
  const { result } = await read(home, [['work/proj', '~/journal']]);
  assert.deepEqual(titles(result), ['One', 'Own']);
});

test('a shortcut inside a linked folder that leads out of it is not followed', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), link('~/journal'));
    put(join(h, 'journal', 'one.md'), page('One'));
    put(join(h, 'secret', 'out.md'), page('Out'));
    symlinkSync(join(h, 'secret'), join(h, 'journal', 'leak'));
  });
  const { result } = await read(home, [['work/proj', '~/journal']]);
  assert.deepEqual(titles(result), ['One']);
});

test('a folder that holds its own harness and is linked to itself is read whole, below a subfolder with a tool folder too', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'wiki', '.bowerloom', 'harness.json'), harness('wiki'));
    put(join(h, 'work', 'wiki', '.bowerloom', 'knowledge.json'), link('.', 'wiki'));
    put(join(h, 'work', 'wiki', 'index.md'), page('Index'));
    put(join(h, 'work', 'wiki', 'deep', '.claude', 'settings.json'), '{}\n');
    put(join(h, 'work', 'wiki', 'deep', 'inside.md'), page('Inside'));
  });
  const { result } = await read(home);
  // `deep` is a place of its own too, so the page is told apart by the set it belongs to: the wiki's, not the work folder's.
  assert.ok(result.world.wikiPages.some(p => p.title === 'Inside' && p.folder === 'wiki/deep'), result.world.wikiPages.map(p => `${p.folder}:${p.title}`).join(', '));
  assert.ok(titles(result).includes('Index'));
});

// ---- review round 1: approval, refusal table, round trip, ids, overlap, caps, problems

const proj = (h: string, sources: unknown): void => {
  put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
  put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), json({ sources }));
};
const wiki = (path: string, name = 'journal'): { name: string; kind: string; path: string } => ({ name, kind: 'wiki-folder', path });

test('a link in ~/ form is read only after the person approved it for that folder and path; until then it is a problem that says so', async t => {
  const home = setup(t, h => { proj(h, [wiki('~/journal')]); put(join(h, 'journal', 'one.md'), page('One')); });
  const before = await read(home);
  assert.deepEqual(titles(before.result), []);
  assert.deepEqual(problemsOf(before), ['approval:~/journal']);
  // Approved for another harness folder, or for another path, is not approved here.
  assert.equal(recordApprovals(stateOf(home), join(home, 'work'), ['~/journal']), true);
  assert.equal(recordApprovals(stateOf(home), join(home, 'work', 'proj'), ['~/other']), true);
  assert.deepEqual(problemsOf(await read(home)), ['approval:~/journal']);
  const after = await read(home, [['work/proj', '~/journal']]);
  assert.deepEqual(titles(after.result), ['One']);
  assert.deepEqual(problemsOf(after), []);
});

test('a link below the harness folder is part of the project and needs no approval', async t => {
  const home = setup(t, h => { proj(h, [wiki('docs')]); put(join(h, 'work', 'proj', 'docs', 'sub', '.claude', 'settings.json'), '{}\n'); put(join(h, 'work', 'proj', 'docs', 'sub', 'deep.md'), page('Deep')); });
  const got = await read(home);
  assert.ok(titles(got.result).includes('Deep'), titles(got.result).join(', '));
  assert.deepEqual(problemsOf(got), []);
});

// One case for each shape the reader must refuse. The decoy pages sit where the path would lead if it were followed.
const REFUSED: readonly (readonly [string, string])[] = [
  ['home alone: ~/', '~/'], ['home alone: ~/.', '~/.'], ['home alone: ~//', '~//'], ['dot segment: ./x', './x'], ['dotdot inside: a/../b', 'a/../b'], ['dotdot after: ~/a/..', '~/a/..'],
  ['other user: ~foo', '~foo'], ['drive letter', 'C:\\x'], ['backslash', 'a\\b'], ['absolute', '/etc'], ['hidden segment: ~/.hidden', '~/.hidden'], ['hidden below: ~/a/.b', '~/a/.b'], ['hidden relative: .hid/x', '.hid/x'],
  ['empty', ''],
];
for (const [name, stored] of REFUSED) {
  test(`refused shape, ${name}: nothing is read and the problem says the path is not read`, async t => {
    const home = setup(t, h => {
      proj(h, [wiki(stored)]);
      put(join(h, 'top.md'), page('Top')); put(join(h, 'a', 'b.md'), page('AB')); put(join(h, '.hidden', 'secret.md'), page('Secret')); put(join(h, 'work', 'proj', '.hid', 'x', 'h.md'), page('Hid'));
    });
    const got = await read(home, stored === '' ? [] : [['work/proj', stored] as const]);
    assert.deepEqual(titles(got.result).filter(x => ['Top', 'AB', 'Secret', 'Hid'].includes(x)), [], `no decoy page for ${JSON.stringify(stored)}`);
    assert.equal(problemsOf(got).length, 1, problemsOf(got).join(' | '));
    assert.match(problemsOf(got)[0]!, /^form:/);
  });
}

test('refused shape, a shortcut that leaves its base: ~/notes to a hidden folder, to a folder outside home, and a relative one to the home folder', async t => {
  const home = setup(t, h => {
    proj(h, [wiki('~/tossh', 'a'), wiki('~/tooutside', 'b'), wiki('tohome', 'c')]);
    put(join(h, '.ssh', 'key.md'), page('Key'));
    put(join(dirname(h), `${h.split('/').pop()}-outside`, 'out.md'), page('Out'));
    symlinkSync(join(h, '.ssh'), join(h, 'tossh'));
    symlinkSync(join(dirname(h), `${h.split('/').pop()}-outside`), join(h, 'tooutside'));
    symlinkSync(h, join(h, 'work', 'proj', 'tohome'));
    put(join(h, 'top.md'), page('Top'));
  });
  t.after(() => rmSync(join(dirname(home), `${home.split('/').pop()}-outside`), { recursive: true, force: true }));
  const got = await read(home, [['work/proj', '~/tossh'], ['work/proj', '~/tooutside']]);
  assert.deepEqual(titles(got.result).filter(x => ['Key', 'Out', 'Top'].includes(x)), []);
  assert.deepEqual(problemsOf(got), ['form:~/tossh', 'form:~/tooutside', 'form:tohome']);
});

test('each form is read: `.`, a path below the harness folder, and ~/ with approval', async t => {
  const home = setup(t, h => {
    proj(h, [wiki('.', 'self'), wiki('docs', 'docs'), wiki('~/journal', 'journal')]);
    put(join(h, 'work', 'proj', 'own.md'), page('Own')); put(join(h, 'work', 'proj', 'docs', 'd.md'), page('D')); put(join(h, 'journal', 'j.md'), page('J'));
  });
  const got = await read(home, [['work/proj', '~/journal']]);
  assert.deepEqual(titles(got.result), ['D', 'J', 'Own']);
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
  const got = await read(home, stored.filter(x => x.startsWith('~/')).map(x => ['work/proj', x] as const));
  assert.deepEqual(problemsOf(got), [], 'each stored path was read');
  for (const want of ['Docs', 'Own', 'Journal']) assert.ok(titles(got.result).includes(want), `${want} in ${titles(got.result).join(', ')}`);
});

test('a page of the same file name in the place and in two linked folders keeps its own id, and none is lost', async t => {
  const home = setup(t, h => {
    proj(h, [wiki('~/a/notes', 'one'), wiki('~/b/notes', 'two')]);
    for (const dir of [join(h, 'work', 'proj'), join(h, 'a', 'notes'), join(h, 'b', 'notes')]) put(join(dir, 'index.md'), page(`Index of ${dir.split('/').slice(-2).join('-')}`));
  });
  const got = await read(home, [['work/proj', '~/a/notes'], ['work/proj', '~/b/notes']]);
  const pages = got.result.world.wikiPages.filter(p => p.title.startsWith('Index of'));
  assert.equal(pages.length, 3);
  assert.equal(new Set(pages.map(p => p.id)).size, 3, 'three ids');
  assert.ok(pages.every(p => !/-\d+$/.test(p.id)), 'no id needed a number to stay apart');
  // The ids of the same read do not change from one run to the next.
  const again = await read(home);
  assert.deepEqual(again.result.world.wikiPages.filter(p => p.title.startsWith('Index of')).map(p => p.id).sort(), pages.map(p => p.id).sort());
});

test('overlapping roots, ~/a and ~/a/b, are read once', async t => {
  const home = setup(t, h => {
    proj(h, [wiki('~/a', 'outer'), wiki('~/a/b', 'inner')]);
    put(join(h, 'a', 'x.md'), page('X')); put(join(h, 'a', 'b', 'y.md'), page('Y'));
  });
  const got = await read(home, [['work/proj', '~/a'], ['work/proj', '~/a/b']]);
  assert.deepEqual(titles(got.result), ['X', 'Y']);
});

test('the caps hold for a place and its linked folders together; a folder that does not fit is a problem, and one with no room left is not walked', async t => {
  const home = setup(t, h => {
    proj(h, [wiki('~/a', 'a'), wiki('~/b', 'b'), wiki('~/c', 'c')]);
    for (const n of ['o1', 'o2']) put(join(h, 'work', 'proj', `${n}.md`), page(n));
    for (const n of ['a1', 'a2']) put(join(h, 'a', `${n}.md`), page(n));
    for (const n of ['b1', 'b2', 'b3', 'b4']) put(join(h, 'b', `${n}.md`), page(n));
    put(join(h, 'c', 'c1.md'), page('c1'));
  });
  const budget = makeBudget(() => Date.now()), tally = newTally();
  const place = findPlacesUnder(join(home, 'work'), home, budget, tally).find(p => p.label === 'proj')!;
  assert.ok(place, 'the harness folder is a place');
  const approved = new Set(['~/a', '~/b', '~/c'].map(x => approvalKey(place.realRoot, x)));
  const got = readPlace(place, home, true, budget, { approved, limits: { filesPerPlace: 5, pagesPerPlace: 4 } });
  // Own pages: 2 files, so room 3 for files and room 2 for pages. a: 2 pages, room 1. b: asked for room + 1 = 2 files, cut: 1 file fits but no page room is left. c: no room, not walked.
  assert.equal(got.notes.length, 4);
  assert.deepEqual(got.notes.map(n => n.title).sort(), ['a1', 'a2', 'o1', 'o2']);
  assert.deepEqual(got.harness?.linkProblems?.map(p => `${p.reason}:${p.label}`), ['limit:~/b', 'limit:~/c']);
  assert.equal(got.notesLeftOut, 2, 'one file cut by the file cap, one that fits the files but not the pages');
});

test('more than the most linked folders, an unreadable list, a missing folder and a list that is not a list are problems, not silence', async t => {
  const many = setup(t, h => {
    proj(h, Array.from({ length: 10 }, (_, i) => wiki(`n${i}`, `n${i}`)));
    for (let i = 0; i < 10; i += 1) put(join(h, 'work', 'proj', `n${i}`, 'p.md'), page(`P${i}`));
  });
  const got = await read(many);
  assert.deepEqual(problemsOf(got), ['limit:n8', 'limit:n9']);
  const bad = setup(t, h => { put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj')); put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), '{ not json'); });
  assert.deepEqual(problemsOf(await read(bad)), ['unreadable:']);
  const shape = setup(t, h => { put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj')); put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), json({ sources: 'nope' })); });
  assert.deepEqual(problemsOf(await read(shape)), ['unreadable:']);
  const gone = setup(t, h => proj(h, [wiki('missing', 'm')]));
  assert.deepEqual(problemsOf(await read(gone)), ['gone:missing']);
  // Only the wiki folders are counted against the list limit: other kinds in front of them do not use it up.
  const kinds = setup(t, h => { proj(h, [...Array.from({ length: 250 }, (_, i) => ({ name: `k${i}`, kind: 'other', path: `k${i}` })), wiki('~/real', 'real')]); put(join(h, 'real', 'r.md'), page('R')); });
  assert.deepEqual(titles((await read(kinds, [['work/proj', '~/real']])).result), ['R']);
});

test('a problem reaches the Library: the rows name the folder and the reason, an empty tab with a problem shows it before any action, and the words are plain', async t => {
  const home = setup(t, h => { proj(h, [wiki('~/Notes', 'notes')]); put(join(h, 'Notes', 'n.md'), page('N')); });
  const got = await read(home);
  const state = realToHarnessState(got.result, got.places);
  const rows = linkProblems(state);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0]!.reason, rows[0]!.label], ['approval', '~/Notes']);
  assert.equal(linkProblemWords('~/Projects/team', 'gone', '~/Notes'), '~/Projects/team: Linked folder not found: ~/Notes');
  assert.match(linkProblemWords('x', 'approval', '~/Notes'), /Needs approval: ~\/Notes\. Link it again to approve\./);
  const empty = { kind: 'context', real: true, shown: 0, query: '' } as const;
  assert.equal(contextEmpty({ ...empty, problems: 0 }), 'link');
  assert.equal(contextEmpty({ ...empty, problems: 1 }), 'problem');
  assert.equal(contextEmpty({ ...empty, problems: 1, query: 'x' }), 'none');
  assert.equal(contextEmpty({ ...empty, kind: 'skill', problems: 1 }), 'none');
});

test('the approval record: kept per harness folder and path, read back, and a damaged or missing record approves nothing', async t => {
  const home = setup(t, h => { put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj')); });
  const state = stateOf(home), proj1 = join(home, 'work', 'proj');
  assert.equal(isApproved(state, proj1, '~/a'), false);
  assert.equal(recordApprovals(state, proj1, ['~/a', '~/b']), true);
  assert.equal(recordApprovals(state, proj1, ['~/c']), true);
  assert.deepEqual(['~/a', '~/b', '~/c', '~/d'].map(p => isApproved(state, proj1, p)), [true, true, true, false]);
  assert.equal(isApproved(state, join(home, 'work'), '~/a'), false);
  writeFileSync(approvalsFileOf(state), '{ damaged');
  assert.equal(isApproved(state, proj1, '~/a'), false);
});

test('a change in a linked folder shows as a change of the place, a link that is gone is unresolved, and a missing record changes nothing', async t => {
  const home = setup(t, h => { proj(h, [wiki('~/journal', 'j'), wiki('gone', 'g')]); put(join(h, 'journal', 'one.md'), page('One')); });
  approve(home, [['work/proj', '~/journal']]);
  const scanner = createScanner({ home, approvalsFile: approvalsFileOf(stateOf(home)) });
  const found = await scanner.addFolder(join(home, 'work'));
  const watched = found.places.map(p => ({ id: p.id, kind: p.kind, path: p.details.path }));
  const first = await watchTextOf(home, watched, undefined, undefined, approvalsFileOf(stateOf(home)));
  assert.match(first.text, /gone\|link\|/);
  assert.equal(first.complete, false, 'a stored link that fails leaves the check unresolved');
  put(join(home, 'journal', 'two.md'), page('Two'));
  const second = await watchTextOf(home, watched, undefined, undefined, approvalsFileOf(stateOf(home)));
  assert.notEqual(first.text.replace(/unfinished\|[^\n]*/g, ''), second.text.replace(/unfinished\|[^\n]*/g, ''));
  assert.match(second.text, /l\|[0-9a-f]+\|two\.md\|/);
});
