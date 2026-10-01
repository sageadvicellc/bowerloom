import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, realpath, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresWorkspaceEffects } from '../../../dist/packages/workspace-effects/src/index.js';
import { request, signal } from './fixtures.mjs';

test('registry and request boundaries reject before database access', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'trellis-effects-input-')));
  const pool = { connect() { throw new Error('Refused input reached the pool'); } };
  try {
    await mkdir(join(root, 'output'), { mode: 0o700 });
    const workspace = { workspaceId: 'synthetic-workspace', root, writablePaths: ['output/result.txt'] };
    const effects = await PostgresWorkspaceEffects.open(pool, { schema: 'trellis_input_test', workspaces: [workspace] });
    for (const path of ['/absolute', '../outside', 'output/../escape', 'output/.hidden', 'output/UPPER.txt']) {
      await assert.rejects(effects.apply(request('invalid', path), signal()), { code: 'INVALID_REQUEST' });
    }
    await assert.rejects(effects.apply(request('unknown', 'output/result.txt', 'x', null, 'unknown'), signal()), { code: 'UNKNOWN_WORKSPACE' });
    await assert.rejects(effects.apply(request('unregistered', 'output/other.txt'), signal()), { code: 'UNREGISTERED_PATH' });
    for (const edit of [r => { r.operationKey = 'sha256:' + '0'.repeat(64); }, r => { r.deadlineMs = NaN; },
      r => { r.extra = true; }, r => { r.proposal.edit.content = 'changed'; }]) {
      const value = request('tampered'); edit(value); await assert.rejects(effects.apply(value, signal()), { code: 'INVALID_REQUEST' });
    }
    for (const writablePaths of [[], ['../escape'], ['output/UPPER.txt'], ['output/result.txt', 'output/result.txt']]) {
      await assert.rejects(PostgresWorkspaceEffects.open(pool, { schema: 'trellis_input_test', workspaces: [{ ...workspace, writablePaths }] }), { code: 'INVALID_REGISTRY' });
    }
    await symlink(join(root, 'output'), join(root, 'alias'));
    await assert.rejects(PostgresWorkspaceEffects.open(pool, { schema: 'trellis_input_test', workspaces: [{ ...workspace, writablePaths: ['alias/file.txt'] }] }), { code: 'INVALID_REGISTRY' });
    await assert.rejects(PostgresWorkspaceEffects.open(pool, { schema: 'public', workspaces: [workspace] }), { code: 'INVALID_SCHEMA' });
    await assert.rejects(PostgresWorkspaceEffects.open(pool, { schema: 'trellis_input_test', workspaces: [workspace, { ...workspace, workspaceId: 'other' }] }), { code: 'INVALID_REGISTRY' });
    await chmod(join(root, 'output'), 0o755);
    await assert.rejects(PostgresWorkspaceEffects.open(pool, { schema: 'trellis_input_test', workspaces: [workspace] }), { code: 'INVALID_REGISTRY' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
