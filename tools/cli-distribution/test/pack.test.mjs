import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync,chmodSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {collect,stage,pack,imports,lockedDependencies,sha256} from '../pack.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
function area(t) {const path=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-pack-proof-')));chmodSync(path,0o700);t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
function fixture(t) {
 const root=join(area(t),'source');mkdirSync(root);
 const collected=collect({repoDir:repo}); const names=new Set(['package.json','package-lock.json',...collected.record.sourceManifests.map(x=>x.path)]);
 for(const path of collected.files.keys()) if(path.startsWith('dist/')) {names.add(path);names.add(path.replace(/^dist\//,'').replace(/\.js$/,'.ts'));}else if(!['package.json','npm-shrinkwrap.json','README.md','DISTRIBUTION-NOTICE.md','DISTRIBUTION.json'].includes(path))names.add(path);
 for(const path of names) {mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),readFileSync(join(repo,path)));}
 return root;
}
test('runtime closure is deterministic, pins bins/assets/licenses and omits repository-only material',()=>{
 const a=collect({repoDir:repo}),b=collect({repoDir:repo});assert.deepEqual(a,b);
 assert.equal(a.manifest.private,true);assert.equal(a.manifest.name,'bowerloom');assert.deepEqual(Object.keys(a.manifest.bin),['bowerloom','bowerloom-mcp']);assert.equal(a.manifest.scripts,undefined);
 for(const path of a.files.keys())assert.ok(!/(?:^|\/)(?:test|tests|fixtures|node_modules|\.git|\.env|work)(?:\/|$)|\.map$|\.ts$/.test(path),path);
 for(const path of ['LICENSE','docs/beta/license-boundary.md','dist/packages/codex-adapter/src/guardian.js','packages/linux-browser/assets/runner.cjs','npm-shrinkwrap.json'])assert.ok(a.files.has(path),path);
 const supabaseLicense='packages/local-backend/licenses/supabase-Apache-2.0.txt';
 assert.deepEqual(a.files.get(supabaseLicense),readFileSync(join(repo,supabaseLicense)));
 assert.match(a.files.get(supabaseLicense).toString('utf8'),/Apache License/);
 for(const entry of a.record.files)assert.equal(sha256(a.files.get(entry.path)),entry.sha256);
 const lock=JSON.parse(a.files.get('npm-shrinkwrap.json'));assert.ok(Object.keys(lock.packages).length>100);assert.ok(!Object.keys(lock.packages).some(p=>p.includes('vite')||p.includes('typescript')));
 assert.equal(collect({repoDir:repo,name:'@example/custom-cli'}).manifest.name,'@example/custom-cli');
 assert.throws(()=>collect({repoDir:repo,name:'../escape'}),/identity/);
});
test('AST traversal captures dynamic imports and fork URL, rejecting dynamic module selectors',()=>{
 assert.deepEqual(imports('import x from "pg"; export * from "./x.js"; import("./y.js"); new URL("./guardian.js", import.meta.url);','x.js'),['pg','./x.js','./y.js','./guardian.js']);
 assert.throws(()=>imports('import(process.env.SECRET)','x.js'),/Nonliteral/);assert.deepEqual(imports('// import("fake")\nconst s="import(fake)";','x.js'),[]);
});
test('unexpected private files and test artifacts never enter stage; source escapes and undeclared deps fail',t=>{
 const root=fixture(t);writeFileSync(join(root,'.env'),'DO_NOT_SHIP');writeFileSync(join(root,'dist/apps/cli/src/ignored.js'),'DO_NOT_SHIP');
 assert.ok(!collect({repoDir:root}).files.has('dist/apps/cli/src/ignored.js'));
 const entry=join(root,'dist/apps/cli/src/main.js'),original=readFileSync(entry);
 writeFileSync(entry,original+'\nimport "../../../../private.js";');assert.throws(()=>collect({repoDir:root}),/allowlist/);
 writeFileSync(entry,original+'\nimport "not-approved";');assert.throws(()=>collect({repoDir:root}),/Undeclared/);
 writeFileSync(entry,original);rmSync(entry);symlinkSync(join(repo,'dist/apps/cli/src/main.js'),entry);assert.throws(()=>collect({repoDir:root}),/symlink/);
});
test('new destinations only: existing contents and symlink parents remain untouched',t=>{
 const root=area(t),destination=join(root,'existing');mkdirSync(destination);writeFileSync(join(destination,'keep'),'untouched');
 assert.throws(()=>stage({repoDir:repo,stageDir:destination}),/new absolute/);assert.equal(readFileSync(join(destination,'keep'),'utf8'),'untouched');
 const link=join(root,'link');symlinkSync(destination,link);assert.throws(()=>stage({repoDir:repo,stageDir:join(link,'new')}),/real directory/);assert.deepEqual(readdirSync(destination),['keep']);
});
test('dependency lock rejects unpinned, wrong-version, and workspace-linked packages',()=>{
 const manifest={name:'proof',version:'1.0.0',license:'MIT',dependencies:{x:'1.0.0'}};
 for(const item of [{version:'2.0.0'},{version:'1.0.0',link:true},{version:'1.0.0',resolved:'file:private',integrity:'sha512-x'}])assert.throws(()=>lockedDependencies({lockfileVersion:3,packages:{'node_modules/x':item}},manifest.dependencies,manifest));
});
test('actual npm tarballs are byte-deterministic with exact inventory and standalone offline startup', {timeout:180000,skip:process.env.BOWERLOOM_PACK_INSTALL_PROOF!=='1'},t=>{
 const root=area(t),one=pack({repoDir:repo,stageDir:join(root,'stage-one'),outputDir:join(root,'pack-one')}),two=pack({repoDir:repo,stageDir:join(root,'stage-two'),outputDir:join(root,'pack-two')});
 assert.equal(one.sha256,two.sha256);assert.equal(one.files,collect({repoDir:repo}).files.size);
 const install=join(root,'isolated-install');mkdirSync(install);writeFileSync(join(install,'.empty-npmrc'),'');
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,npm_config_userconfig:'/dev/null',npm_config_globalconfig:join(install,'.empty-npmrc'),npm_config_offline:'true',npm_config_ignore_scripts:'true'};
 const npm=spawnSync('npm',['install','--prefix',install,'--offline','--ignore-scripts','--no-audit','--no-fund','--no-save',one.file],{cwd:install,env,encoding:'utf8',timeout:120000,maxBuffer:2**20});
 assert.equal(npm.status,0,npm.stderr||npm.stdout);
 assert.deepEqual(readFileSync(join(install,'node_modules/bowerloom/packages/local-backend/licenses/supabase-Apache-2.0.txt')),readFileSync(join(repo,'packages/local-backend/licenses/supabase-Apache-2.0.txt')));
 const bin=join(install,'node_modules/.bin/bowerloom'),mcp=join(install,'node_modules/.bin/bowerloom-mcp');assert.ok(existsSync(bin));assert.ok(existsSync(mcp));
 function run(args,success=true) {const r=spawnSync(bin,args,{cwd:install,env,encoding:'utf8',timeout:30000,maxBuffer:2**20});if(success)assert.equal(r.status,0,r.stderr||r.stdout);return r;}
 assert.match(run(['--help']).stdout,/Bowerloom/);
 const target=join(root,'Reviewed Project'),args=['--mode','new','--target',target,'--name','Packaged proof','--goal','Review the setup without executing a team','--profile','engineer'];
 const plan=JSON.parse(run(['init','plan',...args,'--json']).stdout);assert.equal(existsSync(target),false);assert.equal(plan.executionAuthorized,false);
 assert.notEqual(run(['init','apply',...args,'--approve','invalid'],false).status,0);assert.equal(existsSync(target),false);
 assert.notEqual(run(['init','apply',...args.map(a=>a==='Review the setup without executing a team'?'Different requested goal':a),'--approve',plan.revision],false).status,0);assert.equal(existsSync(target),false);
 const receipt=JSON.parse(run(['init','apply',...args,'--approve',plan.revision]).stdout);assert.equal(receipt.runtimeReady,false);
 const status=JSON.parse(run(['init','status','--target',target]).stdout);assert.equal(status.specReady,true);assert.equal(status.runtimeReady,false);assert.equal(status.executionAuthorized,false);assert.equal(status.status,'ready-for-review');
 assert.deepEqual(readdirSync(target),['.bowerloom']);
 const mcpResult=spawnSync(mcp,[],{cwd:install,env,encoding:'utf8',timeout:30000});assert.equal(mcpResult.status,2);assert.match(mcpResult.stderr,/--installation/);
 console.log(JSON.stringify({artifactSha256:one.sha256,artifactBytes:one.bytes,unpackedBytes:one.unpackedBytes,files:one.files,offlineInstall:true,startupRevision:plan.revision,status:status.status,runtimeReady:status.runtimeReady,mcpArgumentGuard:true}));
});
