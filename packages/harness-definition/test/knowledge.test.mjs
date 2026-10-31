// Notes lane D: the knowledge source record (`knowledge.json`), `notes` in agent frontmatter, the edits that set and
// remove a source, and the revision. A source is a pointer: a kind, a name, and a path. Synthetic values only: every
// path is relative or in `~` form, and the folders the path helper sees are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  EDIT_KINDS, KNOWLEDGE_FILE, KNOWLEDGE_KINDS, computeRevision, editDefinition, isKnowledgePath, loadDefinition, loadDefinitionFiles,
  readFrontmatter, storedKnowledgePath,
} from '../../../dist/packages/harness-definition/src/index.js';
import { agent, cleanup, codes, fullFiles, json, makeDefinition, tempRoot } from './fixture.mjs';

test.after(cleanup);

const WIKI = { kind: 'wiki-folder', name: 'wiki', path: 'notes' };
const HOME_WIKI = { kind: 'wiki-folder', name: 'team-notes', path: '~/notes/team' };
const knowledge = (...sources) => json({ sources });
const withNotes = (id, notes, extra = '') => agent(id, `notes:\n${notes.map(n => `  - ${n}\n`).join('')}${extra}`);

const ok = files => {
  const r = loadDefinition(makeDefinition(files));
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return r.definition;
};
const refused = (files, code) => {
  const r = loadDefinition(makeDefinition(files));
  assert.equal(r.ok, false, `expected ${code}`);
  assert.ok(codes(r).includes(code), `expected ${code}, got ${JSON.stringify(r.problems)}`);
  return r.problems;
};
const text = file => Buffer.from(file.bytes).toString('utf8');
const byPath = result => new Map(result.files.map(f => [f.path, f]));
const done = (def, edits) => {
  const r = editDefinition(def, edits);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r));
  return r;
};
const editRefused = (def, edits, code) => {
  const r = editDefinition(def, edits);
  assert.equal(r.ok, false, 'the edit should be refused');
  assert.equal(r.code, code, JSON.stringify(r));
  return r;
};
/** Every file the change list does not name is byte-identical. */
function assertOnlyChanged(def, result) {
  const named = new Set(result.changes.map(c => c.path));
  const after = byPath(result);
  for (const f of def.files) {
    if (named.has(f.path)) continue;
    assert.ok(after.has(f.path), `${f.path} stays`);
    assert.ok(Buffer.from(f.bytes).equals(Buffer.from(after.get(f.path).bytes)), `${f.path} stays byte-identical`);
  }
}
/** Writes a result into a fresh folder and loads it with the package loader. */
function loadFromDisk(result) {
  const dir = path.join(tempRoot(), '.bowerloom');
  for (const f of result.files) {
    const at = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, f.bytes);
  }
  const r = loadDefinition(dir);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return r.definition;
}
const front = file => { const fm = readFrontmatter(text(file)); assert.equal(fm.ok, true); return { ...fm.data }; };

// ---- the record ---------------------------------------------------------------------------------------------------------

test('knowledge.json lists each source as a kind, a name, and a path; the one kind is wiki-folder', () => {
  assert.equal(KNOWLEDGE_FILE, 'knowledge.json');
  assert.deepEqual([...KNOWLEDGE_KINDS], ['wiki-folder']);
  assert.ok(Object.isFrozen(KNOWLEDGE_KINDS));
  const def = ok(fullFiles({ 'knowledge.json': knowledge(WIKI, HOME_WIKI) }));
  assert.deepEqual(def.knowledge.map(s => ({ ...s })), [WIKI, HOME_WIKI]);
  assert.ok(def.files.some(f => f.path === 'knowledge.json'));
});

test('a definition with no knowledge.json has no sources, and its agents have no notes', () => {
  const def = ok(fullFiles());
  assert.deepEqual(def.knowledge, []);
  for (const a of def.entries.subagents) assert.equal(a.notes, undefined);
});

test('knowledge.json needs no part pointer in harness.json: a source is a pointer, not a part', () => {
  const def = ok({ ...fullFiles(), 'knowledge.json': knowledge(WIKI) });
  assert.equal(def.harness.parts.memory, 'instructions/AGENTS.md');
});

