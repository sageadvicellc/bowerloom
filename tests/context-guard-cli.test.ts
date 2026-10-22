// Spec 05, section 10.19: the read guard, through the real binaries `bowerloom-guard` and `bowerloom context guard`.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INPUT_INVALID_TEXT } from '../apps/cli/src/guard-run.js';
import { approve, denyJson, envFor, folder, guardArgs, guardMain, hookInput, put, run, sliceProject, tamperCatalog } from './support/slice-project.js';
import { safeReference } from '../apps/cli/src/guard-view.js';

const tree = (dir: string): string => JSON.stringify(readdirSync(dir, { recursive: true }).map(String).sort().map(rel => { const s = lstatSync(join(dir, rel)); return [rel, s.isFile() ? createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex') : 'dir']; }));
const guard = (p: { dir: string; home: string }, args: string[], input: string, env?: NodeJS.ProcessEnv) => run(p.dir, args, p.home, { input, ...(env ? { env } : {}) }, guardMain);
const read = (path: string, cwd: string) => hookInput('Read', { file_path: path }, cwd);

test('1. the guard with stdin of a member Read prints nothing and exits 0', t => {
  const p = sliceProject(t), r = guard(p, guardArgs(p), read(join(p.dir, 'wiki/a.md'), p.dir));
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, ''); assert.equal(r.stderr, '');
  const viaCli = run(p.dir, ['context', 'guard', ...guardArgs(p)], p.home, { input: read(join(p.dir, 'wiki/sub/b.md'), p.dir) }); assert.equal(viaCli.status, 0, viaCli.stderr); assert.equal(viaCli.stdout, '');
  assert.equal(guard(p, guardArgs(p), hookInput('Bash', { command: 'cat wiki/secret.txt' }, p.dir)).stdout, '', 'a shell call is not checked');
  assert.equal(guard(p, guardArgs(p), read(join(p.dir, 'AGENTS.md'), p.dir)).stdout, '', 'a read outside the root is left to Claude Code');
});
test('2. a non-member Read prints the exact deny JSON on stdout and exits 0', t => {
  const p = sliceProject(t), file = join(p.dir, 'wiki/secret.txt'), r = guard(p, guardArgs(p), read(file, p.dir));
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, '');
  assert.equal(r.stdout, denyJson(`Bowerloom guard: ${file} is under wiki, and no context slice of agent lead (wiki) lists it. Read the files that your slice skills list. To widen a slice, ask the main session to edit .bowerloom/slices/wiki.yaml and run bowerloom apply.`));
  const grep = guard(p, guardArgs(p), hookInput('Grep', { pattern: 'x' }, join(p.dir, 'wiki')));
  assert.equal(grep.stdout, denyJson(`Bowerloom guard: a search of ${join(p.dir, 'wiki')} would reach files that no context slice of agent lead (wiki) lists. Search one listed file, or a folder whose files are all listed: wiki/sub.`));
  assert.equal(guard(p, guardArgs(p), hookInput('Grep', { pattern: 'x', path: join(p.dir, 'wiki/sub') }, p.dir)).stdout, '');
  assert.equal(guard(p, guardArgs(p), hookInput('Glob', { pattern: 'wiki/**/*.md' }, p.dir)).stdout.length > 0, true, 'the folder wiki holds a file the slice does not list');
});
test('3. invalid stdin exits 2 with the exact text on stderr and nothing on stdout', t => {
  const p = sliceProject(t);
  for (const input of ['not json', '', '{"tool_name":"Read"}', JSON.stringify({ tool_name: 'Read', tool_input: [], cwd: p.dir }), JSON.stringify({ tool_name: 5, tool_input: {}, cwd: p.dir }), JSON.stringify({ tool_name: 'Read', tool_input: {}, cwd: 'relative' }), '{"tool_name":"Read","tool_name":"Read","tool_input":{},"cwd":"/"}']) {
    const r = guard(p, guardArgs(p), input); assert.equal(r.status, 2, input); assert.equal(r.stdout, ''); assert.equal(r.stderr, INPUT_INVALID_TEXT); assert.equal(r.stderr, 'Bowerloom guard: the hook input could not be read, so the call is blocked.');
  }
  assert.equal(guard(p, guardArgs(p), hookInput('Read', { file_path: 5 }, p.dir)).status, 2);
});
test('4. a --project-id that does not match the folder denies with GUARD_PROJECT_MISMATCH', t => {
  const p = sliceProject(t), args = guardArgs(p), i = args.indexOf('--project-id'); args[i + 1] = '0'.repeat(32);
  const r = guard(p, args, read(join(p.dir, 'wiki/a.md'), p.dir)); assert.equal(r.status, 0);
  assert.equal(r.stdout, denyJson(`Bowerloom guard: the project at ${p.dir} does not manage agent lead, or it is not the folder that apply wrote this copy for. Run bowerloom apply in the project that holds .claude/agents/lead.md.`));
  const moved = guardArgs(p); moved[moved.indexOf('--project') + 1] = join(p.home, 'elsewhere'); assert.match(guard(p, moved, read('/etc/hosts', p.dir)).stdout, /does not manage agent lead/);
});
test('5. a project without agent_<role> denies with GUARD_PROJECT_MISMATCH', t => {
  const p = sliceProject(t, { apply: false });
  const fake = ['--agent', 'lead', '--project', p.dir, '--project-id', '1'.repeat(32), '--slice', 'wiki'];
  assert.match(guard(p, fake, read(join(p.dir, 'wiki/a.md'), p.dir)).stdout, /does not manage agent lead/);
});
test('6. --explain <path> prints the exact allowed and denied lines', t => {
  const p = sliceProject(t), ok = run(p.dir, ['context', 'guard', '--agent', 'lead', '--explain', join(p.dir, 'wiki/a.md')], p.home), no = run(p.dir, ['context', 'guard', '--agent', 'lead', '--explain', 'wiki/secret.txt'], p.home);
  assert.equal(ok.status, 0, ok.stderr); assert.equal(ok.stdout, `allowed: ${join(p.dir, 'wiki/a.md')} is in slice wiki\n`);
  assert.equal(no.status, 0, no.stderr); assert.equal(no.stdout, `denied (GUARD_OUTSIDE_SLICE): Bowerloom guard: wiki/secret.txt is under wiki, and no context slice of agent lead (wiki) lists it. Read the files that your slice skills list. To widen a slice, ask the main session to edit .bowerloom/slices/wiki.yaml and run bowerloom apply.\n`);
  assert.equal(run(p.dir, ['context', 'guard', '--agent', 'lead', '--explain', '/etc/hosts'], p.home).stdout, 'allowed: no guard rule applies to /etc/hosts\n');
  const gone = run(p.dir, ['context', 'guard', '--agent', 'nobody', '--explain', 'x'], p.home); assert.equal(gone.status, 1); assert.equal((JSON.parse(gone.stderr) as { error: { code: string } }).error.code, 'CONTEXT_AGENT_NOT_FOUND');
  const tool = run(p.dir, ['context', 'guard', '--agent', 'lead', '--explain', 'wiki', '--tool', 'Grep'], p.home); assert.match(tool.stdout, /^denied \(GUARD_OUTSIDE_SLICE\): Bowerloom guard: a search of wiki would reach files/);
});
test('7. twenty calls each finish within 2000 ms, and the test prints the 50th and 95th percentile', t => {
  const p = sliceProject(t), times: number[] = [], args = guardArgs(p);
  for (let i = 0; i < 25; i++) {
    const input = read(join(p.dir, i % 2 ? 'wiki/secret.txt' : 'wiki/a.md'), p.dir), start = process.hrtime.bigint(), r = guard(p, args, input), ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.equal(r.status, 0, r.stderr); if (i >= 5) times.push(ms);
  }
  times.sort((a, b) => a - b); const at = (q: number): number => times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)]!;
  console.log(`guard latency over ${times.length} calls: p50 ${at(0.5).toFixed(0)} ms, p95 ${at(0.95).toFixed(0)} ms, max ${times.at(-1)!.toFixed(0)} ms`);
  for (const ms of times) assert.ok(ms < 2000, `${ms} ms`);
});
test('8. the guard writes nothing and creates no folder', t => {
  const p = sliceProject(t), before = [tree(p.dir), tree(join(p.home, 'state'))], args = guardArgs(p);
  for (const input of [read(join(p.dir, 'wiki/a.md'), p.dir), read(join(p.dir, 'wiki/secret.txt'), p.dir), hookInput('Glob', { pattern: '**/*.md' }, p.dir), 'garbage']) guard(p, args, input);
  assert.deepEqual([tree(p.dir), tree(join(p.home, 'state'))], before);
  const other = join(p.home, 'other-state'); guard(p, args, read(join(p.dir, 'wiki/a.md'), p.dir), { ...envFor(p.home), XDG_STATE_HOME: other }); assert.equal(existsSync(other), false);
});
test('9. an XDG_STATE_HOME that differs from the one apply used denies every call', t => {
  const p = sliceProject(t), other = { ...envFor(p.home), XDG_STATE_HOME: join(p.home, 'other-state') };
  for (const file of [join(p.dir, 'wiki/a.md'), '/etc/hosts']) assert.match(guard(p, guardArgs(p), read(file, p.dir), other).stdout, /does not manage agent lead|not installed/);
});
test('10. a non-member Read whose path holds a quote, a backslash, and U+2028 gives deny JSON that parses to the exact reason', t => {
  const p = sliceProject(t), odd = join(p.dir, 'wiki', 'q"uo\\te' + String.fromCharCode(0x2028) + 'x.md'), r = guard(p, guardArgs(p), read(odd, p.dir));
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.split('\n').length, 2, 'one line');
  const body = JSON.parse(r.stdout) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } };
  const shown = odd.replace(String.fromCharCode(0x2028), '\\u2028');
  assert.deepEqual(body, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Bowerloom guard: ${shown} is under wiki, and no context slice of agent lead (wiki) lists it. Read the files that your slice skills list. To widen a slice, ask the main session to edit .bowerloom/slices/wiki.yaml and run bowerloom apply.` } });
});
test('11. bowerloom-guard with no arguments writes the GUARD_INPUT_INVALID text to stderr and exits 2', t => {
  const home = folder(t), r = run(home, [], home, { input: '' }, guardMain); assert.equal(r.status, 2); assert.equal(r.stdout, ''); assert.equal(r.stderr, INPUT_INVALID_TEXT);
  const unparsable = run(home, ['--agent', 'lead', '--bogus', 'x'], home, { input: '{}' }, guardMain); assert.equal(unparsable.status, 2); assert.equal(unparsable.stderr, INPUT_INVALID_TEXT);
});
test('12. a guard route whose dynamic import fails still prints the deny line and exits 0', t => {
  const home = folder(t), lone = join(home, 'lone'); mkdirSync(lone); writeFileSync(join(lone, 'package.json'), '{"type":"module"}');
  cpSync(guardMain, join(lone, 'guard-main.js'));
  const r = run(home, ['--agent', 'lead', '--project', home, '--project-id', 'a'.repeat(32), '--slice', 'wiki'], home, { input: read('/etc/hosts', home) }, join(lone, 'guard-main.js'));
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, denyJson('Bowerloom guard: the guard could not run, so the call is blocked. Run bowerloom apply, or reinstall Bowerloom.'));
  const viaMain = run(home, ['context', 'guard', '--agent', 'lead'], home, { input: '' }); assert.equal(viaMain.status, 2); assert.equal(viaMain.stderr, INPUT_INVALID_TEXT);
});

const OUTSIDE = (p: { dir: string }, file: string): string => `Bowerloom guard: ${file} is under wiki, and no context slice of agent lead (wiki) lists it. Read the files that your slice skills list. To widen a slice, ask the main session to edit .bowerloom/slices/wiki.yaml and run bowerloom apply.`;
const MISMATCH = (p: { dir: string }): string => `Bowerloom guard: the project at ${p.dir} does not manage agent lead, or it is not the folder that apply wrote this copy for. Run bowerloom apply in the project that holds .claude/agents/lead.md.`;
const NOT_INSTALLED = (p: { dir: string }): string => `Bowerloom guard: slice wiki of agent lead is not installed, or its copy changed. Every read, search, and file listing of this agent is blocked. Run bowerloom apply in ${p.dir}.`;
const ROOT_MISSING = (p: { dir: string }): string => `Bowerloom guard: the folder of slice wiki cannot be found, or it changed since apply, so every read, search, and file listing of agent lead is blocked. Run bowerloom apply in ${p.dir} to see why.`;
const INTERNAL = 'Bowerloom guard: the guard hit an internal error, so the call is blocked. Run bowerloom apply, or reinstall Bowerloom.';
const memberRead = (p: { dir: string }, root = 'wiki'): string => read(join(p.dir, root, 'a.md'), p.dir);

test('G9a. a --slice list that the agent catalog does not hold is GUARD_PROJECT_MISMATCH', t => {
  const p = sliceProject(t), args = [...guardArgs(p), '--slice', 'zzz'];
  assert.equal(guard(p, args, memberRead(p)).stdout, denyJson(MISMATCH(p))); assert.equal(guard(p, guardArgs(p), memberRead(p)).stdout, '');
});
test('G9b. an edited --root hex is GUARD_ROOT_MISSING', t => {
  const p = sliceProject(t), args = guardArgs(p), i = args.indexOf('--root'), hex = args[i + 1]!;
  args[i + 1] = hex.slice(0, -1) + (hex.endsWith('0') ? '1' : '0');
  assert.equal(guard(p, args, memberRead(p)).stdout, denyJson(ROOT_MISSING(p)));
  const none = guardArgs(p); none.splice(none.indexOf('--root'), 2); assert.equal(guard(p, none, memberRead(p)).stdout, denyJson(ROOT_MISSING(p)), 'a slice with no --root value');
});
test('G9c. the root folder replaced at the same path is GUARD_ROOT_MISSING', t => {
  const p = sliceProject(t), args = guardArgs(p); assert.equal(guard(p, args, memberRead(p)).stdout, '');
  renameSync(join(p.dir, 'wiki'), join(p.dir, 'wiki-old')); put(p.dir, 'wiki/a.md', '# Alpha\nbody a\n');
  assert.equal(guard(p, args, memberRead(p)).stdout, denyJson(ROOT_MISSING(p)));
});
test('G9d. a folder on the way to the root turned into a link is GUARD_ROOT_MISSING', t => {
  const p = sliceProject(t, { root: 'kb/wiki' }), args = guardArgs(p); assert.equal(guard(p, args, memberRead(p, 'kb/wiki')).stdout, '');
  renameSync(join(p.dir, 'kb'), join(p.dir, 'kb-real')); symlinkSync(join(p.dir, 'kb-real'), join(p.dir, 'kb'));
  assert.equal(guard(p, args, memberRead(p, 'kb/wiki')).stdout, denyJson(ROOT_MISSING(p)));
});
test('G9e. a catalog reference with .., a backslash, or U+2028 is GUARD_SLICE_NOT_INSTALLED when only safeReference refuses it', async t => {
  for (const bad of ['../secret.txt', 'sub\\b.md', 'a' + String.fromCharCode(0x2028) + 'b.md', '/etc/hosts', '.hidden/x.md']) {
    const p = sliceProject(t); await tamperCatalog(p, 'slice_wiki', c => { (c.references as string[]).push(bad); });
    assert.equal(guard(p, guardArgs(p), memberRead(p)).stdout, denyJson(NOT_INSTALLED(p)), JSON.stringify(bad));
  }
  const ok = sliceProject(t); await tamperCatalog(ok, 'slice_wiki', c => { (c.references as string[]).push('My Page.md'); }); assert.equal(guard(ok, guardArgs(ok), memberRead(ok)).stdout, '', 'a space is a plain name; the tamper itself is fine');
  assert.equal(safeReference('a/b c.md'), true); assert.equal(safeReference('a/\u2028.md'), false); assert.equal(safeReference('..'), false); assert.equal(safeReference('a/'), true); assert.equal(safeReference('./'), true);
});
test('G9f. a catalog root path that is not a plain relative path is GUARD_SLICE_NOT_INSTALLED (G7)', async t => {
  for (const bad of ['../outside', '/etc', 'a/../b', '.hidden', 'a\\b', '']) {
    const p = sliceProject(t); await tamperCatalog(p, 'slice_wiki', c => { ((c.source as { root: { path: string } }).root).path = bad; });
    assert.equal(guard(p, guardArgs(p), memberRead(p)).stdout, denyJson(NOT_INSTALLED(p)), JSON.stringify(bad));
  }
});
test('G9g. a missing slice catalog is GUARD_SLICE_NOT_INSTALLED, and a missing root folder is GUARD_ROOT_MISSING, with exact reasons', t => {
  const p = sliceProject(t), args = guardArgs(p);
  rmSync(join(p.dir, '.bowerloom/managed/catalog/slice_wiki.json')); assert.equal(guard(p, args, read('/etc/hosts', p.dir)).stdout, denyJson(NOT_INSTALLED(p)));
  const q = sliceProject(t); rmSync(join(q.dir, 'wiki'), { recursive: true }); assert.equal(guard(q, guardArgs(q), read('/etc/hosts', q.dir)).stdout, denyJson(ROOT_MISSING(q)));
});
test('G9h. a changed catalog without a fixed receipt is GUARD_SLICE_NOT_INSTALLED', t => {
  const p = sliceProject(t), file = join(p.dir, '.bowerloom/managed/catalog/slice_wiki.json'); writeFileSync(file, readFileSync(file, 'utf8').replace('"guard":"root"', '"guard":"none"'));
  assert.equal(guard(p, guardArgs(p), memberRead(p)).stdout, denyJson(NOT_INSTALLED(p)));
});
test('G2 and R5. a filesystem error other than not-found is a deny with its own reason, through the real binary', t => {
  if (process.getuid?.() === 0) return t.skip('root ignores folder modes');
  const p = sliceProject(t), args = guardArgs(p), locked = join(p.dir, 'locked'); put(p.dir, 'locked/x.md', 'x');
  chmodSync(locked, 0o000);
  try { assert.equal(guard(p, args, read(join(locked, 'x.md'), p.dir)).stdout, denyJson(`Bowerloom guard: the path ${join(locked, 'x.md')} is not readable by the guard for agent lead, so the call is blocked. Check the permissions of its folders.`)); } finally { chmodSync(locked, 0o755); }
  symlinkSync(join(p.dir, 'ln2'), join(p.dir, 'ln1')); symlinkSync(join(p.dir, 'ln1'), join(p.dir, 'ln2'));
  assert.equal(guard(p, args, read(join(p.dir, 'ln1', 'x'), p.dir)).stdout, denyJson(`Bowerloom guard: the path ${join(p.dir, 'ln1', 'x')} is too long or too deep for the guard to check for agent lead. Use a shorter path.`));
  assert.match(guard(p, args, read(join(p.dir, 'n'.repeat(300), 'x'), p.dir)).stdout, /is too long or too deep for the guard to check for agent lead\. Use a shorter path\."/);
  assert.equal(guard(p, args, read(join(p.dir, 'not-there.md'), p.dir)).stdout, '', 'not found is still a plain miss');
  assert.equal(guard(p, args, read(join(p.dir, 'wiki/secret.txt'), p.dir)).stdout, denyJson(OUTSIDE(p, join(p.dir, 'wiki/secret.txt'))));
});
test('G4. a huge path or a huge pattern is denied fast through the real binary', t => {
  const p = sliceProject(t), args = guardArgs(p), started = Date.now();
  const long = '/' + 'a/'.repeat(450000) + 'x', r = guard(p, args, read(long, p.dir)); assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /is too long or too deep for the guard to check for agent lead\. Use a shorter path\.$/);
  const braces = guard(p, args, hookInput('Glob', { pattern: '{'.repeat(20000) }, p.dir)); assert.match(braces.stdout, /too long or too deep/);
  assert.ok(Date.now() - started < 4000, `${Date.now() - started} ms`);
  const deep = join(p.dir, ...Array.from({ length: 70 }, () => 'd')); put(p.dir, deep.slice(p.dir.length + 1) + '/n.md', 'x');
  assert.equal(guard(p, args, read(join(deep, 'n.md'), p.dir)).stdout, '', 'outside the root, even 70 levels deep, is left to Claude Code');
  put(p.dir, 'wiki/' + Array.from({ length: 70 }, () => 'd').join('/') + '/n.md', 'x');
  assert.match(guard(p, args, read(join(p.dir, 'wiki', ...Array.from({ length: 70 }, () => 'd'), 'n.md'), p.dir)).stdout, /no context slice of agent lead \(wiki\) lists it/);
});

test('C4. --explain with --slice for an installed slice the agent does not list still explains', t => {
  const p = sliceProject(t); put(p.dir, 'notes/n.md', '# N\n');
  approve(p.dir, ['slice', 'create', 'other', '--root', 'notes', '--include', '**/*.md'], p.home); approve(p.dir, ['apply', '--harness', 'claude'], p.home);
  const r = run(p.dir, ['context', 'guard', '--agent', 'lead', '--slice', 'other', '--explain', join(p.dir, 'notes/n.md')], p.home);
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'allowed: ' + join(p.dir, 'notes/n.md') + ' is in slice other\n');
});

test('G10. the guide and the release notes state the 2.1.295 requirement and what older versions do', () => {
  const docs = (rel: string): string => readFileSync(new URL(`../../apps/docs/src/content/docs/${rel}`, import.meta.url), 'utf8');
  const guide = docs('guides/context-slices.md'), releases = docs('releases.md');
  for (const text of [guide, releases]) { assert.match(text, /2\.1\.295/); assert.match(text, /cannot start, crashes, or runs longer than 10 seconds/); }
  assert.match(guide, /On Claude Code 2\.1\.295 or later, a guard that cannot start, crashes, or runs longer than 10 seconds blocks the call\. Before 2\.1\.295, such a guard lets the call through\./);
  assert.match(guide, /A hard link outside the root to a file under the root reads that file/); assert.match(releases, /untrusted folder skips it/);
});

test('G9. a root folder moved aside and replaced by a link to it is refused, though its identity is unchanged', t => {
  const p = sliceProject(t); renameSync(join(p.dir, 'wiki'), join(p.dir, 'wiki-real')); symlinkSync('wiki-real', join(p.dir, 'wiki'));
  const r = guard(p, guardArgs(p), read(join(p.dir, 'wiki/a.md'), p.dir)); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"permissionDecision":"deny"/, 'a link in the chain to the root denies the call');
});

test('R1. a Glob with many brace results and a deep missing path completes fast, and a wiki alternative still denies', t => {
  const p = sliceProject(t, { agentExtra: '' }), o = join(p.dir, 'o', ...Array(150).fill('d')); mkdirSync(o, { recursive: true });
  const slow = Array(3).fill('{a,b,c,d}').join('/') + '/{a,b,c}/' + Array(225).fill('z').join('/') + '/*';
  const timed = (pattern: string) => { const start = Date.now(), r = guard(p, guardArgs(p), hookInput('Glob', { pattern }, o)); return { r, ms: Date.now() - start }; };
  const one = timed(slow); assert.equal(one.r.status, 0, one.r.stderr); assert.ok(one.ms < 1000, `took ${one.ms} ms`);
  const two = timed('{' + slow + ',' + join(p.dir, 'wiki') + '/*}'); assert.equal(two.r.status, 0, two.r.stderr); assert.ok(two.ms < 1000, `took ${two.ms} ms`);
  assert.match(two.r.stdout, /"permissionDecision":"deny"/, 'the wiki alternative denies');
});

test('R2 and R3. the guide says what a Grep of a folder with a hard link does, and that Grep does not follow links', () => {
  const guide = readFileSync(new URL('../../apps/docs/src/content/docs/guides/context-slices.md', import.meta.url), 'utf8');
  assert.match(guide, /A Grep of a folder is denied when the folder holds such a file within 2048 entries and 16 levels/);
  assert.match(guide, /Grep does not: Claude Code 2\.1\.292 runs ripgrep for Grep with `--hidden` and without `--follow` or `-L`/);
});

// ------------------------------------------------------------------------------------------ Part B: a root in a registered folder
const registered = (t: import('node:test').TestContext) => sliceProject(t, { registered: true });
const outside = (p: { dir: string; kb: string | null }, rel: string): string => join(p.kb!, rel);
test('B1. a member Read in a registered folder prints nothing, and a non-member Read names the root from the project folder', t => {
  const p = registered(t), args = guardArgs(p), file = outside(p, 'wiki/secret.txt');
  assert.equal(args.includes('--root'), true); assert.match(args[args.indexOf('--root') + 1]!, /^wiki:[a-f0-9]{32}$/);
  for (const ok of ['wiki/a.md', 'wiki/sub/b.md']) { const r = guard(p, args, read(outside(p, ok), p.dir)); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, '', ok); }
  const r = guard(p, args, read(file, p.dir)); assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, denyJson(`Bowerloom guard: ${file} is under ../kb/wiki, and no context slice of agent lead (wiki) lists it. Read the files that your slice skills list. To widen a slice, ask the main session to edit .bowerloom/slices/wiki.yaml and run bowerloom apply.`));
  assert.equal(guard(p, args, read(join(p.dir, 'AGENTS.md'), p.dir)).stdout, '', 'the project itself is no guarded area');
  assert.equal(guard(p, args, read(outside(p, 'wiki/missing.md'), p.dir)).stdout.length > 0, true, 'a missing file under the root is denied');
});
test('B2. Grep and Glob of a registered root: the whole root is denied with the covered folders, a covered folder is silent', t => {
  const p = registered(t), args = guardArgs(p);
  assert.equal(guard(p, args, hookInput('Grep', { pattern: 'x', path: outside(p, 'wiki') }, p.dir)).stdout, denyJson(`Bowerloom guard: a search of ${outside(p, 'wiki')} would reach files that no context slice of agent lead (wiki) lists. Search one listed file, or a folder whose files are all listed: ../kb/wiki/sub.`));
  assert.equal(guard(p, args, hookInput('Grep', { pattern: 'x', path: outside(p, 'wiki/sub') }, p.dir)).stdout, '');
  assert.equal(guard(p, args, hookInput('Grep', { pattern: 'x', path: p.kb! }, p.dir)).stdout.length > 0, true, 'the parent of the root holds the area');
  assert.equal(guard(p, args, hookInput('Glob', { pattern: 'wiki/**/*.md' }, p.kb!)).stdout.length > 0, true);
  assert.equal(guard(p, args, hookInput('Grep', { pattern: 'x', path: join(p.dir, '.bowerloom') }, p.dir)).stdout, '', 'the project is outside the area');
});
test('B3. a link in the project to a non-member of the registered root is denied, as is a hard link', t => {
  const p = registered(t), args = guardArgs(p);
  symlinkSync(outside(p, 'wiki/secret.txt'), join(p.dir, 'via-link.txt')); linkSync(outside(p, 'wiki/secret.txt'), join(p.dir, 'hard.txt'));
  assert.equal(guard(p, args, read(join(p.dir, 'via-link.txt'), p.dir)).stdout.length > 0, true, 'a link into the root');
  assert.equal(guard(p, args, read(join(p.dir, 'hard.txt'), p.dir)).stdout.length > 0, true, 'a second name of a file under the root');
  symlinkSync(outside(p, 'wiki/a.md'), join(p.dir, 'member-link.md')); assert.equal(guard(p, args, read(join(p.dir, 'member-link.md'), p.dir)).stdout, '', 'a link to a member is a member');
});
test('B4. a folder record that is gone or points elsewhere denies every call with GUARD_ROOT_MISSING', t => {
  const p = registered(t), args = guardArgs(p), record = join(p.home, '.bowerloom/folders/kb.json'), ROOT = /^\{"hookSpecificOutput":\{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Bowerloom guard: the folder of slice wiki cannot be found, or it changed since apply, so every read, search, and file listing of agent lead is blocked\. Run bowerloom apply in /;
  const saved = readFileSync(record, 'utf8');
  rmSync(record); assert.match(guard(p, args, read(outside(p, 'wiki/a.md'), p.dir)).stdout, ROOT, 'no record');
  assert.match(guard(p, args, read('/etc/hosts', p.dir)).stdout, ROOT, 'every call, whatever the target');
  mkdirSync(join(p.home, 'other/wiki'), { recursive: true, mode: 0o755 }); chmodSync(join(p.home, 'other'), 0o755); chmodSync(join(p.home, 'other/wiki'), 0o755); writeFileSync(join(p.home, 'other/wiki/a.md'), '# Alpha\n');
  writeFileSync(record, saved.replace('"path":"kb"', '"path":"other"'), { mode: 0o644 }); assert.match(guard(p, args, read(join(p.home, 'other/wiki/a.md'), p.dir)).stdout, ROOT, 'a record that points elsewhere');
  writeFileSync(record, saved, { mode: 0o644 }); assert.equal(guard(p, args, read(outside(p, 'wiki/a.md'), p.dir)).stdout, '', 'the record put back');
  writeFileSync(record, '{"format":"x"}\n', { mode: 0o644 }); assert.match(guard(p, args, read(outside(p, 'wiki/a.md'), p.dir)).stdout, ROOT, 'an invalid record');
});
test('B5. a registered folder replaced by a new folder at the same path denies every call with GUARD_ROOT_MISSING', t => {
  const p = registered(t), args = guardArgs(p);
  cpSync(join(p.kb!, 'wiki'), join(p.home, 'copy'), { recursive: true }); rmSync(join(p.kb!, 'wiki'), { recursive: true }); cpSync(join(p.home, 'copy'), join(p.kb!, 'wiki'), { recursive: true });
  assert.match(guard(p, args, read(outside(p, 'wiki/a.md'), p.dir)).stdout, /the folder of slice wiki cannot be found, or it changed since apply/);
  const plan = run(p.dir, ['apply', '--harness', 'claude'], p.home); assert.match(plan.stdout, /^ {2}lead +update agent/m, 'the next apply writes the new root id');
  approve(p.dir, ['apply', '--harness', 'claude'], p.home);
  assert.equal(guard(p, guardArgs(p), read(outside(p, 'wiki/a.md'), p.dir)).stdout, '');
});
test('B6. a link at the recorded path, and a missing store, deny every call', t => {
  const p = registered(t), args = guardArgs(p);
  renameSync(join(p.kb!, 'wiki'), join(p.home, 'real-wiki')); symlinkSync(join(p.home, 'real-wiki'), join(p.kb!, 'wiki'));
  assert.match(guard(p, args, read(join(p.home, 'real-wiki/a.md'), p.dir)).stdout, /the folder of slice wiki cannot be found/);
  unlinkSync(join(p.kb!, 'wiki')); renameSync(join(p.home, 'real-wiki'), join(p.kb!, 'wiki')); assert.equal(guard(p, args, read(outside(p, 'wiki/a.md'), p.dir)).stdout, '');
  renameSync(join(p.home, '.bowerloom'), join(p.home, 'store-aside')); assert.match(guard(p, args, read(outside(p, 'wiki/a.md'), p.dir)).stdout, /the folder of slice wiki cannot be found/);
});
test('B7. a --root value of another folder denies every call, and a missing --root too', t => {
  const p = registered(t), args = guardArgs(p), i = args.indexOf('--root');
  const other = [...args]; other[i + 1] = 'wiki:' + '0'.repeat(32); assert.match(guard(p, other, read(outside(p, 'wiki/a.md'), p.dir)).stdout, /the folder of slice wiki cannot be found/);
  const none = args.filter((_, j) => j !== i && j !== i + 1); assert.match(guard(p, none, read(outside(p, 'wiki/a.md'), p.dir)).stdout, /the folder of slice wiki cannot be found/);
});
test('B8. --explain works for a registered root', t => {
  const p = registered(t), ok = run(p.dir, ['context', 'guard', '--agent', 'lead', '--explain', outside(p, 'wiki/a.md')], p.home), no = run(p.dir, ['context', 'guard', '--agent', 'lead', '--explain', outside(p, 'wiki/secret.txt')], p.home);
  assert.equal(ok.status, 0, ok.stderr); assert.equal(ok.stdout, `allowed: ${outside(p, 'wiki/a.md')} is in slice wiki\n`);
  assert.match(no.stdout, new RegExp(`^denied \\(GUARD_OUTSIDE_SLICE\\): Bowerloom guard: ${outside(p, 'wiki/secret.txt').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is under \\.\\./kb/wiki, and no context slice`));
  assert.equal(run(p.dir, ['context', 'guard', '--agent', 'lead', '--explain', '/etc/hosts'], p.home).stdout, 'allowed: no guard rule applies to /etc/hosts\n');
});
test('B9. the guard with a registered root writes nothing, and stays under the latency bound', t => {
  const p = registered(t), args = guardArgs(p), before = [tree(p.dir), tree(join(p.home, 'state')), tree(join(p.home, '.bowerloom'))], times: number[] = [];
  for (let i = 0; i < 25; i++) {
    const start = process.hrtime.bigint(), r = guard(p, args, read(outside(p, i % 2 ? 'wiki/secret.txt' : 'wiki/a.md'), p.dir)); if (i >= 5) times.push(Number(process.hrtime.bigint() - start) / 1e6); assert.equal(r.status, 0, r.stderr);
  }
  times.sort((a, b) => a - b); console.log(`registered guard latency over ${times.length} calls: p50 ${times[Math.ceil(0.5 * times.length) - 1]!.toFixed(0)} ms, p95 ${times[Math.ceil(0.95 * times.length) - 1]!.toFixed(0)} ms`);
  for (const ms of times) assert.ok(ms < 2000, `${ms} ms`);
  assert.deepEqual([tree(p.dir), tree(join(p.home, 'state')), tree(join(p.home, '.bowerloom'))], before);
});
