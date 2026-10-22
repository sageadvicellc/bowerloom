// Spec 05, Part B, section 10.20: `bowerloom folder add|list|remove` and `slice create --registered`, through the real command line.
// Every run gets its own HOME and XDG_STATE_HOME under a temporary folder. Nothing here touches the real home folder.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { readInstalledRelease } from '../apps/cli/src/release.js';
import { TOPICS } from '../apps/cli/src/human.js';
import { sliceTemplate } from '../packages/context-slices/src/render.js';
import { approve, folder, run, put, revisionIn, sliceProject } from './support/slice-project.js';

const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
const heading = (() => { const r = readInstalledRelease(); return `Bowerloom ${r.version}: open beta\n${r.execution}\n\n`; })();
const USAGE = 'Use bowerloom folder add <folder-name> <path>, bowerloom folder allow <folder-name>, bowerloom folder deny <folder-name>, bowerloom folder list, or bowerloom folder remove <folder-name>, with optional --approve <revision> and --json.';

/** A home with a folder `kb` in it, and a working folder that is no project. */
function world(t: TestContext) {
  const home = folder(t, 'bowerloom-folder-cli-'), kb = join(home, 'kb'), work = join(home, 'work');
  mkdirSync(kb, { mode: 0o755 }); chmodSync(kb, 0o755); mkdirSync(work, { mode: 0o755 }); chmodSync(work, 0o755);
  put(kb, 'wiki/a.md', '# Alpha\n');
  return { home, kb, work, folders: join(home, '.bowerloom/folders') };
}
const add = (w: ReturnType<typeof world>, name: string, path: string, cwd = w.work) => {
  const planned = run(cwd, ['folder', 'add', name, path], w.home); assert.equal(planned.status, 3, planned.stdout + planned.stderr);
  const done = run(cwd, ['folder', 'add', name, path, '--approve', revisionIn(planned.stdout)], w.home); assert.equal(done.status, 0, done.stderr); return done;
};

