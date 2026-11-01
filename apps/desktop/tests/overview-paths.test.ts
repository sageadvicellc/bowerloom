// How the Overview cuts a full path in a shown text down to its last name (Task 2 lane G, round 2), and the hash rule of the world check. The texts are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { overviewOf } from '../shared/harness/overview.js';
import { createSampleWorld } from '../shared/harness/sample.js';
import type { HarnessState, Part, ScanSource } from '../shared/harness/types.js';
import { generateWorld, hashText, validateWorld } from '../shared/world/sample.js';
import type { World } from '../shared/world/types.js';

/** The summary the Overview shows for a part whose summary is `text`, and its name for a part named `text`. */
function summaryOf(text: string): string {
  const part: Part = { id: 'p', kind: 'skill', name: 'P', summary: text, description: '', path: '', source: '', origin: '', fileText: '', cannotUse: [], inLibrary: true };
  const source: ScanSource = { id: 's', name: 'S', interfaceName: 'Claude Code', harnessName: 'S', partIds: ['p'], scope: 'home', label: '~' };
  const state: HarnessState = { ...createSampleWorld(), parts: [part], sources: [source], chosenSourceIds: ['s'] };
  return overviewOf(state, []).groups[0]!.nodes[0]!.summary;
}

const CASES: readonly (readonly [string, string, string])[] = [
  ['a file URL', 'Reads file:///Users/hanna/secret/x now', 'Reads …/x now'],
  ['a file URL in brackets', 'See (file:///Users/hanna/secret/x)', 'See (…/x)'],
  ['square brackets', 'Saved [/Users/hanna/x/y] ok', 'Saved […/y] ok'],
  ['angle brackets with back slashes', 'Opens <\\Users\\hanna\\x> now', 'Opens <…/x> now'],
  ['curly brackets', 'Set {/Users/hanna/x/y}', 'Set {…/y}'],
  ['after a bar and before an arrow', 'a|/Users/hanna/x/y|b >/Users/hanna/x/z<', 'a|…/y|b >…/z<'],
  ['a UNC path', 'Copy \\\\server\\share\\x to it', 'Copy …/x to it'],
  ['a UNC path with two names', 'Copy \\\\server\\share to it', 'Copy …/share to it'],
  ['a drive path with back slashes', 'Opens C:\\Users\\hanna\\Documents\\a.md.', 'Opens …/a.md.'],
  ['a drive path with forward slashes', 'Opens D:/work/a/b', 'Opens …/b'],
  ['a space in the home folder name', 'In /Users/Hanna Sage/Documents/x here', 'In …/x here'],
  ['a space in a middle name', 'In /Users/hanna/Sage Advice/code now', 'In …/code now'],
  ['a space on a drive path', 'In C:\\Users\\Hanna Sage\\Program Files\\x now', 'In …/x now'],
  ['the home folder on its own (macOS)', 'Lives in /Users/hanna, ok', 'Lives in ~, ok'],
  ['the home folder on its own (Linux)', 'Lives in /home/hanna now', 'Lives in ~ now'],
  ['the home folder on its own (Windows)', 'Lives in C:\\Users\\hanna now', 'Lives in ~ now'],
  ['the home folder with a space in its name', 'Lives in /Users/Hanna Sage now', 'Lives in ~ now'],
  ['the home folder with a closing slash', 'Lives in /Users/hanna/ now', 'Lives in ~ now'],
  ['a home folder name with a lowercase second word (macOS)', 'In /Users/my projects/x now', 'In …/x now'],
  ['a home folder name with a lowercase word and a longer tail', 'In /Users/hanna smith/x/y now', 'In …/y now'],
  ['a home folder name with a lowercase word (Windows)', 'In C:\\Users\\my docs\\x now', 'In …/x now'],
  ['a home folder name with a lowercase word (Linux)', 'In /home/jo ann/x now', 'In …/x now'],
  ['a home folder name with an accent', 'In /Users/éva dupont/x now', 'In …/x now'],
  ['a home folder name under another folder', 'In /Volumes/Data/Users/hanna smith/x now', 'In …/x now'],
  ['a home folder name with a lowercase word in a file URL', 'In file:///Users/my docs/x now', 'In …/x now'],
  ['a home folder name of four words', 'In /Users/a b c d/x now', 'In …/x now'],
  ['a home folder name and then a path, kept as two paths', 'Lives in /Users/hanna and /etc/hosts', 'Lives in ~ and …/hosts'],
  ['a home folder with a comma after it and then a path', 'Lives in /Users/hanna, then /etc/hosts', 'Lives in ~, then …/hosts'],
  ['a home folder name in quotes', 'Set "/Users/my docs/x" and "/Users/hanna smith/y"', 'Set "…/x" and "…/y"'],
  ['the end of a sentence after a bare home folder', 'See /Users/hanna. Next we go', 'See ~. Next we go'],
  ['an exclamation mark after a bare home folder', 'See /Users/hanna! Then we go', 'See ~! Then we go'],
  ['a question mark after a path', 'Is it /etc/hosts? Yes', 'Is it …/hosts? Yes'],
  ['a full stop after a long path', 'Read /Users/a/b/notes. Then stop', 'Read …/notes. Then stop'],
  ['a full stop after a drive path', 'Read C:\\work\\a\\notes!', 'Read …/notes!'],
  ['two paths in one text', 'Reads /Users/a/notes and then /etc/hosts', 'Reads …/notes and then …/hosts'],
  ['a path after an equals sign and a colon', 'path=/Users/a/b, home:/home/a/c', 'path=…/b, home:…/c'],
];

