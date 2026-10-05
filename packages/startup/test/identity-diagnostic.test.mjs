import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {classifyStartupIdentityDiagnostic as classify} from '../../../dist/packages/startup/src/identity-diagnostic.js';
import {canonicalJson} from '../../../dist/packages/contracts/src/index.js';
import {planStartup,applyStartup,inspectStartup} from '../../../dist/packages/startup/src/index.js';
const pairs=[['1791182645709844779','1791182645709844827'],['1791182645709939570','1791182645709939479'],['1791182647023412086','1791182647023411989'],['1791182647023518585','1791182647023518562'],['1791182648351638335','1791182648351638317'],['1791182648351734959','1791182648351734876']];
const identity=birthtimeNs=>({device:'16777229',inode:'12345',birthtimeNs,uid:501,mode:448});
const saved=identity(pairs[0][0]),current=identity(pairs[0][1]);
const call=(a=saved,b=current,c=saved,d=current,platform='darwin')=>classify(a,b,c,d,platform);
const label='darwin-birthtime-f64-seconds-signature';
test('six signatures classify directionally; exact equality never classifies',()=>{
 for(const [a,b]of pairs){assert.equal(call(identity(a),identity(b)).classification,label);assert.equal(call(identity(a),identity(b),current,current).classification,label);assert.equal(call(identity(b),identity(a)),undefined);}
 assert.equal(call(saved,saved,saved,saved),undefined);assert.match(call().explanation,/remains blocked/);assert.match(call().explanation,/cause is unknown/);assert.equal(Object.isFrozen(call()),true);
});
test('platform, bounded positive interval and malformed values suppress classification',()=>{
 for(const p of ['linux','win32','freebsd','Darwin',''])assert.equal(call(saved,current,saved,current,p),undefined);
 for(const birth of ['946684799999999999','4102444800000000000','0','-1','01791182645709844779','1.791e18','NaN','1'.repeat(100),'1791182645709844779\n'])assert.equal(call({...saved,birthtimeNs:birth}),undefined);
 for(const birth of ['946684800000000000','4102444799999999999'])assert.equal(call(saved,current,identity(birth),identity(birth)).classification,label);
 for(const birth of ['946684799999999999','4102444800000000000'])assert.equal(call(saved,current,identity(birth),identity(birth)),undefined);
 let calls=0;const hostile={...saved};Object.defineProperty(hostile,'birthtimeNs',{enumerable:true,get(){calls++;throw Error('private');}});assert.equal(call(hostile),undefined);assert.equal(calls,0);assert.equal(call({...saved,extra:'private'}),undefined);assert.equal(call(Object.assign(Object.create({}),saved)),undefined);
});
test('other fields in either pair, symmetric equivalence and neighboring buckets refuse',()=>{
 for(const field of ['device','inode','uid','mode'])for(const at of [0,1,2,3]){const values=[saved,current,saved,current].map(v=>({...v}));values[at][field]=typeof values[at][field]==='number'?values[at][field]+1:values[at][field]+'1';assert.equal(classify(...values,'darwin'),undefined);}
 for(const birth of [String(BigInt(saved.birthtimeNs)+1n),String(BigInt(current.birthtimeNs)+1n),String(BigInt(current.birthtimeNs)+1000n)])assert.equal(call(saved,{...current,birthtimeNs:birth}),undefined);
 assert.equal(call(identity('1791182645709844946'),identity('1791182645709845066')),undefined);
});
function snapshot(root){const rows=[];function walk(path){const s=fs.lstatSync(path,{bigint:true});rows.push({path,ino:String(s.ino),dev:String(s.dev),birth:String(s.birthtimeNs),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs),mode:String(s.mode),hash:s.isFile()?createHash('sha256').update(fs.readFileSync(path)).digest('hex'):null});if(s.isDirectory())for(const name of fs.readdirSync(path).sort())walk(join(path,name));}walk(root);return rows;}
async function setup(t){const parent=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'bowerloom-identity-')));fs.chmodSync(parent,0o700);t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));const input={mode:'new',targetDir:join(parent,'project'),brief:{projectName:'Synthetic identity fixture',goal:'Review supplied synthetic notes.'}};const plan=await planStartup(input);await applyStartup(input,plan.revision);return {parent,input,plan,target:input.targetDir,directory:join(input.targetDir,'.bowerloom'),receiptPath:join(input.targetDir,'.bowerloom/installation-receipt.json')};}
function measuredReceipt(f){const r=JSON.parse(fs.readFileSync(f.receiptPath,'utf8'));r.installedTargetIdentity.birthtimeNs=pairs[0][0];r.installedBowerloomIdentity.birthtimeNs=pairs[1][0];fs.writeFileSync(f.receiptPath,JSON.stringify(r,null,2)+'\n');return r;}
async function observed(f,work,{unstable=false,receiptChanges=false,latePending=false}={}){
 const originals=new Map(),replace=(name,value)=>{originals.set(name,fs[name]);fs[name]=value;};
 const originalStat=fs.lstatSync,originalOpen=fs.openSync,originalRead=fs.readSync,originalNames=fs.readdirSync;
 let receiptOpens=0,closingFd=-1,namesCalls=0;
 replace('lstatSync',function(path,options){const stat=originalStat.call(this,path,options);if(options?.bigint&&(String(path)===f.target||String(path)===f.directory)){const copy=Object.assign(Object.create(Object.getPrototypeOf(stat)),stat);copy.birthtimeNs=BigInt(String(path)===f.target?pairs[0][1]:pairs[1][1]);if(unstable&&receiptOpens>=2)copy.birthtimeNs+=1n;return copy;}return stat;});
 replace('openSync',function(path,flags,...args){assert.equal(typeof flags==='string'?flags==='r':(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC))===0,true,'inspection attempted write open');const fd=originalOpen.call(this,path,flags,...args);if(String(path)===f.receiptPath&&++receiptOpens===2)closingFd=fd;return fd;});
 replace('readSync',function(fd,buffer,...args){const count=originalRead.call(this,fd,buffer,...args);if(receiptChanges&&fd===closingFd&&count){const i=buffer.indexOf(32);if(i>=0&&i<count)buffer[i]=9;}return count;});
 replace('readdirSync',function(path,...args){const values=originalNames.call(this,path,...args);if(String(path)===f.target&&++namesCalls>=4&&latePending)return [...values,'.bowerloom-revision.json'];return values;});
 for(const name of ['writeFileSync','mkdirSync','renameSync','rmSync','unlinkSync','chmodSync','utimesSync','lutimesSync','futimesSync'])if(typeof fs[name]==='function')replace(name,()=>{throw Error(`inspection attempted ${name}`);});
 syncBuiltinESMExports();try{return await work();}finally{for(const [name,value]of originals)fs[name]=value;syncBuiltinESMExports();}
}
function blocked(r,classified=false){assert.equal(r.status,'drifted');assert.equal(r.specReady,false);assert.equal(r.runtimeReady,false);assert.equal(r.executionAuthorized,false);assert.ok(r.drift.some(d=>d.kind==='installation-binding-changed'));assert.equal(r.identityDiagnostic?.classification,classified?label:undefined);}
const darwin={skip:process.platform!=='darwin'};
test('exact setup remains ready with unchanged plan and no optional diagnosis',async t=>{const f=await setup(t),before=snapshot(f.parent),first=await inspectStartup(f.target),again=await inspectStartup(f.target);assert.equal(first.specReady,true);assert.equal(first.identityDiagnostic,undefined);assert.deepEqual(first,again);assert.equal(first.revision,f.plan.revision);assert.deepEqual(snapshot(f.parent),before);});
test('real inspection classifies measured observations but retains refusal and writes nothing',darwin,async t=>{const f=await setup(t),receipt=measuredReceipt(f),before=snapshot(f.parent),result=await observed(f,()=>inspectStartup(f.target));blocked(result,true);assert.equal(result.revision,f.plan.revision);assert.equal(receipt.plan.revision,f.plan.revision);assert.deepEqual(result.drift,[{path:'.bowerloom',kind:'installation-binding-changed'}]);assert.deepEqual(snapshot(f.parent),before);});
test('changed managed bytes and unexpected entries suppress explanation',darwin,async t=>{for(const fault of ['changed','unexpected']){const f=await setup(t);measuredReceipt(f);if(fault==='changed')fs.appendFileSync(join(f.directory,f.plan.files[0].path),'changed');else fs.writeFileSync(join(f.directory,'extra.txt'),'synthetic');const before=snapshot(f.parent),r=await observed(f,()=>inspectStartup(f.target));blocked(r);assert.ok(r.drift.some(d=>d.kind===fault));assert.deepEqual(snapshot(f.parent),before);}});
test('invalid receipt, pending revision, target mismatch and symlink suppress explanation',darwin,async t=>{for(const fault of ['invalid','pending','target','symlink']){const f=await setup(t),r=measuredReceipt(f);if(fault==='invalid')fs.writeFileSync(f.receiptPath,'{}');if(fault==='pending')fs.writeFileSync(join(f.target,'.bowerloom-revision.json'),'{}');if(fault==='target'){r.plan.input.targetDir=join(f.parent,'other');const {revision,...body}=r.plan;r.plan.revision=createHash('sha256').update(canonicalJson(body)).digest('hex');fs.writeFileSync(f.receiptPath,JSON.stringify(r));}if(fault==='symlink'){fs.renameSync(f.directory,join(f.parent,'saved'));fs.symlinkSync(join(f.parent,'saved'),f.directory);}const result=await observed(f,()=>inspectStartup(f.target));assert.equal(result.specReady,false);assert.equal(result.identityDiagnostic,undefined);if(fault==='target')assert.ok(result.drift.some(d=>d.kind==='installation-binding-changed'));}});
test('closing identity, exact receipt bytes and late pending changes suppress explanation',darwin,async t=>{for(const options of [{unstable:true},{receiptChanges:true},{latePending:true}]){const f=await setup(t);measuredReceipt(f);const before=snapshot(f.parent),r=await observed(f,()=>inspectStartup(f.target),options);assert.equal(r.identityDiagnostic,undefined);assert.equal(r.specReady,false);assert.equal(r.executionAuthorized,false);assert.deepEqual(snapshot(f.parent),before);}});
