// Spec 05, section 10.5: the read guard's decision over real identities.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideGuard, expandBraces } from '../../../dist/packages/context-slices/src/guard.js';
import { nodeGuardFs } from '../../../dist/apps/cli/src/guard-fs.js';

const kinds = new Set();
const FS = nodeGuardFs();
const write = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

/** base/project (cwd), base/kb (the root), base/outside. */
function fixture(t, { rootName = 'kb' } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'))); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, rootName);
  for (const f of ['a.md', 'b.md', 'sub/c.md', 'sub/d.md', 'cov/x.md', 'cov/y.md']) write(path.join(root, f));
  write(path.join(base, 'outside/o.md')); fs.mkdirSync(path.join(base, 'project'));
  const slice = (extra = {}) => ({ id: 'kb', mode: 'root', state: 'ok', root, display: '../' + rootName, prefix: '../' + rootName, members: ['a.md', 'sub/c.md', 'cov/x.md', 'cov/y.md'], covered: ['cov/'], ...extra });
  return { base, root, project: path.join(base, 'project'), slice };
}
function run(f, tool, toolInput, { cwd = f.project, slices = [f.slice()], projectOk = true, home = f.base } = {}) {
  const input = { role: 'lead', project: f.project, ids: slices.map(s => s.id), tool, toolInput, cwd, home };
  const decision = decideGuard(input, () => ({ projectOk, slices, fs: FS })); kinds.add(decision.kind); return decision;
}
const read = (f, p, o) => run(f, 'Read', { file_path: p }, o), grep = (f, p, o) => run(f, 'Grep', p === undefined ? { pattern: 'x' } : { pattern: 'x', path: p }, o), glob = (f, pattern, o, p) => run(f, 'Glob', p === undefined ? { pattern } : { pattern, path: p }, o);
const denied = (d, code = 'GUARD_OUTSIDE_SLICE') => { assert.equal(d.kind, 'deny', JSON.stringify(d)); assert.equal(d.code, code, d.reason); return d; };
const quiet = (d, why) => assert.deepEqual(d, { kind: 'silent' }, why);
const caseInsensitive = (() => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'case-')); try { fs.writeFileSync(path.join(d, 'a'), ''); return fs.existsSync(path.join(d, 'A')); } finally { fs.rmSync(d, { recursive: true }); } })();
after(() => assert.deepEqual([...kinds].filter(k => !['silent', 'deny', 'invalid'].includes(k)), [], 'no decision is ever allow'));