for (const [name, text, want] of CASES) {
  test(`a full path is cut down: ${name}`, () => {
    assert.equal(summaryOf(text), want);
    assert.doesNotMatch(summaryOf(text), /hanna|Hanna|Sage|someone|server/, 'no home folder name or host survives');
  });
}

test('texts that are not full paths are left as they are', () => {
  for (const text of ['and/or', 'read/write', 'a/b/c style', '1/2/3 of 4/5/6', 'https://example.com/a/b/c', '~/Projects/alpha/x', '~ and ~/notes', 'Use /compact first', 'Step 1/2', 'See Users/hanna/x']) {
    assert.equal(summaryOf(text), text);
  }
});

test('the limits of the home folder rule: more than four words, or more than sixty characters, are left to the plain rule, and a bare home folder keeps its own rule', () => {
  // Five words: the name is not cut as a whole. The plain rule still cuts what it can read as a path, and never keeps a path with two or more names.
  assert.equal(summaryOf('In /Users/a b c d e/x now'), 'In ~ b c d e/x now');
  const long = 'x'.repeat(61);
  assert.equal(summaryOf(`In /Users/${long}/y now`), 'In …/y now');
  assert.equal(summaryOf(`In /Users/${'x'.repeat(60)}/y now`), 'In …/y now');
  // A bare home folder (no separator after it): the capital-word rule of before.
  assert.equal(summaryOf('In /Users/my docs now'), 'In ~ docs now');
  assert.equal(summaryOf('In /Users/Hanna Sage now'), 'In ~ now');
});

test('two false hits are known and kept: a web request line and a letter before a colon and a slash read as paths', () => {
  assert.equal(summaryOf('GET /v1/messages'), 'GET …/messages');
  assert.equal(summaryOf('a:/b'), '…/b');
});

test('a long text with many slashes and spaces is cut in linear time', () => {
  const text = `${'/Aa Bb'.repeat(3000)} and ${'x/'.repeat(3000)}`;
  const start = performance.now();
  summaryOf(text);
  assert.ok(performance.now() - start < 500);
});

test('a name and a label are cut the same way', () => {
  const part: Part = { id: 'p', kind: 'skill', name: 'Open /Users/Hanna Sage/Documents/x', summary: '', description: '', path: '', source: '', origin: '', fileText: '', cannotUse: [], inLibrary: true };
  const sources: ScanSource[] = [
    { id: 's', name: 'In /Users/hanna', interfaceName: 'Claude Code', harnessName: 'S', partIds: ['p'], scope: 'project', label: '/Users/Hanna Sage/Projects/alpha' },
    { id: 't', name: 'T', interfaceName: 'Claude Code', harnessName: 'T', partIds: [], scope: 'project', label: 'file:///Users/hanna/Projects/beta' },
    { id: 'u', name: 'U', interfaceName: 'Claude Code', harnessName: 'U', partIds: [], scope: 'project', label: '/Users/hanna' },
  ];
  const o = overviewOf({ ...createSampleWorld(), parts: [part], sources, chosenSourceIds: [] }, []);
  assert.equal(o.groups.find(g => g.id === 's')!.nodes[0]!.name, 'Open …/x');
  assert.equal(o.groups.find(g => g.id === 's')!.name, 'In ~');
  assert.equal(o.groups.find(g => g.id === 's')!.label, '…/alpha');
  assert.equal(o.groups.find(g => g.id === 't')!.label, '…/beta');
  assert.equal(o.groups.find(g => g.id === 'u')!.label, '~');
  assert.doesNotMatch(JSON.stringify(o), /hanna|Hanna|Sage/);
});

// ---- the hash rule of the world check

test('validateWorld accepts an empty hash (a file with no readable text) and a cut text with the hash of the longer text, and refuses the rest', () => {
  const edit = (change: (w: { -readonly [K in keyof World]: World[K] }) => void): string[] => { const w = structuredClone(generateWorld(1)) as { -readonly [K in keyof World]: World[K] }; change(w); return validateWorld(w); };
  const found = (w: World) => w.items.find(i => i.foundAt.length > 0)!.foundAt[0]! as { contentHash: string; text: string };
  assert.deepEqual(edit(() => undefined), []);
  assert.deepEqual(edit(w => { found(w).contentHash = ''; }), [], 'an empty hash');
  assert.deepEqual(edit(w => { const f = found(w); f.text = `${f.text}\n… [cut: 5000 characters in all]`; f.contentHash = hashText('the whole, longer text'); }), [], 'a cut text with the hash of the whole text');
  assert.ok(edit(w => { found(w).contentHash = 'bad'; }).some(p => / has a wrong hash in /.test(p)), 'a bad hash');
  assert.ok(edit(w => { found(w).contentHash = hashText('some other text'); }).some(p => / has a wrong hash in /.test(p)), 'a hash of other text on an uncut text');
  assert.ok(edit(w => { const f = found(w); f.text = `${f.text}\n… [cut: 5000 characters in all]`; f.contentHash = 'not a hash'; }).some(p => / has a wrong hash in /.test(p)), 'a cut text with a hash of the wrong shape');
});
