// Step 5, item 2: the scratch copy and the read-only run, tested on synthetic trees made under the system temp folder.
// No real folder is read. No engine starts. Every free-space answer is injected, so the real disk never decides a result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_FLOOR_BYTES, MAX_FILE_BYTES, ROOT_PREFIX, ScratchError, TREE_NAME, guardDir, hashFiles, planCopy, scratchCopy, skipRule } from '../step5/scratch-copy.mjs';
import { diff, readManifest, snapshot, sourceProof } from '../step5/readonly-run.mjs';

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
    ['node_modules/pkg/AGENTS.md', 'dependency\n'], ['archive/AGENTS.md', 'archive\n'], ['.git/config', '[core]\n'], ['.hermes/AGENTS.md', 'h\n'], ['test-results/AGENTS.md', 't\n'],
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
function root() { return temp(ROOT_PREFIX); }
const listTree = dir => { const out = []; const walk = r => { for (const n of fs.readdirSync(path.join(dir, r)).sort()) { const c = r ? `${r}/${n}` : n; if (fs.lstatSync(path.join(dir, c)).isDirectory()) walk(c); else out.push(c); } }; walk(''); return out; };

test('the skip list names each rule, and wins over names the allowlist would take', () => {
  const cases = { '.git': 'skipped-folder', node_modules: 'skipped-folder', '.worktrees': 'skipped-folder', archive: 'skipped-folder', '.paperclip': 'skipped-folder', '.hermes': 'skipped-folder', '.qmd': 'skipped-folder', 'test-results': 'skipped-folder',
    '.env': 'env-file', '.env.production': 'env-file', 'a.pem': 'key-file', 'b.KEY': 'key-file', 'c.p12': 'key-file', id_rsa: 'ssh-key', 'Login-Keychain.db': 'keychain', '.netrc': 'credentials-file', '.npmrc': 'credentials-file',
    'auth.json': 'credentials-file', 'credentials.json': 'credentials-file', 'my-token.md': 'secret-name', 'Secrets.md': 'secret-name', 'a.sqlite': 'database', 'a.sqlite-wal': 'database' };
  for (const [name, rule] of Object.entries(cases)) assert.equal(skipRule(name), rule, name);
  for (const name of ['AGENTS.md', 'CLAUDE.md', '.mcp.json', 'settings.json', 'config.toml', 'SKILL.md', 'identity.md']) assert.equal(skipRule(name), null, name);
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
  for (const dir of ['node_modules', 'archive', '.git', '.hermes', 'test-results']) assert.equal(rule(dir), 'skipped-folder', dir);
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
  assert.deepEqual(fs.readdirSync(r), [], 'nothing was created');
  assert.deepEqual(asked, [os.tmpdir() === path.dirname(r) ? path.dirname(r) : fs.realpathSync(path.dirname(r))]);
  // The bytes to copy count against the floor, and the floor is 12 GiB by default.
  assert.equal(DEFAULT_FLOOR_BYTES, 12 * 1024 ** 3);
  const exact = scratchCopy(src, r, { freeBytes: reader(DEFAULT_FLOOR_BYTES + plan.bytes) });
  assert.equal(exact.ok, true, 'free space equal to the floor plus the copy is enough');
  // The floor can be raised, and an unreadable disk answer is a refusal.
  const r2 = root();
  assert.throws(() => scratchCopy(src, r2, { freeBytes: reader(100 * 1024 ** 3), minFreeBytes: 101 * 1024 ** 3 }), e => e.code === 'FREE_SPACE_BELOW_FLOOR');
  assert.throws(() => scratchCopy(src, r2, { freeBytes: () => NaN }), e => e.code === 'FREE_SPACE_BELOW_FLOOR');
  assert.deepEqual(fs.readdirSync(r2), []);
});

test('the scratch root must be new or empty, named for this tool, directly below the system temp folder, and apart from the source', () => {
  const { src, base } = sourceTree();
  const code = fn => { try { fn(); } catch (e) { return e.code; } return 'none'; };
  const free = { freeBytes: PLENTY };
  assert.equal(code(() => scratchCopy(src, 'relative/' + ROOT_PREFIX + 'x', free)), 'ROOT_NOT_ABSOLUTE');
  assert.equal(code(() => scratchCopy(src, path.join(os.tmpdir(), 'other-name-' + process.pid), free)), 'ROOT_NAME');
  assert.equal(code(() => scratchCopy(src, path.join(base, ROOT_PREFIX + 'inner'), free)), 'ROOT_OUTSIDE_TEMP');
  assert.equal(code(() => scratchCopy(src, path.join(process.env.HOME, ROOT_PREFIX + 'home'), free)), 'ROOT_OUTSIDE_TEMP');
  const full = root(); fs.writeFileSync(path.join(full, 'x'), 'x');
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
