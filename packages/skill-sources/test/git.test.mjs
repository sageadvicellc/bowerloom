import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { planGitAcquisition,validateGitPlan,acquireGitSkill,verifyGitPayload,GitAcquisitionError,GIT_LIMITS } from '../../../dist/packages/skill-sources/src/git.js';
import { observeSkillCacheRoot,openGitCacheOperation,openNpmCacheOperation,inspectSkillCache,readAcquiredSkillCache,planSkillCacheRecovery,recoverSkillCache } from '../../../dist/packages/skill-sources/src/cache.js';
import { revisionOf } from '../../../dist/packages/skill-sources/src/validation.js';
import { performance } from 'node:perf_hooks';
const hash=b=>createHash('sha256').update(b).digest('hex');
const oid=(kind,b)=>createHash('sha1').update(kind+' '+b.length+'\0').update(b).digest('hex');
const tick=()=>new Promise(r=>setImmediate(r));
// The Git API reports only fixed GIT_ codes. The shared cache API reports fixed NPM_ codes.
const refused=e=>e instanceof GitAcquisitionError&&/^GIT_[A-Z0-9_]+$/.test(e.code)&&e.message===e.code&&!e.message.includes('PRIVATE');
const code=expected=>e=>refused(e)&&e.code===expected;
const cacheCode=expected=>e=>/^NPM_[A-Z0-9_]+$/.test(e.code)&&e.code===expected&&e.message===e.code;
// Synthetic independent Git object writer. No git process, network or vendor object fixture.
// Items: {path,text} is a blob, {path,link} a symlink (mode 120000), {path,submodule:true} a gitlink.
function repository(items){
  const dirs=new Map([['',[]]]),blobs=new Map(),parentOf=p=>{const d=path.posix.dirname(p);return d==='.'?'':d;};
  const ensure=d=>{if(dirs.has(d))return;dirs.set(d,[]);const parent=parentOf(d);ensure(parent);dirs.get(parent).push({name:path.posix.basename(d),type:'tree',mode:'040000',dir:d});};
  for(const item of items){const parent=parentOf(item.path),name=path.posix.basename(item.path);ensure(parent);
    if(item.submodule){dirs.get(parent).push({name,type:'commit',mode:'160000',sha:createHash('sha1').update('submodule '+item.path).digest('hex')});continue;}
    const bytes=Buffer.from(item.link??item.text),sha=oid('blob',bytes);blobs.set(sha,bytes);
    dirs.get(parent).push({name,type:'blob',mode:item.link!==undefined?'120000':'100644',sha,size:bytes.length});}
  // Git order: raw name bytes, with a tree compared as if its name ended in '/'.
  const order=(a,b)=>Buffer.compare(Buffer.from(a.name+(a.type==='tree'?'/':'')),Buffer.from(b.name+(b.type==='tree'?'/':'')));
  const trees=new Map();
  const build=dir=>{const rows=dirs.get(dir).map(e=>e.type==='tree'?{...e,sha:build(e.dir)}:e).sort(order);
    const sha=oid('tree',Buffer.concat(rows.flatMap(e=>[Buffer.from((e.type==='tree'?'40000':e.mode)+' '+e.name+'\0'),Buffer.from(e.sha,'hex')])));trees.set(dir,{sha,rows});return sha;};
  build('');
  const row=(e,p)=>({path:p,mode:e.mode,type:e.type,sha:e.sha,...(e.type==='blob'?{size:e.size}:{}),url:'https://api.github.com/synthetic'});
  const listing=dir=>({sha:trees.get(dir).sha,url:'https://api.github.com/synthetic',tree:trees.get(dir).rows.map(e=>row(e,e.name)),truncated:false});
  const recursive=dir=>{const out=[];const walk=(d,prefix)=>{for(const e of trees.get(d).rows){out.push(row(e,prefix+e.name));if(e.type==='tree')walk(e.dir,prefix+e.name+'/');}};walk(dir,'');return {sha:trees.get(dir).sha,url:'https://api.github.com/synthetic',tree:out,truncated:false};};
  return {trees,blobs,listing,recursive,sha:dir=>trees.get(dir).sha,dirOf:sha=>[...trees].find(([,v])=>v.sha===sha)?.[0]};
}
// One listing per walked directory, then the recursive skill tree. The root is never listed recursively.
function objectFixture(version='one',repositoryName='synthetic/example',mutate=()=>{},{sourceRoot='skills/example',extra=[],license='LICENSE'}={}){
  const files=[{path:'SKILL.md',sourcePath:sourceRoot+'/SKILL.md',text:'---\nname: example\ndescription: Synthetic Git fixture.\nlicense: MIT\n---\nRead [guide](references/guide.md).\n'},
    {path:'references/guide.md',sourcePath:sourceRoot+'/references/guide.md',text:'# Guide\nVersion '+version+'\n'},
    {path:'LICENSE.txt',sourcePath:license,text:'MIT License\nSynthetic notice.\n'}];
  mutate(files);
  const repo=repository([...files.map(f=>({path:f.sourcePath,text:f.text})),...extra]);
  const segments=sourceRoot.split('/'),walked=segments.map((_,i)=>segments.slice(0,i).join('/'));
  const pathTrees=segments.map((_,i)=>repo.sha(segments.slice(0,i+1).join('/')));
  const commit=createHash('sha1').update('synthetic-commit-'+version).digest('hex'),tree=repo.sha('');
  const metadata=Buffer.from(JSON.stringify({sha:commit,tree:{sha:tree},message:'Synthetic only'}));
  const listings=[...walked.map(d=>repo.listing(d)),repo.recursive(sourceRoot)].map(v=>Buffer.from(JSON.stringify(v)));
  const blobBody=(sha,bytes)=>Buffer.from(JSON.stringify({sha,encoding:'base64',size:bytes.length,content:bytes.toString('base64')+'\n'}));
  const blobBodies=new Map(files.map(f=>{const b=Buffer.from(f.text),sha=oid('blob',b);return [sha,blobBody(sha,b)];}));
  const payload=Buffer.from(JSON.stringify({trees:listings.map(b=>b.toString('base64')),blobs:[...blobBodies].map(([sha,b])=>({sha,body:b.toString('base64')}))}));
  const request={repository:repositoryName,commit,tree,pathTrees,metadataSha256:hash(metadata),declaredLicense:'MIT',skill:{id:'example',name:'example',sourceRoot},files:files.map(f=>({path:f.path,sourcePath:f.sourcePath,sha256:hash(f.text),bytes:Buffer.byteLength(f.text),mode:420})),references:[{from:'SKILL.md',to:'references/guide.md'}],license:{spdx:'MIT',origin:'included',files:['LICENSE.txt']}};
  const prefix='https://api.github.com/repos/'+repositoryName+'/git';
  const serve=url=>{
    if(url===prefix+'/commits/'+commit)return metadata;
    const t=url.match(/\/git\/trees\/([a-f0-9]{40})(\?recursive=1)?$/);if(t){const dir=repo.dirOf(t[1]);return dir===undefined?undefined:Buffer.from(JSON.stringify(t[2]?repo.recursive(dir):repo.listing(dir)));}
    const b=url.match(/\/git\/blobs\/([a-f0-9]{40})$/);if(b){const bytes=repo.blobs.get(b[1]);return bytes&&blobBody(b[1],bytes);}
  };
  return {files,repo,metadata,listings,blobBodies,payload,request,serve,pathTrees,prefix};
}
function fixture(t,version='one',options={}){
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.homedir()),'bowerloom-git-test-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const f=objectFixture(version,'synthetic/example',()=>{},options),binding=observeSkillCacheRoot(root,'a'.repeat(32),12582912);return {...f,root,binding,plan:planGitAcquisition(f.request,binding),abort:new AbortController()};
}
function network(t,f,select=()=>({})){
  const calls=[],responses=[],dnsCalls=[];let native=0;
  t.mock.method(childProcess,'spawn',()=>{native++;throw Error('PRIVATE_NATIVE');});
  t.mock.method(dns,'lookup',async(host,options)=>{dnsCalls.push({host,options});return [{address:'140.82.112.6',family:4}];});
  t.mock.method(https,'request',(url,options,callback)=>{
    const req=new EventEmitter();req.destroyed=false;req.destroy=()=>{req.destroyed=true;return req;};req.end=()=>{
      calls.push({url,options,req});const choice=select(calls.length,req)||{};queueMicrotask(()=>{
        if(req.destroyed&&!choice.late)return;if(choice.error){req.emit('error',choice.error);return;}if(choice.stall)return;
        const body=choice.body??f.serve(url);assert.ok(body,'fixture URL must be exact');
        const res=new EventEmitter();res.destroyed=false;res.destroy=()=>{res.destroyed=true;return res;};res.statusCode=choice.status??200;res.complete=choice.complete??true;res.rawHeaders=choice.headers??['Content-Length',String(body.length)];responses.push(res);callback(res);
        if(!res.destroyed){for(const b of choice.chunks??[body])res.emit('data',b);if(!choice.noEnd)res.emit('end');}
      });return req;
    };return req;
  });return {calls,responses,dnsCalls,native:()=>native};
}
const run=f=>acquireGitSkill(f.plan,{approvalRevision:f.plan.revision,signal:f.abort.signal});
// Alters one stored listing. The default is the recursive skill tree, which is the last one.
function alterTree(f,change,index=-1){const p=JSON.parse(f.payload),at=index<0?p.trees.length+index:index,tree=JSON.parse(Buffer.from(p.trees[at],'base64'));change(tree);p.trees[at]=Buffer.from(JSON.stringify(tree)).toString('base64');return Buffer.from(JSON.stringify(p));}
// The same skill under another source root, with its own pinned path trees.
function retarget(f,sourceRoot,pathTrees){const request=structuredClone(f.request);request.skill.sourceRoot=sourceRoot;request.files=request.files.map(x=>x.path==='LICENSE.txt'?x:{...x,sourcePath:sourceRoot+'/'+x.path});request.pathTrees=pathTrees;return request;}
const blobUrls=f=>[...f.blobBodies.keys()].sort().map(id=>f.prefix+'/blobs/'+id);