test('1. Read of a member is silent', t => { const f = fixture(t); quiet(read(f, path.join(f.root, 'a.md'))); quiet(read(f, path.join(f.root, 'cov/x.md'))); });
test('2. Read of a non-member under a guarded root is denied with GUARD_OUTSIDE_SLICE and the exact reason', t => {
  const f = fixture(t), d = denied(read(f, path.join(f.root, 'b.md')));
  assert.equal(d.reason, `Bowerloom guard: ${path.join(f.root, 'b.md')} is under ../kb, and no context slice of agent lead (kb) lists it. Read the files that your slice skills list. To widen a slice, ask the main session to edit .bowerloom/slices/kb.yaml and run bowerloom apply.`);
});
test('3. Read outside every area is silent', t => { const f = fixture(t); quiet(read(f, path.join(f.base, 'outside/o.md'))); quiet(read(f, '/etc/hosts')); });
test('4. Read through an outside link to a non-member inside is denied', t => {
  const f = fixture(t); fs.symlinkSync(path.join(f.root, 'b.md'), path.join(f.base, 'outside/ln.md'));
  denied(read(f, path.join(f.base, 'outside/ln.md'))); quiet(read(f, path.join(f.base, 'outside/o.md')));
  fs.symlinkSync(f.root, path.join(f.base, 'outside/dirlink')); denied(read(f, path.join(f.base, 'outside/dirlink/b.md'))); quiet(read(f, path.join(f.base, 'outside/dirlink/a.md')));
});
test('5. Read of a case alias of a member is silent', { skip: !caseInsensitive && 'this disk is case-sensitive, so A.MD names a different file' }, t => { const f = fixture(t); quiet(read(f, path.join(f.root, 'A.MD'))); denied(read(f, path.join(f.root, 'B.MD'))); });
test('6. Read of a missing file under a root is denied', t => { const f = fixture(t); denied(read(f, path.join(f.root, 'nope.md'))); denied(read(f, path.join(f.root, 'nope/deeper/none.md'))); });
test('7. Grep of a covered folder is silent', t => { const f = fixture(t); quiet(grep(f, path.join(f.root, 'cov'))); });
test('8. Grep of a member file is silent', t => { const f = fixture(t); quiet(grep(f, path.join(f.root, 'a.md'))); denied(grep(f, path.join(f.root, 'b.md'))); });
test('9. Grep of an uncovered folder inside an area is denied, and the reason lists covered folders', t => {
  const f = fixture(t), d = denied(grep(f, path.join(f.root, 'sub')));
  assert.equal(d.reason, `Bowerloom guard: a search of ${path.join(f.root, 'sub')} would reach files that no context slice of agent lead (kb) lists. Search one listed file, or a folder whose files are all listed: ../kb/cov.`);
  assert.match(denied(grep(f, f.root)).reason, /: \.\.\/kb\/cov\.$/);
});
test('10. Grep of a folder that holds an area is denied', t => { const f = fixture(t); denied(grep(f, f.base)); denied(grep(f, path.dirname(f.base))); quiet(grep(f, path.join(f.base, 'outside'))); });
test('11. Grep with no path takes cwd', t => {
  const f = fixture(t); denied(grep(f, undefined, { cwd: path.join(f.root, 'sub') })); quiet(grep(f, undefined, { cwd: path.join(f.root, 'cov') })); quiet(grep(f, undefined, { cwd: f.project }));
  denied(read(f, 'b.md', { cwd: f.root })); quiet(read(f, 'a.md', { cwd: f.root }));
});
test('12. Glob with ../ in the pattern is denied when the agent has a guarded area', t => {
  const f = fixture(t); denied(glob(f, '../kb/**')); denied(glob(f, './x/**')); quiet(glob(f, '**/*.md', undefined, path.join(f.base, 'outside')));
});
test('13. a member of a guard: none slice with the same root is allowed', t => {
  const f = fixture(t), a = f.slice(), b = f.slice({ id: 'other', mode: 'none', members: ['b.md'], covered: [] });
  quiet(read(f, path.join(f.root, 'b.md'), { slices: [a, b] })); denied(read(f, path.join(f.root, 'sub/d.md'), { slices: [a, b] }));
});
test('14. a root of a guard: none slice is not an area', t => { const f = fixture(t); quiet(read(f, path.join(f.root, 'b.md'), { slices: [f.slice({ mode: 'none' })] })); });
test('15. a missing slice catalog denies every target with GUARD_SLICE_NOT_INSTALLED', t => {
  const f = fixture(t), slices = [f.slice({ state: 'not-installed' })];
  for (const d of [read(f, '/etc/hosts', { slices }), grep(f, f.base, { slices }), glob(f, '*.md', { slices })]) denied(d, 'GUARD_SLICE_NOT_INSTALLED');
  assert.equal(read(f, '/etc/hosts', { slices }).reason, `Bowerloom guard: slice kb of agent lead is not installed, or its copy changed. Every read, search, and file listing of this agent is blocked. Run bowerloom apply in ${f.project}.`);
});
test('16. a missing root denies every target with GUARD_ROOT_MISSING', t => {
  const f = fixture(t), slices = [f.slice({ state: 'root-missing' })];
  assert.equal(denied(read(f, '/etc/hosts', { slices }), 'GUARD_ROOT_MISSING').reason, `Bowerloom guard: the folder of slice kb cannot be found, or it changed since apply, so every read, search, and file listing of agent lead is blocked. Run bowerloom apply in ${f.project} to see why.`);
});
test('17. a tool other than the three is silent, and the view is never loaded', t => {
  const f = fixture(t); let loaded = false;
  const d = decideGuard({ role: 'lead', project: f.project, ids: ['kb'], tool: 'Bash', toolInput: { command: 'cat x' }, cwd: f.project, home: f.base }, () => { loaded = true; throw new Error('no'); });
  quiet(d); assert.equal(loaded, false);
});
test('18. no decision is ever allow, over many inputs', t => {
  const f = fixture(t), seen = new Set();
  const paths = [path.join(f.root, 'a.md'), path.join(f.root, 'b.md'), f.root, f.base, '/etc/hosts', 'rel/x', '~', '~/x', path.join(f.root, 'cov'), path.join(f.root, 'nope'), ' x', '/a/../b', '/.vol/1'];
  const patterns = ['*', '**/*.md', 'a.md', '{a,b}', '{1..9}', '@(x)', '../x', '/etc/*', '~/x/*', 'cov/**', '\\*'];
  for (const p of paths) { seen.add(read(f, p).kind); seen.add(grep(f, p).kind); seen.add(glob(f, '**', undefined, p).kind); }
  for (const g of patterns) { seen.add(glob(f, g).kind); seen.add(glob(f, g, { cwd: f.root }).kind); }
  for (const tool of ['Bash', 'Edit', 'Read', 'Grep', 'Glob', '']) seen.add(run(f, tool, {}).kind);
  assert.ok([...seen].every(k => ['silent', 'deny', 'invalid'].includes(k)), [...seen].join()); assert.ok(seen.has('silent') && seen.has('deny') && seen.has('invalid'));
  for (const d of [read(f, path.join(f.root, 'b.md')), grep(f, f.base)]) assert.deepEqual(Object.keys(d).sort(), ['code', 'kind', 'reason']);
});
test('19. with an outer and an inner guarded root, a member of the inner slice is allowed under the outer area', t => {
  const f = fixture(t), inner = f.slice({ id: 'inner', root: path.join(f.root, 'sub'), display: '../kb/sub', prefix: '../kb/sub', members: ['d.md'], covered: [] });
  quiet(read(f, path.join(f.root, 'sub/d.md'), { slices: [f.slice(), inner] })); denied(read(f, path.join(f.root, 'sub/zz.md'), { slices: [f.slice(), inner] }));
  denied(read(f, path.join(f.root, 'b.md'), { slices: [f.slice(), inner] }));
});
test('20. a link inside the root that points outside it is denied', t => {
  const f = fixture(t); fs.symlinkSync(path.join(f.base, 'outside/o.md'), path.join(f.root, 'ln.md')); denied(read(f, path.join(f.root, 'ln.md')));
  fs.symlinkSync(path.join(f.root, 'a.md'), path.join(f.root, 'ok.md')); quiet(read(f, path.join(f.root, 'ok.md')));
});
test('21. Glob {../kb,x}/** from outside the area is denied', t => { const f = fixture(t); denied(glob(f, '{../kb,x}/**')); });
test('22. a file added to a covered folder after apply makes a Grep of that folder denied', t => {
  const f = fixture(t); quiet(grep(f, path.join(f.root, 'cov'))); write(path.join(f.root, 'cov/z.md')); denied(grep(f, path.join(f.root, 'cov')));
  fs.rmSync(path.join(f.root, 'cov/z.md')); quiet(grep(f, path.join(f.root, 'cov'))); write(path.join(f.root, 'cov/.hidden')); denied(grep(f, path.join(f.root, 'cov')));
  fs.rmSync(path.join(f.root, 'cov/.hidden')); fs.symlinkSync(f.root, path.join(f.root, 'cov/lnk')); denied(grep(f, path.join(f.root, 'cov')));
});
test('23. a .. in the missing part of a target is denied', t => { const f = fixture(t); denied(read(f, f.root + '/missing/../../outside/o.md')); denied(read(f, f.root + '/missing/../a.md')); });
test('24. a ~/ path resolves against the home folder for Read, Grep, and Glob', t => {
  const f = fixture(t, { rootName: 'home/kb' }), home = path.join(f.base, 'home'), o = { home };
  denied(read(f, '~/kb/b.md', o)); quiet(read(f, '~/kb/a.md', o)); quiet(grep(f, '~/kb/cov', o)); denied(grep(f, '~/kb/sub', o));
  quiet(glob(f, '~/kb/cov/**', o)); denied(glob(f, '~/kb/**', o));
});
test('25. Glob {x,}/abs/** reaching an area is denied', t => {
  const f = fixture(t); denied(glob(f, `{x,}${f.root}/**`)); quiet(glob(f, `{x,}${f.base}/outside/**`));
  denied(glob(f, `{x,}${f.root}/b.md`));
});
test('26. Glob .{.,}/wiki/** is denied', t => { const f = fixture(t); denied(glob(f, '.{.,}/wiki/**')); });
test('27. Glob w\\\\iki/** uses the unescaped prefix', t => {
  const f = fixture(t, { rootName: 'w\\iki' }), slice = f.slice({ members: ['a.md', 'b.md', 'sub/c.md', 'sub/d.md', 'cov/x.md', 'cov/y.md'], covered: ['./', 'cov/', 'sub/'] });
  quiet(glob(f, 'w\\\\iki/**', { slices: [slice], cwd: f.base })); denied(glob(f, 'wiki/**', { slices: [slice], cwd: f.base }));
});
test('a tilde after the leading ~/ is refused in a Glob result', t => { const f = fixture(t, { rootName: 'home/kb' }), o = { home: path.join(f.base, 'home') }; denied(glob(f, '~/kb/~/x', o)); denied(glob(f, '{~,x}/y', o)); denied(glob(f, 'a~b/**', o)); });
test('28. Glob @(wiki)/** and +(wiki)/secret.md are denied', t => { const f = fixture(t); denied(glob(f, '@(wiki)/**')); denied(glob(f, '+(wiki)/secret.md')); denied(glob(f, 'a|b')); denied(glob(f, '!(x)')); });
test('29. a bare ~ resolves to the home folder', t => { const f = fixture(t, { rootName: 'home/kb' }); denied(grep(f, '~', { home: path.join(f.base, 'home') })); quiet(grep(f, '~', { home: path.join(f.base, 'outside') })); });
test('30. a relative Read path resolves against the input cwd, not the guard working folder', t => {
  const f = fixture(t); denied(read(f, 'b.md', { cwd: f.root })); quiet(read(f, 'o.md', { cwd: path.join(f.base, 'outside') })); quiet(read(f, 'a.md', { cwd: f.root }));
});
test('31. a path with a .claude/skills/../../ part is denied', t => { const f = fixture(t); denied(read(f, f.base + '/.claude/skills/../../outside/o.md')); denied(read(f, './outside/o.md')); });
test('32. a Grep of a missing folder decides on the deepest existing ancestor', t => {
  const f = fixture(t); denied(grep(f, path.join(f.root, 'sub/nope'))); quiet(grep(f, path.join(f.root, 'cov/nope'))); quiet(grep(f, path.join(f.base, 'outside/nope/deeper')));
});
test('33. a brace pattern with 257 results is denied', t => {
  const f = fixture(t); denied(glob(f, '{1..257}')); quiet(glob(f, '{1..256}')); denied(glob(f, '{1..20}{1..20}{1..20}'));
  assert.equal(expandBraces('{1..257}'), null); assert.equal(expandBraces('{1..256}').length, 256);
});
test('34. a {1..3} range expands to three results, each checked', t => {
  assert.deepEqual(expandBraces('{1..3}'), ['1', '2', '3']); assert.deepEqual(expandBraces('a{b,c{d,e}}f'), ['abf', 'acdf', 'acef']); assert.deepEqual(expandBraces('{a..c}'), ['a', 'b', 'c']);
  assert.deepEqual(expandBraces('{x,}/y'), ['x/y', '/y']); assert.deepEqual(expandBraces('{01..03}'), ['01', '02', '03']); assert.deepEqual(expandBraces('{3..1}'), ['3', '2', '1']);
  assert.deepEqual(expandBraces('a\\{b,c\\}'), ['a\\{b,c\\}']); assert.deepEqual(expandBraces('{open'), ['{open']); assert.deepEqual(expandBraces('{x}').sort(), ['\\{x\\}', 'x'].sort());
  const f = fixture(t, { rootName: 'outside/3' }), cwd = path.join(f.base, 'outside'); fs.mkdirSync(path.join(cwd, '1')); fs.mkdirSync(path.join(cwd, '2')); denied(glob(f, '{1..3}/*', { cwd })); quiet(glob(f, '{1..2}/*', { cwd }));
});
test('35. a value with leading white space, or a control or format character, is denied', t => {
  const f = fixture(t), c = n => String.fromCharCode(n);
  for (const v of [' /etc/hosts', '/etc/hosts ', '/etc/ho' + c(7) + 'sts', '/etc/ho' + c(0x202e) + 'sts', '\n/etc/hosts', '~root/x', '/a/./b']) denied(read(f, v));
  denied(glob(f, ' *.md')); denied(grep(f, '/etc/' + c(0x200b) + 'x'));
});
test('36. a path under /System/Volumes/Data that reaches a root is inside the area', { skip: !fs.existsSync('/System/Volumes/Data') && 'this system has no /System/Volumes/Data firmlink' }, t => {
  const f = fixture(t), via = '/System/Volumes/Data' + f.root; if (!fs.existsSync(via)) return t.skip('this volume has no firmlink for the temporary folder');
  denied(read(f, via + '/b.md')); quiet(read(f, via + '/a.md')); denied(grep(f, '/System/Volumes/Data')); denied(grep(f, '/System/Volumes/Data' + f.base));
});
test('37. a target whose first segment starts with a dot is denied', t => { const f = fixture(t); denied(read(f, '/.vol/1/2')); denied(read(f, '/.hidden/x')); quiet(read(f, '/etc/hosts')); });
test('38. a non-member file with two links on a guarded root device is denied for Read', t => {
  const f = fixture(t); fs.linkSync(path.join(f.root, 'b.md'), path.join(f.base, 'outside/hl.md')); denied(read(f, path.join(f.base, 'outside/hl.md')));
  fs.linkSync(path.join(f.root, 'a.md'), path.join(f.base, 'outside/hla.md')); quiet(read(f, path.join(f.base, 'outside/o.md')));
});
test('39. a root whose id differs from --root, or a slice with no --root value, denies every call', t => {
  const f = fixture(t); for (const state of ['root-missing']) denied(read(f, '/etc/hosts', { slices: [f.slice({ state })] }), 'GUARD_ROOT_MISSING');
});
test('40. a project that does not match denies every call with GUARD_PROJECT_MISMATCH', t => {
  const f = fixture(t); for (const d of [read(f, '/etc/hosts', { projectOk: false }), glob(f, '*.md', { projectOk: false })]) denied(d, 'GUARD_PROJECT_MISMATCH');
  assert.equal(read(f, '/etc/hosts', { projectOk: false }).reason, `Bowerloom guard: the project at ${f.project} does not manage agent lead, or it is not the folder that apply wrote this copy for. Run bowerloom apply in the project that holds .claude/agents/lead.md.`);
});
test('41. a value that is not a string is invalid input', t => {
  const f = fixture(t); assert.deepEqual(run(f, 'Read', { file_path: 5 }), { kind: 'invalid' }); assert.deepEqual(run(f, 'Grep', { pattern: 'x', path: {} }), { kind: 'invalid' });
  assert.deepEqual(run(f, 'Glob', { path: '/x' }), { kind: 'invalid' }); assert.deepEqual(run(f, 'Read', {}), { kind: 'invalid' });
  assert.deepEqual(run(f, 'Read', { file_path: '/x' }, { cwd: 'relative' }), { kind: 'invalid' });
});
test('42. form reason text', t => {
  const f = fixture(t); assert.equal(denied(read(f, '/a/../b')).reason, 'Bowerloom guard: the path /a/../b is written in a form the guard does not accept for agent lead. Use a plain absolute path without ., .., or a leading ~ other than ~/.');
  assert.match(denied(read(f, '/a/b\u0007c')).reason, /\/a\/b\\u0007c is written/);
});
test('Glob with a path argument uses it as the base', t => {
  const f = fixture(t); denied(glob(f, '**/*.md', undefined, f.root)); quiet(glob(f, 'cov/**', undefined, f.root)); quiet(glob(f, '**/*.md', undefined, path.join(f.root, 'cov')));
  denied(glob(f, 'sub/**', undefined, f.root)); denied(glob(f, 'b.md', undefined, f.root));
  // G3: a pattern without a slash matches at any depth, so it is judged as **/<pattern> from its base folder.
  denied(glob(f, 'a.md', undefined, f.root)); quiet(glob(f, 'x.md', undefined, path.join(f.root, 'cov'))); quiet(glob(f, 'x.md', undefined, path.join(f.base, 'outside'))); quiet(glob(f, 'secret.md')); denied(glob(f, '{a,b}.md', undefined, f.root));
  denied(glob(f, 'a.md', undefined, f.base));
});
const deep = (root, n, name = 'd') => path.join(root, ...Array.from({ length: n }, () => name));
test('G1. a member and a non-member 70 levels deep: Read, Grep and Glob', t => {
  const f = fixture(t), dir = deep(f.root, 70); write(path.join(dir, 'm.md')); write(path.join(dir, 'n.md'));
  const slices = [f.slice({ members: ['a.md', 'sub/c.md', 'cov/x.md', 'cov/y.md', 'd/'.repeat(70) + 'm.md'], covered: ['cov/'] })], o = { slices };
  quiet(read(f, path.join(dir, 'm.md'), o)); denied(read(f, path.join(dir, 'n.md'), o)); denied(read(f, path.join(dir, 'new.md'), o));
  quiet(grep(f, path.join(dir, 'm.md'), o)); denied(grep(f, path.join(dir, 'n.md'), o)); denied(grep(f, dir, o));
  denied(glob(f, 'm.md', o, dir));
  denied(glob(f, 'n.md', o, dir)); denied(glob(f, `${'d/'.repeat(70)}n.md`, { slices, cwd: f.root })); denied(glob(f, `d/${'d/'.repeat(69)}**`, { slices, cwd: f.root }));
  // A link that makes the real chain deeper than the text path.
  const chain = deep(f.base, 70, 'l'); write(path.join(chain, 'n.md')); fs.symlinkSync(f.root, path.join(chain, 'root')); denied(read(f, path.join(chain, 'root', 'b.md'), o)); quiet(read(f, path.join(chain, 'root', 'a.md'), o));
});
test('G4. a path or a pattern over 4096 bytes or 256 parts is denied, fast', t => {
  const f = fixture(t), long = '/' + 'a/'.repeat(300) + 'x', started = Date.now();
  denied(read(f, long)); denied(grep(f, long)); denied(glob(f, '**', undefined, long)); denied(read(f, '/' + 'x'.repeat(4100)));
  denied(glob(f, '{'.repeat(20000))); denied(glob(f, '{a,'.repeat(5000) + 'b' + '}'.repeat(5000))); denied(glob(f, 'a/'.repeat(300) + '*'));
  const parts = '/' + 'a/'.repeat(450000) + 'x'; denied(read(f, parts)); denied(grep(f, parts));
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  quiet(read(f, '/etc/hosts')); quiet(read(f, '/' + 'a/'.repeat(100) + 'x'));
});
test('G5. a Grep or Glob of a hard link to a non-member is denied like a Read', t => {
  const f = fixture(t); fs.linkSync(path.join(f.root, 'b.md'), path.join(f.base, 'outside/hl.md'));
  denied(grep(f, path.join(f.base, 'outside/hl.md'))); denied(glob(f, '*', undefined, path.join(f.base, 'outside/hl.md')));
  quiet(grep(f, path.join(f.base, 'outside/o.md'))); denied(grep(f, path.join(f.base, 'outside')));
});
test('G6. a covered folder is checked by identity, not by name text', { skip: !caseInsensitive && 'this disk is case-sensitive, so a name written in another case is another file' }, t => {
  const f = fixture(t), slices = [f.slice({ members: ['a.md', 'sub/c.md', 'cov/X.MD', 'cov/Y.md'] })];
  quiet(grep(f, path.join(f.root, 'cov'), { slices }));
  write(path.join(f.root, 'cov/extra.md')); denied(grep(f, path.join(f.root, 'cov'), { slices }));
});
test('G4. a covered folder with many entries is denied past the visit cap and stops at the first non-member', t => {
  const f = fixture(t); for (let i = 0; i < 3000; i++) write(path.join(f.root, 'cov', `z${i}.md`), 'x');
  const started = Date.now(); denied(grep(f, path.join(f.root, 'cov'))); assert.ok(Date.now() - started < 1500);
});
test('G2. a filesystem error other than not-found is never a quiet miss', t => {
  const f = fixture(t), locked = path.join(f.base, 'locked'); fs.mkdirSync(locked); write(path.join(locked, 'x.md')); if (process.getuid?.() === 0) return t.skip('root ignores folder modes');
  fs.chmodSync(locked, 0o000); try { assert.match(denied(read(f, path.join(locked, 'x.md'))).reason, /is not readable by the guard/); } finally { fs.chmodSync(locked, 0o755); }
  fs.symlinkSync(path.join(f.base, 'ln2'), path.join(f.base, 'ln1')); fs.symlinkSync(path.join(f.base, 'ln1'), path.join(f.base, 'ln2')); assert.match(denied(read(f, path.join(f.base, 'ln1', 'x'))).reason, /too long or too deep/);
  assert.match(denied(read(f, path.join(f.base, 'n'.repeat(300), 'x'))).reason, /too long or too deep/);
  quiet(read(f, path.join(f.base, 'outside/not-there.md'))); quiet(read(f, path.join(f.base, 'outside/o.md', 'under-a-file')));
});

