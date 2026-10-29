// Step 5, item 2: the scratch copy and the read-only run, tested on synthetic trees made under the system temp folder.
// No real folder is read. No engine starts. Every free-space answer is injected, so the real disk never decides a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_FLOOR_BYTES, MAX_FILE_BYTES, ROOT_PREFIX, ScratchError, SKIPPED_FOLDERS, TREE_NAME, cleanupRoot, guardDir, hashFiles, planCopy, scratchCopy, skipRule } from '../step5/scratch-copy.mjs';
import { diff, readManifest, readonlyRun, runner, snapshot, sourceProof } from '../step5/readonly-run.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const COPY = path.join(repo, 'tools/step5/scratch-copy.mjs'), RUN = path.join(repo, 'tools/step5/readonly-run.mjs');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(repo, 'tests/fixtures/harness-08/project.json'), 'utf8')).files;
const PLENTY = () => 10 * DEFAULT_FLOOR_BYTES;
// A made-up key-shaped value, joined at run time so no scanner reads a key in this file.
const FAKE_SECRET = ['sk', 'ant', 'api03'].join('-') + '-' + 'Q7x'.repeat(14);

// Each test works in its own HOME and XDG_STATE_HOME, below one temp folder.
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function temp(prefix) { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); made.push(d); return d; }
// The test process itself also reads no real home or state folder.
const own = temp('bowerloom-step5-own-');
process.env.HOME = path.join(own, 'home'); process.env.XDG_STATE_HOME = path.join(own, 'state');
fs.mkdirSync(process.env.HOME, { mode: 0o700 });
const envOf = base => ({ PATH: process.env.PATH ?? '', TMPDIR: os.tmpdir(), HOME: path.join(base, 'home'), XDG_STATE_HOME: path.join(base, 'state') });
function put(dir, rel, text = 'x\n', mode) {
  const full = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  if (mode !== undefined) fs.chmodSync(full, mode);
}
/** A synthetic source tree with an allowlisted file, a skipped one, and a link of each kind. */
function sourceTree({ settingsLocal = '{"permissions":{"allow":["Bash(ls:*)"]}}\n' } = {}) {
  const base = temp('bowerloom-step5-src-');
  const src = path.join(base, 'src');
  fs.mkdirSync(src);
  for (const [rel, text] of [
    ['AGENTS.md', '# A\n'], ['CLAUDE.md', '# C\n'], ['CLAUDE.md.bak', 'old\n'], ['.mcp.json', '{}\n'], ['opencode.json', '{}\n'], ['opencode.jsonc', '{}\n'],
    ['.claude/settings.json', '{}\n'], ['.claude/settings.local.json', settingsLocal],
    ['.claude/skills/review/SKILL.md', '---\nname: review\ndescription: x\n---\nok\n'],
    ['.claude/skills/token-guide/SKILL.md', 'skipped by name\n'],
    ['.claude/worktrees/w1/AGENTS.md', 'not copied\n'],
    ['.agents/skills/a/SKILL.md', 'a\n'], ['.bowerloom/harness.json', '{}\n'], ['.opencode/plugins/p.js', '//\n'], ['.pi/settings.json', '{}\n'], ['.dsh/config.json', '{}\n'],
    ['.codex/config.toml', '# c\n'], ['.codex/hooks.json', '{}\n'], ['.codex/rules/r.rules', 'r\n'], ['.codex/agents/x.toml', 'a\n'], ['.codex/prompts/p.md', 'p\n'],
    ['.codex/auth.json', '{"never":"copied"}\n'], ['.codex/sessions/log.txt', 'not allowlisted\n'],
    ['.env', 'A=1\n'], ['.env.local', 'A=2\n'], ['server.pem', 'k\n'], ['notes.txt', 'not allowlisted\n'], ['credentials.json', '{}\n'],
    ['docs/AGENTS.md', 'nested\n'], ['docs/deep/er/CLAUDE.md', 'nested\n'], ['docs/readme.md', 'not a nested instruction file\n'],
    ['node_modules/pkg/AGENTS.md', 'dependency\n'], ['archive/AGENTS.md', 'archive\n'], ['.git/config', '[core]\n'], ['test-results/AGENTS.md', 't\n'],
  ]) put(src, rel, text);
  fs.writeFileSync(path.join(src, '.claude', 'big.md'), Buffer.alloc(MAX_FILE_BYTES + 1, 97));
  // Links: one to a file outside the tree, one to a folder that holds an instruction file. Neither may be followed.
  const outside = path.join(base, 'outside');
  put(outside, 'AGENTS.md', 'outside the tree\n');
  fs.symlinkSync(path.join(outside, 'AGENTS.md'), path.join(src, 'linked-AGENTS.md'));
  fs.symlinkSync(outside, path.join(src, 'docs', 'linked-dir'));
  fs.symlinkSync(path.join(outside, 'AGENTS.md'), path.join(src, '.claude', 'linked.md'));
  return { base, src, outside };
}
// A scratch root is a name that does not exist yet: the copy makes the folder itself and refuses an existing one.
function root() { const d = temp(ROOT_PREFIX); fs.rmdirSync(d); return d; }
const listTree = dir => { const out = []; const walk = r => { for (const n of fs.readdirSync(path.join(dir, r)).sort()) { const c = r ? `${r}/${n}` : n; if (fs.lstatSync(path.join(dir, c)).isDirectory()) walk(c); else out.push(c); } }; walk(''); return out; };

test('the skip list names each rule, and wins over names the allowlist would take', () => {
  const cases = { '.git': 'skipped-folder', node_modules: 'skipped-folder', '.worktrees': 'skipped-folder', archive: 'skipped-folder', 'test-results': 'skipped-folder',
    '.env': 'env-file', '.env.production': 'env-file', 'a.pem': 'key-file', 'b.KEY': 'key-file', 'c.p12': 'key-file', 'd.pfx': 'key-file', 'e.JKS': 'key-file', 'f.keystore': 'key-file', id_rsa: 'ssh-key', 'Login-Keychain.db': 'keychain',
    '.netrc': 'credentials-file', '.npmrc': 'credentials-file', '.pgpass': 'credentials-file', '.git-credentials': 'credentials-file',
    'auth.json': 'credentials-file', 'credentials.json': 'credentials-file', '.credentials.json': 'credentials-file', '.Credentials': 'credentials-file',
    'my-token.md': 'secret-name', 'Secrets.md': 'secret-name', 'a.sqlite': 'database', 'a.sqlite-wal': 'database' };
  for (const [name, rule] of Object.entries(cases)) assert.equal(skipRule(name), rule, name);
  for (const name of ['AGENTS.md', 'CLAUDE.md', '.mcp.json', 'settings.json', 'config.toml', 'SKILL.md', 'identity.md', '.gitignore', '.claude']) assert.equal(skipRule(name), null, name);
});