test('Git proposal pins immutable identities and refuses hostile/moving input before contact',async t=>{
 const f=fixture(t),n=network(t,f);for(const field of ['commit','tree'])assert.throws(()=>planGitAcquisition({...f.request,[field]:'main'},f.binding),code('GIT_INPUT'));
 for(const repository of ['https://github.com/a/b','a/b.git','a/b/../../x','OWNER/repo'])assert.throws(()=>planGitAcquisition({...f.request,repository},f.binding),code('GIT_INPUT'));
 let traps=0;assert.throws(()=>planGitAcquisition(new Proxy(f.request,{ownKeys(){traps++;throw Error('PRIVATE');}}),f.binding),code('GIT_INPUT'));
 const getter={...f.request};Object.defineProperty(getter,'commit',{get(){traps++;throw Error('PRIVATE');},enumerable:true});assert.throws(()=>planGitAcquisition(getter,f.binding),code('GIT_INPUT'));assert.equal(traps,0);
 await assert.rejects(acquireGitSkill(f.plan,{approvalRevision:'0'.repeat(64),signal:f.abort.signal}),code('GIT_APPROVAL'));assert.equal(n.calls.length,0);assert.deepEqual(fs.readdirSync(f.root),[]);
 assert.ok(Object.isFrozen(f.plan.request.files[0]));f.request.files[0].sha256='0'.repeat(64);assert.notEqual(f.plan.request.files[0].sha256,'0'.repeat(64));
});
test('actual mocked HTTPS bytes produce truthful Git cache/closure with exact URLs and no authority',async t=>{
 const f=fixture(t),n=network(t,f),receipt=await run(f);assert.equal(receipt.source.kind,'git');assert.equal(receipt.source.commit,f.request.commit);assert.equal(receipt.source.tree,f.request.tree);assert.equal(receipt.source.metadataSha256,hash(f.metadata));assert.equal(receipt.source.archiveSha256,undefined);
 assert.equal(n.calls.length,7);assert.equal(n.calls.length,f.plan.requestBudget);assert.equal(n.dnsCalls.length,1);assert.equal(n.dnsCalls[0].host,'api.github.com');assert.equal(n.native(),0);
 assert.deepEqual(f.plan.treeUrls,[f.prefix+'/trees/'+f.request.tree,f.prefix+'/trees/'+f.pathTrees[0],f.prefix+'/trees/'+f.pathTrees[1]+'?recursive=1']);
 assert.deepEqual(n.calls.map(c=>c.url),[f.plan.metadataUrl,...f.plan.treeUrls,...blobUrls(f)]);assert.deepEqual(receipt.source.pathTrees,f.pathTrees);assert.equal(receipt.recordCount,3);
 for(const c of n.calls){assert.equal(c.options.rejectUnauthorized,true);assert.equal(c.options.minVersion,'TLSv1.2');assert.equal(c.options.method,'GET');assert.equal(c.options.headers.Authorization,undefined);assert.deepEqual(c.options.agent.options.proxyEnv,{});}
 for(const key of ['publisherAuthenticated','installAuthorized','executionAuthorized'])assert.equal(receipt[key],false);
 const inspection=await inspectSkillCache({root:f.root,operationId:f.binding.operationId});assert.equal(inspection.format,'bowerloom/git-cache-inspection/v1beta1');assert.equal(inspection.activeOwner,false);assert.deepEqual(inspection.receipt,receipt);
 const op=path.join(f.root,'op-'+f.binding.operationId);assert.equal(fs.existsSync(path.join(op,'archive.tgz')),false);assert.ok(fs.existsSync(path.join(op,'payload.json')));
 for(const file of fs.readdirSync(op).filter(x=>/^\d\d-/.test(x)))assert.equal(JSON.parse(fs.readFileSync(path.join(op,file))).format,'bowerloom/git-cache-record/v1beta1');
 const closure=await readAcquiredSkillCache({root:f.root,operationId:f.binding.operationId,expectedSnapshotRevision:inspection.snapshotRevision,expectedReceiptRevision:receipt.revision},{signal:f.abort.signal,deadlineMs:performance.now()+29000});assert.equal(closure.receipt.source.kind,'git');assert.equal(closure.files.length,3);
 await assert.rejects(run(f),code('GIT_CACHE_EXISTS'));assert.equal(n.calls.length,7);assert.throws(()=>openNpmCacheOperation(f.plan,f.plan.revision,f.abort.signal),cacheCode('NPM_INPUT'));
});
test('tree truncation, digest mismatch, path aliases, links and omitted subtree objects refuse',async t=>{
 const f=fixture(t);for(const [change,expected] of [[v=>v.truncated=true,'GIT_TREE'],[v=>v.sha='0'.repeat(40),'GIT_TREE'],[v=>v.tree.pop(),'GIT_TREE_DIGEST'],[v=>v.tree.push({...v.tree[0]}),'GIT_TREE'],[v=>v.tree[0].path='../escape','GIT_TREE'],[v=>v.tree[0].mode='120000','GIT_TREE_DIGEST'],[v=>{v.tree[0].mode='160000';v.tree[0].type='commit';delete v.tree[0].size;},'GIT_TREE_DIGEST'],[v=>v.tree[0].mode='160000','GIT_TREE'],[v=>v.tree[0].sha='0'.repeat(40),'GIT_TREE_DIGEST'],[v=>v.tree.find(e=>e.type==='tree').path='unconnected','GIT_TREE']]){
  await assert.rejects(verifyGitPayload(f.plan,f.metadata,alterTree(f,change),f.abort.signal,()=>{}),{code:expected});
 }
 const missing={...f.request,files:f.request.files.filter(x=>x.path!=='references/guide.md'),references:[]};const p=planGitAcquisition(missing,f.binding);await assert.rejects(verifyGitPayload(p,f.metadata,f.payload,f.abort.signal,()=>{}),code('GIT_SELECTED_INVENTORY'));
});
test('blob IDs, bytes, UTF8, base64 and complete licensed closure are independently checked',async t=>{
 const f=fixture(t);for(const [change,expected] of [[p=>p.blobs.pop(),'GIT_BLOB'],[p=>p.blobs.push(p.blobs[0]),'GIT_BLOB'],[p=>p.blobs[0].sha='0'.repeat(40),'GIT_BLOB'],[p=>{const b=JSON.parse(Buffer.from(p.blobs[0].body,'base64'));b.content=Buffer.from('wrong').toString('base64');p.blobs[0].body=Buffer.from(JSON.stringify(b)).toString('base64');},'GIT_BLOB_DIGEST'],[p=>p.trees[p.trees.length-1]+='!','GIT_BASE64']]){const bundle=JSON.parse(f.payload);change(bundle);await assert.rejects(verifyGitPayload(f.plan,f.metadata,Buffer.from(JSON.stringify(bundle)),f.abort.signal,()=>{}),{code:expected});}
 const bad={...f.request,files:f.request.files.map((v,i)=>i===0?{...v,sha256:'0'.repeat(64)}:v)};await assert.rejects(verifyGitPayload(planGitAcquisition(bad,f.binding),f.metadata,f.payload,f.abort.signal,()=>{}),code('GIT_SELECTED_INVENTORY'));
 await assert.rejects(verifyGitPayload(f.plan,Buffer.from('{}'),f.payload,f.abort.signal,()=>{}),code('GIT_METADATA'));
 await assert.rejects(verifyGitPayload(f.plan,f.metadata,Buffer.alloc(GIT_LIMITS.payloadBytes+1),f.abort.signal,()=>{}),code('GIT_BOUND'));
});
test('fixed origin denies redirect, auth challenge, compressed/duplicate headers and partial responses',async t=>{
 for(const response of [{status:302,headers:['Location','https://evil.example']},{status:401},{headers:['Content-Encoding','gzip']},{headers:['Content-Length','1','Content-Length','1']},{complete:false}]){const f=fixture(t),n=network(t,f,()=>response);await assert.rejects(run(f),code('GIT_RESPONSE'));assert.equal(n.calls.length,1);t.mock.restoreAll();}
});
test('private DNS and forged transport diagnostics cannot cause requests or expose secrets',async t=>{
 // A private IPv4 answer is a rebinding signal with its own code. An answer outside IPv4 stays a DNS refusal.
 for(const [address,expected] of [['127.0.0.1','GIT_NONPUBLIC_ADDRESS'],['10.0.0.1','GIT_NONPUBLIC_ADDRESS'],['169.254.1.1','GIT_NONPUBLIC_ADDRESS'],['::1','GIT_DNS']]){const f=fixture(t),n=network(t,f);t.mock.method(dns,'lookup',async()=>[{address,family:address.includes(':')?6:4}]);await assert.rejects(run(f),code(expected));assert.equal(n.calls.length,0);t.mock.restoreAll();}
 const f=fixture(t),n=network(t,f,()=>({error:new GitAcquisitionError('PRIVATE_SENTINEL')}));await assert.rejects(run(f),code('GIT_NETWORK'));assert.equal(n.calls.length,1);
});
test('preabort and late DNS resolution have no late HTTP or completed cache',async t=>{
 const pre=fixture(t),np=network(t,pre);pre.abort.abort();await assert.rejects(run(pre),code('GIT_ABORTED'));assert.equal(np.calls.length,0);assert.deepEqual(fs.readdirSync(pre.root),[]);t.mock.restoreAll();
 const f=fixture(t),n=network(t,f);let settle;t.mock.method(dns,'lookup',()=>new Promise(r=>{settle=r;}));const pending=run(f),rejected=assert.rejects(pending,code('GIT_ABORTED'));await tick();f.abort.abort();await rejected;settle([{address:'140.82.112.6',family:4}]);await tick();assert.equal(n.calls.length,0);assert.equal(fs.existsSync(path.join(f.root,'op-'+f.binding.operationId,'03-COMPLETED.json')),false);
});
test('stalled response is destroyed on cancellation and late end cannot complete',async t=>{
 const f=fixture(t),n=network(t,f,()=>({noEnd:true}));const pending=run(f),rejected=assert.rejects(pending,code('GIT_ABORTED'));await tick();f.abort.abort();await rejected;assert.ok(n.calls[0].req.destroyed);assert.ok(n.responses[0].destroyed);n.responses[0].emit('end');await tick();assert.equal(n.calls.length,1);
});
test('verified Git cache can only finalize with exact fresh approval; payload mutation refuses',async t=>{
 const f=fixture(t),op=openGitCacheOperation(f.plan,f.plan.revision,f.abort.signal);op.receiving();await op.stage(f.metadata,f.payload,f.abort.signal);assert.equal(op.release(),true);
 const req={root:f.root,operationId:f.binding.operationId,action:'finalize'},plan=await planSkillCacheRecovery(req);assert.equal(plan.format,'bowerloom/git-cache-recovery-plan/v1beta1');
 await assert.rejects(recoverSkillCache(plan,'0'.repeat(64)),cacheCode('NPM_CACHE_RECOVERY_STALE'));const done=await recoverSkillCache(plan,plan.revision);assert.equal(done.status,'COMPLETED');assert.equal(done.receipt.source.kind,'git');await assert.rejects(recoverSkillCache(plan,plan.revision),cacheCode('NPM_CACHE_RECOVERY_REFUSED'));
 const payload=path.join(f.root,'op-'+f.binding.operationId,'payload.json');fs.writeFileSync(payload,'{}');await assert.rejects(inspectSkillCache({root:f.root,operationId:f.binding.operationId}),code('GIT_INPUT'));
});
test('cross-kind cache record relabeling is refused even with a recomputed record revision',async t=>{
 const f=fixture(t),op=openGitCacheOperation(f.plan,f.plan.revision,f.abort.signal);op.receiving();await op.stage(f.metadata,f.payload,f.abort.signal);await op.complete(f.abort.signal);op.release();
 const name=path.join(f.root,'op-'+f.binding.operationId,'00-PREPARED.json');const record=JSON.parse(fs.readFileSync(name));const {revision,...body}=record;body.format='bowerloom/npm-cache-record/v1beta1';fs.writeFileSync(name,JSON.stringify({...body,revision:revisionOf(body)})+'\n');await assert.rejects(inspectSkillCache({root:f.root,operationId:f.binding.operationId}),cacheCode('NPM_CACHE_RECORD'));
});