test('1. folder add <name> <path> prints the plan and exits 3, from a folder that is no project', t => {
  const w = world(t), r = run(w.work, ['folder', 'add', 'kb', w.kb], w.home);
  assert.equal(r.status, 3, r.stderr); assert.equal(r.stderr, '');
  const rel = 'kb';
  assert.match(r.stdout, new RegExp(`^Create the store at ~/\\.bowerloom \\(store\\.json\\)\\. It holds definitions only\\.\\nRegister folder kb in the store at ~/\\.bowerloom/folders/kb\\.json\\n  Folder: ~/${rel}\\n  A slice names it with root: \\{ registered: kb \\}\\. Bowerloom reads this folder and never writes it\\.\\nThis writes the store only\\. It changes no project, and it installs nothing\\.\\nRevision: [a-f0-9]{64}\\nApproval required\\. Run the same command again with --approve [a-f0-9]{64}\\n$`));
  assert.equal(existsSync(join(w.home, '.bowerloom')), false, 'the plan writes nothing');
  const json = run(w.work, ['folder', 'add', 'kb', w.kb, '--json'], w.home); assert.equal(json.status, 3);
  const body = JSON.parse(json.stdout) as { code: string; plan: { format: string; name: string; path: string; storeCreate: boolean }; revision: string };
  assert.deepEqual([body.code, body.plan.format, body.plan.name, body.plan.path, body.plan.storeCreate], ['APPROVAL_REQUIRED', 'bowerloom/folder-add-plan/v1beta1', 'kb', 'kb', true]);
});
test('2. --approve writes the record, exits 0, and a relative path or ~/ resolves; no store line once the store is there', t => {
  const w = world(t), done = add(w, 'kb', '../kb');
  assert.match(done.stdout, /^Applied plan [a-f0-9]{64}\.\n$/);
  assert.match(readFileSync(join(w.folders, 'kb.json'), 'utf8'), /^\{"format":"bowerloom\/store-folder\/v1beta1","path":"kb","id":"[a-f0-9]{32}"\}\n$/);
  mkdirSync(join(w.home, 'two'), { mode: 0o755 }); chmodSync(join(w.home, 'two'), 0o755);
  const second = run(w.work, ['folder', 'add', 'two', '~/two'], w.home); assert.equal(second.status, 3, second.stderr);
  assert.doesNotMatch(second.stdout, /Create the store/); assert.match(second.stdout, /^Register folder two in the store at ~\/\.bowerloom\/folders\/two\.json\n  Folder: ~\/two\n/);
});
test('3. folder list prints the exact lines for ready, missing, and refused folders, and the empty states', t => {
  const w = world(t);
  const none = run(w.work, ['folder', 'list'], w.home); assert.equal(none.status, 0, none.stderr); assert.equal(none.stdout, 'Registered folders: none yet. There is no store at ~/.bowerloom.\n');
  add(w, 'aa', w.kb);
  mkdirSync(join(w.home, 'gone'), { mode: 0o755 }); chmodSync(join(w.home, 'gone'), 0o755); add(w, 'long-name', join(w.home, 'gone')); rmSync(join(w.home, 'gone'), { recursive: true });
  writeFileSync(join(w.folders, 'bad.json'), '{"format":"x"}\n', { mode: 0o644 });
  const r = run(w.work, ['folder', 'list'], w.home); assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'Registered folders in ~/.bowerloom/folders\n  aa         ~/kb  ready\n  bad        -  refused (FOLDER_INVALID)\n  long-name  ~/gone  missing\n');
  rmSync(join(w.folders, 'bad.json')); rmSync(join(w.folders, 'aa.json')); rmSync(join(w.folders, 'long-name.json'));
  const empty = run(w.work, ['folder', 'list'], w.home); assert.equal(empty.stdout, 'Registered folders in ~/.bowerloom/folders\n  none yet\n');
});
test('4. folder list --json prints format bowerloom/folder-list/v1beta1', t => {
  const w = world(t); add(w, 'aa', w.kb); writeFileSync(join(w.folders, 'bad.json'), '[]\n', { mode: 0o644 });
  const r = run(w.work, ['folder', 'list', '--json'], w.home); assert.equal(r.status, 0, r.stderr);
  const body = JSON.parse(r.stdout) as { format: string; folders: { name: string; path: string | null; state: string; code: string | null }[] };
  assert.equal(body.format, 'bowerloom/folder-list/v1beta1');
  assert.deepEqual(body.folders, [{ name: 'aa', path: '~/kb', state: 'ready', code: null }, { name: 'bad', path: null, state: 'refused', code: 'FOLDER_INVALID' }]);
  const none = run(w.work, ['folder', 'list', '--json'], folder(t)); assert.deepEqual((JSON.parse(none.stdout) as { folders: unknown[] }).folders, []);
});
test('5. folder remove <name> prints the plan and exits 3; --approve removes the record and keeps the folder', t => {
  const w = world(t); add(w, 'kb', w.kb);
  const r = run(w.work, ['folder', 'remove', 'kb'], w.home); assert.equal(r.status, 3, r.stderr);
  assert.match(r.stdout, /^Remove folder kb from the store: ~\/\.bowerloom\/folders\/kb\.json\n  Folder: ~\/kb\. The folder stays\. Bowerloom never writes it\.\n  Slices that name this folder are held with SLICE_ROOT_MISSING until the name is registered again\.\nThis writes the store only\. It changes no project\.\nRevision: [a-f0-9]{64}\nApproval required\./);
  const done = run(w.work, ['folder', 'remove', 'kb', '--approve', revisionIn(r.stdout)], w.home); assert.equal(done.status, 0, done.stderr);
  assert.equal(existsSync(join(w.folders, 'kb.json')), false); assert.deepEqual(readdirSync(join(w.kb, 'wiki')), ['a.md']);
  const again = run(w.work, ['folder', 'remove', 'kb'], w.home); assert.equal(again.status, 1); assert.equal(errorOf(again.stderr).code, 'FOLDER_NOT_FOUND');
});
test('6. help folder and folder --help print TOPICS.context', t => {
  const w = world(t);
  for (const args of [['help', 'folder'], ['folder', '--help'], ['help', 'context'], ['help', 'slice']]) { const r = run(w.work, args, w.home); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, heading + TOPICS.context!, args.join(' ')); }
  assert.match(TOPICS.context!, /^ {2}bowerloom folder add <folder-name> <path> \[--approve <revision>\] \[--json\]$/m);
  assert.match(TOPICS.context!, /^ {2}bowerloom folder allow <folder-name> \[--approve <revision>\] \[--json\]$/m);
  assert.match(TOPICS.context!, /^ {2}bowerloom folder deny <folder-name> \[--approve <revision>\] \[--json\]$/m);
  assert.match(TOPICS.context!, /^ {2}bowerloom folder list \[--json\]$/m);
  assert.match(TOPICS.context!, /^ {2}bowerloom folder remove <folder-name> \[--approve <revision>\] \[--json\]$/m);
  assert.match(TOPICS.context!, /\[--registered <folder-name>\]/);
  assert.match(TOPICS.context!, /folder add registers a folder outside this project, such as a knowledge base, in your store\. A slice then names it\nwith root: \{ registered: <folder-name> \} and --registered on slice create\. Bowerloom reads it and never writes it\.\nThe folder must be yours, below your home folder, outside iCloud folders, and not writable by other users\.\nfolder allow, run in a project, lets that project read the folder after you approve a plan that names it\. Every other project\nstays shut out until you allow it\. folder deny takes the grant back\. folder remove deletes the record and its grants only\.\nThe folder stays\. A slice of a registered folder copies text from it into \.claude\/skills, so keep that folder out of git\.\n/);
});
test('7. the usage text, exit 2, for a bare folder, a missing word, an extra word, a repeated flag, and an unknown subcommand', t => {
  const w = world(t);
  for (const args of [['folder', 'allow'], ['folder', 'deny', 'a', 'b'], ['folder'], ['folder', 'add'], ['folder', 'add', 'kb'], ['folder', 'add', 'kb', w.kb, 'extra'], ['folder', 'list', 'x'], ['folder', 'remove'], ['folder', 'remove', 'a', 'b'], ['folder', 'rename', 'a'], ['folder', 'list', '--json', '--json'], ['folder', 'add', 'kb', w.kb, '--yes']]) {
    const r = run(w.work, args, w.home); assert.equal(r.status, 2, args.join(' ') + r.stdout); assert.equal(errorOf(r.stderr).code, 'USAGE', args.join(' '));
  }
  assert.deepEqual(errorOf(run(w.work, ['folder'], w.home).stderr), { code: 'USAGE', message: USAGE });
});
test('8. the refusals reach the command line with their codes', t => {
  const w = world(t); add(w, 'kb', w.kb);
  const code = (args: string[]): { status: number | null; code: string } => { const r = run(w.work, args, w.home); return { status: r.status, code: r.stderr ? errorOf(r.stderr).code : '' }; };
  assert.deepEqual(code(['folder', 'add', 'kb', w.kb]), { status: 1, code: 'FOLDER_EXISTS' });
  assert.deepEqual(code(['folder', 'add', 'KB', w.kb]), { status: 1, code: 'FOLDER_NAME_INVALID' });
  assert.deepEqual(code(['folder', 'add', 'two', w.home]), { status: 1, code: 'FOLDER_UNSAFE' });
  assert.deepEqual(code(['folder', 'add', 'two', '/']), { status: 1, code: 'FOLDER_UNSAFE' });
  assert.deepEqual(code(['folder', 'add', 'two', join(w.home, 'nope')]), { status: 1, code: 'FOLDER_UNSAFE' });
  mkdirSync(join(w.home, 'Library/Mobile Documents/x'), { recursive: true, mode: 0o755 });
  assert.deepEqual(code(['folder', 'add', 'two', join(w.home, 'Library/Mobile Documents/x')]), { status: 1, code: 'FOLDER_IN_CLOUD' });
  assert.deepEqual(code(['folder', 'add', 'two', join(w.home, '.bowerloom')]), { status: 1, code: 'FOLDER_UNSAFE' });
  assert.deepEqual(code(['folder', 'remove', 'unknown']), { status: 1, code: 'FOLDER_NOT_FOUND' });
  assert.deepEqual(code(['folder', 'add', 'two', w.kb, '--approve', 'a'.repeat(64)]), { status: 1, code: 'STALE_APPROVAL' });
  writeFileSync(join(w.folders, 'bad.json'), '[]\n', { mode: 0o644 });
  assert.deepEqual(code(['folder', 'remove', 'bad']), { status: 1, code: 'FOLDER_INVALID' });
  const r = run(w.work, ['folder', 'add', 'two', w.home], w.home); assert.match(r.stderr, /Refused|FOLDER_UNSAFE/);
});
test('9. a folder reached through a link is recorded by its real path', t => {
  const w = world(t); symlinkSync(w.kb, join(w.home, 'alias')); add(w, 'kb', join(w.home, 'alias'));
  assert.match(readFileSync(join(w.folders, 'kb.json'), 'utf8'), /^\{"format":"bowerloom\/store-folder\/v1beta1","path":"kb","id":"[a-f0-9]{32}"\}\n$/);
});
test('10. a folder add refuses STALE_APPROVAL when the folder was replaced after the plan', t => {
  const w = world(t), planned = run(w.work, ['folder', 'add', 'kb', w.kb], w.home);
  renameSync(w.kb, join(w.home, 'kb-old')); mkdirSync(w.kb, { mode: 0o755 }); chmodSync(w.kb, 0o755);
  const r = run(w.work, ['folder', 'add', 'kb', w.kb, '--approve', revisionIn(planned.stdout)], w.home);
  assert.equal(r.status, 1); assert.equal(errorOf(r.stderr).code, 'STALE_APPROVAL'); assert.equal(existsSync(join(w.folders, 'kb.json')), false);
});

