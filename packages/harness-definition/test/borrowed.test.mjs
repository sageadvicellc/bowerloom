// Notes lane W1: the edits a ready-made kit needs. `add-agent` writes a new agent file, `set-borrowed` records where borrowed
// items came from in `sources.json`, with a pinned version, and `remove-borrowed` drops that record. Synthetic values only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EDIT_KINDS, editDefinition, loadDefinition, loadDefinitionFiles } from '../../../dist/packages/harness-definition/src/index.js';
import { agent, cleanup, fullFiles, harness, json, makeDefinition, skill } from './fixture.mjs';

test.after(cleanup);

const load = files => {
  const r = loadDefinition(makeDefinition(files));
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return r.definition;
};
const done = (def, edits) => {
  const r = editDefinition(def, edits);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r));
  return r;
};
const refused = (def, edits, code) => {
  const r = editDefinition(def, edits);
  assert.equal(r.ok, false, 'the edit should be refused');
  assert.equal(r.code, code, JSON.stringify(r));
  return r;
};
const text = (r, p) => Buffer.from(r.files.find(f => f.path === p).bytes).toString('utf8');
const reload = r => {
  const l = loadDefinitionFiles(r.files);
  assert.equal(l.ok, true, JSON.stringify(l.ok ? null : l.problems));
  return l.definition;
};

