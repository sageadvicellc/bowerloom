import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {verifyInstalledContainerProof,CONTAINER_RUNTIME_FILES} from '../installed-container-guard.mjs';
import {prepareInstalledContainerProof} from '../prepare-installed-container.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const refused=e=>e.message==='INSTALLED_CONTAINER_PROOF_REFUSED';
function fixture(t){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-installed-guard-')));chmodSync(root,0o700);t.after(()=>rmSync(root,{recursive:true,force:true}));
 const proofRoot=join(root,'proof'),installedRoot=join(proofRoot,'install/node_modules/bowerloom');mkdirSync(installedRoot,{recursive:true,mode:0o700});chmodSync(proofRoot,0o700);
 const put=(base,path,bytes)=>{mkdirSync(dirname(join(base,path)),{recursive:true});writeFileSync(join(base,path),bytes,{mode:0o600});};
 const packageFiles={'package.json':JSON.stringify({name:'bowerloom',private:true,type:'module',dependencies:{pg:'8.16.3','subpath-only':'1.0.0'}}),'npm-shrinkwrap.json':'{}','dist/packages/mcp-connections/src/index.js':'export const synthetic=true;',...Object.fromEntries(CONTAINER_RUNTIME_FILES.map(path=>[path,'export const synthetic=true;']))};
 const files=Object.entries(packageFiles).map(([path,bytes])=>{put(installedRoot,path,bytes);return{path,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)};});
 const distribution=JSON.stringify({schema:'bowerloom/cli-distribution/v0.1',name:'bowerloom',private:true,files});put(installedRoot,'DISTRIBUTION.json',distribution);
 put(dirname(installedRoot),'pg/package.json',JSON.stringify({name:'pg',version:'8.16.3',main:'index.cjs'}));put(dirname(installedRoot),'pg/index.cjs','module.exports={synthetic:true};');
 put(dirname(installedRoot),'subpath-only/package.json',JSON.stringify({name:'subpath-only',version:'1.0.0',exports:{'./only':'./only.js'}}));put(dirname(installedRoot),'subpath-only/only.js','module.exports={synthetic:true};');
 const support=['driver/container-proof-driver.mjs','driver/installed-container-guard.mjs','driver/run-proof.mjs','fixtures/stdio-binding.json','fixtures/stdio-catalog.json','fixtures/stdio-declaration.json','evidence/image-config.json','evidence/image-index.json','evidence/image-manifest.json'].map(path=>{const bytes=path==='driver/installed-container-guard.mjs'?readFileSync(new URL('../installed-container-guard.mjs',import.meta.url)):Buffer.from(path.endsWith('.json')?'{}':'export const synthetic=true;');put(proofRoot,path,bytes);return{path,sha256:hash(bytes)};});
 put(proofRoot,'artifact.tgz','synthetic tarball identity fixture');
 const config={format:'bowerloom/installed-container-proof/v1',proofRoot,checkout:join(root,'checkout-not-required'),installedRoot,artifactSha256:hash('synthetic tarball identity fixture'),distributionSha256:hash(distribution),files:support};
 const configPath=join(proofRoot,'proof.json');const save=()=>writeFileSync(configPath,JSON.stringify(config),{mode:0o600});save();
 return{root,proofRoot,installedRoot,config,configPath,save,put};
}
test('inventory and module resolution allow subpath-only packages without checkout access or external processes',t=>{
 const f=fixture(t);t.mock.method(cp,'spawnSync',()=>{throw Error('unexpected effect');});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const pin=verifyInstalledContainerProof(f.configPath,{});assert.equal(pin.inventoryCount,3+CONTAINER_RUNTIME_FILES.length);assert.ok(pin.moduleUrl.startsWith(pathToFileURL(f.installedRoot).href));assert.ok(pin.pgUrl.startsWith(pathToFileURL(dirname(f.installedRoot)).href));assert.equal(existsSync(f.config.checkout),false);
});
test('modified tarball, inventory, runtime, fixture or missing guardian refuses before external effects',t=>{
 for(const alter of [f=>writeFileSync(join(f.proofRoot,'artifact.tgz'),'changed'),f=>writeFileSync(join(f.installedRoot,'DISTRIBUTION.json'),'{}'),f=>writeFileSync(join(f.installedRoot,CONTAINER_RUNTIME_FILES[0]),'changed'),f=>rmSync(join(f.installedRoot,CONTAINER_RUNTIME_FILES[2])),f=>writeFileSync(join(f.proofRoot,'fixtures/stdio-binding.json'),'changed'),f=>writeFileSync(join(f.installedRoot,'unexpected.js'),'changed')]){const f=fixture(t);alter(f);assert.throws(()=>verifyInstalledContainerProof(f.configPath,{}),refused);}
});
test('ambient Node module controls, checkout destinations and malformed proof pins fail closed',t=>{
 const f=fixture(t);for(const env of [{NODE_PATH:'/checkout/node_modules'},{NODE_OPTIONS:'--import=PRIVATE'},{NODE_V8_COVERAGE:'/private'},{NODE_TEST_CONTEXT:'unexpected'}])assert.throws(()=>verifyInstalledContainerProof(f.configPath,env),refused);
 for(const change of [c=>c.checkout=c.proofRoot,c=>c.artifactSha256='unknown',c=>c.files.push(c.files[0]),c=>c.files[0].path='../escape',c=>c.extra=true]){const g=fixture(t);change(g.config);g.save();assert.throws(()=>verifyInstalledContainerProof(g.configPath,{}),refused);}
});
test('runtime and dependency symlinks cannot borrow checkout bytes',t=>{
 for(const kind of ['runtime','dependency']){const f=fixture(t),target=join(f.root,'outside.js');writeFileSync(target,'export const outside=true;');const selected=kind==='runtime'?join(f.installedRoot,CONTAINER_RUNTIME_FILES[0]):join(dirname(f.installedRoot),'pg/index.cjs');rmSync(selected);symlinkSync(target,selected);assert.throws(()=>verifyInstalledContainerProof(f.configPath,{}),refused);}
});
test('installed resolution hook admits installed imports and blocks execution from outside the prefix',t=>{
 const f=fixture(t),outside=join(f.root,'outside.mjs'),marker=join(f.root,'unwanted-effect');writeFileSync(outside,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');export const bad=true;`);
 const guard=pathToFileURL(join(f.proofRoot,'driver/installed-container-guard.mjs')).href,log=join(f.proofRoot,'evidence/provenance.jsonl');
 const script=`import assert from 'node:assert/strict';import {installProofResolutionGuard} from ${JSON.stringify(guard)};const pin=installProofResolutionGuard(${JSON.stringify(f.configPath)},{provenanceFile:${JSON.stringify(log)}});assert.equal((await import(pin.moduleUrl)).synthetic,true);assert.equal((await import(pin.pgUrl)).default.synthetic,true);await assert.rejects(import(${JSON.stringify(pathToFileURL(outside).href)}),e=>e.message==='INSTALLED_CONTAINER_PROOF_REFUSED');pin.unregister();`;
 const r=cp.spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:f.proofRoot,env:{NODE_V8_COVERAGE:undefined},encoding:'utf8',timeout:10000,maxBuffer:65536});assert.equal(r.status,0,r.stderr);assert.equal(existsSync(marker),false);const records=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(records[0].event,'verified');assert.ok(records.filter(r=>r.event==='resolved').every(r=>r.url.startsWith(pathToFileURL(join(f.proofRoot,'install/node_modules')).href)));
});
test('preparation rejects bad artifact identity before invoking npm or creating a proof root',t=>{
 const f=fixture(t),destination=join(f.root,'new-proof'),repo=join(f.root,'repo'),images=join(f.root,'images');mkdirSync(repo);mkdirSync(images);
 t.mock.method(cp,'spawnSync',()=>{throw Error('unexpected external effect');});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 assert.throws(()=>prepareInstalledContainerProof({artifactFile:join(f.proofRoot,'artifact.tgz'),artifactSha256:'0'.repeat(64),repoDir:repo,proofRoot:destination,imageEvidenceDir:images}),e=>e.message==='INSTALLED_CONTAINER_PREPARATION_REFUSED');assert.equal(existsSync(destination),false);
});

test('real node --test subprocess permits only its exact child-v8 bookkeeping metadata',t=>{
 const f=fixture(t),script=join(f.root,'runner.test.mjs'),guard=pathToFileURL(join(f.proofRoot,'driver/installed-container-guard.mjs')).href;
 writeFileSync(script,`import test from 'node:test';import assert from 'node:assert/strict';import {verifyInstalledContainerProof} from ${JSON.stringify(guard)};test('verified before any service contact',()=>{assert.equal(process.env.NODE_TEST_CONTEXT,'child-v8');assert.equal(verifyInstalledContainerProof(${JSON.stringify(f.configPath)}).inventoryCount,${3+CONTAINER_RUNTIME_FILES.length});});`);
 const result=cp.spawnSync(process.execPath,['--test',script],{cwd:f.proofRoot,env:{},encoding:'utf8',timeout:10000,maxBuffer:65536});assert.equal(result.status,0,result.stderr+result.stdout);assert.match(result.stdout,/verified before any service contact/);
});