test('the shipped skip list holds only generic folder names; extra names come from --skip', () => {
  // The shipped list is exactly these generic names; no tool folder of one person is on it.
  assert.deepEqual([...SKIPPED_FOLDERS].sort(), ['.git', '.worktrees', 'archive', 'node_modules', 'test-results']);
  assert.equal(skipRule('.madeup-tool'), null);
  assert.equal(skipRule('.madeup-tool', new Set(['.madeup-tool'])), 'skipped-folder');
  // A made-up folder is copied until it is named.
  const { src } = sourceTree();
  put(src, '.madeup-tool/AGENTS.md', 'm\n'); put(src, 'other-stuff/AGENTS.md', 'o\n'); put(src, 'docs/Made-Up-Cache/CLAUDE.md', 'c\n');
  assert.ok(planCopy(src).files.some(f => f.rel === '.madeup-tool/AGENTS.md'));
  const plan = planCopy(src, { skip: ['.madeup-tool', 'made-up-cache'] });
  assert.deepEqual(plan.files.filter(f => /madeup|made-up|other-stuff/i.test(f.rel)).map(f => f.rel), ['other-stuff/AGENTS.md']);
  assert.deepEqual(plan.skipped.filter(s => /madeup|made-up/i.test(s.rel)), [{ rel: '.madeup-tool', rule: 'skipped-folder' }, { rel: 'docs/Made-Up-Cache', rule: 'skipped-folder' }]);
  // Through the command, the option repeats; a path or a missing value is a usage error.
  const base = temp('bowerloom-step5-env-'), env = envOf(base), r = root();
  put(src, '.other-made-up/AGENTS.md', 'x\n');
  const done = spawnSync(process.execPath, [COPY, src, r, '--min-free-bytes', '0', '--skip', '.madeup-tool', '--skip', '.other-made-up'], { encoding: 'utf8', env });
  assert.equal(done.status, 0, done.stderr);
  const tree = path.join(r, 'tree', TREE_NAME);
  assert.equal(fs.existsSync(path.join(tree, '.madeup-tool')) || fs.existsSync(path.join(tree, '.other-made-up')), false);
  assert.ok(fs.existsSync(path.join(tree, 'other-stuff', 'AGENTS.md')));
  for (const bad of [['--skip'], ['--skip', 'a/b'], ['--skip', '']]) {
    const run = spawnSync(process.execPath, [COPY, src, root(), '--min-free-bytes', '0', ...bad], { encoding: 'utf8', env });
    assert.equal(run.status, 2, bad.join(' ')); assert.equal(JSON.parse(run.stderr).code, 'USAGE');
  }
});

test('the allowlist: root instruction files and tool folders are copied; the skip list, the size limit, and everything else are not', () => {
  const { src } = sourceTree(), r = root();
  const before = hashFiles(src, listTree(src).filter(f => !f.startsWith('.git/')));
  const report = scratchCopy(src, r, { freeBytes: PLENTY });
  assert.equal(report.ok, true, JSON.stringify(report));
  const tree = path.join(r, 'tree', TREE_NAME);
  assert.deepEqual(listTree(tree).filter(f => !f.startsWith('.git/')), [
    '.agents/skills/a/SKILL.md', '.bowerloom/harness.json', '.claude/settings.json', '.claude/settings.local.json', '.claude/skills/review/SKILL.md',
    '.codex/agents/x.toml', '.codex/config.toml', '.codex/hooks.json', '.codex/prompts/p.md', '.codex/rules/r.rules', '.dsh/config.json', '.mcp.json', '.opencode/plugins/p.js', '.pi/settings.json',
    'AGENTS.md', 'CLAUDE.md', 'CLAUDE.md.bak', 'docs/AGENTS.md', 'docs/deep/er/CLAUDE.md', 'opencode.json', 'opencode.jsonc',
  ]);
  assert.equal(report.copied.files, 21);
  // Each skipped entry has a rule. The oversize file and the folders the blueprint leaves out are named.
  const rule = rel => report.skipped.listed.find(s => s.rel === rel)?.rule;
  assert.equal(rule('.claude/skills/token-guide'), 'secret-name');
  assert.equal(rule('.claude/worktrees'), 'worktrees');
  assert.equal(rule('.claude/big.md'), 'too-large');
  assert.equal(rule('.codex/auth.json'), 'credentials-file');
  assert.equal(rule('.codex/sessions'), 'not-allowlisted');
  assert.equal(rule('.env'), 'env-file'); assert.equal(rule('server.pem'), 'key-file'); assert.equal(rule('credentials.json'), 'credentials-file');
  for (const dir of ['node_modules', 'archive', '.git', 'test-results']) assert.equal(rule(dir), 'skipped-folder', dir);
  // The scratch root: private, with home, state, and a tree whose name has a space.
  assert.equal(fs.statSync(r).mode & 0o777, 0o700);
  for (const d of ['home', 'state', 'tree', path.join('tree', TREE_NAME)]) assert.equal(fs.statSync(path.join(r, d)).mode & 0o777, 0o700, d);
  assert.ok(TREE_NAME.includes(' '));
  assert.equal(report.git, 'initialised'); assert.ok(fs.existsSync(path.join(tree, '.git', 'HEAD')));
  assert.equal(fs.readdirSync(path.join(tree, '.git')).includes('objects') && fs.readdirSync(path.join(tree, '.git', 'objects')).filter(n => n.length === 2).length, 0, 'no history');
  assert.equal(fs.statSync(path.join(r, 'scratch.json')).mode & 0o777, 0o600);
  // Bytes and modes survive, and the source did not change.
  assert.deepEqual(hashFiles(tree, ['AGENTS.md', '.claude/skills/review/SKILL.md']), { 'AGENTS.md': before['AGENTS.md'], '.claude/skills/review/SKILL.md': before['.claude/skills/review/SKILL.md'] });
  assert.deepEqual(report.sourceProof.changed, []); assert.equal(report.sourceProof.unchanged, true);
  assert.equal(report.copyProof.differs.length, 0);
});

