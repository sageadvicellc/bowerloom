import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const processObservations = [];
// The adapter counts a child's stderr but does not keep it. When a fixture check fails, this runs the
// fixture once more, directly and under its own time bound, so the failure message carries its stderr.
function fixtureStderr(name, cwd, input) {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL(name, import.meta.url))], { cwd, input, env: {}, encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL' });
  return `direct rerun exit ${run.status} signal ${run.signal}; stderr:\n${run.stderr.slice(0, 4096)}`;
}
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
      const adapter = new SyntheticProcessAdapter({ command: [process.execPath,fileURLToPath(new URL('./synthetic-child.mjs',import.meta.url))], cwd:root, timeoutMs:250, outputBytes:1024 });
      const started = performance.now();
      const worker = await adapter.start({ launcherId:'bounds-controller',taskInput:JSON.stringify({mode}),modelRoute:'synthetic' },new AbortController().signal);
      await assert.rejects(worker.result,{code:'PROCESS_STOPPED'}); const elapsed = performance.now() - started; await worker.terminate();
      // A fixture that crashes at start also ends in PROCESS_STOPPED. Only a real hang lasts until the timeout.
      if (mode === 'hang' && !(elapsed >= 250)) assert.fail(`hang stopped after ${elapsed.toFixed(1)} ms, before its 250 ms timeout; ${fixtureStderr('./synthetic-child.mjs', root, JSON.stringify({ token: 'diagnostic', taskInput: JSON.stringify({ proposal: 'diagnostic' }), modelRoute: 'synthetic' }))}`);
      assert.throws(()=>process.kill(-worker.identity.groupId,0),{code:'ESRCH'});
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});

for (const trigger of ['timeout', 'terminate']) test(`leader exit leaves its descendant owned until ${trigger} confirms group absence`, { timeout: 7000 }, async () => {
  const { mkdtemp, realpath, rm, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { setTimeout: delay } = await import('node:timers/promises');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'trellis-runtime-leader-exit-')));
  const adapter = new SyntheticProcessAdapter({ command: [process.execPath,fileURLToPath(new URL('./leader-exits.mjs',import.meta.url))], cwd:root,
    timeoutMs:trigger==='timeout'?500:4000, outputBytes:1024 });
  let worker; const started = performance.now(); let lifecycle;
  try {
    worker=await adapter.start({ launcherId:'leader-exit-controller',taskInput:'{}',modelRoute:'synthetic' },new AbortController().signal);
    let observed;
    for(let attempt=0;attempt<100;attempt++) {
      try {
        observed=JSON.parse(await readFile(join(root,'leader-exit.json'),'utf8'));
        try { process.kill(observed.leader,0); } catch(error) { if(error.code==='ESRCH') break; throw error; }
      } catch(error) { if(error.code!=='ENOENT') throw error; }
      await delay(2);
    }
    if (!observed) assert.fail(`leader-exits.mjs wrote no leader-exit.json; ${fixtureStderr('./leader-exits.mjs', root, JSON.stringify({ token: 'diagnostic' }))}`);
    assert.equal(observed.leader,worker.identity.groupId);
    assert.throws(()=>process.kill(observed.leader,0),{code:'ESRCH'});
    process.kill(observed.descendant,0); process.kill(-worker.identity.groupId,0);
    if(trigger==='terminate') await worker.terminate();
    await assert.rejects(worker.result,{code:'PROCESS_STOPPED'});
    assert.throws(()=>process.kill(observed.descendant,0),{code:'ESRCH'});
    assert.throws(()=>process.kill(-worker.identity.groupId,0),{code:'ESRCH'});
    const originalKill=process.kill; const lateSignals=[];
    try {
      process.kill=function(pid,signal) { if(pid===-worker.identity.groupId) lateSignals.push(signal); return originalKill.call(process,pid,signal); };
      await worker.terminate(); await worker.terminate();
    } finally { process.kill=originalKill; }
    assert.deepEqual(lateSignals,[],'ended ownership must never reuse the group identifier');
    lifecycle={trigger,leader:observed.leader,descendant:observed.descendant,observedLeaderAbsentBeforeStop:true,observedDescendantAliveBeforeStop:true,
      groupAbsentAfterStop:true,descendantAbsentAfterStop:true,lateSignalCount:lateSignals.length,elapsedMs:performance.now()-started};
  } finally {
    if(worker) await worker.terminate();
    await rm(root,{recursive:true,force:true});
    if(lifecycle) {
      processObservations.push({...lifecycle,scratchRemoved:true}); mkdirSync('packages/runtime/.trellis',{recursive:true});
      writeFileSync('packages/runtime/.trellis/process-lifecycle-result.json',JSON.stringify({passed:processObservations.length===2,cases:processObservations},null,2)+'\n');
    }
  }
});

test('pinned upstream WebSocket types reject the fabricated empty constructor and retain real methods', () => {
  const { status, stdout, stderr } = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc','--ignoreConfig','--strict','--noEmit','--target','es2023','--module','NodeNext',
    'packages/runtime/test/ws-types-negative.mts'], { encoding:'utf8', timeout:10000 });
  assert.notEqual(status,0); assert.match(stdout+stderr,/Expected 1-3 arguments, but got 0/);
  const positive=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','--ignoreConfig','--strict','--noEmit','--target','es2023','--module','NodeNext',
    'packages/runtime/test/ws-types-positive.mts'], { encoding:'utf8', timeout:10000 });
  assert.equal(positive.status,0,positive.stdout+positive.stderr);
});
