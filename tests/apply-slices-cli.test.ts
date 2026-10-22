// Spec 05, section 10.21: apply, status, ls, up, and help with slices, through the real command line.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOPICS } from '../apps/cli/src/human.js';
import { SYNC_REFUSAL_CODES } from '../packages/project-sync/src/index.js';
import { AUTHORING_REFUSAL_CODES } from '../packages/project-authoring/src/index.js';
import { approve, folder, put, run, sliceProject, revisionIn, tamperCatalog } from './support/slice-project.js';

const lines = (text: string): string[] => text.split('\n');
const errors = readFileSync(new URL('../../apps/docs/src/content/docs/reference/errors.md', import.meta.url), 'utf8');

test('1. renderApplyReview golden text for install, update, up to date, kept, and held slices', t => {
  const p = sliceProject(t, { apply: false }), install = run(p.dir, ['apply', '--harness', 'claude'], p.home);
  assert.equal(install.status, 3, install.stderr);
  assert.match(install.stdout, /^Apply skills, prompts, agents, and context slices for Claude Code$/m);
  assert.match(install.stdout, /^ {2}wiki +install slice: \.claude\/skills\/slice-wiki\/SKILL\.md \(2 files from wiki\)$/m);
  approve(p.dir, ['apply', '--harness', 'claude'], p.home);
  const same = run(p.dir, ['apply', '--harness', 'claude'], p.home); assert.equal(same.status, 0); assert.match(same.stdout, /^ {2}wiki +slice up to date$/m); assert.match(same.stdout, /Nothing to change\.\n$/);
  put(p.dir, 'wiki/a.md', '# Alpha again\n'); const update = run(p.dir, ['apply', '--harness', 'claude'], p.home);
  assert.match(update.stdout, /^ {2}wiki +update slice: \.claude\/skills\/slice-wiki\/SKILL\.md \(0 added, 0 gone, 1 summaries changed\)$/m);
  rmSync(join(p.dir, 'wiki/sub'), { recursive: true }); rmSync(join(p.dir, 'wiki/a.md')); const held = run(p.dir, ['apply', '--harness', 'claude'], p.home);
  assert.match(held.stdout, /^ {2}wiki +slice held \(SLICE_EMPTY\)\n {2} +Next: Widen include in \.bowerloom\/slices\/wiki\.yaml, then run bowerloom apply\.$/m); assert.equal(held.status, 0);
  assert.match(held.stdout, /Nothing to change\.\n$/);
});
test('2. golden text for the agent warnings and notes', t => {
  const p = sliceProject(t, { apply: false }), r = run(p.dir, ['apply', '--harness', 'claude'], p.home);
  for (const expected of [
    /^ {2}Note: agent lead names slices and also loads the CLAUDE\.md or AGENTS\.md files at start\. Set omitClaudeMd: true to start it with its slices only\. bowerloom context measure shows the difference\.$/m,
    /^ {2}Note: agent lead gets the Bowerloom read guard for slices wiki\. Claude Code runs it only in a folder you trusted, never in a claude -p run, and only when bowerloom-guard is on your PATH\. It needs Claude Code 2\.1\.295 or later\.$/m,
    /^ {2}Note: agent lead can still read files with shell tools, LSP, nested agents and MCP tools\. The guard checks Read, Grep, and Glob only\.$/m,
    /^ {2}Note: agent lead must pass a path to Grep and Glob\. A search of the whole project reaches the guarded folder wiki\.$/m,
  ]) assert.match(r.stdout, expected);
});
test('3. the result words for slices', t => {
  const p = sliceProject(t, { apply: false }), planned = run(p.dir, ['apply', '--harness', 'claude'], p.home);
  const done = run(p.dir, ['apply', '--harness', 'claude', '--approve', revisionIn(planned.stdout)], p.home);
  assert.equal(done.status, 0, done.stderr); assert.match(done.stdout, /^ {2}slice wiki: installed$/m); assert.match(done.stdout, /^ {2}agent lead: installed$/m);
  assert.ok(done.stdout.indexOf('slice wiki: installed') < done.stdout.indexOf('agent lead: installed'));
  assert.match(done.stdout, /Context slices are skills named slice-<name> in \.claude\/skills\./);
});
test('4. status prints the edited, held, and stale-index slice lines, and the owner-refused line for an unknown key', t => {
  const p = sliceProject(t), file = join(p.dir, '.bowerloom/slices/wiki.yaml');
  assert.match(run(p.dir, ['status'], p.home).stdout, /Setup: ready/);
  put(p.dir, 'wiki/new.md', '# New\n'); const stale = run(p.dir, ['status'], p.home);
  assert.match(stale.stdout, /^ {2}slice wiki: index out of date \(1 added, 0 gone, 0 summaries changed\)\. Next: bowerloom apply$/m);
  writeFileSync(file, readFileSync(file, 'utf8') + 'maxFiles: 50\n'); const edited = run(p.dir, ['status'], p.home);
  assert.match(edited.stdout, /^ {2}edited: \.bowerloom\/slices\/wiki\.yaml$/m);
  writeFileSync(file, readFileSync(file, 'utf8') + 'includes: [x]\n'); const bad = run(p.dir, ['status'], p.home);
  assert.match(bad.stdout, /^ {2}owner-refused: \.bowerloom\/slices \(SLICE_INVALID\)$/m);
  assert.match(bad.stdout, /^ {2}slice wiki: held \(SLICE_KEY_UNKNOWN\)\. Next: Remove the key includes from \.bowerloom\/slices\/wiki\.yaml, then run bowerloom apply\.$/m);
});
test('5. ls slices lists the slice files, and ls --json holds slices', t => {
  const p = sliceProject(t, { apply: false });
  assert.equal(run(p.dir, ['ls', 'slices'], p.home).stdout, 'Slices\n  wiki  project\n');
  const all = run(p.dir, ['ls'], p.home).stdout; assert.ok(all.indexOf('Prompts') < all.indexOf('Slices'), all);
  assert.deepEqual((JSON.parse(run(p.dir, ['ls', '--json'], p.home).stdout) as { slices: { id: string }[] }).slices.map(x => x.id), ['wiki']);
  const bad = run(p.dir, ['ls', 'nothing'], p.home); assert.equal(bad.status, 2); assert.match(bad.stderr, /Use bowerloom ls \[teams\|skills\|prompts\|slices\] \[--global\] \[--json\]\./);
});
test('6. up --team stops at the apply step with the new step text when a slice is the only work', t => {
  const p = sliceProject(t); put(p.dir, 'wiki/a.md', '# Alpha, new title\n');
  const q = run(p.dir, ['up', '--team', 'first-team'], p.home);
  assert.equal(q.status, 3, q.stderr + q.stdout); assert.match(q.stdout, /^Next step: apply\. Put the skills, prompts, agents, and context slices of team .+ in place for Claude Code and Codex\.$/m);
});
test('7. help apply shows the slice sentences', t => {
  const home = folder(t), r = run(home, ['help', 'apply'], home);
  assert.match(r.stdout, /A context slice in \.bowerloom\/slices\/<name>\.yaml becomes the skill \.claude\/skills\/slice-<name>\/SKILL\.md, a list\nof paths\. An agent whose skills list names slice-<name> loads it at start and reads the files where they are\.\nSuch an agent also gets a read guard in its copy\. See bowerloom help context\./);
  assert.equal(lines(TOPICS.apply!).includes('Such an agent also gets a read guard in its copy. See bowerloom help context.'), true);
});
test('8. every code of section 5 has words in human.ts and a row in errors.md', () => {
  const codes = ['SLICE_INVALID', 'SLICE_KEY_UNKNOWN', 'SLICE_NAME_INVALID', 'SLICE_EXISTS', 'SLICE_LIMIT', 'SLICE_PATH_MISSING', 'SLICE_ROOT_MISSING', 'SLICE_ROOT_UNSAFE', 'SLICE_SOURCE_UNSAFE', 'SLICE_EMPTY', 'SLICE_TOO_LARGE', 'SLICE_TARGET_OCCUPIED', 'AGENT_GUARD_CONFLICT', 'AGENT_GUARD_WORKTREE', 'CONTEXT_SLICE_NOT_FOUND', 'CONTEXT_AGENT_NOT_FOUND', 'CONTEXT_BASELINE_INVALID', 'CONTEXT_MEASURE_LIMIT', 'GUARD_OUTSIDE_SLICE', 'GUARD_SLICE_NOT_INSTALLED', 'GUARD_ROOT_MISSING', 'GUARD_PROJECT_MISMATCH', 'GUARD_INPUT_INVALID', 'GUARD_INTERNAL_ERROR'];
  for (const c of codes) { assert.ok((SYNC_REFUSAL_CODES as readonly string[]).includes(c) || (AUTHORING_REFUSAL_CODES as readonly string[]).includes(c), c); assert.match(errors, new RegExp('\\| `' + c + '` \\|'), `errors.md has a row for ${c}`); }
});

