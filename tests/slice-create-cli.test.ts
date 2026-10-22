// Spec 05, section 10.17: `bowerloom slice create`, through the real command line.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readInstalledRelease } from '../apps/cli/src/release.js';
import { TOPICS } from '../apps/cli/src/human.js';
import { sliceTemplate } from '../packages/context-slices/src/render.js';
import { folder, run, sliceProject, revisionIn } from './support/slice-project.js';

const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
const USAGE = 'Use bowerloom slice create <name> [--root <folder>] [--registered <folder-name>] [--include <pattern>]..., with optional --approve <revision> and --json.';
const heading = (() => { const r = readInstalledRelease(); return `Bowerloom ${r.version}: open beta\n${r.execution}\n\n`; })();

test('1. slice create wiki prints the plan and exits 3', t => {
  const p = sliceProject(t, { apply: false }), r = run(p.dir, ['slice', 'create', 'other'], p.home);
  assert.equal(r.status, 3, r.stderr); assert.equal(r.stderr, '');
  assert.match(r.stdout, /^Create slice other in \.bowerloom\/slices\/other\.yaml\n  Root: \. in this project\n  Include: \*\*\/\*\.md\n  Files: 1\nAfter this, bowerloom apply puts the index skill slice-other in place\. An agent loads it when its skills list names slice-other\.\nYou and your agents own these files and can edit them\.\nThis writes inside \.bowerloom only\. It starts no workers and runs nothing\.\n/m);
  assert.ok(r.stdout.endsWith(`Approval required. Run the same command again with --approve ${revisionIn(r.stdout)}\n`), r.stdout);
  assert.equal(existsSync(join(p.dir, '.bowerloom/slices/other.yaml')), false);
});
test('2. --approve <revision> writes the file and exits 0', t => {
  const p = sliceProject(t, { apply: false }), planned = run(p.dir, ['slice', 'create', 'other', '--root', 'wiki', '--include', 'a.md', '--include', 'sub/*.md'], p.home), revision = revisionIn(planned.stdout);
  assert.match(planned.stdout, /^  Root: wiki in this project\n  Include: a\.md, sub\/\*\.md$/m);
  const done = run(p.dir, ['slice', 'create', 'other', '--root', 'wiki', '--include', 'a.md', '--include', 'sub/*.md', '--approve', revision], p.home);
  assert.equal(done.status, 0, done.stderr); assert.equal(done.stdout, `Applied plan ${revision}.\n`);
  assert.equal(readFileSync(join(p.dir, '.bowerloom/slices/other.yaml'), 'utf8'), sliceTemplate({ root: { kind: 'project', path: 'wiki' }, includes: ['a.md', 'sub/*.md'] }));
  const ls = JSON.parse(run(p.dir, ['ls', 'slices', '--json'], p.home).stdout) as { slices: { id: string }[] }; assert.deepEqual(ls.slices.map(x => x.id), ['other', 'wiki']);
  const again = run(p.dir, ['slice', 'create', 'other', '--approve', revision], p.home); assert.equal(again.status, 1); assert.equal(errorOf(again.stderr).code, 'SLICE_EXISTS');
});
test('3. --json prints the plan JSON', t => {
  const p = sliceProject(t, { apply: false }), r = run(p.dir, ['slice', 'create', 'other', '--json'], p.home);
  assert.equal(r.status, 3, r.stderr); const body = JSON.parse(r.stdout);
  assert.equal(body.code, 'APPROVAL_REQUIRED'); assert.equal(body.plan.format, 'bowerloom/authoring-plan/v1beta2'); assert.equal(body.plan.item.kind, 'slice'); assert.deepEqual(body.plan.slice, { root: { kind: 'project', path: '.' }, includes: ['**/*.md'] });
});
test('4. slice create with no name exits 2 with the usage text', t => {
  const p = sliceProject(t, { apply: false }), r = run(p.dir, ['slice', 'create'], p.home);
  assert.equal(r.status, 2); assert.deepEqual(errorOf(r.stderr), { code: 'USAGE', message: USAGE });
  const two = run(p.dir, ['slice', 'create', 'a', 'b'], p.home); assert.equal(two.status, 2);
  const bare = run(p.dir, ['slice'], p.home); assert.equal(bare.status, 2);
});
test('5. slice create wiki --team a exits 2, and so do a repeated flag and a bad value', t => {
  const p = sliceProject(t, { apply: false });
  for (const args of [['--team', 'a'], ['--global'], ['--root', 'a', '--root', 'b'], ['--root', '../x'], ['--root', '.hidden'], ['--include', '[x]'], ['--include', '/abs'], ['--root'], ['--include']]) {
    const r = run(p.dir, ['slice', 'create', 'other', ...args], p.home); assert.equal(r.status, 2, args.join(' ') + r.stdout); assert.equal(errorOf(r.stderr).code, 'USAGE');
  }
  const r = run(p.dir, ['slice', 'create', 'other', '--registered', 'kb'], p.home); assert.equal(r.status, 1, 'a name the store does not hold');
  assert.equal(errorOf(r.stderr).code, 'FOLDER_NOT_FOUND');
  assert.equal(run(p.dir, ['slice', 'create', 'prompt-x'], p.home).status, 1);
});
test('6. help slice prints TOPICS.context', t => {
  const home = folder(t);
  for (const args of [['help', 'slice'], ['help', 'slice', 'create'], ['help', 'context'], ['slice', 'create', '--help'], ['context', '--help'], ['slice', '--help']]) {
    const r = run(home, args, home); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, heading + TOPICS.context, args.join(' '));
  }
  assert.ok(readdirSync(home).length === 0);
});
test('slice create outside a project names the missing project, and writes nothing', t => {
  const home = folder(t), here = join(home, 'nowhere'); mkdirSync(here); const r = run(here, ['slice', 'create', 'wiki'], home); assert.equal(r.status, 1); assert.equal(errorOf(r.stderr).code, 'PROJECT_NOT_FOUND');
});
