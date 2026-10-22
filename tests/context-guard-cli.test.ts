// Spec 05, section 10.19: the read guard, through the real binaries `bowerloom-guard` and `bowerloom context guard`.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INPUT_INVALID_TEXT } from '../apps/cli/src/guard-run.js';
import { denyJson, envFor, folder, guardArgs, guardMain, hookInput, run, sliceProject } from './support/slice-project.js';

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
test('10. a non-member Read whose path holds a quote, a backslash, and U+2028 gives deny JSON that parses', t => {
  const p = sliceProject(t), odd = join(p.dir, 'wiki', 'q"uo\\te' + String.fromCharCode(0x2028) + 'x.md'), r = guard(p, guardArgs(p), read(odd, p.dir));
  assert.equal(r.status, 0, r.stderr); const body = JSON.parse(r.stdout) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
  assert.equal(body.hookSpecificOutput.permissionDecision, 'deny'); assert.ok(body.hookSpecificOutput.permissionDecisionReason.includes('q"uo\\\\u'.slice(0, 5)) || body.hookSpecificOutput.permissionDecisionReason.includes('\\u2028'));
  assert.equal(r.stdout.split('\n').length, 2, 'one line');
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