test('B1. a slice of a registered folder: the apply review, the held line when the folder is gone, show, and status', t => {
  const p = sliceProject(t, { apply: false, registered: true }), install = run(p.dir, ['apply', '--harness', 'claude'], p.home);
  assert.equal(install.status, 3, install.stderr);
  assert.match(install.stdout, /^ {2}wiki +install slice: \.claude\/skills\/slice-wiki\/SKILL\.md \(2 files from registered folder kb \(\.\.\/kb\/wiki\)\)$/m);
  assert.ok(install.stdout.includes(`  Note: slice wiki reads ../kb/wiki, outside this project. Claude Code may ask before it reads there. Start Claude Code with --add-dir ${join(p.kb!, 'wiki')}, or add the folder to permissions.additionalDirectories.\n`), install.stdout);
  assert.ok(install.stdout.includes(`  Note: slice wiki copies the first heading of 2 files from ${join(p.kb!, 'wiki')} into .claude/skills/slice-wiki/SKILL.md.\n`), install.stdout);
  approve(p.dir, ['apply', '--harness', 'claude'], p.home);
  const shown = run(p.dir, ['context', 'show', 'wiki'], p.home); assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /^Slice wiki: 2 files from registered folder kb \(\.\.\/kb\/wiki\)\nIndex: \.claude\/skills\/slice-wiki\/SKILL\.md, \d+ bytes \(installed and the same\)\nGuard: root\nAgents: lead\nNotes:\n {2}reads \.\.\/kb\/wiki, outside this project\./);
  const status = run(p.dir, ['status'], p.home); assert.match(status.stdout, /slice wiki: 2 notes, run bowerloom context show wiki/);
  rmSync(join(p.home, '.bowerloom/folders/kb.json'));
  const held = run(p.dir, ['apply', '--harness', 'claude'], p.home);
  assert.match(held.stdout, /^ {2}wiki +slice held \(SLICE_ROOT_MISSING\)\n {2} +Next: Run bowerloom folder list, or register the folder with bowerloom folder add <folder-name> <path>, then run bowerloom apply\.$/m);
  assert.match(held.stdout, /Warning: agent lead names slice wiki, which is held, so its read guard blocks every Read, Grep, and Glob until the slice installs\./);
  const json = run(p.dir, ['context', 'show', 'wiki', '--json'], p.home); assert.equal((JSON.parse(json.stdout) as { registered: string }).registered, 'kb');
});