test('selected blobs with valid object digests still refuse invalid UTF8, BOM and LFS indirection',async t=>{
 const f=fixture(t);for(const [text,expected] of [[Buffer.from([0xff]),'GIT_ENCODING'],[Buffer.from('\ufeff# Guide\n'),'GIT_ENCODING'],['version https://git-lfs.github.com/spec/v1\noid sha256:'+ 'a'.repeat(64)+'\nsize 10\n','GIT_CONTENT']]){
  const x=objectFixture('invalid','synthetic/example',files=>{files[1].text=text;});const plan=planGitAcquisition(x.request,f.binding);
  await assert.rejects(verifyGitPayload(plan,x.metadata,x.payload,f.abort.signal,()=>{}),code(expected));
 }
});
test('late DNS rejection and elapsed lifetime never dispatch after a closed acquisition',async t=>{
 const f=fixture(t),n=network(t,f);let reject;t.mock.method(dns,'lookup',()=>new Promise((_r,j)=>{reject=j;}));const pending=run(f),rejected=assert.rejects(pending,code('GIT_ABORTED'));await tick();f.abort.abort();await rejected;reject(Error('PRIVATE_DNS'));await tick();assert.equal(n.calls.length,0);t.mock.restoreAll();
 const g=fixture(t),ng=network(t,g),clock=performance.now.bind(performance);let offset=0;t.mock.method(performance,'now',()=>clock()+offset);t.mock.method(dns,'lookup',async()=>{offset=30001;return [{address:'140.82.112.6',family:4}];});await assert.rejects(run(g),code('GIT_TIMEOUT'));assert.equal(ng.calls.length,0);t.mock.restoreAll();
});
test('a cache completion refusal surfaces a fixed GIT_CACHE code instead of GIT_ACQUISITION_FAILED',async t=>{
 const f=fixture(t),n=network(t,f),openSync=fs.openSync,fsyncSync=fs.fsyncSync;let completionFd,lost=false;
 t.mock.method(fs,'openSync',function(filename,...args){const fd=Reflect.apply(openSync,fs,[filename,...args]);if(String(filename).endsWith('/03-COMPLETED.json'))completionFd=fd;return fd;});
 t.mock.method(fs,'fsyncSync',fd=>{fsyncSync(fd);if(fd===completionFd&&!lost){lost=true;throw Error('PRIVATE_LOST_ACK');}});
 await assert.rejects(run(f),e=>e instanceof GitAcquisitionError&&e.code==='GIT_CACHE_COMPLETE_UNCERTAIN'&&e.message===e.code);
 t.mock.restoreAll();assert.equal(lost,true);assert.equal(n.calls.length,7);
 const status=await inspectSkillCache({root:f.root,operationId:f.binding.operationId});assert.equal(status.status,'COMPLETED');assert.equal(status.activeOwner,false);
});
test('a certain cache refusal before the Git completion marker surfaces its mapped GIT_CACHE code',async t=>{
 const f=fixture(t),n=network(t,f),op=path.join(f.root,'op-'+f.binding.operationId),readdirSync=fs.readdirSync;let planted=false;
 t.mock.method(fs,'readdirSync',function(name,...args){if(String(name)===op&&!planted){planted=true;fs.writeFileSync(path.join(op,'extra'),'PRIVATE',{mode:0o600});}return Reflect.apply(readdirSync,fs,[name,...args]);});
 await assert.rejects(run(f),e=>e instanceof GitAcquisitionError&&e.code==='GIT_CACHE_INVENTORY'&&e.message===e.code);
 t.mock.restoreAll();assert.equal(planted,true);assert.equal(n.calls.length,7);assert.equal(fs.existsSync(path.join(op,'03-COMPLETED.json')),false);
});