test('R1. one call spends at most 8192 file system operations and then denies as too long', t => {
  const f = fixture(t); const counts = { n: 0 };
  const counted = Object.fromEntries(['lstat', 'stat', 'realpath', 'list'].map(k => [k, p => { counts.n++; return FS[k](p); }]));
  const o = path.join(f.base, 'o', ...Array(150).fill('d')); fs.mkdirSync(o, { recursive: true });
  const slow = Array(3).fill('{a,b,c,d}').join('/') + '/{a,b,c}/' + Array(225).fill('z').join('/') + '/*';
  const d = decideGuard({ role: 'lead', project: f.project, ids: ['kb'], tool: 'Glob', toolInput: { pattern: slow }, cwd: o, home: f.base }, () => ({ projectOk: true, slices: [f.slice()], fs: counted }));
  denied(d); assert.match(d.reason, /too long or too deep/); assert.ok(counts.n <= 8192 + 2, `used ${counts.n}`);
});

test('R2. a Grep of a folder outside every area that holds a hard link to a non-member is denied, and so is a folder past the visit cap', t => {
  const f = fixture(t), outside = path.join(f.base, 'outside');
  quiet(grep(f, outside), 'a folder of plain files');
  fs.mkdirSync(path.join(outside, 'deep/er'), { recursive: true }); write(path.join(outside, 'deep/er/p.md')); quiet(grep(f, outside));
  fs.linkSync(path.join(f.root, 'b.md'), path.join(outside, 'deep/er/hl.md'));
  denied(grep(f, outside)); denied(grep(f, path.join(outside, 'deep'))); quiet(grep(f, path.join(outside, 'o.md')), 'one plain file');
  fs.rmSync(path.join(outside, 'deep/er/hl.md'));
  const big = path.join(f.base, 'big'); fs.mkdirSync(big);
  for (let i = 0; i < 2048; i++) fs.writeFileSync(path.join(big, `f${i}.md`), '');
  quiet(grep(f, big), '2048 entries are within the cap');
  fs.writeFileSync(path.join(big, 'one-more.md'), ''); denied(grep(f, big));
});