test('a copy keeps the mode of a source file', () => {
  const { src } = sourceTree(), r = root();
  fs.chmodSync(path.join(src, '.claude', 'settings.json'), 0o640); fs.chmodSync(path.join(src, 'AGENTS.md'), 0o755);
  scratchCopy(src, r, { freeBytes: PLENTY });
  const tree = path.join(r, 'tree', TREE_NAME);
  assert.equal(fs.statSync(path.join(tree, '.claude', 'settings.json')).mode & 0o777, 0o640);
  assert.equal(fs.statSync(path.join(tree, 'AGENTS.md')).mode & 0o777, 0o755);
});

test('links are listed and never followed, in a tool folder, at the root, and below a nested folder', () => {
  const { src } = sourceTree(), r = root();
  const plan = planCopy(src);
  assert.deepEqual(plan.links, ['.claude/linked.md', 'docs/linked-dir', 'linked-AGENTS.md']);
  const report = scratchCopy(src, r, { freeBytes: PLENTY });
  assert.deepEqual(report.links, ['.claude/linked.md', 'docs/linked-dir', 'linked-AGENTS.md']);
  const tree = path.join(r, 'tree', TREE_NAME);
  for (const rel of report.links) assert.equal(fs.existsSync(path.join(tree, rel)), false, `${rel} is not in the copy`);
  for (const f of listTree(tree).filter(f => !f.startsWith('.git/'))) assert.notEqual(fs.readFileSync(path.join(tree, f), 'utf8'), 'outside the tree\n', f);
  assert.equal(listTree(tree).some(f => f.startsWith('docs/linked-dir')), false);
  // A tool folder that is itself a link is listed, and nothing in it is read.
  const { src: s2, outside } = sourceTree();
  fs.rmSync(path.join(s2, '.agents'), { recursive: true }); fs.symlinkSync(outside, path.join(s2, '.agents'));
  assert.ok(planCopy(s2).links.includes('.agents'));
  assert.equal(planCopy(s2).files.some(f => f.rel.startsWith('.agents/')), false);
});

test('the secret scan gates .claude/settings.local.json: a value withholds the file and names the rule, never the value', () => {
  const dirty = sourceTree({ settingsLocal: `${JSON.stringify({ env: { SERVICE_API_KEY: FAKE_SECRET } })}\n` }), r = root();
  const report = scratchCopy(dirty.src, r, { freeBytes: PLENTY });
  assert.equal(report.withheld.length, 1);
  assert.equal(report.withheld[0].rel, '.claude/settings.local.json');
  assert.ok(report.withheld[0].rules.length > 0 && report.withheld[0].rules.every(x => typeof x === 'string' && !x.includes(FAKE_SECRET)));
  const tree = path.join(r, 'tree', TREE_NAME);
  assert.equal(fs.existsSync(path.join(tree, '.claude', 'settings.local.json')), false);
  const everything = [JSON.stringify(report), fs.readFileSync(path.join(r, 'scratch.json'), 'utf8'), ...listTree(r).map(f => fs.readFileSync(path.join(r, f), 'utf8'))].join('\n');
  assert.equal(everything.includes(FAKE_SECRET), false, 'the value is nowhere in the scratch root or the report');
  // A withheld file is still hashed, so a change to it shows in the source proof.
  assert.ok('.claude/settings.local.json' in JSON.parse(fs.readFileSync(path.join(r, 'scratch.json'), 'utf8')).sourceHashes);
  // A clean one is copied.
  const clean = sourceTree(), r2 = root();
  const ok = scratchCopy(clean.src, r2, { freeBytes: PLENTY });
  assert.deepEqual(ok.withheld, []);
  assert.ok(fs.existsSync(path.join(r2, 'tree', TREE_NAME, '.claude', 'settings.local.json')));
});

test('the before-and-after proof: an unchanged source passes, and a change to any hashed file is a finding', () => {
  const { src } = sourceTree(), r = root();
  scratchCopy(src, r, { freeBytes: PLENTY });
  const { manifest } = readManifest(r);
  assert.equal(Object.keys(manifest.sourceHashes).length, 21, 'every copied file is hashed');
  assert.deepEqual(sourceProof(src, manifest), { hashedFiles: 21, unchanged: true, changed: [] });
  fs.appendFileSync(path.join(src, 'AGENTS.md'), 'edited\n');
  fs.rmSync(path.join(src, '.mcp.json'));
  const proof = sourceProof(src, manifest);
  assert.equal(proof.unchanged, false);
  assert.deepEqual(proof.changed, ['.mcp.json', 'AGENTS.md']);
  // The copy keeps the bytes of the first read: the edit reaches only the source.
  assert.equal(fs.readFileSync(path.join(r, 'tree', TREE_NAME, 'AGENTS.md'), 'utf8'), '# A\n');
  // The snapshot comparison names a change by path and kind, and holds no content.
  const a = snapshot(path.join(r, 'tree', TREE_NAME));
  fs.appendFileSync(path.join(r, 'tree', TREE_NAME, 'CLAUDE.md'), 'x');
  fs.writeFileSync(path.join(r, 'tree', TREE_NAME, 'new.md'), 'n');
  assert.deepEqual(diff(a, snapshot(path.join(r, 'tree', TREE_NAME))), [{ path: 'CLAUDE.md', kind: 'changed' }, { path: 'new.md', kind: 'added' }]);
});

test('the free-space floor: the copy is refused before anything is created when it would leave less than 12 GiB, and the answer is injected', () => {
  const { src } = sourceTree();
  const plan = planCopy(src);
  const asked = [];
  const reader = free => dir => { asked.push(dir); return free; };
  const r = root();
  assert.throws(() => scratchCopy(src, r, { freeBytes: reader(DEFAULT_FLOOR_BYTES + plan.bytes - 1) }), e => e instanceof ScratchError && e.code === 'FREE_SPACE_BELOW_FLOOR');
  assert.equal(fs.existsSync(r), false, 'nothing was created');
  assert.deepEqual(asked, [os.tmpdir() === path.dirname(r) ? path.dirname(r) : fs.realpathSync(path.dirname(r))]);
  // The bytes to copy count against the floor, and the floor is 12 GiB by default.
  assert.equal(DEFAULT_FLOOR_BYTES, 12 * 1024 ** 3);
  const exact = scratchCopy(src, r, { freeBytes: reader(DEFAULT_FLOOR_BYTES + plan.bytes) });
  assert.equal(exact.ok, true, 'free space equal to the floor plus the copy is enough');
  // The floor can be raised, and an unreadable disk answer is a refusal.
  const r2 = root();
  assert.throws(() => scratchCopy(src, r2, { freeBytes: reader(100 * 1024 ** 3), minFreeBytes: 101 * 1024 ** 3 }), e => e.code === 'FREE_SPACE_BELOW_FLOOR');
  assert.throws(() => scratchCopy(src, r2, { freeBytes: () => NaN }), e => e.code === 'FREE_SPACE_BELOW_FLOOR');
  assert.equal(fs.existsSync(r2), false);
});