test('Git plan validation and cache opening report only fixed GIT_ codes',async t=>{
 const f=fixture(t),n=network(t,f);const bad=structuredClone(f.plan);bad.cache.minFreeBytes=1;
 await assert.rejects(acquireGitSkill(bad,{approvalRevision:bad.revision,signal:f.abort.signal}),code('GIT_CACHE_INPUT'));
 assert.throws(()=>planGitAcquisition(f.request,{...f.binding,minFreeBytes:1}),code('GIT_CACHE_INPUT'));
 assert.throws(()=>planGitAcquisition(f.request,{...f.binding,root:'relative/cache'}),code('GIT_CACHE_PATH'));
 assert.equal(n.calls.length,0);assert.deepEqual(fs.readdirSync(f.root),[]);
});
test('an invalid base64 blob body reports GIT_BASE64 during acquisition',async t=>{
 const f=fixture(t);const first=[...f.blobBodies.keys()].sort()[0];const v=JSON.parse(f.blobBodies.get(first));v.content='not base64!';
 // Calls 1-4 are the commit and the three listings, so call 5 is the first blob in sorted order.
 network(t,f,count=>count===5?{body:Buffer.from(JSON.stringify(v))}:{});
 await assert.rejects(run(f),code('GIT_BASE64'));
});
test('cache staging passes a listed Git verification code through unchanged',async t=>{
 const f=fixture(t),op=openGitCacheOperation(f.plan,f.plan.revision,f.abort.signal);op.receiving();
 await assert.rejects(op.stage(f.metadata,alterTree(f,v=>v.truncated=true),f.abort.signal),code('GIT_TREE'));assert.equal(op.hold(),null);assert.equal(op.release(),true);
});
test('a stop after the Git completion marker write begins reports GIT_CACHE_COMPLETE_UNCERTAIN',async t=>{
 const f=fixture(t);network(t,f);const openSync=fs.openSync,marker=path.join(f.root,'op-'+f.binding.operationId,'03-COMPLETED.json');let stopped=false;
 t.mock.method(fs,'openSync',function(name,...args){const fd=Reflect.apply(openSync,fs,[name,...args]);if(!stopped&&String(name)===marker){stopped=true;f.abort.abort();}return fd;});
 await assert.rejects(run(f),code('GIT_CACHE_COMPLETE_UNCERTAIN'));t.mock.restoreAll();assert.equal(stopped,true);assert.equal(fs.existsSync(marker),true);
});
test('a per-request deadline in a Git data handler reports GIT_TIMEOUT',async t=>{
 const f=fixture(t),n=network(t,f,()=>({noEnd:true,chunks:[]}));const clock=performance.now.bind(performance);let offset=0;t.mock.method(performance,'now',()=>clock()+offset);
 const pending=run(f),rejected=assert.rejects(pending,code('GIT_TIMEOUT'));while(n.responses.length===0)await tick();
 offset=10001;n.responses[0].emit('data',Buffer.from('x'));await rejected;
});
test('a TypeError from the Git transport becomes GIT_ACQUISITION_FAILED',async t=>{
 const f=fixture(t);network(t,f);t.mock.method(https,'request',()=>{throw new TypeError('PRIVATE_TYPE');});
 await assert.rejects(run(f),code('GIT_ACQUISITION_FAILED'));
});
test('a Git owner lock left behind is reported as a fixed secondary code',async t=>{
 const f=fixture(t),n=network(t,f,count=>count===1?{body:Buffer.from('{"PRIVATE":1}')}:{});const unlink=fs.unlinkSync,lock=path.join(f.root,'op-'+f.binding.operationId,'owner.lock');
 t.mock.method(fs,'unlinkSync',function(name,...args){if(String(name)===lock)throw Error('PRIVATE_UNLINK');return Reflect.apply(unlink,fs,[name,...args]);});
 await assert.rejects(run(f),e=>code('GIT_METADATA')(e)&&Array.isArray(e.secondary)&&e.secondary.join()==='GIT_CACHE_RELEASE_UNCERTAIN');t.mock.restoreAll();assert.equal(n.calls.length,1);assert.equal(fs.existsSync(lock),true);
});