test('R4. a hard-linked file outside every area gets its own reason, which names no area', t => {
  const f = fixture(t), hl = path.join(f.base, 'outside/hl.md'); fs.linkSync(path.join(f.root, 'b.md'), hl);
  for (const d of [read(f, hl), grep(f, hl), grep(f, path.join(f.base, 'outside'))]) {
    denied(d); assert.match(d.reason, /has more than one link, and no context slice of agent lead \(kb\) lists it, so it may be another name of a guarded file\./);
    assert.doesNotMatch(d.reason, /is under|\.\.\/kb|bowerloom apply/, d.reason);
  }
  assert.match(read(f, hl).reason, /^Bowerloom guard: .*outside\/hl\.md has more than one link/);
  assert.match(grep(f, path.join(f.base, 'outside')).reason, /^Bowerloom guard: a search of .*outside would reach a file that has more than one link/);
});

test('R5. ENAMETOOLONG and ELOOP read as too long, and EACCES reads as not readable, not as an internal error', t => {
  const f = fixture(t);
  const failing = code => ({ ...FS, realpath: () => { throw Object.assign(new Error(code), { code }); } });
  const go = code => decideGuard({ role: 'lead', project: f.project, ids: ['kb'], tool: 'Read', toolInput: { file_path: path.join(f.base, 'outside/o.md') }, cwd: f.project, home: f.base }, () => ({ projectOk: true, slices: [f.slice()], fs: failing(code) }));
  for (const code of ['ENAMETOOLONG', 'ELOOP']) { const d = denied(go(code)); assert.match(d.reason, /is too long or too deep for the guard to check for agent lead\. Use a shorter path\.$/); }
  const d = denied(go('EACCES')); assert.match(d.reason, /is not readable by the guard for agent lead, so the call is blocked\. Check the permissions of its folders\.$/);
  assert.throws(() => go('EIO'), /EIO/, 'an unexpected error still ends as an internal error in the caller');
});