test('an agent lists the sources it reads with notes, by name', () => {
  const def = ok(fullFiles({
    'knowledge.json': knowledge(WIKI, HOME_WIKI),
    'agents/keeper.md': withNotes('keeper', ['team-notes', 'wiki']),
  }));
  assert.deepEqual(def.entries.subagents.find(a => a.id === 'keeper').notes, ['team-notes', 'wiki']);
});

test('a path is relative inside the folder or in ~ form; every other path is refused', () => {
  const good = ['.', 'notes', 'docs/notes', 'a.b/c-d_e', '~/notes', '~/notes/team', '~/.wiki'];
  for (const p of good) {
    assert.equal(isKnowledgePath(p), true, p);
    ok(fullFiles({ 'knowledge.json': knowledge({ ...WIKI, path: p }) }));
  }
  const bad = [
    '', '/srv/notes', '//notes', 'C:/notes', 'c:\\notes', '\\\\share\\notes', '../notes', 'a/../../b', 'a/../b', './notes', 'a/./b',
    'a//b', 'notes/', '~', '~/', '~other/notes', '~/../notes', '~/a/../../b', 'a\\b', 'a`b', 'a\nb', 'a\u0000b', 'x'.repeat(1025),
  ];
  for (const p of bad) {
    assert.equal(isKnowledgePath(p), false, JSON.stringify(p));
    const problems = refused(fullFiles({ 'knowledge.json': knowledge({ ...WIKI, path: p }) }), 'KNOWLEDGE_PATH');
    if (p.length > 3) for (const pr of problems) assert.equal(pr.message.includes(p), false, `a message never repeats the path ${JSON.stringify(p)}`);
  }
  for (const v of [null, 1, ['notes'], { p: 'notes' }]) assert.equal(isKnowledgePath(v), false);
});

test('an unknown kind, a bad name, a repeated name or path, and an unknown field are refused', () => {
  refused(fullFiles({ 'knowledge.json': knowledge({ ...WIKI, kind: 'database' }) }), 'KNOWLEDGE_KIND');
  refused(fullFiles({ 'knowledge.json': knowledge({ ...WIKI, name: 'My Notes' }) }), 'INVALID_ID');
  refused(fullFiles({ 'knowledge.json': knowledge({ ...WIKI, name: '../x' }) }), 'INVALID_ID');
  refused(fullFiles({ 'knowledge.json': knowledge(WIKI, { ...HOME_WIKI, name: 'wiki' }) }), 'DUPLICATE_ID');
  refused(fullFiles({ 'knowledge.json': knowledge(WIKI, { ...HOME_WIKI, path: 'notes' }) }), 'KNOWLEDGE_DUPLICATE_PATH');
  refused(fullFiles({ 'knowledge.json': knowledge({ ...WIKI, pages: 3 }) }), 'UNKNOWN_FIELD');
  refused(fullFiles({ 'knowledge.json': json({ sources: [WIKI], extra: true }) }), 'UNKNOWN_FIELD');
  refused(fullFiles({ 'knowledge.json': json({}) }), 'INVALID_FIELD');
  refused(fullFiles({ 'knowledge.json': json({ sources: [{ kind: 'wiki-folder', name: 'wiki' }] }) }), 'INVALID_FIELD');
  refused(fullFiles({ 'knowledge.json': '{"sources": [],}\n' }), 'INVALID_JSON');
  refused(fullFiles({ 'knowledge.json/x': 'x' }), 'UNEXPECTED_FILE');
});

test('a notes entry that names no source is refused, with or without knowledge.json', () => {
  refused(fullFiles({ 'knowledge.json': knowledge(WIKI), 'agents/keeper.md': withNotes('keeper', ['other']) }), 'NOTES_SOURCE_UNKNOWN');
  const problems = refused(fullFiles({ 'agents/keeper.md': withNotes('keeper', ['wiki']) }), 'NOTES_SOURCE_UNKNOWN');
  assert.ok(problems.some(p => p.path === 'agents/keeper.md'));
});

test('notes must be a list of distinct source names', () => {
  const files = extra => fullFiles({ 'knowledge.json': knowledge(WIKI), 'agents/keeper.md': agent('keeper', extra) });
  refused(files('notes: wiki\n'), 'INVALID_FIELD');
  refused(files('notes:\n  - wiki\n  - wiki\n'), 'INVALID_FIELD');
  refused(files('notes:\n  - Wiki Notes\n'), 'INVALID_FIELD');
  refused(files('notes:\n  - 3\n'), 'INVALID_FIELD');
  ok(files('notes: []\n'));
});