test('Git planning faults and partial opens keep fixed Git codes',async t=>{
 const f=fixture(t),n=network(t,f),byteLength=Buffer.byteLength;
 t.mock.method(Buffer,'byteLength',function(value,...args){if(value==='synthetic/example')throw new TypeError('PRIVATE_TYPE');return Reflect.apply(byteLength,Buffer,[value,...args]);});
 assert.throws(()=>planGitAcquisition(f.request,f.binding),code('GIT_PLAN_REFUSED'));t.mock.restoreAll();
 const openSync=fs.openSync;t.mock.method(fs,'openSync',function(name,...args){if(String(name).endsWith('/00-PREPARED.json'))throw Error('PRIVATE_OPEN');return Reflect.apply(openSync,fs,[name,...args]);});
 await assert.rejects(run(f),e=>code('GIT_CACHE_OPEN_REFUSED')(e)&&e.secondary.join()==='GIT_CACHE_OPEN_PARTIAL');t.mock.restoreAll();assert.equal(n.calls.length,0);
});

test('Git reads walk each path tree, read only the skill tree recursively, and spend exactly the request budget',async t=>{
 const f=fixture(t),n=network(t,f);const receipt=await run(f);
 assert.equal(f.plan.format,'bowerloom/git-acquisition-plan/v1beta2');assert.equal(f.plan.requestBudget,2+2+3);assert.equal(n.calls.length,f.plan.requestBudget);
 assert.equal(n.calls.some(c=>c.url===f.prefix+'/trees/'+f.request.tree+'?recursive=1'),false);assert.deepEqual(receipt.source.pathTrees,f.pathTrees);
});
test('a seven-segment source root reads in exact order, and a nine-segment root refuses at plan time',async t=>{
 const deep='a/b/c/d/e/f/skill',f=fixture(t,'one',{sourceRoot:deep}),n=network(t,f);await run(f);
 const walked=f.pathTrees.slice(0,-1).map(sha=>f.prefix+'/trees/'+sha);
 assert.deepEqual(n.calls.map(c=>c.url),[f.prefix+'/commits/'+f.request.commit,f.prefix+'/trees/'+f.request.tree,...walked,f.prefix+'/trees/'+f.pathTrees.at(-1)+'?recursive=1',...blobUrls(f)]);
 assert.equal(n.calls.length,2+7+3);assert.equal(f.plan.requestBudget,12);
 const nine=objectFixture('one','synthetic/example',()=>{},{sourceRoot:'a/b/c/d/e/f/g/h/skill'});
 assert.throws(()=>planGitAcquisition(nine.request,f.binding),code('GIT_PATH_DEPTH'));assert.equal(n.calls.length,12);
});
test('a missing path segment and a segment that is not a tree refuse with their own codes',async t=>{
 const f=fixture(t,'one',{extra:[{path:'skills/flat',text:'flat file'}]});const n=network(t,f);
 f.plan=planGitAcquisition(retarget(f,'skills/absent',[f.repo.sha('skills'),'1'.repeat(40)]),f.binding);await assert.rejects(run(f),code('GIT_PATH_MISSING'));assert.equal(n.calls.length,3);
 const g=fixture(t,'one',{extra:[{path:'skills/flat',text:'flat file'}]});const m=network(t,g);
 g.plan=planGitAcquisition(retarget(g,'skills/flat',[g.repo.sha('skills'),'1'.repeat(40)]),g.binding);await assert.rejects(run(g),code('GIT_PATH_TYPE'));assert.equal(m.calls.length,3);
});
test('a symlink or submodule refuses as a path segment and inside the skill tree, while root siblings of every kind pass',async t=>{
 for(const [item,expected] of [[{path:'skills/link',link:'example'},'GIT_SYMLINK'],[{path:'skills/mod',submodule:true},'GIT_SUBMODULE']]){
  const f=fixture(t,'one',{extra:[item]}),n=network(t,f);f.plan=planGitAcquisition(retarget(f,item.path,[f.repo.sha('skills'),'1'.repeat(40)]),f.binding);
  await assert.rejects(run(f),code(expected));assert.equal(n.calls.length,3);t.mock.restoreAll();
 }
 for(const [item,expected] of [[{path:'skills/example/alias',link:'SKILL.md'},'GIT_SYMLINK'],[{path:'skills/example/vendor',submodule:true},'GIT_SUBMODULE']]){
  const f=fixture(t,'one',{extra:[item]}),n=network(t,f);await assert.rejects(run(f),code(expected));assert.equal(n.calls.length,4);t.mock.restoreAll();
 }
 // The fullwidth and astral names sort differently by UTF-16 unit and by byte, so the root digest proves byte order.
 const extra=[{path:'rootlink',link:'skills'},{path:'rootmod',submodule:true},{path:'skills/zz-link',link:'example'},{path:'café/menu.md',text:'menu'},{path:'ｚ-notes.md',text:'fullwidth'},{path:'\u{1F600}.md',text:'astral'}];
 const f=fixture(t,'one',{extra}),n=network(t,f);const receipt=await run(f);assert.equal(receipt.recordCount,3);assert.equal(n.calls.length,7);
});
test('altered listings and pinned path trees refuse, and inspection re-proves every stored path tree',async t=>{
 const f=fixture(t,'one',{extra:[{path:'README.md',text:'readme'}]});const root=JSON.parse(f.serve(f.prefix+'/trees/'+f.request.tree));root.tree.find(e=>e.path==='README.md').sha='0'.repeat(40);
 const n=network(t,f,count=>count===2?{body:Buffer.from(JSON.stringify(root))}:{});await assert.rejects(run(f),code('GIT_TREE_DIGEST'));assert.equal(n.calls.length,2);t.mock.restoreAll();
 const g=fixture(t);const pinned=structuredClone(g.request);pinned.pathTrees[0]='3'.repeat(40);g.plan=planGitAcquisition(pinned,g.binding);const m=network(t,g);
 await assert.rejects(run(g),code('GIT_PATH_DIGEST'));assert.equal(m.calls.length,2);assert.equal(m.calls.some(c=>c.url.includes('/blobs/')),false);t.mock.restoreAll();
 const h=fixture(t);network(t,h);await run(h);t.mock.restoreAll();
 const altered=alterTree(h,v=>{v.tree[0].sha='0'.repeat(40);},1);
 await assert.rejects(verifyGitPayload(h.plan,h.metadata,altered,h.abort.signal,()=>{}),code('GIT_TREE_DIGEST'));
 fs.writeFileSync(path.join(h.root,'op-'+h.binding.operationId,'payload.json'),altered);
 await assert.rejects(inspectSkillCache({root:h.root,operationId:h.binding.operationId}),code('GIT_TREE_DIGEST'));
 await assert.rejects(planSkillCacheRecovery({root:h.root,operationId:h.binding.operationId,action:'hold'}),code('GIT_TREE_DIGEST'));
 const supplied={format:'bowerloom/git-cache-recovery-plan/v1beta1',action:'hold',root:h.root,operationId:h.binding.operationId,snapshotRevision:'0'.repeat(64),originalPlanRevision:'0'.repeat(64),revision:'0'.repeat(64)};
 await assert.rejects(recoverSkillCache(supplied,'0'.repeat(64)),code('GIT_TREE_DIGEST'));
});
test('a plan whose request budget passes 130 refuses at plan time',t=>{
 const f=fixture(t);const extend=count=>{const request=structuredClone(f.request);for(let i=0;i<count;i++)request.files.push({path:'references/r'+i+'.md',sourcePath:'skills/example/references/r'+i+'.md',sha256:'a'.repeat(64),bytes:1,mode:420});return request;};
 assert.equal(planGitAcquisition(extend(123),f.binding).requestBudget,130);
 assert.throws(()=>planGitAcquisition(extend(124),f.binding),code('GIT_REQUEST_BOUND'));
});
test('a large repository root is listed once without recursion',async t=>{
 const extra=[];for(let d=0;d<48;d++)for(let i=0;i<41;i++)extra.push({path:'d'+d+'/f'+i+'.md',text:d+'-'+i});
 const f=fixture(t,'one',{extra}),n=network(t,f);assert.ok(f.repo.recursive('').tree.length>=2000);assert.equal(f.repo.listing('').tree.length,50);
 await run(f);assert.equal(n.calls.length,7);assert.equal(n.calls.some(c=>c.url.endsWith(f.request.tree+'?recursive=1')),false);
});
test('a path listing over 1024 entries or 524288 bytes refuses, and a license outside the walked trees refuses at plan time',async t=>{
 const many=[];for(let i=0;i<1023;i++)many.push({path:'f'+i,text:String(i)});
 const f=fixture(t,'one',{extra:many}),n=network(t,f);assert.equal(f.repo.listing('').tree.length,1025);await assert.rejects(run(f),code('GIT_TREE_BOUND'));assert.equal(n.calls.length,2);t.mock.restoreAll();
 const wide=[];for(let i=0;i<1000;i++)wide.push({path:'n'.repeat(480)+i,text:String(i)});
 const g=fixture(t,'one',{extra:wide}),m=network(t,g);assert.ok(Buffer.byteLength(JSON.stringify(g.repo.listing('')))>524288);await assert.rejects(run(g),code('GIT_RESPONSE_BOUND'));assert.equal(m.calls.length,2);t.mock.restoreAll();
 const outside=objectFixture('one','synthetic/example',()=>{},{license:'docs/LICENSE'});assert.throws(()=>planGitAcquisition(outside.request,f.binding),code('GIT_OUTSIDE_PATH'));
 const h=fixture(t,'one',{license:'skills/LICENSE'}),k=network(t,h);await run(h);assert.equal(k.calls.length,7);
});
test('v1beta1 Git plans and caches refuse closed, and a request without pathTrees refuses',async t=>{
 const f=fixture(t),n=network(t,f);assert.throws(()=>validateGitPlan({...f.plan,format:'bowerloom/git-acquisition-plan/v1beta1'}),code('GIT_PLAN_CHANGED'));
 const {pathTrees,...old}=f.request;assert.throws(()=>planGitAcquisition(old,f.binding),code('GIT_INPUT'));
 await run(f);const name=path.join(f.root,'op-'+f.binding.operationId,'00-PREPARED.json');const record=JSON.parse(fs.readFileSync(name));const {revision,...body}=record;
 body.payload.plan.format='bowerloom/git-acquisition-plan/v1beta1';fs.writeFileSync(name,JSON.stringify({...body,revision:revisionOf(body)})+'\n');
 await assert.rejects(inspectSkillCache({root:f.root,operationId:f.binding.operationId}),code('GIT_PLAN_CHANGED'));assert.equal(n.calls.length,7);
});

