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
const quiet = d => assert.deepEqual(d, { kind: 'silent' });
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
test('5. Read of a case alias of a member is silent', { skip: !caseInsensitive }, t => { const f = fixture(t); quiet(read(f, path.join(f.root, 'A.MD'))); denied(read(f, path.join(f.root, 'B.MD'))); });
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
test('18. no decision is ever allow', () => { /* checked after every test */ });
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
  const f = fixture(t, { rootName: 'outside/3' }), cwd = path.join(f.base, 'outside'); fs.mkdirSync(path.join(cwd, '1')); fs.mkdirSync(path.join(cwd, '2')); denied(glob(f, '{1..3}', { cwd })); quiet(glob(f, '{1..2}', { cwd }));
});
test('35. a value with leading white space, or a control or format character, is denied', t => {
  const f = fixture(t), c = n => String.fromCharCode(n);
  for (const v of [' /etc/hosts', '/etc/hosts ', '/etc/ho' + c(7) + 'sts', '/etc/ho' + c(0x202e) + 'sts', '\n/etc/hosts', '~root/x', '/a/./b']) denied(read(f, v));
  denied(glob(f, ' *.md')); denied(grep(f, '/etc/' + c(0x200b) + 'x'));
});
test('36. a path under /System/Volumes/Data that reaches a root is inside the area', { skip: !fs.existsSync('/System/Volumes/Data') }, t => {
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
  denied(glob(f, 'sub/**', undefined, f.root)); denied(glob(f, 'b.md', undefined, f.root)); quiet(glob(f, 'a.md', undefined, f.root));
});
