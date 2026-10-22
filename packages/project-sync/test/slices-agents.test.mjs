// Spec 05, section 10.13: how an agent names slices, and the read guard in its copy.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { denyNetwork } from './sync-fixture.mjs';
import { projectId, identityFrom } from '../../../dist/packages/project-context/src/discovery.js';
import { hash, wikiProject, createSlice, rewriteSlice, sliceAgent, plan, applied, review, byId, read, claudeAgent, agentText, agentSource } from './slices-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));
const lead = p => p.agents.find(a => a.id === 'lead');
const front = text => parse(text.split('\n---\n')[0].replace(/^---\n/, ''));
const guardArgs = (f, role = 'lead') => front(read(f, `.claude/agents/${role}.md`)).hooks.PreToolUse.at(-1).hooks[0].args;
const WARN = x => new RegExp(`^ {2} +Warning: agent lead names slice-${x}, and no slice ${x} is registered\\. Claude Code skips a preloaded skill it cannot find\\.$`, 'm');

test('1. an agent with skills: slice-wiki gets context.slices: [wiki]', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki', 'other-skill']);
  const a = lead(await plan(f, ['claude'])); assert.deepEqual(a.context.slices, ['wiki']); assert.deepEqual(a.context.guard, ['wiki']); assert.equal(a.context.omitClaudeMd, false);
  const slice = (await plan(f, ['claude'])).slices[0]; assert.deepEqual(slice.agents, ['lead']);
});
test('2. an unknown slice- name prints the warning and fills context.unknown', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-ghost']); const p = await plan(f, ['claude']);
  assert.deepEqual(lead(p).context.unknown, ['ghost']); assert.match(review(p), WARN('ghost')); assert.equal(lead(p).action, 'install'); assert.equal(lead(p).context.guard, null);
});
test('3. a slice-old that resolves to a plain skill gives no warning and fills context.plainSkills', async t => {
  const f = await wikiProject(t, { slice: false }); fs.mkdirSync(path.join(f.bowerloom, 'skills/slice-old'), { recursive: true, mode: 0o755 }); sliceAgent(f, 'lead', ['slice-old']);
  const p = await plan(f, ['claude']); assert.deepEqual(lead(p).context.plainSkills, ['slice-old']); assert.deepEqual(lead(p).context.unknown, []); assert.doesNotMatch(review(p), /Warning: agent lead names slice/);
});
test('4. a slice entry at position 33 prints the preload warning', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', [...Array.from({ length: 32 }, (_, i) => 'skill-' + String(i).padStart(2, '0')), 'slice-wiki']);
  const p = await plan(f, ['claude']); assert.deepEqual(lead(p).context.beyondPreloadLimit, ['wiki']);
  assert.match(review(p), /^ {2} +Warning: slice-wiki is skill 33 in the skills list of agent lead\. Claude Code preloads the first 32 only\.$/m);
});
test('5. a guarded slice puts the guard in the copy and prints the guard note', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']); const p = await plan(f, ['claude']);
  assert.match(review(p), /^ {2}Note: agent lead gets the Bowerloom read guard for slices wiki\. Claude Code runs it only in a folder you trusted, never in a claude -p run, and only when bowerloom-guard is on your PATH\. It needs Claude Code 2\.1\.295 or later\.$/m);
  await applied(f, ['claude']);
  const hook = front(read(f, '.claude/agents/lead.md')).hooks.PreToolUse.at(-1); assert.equal(hook.matcher, 'Read|Grep|Glob'); assert.equal(hook.hooks[0].command, 'bowerloom-guard'); assert.equal(hook.hooks[0].onFailure, 'block');
});
test('6. a guard: none slice puts no guard in the copy', async t => {
  const f = await wikiProject(t, { guard: 'none' }); sliceAgent(f, 'lead', ['slice-wiki']); const p = await plan(f, ['claude']);
  assert.equal(lead(p).context.guard, null); assert.doesNotMatch(review(p), /read guard/); await applied(f, ['claude']); assert.equal(front(read(f, '.claude/agents/lead.md')).hooks, undefined);
  assert.equal(read(f, '.claude/agents/lead.md'), agentText('lead', 'skills: [slice-wiki]'));
});
test('7. mixed guard modes list both ids in the args', async t => {
  const f = await wikiProject(t); await createSlice(f, 'open', { root: 'wiki' }); rewriteSlice(f, 'open', s => s.replace('guard: root', 'guard: none')); sliceAgent(f, 'lead', ['slice-wiki', 'slice-open']);
  await applied(f, ['claude']); const args = guardArgs(f);
  assert.deepEqual(args.filter((x, i) => args[i - 1] === '--slice'), ['open', 'wiki']); assert.equal(args.filter(x => x === '--root').length, 2);
});
test('8. a held SLICE_INVALID slice still counts as guarded', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']); rewriteSlice(f, 'wiki', s => s + 'bogus: 1\n');
  const a = lead(await plan(f, ['claude'])); assert.deepEqual(a.context.guard, ['wiki']); assert.deepEqual(a.context.guardRoots, []);
});
test('9. a guarded slice that is held and never installed prints the held warning', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']); fs.rmSync(path.join(f.projectDir, 'wiki'), { recursive: true });
  const p = await plan(f, ['claude']); assert.deepEqual(lead(p).context.heldNeverInstalled, ['wiki']);
  assert.match(review(p), /^ {2} +Warning: agent lead names slice wiki, which is held and was never installed\. Its read guard blocks every Read, Grep, and Glob until the slice installs\.$/m);
});
test('10. without omitClaudeMd, the omit note prints', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']);
  assert.match(review(await plan(f, ['claude'])), /^ {2}Note: agent lead names slices and also loads the CLAUDE\.md or AGENTS\.md files at start\. Set omitClaudeMd: true to start it with its slices only\. bowerloom context measure shows the difference\.$/m);
  sliceAgent(f, 'lead', ['slice-wiki'], 'omitClaudeMd: true'); assert.doesNotMatch(review(await plan(f, ['claude'])), /also loads the CLAUDE\.md/);
});
test('11. with tools: Read, Grep, Glob, no read-gap note prints', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki'], 'tools: Read, Grep, Glob'); assert.doesNotMatch(review(await plan(f, ['claude'])), /can still read files with/);
});
test('12. with tools absent, the read-gap note names shell tools, LSP, nested agents, and MCP tools', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']);
  assert.match(review(await plan(f, ['claude'])), /^ {2}Note: agent lead can still read files with shell tools, LSP, nested agents and MCP tools\. The guard checks Read, Grep, and Glob only\.$/m);
});
test('13. with mcpServers set and tools: Read, the read-gap note names MCP tools', async t => {
  const f = await wikiProject(t); const file = sliceAgent(f, 'lead', ['slice-wiki'], 'tools: Read\nmcpServers:\n  - docs');
  const held = await plan(f, ['claude']); assert.equal(lead(held).hold.code, 'AGENT_GRANT_REVIEW_REQUIRED');
  const allowed = await plan(f, ['claude'], { allow: [`lead:${hash(fs.readFileSync(file))}`] });
  assert.equal(lead(allowed).action, 'install'); assert.match(review(allowed), /^ {2}Note: agent lead can still read files with MCP tools\. The guard checks Read, Grep, and Glob only\.$/m);
});
test('14. a change of guard list plans update agent', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']); await applied(f, ['claude']); await createSlice(f, 'second', { root: 'wiki' }); sliceAgent(f, 'lead', ['slice-wiki', 'slice-second']);
  const p = await plan(f, ['claude']); assert.deepEqual([lead(p).state, lead(p).action], ['edited', 'update']); await applied(f, ['claude']);
  const args = guardArgs(f); assert.deepEqual(args.filter((x, i) => args[i - 1] === '--slice'), ['second', 'wiki']);
});
test('15. a hand-made copy equal to the source holds AGENT_TARGET_OCCUPIED when the copy gets a guard', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']); claudeAgent(f, 'lead.md', agentText('lead', 'skills: [slice-wiki]'));
  const a = lead(await plan(f, ['claude'])); assert.deepEqual([a.action, a.hold.code], ['hold', 'AGENT_TARGET_OCCUPIED']);
});
test('16. hooks: [] holds AGENT_GUARD_CONFLICT, and no AGENT_TARGET_OCCUPIED hold is reported for it', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki'], 'hooks: []'); claudeAgent(f, 'lead.md', 'something else\n');
  const a = lead(await plan(f, ['claude'])); assert.deepEqual([a.action, a.hold.code], ['hold', 'AGENT_GUARD_CONFLICT']);
  assert.equal(a.hold.next, 'Make hooks a map and hooks.PreToolUse a list in .bowerloom/teams/first-team/agents/lead.md, then run bowerloom apply.');
});
test('17. STALE_APPROVAL when the guard mode of a slice changes after the plan', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']); const p = await plan(f, ['claude']);
  rewriteSlice(f, 'wiki', s => s.replace('guard: root', 'guard: none'));
  const { applyProjectApply } = await import('../../../dist/packages/project-sync/src/index.js');
  await assert.rejects(applyProjectApply(f.input(['claude']), p.revision, new AbortController().signal), e => e.code === 'STALE_APPROVAL');
});
test('18. the tracked-copy note prints once with no .gitignore line, and not with /.claude/', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']); sliceAgent(f, 'second', ['slice-wiki']); fs.mkdirSync(path.join(f.projectDir, '.git'));
  const text = review(await plan(f, ['claude']));
  const notes = text.match(/Note: the read guard in the copies of agents lead and second names this project's folder, /g); assert.equal(notes?.length, 1, text);
  assert.ok(text.includes(`names this project's folder, ${f.projectDir}. Bowerloom found no .gitignore line that keeps .claude/agents out of git. A committed copy carries a path from this machine. On another machine its guard blocks every read, and apply holds the copy until it is moved aside.`));
  fs.writeFileSync(path.join(f.projectDir, '.gitignore'), '/.claude/\n'); assert.doesNotMatch(review(await plan(f, ['claude'])), /Bowerloom found no \.gitignore line/);
  fs.writeFileSync(path.join(f.projectDir, '.gitignore'), '.claude/agents\n!.claude/agents/keep.md\n'); assert.match(review(await plan(f, ['claude'])), /Bowerloom found no \.gitignore line/);
  fs.writeFileSync(path.join(f.projectDir, '.gitignore'), '# ignore\n\n**/.claude/agents/   \n'); assert.doesNotMatch(review(await plan(f, ['claude'])), /Bowerloom found no \.gitignore line/);
});
test('18b. no repository folder, no tracked-copy note', async t => { const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']); assert.doesNotMatch(review(await plan(f, ['claude'])), /Bowerloom found no \.gitignore line/); });
test('19. the copy holds the project real path and projectId', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki']); await applied(f, ['claude']); const args = guardArgs(f);
  const id = projectId(f.projectDir, identityFrom(fs.lstatSync(f.projectDir, { bigint: true })));
  assert.equal(args[args.indexOf('--project') + 1], f.projectDir); assert.equal(args[args.indexOf('--project-id') + 1], id); assert.equal(args[args.indexOf('--agent') + 1], 'lead');
  const wikiRoot = path.join(f.projectDir, 'wiki'), rootId = projectId(wikiRoot, identityFrom(fs.lstatSync(wikiRoot, { bigint: true })));
  assert.equal(args[args.indexOf('--root') + 1], `wiki:${rootId}`);
});
test('20. a guarded agent with isolation: worktree holds AGENT_GUARD_WORKTREE', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki'], 'isolation: worktree'); const a = lead(await plan(f, ['claude']));
  assert.deepEqual([a.action, a.hold.code, a.hold.next], ['hold', 'AGENT_GUARD_WORKTREE', "Remove isolation: worktree or the agent's slices, then run bowerloom apply."]);
  const g = await wikiProject(t, { guard: 'none' }); sliceAgent(g, 'lead', ['slice-wiki'], 'isolation: worktree'); assert.equal(lead(await plan(g, ['claude'])).action, 'install');
});
test('21. the whole-project search note prints for a guarded root wiki and tools: Read, Grep', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki'], 'tools: Read, Grep');
  assert.match(review(await plan(f, ['claude'])), /^ {2}Note: agent lead must pass a path to Grep and Glob\. A search of the whole project reaches the guarded folder wiki\.$/m);
  const g = await wikiProject(t); sliceAgent(g, 'lead', ['slice-wiki'], 'tools: Read'); assert.doesNotMatch(review(await plan(g, ['claude'])), /must pass a path/);
});
test('22. tools: Task(x) and tools: ReadMcpResourceTool name nested agents and MCP tools in the read-gap note', async t => {
  const f = await wikiProject(t); sliceAgent(f, 'lead', ['slice-wiki'], 'tools: Task(x), ReadMcpResourceTool');
  assert.match(review(await plan(f, ['claude'])), /^ {2}Note: agent lead can still read files with nested agents and MCP tools\. The guard checks Read, Grep, and Glob only\.$/m);
  const g = await wikiProject(t); sliceAgent(g, 'lead', ['slice-wiki'], 'tools: Bash(git *), LSP'); assert.match(review(await plan(g, ['claude'])), /read files with shell tools and LSP\./);
});
test('an agent that names no slice is unchanged and has an empty context', async t => {
  const f = await wikiProject(t); agentSource(f, 'first-team', 'plain.md', agentText('plain')); const a = byId((await plan(f, ['claude'])).agents).plain;
  assert.deepEqual(a.context, { slices: [], guard: null, guardRoots: [], unknown: [], beyondPreloadLimit: [], plainSkills: [], heldNeverInstalled: [], omitClaudeMd: false, beyondPreloadPositions: [], tools: null, mcpServers: false });
});
