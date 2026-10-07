import './support/isolate-home.js';
// CLI composition tests: real argv/file custody; synthetic downstream modules, no acquisition/effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { registerHooks } from 'node:module';
import { runSkillsCommand } from '../apps/cli/src/skills.js';

const key='bowerloom-skills-cli-synthetic';
const calls:{name:string;args:any[]}[]=[];
let action:(name:string,args:any[])=>unknown=(name)=>({synthetic:true,name,executionAuthorized:false});
(globalThis as any)[key]=(name:string,args:any[])=>{calls.push({name,args});return action(name,args);};
const exportsByFile:Record<string,string[]>={
  'cache.js':['observeSkillCacheRoot','inspectSkillCache','planSkillCacheRecovery','recoverSkillCache'],
  'npm.js':['planNpmAcquisition','acquireNpmSkill'],
  'git.js':['planGitAcquisition','acquireGitSkill'],
  'observed.js':['planObservedManagedSkill','inspectObservedManagedSkill'],
  'transaction.js':['applyObservedManagedSkill','planObservedManagedSkillRecovery','recoverObservedManagedSkill'],
};
const realCache=new URL('../packages/skill-sources/src/cache.js',import.meta.url).href,realObserved=new URL('../packages/managed-skills/src/observed.js',import.meta.url).href;
const hooks=registerHooks({resolve(specifier,context,next){
  if(context.parentURL?.endsWith('/apps/cli/src/skills.js')){
    const file=specifier.split('/').at(-1)!;const names=exportsByFile[file];
    // The refusal summary is the real shared-list classifier, so the CLI test sees the real fixed codes.
    // The managed code list and error class are the real ones, so the CLI test sees the real fixed codes.
    const real=file==='cache.js'?`import * as real from ${JSON.stringify(realCache)};export const refusalSummary=real.refusalSummary;\n`:file==='observed.js'?`import * as real from ${JSON.stringify(realObserved)};export const MANAGED_SKILL_CODES=real.MANAGED_SKILL_CODES;export const ManagedSkillError=real.ManagedSkillError;\n`:'';
    if(names){const code=real+names.map(name=>`export const ${name}=(...args)=>globalThis[${JSON.stringify(key)}](${JSON.stringify(name)},args);`).join('\n');return {url:'data:text/javascript,'+encodeURIComponent(code),shortCircuit:true};}
  }
  return next(specifier,context);
}});
process.once('exit',()=>hooks.deregister());
function fixture(t:any,value:unknown={synthetic:true}){
  const root=fs.mkdtempSync(join(fs.realpathSync(homedir()),'bowerloom-skills-cli-'));fs.chmodSync(root,0o700);
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=join(root,'request.json');fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});
  calls.length=0;action=name=>({synthetic:true,name,executionAuthorized:false});return {root,file};
}
/** A record whose projectDir is a clean project folder under the fixture root. */
function withProject(t:any,value:Record<string,unknown>){
  const f=fixture(t);const projectDir=join(f.root,'project');fs.mkdirSync(projectDir,{mode:0o700});
  const write=(v:Record<string,unknown>)=>fs.writeFileSync(f.file,JSON.stringify({...v,projectDir}));write(value);return {...f,projectDir,write};
}
const hex='a'.repeat(64);
const deferred=()=>{let resolve!:(value:unknown)=>void,reject!:(error:unknown)=>void;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const tick=()=>new Promise<void>(r=>setImmediate(r));
const code=(expected:string)=>(e:any)=>e.code===expected&&!e.message.includes('PRIVATE');

test('exact source routes preserve arguments and separate acquisition approval from local inspection',async t=>{
  const f=fixture(t);await runSkillsCommand(['skills','source','plan','--operation','op','--min-free-bytes','12582912','--state',f.root,'--request',f.file]);
  assert.deepEqual(calls.map(c=>c.name),['observeSkillCacheRoot','planNpmAcquisition']);assert.deepEqual(calls[0]!.args,[f.root,'op',12582912] as unknown);
  calls.length=0;await runSkillsCommand(['skills','source','acquire','--plan',f.file,'--approve',hex]);assert.equal(calls.length,1);assert.equal(calls[0]!.name,'acquireNpmSkill');assert.equal(calls[0]!.args[1].approvalRevision,hex);assert.ok(calls[0]!.args[1].signal instanceof AbortSignal);
  for(const [tail,name] of [
    [['source','inspect','--request',f.file],'inspectSkillCache'],
    [['source','recover','plan','--request',f.file],'planSkillCacheRecovery'],
    [['source','recover','apply','--plan',f.file,'--approve',hex],'recoverSkillCache'],
  ] as const){calls.length=0;await runSkillsCommand(['skills',...tail]);assert.deepEqual(calls.map(c=>c.name),[name]);}
});
test('manager routes preserve previous approval, harness request and cancellation signal',async t=>{
  const f=withProject(t,{operation:'install',harness:'claude'});await runSkillsCommand(['skills','plan','--request',f.file]);assert.equal(calls[0]!.name,'planObservedManagedSkill');assert.equal(calls[0]!.args[0].harness,'claude');assert.ok(calls[0]!.args[1].signal instanceof AbortSignal);
  calls.length=0;await assert.rejects(runSkillsCommand(['skills','update','plan','--request',f.file]),code('USAGE'));assert.equal(calls.length,0);
  f.write({operation:'update',harness:'codex'});await runSkillsCommand(['skills','update','plan','--request',f.file]);assert.equal(calls[0]!.args[0].operation,'update');
  for(const previous of ['none',hex]){calls.length=0;await runSkillsCommand(['skills','apply','--plan',f.file,'--approve',hex,'--previous',previous]);assert.equal(calls[0]!.name,'applyObservedManagedSkill');assert.equal(calls[0]!.args[1],hex);assert.equal(calls[0]!.args[2],previous==='none'?null:hex);}
  for(const [tail,name] of [
    [['inspect','--request',f.file],'inspectObservedManagedSkill'],
    [['recover','plan','--request',f.file],'planObservedManagedSkillRecovery'],
    [['recover','apply','--plan',f.file,'--approve',hex],'recoverObservedManagedSkill'],
  ] as const){calls.length=0;await runSkillsCommand(['skills',...tail]);assert.deepEqual(calls.map(c=>c.name),[name]);}
});
test('unknown routes, duplicate/extra flags, missing approval and oversized/proxy argv cannot dispatch',async t=>{
  const f=fixture(t);const variants=[['skills','git','acquire','--request',f.file],['skills','source','inspect','--request',f.file,'--force','true'],['skills','source','inspect','--request',f.file,'--request',f.file],['skills','apply','--plan',f.file,'--previous','none'],['skills','source','acquire','--plan',f.file,'--approve','latest'],['skills','inspect','--request','é'.repeat(1100)]];
  for(const argv of variants)await assert.rejects(runSkillsCommand(argv),code('USAGE'));
  let traps=0;const proxy=new Proxy(['skills','inspect','--request',f.file],{get(){traps++;throw Error('PRIVATE');}});await assert.rejects(runSkillsCommand(proxy),code('USAGE'));assert.equal(traps,0);assert.equal(calls.length,0);
});
test('strict record parsing refuses duplicates, invalid UTF8, BOM and oversize before downstream work',async t=>{
  const f=fixture(t);for(const bytes of [Buffer.from('{"x":1,"x":2}'),Buffer.from([0xff]),Buffer.from('\ufeff{}'),Buffer.alloc(196609,32)]){
    fs.writeFileSync(f.file,bytes);await assert.rejects(runSkillsCommand(['skills','source','inspect','--request',f.file]));assert.equal(calls.length,0);
  }
});
test('record mode/link and ancestor custody refuse unsafe or changed inputs',async t=>{
  const f=fixture(t);fs.chmodSync(f.file,0o644);await assert.rejects(runSkillsCommand(['skills','inspect','--request',f.file]));fs.chmodSync(f.file,0o600);
  const alias=join(f.root,'alias.json');fs.symlinkSync(f.file,alias);await assert.rejects(runSkillsCommand(['skills','inspect','--request',alias]));
  fs.unlinkSync(alias);fs.linkSync(f.file,alias);await assert.rejects(runSkillsCommand(['skills','inspect','--request',f.file]));fs.unlinkSync(alias);
  fs.chmodSync(f.root,0o777);await assert.rejects(runSkillsCommand(['skills','inspect','--request',f.file]));fs.chmodSync(f.root,0o700);
  const original=fs.readSync;let changed=false,closed=0;const close=fs.closeSync;
  t.mock.method(fs,'readSync',(...args:any[])=>{const count=(original as any)(...args);if(!changed){changed=true;fs.writeFileSync(f.file,'{"changed":true}');}return count;});
  t.mock.method(fs,'closeSync',(fd:number)=>{closed++;return close(fd);});
  await assert.rejects(runSkillsCommand(['skills','inspect','--request',f.file]),code('SKILLS_CHANGED'));assert.equal(changed,true);assert.equal(closed,1);assert.equal(calls.length,0);
});
test('record open is nonblocking and a changed FIFO type refuses before reading with descriptor closure',async t=>{
  const f=fixture(t);const open=fs.openSync,fstat=fs.fstatSync,close=fs.closeSync;
  let opened:number|undefined,flagsSeen:number|undefined,closed=0,reads=0;
  // Model the post-lstat replacement at the descriptor boundary without creating a blocking FIFO.
  t.mock.method(fs,'openSync',(path:any,flags:any,...rest:any[])=>{
    assert.equal(path,f.file);assert.equal(typeof flags,'number');flagsSeen=flags;
    assert.notEqual(flags&fs.constants.O_NONBLOCK,0);assert.notEqual(flags&fs.constants.O_NOFOLLOW,0);
    opened=(open as any)(path,flags,...rest);return opened;
  });
  t.mock.method(fs,'fstatSync',(fd:number,options:any)=>{
    assert.equal(fd,opened);const actual=fstat(fd,{bigint:true});assert.equal(options.bigint,true);
    return {...actual,mode:(actual.mode&~0o170000n)|0o010000n};
  });
  t.mock.method(fs,'readSync',()=>{reads++;throw Error('unexpected read after changed type');});
  t.mock.method(fs,'closeSync',(fd:number)=>{assert.equal(fd,opened);closed++;return close(fd);});
  await assert.rejects(runSkillsCommand(['skills','inspect','--request',f.file]),code('SKILLS_CHANGED'));
  assert.notEqual(flagsSeen,undefined);assert.equal(closed,1);assert.equal(reads,0);assert.equal(calls.length,0);
});
test('foreign exception getters and proxies are never exposed or inspected',async t=>{
  const f=fixture(t);let traps=0;action=()=>{throw new Proxy({},{get(){traps++;throw Error('PRIVATE');},getPrototypeOf(){traps++;throw Error('PRIVATE');}});};
  await assert.rejects(runSkillsCommand(['skills','inspect','--request',f.file]),code('SKILLS_REFUSED'));assert.equal(traps,0);assert.equal(calls.length,1);
});
test('signal-less cache completion stays owned and retains returned recovery evidence after cancellation',async t=>{
  const f=fixture(t),late=deferred(),entered=deferred();let settled=false;const before=process.listenerCount('SIGINT');action=()=>{entered.resolve(null);return late.promise;};
  const work=runSkillsCommand(['skills','source','recover','apply','--plan',f.file,'--approve',hex]).finally(()=>{settled=true;});await entered.promise;process.emit('SIGINT');await tick();assert.equal(settled,false);assert.equal(calls.length,1);assert.equal(process.listenerCount('SIGINT'),before+1);
  const result={status:'COMPLETED',snapshotRevision:hex};late.resolve(result);const output:any=await work;assert.deepEqual(output,{status:'completed-after-interruption',result,inspectionRequired:true,executionAuthorized:false});assert.equal(calls.length,1);assert.equal(process.listenerCount('SIGINT'),before);
});
test('cancelled signal-aware work observes late rejection without hidden retry or raw diagnostics',async t=>{
  const f=fixture(t),late=deferred(),entered=deferred();let signal:AbortSignal|undefined;action=(_name,args)=>{signal=args[1].signal;entered.resolve(null);return late.promise;};
  const work=runSkillsCommand(['skills','source','acquire','--plan',f.file,'--approve',hex]);const refusal=assert.rejects(work,code('SKILLS_INTERRUPTED_UNCERTAIN'));await entered.promise;process.emit('SIGTERM');assert.equal(signal!.aborted,true);late.reject(Error('PRIVATE_LATE'));await refusal;assert.equal(calls.length,1);
});

test('explicit immutable Git planning/acquisition routes never dispatch npm or implicit acquisition',async t=>{
  const f=fixture(t,{repository:'synthetic/example',commit:'b'.repeat(40)});
  await runSkillsCommand(['skills','source','git','plan','--request',f.file,'--state',f.root,'--operation','a'.repeat(32),'--min-free-bytes','12582912']);
  assert.deepEqual(calls.map(c=>c.name),['observeSkillCacheRoot','planGitAcquisition']);assert.equal(calls[1]!.args[0].commit,'b'.repeat(40));
  calls.length=0;await runSkillsCommand(['skills','source','git','acquire','--plan',f.file,'--approve',hex]);
  assert.deepEqual(calls.map(c=>c.name),['acquireGitSkill']);assert.equal(calls[0]!.args[1].approvalRevision,hex);assert.ok(calls[0]!.args[1].signal instanceof AbortSignal);
  calls.length=0;for(const argv of [
    ['skills','source','git','acquire','--plan',f.file],
    ['skills','source','git','plan','--request',f.file,'--state',f.root,'--operation','a'.repeat(32),'--min-free-bytes','12582912','--latest','true'],
    ['skills','source','git','update','--request',f.file],
  ])await assert.rejects(runSkillsCommand(argv),code('USAGE'));assert.equal(calls.length,0);
});

test('an uncertain or secondary-bearing source refusal becomes SKILLS_UNCERTAIN with only fixed codes and the recovery command',async t=>{
  const {NpmAcquisitionError}=await import(new URL('../packages/skill-sources/src/npm.js',import.meta.url).href);
  const {GitAcquisitionError}=await import(new URL('../packages/skill-sources/src/git.js',import.meta.url).href);
  const f=fixture(t);
  const uncertain=(...codes:string[])=>(e:any)=>e.code==='SKILLS_UNCERTAIN'&&codes.every(c=>e.message.includes(c))&&e.message.includes('skills source recover plan')&&!e.message.includes('PRIVATE');
  for(const [error,argv,expected] of [
    [new NpmAcquisitionError('NPM_CACHE_COMPLETE_UNCERTAIN'),['skills','source','acquire','--plan',f.file,'--approve',hex],['NPM_CACHE_COMPLETE_UNCERTAIN']],
    [new NpmAcquisitionError('NPM_INTEGRITY',['NPM_CACHE_RELEASE_UNCERTAIN']),['skills','source','acquire','--plan',f.file,'--approve',hex],['NPM_INTEGRITY','NPM_CACHE_RELEASE_UNCERTAIN']],
    [new NpmAcquisitionError('NPM_CACHE_RECOVERY_UNCERTAIN',['NPM_CACHE_RELEASE_UNCERTAIN']),['skills','source','recover','apply','--plan',f.file,'--approve',hex],['NPM_CACHE_RECOVERY_UNCERTAIN','NPM_CACHE_RELEASE_UNCERTAIN']],
    [new GitAcquisitionError('GIT_METADATA',['GIT_CACHE_HOLD_UNCERTAIN']),['skills','source','git','acquire','--plan',f.file,'--approve',hex],['GIT_METADATA','GIT_CACHE_HOLD_UNCERTAIN']],
  ] as const){action=()=>{throw error;};await assert.rejects(runSkillsCommand([...argv]),uncertain(...expected));}
});
test('a certain source refusal stays SKILLS_REFUSED and names only its listed fixed code',async t=>{
  const {NpmAcquisitionError}=await import(new URL('../packages/skill-sources/src/npm.js',import.meta.url).href);
  const {GitAcquisitionError}=await import(new URL('../packages/skill-sources/src/git.js',import.meta.url).href);
  const f=fixture(t);
  for(const [error,argv,listed] of [
    [new NpmAcquisitionError('NPM_CACHE_EXISTS'),['skills','source','acquire','--plan',f.file,'--approve',hex],'NPM_CACHE_EXISTS'],
    [new GitAcquisitionError('GIT_PATH_DIGEST'),['skills','source','git','acquire','--plan',f.file,'--approve',hex],'GIT_PATH_DIGEST'],
    [new NpmAcquisitionError('NPM_CACHE_RECORD'),['skills','source','inspect','--request',f.file],'NPM_CACHE_RECORD'],
  ] as const){action=()=>{throw error;};await assert.rejects(runSkillsCommand([...argv]),(e:any)=>e.code==='SKILLS_REFUSED'&&e.message.startsWith(`The skills command stopped (${listed}).`)&&!e.message.includes('PRIVATE'));}
});
test('an unlisted, raw or foreign source refusal stays SKILLS_REFUSED with no code or raw text',async t=>{
  const {NpmAcquisitionError}=await import(new URL('../packages/skill-sources/src/npm.js',import.meta.url).href);
  const f=fixture(t);let traps=0;
  for(const error of [new NpmAcquisitionError('PRIVATE_SENTINEL_UNCERTAIN'),new TypeError('NPM_CACHE_COMPLETE_UNCERTAIN PRIVATE'),new Proxy({},{get(){traps++;throw Error('PRIVATE');},getPrototypeOf(){traps++;throw Error('PRIVATE');}})]){
    action=()=>{throw error;};await assert.rejects(runSkillsCommand(['skills','source','inspect','--request',f.file]),(e:any)=>e.code==='SKILLS_REFUSED'&&!/NPM_|GIT_|PRIVATE/.test(e.message));
  }
  assert.equal(traps,0);
});

test('a partial open tells the user to start again with a new SOURCE_OPERATION, never to run recovery',async t=>{
  const {NpmAcquisitionError}=await import(new URL('../packages/skill-sources/src/npm.js',import.meta.url).href);
  const {GitAcquisitionError}=await import(new URL('../packages/skill-sources/src/git.js',import.meta.url).href);
  const f=fixture(t);
  for(const [error,argv,expected] of [
    [new NpmAcquisitionError('NPM_CACHE_OPEN_REFUSED',['NPM_CACHE_OPEN_PARTIAL']),['skills','source','acquire','--plan',f.file,'--approve',hex],['NPM_CACHE_OPEN_REFUSED','NPM_CACHE_OPEN_PARTIAL']],
    [new GitAcquisitionError('GIT_CACHE_OPEN_REFUSED',['GIT_CACHE_OPEN_PARTIAL']),['skills','source','git','acquire','--plan',f.file,'--approve',hex],['GIT_CACHE_OPEN_REFUSED','GIT_CACHE_OPEN_PARTIAL']],
  ] as const){
    action=()=>{throw error;};
    await assert.rejects(runSkillsCommand([...argv]),(e:any)=>e.code==='SKILLS_UNCERTAIN'&&expected.every(c=>e.message.includes(c))&&e.message.includes('new SOURCE_OPERATION')&&e.message.includes('Recovery cannot read')&&!/recover plan|recover apply/.test(e.message)&&!e.message.includes('PRIVATE'));
  }
});

test('a managed refusal appends only its listed managed code, so stale approval, local edit and drift differ',async t=>{
  const {ManagedSkillError}=await import(new URL('../packages/managed-skills/src/observed.js',import.meta.url).href);
  const f=withProject(t,{operation:'update',harness:'codex'});
  const message=(code:string)=>`The skills command stopped (${code}). Inspect the exact local cache and operation records before another action; no native execution authority is granted.`;
  for(const [code,argv] of [
    ['MANAGED_SKILL_STALE_APPROVAL',['skills','apply','--plan',f.file,'--approve',hex,'--previous','none']],
    ['MANAGED_SKILL_LOCAL_DRIFT',['skills','update','plan','--request',f.file]],
    ['MANAGED_SKILL_REFUSED',['skills','update','plan','--request',f.file]],
  ] as const){action=()=>{throw new ManagedSkillError(code);};await assert.rejects(runSkillsCommand([...argv]),(e:any)=>e.code==='SKILLS_REFUSED'&&e.message===message(code));}
  const plain='The skills command stopped. Inspect the exact local cache and operation records before another action; no native execution authority is granted.';
  for(const error of [new ManagedSkillError('MANAGED_SKILL_PRIVATE_OTHER'),new Error('MANAGED_SKILL_LOCKED'),Object.create(ManagedSkillError.prototype,{code:{get(){throw Error('PRIVATE');}}})]){
    action=()=>{throw error;};await assert.rejects(runSkillsCommand(['skills','update','plan','--request',f.file]),(e:any)=>e.code==='SKILLS_REFUSED'&&e.message===plain);
  }
});
test('v1 apply and recovery refuse while a v1beta2 marker or managed folder exists, before dispatch',async t=>{
  const v1Routes=[['skills','apply','--plan','FILE','--approve',hex,'--previous','none'],['skills','recover','plan','--request','FILE'],['skills','recover','apply','--plan','FILE','--approve',hex]];
  const f=withProject(t,{operation:'install',harness:'claude'}),argv=(route:string[])=>route.map(x=>x==='FILE'?f.file:x);
  const refused=(code:string)=>(e:any)=>e.code==='SKILLS_REFUSED'&&e.message.includes(code)&&!e.message.includes('PRIVATE');
  // A clean project dispatches.
  for(const route of v1Routes){calls.length=0;await runSkillsCommand(argv(route));assert.equal(calls.length,1);}
  const bowerloom=join(f.projectDir,'.bowerloom');fs.mkdirSync(bowerloom,{mode:0o700});
  for(const route of v1Routes){calls.length=0;await runSkillsCommand(argv(route));assert.equal(calls.length,1);}
  // An unfinished v1beta2 operation: its marker.
  const marker=join(bowerloom,'managed-pending.json');fs.writeFileSync(marker,'{}\n',{mode:0o600});
  for(const route of v1Routes){calls.length=0;await assert.rejects(runSkillsCommand(argv(route)),refused('MANAGED_SKILL_RECOVERY_REQUIRED'),route.join(' '));assert.equal(calls.length,0);}
  // A marker of any type counts, and a symlink is never followed.
  fs.unlinkSync(marker);fs.symlinkSync(join(f.root,'absent-target'),marker);
  for(const route of v1Routes){calls.length=0;await assert.rejects(runSkillsCommand(argv(route)),refused('MANAGED_SKILL_RECOVERY_REQUIRED'));assert.equal(calls.length,0);}
  fs.unlinkSync(marker);
  // The v1beta2 managed folder, with no marker.
  fs.mkdirSync(join(bowerloom,'managed'),{mode:0o700});
  for(const route of v1Routes){calls.length=0;await assert.rejects(runSkillsCommand(argv(route)),refused('MANAGED_SKILL_REFUSED'));assert.equal(calls.length,0);}
  fs.rmdirSync(join(bowerloom,'managed'));
  // A .bowerloom that is a symlink, group-writable or not a folder refuses rather than being read through.
  fs.rmdirSync(bowerloom);const elsewhere=join(f.root,'elsewhere');fs.mkdirSync(elsewhere,{mode:0o700});fs.symlinkSync(elsewhere,bowerloom);
  for(const route of v1Routes){calls.length=0;await assert.rejects(runSkillsCommand(argv(route)),refused('MANAGED_SKILL_REFUSED'));assert.equal(calls.length,0);}
  fs.unlinkSync(bowerloom);fs.mkdirSync(bowerloom,{mode:0o700});fs.chmodSync(bowerloom,0o770);
  for(const route of v1Routes){calls.length=0;await assert.rejects(runSkillsCommand(argv(route)));assert.equal(calls.length,0);}
  fs.rmdirSync(bowerloom);fs.writeFileSync(bowerloom,'not a folder\n',{mode:0o644});
  for(const route of v1Routes){calls.length=0;await assert.rejects(runSkillsCommand(argv(route)));assert.equal(calls.length,0);}
  // A record with no usable projectDir never dispatches.
  fs.writeFileSync(f.file,JSON.stringify({operation:'install',harness:'claude'}));
  for(const route of v1Routes){calls.length=0;await assert.rejects(runSkillsCommand(argv(route)));assert.equal(calls.length,0);}
  // Plan and inspect stay read-only routes and are not gated.
  fs.unlinkSync(bowerloom);fs.mkdirSync(bowerloom,{mode:0o700});fs.writeFileSync(join(bowerloom,'managed-pending.json'),'{}\n',{mode:0o600});f.write({operation:'install',harness:'claude'});
  calls.length=0;await runSkillsCommand(['skills','plan','--request',f.file]);await runSkillsCommand(['skills','inspect','--request',f.file]);assert.equal(calls.length,2);
});
// Lead call 4 (DECISIONS-01, from the lock-hardening review): on SKILLS_CHANGED from a parent folder, read once more.
// Each read of the record opens it once, so `opens` counts the reads. A parent folder changes when a file is added to it.
const touchParent=(f:{root:string},n:number)=>fs.writeFileSync(join(f.root,`sibling-${n}.txt`),'x',{mode:0o600});
function onOpen(t:any,f:{file:string},each:(n:number)=>void){
  const open=fs.openSync;let opens=0;
  t.mock.method(fs,'openSync',(path:any,...rest:any[])=>{const fd=(open as any)(path,...rest);if(path===f.file)each(++opens);return fd;});
  return ()=>opens;
}
test('a parent folder that changes once during the first read is read again once, then the command dispatches',async t=>{
  const f=fixture(t,{synthetic:true,id:1});const opens=onOpen(t,f,n=>{if(n===1)touchParent(f,n);});
  await runSkillsCommand(['skills','inspect','--request',f.file]);
  assert.deepEqual(calls.map(c=>c.name),['inspectObservedManagedSkill']);assert.deepEqual({...calls[0]!.args[0]},{synthetic:true,id:1});
  assert.equal(opens(),3,'the first read, its one repeat, and the check before dispatch');
});
test('a parent folder that changes during the check before dispatch is read again once, and the same value dispatches',async t=>{
  const f=fixture(t,{synthetic:true,id:2});const opens=onOpen(t,f,n=>{if(n===2)touchParent(f,n);});
  await runSkillsCommand(['skills','inspect','--request',f.file]);
  assert.deepEqual(calls.map(c=>c.name),['inspectObservedManagedSkill']);assert.deepEqual({...calls[0]!.args[0]},{synthetic:true,id:2});
  assert.equal(opens(),3);
});
test('a parent folder that keeps changing still refuses SKILLS_CHANGED after exactly one more read, with no dispatch',async t=>{
  const f=fixture(t);const opens=onOpen(t,f,n=>touchParent(f,n));
  await assert.rejects(runSkillsCommand(['skills','inspect','--request',f.file]),code('SKILLS_CHANGED'));assert.equal(calls.length,0);
  assert.equal(opens(),2);
});
test('the record file changing during the first read refuses at once: only a parent change is read again',async t=>{
  const f=fixture(t,{synthetic:true,id:3});const opens=onOpen(t,f,n=>{if(n===1)fs.writeFileSync(f.file,'{"synthetic":true,"id":4}');});
  await assert.rejects(runSkillsCommand(['skills','inspect','--request',f.file]),code('SKILLS_CHANGED'));assert.equal(calls.length,0);
  assert.equal(opens(),1);
});
test('a new record renamed into place after the first read changes the parent folder too: the repeat still refuses SKILLS_CHANGED, with no dispatch (review M1F 5)',async t=>{
  const f=fixture(t,{synthetic:true,id:5});
  // The first read ends when it closes the record. Only then is a new record renamed into place, so the first read
  // succeeds, the check before dispatch finds the parent folder changed, and its one repeat finds another record.
  const open=fs.openSync,close=fs.closeSync;let opens=0,recordFd:number|undefined,replaced=false;
  t.mock.method(fs,'openSync',(path:any,...rest:any[])=>{const fd=(open as any)(path,...rest);if(path===f.file){opens++;recordFd=fd;}return fd;});
  t.mock.method(fs,'closeSync',(fd:any)=>{(close as any)(fd);if(fd===recordFd&&!replaced){replaced=true;const next=join(f.root,'next.json');fs.writeFileSync(next,'{"synthetic":true,"id":6}',{mode:0o600});fs.renameSync(next,f.file);}});
  await assert.rejects(runSkillsCommand(['skills','inspect','--request',f.file]),code('SKILLS_CHANGED'));assert.equal(calls.length,0);
  assert.equal(replaced,true);assert.equal(opens,2,'the first read completed, then the check before dispatch read once more and refused');
});
