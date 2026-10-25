// The details panel's model and its plain words: what each kind of selection says, in plain data, and the sample text that stands in for the made-up one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_WORDS, DETAIL_SKILL_IDS, PROGRAM_NAMES, SOURCE_WORDS, skillTextOf } from '../shared/home/plain-details.js';
import { NOTE_TITLES, agentOfSelected, bodyLines, detailsOf, programsOf, removeFromLabel, sameSelected } from '../shared/home/details.js';
import type { AgentDetails, NoteDetails, SkillDetails, ToolDetails } from '../shared/home/details.js';
import { CARD_WORDS, chipLabel, chipsOf, ownedAgents, shelvesOf } from '../shared/home/cards.js';
import { PLAIN_SKILLS } from '../shared/home/plain.js';
import { generateWorld } from '../shared/proto/sample.js';
import type { World } from '../shared/proto/types.js';
import { LIMITS, assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';
import { found, skill } from './proto-testworld.js';

const world = generateWorld(1);
const agents = ownedAgents(world);
const as = <T>(value: unknown): T => value as T;

// ---- The plain sample text.
test('every one of the 52 sample skills has 2 to 4 short plain lines, a known source, and no banned word', () => {
  const ids = world.items.filter(i => i.kind === 'skill').map(i => i.id);
  assert.equal(ids.length, 52); assert.deepEqual([...DETAIL_SKILL_IDS].sort(), [...ids].sort());
  assert.equal(new Set(DETAIL_SKILL_IDS).size, 52, 'no id twice');
  for (const id of ids) {
    const text = skillTextOf(id)!;
    assert.ok(text !== null, id);
    assert.ok(text.lines.length >= 2 && text.lines.length <= 4, `${id} has ${text.lines.length} lines`);
    assert.ok((Object.values(SOURCE_WORDS) as string[]).includes(text.source), id);
    for (const line of text.lines) {
      assert.ok(countWords(line) >= 3 && countWords(line) <= 20, `${id}: ${line}`);
      assert.match(line, /[.!?]$/, `${id} ends a line with a full stop: ${line}`);
      assert.equal(bannedIn(line), null, `${id}: ${line}`);
      assert.equal(line, line.trim());
    }
  }
});

test('the sample text is plain: none of the made-up words of the sample world is in it, and the three sources are all used', () => {
  const salad = ['cobalt', 'dovetail', 'inkwell', 'gantry', 'bellows', 'lantern', 'thistle', 'bobbin', 'tallow', 'keystone', 'satchel', 'nutmeg', 'jetty', 'thimble', 'mortar', 'wicker'];
  for (const id of DETAIL_SKILL_IDS) for (const line of skillTextOf(id)!.lines) for (const w of salad) assert.doesNotMatch(line.toLowerCase(), new RegExp(`\\b${w}`), `${id}: ${line}`);
  assert.deepEqual([...new Set(DETAIL_SKILL_IDS.map(id => skillTextOf(id)!.source))].sort(), Object.values(SOURCE_WORDS).sort());
  assert.deepEqual(SOURCE_WORDS, { you: 'Made by you', open: 'Open skills library', community: 'Community skills library' });
  assert.equal(skillTextOf('nope'), null); assert.equal(skillTextOf('toString'), null);
});

test('the sample skills\' own text is made-up words (so it is replaced), and no skill\'s plain text repeats its name or another skill\'s lines', () => {
  assert.match(world.items.find(i => i.id === 'skill-003')!.foundAt[0]!.text, /satchel|jetty|thimble|keystone/);
  const lines = DETAIL_SKILL_IDS.flatMap(id => skillTextOf(id)!.lines);
  assert.equal(new Set(lines).size, lines.length, 'no line is used twice');
});

test('the access words and the program names are the plain ones', () => {
  assert.deepEqual(ACCESS_WORDS, { 'read-only': 'Can only read', 'read-write': 'Can change things' });
  assert.deepEqual(PROGRAM_NAMES, { 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode' });
  for (const text of [...Object.values(ACCESS_WORDS), ...Object.values(SOURCE_WORDS)]) { assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text); assert.ok(countWords(text) <= LIMITS.label); }
});

// ---- The chips of an agent card.
test('chip labels are "12 skills", "1 tool", "1 notes set", singular and plural right, at most five words', () => {
  assert.deepEqual([chipLabel('skill', 12), chipLabel('skill', 1), chipLabel('tool', 2), chipLabel('tool', 1), chipLabel('note', 1), chipLabel('note', 2)], ['12 skills', '1 skill', '2 tools', '1 tool', '1 notes set', '2 notes sets']);
  for (const n of [0, 1, 2, 10, 123]) for (const kind of ['skill', 'tool', 'note'] as const) { assert.ok(countWords(chipLabel(kind, n)) <= 5); assert.equal(bannedIn(chipLabel(kind, n)), null); }
});

test('an agent has a chip for each kind it holds, in the order skills, tools, notes, and none for an empty kind', () => {
  const a1 = agents.find(a => a.id === 'agent-01')!;
  assert.deepEqual(chipsOf(shelvesOf(world, a1)).map(c => [c.kind, c.label]), [['skill', '3 skills'], ['tool', '1 tool'], ['note', '1 notes set']]);
  const a4 = agents.find(a => a.id === 'agent-04')!;
  assert.deepEqual(chipsOf(shelvesOf(world, a4)).map(c => c.label), ['4 skills', '1 notes set'], 'no tools, no chip');
  const a7 = agents.find(a => a.id === 'agent-07')!;
  assert.deepEqual(chipsOf(shelvesOf(world, a7)).map(c => c.label), ['3 skills']);
  const bare = chipsOf({ skills: [], tools: [], notes: [] });
  assert.deepEqual(bare, []);
});

// ---- The model.
test('a selection knows its agent, and two selections are the same only if they match in every part', () => {
  assert.equal(agentOfSelected(null), null);
  assert.equal(agentOfSelected({ kind: 'agent', id: 'a' }), 'a'); assert.equal(agentOfSelected({ kind: 'skill', id: 's', ownerAgentId: 'b' }), 'b'); assert.equal(agentOfSelected({ kind: 'skill', id: 's' }), null);
  assert.ok(sameSelected(null, null)); assert.ok(sameSelected({ kind: 'skill', id: 's', ownerAgentId: 'b' }, { kind: 'skill', id: 's', ownerAgentId: 'b' }));
  assert.ok(!sameSelected({ kind: 'skill', id: 's', ownerAgentId: 'b' }, { kind: 'skill', id: 's', ownerAgentId: 'c' })); assert.ok(!sameSelected(null, { kind: 'agent', id: 'a' }));
});

test('nothing selected, or a thing that is gone, has no details', () => {
  assert.equal(detailsOf(world, agents, null), null);
  assert.equal(detailsOf(world, agents, { kind: 'agent', id: 'agent-nope' }), null);
  assert.equal(detailsOf(world, agents, { kind: 'skill', id: 'skill-nope' }), null);
  assert.equal(detailsOf(world, agents, { kind: 'tool', id: 'skill-042' }), null, 'a skill id is not a tool');
  assert.equal(detailsOf(world, agents, { kind: 'note', id: 'slice-nope' }), null);
  assert.equal(detailsOf(world, agents, { kind: 'skill', id: 'skill-042', ownerAgentId: 'agent-07' }), null, 'an item opened from an agent that does not hold it');
  assert.equal(detailsOf(world, agents.filter(a => a.id !== 'agent-01'), { kind: 'skill', id: 'skill-042', ownerAgentId: 'agent-01' }), null, 'the owner is not on the map');
});

test('an agent: name, job, the programs it lives in, and its three shelves', () => {
  const d = as<AgentDetails>(detailsOf(world, agents, { kind: 'agent', id: 'agent-01' }));
  assert.equal(d.kind, 'agent'); assert.equal(d.name, 'Meeting assistant'); assert.equal(d.hint, 'Summarizes meetings and writes replies.');
  assert.deepEqual(d.works, ['Claude Code', 'Codex', 'OpenCode']);
  assert.deepEqual(d.shelves.skills.map(s => s.name), ['Summarize a meeting', 'Write a reply', 'List action items']); assert.equal(d.shelves.tools.length, 1); assert.equal(d.shelves.notes.length, 1);
  assert.deepEqual(as<AgentDetails>(detailsOf(world, agents, { kind: 'agent', id: 'agent-05' })).works, ['Codex']);
});

test('the programs of an item come in the order Claude Code, Codex, OpenCode, once each', () => {
  const at = (iface: 'claude-code' | 'codex' | 'opencode') => found(iface, '/x', iface);
  assert.deepEqual(programsOf([at('opencode'), at('claude-code')]), ['Claude Code', 'OpenCode']);
  assert.deepEqual(programsOf([at('codex'), at('codex')]), ['Codex']); assert.deepEqual(programsOf([]), []);
});

test('a skill: plain name and hint, who uses it, where it works, where it came from, its text, and the owner', () => {
  const d = as<SkillDetails>(detailsOf(world, agents, { kind: 'skill', id: 'skill-042', ownerAgentId: 'agent-01' }));
  assert.equal(d.name, 'Summarize a meeting'); assert.equal(d.hint, PLAIN_SKILLS['skill-042']!.hint);
  assert.deepEqual(d.owner, { id: 'agent-01', name: 'Meeting assistant' });
  assert.deepEqual([...d.usedBy.map(a => a.id)].sort(), ['agent-01', 'agent-08']);
  assert.deepEqual(d.works, ['Claude Code']); assert.equal(d.source, 'Made by you'); assert.equal(d.badge, null);
  assert.deepEqual(d.text, skillTextOf('skill-042')!.lines);
  const three = as<SkillDetails>(detailsOf(world, agents, { kind: 'skill', id: 'skill-triple' }));
  assert.deepEqual(three.works, ['Claude Code', 'Codex', 'OpenCode']); assert.equal(three.badge?.label, '3 different copies');
});

test('a skill the sample does not know brings its own text, without its front matter, and its library is named', () => {
  const own = { ...skill('s-new', 'weekly-digest', 'global', '---\nname: weekly-digest\n---\n\nCollect the headlines.\n\n  Put them in a list.\n') };
  const lib = { ...skill('s-lib', 'Library skill'), library: { library: 'example-lib', pinnedVersion: '1.0.0' } };
  const w: World = { ...world, items: [...world.items, own, lib], libraries: [...world.libraries, { id: 'example-lib', name: 'Example lib', installedVersion: '1.0.0' }] };
  const d = as<SkillDetails>(detailsOf(w, agents, { kind: 'skill', id: 's-new' }));
  assert.deepEqual(d.text, ['Collect the headlines.', 'Put them in a list.']); assert.equal(d.source, 'Made by you'); assert.equal(d.name, 'Weekly Digest');
  assert.equal(as<SkillDetails>(detailsOf(w, agents, { kind: 'skill', id: 's-lib' })).source, 'Example lib');
  const empty = { ...skill('s-empty', 'Empty'), foundAt: [] };
  assert.deepEqual(as<SkillDetails>(detailsOf({ ...w, items: [...w.items, empty] }, agents, { kind: 'skill', id: 's-empty' })).text, ['There is no text to show.']);
  assert.deepEqual(bodyLines('---\na: b\n---\nOne.\n\nTwo.'), ['One.', 'Two.']); assert.deepEqual(bodyLines('Just text.'), ['Just text.']); assert.deepEqual(bodyLines(''), []);
});

test('a tool: what it can reach, how far it may go for the agent that owns it, whether it needs a key, who uses it', () => {
  const calendar = as<ToolDetails>(detailsOf(world, agents, { kind: 'tool', id: 'tool-mcp-missing', ownerAgentId: 'agent-01' }));
  assert.equal(calendar.name, 'Read my calendar'); assert.equal(calendar.access, 'Can change things'); assert.equal(calendar.needsKey, true); assert.equal(calendar.keyReady, false); assert.equal(calendar.runsCode, false);
  assert.deepEqual(calendar.badge, { label: 'needs a key', tone: 'warn' });
  const web = as<ToolDetails>(detailsOf(world, agents, { kind: 'tool', id: 'tool-mcp-present', ownerAgentId: 'agent-02' }));
  assert.equal(web.access, 'Can only read'); assert.equal(web.needsKey, false); assert.equal(web.keyReady, true); assert.equal(web.badge, null);
  // The same tool, two agents, two access words: the one for the agent it was opened from.
  assert.equal(as<ToolDetails>(detailsOf(world, agents, { kind: 'tool', id: 'tool-prompt-01', ownerAgentId: 'agent-03' })).access, 'Can only read');
  assert.equal(as<ToolDetails>(detailsOf(world, agents, { kind: 'tool', id: 'tool-prompt-01', ownerAgentId: 'agent-06' })).access, 'Can change things');
  const open = as<ToolDetails>(detailsOf(world, agents, { kind: 'tool', id: 'tool-prompt-01' }));
  assert.equal(open.access, 'Can change things', 'with no owner it says the most any agent may do'); assert.equal(open.owner, null);
  assert.deepEqual(open.usedBy.map(a => a.id).sort(), ['agent-03', 'agent-06']);
  assert.equal(as<ToolDetails>(detailsOf(world, agents, { kind: 'tool', id: 'tool-mcp-present' })).access, 'Can only read', 'every agent may only read it');
});

test('a key is a reference: its name and its value are never in the details', () => {
  const tools = world.items.filter(i => i.kind === 'tool' && i.toolKind === 'mcp');
  for (const t of tools) {
    const a = agents.find(x => x.definition.toolAttachments.some(at => at.toolId === t.id));
    if (a === undefined) continue;
    const text = JSON.stringify(detailsOf(world, agents, { kind: 'tool', id: t.id, ownerAgentId: a.id }));
    if (t.kind === 'tool' && t.toolKind === 'mcp' && t.secret !== null) assert.ok(!text.includes(t.secret.name), `${t.id} leaks the name of its key`);
  }
  assert.ok(world.items.some(i => i.kind === 'tool' && i.toolKind === 'mcp' && i.secret !== null));
});

test('a tool that runs code says so; hooks stay out of every list of tools, so none reaches the panel in the sample', () => {
  const hook = world.items.find(i => i.kind === 'tool' && i.toolKind === 'hook')!;
  const d = as<ToolDetails>(detailsOf(world, agents, { kind: 'tool', id: hook.id }));
  assert.equal(d.runsCode, true);
  for (const a of agents) assert.ok(shelvesOf(world, a).tools.every(t => t.id !== hook.id), 'no agent lists a hook');
  assert.ok(agents.every(a => a.definition.toolAttachments.every(t => world.items.find(i => i.id === t.toolId)?.kind === 'tool')));
  const reaching = agents.flatMap(a => shelvesOf(world, a).tools).filter(t => as<ToolDetails>(detailsOf(world, agents, { kind: 'tool', id: t.id })).runsCode);
  assert.deepEqual(reaching, [], 'no tool of the lists runs code');
});

test('a set of notes: its name, what it covers, how many notes it can read, the first five titles, and who reads it', () => {
  const d = as<NoteDetails>(detailsOf(world, agents, { kind: 'note', id: 'slice-folders', ownerAgentId: 'agent-01' }));
  assert.equal(d.name, 'Client list'); assert.ok(d.count > 0); assert.equal(d.countLine, `${d.count} notes it can read.`);
  assert.equal(d.titles.length, NOTE_TITLES); assert.equal(new Set(d.titles).size, 5);
  assert.deepEqual(d.usedBy.map(a => a.id).sort(), ['agent-01', 'agent-04']); assert.deepEqual(d.owner, { id: 'agent-01', name: 'Meeting assistant' });
  assert.ok(d.topics.length > 0 && countWords(d.topics) <= 12);
  assert.equal(world.wikiPages.some(p => d.titles.includes(p.title)), false, 'plain titles, not the sample page titles');
});

test('the words of the details obey the same rules as every other screen word', () => {
  assert.equal(removeFromLabel('Meeting assistant'), 'Remove from Meeting assistant'); assert.equal(removeFromLabel('Interview note taker for kids'), 'Remove from this agent');
  for (const a of agents) assert.ok(countWords(removeFromLabel(a.name)) <= 5);
  assert.ok(Object.values(CARD_WORDS).every(t => bannedIn(t) === null));
});
