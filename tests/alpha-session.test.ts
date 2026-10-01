import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, chmod, symlink, link, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, digest } from '../packages/contracts/src/index.js';
import { proposalPrompt } from '../packages/codex-adapter/src/index.js';
import { privateJson } from '../apps/cli/src/controller.js';
import { executeSession, parseSessionCommand } from '../apps/cli/src/session.js';
import type { SessionPort, SessionCommand } from '../apps/cli/src/session.js';
import type { GraphView } from '../packages/graph/src/index.js';
import type { RunState } from '../packages/runtime/src/index.js';

const candidate=digest('candidate'), proposal={edit:{content:'synthetic'}};
const action=digest(canonicalJson(proposal));
function port() {
  const p={closed:0,advances:0,cancels:0,approvals:[] as unknown[],statusName:'WAITING_APPROVAL',runStatus:'WAITING_APPROVAL',
    async status(){return {status:p.statusName,state:{id:'graph',input:{plan:{candidateRevision:candidate,taskOrder:['build'],definition:{budget:{maxActiveWorkers:2}}}}}} as unknown as GraphView;},
    async advance(){p.advances++;return p.status();},
    async run(){return {status:p.runStatus,proposal,reason:null,receipt:null,acceptance:null} as unknown as RunState;},
    async approve(...args:unknown[]){p.approvals.push(args);p.runStatus='COMPLETED';p.statusName='COMPLETED';},
    async cancel(){p.cancels++;p.statusName='CANCELLED';},async close(){p.closed++;}};
  return p;
}
const invoke=(command:SessionCommand,p:SessionPort,emit:(value:object)=>void=()=>{})=>executeSession(command,p,emit,new AbortController().signal);
test('session commands require one explicit tier and exact approval digests',()=>{
  assert.equal(parseSessionCommand(['up','--demo','--pro','--installation','private.json']).command,'up');
  assert.equal(parseSessionCommand(['approve','--installation','private.json','--candidate',candidate,'--action',action]).command,'approve');
  for(const args of [[],['up','--demo','--installation','private.json'],['up','--demo','--pro','--20x','--installation','x'],
    ['status','--installation','x','--installation','y'],['approve','--installation','x','--candidate',candidate,'--action','latest'],
    ['review','--installation','x','--execute'],['cancel','--installation','x','--pro']])assert.throws(()=>parseSessionCommand(args),{code:'USAGE'});
});
test('read commands close without advancement, approval, or cancellation and review alone exposes the proposal',async()=>{
  for(const command of ['status','review'] as const){const p=port();let output:any;
    await invoke({command,installation:'x'},p,v=>{assert.equal(p.closed,1);output=v;});
    assert.equal(p.advances,0);assert.equal(p.cancels,0);assert.deepEqual(p.approvals,[]);
    assert.equal(output.tasks[0].actionDigest,action);assert.equal('proposal' in output.tasks[0],command==='review');
  }
});
test('stale candidate and changed action cannot reach approval or advancement',async()=>{
  for(const patch of [{candidate:digest('other')},{action:digest('other') }]){const p=port();
    await assert.rejects(invoke({command:'approve',installation:'x',candidate,action,...patch},p),{code:'STALE_APPROVAL'});
    assert.equal(p.closed,1);assert.equal(p.advances,0);assert.deepEqual(p.approvals,[]);
  }
});
test('only the stored waiting proposal receives exact approval',async()=>{
  const p=port();await invoke({command:'approve',installation:'x',candidate,action},p);
  assert.deepEqual(p.approvals,[['build',candidate,action]]);assert.equal(p.closed,1);
  const notWaiting=port();notWaiting.runStatus='HOLD';
  await assert.rejects(invoke({command:'approve',installation:'x',candidate,action},notWaiting),{code:'APPROVAL_UNAVAILABLE'});
  assert.deepEqual(notWaiting.approvals,[]);
});
test('up stops at approval and cannot grant permission',async()=>{
  const p=port();await invoke({command:'up',installation:'x',tier:'pro'},p);
  assert.equal(p.advances,1);assert.deepEqual(p.approvals,[]);assert.equal(p.closed,1);
});
test('interrupt and session deadline request cancellation before closing',async()=>{
  for(const interrupted of [true,false]){const p=port();p.statusName='RUNNING';const abort=new AbortController();if(interrupted)abort.abort();let at=0;
    await executeSession({command:'up',installation:'x',tier:'pro'},p,()=>{},abort.signal,async()=>{at+=120001;},()=>at);
    assert.equal(p.cancels,1);assert.equal(p.closed,1);assert.equal(p.statusName,'CANCELLED');
  }
});
test('cleanup failure prevents a successful-looking status output',async()=>{
  const p=port();p.close=async()=>{throw Error('cleanup unresolved');};let emitted=false;
  await assert.rejects(invoke({command:'status',installation:'x'},p,()=>{emitted=true;}),/cleanup unresolved/);assert.equal(emitted,false);
});
test('private installation reader rejects public permissions, links, duplicate JSON, and oversized data',async()=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'trellis-private-read-'))),file=join(directory,'installation.json');
  try{
    await writeFile(file,'{"valid":true}',{mode:0o600});assert.equal((await privateJson(file) as {valid:boolean}).valid,true);
    await chmod(file,0o644);await assert.rejects(privateJson(file),{code:'PRIVATE_FILE_REQUIRED'});await chmod(file,0o600);
    await symlink(file,join(directory,'symlink'));await assert.rejects(privateJson(join(directory,'symlink')),{code:'INSTALLATION_PATH'});
    await link(file,join(directory,'hardlink'));await assert.rejects(privateJson(file),{code:'PRIVATE_FILE_REQUIRED'});await rm(join(directory,'hardlink'));
    await writeFile(file,'{"valid":true,"valid":false}');await assert.rejects(privateJson(file));
    await writeFile(file,'{"long":"'+ 'x'.repeat(100)+'"}');await assert.rejects(privateJson(file,32),{code:'PRIVATE_FILE_REQUIRED'});
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('accepted HTML handoff fits a bounded native prompt without truncation',()=>{
  const handoff='<html>'+ 'synthetic '.repeat(1500)+'</html>';
  assert.ok(proposalPrompt(handoff).endsWith(handoff));
  assert.throws(()=>proposalPrompt('x'.repeat(32768)),{code:'TASK_INPUT_BOUND'});
  assert.throws(()=>proposalPrompt('é'.repeat(16384)),{code:'TASK_INPUT_BOUND'});
});