/** A harness with instructions and one skill, and no agents, no sources.json. */
const small = () => ({
  'harness.json': harness({ parts: { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/' } }),
  'instructions/AGENTS.md': '# Small\n',
  'skills/outline/SKILL.md': skill('outline', 'Outlines a draft.'),
});
const KIT = { name: 'notes-kit', marketplace: 'bowerloom-kits', version: '0.1.0', items: [{ part: 'subagents', id: 'keeper' }, { part: 'skills', id: 'file-page' }] };

test('EDIT_KINDS holds the kit edits after the knowledge edits', () => {
  assert.deepEqual([...EDIT_KINDS], ['set-skill', 'add-skill', 'remove-skill', 'set-agent', 'set-instructions', 'set-engines', 'set-source', 'remove-source', 'add-agent', 'set-borrowed', 'remove-borrowed']);
});

test('add-agent writes a new agent file and lists the agents part when it was not listed', () => {
  const def = load(small());
  const r = done(def, [{ kind: 'add-agent', id: 'keeper', text: agent('keeper', 'skills:\n  - outline\n') }]);
  assert.deepEqual(r.changes, [{ path: 'agents/keeper.md', kind: 'create' }, { path: 'harness.json', kind: 'update' }]);
  assert.equal(JSON.parse(text(r, 'harness.json')).parts.subagents, 'agents/');
  assert.deepEqual(reload(r).entries.subagents.map(a => [a.id, a.skills]), [['keeper', ['outline']]]);
});

test('add-agent refuses an agent that exists, an unsafe id, and a text that does not load', () => {
  const def = load(fullFiles());
  refused(def, [{ kind: 'add-agent', id: 'reader', text: agent('reader') }], 'EDIT_DUPLICATE_ID');
  refused(def, [{ kind: 'add-agent', id: '../x', text: agent('x') }], 'EDIT_UNSAFE_ID');
  refused(def, [{ kind: 'add-agent', id: 'keeper', text: 'no frontmatter here\n' }], 'EDIT_INVALID');
  refused(def, [{ kind: 'add-agent', id: 'keeper', text: agent('keeper', 'tools:\n  - teleport\n') }], 'EDIT_INVALID');
  refused(def, [{ kind: 'add-agent', id: 'keeper', text: agent('other') }], 'EDIT_INVALID');
  refused(def, [{ kind: 'add-agent', id: 'keeper' }], 'EDIT_BAD_EDIT');
});

test('set-borrowed creates sources.json with a pinned record and lists the plugins part', () => {
  const def = load(small());
  const r = done(def, [
    { kind: 'add-skill', id: 'file-page', text: skill('file-page', 'Files a page.') },
    { kind: 'add-agent', id: 'keeper', text: agent('keeper', 'skills:\n  - file-page\n') },
    { kind: 'set-borrowed', source: KIT },
  ]);
  assert.deepEqual(r.changes.map(c => [c.path, c.kind]), [['agents/keeper.md', 'create'], ['harness.json', 'update'], ['skills/file-page/SKILL.md', 'create'], ['sources.json', 'create']]);
  assert.equal(JSON.parse(text(r, 'harness.json')).parts.plugins, 'sources.json');
  assert.deepEqual(JSON.parse(text(r, 'sources.json')), { sources: [KIT] });
  assert.deepEqual(reload(r).sources, [KIT]);
});

test('set-borrowed replaces the record of the same name in place and keeps every other record and the adopted list', () => {
  const def = load(fullFiles({ 'skills/file-page/SKILL.md': skill('file-page', 'Files a page.') }));
  const first = done(def, [{ kind: 'set-borrowed', source: { ...KIT, items: [{ part: 'skills', id: 'file-page' }] } }]);
  assert.deepEqual(JSON.parse(text(first, 'sources.json')).sources.map(s => s.name), ['review-kit', 'notes-kit']);
  const again = done(reload(first), [{ kind: 'set-borrowed', source: { ...KIT, version: '0.2.0', items: [{ part: 'skills', id: 'file-page' }] } }]);
  assert.deepEqual(JSON.parse(text(again, 'sources.json')).sources.map(s => [s.name, s.version]), [['review-kit', '1.2.0'], ['notes-kit', '0.2.0']]);
});

test('set-borrowed refuses a range, an item the folder does not hold, and a malformed record', () => {
  const def = load(small());
  refused(def, [{ kind: 'set-borrowed', source: { ...KIT, version: '^0.1.0', items: [{ part: 'skills', id: 'outline' }] } }], 'EDIT_INVALID');
  refused(def, [{ kind: 'set-borrowed', source: KIT }], 'EDIT_INVALID');
  refused(def, [{ kind: 'set-borrowed', source: { name: 'x' } }], 'EDIT_BAD_EDIT');
  refused(def, [{ kind: 'set-borrowed', source: { ...KIT, path: '/x' } }], 'EDIT_BAD_EDIT');
  refused(def, [{ kind: 'set-borrowed', source: { ...KIT, items: [] } }], 'EDIT_BAD_EDIT');
  refused(def, [{ kind: 'set-borrowed', source: { ...KIT, items: [{ part: 'skills', id: 'outline', extra: 1 }] } }], 'EDIT_BAD_EDIT');
});

test('remove-borrowed drops the record; the last record gone deletes sources.json and its pointer, unless adopted skills keep it', () => {
  const def = load(small());
  const added = reload(done(def, [{ kind: 'set-borrowed', source: { ...KIT, items: [{ part: 'skills', id: 'outline' }] } }]));
  const r = done(added, [{ kind: 'remove-borrowed', name: 'notes-kit' }]);
  assert.equal(r.files.some(f => f.path === 'sources.json'), false);
  assert.equal(JSON.parse(text(r, 'harness.json')).parts.plugins, undefined);
  refused(added, [{ kind: 'remove-borrowed', name: 'ghost' }], 'EDIT_UNKNOWN_ID');
  // With a record left, the file stays.
  const full = load(fullFiles({ 'skills/file-page/SKILL.md': skill('file-page', 'Files a page.') }));
  const two = reload(done(full, [{ kind: 'set-borrowed', source: { ...KIT, items: [{ part: 'skills', id: 'file-page' }] } }]));
  const one = done(two, [{ kind: 'remove-borrowed', name: 'notes-kit' }]);
  assert.deepEqual(JSON.parse(text(one, 'sources.json')).sources.map(s => s.name), ['review-kit']);
});

test('a set-borrowed that nets out keeps the bytes of sources.json', () => {
  const def = load(fullFiles());
  const same = JSON.parse(fullFiles()['sources.json']).sources[0];
  const r = done(def, [{ kind: 'set-borrowed', source: same }]);
  assert.deepEqual(r.changes, []);
});

test('a kit skill can be removed when the record drops the item first, in the same save', () => {
  const def = load(small());
  const added = reload(done(def, [
    { kind: 'add-skill', id: 'file-page', text: skill('file-page', 'Files a page.') },
    { kind: 'add-agent', id: 'keeper', text: agent('keeper', 'skills:\n  - file-page\n') },
    { kind: 'set-borrowed', source: KIT },
  ]));
  refused(added, [{ kind: 'remove-skill', id: 'file-page' }], 'EDIT_INVALID');
  const r = done(added, [{ kind: 'set-borrowed', source: { ...KIT, items: [{ part: 'subagents', id: 'keeper' }] } }, { kind: 'remove-skill', id: 'file-page' }]);
  assert.deepEqual(JSON.parse(text(r, 'sources.json')).sources[0].items, [{ part: 'subagents', id: 'keeper' }]);
  assert.deepEqual(reload(r).entries.subagents[0].skills, []);
});

test('sources.json that is not valid is refused for a borrowed edit', () => {
  const def = load(fullFiles());
  const bad = { ...def, files: def.files.map(f => (f.path === 'sources.json' ? { ...f, bytes: Buffer.from('{"sources": 1}\n') } : f)) };
  refused(bad, [{ kind: 'set-borrowed', source: KIT }], 'EDIT_INVALID');
  void json;
});
