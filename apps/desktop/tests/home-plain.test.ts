// The plain layer of the home app: every sample agent, skill, tool and note has a plain name and a one-line hint, and each obeys the text rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAIN_AGENTS, PLAIN_NOTES, PLAIN_SKILLS, PLAIN_TOOLS, agentRecency, plainOf, skillDoes } from '../shared/home/plain.js';
import { CARD_WORDS, agentCard, ownedAgents, shelvesOf } from '../shared/home/cards.js';
import { generateWorld } from '../shared/proto/sample.js';
import { reduceStore, createStore } from '../shared/proto/store.js';
import type { AgentItem, ToolItem } from '../shared/proto/types.js';
import { LIMITS, assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';
import { agent, makeWorld } from './proto-testworld.js';

const world = generateWorld(1);
const ids = (kind: string): string[] => world.items.filter(i => i.kind === kind && (kind !== 'tool' || (i as ToolItem).toolKind !== 'hook')).map(i => i.id);

test('every sample skill, every tool that is not a hook, every owned agent and every saved choice of pages has a plain entry', () => {
  for (const id of ids('skill')) assert.ok(plainOf('skill', id) !== null, id);
  for (const id of ids('tool')) assert.ok(plainOf('tool', id) !== null, id);
  for (const id of world.slices.map(s => s.id)) assert.ok(plainOf('note', id) !== null, id);
  for (const a of ownedAgents(world)) assert.ok(plainOf('agent', a.id) !== null, a.id);
  assert.equal(Object.keys(PLAIN_SKILLS).length, 52); assert.equal(Object.keys(PLAIN_TOOLS).length, 11);
  assert.equal(Object.keys(PLAIN_NOTES).length, 3); assert.equal(Object.keys(PLAIN_AGENTS).length, 10);
});

test('an id the sample does not have is not in the layer', () => {
  assert.equal(plainOf('skill', 'nope'), null); assert.equal(plainOf('agent', 'toString'), null); assert.equal(plainOf('tool', '__proto__'), null);
  assert.equal(skillDoes('nope'), null); assert.equal(agentRecency('nope'), Number.MAX_SAFE_INTEGER);
});

const tables = [['agent', PLAIN_AGENTS], ['skill', PLAIN_SKILLS], ['tool', PLAIN_TOOLS], ['note', PLAIN_NOTES]] as const;
for (const [kind, table] of tables) {
  test(`${kind} entries: a name of at most 5 words, a hint of at most 12, no banned word, no file path, and every name is different`, () => {
    const names = new Set<string>();
    for (const [id, plain] of Object.entries(table)) {
      assert.ok(countWords(plain.name) >= 1 && countWords(plain.name) <= LIMITS.label, `${id}: ${plain.name}`);
      assert.ok(countWords(plain.hint) >= 3 && countWords(plain.hint) <= LIMITS.hint, `${id}: ${plain.hint}`);
      for (const text of [plain.name, plain.hint]) { assert.equal(bannedIn(text), null, `${id}: ${text}`); assert.doesNotMatch(text, /[\\/]|\.(md|json|toml|sh)\b|^\s|\s$/, `${id}: ${text}`); }
      assert.match(plain.hint, /[.!]$/, `${id} hint ends like a sentence`);
      assert.deepEqual(assertTextBudget(`<p>${plain.hint}</p><button>${plain.name}</button>`), [], id);
      assert.ok(!names.has(plain.name), `${id} repeats the name ${plain.name}`);
      names.add(plain.name);
    }
  });
}

test('a skill says what it lets an agent do in at most 3 words, and that is what builds an agent hint', () => {
  for (const [id, s] of Object.entries(PLAIN_SKILLS)) { assert.ok(countWords(s.does) >= 1 && countWords(s.does) <= 3, `${id}: ${s.does}`); assert.equal(bannedIn(s.does), null, s.does); assert.equal(s.does, s.does.toLowerCase()); }
});

test('the plain tables are frozen', () => {
  for (const [, table] of tables) { assert.equal(Object.isFrozen(table), true); for (const v of Object.values(table)) assert.equal(Object.isFrozen(v), true); }
});

test('an agent card names what the agent can do, in words from its skills, and stays within 12 words', () => {
  const a = world.items.find((i): i is AgentItem => i.id === 'agent-01')!;
  assert.deepEqual(agentCard(a), { name: 'Meeting assistant', hint: 'Summarizes meetings and writes replies.' });
  for (const own of ownedAgents(world)) {
    const c = agentCard(own);
    assert.ok(c.hint.length <= 56, `${own.id}: ${c.hint} must fit two lines of an agent card`);
    assert.ok(own.definition.skillIds.length < 2 || / and /.test(c.hint), 'two skills or more: two abilities');
    assert.ok(countWords(c.hint) <= LIMITS.hint, c.hint); assert.deepEqual(assertTextBudget(`<p>${c.hint}</p>`), [], c.hint);
    assert.match(c.hint, /^[A-Z].*\.$/); assert.equal(c.name, PLAIN_AGENTS[own.id]!.name);
    assert.doesNotMatch(c.hint, /\bwith \d+ skills?\b/, 'a hint is not only counts');
  }
});

test('an agent hint follows its skills: it drops a skill that was removed and says so when none are left', () => {
  const a = world.items.find((i): i is AgentItem => i.id === 'agent-01')!;
  const one = reduceStore(createStore(world).getState(), { type: 'detachSkill', agentId: a.id, skillId: 'skill-042' }).draft.items.find((i): i is AgentItem => i.id === a.id)!;
  assert.equal(agentCard(one).hint, 'Writes replies and lists action items.');
  const none: AgentItem = { ...a, definition: { ...a.definition, skillIds: [] } };
  assert.equal(agentCard(none).hint, CARD_WORDS.agentNoSkills);
  const unlisted: AgentItem = { ...a, definition: { ...a.definition, skillIds: ['skill-not-in-the-sample'] } };
  assert.equal(agentCard(unlisted).hint, PLAIN_AGENTS['agent-01']!.hint, 'a skill the layer does not know leaves the written hint');
});

test('an agent that is not in the sample falls back to its own name and the counted hint', () => {
  const x = agent('x1', 'quiet-fox', ['s1']);
  assert.deepEqual(agentCard(x), { name: 'Quiet Fox', hint: 'A quiet-fox role with 1 skill.' });
});

test('the shelves of every sample agent hold plain names and a hint on every card, and no card shows a sample name', () => {
  const plainNames = new Set([...Object.values(PLAIN_SKILLS), ...Object.values(PLAIN_TOOLS), ...Object.values(PLAIN_NOTES)].map(p => p.name));
  let cards = 0;
  for (const own of ownedAgents(world)) {
    const s = shelvesOf(world, own);
    for (const e of [...s.skills, ...s.tools, ...s.notes]) {
      cards += 1;
      assert.ok(plainNames.has(e.name), `${own.id}: ${e.name}`);
      assert.ok(e.hint !== undefined && countWords(e.hint) >= 3 && countWords(e.hint) <= LIMITS.hint, `${own.id}: ${e.name}: ${e.hint}`);
    }
  }
  assert.ok(cards >= 40, `${cards} cards`);
});

test('an item the sample does not know gets its own name and a plain line for its kind', () => {
  const w = makeWorld();
  const a1 = w.items.find((i): i is AgentItem => i.id === 'a1')!;
  const s = shelvesOf(w, a1);
  assert.deepEqual(s.skills.map(e => [e.name, e.hint]), [['Review', CARD_WORDS.skillFallback]]);
});

test('the story reads well: each sample agent has skills, tools or notes that fit its name', () => {
  // The seeded world is fixed, so the pairs are fixed. If the seed ever changes, this is the test that says the plain layer must be written again.
  const expected: Record<string, string[]> = {
    'agent-01': ['skill-042', 'skill-022', 'skill-009'], 'agent-02': ['skill-024', 'skill-029', 'skill-010'], 'agent-04': ['skill-036', 'skill-014', 'skill-006', 'skill-022'],
    'agent-07': ['skill-033', 'skill-034', 'skill-031'], 'agent-10': ['skill-010', 'skill-037', 'skill-018', 'skill-030'],
  };
  for (const [id, skills] of Object.entries(expected)) assert.deepEqual(world.items.find((i): i is AgentItem => i.id === id)!.definition.skillIds, skills, id);
});

// ---- Review item 14: every agent, every link and every stored name is pinned, and the counts come from the generated world, not from the table.
// The seeded world is fixed. If the seed ever changes, these are the tests that say the plain layer must be written again.
const PINNED_AGENTS: Readonly<Record<string, { name: string; skills: string[]; tools: string[]; note: string | null }>> = {
  'agent-02': { name: 'brisk-archivist', skills: ['skill-024', 'skill-029', 'skill-010'], tools: ['tool-mcp-present', 'tool-mcp-03'], note: 'slice-kinds' },
  'agent-09': { name: 'ember-forager', skills: ['skill-035', 'skill-020', 'skill-021', 'skill-036'], tools: ['tool-mcp-01', 'tool-mcp-03'], note: null },
  'agent-05': { name: 'humble-archivist', skills: ['skill-007', 'skill-032', 'skill-021', 'skill-027', 'skill-023'], tools: ['tool-prompt-06'], note: null },
  'agent-06': { name: 'humble-scribe', skills: ['skill-017', 'skill-040', 'skill-030', 'skill-034'], tools: ['tool-mcp-02', 'tool-prompt-01'], note: null },
  'agent-07': { name: 'mellow-cooper', skills: ['skill-033', 'skill-034', 'skill-031'], tools: [], note: null },
  'agent-04': { name: 'quiet-warden', skills: ['skill-036', 'skill-014', 'skill-006', 'skill-022'], tools: [], note: 'slice-folders' },
  'agent-03': { name: 'sunlit-cartographer', skills: ['skill-041', 'skill-012', 'skill-025', 'skill-016', 'skill-036'], tools: ['tool-prompt-04', 'tool-prompt-01'], note: 'slice-seeds' },
  'agent-10': { name: 'tidal-cartographer', skills: ['skill-010', 'skill-037', 'skill-018', 'skill-030'], tools: [], note: null },
  'agent-01': { name: 'velvet-weaver', skills: ['skill-042', 'skill-022', 'skill-009'], tools: ['tool-mcp-missing'], note: 'slice-folders' },
  'agent-08': { name: 'wintry-navigator', skills: ['skill-042', 'skill-028', 'skill-010'], tools: ['tool-mcp-02'], note: null },
};
const PINNED_SKILLS: Readonly<Record<string, string>> = {
  'skill-triple': 'jaunty-wicker', 'skill-hidden': 'nimble-dovetail', 'skill-003': 'mossy-satchel', 'skill-004': 'frosty-ferry',
  'skill-005': 'tidal-crucible', 'skill-006': 'silken-kettle', 'skill-007': 'amber-cobble', 'skill-008': 'sunlit-anvil',
  'skill-009': 'plucky-ledger', 'skill-010': 'silken-inkwell', 'skill-011': 'frosty-ledger', 'skill-012': 'dusky-inkwell',
  'skill-013': 'ivory-cobble', 'skill-014': 'jaunty-keystone', 'skill-015': 'knotted-latch', 'skill-016': 'pebbled-gantry',
  'skill-017': 'quiet-bellows', 'skill-018': 'gentle-ledger', 'skill-019': 'rustic-quill', 'skill-020': 'ivory-mortar',
  'skill-021': 'gilded-crucible', 'skill-022': 'crisp-mallet', 'skill-023': 'mossy-beacon', 'skill-024': 'rustic-crucible',
  'skill-025': 'rustic-keystone', 'skill-026': 'mossy-tallow', 'skill-027': 'ember-bellows', 'skill-028': 'gentle-thistle',
  'skill-029': 'hollow-kettle', 'skill-030': 'gilded-thimble', 'skill-031': 'dusky-keystone', 'skill-032': 'mossy-ledger',
  'skill-033': 'dusky-latch', 'skill-034': 'mellow-latch', 'skill-035': 'silken-gantry', 'skill-036': 'lilting-keystone',
  'skill-037': 'gentle-nutmeg', 'skill-038': 'humble-thistle', 'skill-039': 'gentle-latch', 'skill-040': 'lilting-anvil',
  'skill-041': 'plucky-lantern', 'skill-042': 'gilded-gantry', 'skill-043': 'amber-bobbin', 'skill-044': 'velvet-latch',
  'skill-proj-1': 'nimble-barrow', 'skill-proj-2': 'fabled-ledger', 'skill-proj-3': 'amber-mallet', 'skill-proj-4': 'lunar-bobbin',
  'skill-proj-5': 'humble-sprocket', 'skill-proj-6': 'amber-ferry', 'skill-proj-7': 'knotted-mallet', 'skill-proj-8': 'fabled-compass',
};
const PINNED_TOOLS: Readonly<Record<string, string>> = {
  'tool-mcp-missing': 'quiet-lantern', 'tool-mcp-present': 'tidal-anvil', 'tool-mcp-01': 'cobalt-keystone', 'tool-mcp-02': 'gilded-barrow',
  'tool-mcp-03': 'tidal-barrow', 'tool-prompt-01': 'lunar-wicker', 'tool-prompt-02': 'sunlit-thistle', 'tool-prompt-03': 'plucky-sprocket',
  'tool-prompt-04': 'quiet-barrow', 'tool-prompt-05': 'humble-lantern', 'tool-prompt-06': 'knotted-bellows',
};
const PINNED_NOTES: Readonly<Record<string, string>> = {
  'slice-folders': 'Alderhythe lantern', 'slice-kinds': 'Lilting satchel', 'slice-seeds': 'Frosty inkwell',
};

test('all ten owned agents keep their skills, tools and note, in order, and their stored name (review item 14)', () => {
  const owned = ownedAgents(world);
  assert.deepEqual(owned.map(a => a.id).sort(), Object.keys(PINNED_AGENTS).sort());
  for (const a of owned) {
    const pinned = PINNED_AGENTS[a.id]!;
    assert.equal(a.name, pinned.name, `${a.id} name`);
    assert.deepEqual(a.definition.skillIds, pinned.skills, `${a.id} skills`);
    assert.deepEqual(a.definition.toolAttachments.map(t => t.toolId), pinned.tools, `${a.id} tools`);
    assert.equal(a.definition.sliceId ?? null, pinned.note, `${a.id} note`);
  }
});

test('the stored name of every skill, tool that is not a hook, and saved choice of pages is pinned by id (review item 14)', () => {
  const nameOf = (kind: string): Record<string, string> => Object.fromEntries(world.items.filter(i => i.kind === kind && (kind !== 'tool' || (i as ToolItem).toolKind !== 'hook')).map(i => [i.id, i.name]));
  assert.deepEqual(nameOf('skill'), PINNED_SKILLS);
  assert.deepEqual(nameOf('tool'), PINNED_TOOLS);
  assert.deepEqual(Object.fromEntries(world.slices.map(s => [s.id, s.name])), PINNED_NOTES);
});

test('the counts of 52 skills, 11 tools, 3 sets of notes and 10 agents are counted in the generated world, and the plain tables match it id for id (review item 14)', () => {
  assert.equal(ids('skill').length, 52); assert.equal(ids('tool').length, 11); assert.equal(world.slices.length, 3); assert.equal(ownedAgents(world).length, 10);
  assert.deepEqual(Object.keys(PLAIN_SKILLS).sort(), ids('skill').sort(), 'every plain skill is in the world, and every skill has a plain entry');
  assert.deepEqual(Object.keys(PLAIN_TOOLS).sort(), ids('tool').sort());
  assert.deepEqual(Object.keys(PLAIN_NOTES).sort(), world.slices.map(s => s.id).sort());
  assert.deepEqual(Object.keys(PLAIN_AGENTS).sort(), ownedAgents(world).map(a => a.id).sort());
});