test('8b. every folder code (Part B) has a refusal sentence and a row in errors.md, and the project layer raises it', async () => {
  const { projectRefusal } = await import('../packages/project-context/src/index.js');
  for (const c of ['FOLDER_NAME_INVALID', 'FOLDER_EXISTS', 'FOLDER_NOT_FOUND', 'FOLDER_UNSAFE', 'FOLDER_IN_CLOUD', 'FOLDER_INVALID', 'FOLDER_NOT_ALLOWED']) {
    assert.match(errors, new RegExp('\\| `' + c + '` \\|'), `errors.md has a row for ${c}`);
    assert.equal(projectRefusal(c as 'FOLDER_EXISTS').code, c); assert.doesNotMatch(projectRefusal(c as 'FOLDER_EXISTS').message, /\//, `${c} message carries no path`);
  }
});

test('S9. an installed slice whose record cannot be trusted is still installed, and the plan holds it with a reason', async t => {
  const p = sliceProject(t);
  await tamperCatalog(p, 'slice_wiki', c => { delete c.references; });
  const plan = run(p.dir, ['apply', '--harness', 'claude', '--json'], p.home); assert.equal(plan.status, 0, plan.stdout + plan.stderr); const out = (JSON.parse(plan.stdout) as { plan: { slices: unknown } }).plan as unknown as { slices: { id: string; installed: boolean; state: string; hold: { code: string } | null; changes: { added: number } }[] };
  assert.deepEqual((JSON.parse(plan.stdout) as { plan: { agents: { context: { heldNeverInstalled: string[]; heldAfterInstalled: string[] } }[] } }).plan.agents[0]!.context, { ...(JSON.parse(plan.stdout) as { plan: { agents: { context: object }[] } }).plan.agents[0]!.context, heldNeverInstalled: [], heldAfterInstalled: ['wiki'] });
  assert.equal(out.slices[0]!.installed, true, 'the copy is on disk');
  assert.equal(out.slices[0]!.hold !== null, true); assert.equal(out.slices[0]!.changes.added, 0, 'no member is reported as added');
});

test('S9. status does not hide a slice problem when the whole plan refuses', t => {
  const p = sliceProject(t); const slices = join(p.dir, '.bowerloom/slices');
  renameSync(slices, join(p.dir, '.bowerloom/slices-real')); symlinkSync('slices-real', slices);
  const r = run(p.dir, ['status'], p.home); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}unsafe: \.bowerloom\/slices$/m); assert.match(r.stdout, /^ {2}plan unavailable \(AUTHORING_UNSAFE_PATH\)$/m); assert.match(r.stdout, /^Setup: drifted$/m);
});