test('the scratch root must be new, named for this tool, directly below the system temp folder, and apart from the source', () => {
  const { src, base } = sourceTree();
  const code = fn => { try { fn(); } catch (e) { return e.code; } return 'none'; };
  const free = { freeBytes: PLENTY };
  assert.equal(code(() => scratchCopy(src, 'relative/' + ROOT_PREFIX + 'x', free)), 'ROOT_NOT_ABSOLUTE');
  assert.equal(code(() => scratchCopy(src, path.join(os.tmpdir(), 'other-name-' + process.pid), free)), 'ROOT_NAME');
  assert.equal(code(() => scratchCopy(src, path.join(base, ROOT_PREFIX + 'inner'), free)), 'ROOT_OUTSIDE_TEMP');
  assert.equal(code(() => scratchCopy(src, path.join(process.env.HOME, ROOT_PREFIX + 'home'), free)), 'ROOT_OUTSIDE_TEMP');
  const full = root(); fs.mkdirSync(full); fs.writeFileSync(path.join(full, 'x'), 'x');
  assert.equal(code(() => scratchCopy(src, full, free)), 'ROOT_NOT_EMPTY');
  assert.equal(code(() => scratchCopy(path.join(base, 'nope'), root(), free)), 'SOURCE_MISSING');
  assert.equal(code(() => scratchCopy('relative', root(), free)), 'SOURCE_NOT_ABSOLUTE');
  // A source that holds the scratch root, or sits inside it, is refused.
  const outer = fs.realpathSync(os.tmpdir());
  const inside = fs.mkdtempSync(path.join(outer, ROOT_PREFIX)); made.push(inside);
  const nested = path.join(inside, 'src'); fs.mkdirSync(nested);
  assert.equal(code(() => scratchCopy(nested, inside, free)), 'ROOT_OVERLAPS_SOURCE');
  assert.equal(code(() => scratchCopy(outer, path.join(outer, ROOT_PREFIX + 'all-' + process.pid), free)), 'ROOT_OVERLAPS_SOURCE');
});

test('the walk stops at its entry limit and says so', () => {
  const { src } = sourceTree();
  const plan = planCopy(src, { maxEntries: 5 });
  assert.match(plan.stopped, /limit/);
  assert.equal(planCopy(src).stopped, null);
});

test('the command line of scratch-copy: arguments, exit codes, a report with no contents', () => {
  const { src } = sourceTree(), r = root(), base = temp('bowerloom-step5-env-');
  const env = envOf(base);
  const usage = spawnSync(process.execPath, [COPY, src], { encoding: 'utf8', env });
  assert.equal(usage.status, 2); assert.equal(JSON.parse(usage.stderr).code, 'USAGE');
  // The real disk may hold less than 12 GiB, so a run here passes a floor of 0; the floor itself is tested above with an injected reader.
  const done = spawnSync(process.execPath, [COPY, src, r, '--min-free-bytes', '0'], { encoding: 'utf8', env });
  assert.equal(done.status, 0, done.stderr);
  const report = JSON.parse(done.stdout);
  assert.equal(report.copied.files, 21);
  assert.equal(done.stdout.includes(src), false, 'the report does not name the source folder');
  assert.equal(done.stdout.includes('# A'), false, 'and holds no file content');
  const refused = spawnSync(process.execPath, [COPY, src, r, '--min-free-bytes', '0'], { encoding: 'utf8', env });
  assert.equal(refused.status, 3); assert.equal(JSON.parse(refused.stderr).code, 'ROOT_NOT_EMPTY');
  const floor = spawnSync(process.execPath, [COPY, src, root(), '--min-free-bytes', String(2 ** 60)], { encoding: 'utf8', env });
  assert.equal(floor.status, 3); assert.equal(JSON.parse(floor.stderr).code, 'FREE_SPACE_BELOW_FLOOR');
});

test('the guard refuses a --dir outside the scratch root, before any command runs', () => {
  const { src, base: srcBase } = sourceTree(), r = root();
  scratchCopy(src, r, { freeBytes: PLENTY });
  const tree = path.join(r, 'tree', TREE_NAME);
  const stateBefore = fs.readdirSync(path.join(r, 'state'));
  const outside = path.join(srcBase, 'outside');
  const link = path.join(tree, 'link-out'); fs.symlinkSync(outside, link);
  const code = dir => { try { guardDir(dir, r); } catch (e) { return e.code; } return 'allowed'; };
  assert.equal(code(outside), 'DIR_OUTSIDE_SCRATCH');
  assert.equal(code(src), 'DIR_OUTSIDE_SCRATCH');
  assert.equal(code(process.env.HOME), 'DIR_OUTSIDE_SCRATCH');
  assert.equal(code(r), 'DIR_OUTSIDE_SCRATCH', 'the root itself is not a project folder');
  assert.equal(code(path.join(r, 'tree')), 'DIR_OUTSIDE_SCRATCH');
  assert.equal(code(path.join(r, 'home')), 'DIR_OUTSIDE_SCRATCH');
  assert.equal(code(link), 'DIR_OUTSIDE_SCRATCH', 'a link that leaves the root is judged by where it leads');
  assert.equal(code(path.join(tree, 'missing')), 'DIR_OUTSIDE_SCRATCH');
  assert.equal(code(path.join(tree, 'docs')), 'allowed');
  assert.equal(code(tree), 'allowed');
  // Through the command: refused, nothing run, nothing written.
  const env = envOf(srcBase);
  for (const dir of [outside, link, src]) {
    const run = spawnSync(process.execPath, [RUN, src, r, '--dir', dir], { encoding: 'utf8', env });
    assert.equal(run.status, 3, run.stderr); assert.equal(JSON.parse(run.stderr).code, 'DIR_OUTSIDE_SCRATCH');
    assert.equal(run.stdout, '');
  }
  assert.deepEqual(fs.readdirSync(path.join(r, 'state')), stateBefore, 'no command ran');
  assert.equal(fs.existsSync(path.join(outside, '.bowerloom')), false);
  assert.equal(fs.existsSync(path.join(r, 'report.json')), false);
  // A folder that is not a scratch root is refused too.
  const plain = temp(ROOT_PREFIX);
  const notScratch = spawnSync(process.execPath, [RUN, src, plain], { encoding: 'utf8', env });
  assert.equal(notScratch.status, 3); assert.equal(JSON.parse(notScratch.stderr).code, 'ROOT_NOT_SCRATCH');
});