test('the loader in memory gives the same sources and refusals', () => {
  const files = Object.entries(fullFiles({ 'knowledge.json': knowledge(WIKI), 'agents/keeper.md': withNotes('keeper', ['wiki']) }))
    .map(([p, t]) => ({ path: p, bytes: Buffer.from(t) }));
  const r = loadDefinitionFiles(files);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  assert.deepEqual(r.definition.knowledge.map(s => ({ ...s })), [WIKI]);
  const bad = loadDefinitionFiles(files.map(f => f.path === 'knowledge.json' ? { ...f, bytes: Buffer.from(knowledge({ ...WIKI, path: '/srv/notes' })) } : f));
  assert.deepEqual(codes(bad), ['KNOWLEDGE_PATH']);
});

// ---- the revision -------------------------------------------------------------------------------------------------------

test('revision: knowledge.json is a machine file, hashed in canonical form', () => {
  const a = ok(fullFiles({ 'knowledge.json': knowledge(WIKI) }));
  const b = ok(fullFiles({ 'knowledge.json': `{"sources":[{"path":"notes","name":"wiki","kind":"wiki-folder"}]}` }));
  assert.equal(a.revision, b.revision);
  const c = ok(fullFiles({ 'knowledge.json': knowledge({ ...WIKI, path: 'wiki' }) }));
  assert.notEqual(a.revision, c.revision);
  assert.equal(computeRevision(a.files), a.revision);
});

test('revision: a source, and an agent that lists it, each change the revision; no source keeps the old revision', () => {
  const plain = ok(fullFiles());
  const linked = ok(fullFiles({ 'knowledge.json': knowledge(WIKI) }));
  const listed = ok(fullFiles({ 'knowledge.json': knowledge(WIKI), 'agents/writer.md': agent('writer', 'engines:\n  - codex\nnotes:\n  - wiki\nx-codex:\n  reasoning_effort: medium\n  nested:\n    depth: 0.5\n') }));
  assert.equal(new Set([plain.revision, linked.revision, listed.revision]).size, 3);
  assert.equal(ok(fullFiles()).revision, plain.revision);
});

// ---- the path helper ----------------------------------------------------------------------------------------------------

test('storedKnowledgePath: inside the folder a path is relative, inside home it takes ~ form', () => {
  const where = { root: '/fixture/home/work/project', home: '/fixture/home' };
  const cases = {
    '/fixture/home/work/project/notes': 'notes',
    '/fixture/home/work/project': '.',
    '/fixture/home/work/project/a/../notes/': 'notes',
    notes: 'notes',
    'docs/../notes': 'notes',
    '.': '.',
    '/fixture/home/notes': '~/notes',
    '/fixture/home/work/other/wiki': '~/work/other/wiki',
    '~/notes': '~/notes',
    '~/work/project/notes': 'notes',
  };
  for (const [input, want] of Object.entries(cases)) {
    const r = storedKnowledgePath(input, where);
    assert.deepEqual(r, { ok: true, path: want }, input);
    assert.equal(isKnowledgePath(r.path), true);
  }
});

