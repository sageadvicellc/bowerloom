import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import type { DirectoryIdentity, HeldProjectLock, OwnerVerdict, OwnerVerifier, PlannedChange, ProjectContext } from '../packages/project-context/src/types.js';

// Day 0 contracts (build plan 01, section 4). Most checks here are compile-time: `npm run typecheck` fails if a contract drifts.
const id = (inode: string): DirectoryIdentity => ({ device: '1', inode, birthtimeNs: '1', uid: 501, mode: 0o700 });

test('the contracts module is types only and has no runtime surface', async () => {
  const contracts: Record<string, unknown> = await import('../packages/project-context/src/types.js');
  assert.deepEqual(Object.keys(contracts), []);
});

test('ProjectContext carries the sync plan project binding and is read only', () => {
  const project: ProjectContext = { dir: '/synthetic/project', identity: id('2'), ancestry: [{ path: '/', identity: id('1') }, { path: '/synthetic', identity: id('3') }], bowerloomIdentity: id('4'), projectId: 'a'.repeat(32) };
  // @ts-expect-error A project binding cannot be reassigned.
  project.dir = '/elsewhere';
  // @ts-expect-error The ancestry list cannot grow.
  project.ancestry.push({ path: '/x', identity: id('5') });
  assert.deepEqual(Object.keys(project), ['dir', 'identity', 'ancestry', 'bowerloomIdentity', 'projectId']);
});

test('a held project lock cannot be forged from a literal', () => {
  const signal = new AbortController().signal;
  // @ts-expect-error Only withProjectLock creates a HeldProjectLock.
  const forged: HeldProjectLock = { dir: '/synthetic/project', signal, assertHeld() {} };
  const requiresHeld = (held: HeldProjectLock): string => { held.assertHeld(held.dir); return held.dir; };
  assert.equal(typeof requiresHeld, 'function'); assert.equal(forged.dir, '/synthetic/project');
});

test('an owner verifier claims by path and kind, then verifies under a signal', async () => {
  const seen: string[] = [];
  const manifest: OwnerVerifier = {
    owner: 'manifest',
    claims: (path, kind) => path === 'skills.json' && kind === 'file',
    async verify(path, kind, signal) { seen.push(`${path}:${kind}:${signal.aborted}`); return { result: 'verified' }; },
  };
  const verdicts: OwnerVerdict[] = [{ result: 'verified' }, { result: 'edited' }, { result: 'refused', code: 'MANIFEST_INVALID' }];
  // @ts-expect-error A refusal names its code.
  const missingCode: OwnerVerdict = { result: 'refused' };
  // @ts-expect-error Only the three registered owners exist.
  const unknownOwner: OwnerVerifier = { ...manifest, owner: 'other' };
  assert.equal(manifest.claims('skills.json', 'file'), true); assert.equal(manifest.claims('skills.json', 'directory'), false);
  assert.deepEqual(await manifest.verify('skills.json', 'file', new AbortController().signal), { result: 'verified' });
  assert.deepEqual(seen, ['skills.json:file:false']); assert.equal(verdicts.length, 3); assert.ok(missingCode && unknownOwner);
});

test('a planned change plans, binds a revision, reviews and applies by revision', async () => {
  const applied: string[] = [];
  const change: PlannedChange<{ readonly files: readonly string[] }> = {
    plan: async () => ({ files: ['teams/research/team.md'] }),
    revision: plan => (plan.files.length === 1 ? 'b' : 'c').repeat(64),
    review: plan => `Create ${plan.files.join(', ')}.`,
    apply: async revision => { applied.push(revision); return { revision }; },
  };
  const plan = await change.plan(); const revision = change.revision(plan);
  assert.match(revision, /^[a-f0-9]{64}$/); assert.equal(change.review(plan), 'Create teams/research/team.md.');
  assert.deepEqual(await change.apply(revision), { revision }); assert.deepEqual(applied, [revision]);
});

test('npm test runs the skill packages and each beta 0.7.0 project test folder that holds a test, and test:project runs the project layer', () => {
  const root = new URL('../../', import.meta.url);
  const scripts = (JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { scripts: Record<string, string> }).scripts;
  const words = (script: string | undefined) => (script ?? '').split(/\s+/);
  // node --test passes a pattern that matches nothing, so a project folder is listed only once it holds a test file.
  const hasTest = (folder: string) => { try { return readdirSync(new URL(folder, root)).some(name => name.endsWith('.test.mjs')); } catch { return false; } };
  for (const folder of ['packages/project-context/test/', 'packages/project-authoring/test/', 'packages/skill-manifest/test/', 'packages/project-sync/test/']) {
    const glob = folder + '*.test.mjs';
    for (const name of ['test', 'test:project']) assert.equal(words(scripts[name]).includes(glob), hasTest(folder), `${name}: ${glob}`);
  }
  for (const glob of ['packages/managed-skills/test/*.test.mjs', 'packages/skill-sources/test/*.test.mjs', 'dist/tests/*.test.js']) assert.ok(words(scripts.test).includes(glob), glob);
  assert.equal(words(scripts.test).slice(0, 9).join(' '), 'npm run build && node tools/check-test-patterns.mjs && node tools/run-node-tests.mjs');
  assert.equal(words(scripts['test:project']).slice(0, 6).join(' '), 'npm run build && node tools/run-node-tests.mjs');
  assert.ok(words(scripts['test:project']).includes('dist/tests/project-context-contracts.test.js'));
});