test('the read-only run: the whole sequence on a synthetic tree, a report with no contents, the source unchanged, the folder as it was after adoption', () => {
  const base = temp('bowerloom-step5-fixture-'), src = path.join(base, 'src');
  for (const [rel, text] of Object.entries(FIXTURE)) put(src, rel, text);
  put(src, 'docs/AGENTS.md', 'nested note\n');
  // An entry that could limit access: adoption asks for an acknowledgement, and the run gives it (decision I6 B).
  put(src, '.codex/config.toml', `approval_policy = "on-request"\n\n${FIXTURE['.codex/config.toml']}`);
  const r = root();
  const env = envOf(base);
  const copy = scratchCopy(src, r, { freeBytes: PLENTY });
  assert.equal(copy.ok, true);
  const run = spawnSync(process.execPath, [RUN, src, r, '--every-engine', 'guardrails', '--every-engine', 'hooks', '--every-engine', 'mcp'], { encoding: 'utf8', env, timeout: 300_000 });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const report = JSON.parse(run.stdout);
  assert.equal(report.stoppedAt, null);
  assert.deepEqual(report.steps.map(s => s.step).filter((s, i, a) => a.indexOf(s) === i), ['status', 'adopt-plan', 'adopt-plan-answered', 'adopt-apply', 'install', 'accept', 'install-plan', 'install-apply', 'drift', 'remove-plan', 'remove-apply']);
  assert.deepEqual(report.status, { present: false, projected: false });
  // Adoption: counts per part, the conflict answered with the Claude Code variant, entries that ask, secret reference names.
  assert.deepEqual(report.adoption.conflicts, [{ key: 'system-prompt/AGENTS.md', variants: ['AGENTS.md', 'CLAUDE.md'], picked: 'CLAUDE.md' }]);
  assert.equal(report.adoption.ready, true);
  assert.ok(report.adoption.items.skills >= 1 && report.adoption.items.mcp >= 1);
  assert.ok(report.adoption.unmapped.some(u => u.gate === 'acknowledge' && u.part === 'guardrails'), 'the entry that asks is reported with its reason');
  assert.ok(report.adoption.unmapped.every(u => typeof u.id === 'string' && typeof u.reason === 'string'));
  assert.ok(report.adoption.secretReferences.every(x => typeof x === 'string'));
  assert.deepEqual(report.outsideDefinition, [], 'adoption wrote only .bowerloom');
  assert.ok(report.written.every(p => p.startsWith('.bowerloom/') || !p.endsWith('/')));
  // Install: lines by engine and result, deferred parts, the plugin hash, taken over files.
  assert.ok(Object.keys(report.install.refused).every(k => /^(codex|opencode)\/(weakened|absent)$/.test(k)) && Object.keys(report.install.refused).length > 0);
  assert.match(report.install.pluginHash, /^[a-f0-9]{64}$/);
  assert.ok(report.install.takenOver.length > 0);
  assert.deepEqual(report.drift, []);
  // The folder is as it was after adoption, and the source is as it was before the copy.
  assert.deepEqual(report.restored, { equalToPostAdoption: true, differences: [] });
  assert.deepEqual(report.sourceProof, { hashedFiles: Object.keys(JSON.parse(fs.readFileSync(path.join(r, 'scratch.json'), 'utf8')).sourceHashes).length, unchanged: true, changed: [] });
  assert.deepEqual(report.refusalCodes, ['PORTABLE_FIDELITY']);
  // No contents, no scratch or source path, in the output or the saved report.
  const saved = fs.readFileSync(path.join(r, 'report.json'), 'utf8');
  assert.equal(saved, run.stdout);
  for (const text of ['Use pnpm', 'Use npm', 'files-server', 'notes-server', r, src, base]) assert.equal(run.stdout.includes(text), false, text);
  // The source tree was only read.
  for (const [rel, text] of Object.entries(FIXTURE)) if (rel !== '.codex/config.toml') assert.equal(fs.readFileSync(path.join(src, rel), 'utf8'), text, rel);
  assert.equal(fs.existsSync(path.join(src, '.bowerloom')), false);
  // The state of the run is inside the scratch root; the test home has none.
  assert.ok(fs.readdirSync(path.join(r, 'state')).length > 0);
  assert.equal(fs.existsSync(path.join(base, 'state')), false);
});