test('storedKnowledgePath refuses an absolute path outside home, a .. that escapes, home itself, and odd text', () => {
  const where = { root: '/fixture/home/work/project', home: '/fixture/home' };
  const cases = {
    '/srv/notes': 'KNOWLEDGE_PATH_OUTSIDE',
    '/fixture/homely/notes': 'KNOWLEDGE_PATH_OUTSIDE',
    '../other': 'KNOWLEDGE_PATH_ESCAPES',
    '../../../srv': 'KNOWLEDGE_PATH_ESCAPES',
    'a/../../b': 'KNOWLEDGE_PATH_ESCAPES',
    '~/../srv': 'KNOWLEDGE_PATH_ESCAPES',
    '~/a/../../srv': 'KNOWLEDGE_PATH_ESCAPES',
    '/fixture/home': 'KNOWLEDGE_PATH_UNSAFE',
    '~': 'KNOWLEDGE_PATH_UNSAFE',
    '~/': 'KNOWLEDGE_PATH_UNSAFE',
    '~other/notes': 'KNOWLEDGE_PATH_UNSAFE',
    '': 'KNOWLEDGE_PATH_UNSAFE',
    'a\\b': 'KNOWLEDGE_PATH_UNSAFE',
    'a`b': 'KNOWLEDGE_PATH_UNSAFE',
    'a\nb': 'KNOWLEDGE_PATH_UNSAFE',
    'C:/notes': 'KNOWLEDGE_PATH_UNSAFE',
  };
  for (const [input, code] of Object.entries(cases)) {
    const r = storedKnowledgePath(input, where);
    assert.equal(r.ok, false, input);
    assert.equal(r.code, code, input);
    assert.equal(typeof r.message, 'string');
    if (input.length > 1) assert.equal(r.message.includes(input), false, 'the message never repeats the path');
  }
  // A folder outside home is still relative when it sits inside the harness folder.
  assert.deepEqual(storedKnowledgePath('/srv/project/notes', { root: '/srv/project', home: '/fixture/home' }), { ok: true, path: 'notes' });
  assert.equal(storedKnowledgePath('../escape', { root: '/srv/project', home: '/fixture/home' }).code, 'KNOWLEDGE_PATH_ESCAPES');
  for (const where2 of [{ root: 'relative', home: '/fixture/home' }, { root: '/fixture/home/p', home: 'relative' }, null]) {
    assert.equal(storedKnowledgePath('notes', where2).code, 'KNOWLEDGE_PATH_UNSAFE');
  }
});

// ---- the edits ----------------------------------------------------------------------------------------------------------

test('EDIT_KINDS holds set-source and remove-source', () => {
  assert.deepEqual([...EDIT_KINDS], ['set-skill', 'add-skill', 'remove-skill', 'set-agent', 'set-instructions', 'set-engines', 'set-source', 'remove-source']);
});

test('set-source creates knowledge.json when the folder had none, and touches nothing else', () => {
  const def = ok(fullFiles());
  const r = done(def, [{ kind: 'set-source', source: WIKI }]);
  assert.deepEqual(r.changes, [{ path: 'knowledge.json', kind: 'create' }]);
  assert.equal(text(byPath(r).get('knowledge.json')), JSON.stringify({ sources: [WIKI] }, null, 2) + '\n');
  assertOnlyChanged(def, r);
  const loaded = loadFromDisk(r);
  assert.equal(loaded.revision, r.revision);
  assert.deepEqual(loaded.knowledge.map(s => ({ ...s })), [WIKI]);
});

test('set-source on a name it holds replaces that source in place and keeps the order', () => {
  const def = ok(fullFiles({ 'knowledge.json': knowledge(WIKI, HOME_WIKI) }));
  const r = done(def, [{ kind: 'set-source', source: { ...WIKI, path: '~/wiki' } }]);
  assert.deepEqual(r.changes, [{ path: 'knowledge.json', kind: 'update' }]);
  assert.deepEqual(loadFromDisk(r).knowledge.map(s => ({ ...s })), [{ ...WIKI, path: '~/wiki' }, HOME_WIKI]);
  const added = done(def, [{ kind: 'set-source', source: { kind: 'wiki-folder', name: 'more', path: 'more' } }]);
  assert.deepEqual(loadFromDisk(added).knowledge.map(s => s.name), ['wiki', 'team-notes', 'more']);
  assertOnlyChanged(def, added);
});

test('set-source with the values it already holds changes nothing, and keeps the bytes', () => {
  const original = `{"sources": [ {"kind": "wiki-folder", "name": "wiki", "path": "notes"} ]}\n`;
  const def = ok(fullFiles({ 'knowledge.json': original }));
  const r = done(def, [{ kind: 'set-source', source: { ...WIKI } }]);
  assert.deepEqual(r.changes, []);
  assert.equal(r.revision, def.revision);
  assert.equal(text(byPath(r).get('knowledge.json')), original);
});

test('set-source refuses a path that is not relative inside the folder or in ~ form', () => {
  const def = ok(fullFiles());
  for (const p of ['/srv/notes', '../notes', '~/../x', 'a/../b', '', 'C:/notes', '~']) {
    const r = editRefused(def, [{ kind: 'set-source', source: { ...WIKI, path: p } }], 'EDIT_UNSAFE_PATH');
    assert.equal(r.edit, 0);
    if (p.length > 1) assert.equal(r.message.includes(p), false);
  }
});

