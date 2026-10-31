// "Look inside" in the Share sheet: the key check, the items by name, and a copy that leaves an item out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flaggedIds, lookItems, looksLikeKey } from '../shared/home/share-look.js';
import { buildShare, planShare, shareableAgents } from '../shared/home/share-model.js';
import { libraryWorld } from './home-library-world.js';
import { plainNameOf } from '../shared/home/plain-names.js';
import type { SkillItem, World } from '../shared/world/types.js';
import { hashText } from '../shared/world/sample.js';

test('the check flags the shapes of keys and passwords and leaves plain text alone', () => {
  for (const bad of [
    'Use sk-ant-api03-abcdefghijklmnop1234 to call the service.',
    'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuv',
    'aws AKIAIOSFODNN7EXAMPLE here',
    'password=hunter2hunter2',
    'PASSWORD: "correct horse battery"',
    'api_key = abcd1234',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIE',
    'xoxb-1234567890-abcdefghij',
    'value aGVsbG9Xb3JsZEFiY2RlZmdoaWprbG1ub3BxcjEyMzQ1Ng==',
    'Zm9vQmFyQmF6MTIzNDU2Nzg5MEFiQ2RFZkdoSWpLbE1uT3A',
  ]) assert.equal(looksLikeKey(bad), true, bad);
  for (const fine of [
    'Read the rough notes from the meeting and write the main points as short lines.',
    'Ask your password manager. Never paste a password into a note.',
    'See https://example.com/a/very/long/path/with/many/segments-and-more-segments-1234567890 for more.',
    'a-very-long-hyphenated-slug-with-lowercase-and-1234567890-digits-only',
    'sk- is how some keys start',
    'AKIA is a prefix',
    'ThisIsAShortCamelCase1',
    '',
  ]) assert.equal(looksLikeKey(fine), false, fine);
});

const withSeededSkill = (text: string): World => {
  const w = libraryWorld();
  const skill = w.items.find((i): i is SkillItem => i.kind === 'skill' && i.library === null && w.items.some(a => a.kind === 'agent' && a.library === null && a.definition.skillIds.includes(i.id)))!;
  const seeded: SkillItem = { ...skill, foundAt: skill.foundAt.map(f => ({ ...f, text, contentHash: hashText(text) })) };
  return { ...w, items: w.items.map(i => (i.id === skill.id ? seeded : i)) };
};

test('every skill, agent, tool and set of notes that goes in is listed by name with its text, and a seeded key marks only its own item', () => {
  const world = withSeededSkill('Call the service with sk-live-abcdefghijklmnop1234567 as the key.');
  const offered = shareableAgents(world).map(a => a.id);
  const bundle = buildShare(world, offered);
  const items = lookItems(bundle, n => n);
  assert.equal(items.length, bundle.items.length + bundle.toolRefs.length + bundle.sliceRules.length);
  assert.deepEqual([...new Set(items.map(i => i.kind))], ['agent', 'skill', 'tool', 'note']);
  const flagged = items.filter(i => i.flagged);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0]!.kind, 'skill');
  assert.match(flagged[0]!.text, /sk-live-/);
  assert.deepEqual(flaggedIds(items), [flagged[0]!.id]);
  assert.ok(items.every(i => i.name !== '' && i.id !== ''));
});

test('a sample world with no seeded key flags nothing', () => {
  const world = libraryWorld();
  const bundle = buildShare(world, shareableAgents(world).map(a => a.id));
  assert.deepEqual(flaggedIds(lookItems(bundle, n => n)), []);
});

test('leaving out a flagged skill takes its text out of the file and off the agents that use it; the text of the others still travels', () => {
  const world = withSeededSkill('password=hunter2hunter2 for the account');
  const offered = shareableAgents(world).map(a => a.id);
  const items = lookItems(buildShare(world, offered), n => n);
  const [bad] = flaggedIds(items);
  assert.ok(bad !== undefined);
  const all = planShare(world, offered, []);
  assert.match(all.text, /hunter2hunter2/);
  const without = planShare(world, offered, [bad]);
  assert.doesNotMatch(without.text, /hunter2hunter2/);
  assert.equal(without.counts.skills, all.counts.skills - 1);
  assert.equal(without.counts.agents, all.counts.agents, 'no agent was left out');
  assert.ok(without.bundle.items.every(i => i.kind !== 'agent' || !i.definition.skillIds.includes(bad)), 'no agent still points at it');
  assert.equal(without.leftOutItems, 1);
  assert.equal(without.leftOutAgents, 0);
  assert.equal(without.readyMade, all.readyMade, 'taking a skill out does not make a ready-made name appear');
});

test('leaving out an agent, a tool or a set of notes by id works the same way', () => {
  const world = libraryWorld();
  const offered = shareableAgents(world).map(a => a.id);
  const full = planShare(world, offered, []);
  const tool = full.bundle.toolRefs[0]!, notes = full.bundle.sliceRules[0]!;
  const t = planShare(world, offered, [tool.toolId]);
  assert.equal(t.counts.tools, full.counts.tools - 1);
  assert.ok(t.bundle.items.every(i => i.kind !== 'agent' || i.definition.toolAttachments.every(a => a.toolId !== tool.toolId)));
  const n = planShare(world, offered, [notes.sliceId]);
  assert.equal(n.counts.noteSets, full.counts.noteSets - 1);
  assert.ok(n.bundle.items.every(i => i.kind !== 'agent' || i.definition.sliceId !== notes.sliceId));
  const a = planShare(world, offered, [offered[0]!]);
  assert.equal(a.leftOutAgents, 1);
  assert.equal(a.leftOutItems, 0, 'an agent is counted as an agent');
});

test('a set of notes shows its topics in words and never a folder path', () => {
  const world = libraryWorld();
  const bundle = buildShare(world, shareableAgents(world).map(a => a.id));
  const notes = lookItems(bundle, plainNameOf(world), world.wikiPages).filter(i => i.kind === 'note');
  assert.ok(notes.length >= 1);
  for (const n of notes) { assert.doesNotMatch(n.text, /\//, n.text); assert.match(n.text, /Topic: [A-Z]|Kind: |Label: |Links: /); }
  const folders = notes.find(n => n.name === 'Client list');
  assert.ok(folders !== undefined && /Topic: Clients/.test(folders.text), folders?.text);
});
