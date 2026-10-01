import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SyntheticProcessAdapter } from '../../../dist/packages/runtime/src/index.js';
import { pin } from '../../../dist/packages/runtime/src/ledger.js';
test('synthetic child policy requires an explicit absolute command and bounded output and time', () => {
  const valid = { command: [process.execPath], cwd: '/tmp', timeoutMs: 1000, outputBytes: 1000 };
  for (const fields of [{ command: ['sh','-c','anything'] }, { command: [] }, { timeoutMs: 0 }, { timeoutMs: 30001 },
    { outputBytes: 0 }, { outputBytes: 3000000 }, { cwd: 'relative' }]) {
    assert.throws(() => new SyntheticProcessAdapter({ ...valid, ...fields }), { code: 'INVALID_PROCESS_POLICY' });
  }
});
test('runtime input cannot omit its compiled plan, task grant, reservation, or bounded input', () => {
  assert.throws(() => pin({}), { code: 'INVALID_INPUT' });
  assert.throws(() => pin({ plan: {}, task: {}, reservation: {}, taskInput: 'x'.repeat(65537) }), { code: 'INVALID_INPUT' });
});

test('synthetic child timeout and output overflow terminate the owned group', async () => {
  const { mkdtemp, realpath, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const root = await realpath(await mkdtemp(join(tmpdir(),'trellis-runtime-bounds-')));
  try {
    for (const mode of ['hang','oversize']) {
      const adapter = new SyntheticProcessAdapter({ command: [process.execPath,new URL('./synthetic-child.mjs',import.meta.url).pathname], cwd:root, timeoutMs:250, outputBytes:1024 });
      const worker = await adapter.start({ launcherId:'bounds-controller',taskInput:JSON.stringify({mode}),modelRoute:'synthetic' },new AbortController().signal);
      await assert.rejects(worker.result,{code:'PROCESS_STOPPED'}); await worker.terminate();
      assert.throws(()=>process.kill(-worker.identity.groupId,0),{code:'ESRCH'});
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});