// slice create --registered
test('11. slice create --registered <name> plans the registered root line, and writes the file with a registered root', t => {
  const p = sliceProject(t, { apply: false, registered: true });
  const planned = run(p.dir, ['slice', 'create', 'other', '--registered', 'kb', '--root', 'wiki', '--include', 'a.md'], p.home); assert.equal(planned.status, 3, planned.stderr);
  assert.match(planned.stdout, /^Create slice other in \.bowerloom\/slices\/other\.yaml\n  Root: wiki in registered folder kb \(~\/kb\)\n  Include: a\.md\n  Files: 1\nAfter this, bowerloom apply puts the index skill slice-other in place\./);
  const done = run(p.dir, ['slice', 'create', 'other', '--registered', 'kb', '--root', 'wiki', '--include', 'a.md', '--approve', revisionIn(planned.stdout)], p.home); assert.equal(done.status, 0, done.stderr);
  assert.equal(readFileSync(join(p.dir, '.bowerloom/slices/other.yaml'), 'utf8'), sliceTemplate({ root: { kind: 'registered', name: 'kb', path: 'wiki' }, includes: ['a.md'] }));
  const whole = run(p.dir, ['slice', 'create', 'whole', '--registered', 'kb'], p.home); assert.match(whole.stdout, /^ {2}Root: \. in registered folder kb \(~\/kb\)$/m);
});
test('12. slice create --registered with a name the store does not hold refuses FOLDER_NOT_FOUND, and a repeated flag refuses USAGE', t => {
  const p = sliceProject(t, { apply: false, registered: true });
  const r = run(p.dir, ['slice', 'create', 'other', '--registered', 'nope'], p.home); assert.equal(r.status, 1); assert.equal(errorOf(r.stderr).code, 'FOLDER_NOT_FOUND');
  const twice = run(p.dir, ['slice', 'create', 'other', '--registered', 'kb', '--registered', 'kb'], p.home); assert.equal(twice.status, 2); assert.equal(errorOf(twice.stderr).code, 'USAGE');
  const bad = run(p.dir, ['slice', 'create', 'other', '--registered', 'KB'], p.home); assert.equal(bad.status, 2);
  const noStore = sliceProject(t, { apply: false }), none = run(noStore.dir, ['slice', 'create', 'other', '--registered', 'kb'], noStore.home); assert.equal(errorOf(none.stderr).code, 'FOLDER_NOT_FOUND');
  assert.deepEqual(errorOf(run(p.dir, ['slice', 'create', 'x', '--registered'], p.home).stderr).code, 'USAGE');
});