test('set-source refuses a bad name, an unknown kind, and a shape it does not take', () => {
  const def = ok(fullFiles());
  editRefused(def, [{ kind: 'set-source', source: { ...WIKI, name: 'My Notes' } }], 'EDIT_UNSAFE_ID');
  editRefused(def, [{ kind: 'set-source', source: { ...WIKI, kind: 'database' } }], 'EDIT_BAD_EDIT');
  editRefused(def, [{ kind: 'set-source', source: { ...WIKI, pages: 3 } }], 'EDIT_BAD_EDIT');
  editRefused(def, [{ kind: 'set-source', source: 'notes' }], 'EDIT_BAD_EDIT');
  editRefused(def, [{ kind: 'set-source' }], 'EDIT_BAD_EDIT');
  editRefused(def, [{ kind: 'set-source', source: WIKI, path: 'x' }], 'EDIT_BAD_EDIT');
  editRefused(def, [{ kind: 'set-source', source: { kind: 'wiki-folder', name: 'wiki' } }], 'EDIT_BAD_EDIT');
});

test('set-source refuses a second source at a path another source holds', () => {
  const def = ok(fullFiles({ 'knowledge.json': knowledge(WIKI) }));
  const r = editRefused(def, [{ kind: 'set-source', source: { ...HOME_WIKI, path: 'notes' } }], 'EDIT_INVALID');
  assert.ok(r.problems.some(p => p.code === 'KNOWLEDGE_DUPLICATE_PATH'));
});