test('the scratch scripts are not shipped: the pack lists neither tools/ nor these files', async () => {
  const { MODULES, ASSETS } = await import('../cli-distribution/pack.mjs');
  for (const entry of [...MODULES, ...ASSETS]) assert.equal(/step5|^tools\//.test(entry), false, entry);
  const text = fs.readFileSync(path.join(repo, 'tools/cli-distribution/pack.mjs'), 'utf8');
  assert.equal(/tools\/step5|scratch-copy|readonly-run/.test(text), false);
});

// ---- review fixes: S3, S6, silent-failure 7 ----------------------------------------------------------------------------

test('the secret scan covers every file the copy keeps; a hit withholds it and names the path and the rule, never the value', () => {
  const { src } = sourceTree(), r = root();
  const json = `${JSON.stringify({ env: { SERVICE_API_KEY: FAKE_SECRET } })}\n`, line = `SERVICE_API_KEY = "${FAKE_SECRET}"\n`;
  const dirty = ['.mcp.json', '.claude/settings.json', 'opencode.json', '.pi/settings.json', '.codex/config.toml', '.opencode/plugins/p.js', '.agents/skills/a/SKILL.md', 'docs/AGENTS.md', 'CLAUDE.md'];
  for (const rel of dirty) put(src, rel, rel.endsWith('.json') ? json : line);
  const report = scratchCopy(src, r, { freeBytes: PLENTY });
  assert.deepEqual(report.withheld.map(w => w.rel), [...dirty].sort());
  for (const w of report.withheld) assert.ok(w.rules.length > 0 && w.rules.every(x => typeof x === 'string' && /^[a-z0-9-]+$/.test(x)), w.rel);
  assert.deepEqual(report.withheld.map(w => Object.keys(w).sort()), report.withheld.map(() => ['rel', 'rules']));
  const tree = path.join(r, 'tree', TREE_NAME);
  const left = listTree(tree).filter(f => !f.startsWith('.git/'));
  for (const rel of dirty) assert.equal(left.includes(rel), false, `${rel} is withheld`);
  assert.ok(left.includes('AGENTS.md') && left.includes('.claude/skills/review/SKILL.md'), 'clean files are still copied');
  const everything = [JSON.stringify(report), fs.readFileSync(path.join(r, 'scratch.json'), 'utf8'), ...listTree(r).map(f => fs.readFileSync(path.join(r, f), 'utf8'))].join('\n');
  assert.equal(everything.includes(FAKE_SECRET), false, 'the value is nowhere in the scratch root or the report');
  // A withheld file is hashed, so the source proof still sees a change to it.
  const manifest = JSON.parse(fs.readFileSync(path.join(r, 'scratch.json'), 'utf8'));
  for (const rel of dirty) assert.ok(rel in manifest.sourceHashes, rel);
  assert.equal(report.ok, true);
});

test('a credentials file with a leading dot, and the other key and password stores, are skipped even in a tool folder', () => {
  const { src } = sourceTree(), r = root();
  for (const rel of ['.claude/.credentials.json', '.claude/.pgpass', '.agents/.git-credentials', '.pi/store.pfx', '.pi/store.jks', '.pi/store.keystore']) put(src, rel, '{}\n');
  const report = scratchCopy(src, r, { freeBytes: PLENTY });
  const rule = rel => report.skipped.listed.find(s => s.rel === rel)?.rule;
  assert.equal(rule('.claude/.credentials.json'), 'credentials-file');
  assert.equal(rule('.claude/.pgpass'), 'credentials-file');
  assert.equal(rule('.agents/.git-credentials'), 'credentials-file');
  for (const rel of ['.pi/store.pfx', '.pi/store.jks', '.pi/store.keystore']) assert.equal(rule(rel), 'key-file', rel);
  const left = listTree(path.join(r, 'tree', TREE_NAME));
  assert.equal(left.some(f => /credentials|pgpass|\.pfx|\.jks|keystore/.test(f)), false);
});

test('the scratch root is made with mode 0700 and without recursion: an existing name is refused, and a planted link is never followed', () => {
  const { src, base } = sourceTree();
  const code = fn => { try { fn(); } catch (e) { return e.code; } return 'none'; };
  const free = { freeBytes: PLENTY };
  // An empty folder that already exists is refused (EEXIST), not reused.
  const existing = root(); fs.mkdirSync(existing, { mode: 0o755 });
  assert.equal(code(() => scratchCopy(src, existing, free)), 'ROOT_EXISTS');
  assert.deepEqual(fs.readdirSync(existing), [], 'nothing was written into it');
  assert.equal(fs.statSync(existing).mode & 0o777, 0o755, 'its mode was not touched');
  // A link planted at the name is refused, and the folder it leads to is left alone.
  const target = path.join(base, 'target'); fs.mkdirSync(target, { mode: 0o755 });
  const planted = root(); fs.symlinkSync(target, planted);
  assert.notEqual(code(() => scratchCopy(src, planted, free)), 'none');
  assert.deepEqual(fs.readdirSync(target), []);
  assert.equal(fs.statSync(target).mode & 0o777, 0o755);
  // A new name gives a real folder, private, owned by the user.
  const fresh = root();
  scratchCopy(src, fresh, free);
  const st = fs.lstatSync(fresh);
  assert.ok(st.isDirectory() && !st.isSymbolicLink());
  assert.equal(st.mode & 0o777, 0o700);
  assert.equal(st.uid, process.getuid());
  // The command line gives the same refusal.
  const env = envOf(temp('bowerloom-step5-env-'));
  const again = spawnSync(process.execPath, [COPY, src, existing, '--min-free-bytes', '0'], { encoding: 'utf8', env });
  assert.equal(again.status, 3); assert.equal(JSON.parse(again.stderr).code, 'ROOT_EXISTS');
});

test('a folder the walk cannot read is recorded as unreadable-folder and the report is not ok', { skip: process.getuid?.() === 0 }, () => {
  const { src } = sourceTree(), r = root();
  const locked = path.join(src, '.claude', 'locked');
  put(src, '.claude/locked/note.md', 'n\n');
  fs.chmodSync(locked, 0o000);
  try {
    const plan = planCopy(src);
    assert.deepEqual(plan.skipped.filter(s => s.rule === 'unreadable-folder'), [{ rel: '.claude/locked', rule: 'unreadable-folder' }]);
    const report = scratchCopy(src, r, { freeBytes: PLENTY });
    assert.equal(report.ok, false);
    assert.equal(report.skipped.byRule['unreadable-folder'], 1);
    assert.ok(report.skipped.listed.some(s => s.rel === '.claude/locked' && s.rule === 'unreadable-folder'));
    // The rest of the copy went ahead.
    assert.ok(fs.existsSync(path.join(r, 'tree', TREE_NAME, 'AGENTS.md')));
    // The command exits 1 for a report that is not ok.
    const run = spawnSync(process.execPath, [COPY, src, root(), '--min-free-bytes', '0'], { encoding: 'utf8', env: envOf(temp('bowerloom-step5-env-')) });
    assert.equal(run.status, 1);
  } finally { fs.chmodSync(locked, 0o755); }
});

test('--cleanup removes a scratch root, and only one that passes the root checks', () => {
  const { src } = sourceTree();
  const code = fn => { try { fn(); } catch (e) { return e.code; } return 'none'; };
  const env = envOf(temp('bowerloom-step5-env-'));
  const r = root();
  const done = spawnSync(process.execPath, [COPY, src, r, '--min-free-bytes', '0'], { encoding: 'utf8', env });
  assert.equal(done.status, 0, done.stderr);
  // The last line of output tells the reader to delete the root after reading the report; stdout stays pure JSON.
  const lines = done.stderr.trim().split('\n');
  assert.match(lines[lines.length - 1], /delete the scratch root.*--cleanup/i);
  assert.ok(done.stderr.includes(r));
  JSON.parse(done.stdout);
  // Refusals first, each leaving the folder in place.
  assert.equal(code(() => cleanupRoot('relative/' + ROOT_PREFIX + 'x')), 'ROOT_NOT_ABSOLUTE');
  const other = temp('other-name-'); fs.writeFileSync(path.join(other, 'scratch.json'), '{}');
  assert.equal(code(() => cleanupRoot(other)), 'ROOT_NAME');
  const noManifest = temp(ROOT_PREFIX);
  assert.equal(code(() => cleanupRoot(noManifest)), 'ROOT_NOT_SCRATCH');
  const outside = path.join(temp('bowerloom-step5-holder-'), ROOT_PREFIX + 'inner'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'scratch.json'), '{}');
  assert.equal(code(() => cleanupRoot(outside)), 'ROOT_OUTSIDE_TEMP');
  assert.equal(code(() => cleanupRoot(root())), 'ROOT_MISSING');
  const linkTarget = temp(ROOT_PREFIX); fs.writeFileSync(path.join(linkTarget, 'scratch.json'), '{}');
  const link = root(); fs.symlinkSync(linkTarget, link);
  assert.notEqual(code(() => cleanupRoot(link)), 'none');
  for (const kept of [other, noManifest, outside, linkTarget, r]) assert.equal(fs.existsSync(kept), true, kept);
  // A real scratch root goes, whole; the source does not.
  const refusedCli = spawnSync(process.execPath, [COPY, '--cleanup', other], { encoding: 'utf8', env });
  assert.equal(refusedCli.status, 3); assert.equal(JSON.parse(refusedCli.stderr).code, 'ROOT_NAME');
  const gone = spawnSync(process.execPath, [COPY, '--cleanup', r], { encoding: 'utf8', env });
  assert.equal(gone.status, 0, gone.stderr);
  assert.equal(fs.existsSync(r), false);
  assert.equal(fs.existsSync(path.join(src, 'AGENTS.md')), true);
  const twice = spawnSync(process.execPath, [COPY, '--cleanup', r], { encoding: 'utf8', env });
  assert.equal(twice.status, 3); assert.equal(JSON.parse(twice.stderr).code, 'ROOT_MISSING');
  const usage = spawnSync(process.execPath, [COPY, '--cleanup'], { encoding: 'utf8', env });
  assert.equal(usage.status, 2);
  const mixed = spawnSync(process.execPath, [COPY, '--cleanup', r, src], { encoding: 'utf8', env });
  assert.equal(mixed.status, 2);
});

