import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fork,spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { parseCrew } from '../../../dist/packages/crew/src/index.js';
import { planControl,registerControl,destruct,openControlOwner } from '../../../dist/packages/local-control/src/index.js';
const source=readFileSync('examples/endor/crew.yaml','utf8');
function fixture(t){const base=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-stop-')));chmodSync(base,0o700);const registry=join(base,'registry');t.after(()=>rmSync(base,{recursive:true,force:true}));return{base,registry};}
function team(f,name='demo',adapter='graph'){
  const root=join(f.base,name);mkdirSync(join(root,'.bowerloom','teams',name),{recursive:true,mode:0o700});
  const text=source.replace(/^id:.*$/m,`id: ${name}`),spec=`teams/${name}/team.yaml`;writeFileSync(join(root,'.bowerloom',spec),text,{mode:0o600});
  const installation=join(f.base,`${name}.private.json`);const definition=parseCrew(text);
  writeFileSync(installation,JSON.stringify(adapter==='graph'?{format:'trellis/local-installation/v0.7-alpha',workspaceRoot:root,graph:{plan:{definition}}}:{format:'trellis/recipe-installation/v1'}),{mode:0o600});
  return{root,team:name,spec,installation,adapter,registry:f.registry};
}
function enroll(input){const p=planControl(input);return registerControl(input,p.revision);}
function runOwner(t,input,extra={}){const child=fork(new URL('./owner-fixture.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});const messages=[];child.on('message',v=>messages.push(v));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.send({type:'close'});await once(child,'exit');}});child.send({type:'start',...input,...extra});
 return{child,messages,async next(type){for(let i=0;i<500;i++){const found=messages.find(x=>x.type===type);if(found)return found;await delay(10);}throw Error(`missing ${type}: ${JSON.stringify(messages)}`);}};
}
test('exact enrollment binds root, spec, installation and registry state',t=>{const f=fixture(t),input=team(f);const p=planControl(input);assert.equal(p.executionAuthorized,false);assert.throws(()=>registerControl(input,'0'.repeat(64)),{code:'CONTROL_STALE_APPROVAL'});enroll(input);writeFileSync(input.installation,'{}');assert.throws(()=>openControlOwner(input.installation,'graph',f.registry));});
test('setup-only enrollment stops without work, preserves files, and requires new approval to clear latch',async t=>{
 const f=fixture(t),{installation,adapter,...input}=team(f);enroll(input);const before=readFileSync(join(input.root,'.bowerloom',input.spec));const a=await destruct({team:input.team,root:input.root,registry:f.registry,timeoutMs:100});const b=await destruct({team:input.team,root:input.root,registry:f.registry,timeoutMs:100});assert.equal(a.teams[0].status,'NOT_RUNNING');assert.deepEqual(a,b);assert.deepEqual(readFileSync(join(input.root,'.bowerloom',input.spec)),before);const renewed=enroll(input);assert.equal(renewed.generation,2);
});
test('team stop and all stop reap actual owned workers while unrelated work survives',async t=>{
 const f=fixture(t),a=team(f,'alpha'),b=team(f,'bravo');enroll(a);enroll(b);const first=runOwner(t,a),second=runOwner(t,b);const x=await first.next('started'),y=await second.next('started');
 const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(sentinel,'spawn');t.after(async()=>{sentinel.kill();await once(sentinel,'exit');});
 const before=readFileSync(join(a.root,'.bowerloom',a.spec));const stopped=await destruct({team:a.team,root:a.root,registry:f.registry,timeoutMs:5000});assert.equal(stopped.complete,true);assert.equal(stopped.teams[0].status,'STOPPED');assert.equal(stopped.teams[0].executions[0].evidence.done.leaderReaped,true);assert.equal(stopped.teams[0].executions[0].evidence.done.groupGone,true);assert.throws(()=>process.kill(x.pid,0),{code:'ESRCH'});process.kill(y.pid,0);process.kill(sentinel.pid,0);
 const all=await destruct({team:'all',registry:f.registry,timeoutMs:5000});assert.equal(all.complete,true);assert.equal(all.scope,'one-local-registry');assert.equal(all.unregisteredWorkIncluded,false);assert.throws(()=>process.kill(y.pid,0),{code:'ESRCH'});process.kill(sentinel.pid,0);assert.deepEqual(readFileSync(join(a.root,'.bowerloom',a.spec)),before);assert.throws(()=>openControlOwner(a.installation,'graph',f.registry),{code:'TEAM_STOPPED'});
 const repeated=await destruct({team:'all',registry:f.registry,timeoutMs:100});assert.deepEqual(all,repeated);
});
test('offline owner is unconfirmed rather than stopped and enrollment cannot erase it',async t=>{
 const f=fixture(t),input=team(f);enroll(input);const owner=openControlOwner(input.installation,'graph',f.registry);const stop=await destruct({team:'all',registry:f.registry,timeoutMs:100});assert.equal(stop.complete,false);assert.equal(stop.teams[0].status,'STOP_UNCONFIRMED');assert.throws(()=>planControl(input),{code:'CONTROL_OWNER_UNRESOLVED'});await owner.finish({syntheticNoChild:true});
});
test('stop before delayed spawn prevents child creation',async t=>{
 const f=fixture(t),input=team(f);enroll(input);const worker=runOwner(t,input,{delay:300});await worker.next('registered');const stop=await destruct({team:'all',registry:f.registry,timeoutMs:3000});assert.equal(stop.complete,true);await worker.next('refused');assert.equal(worker.messages.some(x=>x.type==='started'),false);
});
test('unknown targets, symlink roots and public registries do not enroll',async t=>{
 const f=fixture(t),input=team(f);const link=join(f.base,'alias');symlinkSync(input.root,link);assert.throws(()=>planControl({...input,root:link}));mkdirSync(f.registry,{mode:0o755});assert.throws(()=>planControl(input),{code:'PRIVATE_REGISTRY_REQUIRED'});
});
test('an emergency latch blocks concurrent launch after its request',async t=>{const f=fixture(t),input=team(f);enroll(input);await destruct({team:'all',registry:f.registry,timeoutMs:100});assert.throws(()=>openControlOwner(input.installation,'graph',f.registry),{code:'TEAM_STOPPED'});enroll(input);const owner=openControlOwner(input.installation,'graph',f.registry);await owner.finish({notLaunched:true});});
test('registered recipe stop aborts an owned HTTP write and reports possible remote effects',async t=>{
 const {createServer}=await import('node:http');const {GitHubConnection}=await import('../../../dist/packages/recipes/src/index.js');const {spec}=await import('../../../dist/tests/recipes-fixtures.js');
 const f=fixture(t),input=team(f,'recipe','recipe');enroll(input);const owner=openControlOwner(input.installation,'recipe',f.registry);
 let arrived;const requested=new Promise(r=>arrived=r);const server=createServer((req,res)=>{arrived();req.on('end',()=>{});req.resume();});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const transport=(url,options)=>fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,options);
 const connection=new GitHubConnection(spec,async()=>'synthetic-token',transport,owner.signal);
 const request=connection.createBranch(`${spec.github.branchPrefix}/test`,'a'.repeat(40));let code=null;const settled=request.catch(e=>{code=e.code;});
 owner.onStop(async()=>{await settled;await owner.finish({localRequestSettled:true,remoteEffectPossible:true,error:code});});
 await requested;const stop=await destruct({team:'all',registry:f.registry,timeoutMs:3000});assert.equal(stop.complete,true);assert.equal(code,'GITHUB_WRITE_UNKNOWN');assert.equal(stop.teams[0].executions[0].evidence.remoteEffectPossible,true);
});
test('registry mutation after enrollment and an unfinished owner cannot silently resume',async t=>{
 const f=fixture(t),input=team(f);enroll(input);const owner=openControlOwner(input.installation,'graph',f.registry);assert.throws(()=>openControlOwner(input.installation,'graph',f.registry),{code:'CONTROL_OWNER_UNRESOLVED'});
 await owner.finish({cleanupUnknown:true},false);const result=await destruct({team:'all',registry:f.registry,timeoutMs:100});assert.equal(result.complete,false);assert.throws(()=>planControl(input),{code:'CONTROL_OWNER_UNRESOLVED'});
});
test('first emergency stop on an empty registry invalidates an earlier enrollment plan',async t=>{
 const f=fixture(t),input=team(f);mkdirSync(f.registry,{mode:0o700});const old=planControl(input);
 const first=await destruct({team:'all',registry:f.registry,timeoutMs:100});const snapshot=readFileSync(join(f.registry,'registry.json'),'utf8');
 assert.equal(first.complete,true);assert.equal(first.teams.length,0);assert.equal(JSON.parse(snapshot).epoch,1);assert.ok(JSON.parse(snapshot).allStop);
 await destruct({team:'all',registry:f.registry,timeoutMs:100});assert.equal(readFileSync(join(f.registry,'registry.json'),'utf8'),snapshot);
 assert.throws(()=>registerControl(input,old.revision),{code:'CONTROL_STALE_APPROVAL'});
});
test('concurrent source growth stays bounded and cannot become an approved enrollment',async t=>{
 const fs=await import('node:fs');const {syncBuiltinESMExports}=await import('node:module');const f=fixture(t),input=team(f);const path=join(input.root,'.bowerloom',input.spec);const ino=fs.statSync(path).ino;
 const original=fs.default.readSync;let largest=0,grew=false;
 fs.default.readSync=(fd,buffer,offset,length,position)=>{if(fs.fstatSync(fd).ino===ino){largest=Math.max(largest,length);if(!grew){grew=true;fs.appendFileSync(path,'x'.repeat(1024*1024));}}return original(fd,buffer,offset,length,position);};syncBuiltinESMExports();
 try{assert.throws(()=>planControl(input),{code:'CONTROL_FILE_CHANGED'});assert.ok(grew);assert.ok(largest<=262145);}
 finally{fs.default.readSync=original;syncBuiltinESMExports();}
});
for(const[name,corrupt]of[
 ['missing allStop',s=>{delete s.allStop;}],
 ['malformed allStop',s=>{s.allStop={id:'no',at:0,scope:'registry'};}],
 ['missing entry stop',s=>{delete Object.values(s.entries)[0].stop;}],
 ['changed spec digest type',s=>{Object.values(s.entries)[0].binding.specHash=1;}],
 ['missing root identity',s=>{delete Object.values(s.entries)[0].binding.rootIdentity;}],
 ['malformed registration revision',s=>{Object.values(s.entries)[0].registrationRevision='old';}],
 ['future approved epoch',s=>{Object.values(s.entries)[0].approvedEpoch=8;}],
 ['missing execution epoch',s=>{delete Object.values(s.entries)[0].executions[0].epoch;}],
 ['wrong execution generation',s=>{Object.values(s.entries)[0].executions[0].generation=2;}],
 ['duplicate execution ID',s=>{const e=Object.values(s.entries)[0];e.executions.push(structuredClone(e.executions[0]));}],
 ['ended active execution',s=>{Object.values(s.entries)[0].executions[0].status='ACTIVE';}],
])test(`corrupt registry refuses stop success: ${name}`,async t=>{
 const f=fixture(t),input=team(f);enroll(input);const owner=openControlOwner(input.installation,'graph',f.registry);await owner.finish({notLaunched:true});const file=join(f.registry,'registry.json'),s=JSON.parse(readFileSync(file,'utf8'));corrupt(s);writeFileSync(file,JSON.stringify(s));await assert.rejects(destruct({team:'all',registry:f.registry,timeoutMs:100}),{code:'CONTROL_REGISTRY'});
});
test('already finished execution reports not running without rewriting its receipt',async t=>{
 const f=fixture(t),input=team(f);enroll(input);const owner=openControlOwner(input.installation,'graph',f.registry);await owner.finish({completedBeforeStop:true});const before=JSON.parse(readFileSync(join(f.registry,'registry.json'),'utf8'));const result=await destruct({team:'all',registry:f.registry,timeoutMs:100});assert.equal(result.teams[0].status,'NOT_RUNNING');assert.deepEqual(result.teams[0].executions,JSON.parse(JSON.stringify(Object.values(before.entries)[0].executions)));
});