// ---------------------------------------------------------------------------------------------- allow and deny
test('13. folder allow <name> run in a project plans the absolute folder, writes a grant, and folder deny removes it', t => {
  const p = sliceProject(t, { apply: false, registered: true });
  add({ home: p.home, kb: p.kb!, work: p.dir, folders: join(p.home, '.bowerloom/folders') }, 'two', p.kb!, p.dir); // a second name for the same folder is allowed
  const planned = run(p.dir, ['folder', 'allow', 'two'], p.home); assert.equal(planned.status, 3, planned.stderr);
  assert.match(planned.stdout, new RegExp(`^Allow this project to read registered folder two\\n  Project: ${p.dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n  Folder: ${p.kb!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(~/kb\\)\\n  Bowerloom reads the mode of the folder only\\. To see access control entries, run ls -led [^\\n]+\\.\\n  A slice of this project that names it can copy text from it into \\.claude/skills\\. Bowerloom never writes the folder\\.\\nThis writes the store only\\. It changes no project, and it installs nothing\\.\\nRevision: [a-f0-9]{64}\\nApproval required\\.`));
  assert.equal(existsSync(join(p.home, '.bowerloom/folders/two.grants')), false);
  const done = run(p.dir, ['folder', 'allow', 'two', '--approve', revisionIn(planned.stdout)], p.home); assert.equal(done.status, 0, done.stderr);
  assert.equal(readdirSync(join(p.home, '.bowerloom/folders/two.grants')).length, 1);
  const deny = run(p.dir, ['folder', 'deny', 'two'], p.home); assert.equal(deny.status, 3, deny.stderr); assert.match(deny.stdout, /^Stop allowing this project to read registered folder two\n/);
  assert.equal(run(p.dir, ['folder', 'deny', 'two', '--approve', revisionIn(deny.stdout)], p.home).status, 0);
  assert.equal(readdirSync(join(p.home, '.bowerloom/folders/two.grants')).length, 0);
  const again = run(p.dir, ['folder', 'deny', 'two'], p.home); assert.equal(again.status, 1); assert.equal(errorOf(again.stderr).code, 'FOLDER_NOT_ALLOWED');
  assert.equal(errorOf(again.stderr).message, 'This project is not allowed to read registered folder two.');
});
test('14. folder allow needs a project, a known name, and an unchanged plan', t => {
  const w = world(t); add(w, 'kb', w.kb);
  const noProject = run(w.work, ['folder', 'allow', 'kb'], w.home); assert.equal(noProject.status, 1); assert.equal(errorOf(noProject.stderr).code, 'PROJECT_NOT_FOUND');
  const p = sliceProject(t, { apply: false, registered: true });
  const unknown = run(p.dir, ['folder', 'allow', 'nope'], p.home); assert.equal(unknown.status, 1); assert.equal(errorOf(unknown.stderr).code, 'FOLDER_NOT_FOUND');
  const stale = run(p.dir, ['folder', 'allow', 'kb', '--approve', 'a'.repeat(64)], p.home); assert.equal(stale.status, 1); assert.equal(errorOf(stale.stderr).code, 'STALE_APPROVAL');
});
test('15. folder list skips the grants folders, folder remove removes them, and the plan says so', t => {
  const p = sliceProject(t, { apply: false, registered: true });
  const list = run(p.dir, ['folder', 'list'], p.home); assert.equal(list.stdout, 'Registered folders in ~/.bowerloom/folders\n  kb  ~/kb  ready\n');
  const r = run(p.dir, ['folder', 'remove', 'kb'], p.home); assert.match(r.stdout, /\n  1 project is allowed to read it\. Their grants are removed with it\.\n/);
  assert.equal(run(p.dir, ['folder', 'remove', 'kb', '--approve', revisionIn(r.stdout)], p.home).status, 0); assert.equal(existsSync(join(p.home, '.bowerloom/folders/kb.grants')), false);
});
test('16. a slice in a project without a grant: apply holds it, show and measure agree, status names it', t => {
  const p = sliceProject(t, { apply: false, registered: true }); approve(p.dir, ['folder', 'deny', 'kb'], p.home);
  const plan = run(p.dir, ['apply', '--harness', 'claude'], p.home); assert.match(plan.stdout, /^ {2}wiki +slice held \(FOLDER_NOT_ALLOWED\)\n {2} +Next: bowerloom folder allow kb$/m);
  const show = run(p.dir, ['context', 'show', 'wiki'], p.home); assert.match(show.stdout, /\nHeld: FOLDER_NOT_ALLOWED\. Next: bowerloom folder allow kb\n/); assert.doesNotMatch(show.stdout, /Alpha/);
  const status = run(p.dir, ['status'], p.home); assert.match(status.stdout, /slice wiki: held \(FOLDER_NOT_ALLOWED\)\. Next: bowerloom folder allow kb/);
  const measure = run(p.dir, ['context', 'measure', '--agent', 'lead'], p.home); assert.equal(measure.status, 0, measure.stderr);
});
test('17. C2: slice create --registered checks the folder after the create checks of spec 3.2, and a recorded folder that is gone refuses', t => {
  const p = sliceProject(t, { apply: false, registered: true });
  const code = (args: string[]): string => errorOf(run(p.dir, args, p.home).stderr).code;
  // The create checks come first.
  assert.equal(code(['slice', 'create', 'wiki', '--registered', 'nope']), 'SLICE_EXISTS', 'a registered slice is refused before the folder is looked at');
  writeFileSync(join(p.dir, '.bowerloom-revision.json'), '{}'); assert.equal(code(['slice', 'create', 'other', '--registered', 'nope']), 'REVISION_PENDING'); rmSync(join(p.dir, '.bowerloom-revision.json'));
  put(p.dir, '.bowerloom/slices/loose.yaml', sliceTemplate({ root: { kind: 'project', path: '.' }, includes: ['**/*.md'] }));
  assert.equal(code(['slice', 'create', 'loose', '--registered', 'kb']), 'USAGE', 'a file that is already there takes no root flag');
  assert.equal(code(['slice', 'create', 'other', '--registered', 'nope']), 'FOLDER_NOT_FOUND');
  // A recorded folder that is gone.
  renameSync(join(p.kb!, 'wiki'), join(p.home, 'wiki-aside')); renameSync(p.kb!, p.kb + '-aside');
  const gone = run(p.dir, ['slice', 'create', 'other', '--registered', 'kb'], p.home); assert.equal(gone.status, 1); const e = errorOf(gone.stderr);
  assert.deepEqual([e.code, /does not exist/.test(e.message)], ['FOLDER_UNSAFE', true]);
  assert.equal(existsSync(join(p.dir, '.bowerloom/slices/other.yaml')), false);
});
test('18. L1: adding a lost folder again says it removes the old grants, and the old project is held until it is allowed again', t => {
  const p = sliceProject(t, { apply: true, registered: true }), record = join(p.home, '.bowerloom/folders/kb.json');
  rmSync(record);
  const planned = run(p.dir, ['folder', 'add', 'kb', p.kb!], p.home); assert.equal(planned.status, 3, planned.stderr); assert.match(planned.stdout, /\n {2}Removes 1 old grant for kb\.\n/);
  assert.equal(run(p.dir, ['folder', 'add', 'kb', p.kb!, '--approve', revisionIn(planned.stdout)], p.home).status, 0);
  const apply = run(p.dir, ['apply', '--harness', 'claude'], p.home); assert.match(apply.stdout, /slice held \(FOLDER_NOT_ALLOWED\)/);
  approve(p.dir, ['folder', 'allow', 'kb'], p.home); assert.match(run(p.dir, ['apply', '--harness', 'claude'], p.home).stdout, /slice up to date/);
});