// A stand-in for the built command line, so these tests start no engine and no network call. It is a plain node script.
function fakeCli(body) {
  const dir = temp('bowerloom-step5-fake-'), file = path.join(dir, 'cli.js');
  fs.writeFileSync(file, body);
  return file;
}
const PLAN = { items: [], conflicts: [], unmapped: [], secrets: [], approvalsRequired: [], everyEngine: [], files: [], ready: true };
const ADOPT_THEN_STOP = `
const a = process.argv.slice(3);
if (a[0] === 'status') { console.log('{}'); process.exit(0); }
if (a[0] === 'adopt') { if (a.includes('--approve')) process.exit(0); console.log(JSON.stringify({ plan: ${JSON.stringify(PLAN)}, revision: 'r1' })); process.exit(3); }
process.exit(1);
`;

test('a step records the spawn error code, the signal, and a timed-out flag', () => {
  const { src } = sourceTree(), r = root();
  scratchCopy(src, r, { freeBytes: PLENTY });
  const dir = path.join(r, 'tree', TREE_NAME);
  // A signal: the child ends itself.
  const killed = readonlyRun({ root: r, dir, cli: fakeCli("if (process.argv[3] === 'status') process.kill(process.pid, 'SIGKILL'); process.exit(1);") });
  assert.equal(killed.steps[0].step, 'status');
  assert.equal(killed.steps[0].exit, null);
  assert.equal(killed.steps[0].signal, 'SIGKILL');
  assert.equal(killed.steps[0].timedOut, undefined);
  assert.equal(killed.steps[0].error, undefined);
  // A timeout: the child outlives the limit.
  const slow = runner(r, dir, fakeCli('setTimeout(() => {}, 60000);'), { timeoutMs: 300 });
  slow.run('status', ['status']);
  assert.equal(slow.steps[0].timedOut, true);
  assert.equal(slow.steps[0].error, 'ETIMEDOUT');
  assert.equal(slow.steps[0].signal, 'SIGTERM');
  assert.equal(slow.steps[0].exit, null);
  // A spawn error: the folder to run in is missing.
  const broken = runner(r, path.join(r, 'no-such-folder'), fakeCli('process.exit(0);'));
  broken.run('status', ['status']);
  assert.equal(broken.steps[0].error, 'ENOENT');
  assert.equal(broken.steps[0].exit, null);
  // A normal step carries none of the three.
  const fine = runner(r, dir, fakeCli('process.exit(0);'));
  fine.run('status', ['status']);
  assert.deepEqual(fine.steps, [{ step: 'status', exit: 0 }]);
});

test('restored is null when the run stopped, and set when it ran to the end', () => {
  const { src } = sourceTree(), r = root();
  scratchCopy(src, r, { freeBytes: PLENTY });
  const dir = path.join(r, 'tree', TREE_NAME);
  // Adoption applies, then install refuses: the run stops at install, and no restore was ever tried.
  const stopped = readonlyRun({ root: r, dir, cli: fakeCli(ADOPT_THEN_STOP) });
  assert.equal(stopped.stoppedAt, 'install');
  assert.equal(stopped.restored, null);
  assert.ok(stopped.install.stopped);
});

// ---- every exit path of the run sets refusalCodes ---------------------------------------------------------------------

/**
 * A stand-in for the built command line, so a run can be made to stop at any step with any code. `script` maps a stage
 * (adopt-plan, adopt-plan-answered, adopt-apply, install, accept, install-plan, install-apply, drift, remove-plan, remove-apply, status)
 * to a list of answers, used in call order: { exit, stdout?, code? }. A stage with no answer exits 0 with no output.
 */