test('remove-source unlinks the source from every agent that lists it, as remove-skill does', () => {
  const def = ok(fullFiles({
    'knowledge.json': knowledge(WIKI, HOME_WIKI),
    'agents/keeper.md': withNotes('keeper', ['wiki', 'team-notes'], '# the keeper reads both\n'),
    'agents/solo.md': withNotes('solo', ['wiki']),
  }));
  const r = done(def, [{ kind: 'remove-source', name: 'wiki' }]);
  assert.deepEqual(r.changes.map(c => [c.path, c.kind]), [['agents/keeper.md', 'update'], ['agents/solo.md', 'update'], ['knowledge.json', 'update']]);
  assertOnlyChanged(def, r);
  const files = byPath(r);
  assert.deepEqual(front(files.get('agents/keeper.md')).notes, ['team-notes']);
  assert.match(text(files.get('agents/keeper.md')), /# the keeper reads both/, 'a frontmatter comment stays');
  // A list left empty goes, so a link and its removal leave the agent as it was.
  assert.equal(Object.hasOwn(front(files.get('agents/solo.md')), 'notes'), false);
  assert.equal(text(files.get('agents/solo.md')), agent('solo'));
  const loaded = loadFromDisk(r);
  assert.deepEqual(loaded.knowledge.map(s => s.name), ['team-notes']);
  assert.equal(loaded.revision, r.revision);
});

test('remove-source of the last source deletes knowledge.json', () => {
  const def = ok(fullFiles({ 'knowledge.json': knowledge(WIKI), 'agents/keeper.md': withNotes('keeper', ['wiki']) }));
  const r = done(def, [{ kind: 'remove-source', name: 'wiki' }]);
  assert.deepEqual(r.changes.map(c => [c.path, c.kind]), [['agents/keeper.md', 'update'], ['knowledge.json', 'delete']]);
  assert.equal(byPath(r).has('knowledge.json'), false);
  assert.deepEqual(loadFromDisk(r).knowledge, []);
});

test('remove-source refuses a name the folder does not hold, and an unsafe name', () => {
  const def = ok(fullFiles({ 'knowledge.json': knowledge(WIKI) }));
  editRefused(def, [{ kind: 'remove-source', name: 'other' }], 'EDIT_UNKNOWN_ID');
  editRefused(ok(fullFiles()), [{ kind: 'remove-source', name: 'wiki' }], 'EDIT_UNKNOWN_ID');
  editRefused(def, [{ kind: 'remove-source', name: '../wiki' }], 'EDIT_UNSAFE_ID');
  editRefused(def, [{ kind: 'remove-source' }], 'EDIT_BAD_EDIT');
});

test('set-agent sets notes alone, adds the field when the agent had none, and null removes it', () => {
  const def = ok(fullFiles({ 'knowledge.json': knowledge(WIKI, HOME_WIKI) }));
  const first = done(def, [{ kind: 'set-agent', id: 'reader', notes: ['wiki'] }]);
  assert.deepEqual(first.changes, [{ path: 'agents/reader.md', kind: 'update' }]);
  const reader = front(byPath(first).get('agents/reader.md'));
  assert.deepEqual(reader.notes, ['wiki']);
  assert.deepEqual(reader.skills, ['review'], 'the skills stay');
  assert.deepEqual(reader['x-claude-code'], { color: 'blue', effort: 'high' }, 'the private block stays');
  assert.deepEqual(loadFromDisk(first).entries.subagents.find(a => a.id === 'reader').notes, ['wiki']);
  const again = loadFromDisk(first);
  const second = done(again, [{ kind: 'set-agent', id: 'reader', notes: null }]);
  assert.equal(text(byPath(second).get('agents/reader.md')), text(def.files.find(f => f.path === 'agents/reader.md')));
  const same = done(again, [{ kind: 'set-agent', id: 'reader', notes: ['wiki'] }]);
  assert.deepEqual(same.changes, []);
});

test('set-agent refuses a notes entry that names no source, and a name that is not an id', () => {
  const def = ok(fullFiles({ 'knowledge.json': knowledge(WIKI) }));
  editRefused(def, [{ kind: 'set-agent', id: 'reader', notes: ['other'] }], 'EDIT_UNKNOWN_ID');
  editRefused(ok(fullFiles()), [{ kind: 'set-agent', id: 'reader', notes: ['wiki'] }], 'EDIT_UNKNOWN_ID');
  editRefused(def, [{ kind: 'set-agent', id: 'reader', notes: ['Wiki Notes'] }], 'EDIT_UNSAFE_ID');
  editRefused(def, [{ kind: 'set-agent', id: 'reader', notes: 'wiki' }], 'EDIT_BAD_EDIT');
  editRefused(def, [{ kind: 'set-agent', id: 'reader', notes: ['wiki', 'wiki'] }], 'EDIT_INVALID');
  editRefused(def, [{ kind: 'set-agent', id: 'reader' }], 'EDIT_BAD_EDIT');
});

test('one save can add a source and link it; the order of edits counts', () => {
  const def = ok(fullFiles());
  const r = done(def, [{ kind: 'set-source', source: WIKI }, { kind: 'set-agent', id: 'writer', notes: ['wiki'] }]);
  assert.deepEqual(r.changes.map(c => [c.path, c.kind]), [['agents/writer.md', 'update'], ['knowledge.json', 'create']]);
  assert.deepEqual(loadFromDisk(r).entries.subagents.find(a => a.id === 'writer').notes, ['wiki']);
  editRefused(def, [{ kind: 'set-agent', id: 'writer', notes: ['wiki'] }, { kind: 'set-source', source: WIKI }], 'EDIT_UNKNOWN_ID');
});

test('a source added and removed in one save leaves every file as it was', () => {
  const def = ok(fullFiles());
  const r = done(def, [
    { kind: 'set-source', source: WIKI }, { kind: 'set-agent', id: 'reader', notes: ['wiki'] }, { kind: 'remove-source', name: 'wiki' },
  ]);
  assert.deepEqual(r.changes, []);
  assert.equal(r.revision, def.revision);
});

test('the edits do not change the definition or the edits they are given', () => {
  const def = ok(fullFiles({ 'knowledge.json': knowledge(WIKI) }));
  const before = def.files.map(f => Buffer.from(f.bytes).toString('base64'));
  const edits = Object.freeze([
    Object.freeze({ kind: 'set-source', source: Object.freeze({ ...HOME_WIKI }) }),
    Object.freeze({ kind: 'set-agent', id: 'reader', notes: Object.freeze(['team-notes']) }),
    Object.freeze({ kind: 'remove-source', name: 'wiki' }),
  ]);
  done(def, edits);
  assert.deepEqual(def.files.map(f => Buffer.from(f.bytes).toString('base64')), before);
  assert.deepEqual(def.knowledge.map(s => s.name), ['wiki']);
});