test('an eight-segment source root and a root of exactly 1024 entries pass',async t=>{
 const f=fixture(t,'one',{sourceRoot:'a/b/c/d/e/f/g/skill'}),n=network(t,f);await run(f);assert.equal(n.calls.length,2+8+3);assert.equal(f.plan.requestBudget,13);t.mock.restoreAll();
 const many=[];for(let i=0;i<1022;i++)many.push({path:'f'+i,text:String(i)});
 const g=fixture(t,'one',{extra:many}),m=network(t,g);assert.equal(g.repo.listing('').tree.length,1024);await run(g);assert.equal(m.calls.length,7);
});
test('a walked listing refuses a name with a slash or a NUL, and a duplicate name',async t=>{
 for(const change of [v=>{v.tree[0].path='a/b';},v=>{v.tree[0].path='a\u0000b';},v=>{v.tree.push({...v.tree[0]});}]){
  const f=fixture(t,'one',{extra:[{path:'README.md',text:'readme'}]});const root=JSON.parse(f.serve(f.prefix+'/trees/'+f.request.tree));change(root);
  const n=network(t,f,count=>count===2?{body:Buffer.from(JSON.stringify(root))}:{});await assert.rejects(run(f),code('GIT_TREE'));assert.equal(n.calls.length,2);t.mock.restoreAll();
 }
});