function scriptedCli(script) {
  const dir = temp('bowerloom-step5-fake-cli-');
  const file = path.join(dir, 'main.js');
  fs.writeFileSync(file, `
import fs from 'node:fs';
const SCRIPT = ${JSON.stringify(script)};
const [, , , verb, ...rest] = process.argv;
const approve = rest.includes('--approve');
const counts = new URL('./counts.json', import.meta.url);
let n = {}; try { n = JSON.parse(fs.readFileSync(counts, 'utf8')); } catch { /* first call */ }
const plain = verb + (approve ? '-apply' : '');
const stage = plain === 'adopt' ? (n.adopt ? 'adopt-plan-answered' : 'adopt-plan') : plain === 'adopt-apply' ? 'adopt-apply'
  : plain === 'install' ? (n.install ? 'install-plan' : 'install') : plain === 'remove' ? 'remove-plan' : plain;
n[plain] = (n[plain] ?? 0) + 1; const at = n[plain] - 1; fs.writeFileSync(counts, JSON.stringify(n));
const list = SCRIPT[stage] ?? [];
const answer = list[Math.min(at, list.length - 1)] ?? { exit: 0 };
if (answer.stdout !== undefined) process.stdout.write(JSON.stringify(answer.stdout) + '\\n');
if (answer.code !== undefined) process.stderr.write(JSON.stringify({ error: { code: answer.code, message: 'stopped' } }) + '\\n');
process.exit(answer.exit);
`);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n');
  return file;
}
const PLAN_OF = (extra = {}) => ({ items: [], conflicts: [], unmapped: [], secrets: [], everyEngine: [], files: [], approvalsRequired: [], ready: true, ...extra });
const ADOPT_OK = { 'adopt-plan': [{ exit: 3, stdout: { revision: 'a'.repeat(64), plan: PLAN_OF() } }], 'adopt-plan-answered': [{ exit: 3, stdout: { revision: 'a'.repeat(64), plan: PLAN_OF() } }], 'adopt-apply': [{ exit: 0 }] };
const INSTALL_OK = { revision: 'b'.repeat(64), plan: { changes: [], loss: [], deferred: [], pendingTrust: [], takenOver: [] } };

function stoppedRun(script) {
  const base = temp('bowerloom-step5-stop-');
  const dir = path.join(base, 'project'); fs.mkdirSync(dir);
  const root = path.join(base, 'root'); fs.mkdirSync(root);
  return readonlyRun({ root, dir, cli: scriptedCli(script) });
}

test('a run that stops at the adopt-plan step reports the code the step carried', () => {
  const report = stoppedRun({ 'adopt-plan': [{ exit: 1, code: 'ADOPTION_PROJECT_UNSAFE' }] });
  assert.equal(report.stoppedAt, 'adopt-plan');
  assert.deepEqual(report.refusalCodes, ['ADOPTION_PROJECT_UNSAFE']);
  assert.deepEqual(report.steps.map(x => [x.step, x.exit, x.code]), [['status', 0, undefined], ['adopt-plan', 1, 'ADOPTION_PROJECT_UNSAFE']]);
});

test('every place a run can stop sets refusalCodes from the steps it ran, an array even when no step carried a code', () => {
  const unsettled = PLAN_OF({ conflicts: [{ key: 'system-prompt/AGENTS.md', choice: null, variants: [{ key: 'AGENTS.md', places: [{ engines: [] }] }] }] });
  const cases = {
    'adopt-plan': [{ 'adopt-plan': [{ exit: 1, code: 'ADOPTION_DEFINED' }] }, ['ADOPTION_DEFINED']],
    'adopt-plan (no code)': [{ 'adopt-plan': [{ exit: 2 }] }, []],
    'adopt-plan-answered': [{ ...ADOPT_OK, 'adopt-plan-answered': [{ exit: 1, code: 'ADOPTION_CHOICE_INVALID' }] }, ['ADOPTION_CHOICE_INVALID']],
    'adopt-not-ready': [{ ...ADOPT_OK, 'adopt-plan-answered': [{ exit: 3, stdout: { revision: 'a'.repeat(64), plan: PLAN_OF({ ready: false }) } }] }, []],
    'adopt-answers': [{ ...ADOPT_OK, 'adopt-plan': [{ exit: 3, stdout: { revision: 'a'.repeat(64), plan: unsettled } }], 'adopt-plan-answered': [{ exit: 3, stdout: { revision: 'a'.repeat(64), plan: unsettled } }] }, []],
    'adopt-apply': [{ ...ADOPT_OK, 'adopt-apply': [{ exit: 1, code: 'ADOPTION_STALE_APPROVAL' }] }, ['ADOPTION_STALE_APPROVAL']],
    accept: [{ ...ADOPT_OK, install: [{ exit: 1, code: 'PORTABLE_FIDELITY', stdout: { refused: [{ key: 'mcp/x@codex:aaaaaaaaaaaa', engine: 'codex', result: 'weakened' }] } }], accept: [{ exit: 1, code: 'ADOPTION_USAGE' }] }, ['ADOPTION_USAGE', 'PORTABLE_FIDELITY']],
    install: [{ ...ADOPT_OK, install: [{ exit: 1, code: 'PORTABLE_CONFLICT' }] }, ['PORTABLE_CONFLICT']],
    'install-apply': [{ ...ADOPT_OK, install: [{ exit: 3, stdout: INSTALL_OK }], 'install-apply': [{ exit: 1, code: 'PORTABLE_DRIFT' }] }, ['PORTABLE_DRIFT']],
    'remove-plan': [{ ...ADOPT_OK, install: [{ exit: 3, stdout: INSTALL_OK }], 'remove-plan': [{ exit: 1, code: 'PORTABLE_NOTHING_PROJECTED' }] }, ['PORTABLE_NOTHING_PROJECTED']],
    'remove-apply': [{ ...ADOPT_OK, install: [{ exit: 3, stdout: INSTALL_OK }], 'remove-plan': [{ exit: 3, stdout: { revision: 'c'.repeat(64), plan: { changes: [] } } }], 'remove-apply': [{ exit: 1, code: 'PORTABLE_STATE_INVALID' }] }, ['PORTABLE_STATE_INVALID']],
  };
  for (const [stage, [script, codes]] of Object.entries(cases)) {
    const report = stoppedRun(script);
    assert.equal(report.stoppedAt, stage.split(' ')[0], stage);
    assert.ok(Array.isArray(report.refusalCodes), `${stage}: refusalCodes is an array`);
    assert.deepEqual(report.refusalCodes, codes, stage);
  }
});

test('a run that finishes sets refusalCodes too', () => {
  const report = stoppedRun({ ...ADOPT_OK, install: [{ exit: 3, stdout: INSTALL_OK }], 'remove-plan': [{ exit: 3, stdout: { revision: 'c'.repeat(64), plan: { changes: [] } } }] });
  assert.equal(report.stoppedAt, null);
  assert.deepEqual(report.refusalCodes, []);
});
