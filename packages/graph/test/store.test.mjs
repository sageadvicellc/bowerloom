import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for(const mode of ['delayed','immediate','foreign'])test(`invalid ${mode} async mutator rolls back and cannot terminate a default-policy Node child`,()=>{
  // Starting the executable directly with an allowlisted environment removes
  // inherited Node rejection flags, preload hooks and test-runner observers.
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./async-mutator-worker.mjs',import.meta.url)),mode],{
    encoding:'utf8',timeout:5000,maxBuffer:65536,env:{PATH:process.env.PATH},
  });
  assert.equal(result.error,undefined);assert.equal(result.signal,null);
  assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
  assert.deepEqual(JSON.parse(result.stdout),{mode,survived:true,callbacks:1,rollbacks:1,commits:0,writes:0,releases:1,thenReads:0,stateUnchanged:true});
});