// Part B: a registered folder can hold the project. The project's own files are then inside the guarded area.
test('B1. a registered root that holds the project: a member passes, the project files are non-members and are denied', t => {
  const f = fixture(t); write(path.join(f.project, 'AGENTS.md'));
  const holder = f.slice({ root: f.base, display: '..', prefix: '..', members: ['outside/o.md'], covered: [] });
  quiet(read(f, path.join(f.base, 'outside/o.md'), { slices: [holder] }));
  const d = denied(read(f, path.join(f.project, 'AGENTS.md'), { slices: [holder] }));
  assert.match(d.reason, /^Bowerloom guard: .*AGENTS\.md is under \.\., and no context slice of agent lead \(kb\) lists it\./);
  denied(grep(f, f.project, { slices: [holder] })); denied(grep(f, undefined, { slices: [holder] }));
  quiet(read(f, '/etc/hosts', { slices: [holder] }));
});
test('B2. two registered roots, one inside the other: a member of the inner slice passes under the outer area', t => {
  const f = fixture(t), outer = f.slice({ id: 'outer', root: f.root, members: ['a.md'], covered: [] }), inner = f.slice({ id: 'inner', root: path.join(f.root, 'sub'), display: '../kb/sub', prefix: '../kb/sub', members: ['c.md'], covered: [] });
  quiet(read(f, path.join(f.root, 'sub/c.md'), { slices: [outer, inner] })); denied(read(f, path.join(f.root, 'sub/d.md'), { slices: [outer, inner] }));
});