// Decision D11: a repeated header name refuses only when the transport reads it or it frames the body.
const recordedHeaders=JSON.parse(fs.readFileSync(new URL('./fixtures/npm-registry-headers-2026-10-07.json',import.meta.url),'utf8'));
const HEADER_CANARY='PRIVATE_HEADER_VALUE';
// The recorded names in their recorded order. Values are synthetic: none was recorded.
function recordedResponse(body){let cookie=0;const value={date:'Wed, 07 Oct 2026 00:00:00 GMT','content-type':'application/json; charset=utf-8','content-length':String(body.length),connection:'keep-alive','cf-ray':'synthetic-ray','cf-cache-status':'HIT','access-control-allow-origin':'*',server:'github.com'};
 return recordedHeaders.headerNames.flatMap(name=>[name,name==='set-cookie'?`${HEADER_CANARY}_${++cookie}=1; Path=/`:value[name]]);}
function quietConsole(t){const lines=[];for(const method of ['log','info','warn','error','debug','trace'])t.mock.method(console,method,(...args)=>{lines.push(args.map(String).join(' '));});return lines;}
function treeText(root){let text='';for(const entry of fs.readdirSync(root,{recursive:true,withFileTypes:true}))if(entry.isFile())text+=fs.readFileSync(path.join(entry.parentPath,entry.name),'latin1');return text;}
test('D11: the recorded header list, with two set-cookie headers, completes every Git request and logs no header value',async t=>{
 const f=fixture(t),lines=quietConsole(t);let n;n=network(t,f,count=>({headers:recordedResponse(f.serve(n.calls[count-1].url))}));
 const receipt=await run(f);assert.equal(receipt.format,'bowerloom/acquired-skill-cache/v1beta1');assert.ok(n.calls.length>2);
 assert.equal(lines.some(l=>l.includes(HEADER_CANARY)),false);assert.equal(JSON.stringify(receipt).includes(HEADER_CANARY),false);assert.equal(treeText(f.root).includes(HEADER_CANARY),false);
 assert.equal((await inspectSkillCache({root:f.root,operationId:f.binding.operationId})).status,'COMPLETED');
});
test('D11: two set-cookie headers alone pass on every Git request',async t=>{
 const f=fixture(t);let n;n=network(t,f,count=>({headers:['Set-Cookie',HEADER_CANARY+'_A=1','Content-Length',String(f.serve(n.calls[count-1].url).length),'set-cookie',HEADER_CANARY+'_B=2']}));
 const receipt=await run(f);assert.equal(receipt.format,'bowerloom/acquired-skill-cache/v1beta1');assert.ok(n.calls.length>2);
});
test('D11: a repeated guarded header still refuses with GIT_RESPONSE before any body is kept',async t=>{
 const cases=[
  length=>['Content-Length',String(length),'Content-Length',String(length)],
  ()=>['Content-Type','application/json','Content-Type','application/json'],
  ()=>['content-type','application/json','Content-Type',HEADER_CANARY],
  ()=>['Content-Encoding','identity','Content-Encoding','identity'],
  ()=>['Location','https://api.github.com/a','Location','https://api.github.com/a'],
  ()=>['Transfer-Encoding','chunked','Transfer-Encoding','chunked'],
  ()=>['Content-Range','bytes 0-1/2','Content-Range','bytes 0-1/2'],
 ];
 for(const headers of cases){
  const f=fixture(t),lines=quietConsole(t),n=network(t,f,()=>({headers:['set-cookie',HEADER_CANARY,...headers(f.metadata.length),'set-cookie',HEADER_CANARY]}));
  await assert.rejects(run(f),e=>code('GIT_RESPONSE')(e)&&!String(e.stack).includes(HEADER_CANARY)&&!JSON.stringify(e).includes(HEADER_CANARY));
  assert.equal(n.calls.length,1);assert.ok(n.responses[0].destroyed);assert.equal(lines.some(l=>l.includes(HEADER_CANARY)),false);
  assert.equal((await inspectSkillCache({root:f.root,operationId:f.binding.operationId})).status==='COMPLETED',false);
  t.mock.restoreAll();
 }
});
// Header flood (security review of 48257d5, finding 1): Node drops raw headers past about 2000 entries without an error.
const padHeaders=count=>Array.from({length:count},(_,i)=>['x-pad-'+i,'a']).flat();
test('header flood: a list Node truncated after 1000 padding headers refuses with GIT_RESPONSE, and 128 pairs pass',async t=>{
 // Node kept the first Content-Length and the padding, and dropped the repeat that followed.
 const f=fixture(t),n=network(t,f,()=>({headers:['Content-Length',String(f.metadata.length),...padHeaders(1000)]}));
 await assert.rejects(run(f),code('GIT_RESPONSE'));assert.equal(n.calls.length,1);assert.ok(n.responses[0].destroyed);t.mock.restoreAll();
 const g=fixture(t);let m;m=network(t,g,count=>({headers:['Content-Length',String(g.serve(m.calls[count-1].url).length),...padHeaders(127)]}));
 assert.equal((await run(g)).format,'bowerloom/acquired-skill-cache/v1beta1');assert.ok(m.calls.length>2);
});
