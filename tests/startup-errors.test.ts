import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runStartupCommand } from '../apps/cli/src/startup.js';

test('startup distinguishes malformed approval from a changed reviewed brief without writes', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-approval-copy-')));
  try {
    const args = ['--mode', 'new', '--target', join(root, 'project'), '--name', 'Synthetic project', '--goal', 'Review a synthetic project'];
    const plan = await runStartupCommand(['init', 'plan', ...args]) as { revision: string };
    await assert.rejects(runStartupCommand(['init', 'apply', ...args, '--approve', 'invalid']), (error: any) => {
      assert.equal(error.code, 'EXACT_APPROVAL_REQUIRED');
      assert.match(error.message, /exact reviewed plan/);
      return true;
    });
    const changed = args.map(value => value === 'Review a synthetic project' ? 'Review a changed synthetic project' : value);
    await assert.rejects(runStartupCommand(['init', 'apply', ...changed, '--approve', plan.revision]), (error: any) => {
      assert.equal(error.code, 'STALE_APPROVAL');
      assert.match(error.message, /Create a new plan/);
      return true;
    });
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
