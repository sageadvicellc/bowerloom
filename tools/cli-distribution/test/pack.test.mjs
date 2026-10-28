import test from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync,chmodSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {collect,stage,pack,imports,lockedDependencies,verifyBundleFiles,flatDependencies,requireFreeSpace,licenseAllowed,extractBundle,defaultNpmCache,installHeading,expectedInstallCommand,sha256,MODULES} from '../pack.mjs';
import {tarBytes,putInCache,integrityOf,cachePath,syntheticClosure,lockOf,registryUrl,entryFor,manifestEntry} from './bundle-fixture.mjs';
import childProcess from 'node:child_process';
import {statSync} from 'node:fs';
const TAGLINE='Set up the skills, prompts, and teams your agents use, and approve every change.';
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
 assert.equal(a.manifest.private,true);assert.equal(a.manifest.dependencies.jose,'6.2.12');assert.equal(a.manifest.name,'bowerloom');assert.deepEqual(Object.keys(a.manifest.bin),['bowerloom','bowerloom-mcp','bowerloom-guard']);assert.equal(a.manifest.scripts,undefined);
 for(const path of a.files.keys())assert.ok(!/(?:^|\/)(?:test|tests|fixtures|node_modules|\.git|\.env|work)(?:\/|$)|\.map$|\.ts$/.test(path),path);
 for(const path of ['LICENSE','docs/beta/license-boundary.md','dist/packages/codex-adapter/src/guardian.js','dist/packages/codex-adapter/src/supervisor.js','dist/packages/codex-adapter/src/boundary.js','dist/packages/mcp-connections/src/discovery.js','dist/packages/mcp-connections/src/auth.js','dist/packages/mcp-connections/src/authority.js','dist/packages/mcp-connections/src/authority-postgres.js','dist/packages/mcp-connections/src/http.js','dist/packages/mcp-connections/src/stdio.js','dist/packages/mcp-connections/src/container.js','dist/packages/mcp-connections/src/container-supervisor.js','dist/packages/mcp-connections/src/container-guardian.js','dist/packages/mcp-connections/src/container-policy.js','packages/linux-browser/assets/runner.cjs','npm-shrinkwrap.json'])assert.ok(a.files.has(path),path);
 const supabaseLicense='packages/local-backend/licenses/supabase-Apache-2.0.txt';
 assert.deepEqual(a.files.get(supabaseLicense),readFileSync(join(repo,supabaseLicense)));
 assert.match(a.files.get(supabaseLicense).toString('utf8'),/Apache License/);
 for(const entry of a.record.files)assert.equal(sha256(a.files.get(entry.path)),entry.sha256);
 const lock=JSON.parse(a.files.get('npm-shrinkwrap.json'));assert.ok(Object.keys(lock.packages).length>100);assert.ok(!Object.keys(lock.packages).some(p=>p.includes('vite')||p.includes('typescript')));
 assert.throws(()=>collect({repoDir:repo,name:'@example/custom-cli'}),/Release record/);
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
test('actual npm tarballs are byte-deterministic with exact inventory and standalone offline startup', {timeout:600000,skip:process.env.BOWERLOOM_PACK_INSTALL_PROOF!=='1'&&'set BOWERLOOM_PACK_INSTALL_PROOF=1'},t=>{
 const root=area(t),one=pack({repoDir:repo,stageDir:join(root,'stage-one'),outputDir:join(root,'pack-one'),bundle:true,npmCache:defaultNpmCache()}),two=pack({repoDir:repo,stageDir:join(root,'stage-two'),outputDir:join(root,'pack-two'),bundle:true,npmCache:defaultNpmCache()});
 assert.equal(one.sha256,two.sha256);assert.equal(one.files,collect({repoDir:repo}).files.size);
 const install=join(root,'isolated-install');mkdirSync(install);writeFileSync(join(install,'.empty-npmrc'),'');
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,npm_config_userconfig:'/dev/null',npm_config_globalconfig:join(install,'.empty-npmrc'),npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_update_notifier:'false'};
 const npm=spawnSync('npm',['install','--prefix',install,'--offline','--ignore-scripts','--no-audit','--no-fund','--no-save',one.file],{cwd:install,env,encoding:'utf8',timeout:120000,maxBuffer:2**20});
 assert.equal(npm.status,0,npm.stderr||npm.stdout);
 assert.deepEqual(readFileSync(join(install,'node_modules/bowerloom/packages/local-backend/licenses/supabase-Apache-2.0.txt')),readFileSync(join(repo,'packages/local-backend/licenses/supabase-Apache-2.0.txt')));
 const bin=join(install,'node_modules/.bin/bowerloom'),mcp=join(install,'node_modules/.bin/bowerloom-mcp');assert.ok(existsSync(bin));assert.ok(existsSync(mcp));
 function run(args,success=true) {const r=spawnSync(bin,args,{cwd:install,env,encoding:'utf8',timeout:30000,maxBuffer:2**20});if(success)assert.equal(r.status,0,r.stderr||r.stdout);return r;}
 assert.match(run(['--help']).stdout,/Bowerloom/);
 const installedVersion=JSON.parse(readFileSync(join(install,'node_modules/bowerloom/package.json'),'utf8')).version;
 assert.equal(run(['--version']).stdout.trim(),`Bowerloom ${installedVersion}`);
 assert.equal(run(['-V']).stdout.trim(),`Bowerloom ${installedVersion}`);
 assert.match(run(['init','--help']).stdout,/init plan/);
 const target=join(root,'Reviewed Project'),args=['--mode','new','--target',target,'--name','Packaged proof','--goal','Review the setup without executing a team','--profile','engineer'];
 const plan=JSON.parse(run(['init','plan',...args,'--json']).stdout);assert.equal(existsSync(target),false);assert.equal(plan.executionAuthorized,false);
 assert.notEqual(run(['init','apply',...args,'--approve','invalid'],false).status,0);assert.equal(existsSync(target),false);
 assert.notEqual(run(['init','apply',...args.map(a=>a==='Review the setup without executing a team'?'Different requested goal':a),'--approve',plan.revision],false).status,0);assert.equal(existsSync(target),false);
 const receipt=JSON.parse(run(['init','apply',...args,'--approve',plan.revision]).stdout);assert.equal(receipt.runtimeReady,false);
 const status=JSON.parse(run(['init','status','--target',target]).stdout);assert.equal(status.specReady,true);assert.equal(status.runtimeReady,false);assert.equal(status.executionAuthorized,false);assert.equal(status.status,'ready-for-review');
 assert.deepEqual(readdirSync(target),['.bowerloom']);
 const revisionArgs=['--target',target,'--name','Packaged proof','--goal','Review a revised project goal','--profile','engineer'];
 const revision=JSON.parse(run(['revise','plan',...revisionArgs,'--json']).stdout);
 assert.equal(revision.fromRevision,plan.revision);assert.equal(revision.executionAuthorized,false);
 const revised=JSON.parse(run(['revise','apply',...revisionArgs,'--from',plan.revision,'--approve',revision.revision]).stdout);
 assert.equal(revised.plan.revision,revision.toRevision);assert.equal(revised.executionAuthorized,false);
 const demo=JSON.parse(run(['init','demo-plan','--target',target,'--from',revised.plan.revision,'--json']).stdout);
 assert.equal(demo.executionAuthorized,false);assert.equal(demo.runtimeReady,false);
 const synthetic=join(root,'synthetic');mkdirSync(synthetic,{mode:0o700});
 const codex=join(synthetic,'config.toml'),claude=join(synthetic,'settings.json'),neutral=join(synthetic,'neutral.json');
 writeFileSync(codex,'model = "o3"\nmodel_reasoning_effort = "high"\n',{mode:0o600});writeFileSync(claude,'{}\n',{mode:0o600});
 const imported=JSON.parse(run(['harness','import','--harness','codex','--file',codex,'--synthetic']).stdout);
 writeFileSync(neutral,JSON.stringify(imported.neutral),{mode:0o600});
 const projection=JSON.parse(run(['harness','plan','--harness','claude','--file',claude,'--neutral',neutral,'--synthetic']).stdout);
 assert.equal(projection.status,'review-required');assert.equal(projection.executionAuthorized,false);assert.equal(projection.writesAuthorized,false);
 assert.equal(readFileSync(claude,'utf8'),'{}\n');
 const stateDir=join(root,'managed-projection'),managedArgs=['--harness','claude','--file',claude,'--neutral',neutral,'--state',stateDir,'--synthetic'];
 const managed=JSON.parse(run(['harness','managed-plan',...managedArgs]).stdout);
 assert.notEqual(run(['harness','apply',...managedArgs,'--approve','0'.repeat(64)],false).status,0);
 const projected=JSON.parse(run(['harness','apply',...managedArgs,'--approve',managed.revision]).stdout);assert.equal(projected.executionAuthorized,false);
 assert.notEqual(readFileSync(claude,'utf8'),'{}\n');
 const removalArgs=['--state',stateDir,'--synthetic'],removal=JSON.parse(run(['harness','removal-plan',...removalArgs]).stdout);
 const removed=JSON.parse(run(['harness','remove',...removalArgs,'--approve',removal.revision]).stdout);assert.equal(removed.executionAuthorized,false);
 assert.equal(readFileSync(claude,'utf8'),'{}\n');
 const mcpFixture=join(root,'mcp-fixture');mkdirSync(mcpFixture,{mode:0o700});
 const mcpArgs=['mcp','plan'];
 const fixtureBefore=[];
 for(const kind of ['declaration','binding','catalog']) {
  const file=join(mcpFixture,kind+'.json'),bytes=readFileSync(join(repo,'packages/mcp-connections/test/fixtures/streamable-http-'+kind+'.json'));
  writeFileSync(file,bytes,{mode:0o600});fixtureBefore.push([file,bytes]);mcpArgs.push('--'+kind,file);
 }
 mcpArgs.push('--synthetic');
 const connectionPlan=JSON.parse(run(mcpArgs).stdout);
 assert.equal(connectionPlan.status,'planning-only');assert.equal(connectionPlan.executionAuthorized,false);assert.equal(connectionPlan.authenticationVerified,false);
 assert.equal(connectionPlan.selectedTools.find(tool=>tool.name==='create_draft').permissionClass,'external-write');
 assert.notEqual(run(mcpArgs.slice(0,-1),false).status,0);
 assert.notEqual(run(['mcp','invoke',...mcpArgs.slice(2)],false).status,0);
 for(const [file,bytes] of fixtureBefore)assert.deepEqual(readFileSync(file),bytes);
 const mcpResult=spawnSync(mcp,[],{cwd:install,env,encoding:'utf8',timeout:30000});assert.equal(mcpResult.status,2);assert.match(mcpResult.stderr,/--installation/);
 console.log(JSON.stringify({artifactSha256:one.sha256,artifactBytes:one.bytes,unpackedBytes:one.unpackedBytes,files:one.files,offlineInstall:true,startupRevision:plan.revision,revisionPlan:revision.revision,harnessPlanning:true,managedProjection:true,demoPlan:demo.revision,status:status.status,runtimeReady:status.runtimeReady,mcpArgumentGuard:true,mcpPlanning:connectionPlan.contentRevision}));
});

// A fixture copy of this repository whose release record is rewritten by edit.
function rewritten(t,edit) {
 const root=fixture(t),path=join(root,'release/beta.json'),r=JSON.parse(readFileSync(path));
 edit(r);writeFileSync(path,JSON.stringify(r,null,2)+'\n');
 return {root,path};
}
// An npm release record: this repository's record without its distribution block, unreleased.
function npmRecord(t) {
 return rewritten(t,r=>{delete r.distribution;r.state='unreleased';r.npm.published=false;r.npm.installCommand=`npm install --global ${r.npm.packageName}@${r.version}`;});
}
// A private-archive record (a colleague beta): installed from the packed file, unreleased and never published.
function privateArchiveRecord(t) {
 return rewritten(t,r=>{r.state='unreleased';r.distribution={kind:'private-archive',archive:`${r.npm.packageName}-${r.version}.tgz`,npmPublication:false};r.npm.published=false;r.npm.installCommand=`npm install -g ./${r.npm.packageName}-${r.version}.tgz`;});
}
test('release candidate uses the shared record and explicit public beta metadata without publication',t=>{
 const {root,path}=npmRecord(t),candidate=collect({repoDir:root,releaseCandidate:true});
 assert.equal(candidate.manifest.private,false);
 assert.deepEqual(candidate.manifest.publishConfig,{access:'public',tag:'beta',registry:'https://registry.npmjs.org'});
 assert.equal(candidate.record.publicationState,'unreleased');
 assert.equal(candidate.record.releaseRecordSha256,sha256(readFileSync(path)));
 assert.match(candidate.files.get('README.md').toString(),/After publication:\n\n```sh\nnpm install --global bowerloom@/);
 assert.doesNotMatch(candidate.files.get('README.md').toString(),/alpha|Private, unpublished/);
 const r=JSON.parse(readFileSync(path));
 r.version='9.9.9';writeFileSync(path,JSON.stringify(r));
 assert.throws(()=>collect({repoDir:root,releaseCandidate:true}),/Release record/);
});

// Freeze security review finding 1: a private-archive record is never packed as a public release candidate, so its
// package.json never loses private:true or gains a public publishConfig.
test('a release candidate of a private-archive record refuses before anything is packed',t=>{
 const {root:source}=privateArchiveRecord(t);
 assert.throws(()=>collect({repoDir:source,releaseCandidate:true}),/private archive/);
 const root=area(t);assert.throws(()=>stage({repoDir:source,stageDir:join(root,'stage'),releaseCandidate:true}),/private archive/);
 assert.deepEqual(readdirSync(root),[]);
 const plain=collect({repoDir:source});assert.equal(plain.manifest.private,true);assert.equal(plain.manifest.publishConfig,undefined);
});

// Review finding 7: the install heading is true for the record it is written for.
test('the candidate install heading says After publication only for an npm record',t=>{
 const record=JSON.parse(readFileSync(privateArchiveRecord(t).path));
 assert.equal(installHeading(record),'Install it from the folder that holds the archive:');
 const {path}=npmRecord(t);assert.equal(installHeading(JSON.parse(readFileSync(path))),'After publication:');
 for(const [path,bytes] of collect({repoDir:repo}).files)assert.doesNotMatch(bytes.toString('latin1'),/After publication/,path);
});

// Freeze security review info 5: "no install scripts" is a checked rule of the shrinkwrap, not an observation.
test('a locked dependency with an install script refuses',()=>{
 const manifest={name:'proof',version:'1.0.0',license:'MIT',dependencies:{x:'1.0.0'}};
 const item={version:'1.0.0',resolved:'https://registry.npmjs.org/x/-/x-1.0.0.tgz',integrity:'sha512-x'};
 assert.ok(lockedDependencies({lockfileVersion:3,packages:{'node_modules/x':item}},manifest.dependencies,manifest).packages['node_modules/x']);
 for(const flag of [true,'true',1])assert.throws(()=>lockedDependencies({lockfileVersion:3,packages:{'node_modules/x':{...item,hasInstallScript:flag}}},manifest.dependencies,manifest),/install script/);
 const nested={...item,dependencies:{y:'2.0.0'}},y={version:'2.0.0',resolved:'https://registry.npmjs.org/y/-/y-2.0.0.tgz',integrity:'sha512-y',hasInstallScript:true};
 assert.throws(()=>lockedDependencies({lockfileVersion:3,packages:{'node_modules/x':nested,'node_modules/y':y}},manifest.dependencies,manifest),/install script/);
});

test('packaging refuses a same-version renamed root package',t=>{
 const root=fixture(t),path=join(root,'package.json'),pkg=JSON.parse(readFileSync(path));
 pkg.name='other';writeFileSync(path,JSON.stringify(pkg));
 assert.throws(()=>collect({repoDir:root}),/Release record/);
 assert.throws(()=>collect({repoDir:root,releaseCandidate:true}),/Release record/);
});


test('routine packaging collection includes only reachable loader closure and exact source pins',()=>{
 const result=collect({repoDir:repo});
 for(const path of ['dist/apps/cli/src/routine.js','dist/packages/routines/src/files.js','dist/packages/routines/src/index.js']){
  assert.ok(result.files.has(path),path);
  assert.equal(result.record.files.find(item=>item.path===path).sha256,sha256(readFileSync(join(repo,path))));
  const source=path.replace(/^dist\//,'').replace(/\.js$/,'.ts');
  assert.equal(result.record.sourceFiles.find(item=>item.path===source).sha256,sha256(readFileSync(join(repo,source))));
 }
 assert.equal(result.manifest.dependencies.yaml,'2.9.1');
 const lock=JSON.parse(result.files.get('npm-shrinkwrap.json'));assert.equal(lock.packages['node_modules/yaml'].version,'2.9.1');
 assert.deepEqual(Object.keys(result.manifest.bin),['bowerloom','bowerloom-mcp','bowerloom-guard']);assert.equal(result.manifest.scripts,undefined);assert.equal(result.manifest.exports,undefined);
 for(const path of result.files.keys())assert.ok(!/(?:^|\/)(?:test|tests|fixtures|work|\.bowerloom)(?:\/|$)|labs-to-blog\.yaml$/.test(path),path);
 assert.deepEqual([...result.files.keys()].filter(path=>path.startsWith('dist/packages/routines/')).sort(),['dist/packages/routines/src/files.js','dist/packages/routines/src/index.js']);
});

test('internal routine and skills manifests are exact exceptions and present manifests still validate',()=>{
 const original={lstatSync:fs.lstatSync,readFileSync:fs.readFileSync};
 let selected='',mode='missing';const valid={name:'synthetic-internal',license:'MIT',dependencies:{yaml:'2.9.1'}};
 fs.lstatSync=function(path,...args){if(path===selected){if(mode==='missing'){const e=new Error('SYNTHETIC_ENOENT');e.code='ENOENT';throw e;}if(mode==='symlink'){const s=original.lstatSync(join(repo,'package.json'),...args);s.isSymbolicLink=()=>true;return s;}return original.lstatSync(join(repo,'package.json'),...args);}return original.lstatSync(path,...args);};
 fs.readFileSync=function(path,...args){if(path===selected){const manifest=mode==='bad-license'?{...valid,license:'UNREVIEWED'}:mode==='unpinned'?{...valid,dependencies:{yaml:'^2.9.1'}}:mode==='conflict'?{...valid,dependencies:{yaml:'2.8.3'}}:valid;const bytes=Buffer.from(JSON.stringify(manifest));return args[0]==='utf8'?bytes.toString('utf8'):bytes;}return original.readFileSync(path,...args);};
 syncBuiltinESMExports();
 try{
  for(const relative of ['packages/routines/package.json','packages/connections/package.json','packages/skill-sources/package.json','packages/managed-skills/package.json']){
   selected=join(repo,relative);mode='missing';assert.equal(collect({repoDir:repo}).record.sourceManifests.some(m=>m.path===relative),false);
   mode='valid';const included=collect({repoDir:repo}).record.sourceManifests.find(m=>m.path===relative);assert.equal(included.sha256,sha256(Buffer.from(JSON.stringify(valid))));
   mode='bad-license';assert.throws(()=>collect({repoDir:repo}),/Unreviewed first-party license/);
   mode='unpinned';assert.throws(()=>collect({repoDir:repo}),/exactly pinned/);
   mode='conflict';assert.throws(()=>collect({repoDir:repo}),/Conflicting dependency/);
   mode='symlink';assert.throws(()=>collect({repoDir:repo}),/symlink/);
  }
  selected=join(repo,'packages/crew/package.json');mode='missing';assert.throws(()=>collect({repoDir:repo}),error=>error.code==='ENOENT');
 }finally{Object.assign(fs,original);syncBuiltinESMExports();}
});

// Bowerloom 0.8, step 2: skill-manifest takes its engine ids from the harness definition core, so the core is a runtime
// module of the CLI. It has no package.json of its own.
test('0.8 harness-definition is an allowlisted runtime module with an optional manifest',()=>{
 assert.ok(MODULES.includes('harness-definition'));
 const record=collect({repoDir:repo}).record;
 assert.equal(record.sourceManifests.some(m=>m.path==='packages/harness-definition/package.json'),false);
});

// Bowerloom 0.8, step 3: the locked-in writers of project-sync take their translations from the fidelity package, so
// fidelity is a runtime module of the CLI too. It has no package.json of its own.
test('0.8 fidelity is an allowlisted runtime module with an optional manifest',()=>{
 assert.ok(MODULES.includes('fidelity'));
 const record=collect({repoDir:repo}).record;
 assert.equal(record.sourceManifests.some(m=>m.path==='packages/fidelity/package.json'),false);
 assert.ok(record.sourceFiles.some(f=>f.path==='packages/fidelity/src/locked-hooks.ts'));
});

// Beta 0.7.0 Day 0: the project-layer packages are runtime modules with optional internal manifests.
test('beta 0.7.0 project packages are allowlisted modules whose manifests are optional but validated when present',()=>{
 const added=['project-context','project-config','project-authoring','skill-manifest','project-sync','context-slices'];
 for(const name of added)assert.ok(MODULES.includes(name),name);
 assert.ok(Object.isFrozen(MODULES));assert.equal(new Set(MODULES).size,MODULES.length);
 const original={lstatSync:fs.lstatSync,readFileSync:fs.readFileSync};
 let selected='',mode='missing';const valid={name:'synthetic-internal',license:'MIT',dependencies:{yaml:'2.9.1'}};
 // A package folder that does not exist yet is presented as a plain directory, so only the manifest decides.
 fs.lstatSync=function(path,...args){if(path===selected){if(mode==='missing'){const e=new Error('SYNTHETIC_ENOENT');e.code='ENOENT';throw e;}if(mode==='symlink'){const s=original.lstatSync(join(repo,'package.json'),...args);s.isSymbolicLink=()=>true;return s;}return original.lstatSync(join(repo,'package.json'),...args);}if(mode!=='missing'&&path===dirname(selected))return original.lstatSync(join(repo,'packages'),...args);return original.lstatSync(path,...args);};
 fs.readFileSync=function(path,...args){if(path===selected){const manifest=mode==='bad-license'?{...valid,license:'UNREVIEWED'}:mode==='unpinned'?{...valid,dependencies:{yaml:'^2.9.1'}}:mode==='conflict'?{...valid,dependencies:{yaml:'2.8.3'}}:valid;const bytes=Buffer.from(JSON.stringify(manifest));return args[0]==='utf8'?bytes.toString('utf8'):bytes;}return original.readFileSync(path,...args);};
 syncBuiltinESMExports();
 try{
  for(const name of added){const relative=`packages/${name}/package.json`;
   selected=join(repo,relative);mode='missing';assert.equal(collect({repoDir:repo}).record.sourceManifests.some(m=>m.path===relative),false,relative);
   mode='valid';const included=collect({repoDir:repo}).record.sourceManifests.find(m=>m.path===relative);assert.equal(included.sha256,sha256(Buffer.from(JSON.stringify(valid))));
   mode='bad-license';assert.throws(()=>collect({repoDir:repo}),/Unreviewed first-party license/);
   mode='unpinned';assert.throws(()=>collect({repoDir:repo}),/exactly pinned/);
   mode='conflict';assert.throws(()=>collect({repoDir:repo}),/Conflicting dependency/);
   mode='symlink';assert.throws(()=>collect({repoDir:repo}),/symlink/);
  }
 }finally{Object.assign(fs,original);syncBuiltinESMExports();}
});

test('routine packaging missing compiled/source loader cannot become a partial accepted closure',()=>{
 const original=fs.lstatSync;let selected='';
 fs.lstatSync=function(path,...args){if(path===selected){const e=new Error('SYNTHETIC_ENOENT');e.code='ENOENT';throw e;}return original(path,...args);};syncBuiltinESMExports();
 try{for(const path of ['dist/apps/cli/src/routine.js','dist/packages/routines/src/files.js','dist/packages/routines/src/index.js','packages/routines/src/files.ts']){selected=join(repo,path);assert.throws(()=>collect({repoDir:repo}),error=>error.code==='ENOENT');}}
 finally{fs.lstatSync=original;syncBuiltinESMExports();}
});

// Requires the separately reviewed tar dependency and fresh selected compiler closure.
test('skills CLI reaches exact source/cache/manager closure with locked tar runtime and no proof material',()=>{
 const result=collect({repoDir:repo});
 for(const path of ['dist/apps/cli/src/skills.js','dist/packages/skill-sources/src/npm.js','dist/packages/skill-sources/src/cache.js','dist/packages/skill-sources/src/validation.js','dist/packages/managed-skills/src/observed.js','dist/packages/managed-skills/src/transaction.js']){assert.ok(result.files.has(path),path);assert.ok(result.record.sourceFiles.some(row=>row.path===path.replace(/^dist\//,'').replace(/\.js$/,'.ts')),path);}
 assert.equal(result.manifest.dependencies.tar,'7.5.20');const lock=JSON.parse(result.files.get('npm-shrinkwrap.json'));assert.equal(lock.packages['node_modules/tar'].version,'7.5.20');
 for(const path of result.files.keys())assert.ok(!/(?:^|\/)(?:work|test|tests|fixtures)(?:\/)|\.bowerloom-skills|owner\.lock/.test(path),path);
});
test('skills collection refuses missing reachable source or compiled modules',()=>{
 const original=fs.lstatSync;let selected='';fs.lstatSync=function(path,...args){if(path===selected){const e=new Error('SYNTHETIC_ENOENT');e.code='ENOENT';throw e;}return original(path,...args);};syncBuiltinESMExports();
 try{for(const path of ['dist/apps/cli/src/skills.js','packages/skill-sources/src/cache.ts','dist/packages/managed-skills/src/transaction.js']){selected=join(repo,path);assert.throws(()=>collect({repoDir:repo}),e=>e.code==='ENOENT');}}finally{fs.lstatSync=original;syncBuiltinESMExports();}
});

// An npm-beta-stream record (the public beta stream) in the given state, installed from npm under its dist-tag.
function betaStreamRecord(t,state) {
 return rewritten(t,r=>{r.distribution={kind:'npm-beta-stream',distTag:r.npm.distTag};r.state=state;r.npm.published=state==='published';r.npm.installCommand=`npm install -g ${r.npm.packageName}@${r.npm.distTag}`;});
}
// The record of this repository carries an npm-beta-stream distribution and packs privately when not a candidate.
test('the npm-beta-stream record of this repository packs privately when not a release candidate',()=>{
 const record=JSON.parse(readFileSync(join(repo,'release/beta.json')));
 assert.deepEqual(record.distribution,{kind:'npm-beta-stream',distTag:'beta'});
 assert.equal(expectedInstallCommand(record,'bowerloom',record.version),'npm install -g bowerloom@beta');
 const plain=collect({repoDir:repo});assert.equal(plain.manifest.private,true);assert.equal(plain.manifest.publishConfig,undefined);assert.equal(plain.record.publicationState,record.state);
 assert.equal(plain.manifest.repository,undefined);assert.equal(plain.manifest.homepage,undefined);assert.equal(plain.manifest.bugs,undefined);
});
// The owner packs the public archive from an unreleased record and flips it to published only after the publish.
test('an unreleased npm-beta-stream record packs as a public release candidate with npm metadata',t=>{
 const {root,path}=betaStreamRecord(t,'unreleased'),r=JSON.parse(readFileSync(path)),pkg=JSON.parse(readFileSync(join(root,'package.json')));
 const candidate=collect({repoDir:root,releaseCandidate:true}),manifest=JSON.parse(candidate.files.get('package.json'));
 assert.deepEqual(manifest,candidate.manifest);
 assert.equal(manifest.private,false);assert.equal(manifest.version,pkg.version);assert.equal(manifest.version,r.version);
 assert.equal(manifest.description,'An agent environment manager. Set up the skills, prompts, and teams your agents use, and approve every change.');
 assert.deepEqual(manifest.repository,{type:'git',url:'git+'+r.urls.repository+'.git'});
 assert.equal(manifest.homepage,r.urls.site);
 assert.deepEqual(manifest.bugs,{url:r.urls.repository+'/issues'});
 assert.deepEqual(manifest.publishConfig,{access:'public',tag:'beta',registry:'https://registry.npmjs.org'});
 assert.equal(candidate.record.publicationState,'unreleased');assert.equal(candidate.record.releaseRecordSha256,sha256(readFileSync(path)));
 const readme=candidate.files.get('README.md').toString();
 assert.ok(readme.startsWith(`# Bowerloom ${r.release}\n\nOpen beta. Requires Node ${r.requirements.node}.\n`),readme);
 assert.match(readme,/Install it:\n\n```sh\nnpm install -g bowerloom@beta\n/);
 assert.ok(readme.includes('npm install -g bowerloom@beta'));
 const notice=candidate.files.get('DISTRIBUTION-NOTICE.md').toString();
 assert.ok(notice.startsWith('# Bowerloom notices\n'),notice);
 assert.match(notice,/MIT licensed under LICENSE/);assert.match(notice,/PLAYWRIGHT-LICENSE\.txt and packages\/local-backend\/THIRD_PARTY_NOTICES\.md/);
});
test('the public candidate description, README and notice carry no private, proof or unreleased wording',t=>{
 const {root}=betaStreamRecord(t,'unreleased'),candidate=collect({repoDir:root,releaseCandidate:true});
 const words=/private|proof|unreleased|unpublished|candidate/i;
 assert.doesNotMatch(JSON.parse(candidate.files.get('package.json')).description,words);
 assert.doesNotMatch(candidate.files.get('README.md').toString(),words);
 assert.doesNotMatch(candidate.files.get('DISTRIBUTION-NOTICE.md').toString(),words);
});
test('a published npm-beta-stream record is still refused as a release candidate before anything is staged',t=>{
 const {root:source}=betaStreamRecord(t,'published');
 assert.equal(collect({repoDir:source}).manifest.private,true);
 assert.throws(()=>collect({repoDir:source,releaseCandidate:true}),/unreleased record/);
 const root=area(t);assert.throws(()=>stage({repoDir:source,stageDir:join(root,'stage'),releaseCandidate:true}),/unreleased record/);assert.deepEqual(readdirSync(root),[]);
});
test('the candidate install heading is Install it: for an npm-beta-stream record',t=>{
 assert.equal(installHeading(JSON.parse(readFileSync(betaStreamRecord(t,'unreleased').path))),'Install it:');
});
test('an npm-beta-stream install command is exactly npm install -g <name>@<distTag>',()=>{
 const record=JSON.parse(readFileSync(join(repo,'release/beta.json'))),v=record.version;
 assert.equal(expectedInstallCommand({...record,state:'unreleased',npm:{...record.npm,published:false}},'bowerloom',v),'npm install -g bowerloom@beta');
 for(const command of ['npm install --global bowerloom@beta',`npm install -g bowerloom@${v}`,'npm install -g bowerloom@next','npm install -g bowerloom@latest',`npm install -g ./bowerloom-${v}.tgz`])
  assert.notEqual(expectedInstallCommand(record,'bowerloom',v),command,command);
});
test('an npm-beta-stream distribution has exactly kind and distTag, matches npm.distTag, and never names latest',()=>{
 const record=JSON.parse(readFileSync(join(repo,'release/beta.json'))),v=record.version;
 const tagged=tag=>({...record,distribution:{kind:'npm-beta-stream',distTag:tag},npm:{...record.npm,distTag:tag}});
 assert.equal(expectedInstallCommand(tagged('next-beta'),'bowerloom',v),'npm install -g bowerloom@next-beta');
 for(const tag of ['latest','Beta','1beta','be ta','-beta','',7,undefined])assert.equal(expectedInstallCommand(tagged(tag),'bowerloom',v),null,String(tag));
 for(const distribution of [{kind:'npm-beta-stream',distTag:'beta',archive:`bowerloom-${v}.tgz`},{kind:'npm-beta-stream',distTag:'beta',npmPublication:true},{kind:'npm-beta-stream'},{kind:'npm-beta-stream',tag:'beta'},{kind:'npm-beta-stream',distTag:'next'},{kind:'npm-stable',distTag:'beta'},null])
  assert.equal(expectedInstallCommand({...record,distribution},'bowerloom',v),null,JSON.stringify(distribution));
 assert.equal(expectedInstallCommand({...record,npm:{...record.npm,distTag:'next'}},'bowerloom',v),null,'npm.distTag differs from the distribution');
});
test('packaging refuses an npm-beta-stream record with latest, a third key, a mismatched tag, or a noncanonical command',t=>{
 for(const edit of [
  r=>{r.distribution.distTag='latest';r.npm.distTag='latest';r.npm.installCommand='npm install -g bowerloom@latest';},
  r=>{r.distribution.archive=`bowerloom-${r.version}.tgz`;},
  r=>{r.distribution.distTag='next';},
  r=>{r.npm.installCommand='npm install --global bowerloom@beta';},
  r=>{r.npm.installCommand=`npm install -g bowerloom@${r.version}`;},
  r=>{r.npm.installCommand='npm install -g bowerloom@next';},
  r=>{r.state=r.state==='published'?'unreleased':'published';},
 ]){const {root}=rewritten(t,edit);assert.throws(()=>collect({repoDir:root}),/Release record/,String(edit));}
});
test('an unaccepted distribution refuses even when the install command is missing, so a null expectation never matches',t=>{
 for(const edit of [
  r=>{r.distribution={kind:'unknown'};r.npm.installCommand=null;},
  r=>{r.distribution={kind:'npm-beta-stream',distTag:'latest'};r.npm.installCommand=null;},
  r=>{r.distribution=null;delete r.npm.installCommand;},
 ]){const {root}=rewritten(t,edit);assert.throws(()=>collect({repoDir:root}),/Release record does not match package identity/,String(edit));}
});
test('a release record whose urls differ from the canonical set is refused before anything is staged',t=>{
 const message=/Release record URLs do not match the package identity/;
 for(const edit of [
  r=>{delete r.urls;},
  r=>{r.urls.repository='https://github.com/attacker/bowerloom';},
  r=>{r.urls.site='https://attacker.example';},
  r=>{r.urls.docs='https://bowerloom.ai/other/';},
  r=>{r.urls.extra='https://bowerloom.ai';},
  r=>{r.urls.site={href:'https://bowerloom.ai'};},
 ]) for(const releaseCandidate of [false,true]){
  const {root:source}=rewritten(t,edit);
  assert.throws(()=>collect({repoDir:source,releaseCandidate}),message,String(edit));
  const root=area(t);assert.throws(()=>stage({repoDir:source,stageDir:join(root,'stage'),releaseCandidate}),message,String(edit));assert.deepEqual(readdirSync(root),[]);
 }
});


// ---- Spec 02: install pins and the bundled runtime ----
let realBundle;const real=()=>realBundle??=collect({repoDir:repo,bundle:true});
const DIRECT=['@dbos-inc/dbos-sdk','@langchain/langgraph','@langchain/langgraph-checkpoint-postgres','@modelcontextprotocol/sdk','ajv','jose','langsmith','pg','tar','yaml'];
// A fixture copy of the repository whose lock is synthetic: the ten direct dependencies, one nested path, and tiny tarballs in a temporary cache.
function bundledRepo(t) {
 const root=fixture(t),cache=join(area(t),'cache'),versions=collect({repoDir:repo}).manifest.dependencies,paths={};
 for(const name of DIRECT)paths['node_modules/'+name]={version:versions[name],...(name==='pg'?{deps:{inner:'4.0.0'}}:{}),
  // jose declares a files list and carries a bin, a readme, a license, and a changelog: npm keeps the first four and drops the changelog.
  ...(name==='jose'?{manifestExtra:{files:['index.js'],bin:{jose:'bin/x.js'}},extra:[{path:'bin/x.js',data:'#!/usr/bin/env node\n',mode:0o755},{path:'README.md',data:'readme'},{path:'LICENSE',data:'license'},{path:'CHANGELOG.md',data:'changes'}]}:{})};
 paths['node_modules/pg/node_modules/inner']={version:'4.0.0'};
 const packages=syntheticClosure(cache,paths);
 const lock=lockOf(packages);writeFileSync(join(root,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
 return {root,cache,lock};
}
const run1=(t,options)=>{const base=area(t);return {base,...options,stageDir:join(base,'stage'),outputDir:join(base,'out')};};

test('flatDependencies returns every top-level entry, skips nested ones, and sorts optional ones apart',()=>{
 const packages={'':{},'node_modules/zeta':{version:'1.0.0'},'node_modules/@scope/pkg':{version:'2.1.0-beta.1'},'node_modules/opt':{version:'3.0.0',optional:true},'node_modules/zeta/node_modules/inner':{version:'9.9.9'}};
 const result=flatDependencies(packages,{zeta:'1.0.0'});
 assert.deepEqual(result,{dependencies:{'@scope/pkg':'2.1.0-beta.1',zeta:'1.0.0'},optionalDependencies:{opt:'3.0.0'}});
 assert.deepEqual(Object.keys(result.dependencies),['@scope/pkg','zeta']);
});
test('flatDependencies refuses an alias and a link',()=>{
 assert.throws(()=>flatDependencies({'node_modules/a':{version:'1.0.0',name:'other'}},{}),/^Error: Unpinnable dependency: node_modules\/a$/);
 assert.throws(()=>flatDependencies({'node_modules/a':{version:'1.0.0',link:true}},{}),/^Error: Unpinnable dependency: node_modules\/a$/);
});
test('flatDependencies refuses versions that are not exact',()=>{
 for(const version of ['^1.0.0','1.0','1.0.0+build',undefined,1])assert.throws(()=>flatDependencies({'node_modules/x':{version}},{}),/^Error: Unpinnable dependency: node_modules\/x$/,String(version));
});
test('flatDependencies refuses a direct dependency that differs from the lock or has no entry',()=>{
 const packages={'node_modules/x':{version:'1.0.0'}};
 assert.throws(()=>flatDependencies(packages,{x:'1.0.1'}),/^Error: Pinned dependency differs from the lock: x$/);
 assert.throws(()=>flatDependencies(packages,{missing:'1.0.0'}),/^Error: Pinned dependency differs from the lock: missing$/);
 assert.deepEqual(flatDependencies(packages,{x:'1.0.0'}).dependencies,{x:'1.0.0'});
});
test('the real manifest pins every top-level lock entry to its lock version',()=>{
 const lock=JSON.parse(readFileSync(join(repo,'package-lock.json'))),{manifest}=real();
 for(const group of [manifest.dependencies,manifest.optionalDependencies])for(const [name,version] of Object.entries(group))assert.equal(version,lock.packages['node_modules/'+name].version,name);
});
test('the real manifest holds the tested versions of the four drifting packages and react',()=>{
 const {dependencies}=real().manifest;
 assert.equal(dependencies['@langchain/core'],'1.2.14');assert.equal(dependencies['@langchain/langgraph-checkpoint'],'1.1.5');assert.equal(dependencies['@langchain/langgraph-sdk'],'1.12.0');
 assert.equal(dependencies.express,'5.2.1');assert.equal(dependencies.react,'19.3.0');
});
test('the real shrinkwrap root lists the same dependencies as the manifest',()=>{
 const {manifest,files}=real(),root=JSON.parse(files.get('npm-shrinkwrap.json')).packages[''];
 assert.deepEqual(root.dependencies,manifest.dependencies);assert.deepEqual(root.optionalDependencies,manifest.optionalDependencies);
});
test('pg-cloudflare is an optional pin and not a required one',()=>{
 const {manifest}=real();assert.deepEqual(manifest.optionalDependencies,{'pg-cloudflare':'1.4.1'});assert.equal(manifest.dependencies['pg-cloudflare'],undefined);
});
test('bundleDependencies is the sorted union of both maps and has 142 names',()=>{
 const {manifest}=real(),names=[...Object.keys(manifest.dependencies),...Object.keys(manifest.optionalDependencies)].sort((a,b)=>a.localeCompare(b));
 assert.deepEqual(manifest.bundleDependencies,names);assert.equal(names.length,142);assert.equal(Object.keys(manifest.dependencies).length,141);
});
test('without bundle the manifest has pins and no bundleDependencies, and collect is deterministic',()=>{
 const a=collect({repoDir:repo});assert.equal(a.manifest.bundleDependencies,undefined);assert.equal(a.record.bundle,undefined);
 assert.equal(a.manifest.dependencies.express,'5.2.1');
 assert.deepEqual(collect({repoDir:repo,bundle:true}),real());
});
test('the real shrinkwrap has exactly the six known nested paths',()=>{
 const nested=Object.keys(JSON.parse(real().files.get('npm-shrinkwrap.json')).packages).filter(p=>p.split('node_modules/').length>2).sort();
 assert.deepEqual(nested,['node_modules/@langchain/langgraph-sdk/node_modules/eventemitter3','node_modules/@langchain/langgraph-sdk/node_modules/p-queue','node_modules/@langchain/langgraph-sdk/node_modules/p-timeout','node_modules/body-parser/node_modules/content-type','node_modules/negotiator/node_modules/content-type','node_modules/type-is/node_modules/content-type']);
});

test('extractBundle lays out top-level and nested packages, strips any first folder, and sets modes whatever the umask',t=>{
 const root=area(t),cache=join(root,'cache'),stageDir=join(root,'stage');
 const packages=syntheticClosure(cache,{'node_modules/a':{version:'1.0.0',extra:[{path:'bin/run.js',data:'#!/usr/bin/env node\n',mode:0o755},{path:'plain.txt',data:'x',mode:0o666}]},'node_modules/@s/b':{version:'2.0.0',first:'other'},'node_modules/a/node_modules/c':{version:'3.0.0'}});
 const before=process.umask(0o077);let result;try{result=extractBundle({stageDir,packages,npmCache:cache});}finally{process.umask(before);}
 for(const file of ['node_modules/a/package.json','node_modules/@s/b/package.json','node_modules/a/node_modules/c/index.js'])assert.ok(existsSync(join(stageDir,file)),file);
 assert.equal(JSON.parse(readFileSync(join(stageDir,'node_modules/@s/b/package.json'))).version,'2.0.0');
 assert.equal(statSync(join(stageDir,'node_modules/a/bin/run.js')).mode&0o777,0o755);
 assert.equal(statSync(join(stageDir,'node_modules/a/plain.txt')).mode&0o777,0o644);
 assert.equal(statSync(join(stageDir,'node_modules/a/package.json')).mode&0o777,0o644);
 assert.equal(statSync(join(stageDir,'node_modules/a/bin')).mode&0o777,0o755);
 assert.ok(result.bundleFiles.has('node_modules/a/bin/run.js'));assert.ok(result.bundleFiles.has('node_modules/a/node_modules/c/package.json'));
 assert.equal(result.files,result.bundleFiles.size);assert.ok(result.bytes>0);
});
test('extractBundle names the path of a missing cache entry',t=>{
 const root=area(t),cache=join(root,'cache');mkdirSync(cache);
 const packages=syntheticClosure(join(root,'other'),{'node_modules/a':{version:'1.0.0'}});
 assert.throws(()=>extractBundle({stageDir:join(root,'stage'),packages,npmCache:cache}),/^Error: Bundle cache entry missing: node_modules\/a$/);
});
test('extractBundle refuses cache bytes that do not match the lock and integrity values that are not one sha512',t=>{
 const root=area(t),cache=join(root,'cache'),good=tarBytes([{path:'package/package.json',data:'{}'}]),other=tarBytes([{path:'package/package.json',data:'{"x":1}'}]);
 const integrity=integrityOf(good);putInCache(cache,other,integrity);
 const item=integrity=>({version:'1.0.0',resolved:registryUrl('a','1.0.0'),integrity});
 assert.throws(()=>extractBundle({stageDir:join(root,'s1'),packages:{'node_modules/a':item(integrity)},npmCache:cache}),/^Error: Bundle integrity mismatch: node_modules\/a$/);
 for(const bad of ['sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA=',integrity+' '+integrity,'sha512-AAAA',undefined])
  assert.throws(()=>extractBundle({stageDir:join(root,'s2'),packages:{'node_modules/a':item(bad)},npmCache:cache}),/^Error: Bundle integrity mismatch: node_modules\/a$/,String(bad));
});
test('extractBundle refuses links, devices, unsafe paths, too many entries, tar warnings, and oversized content',t=>{
 const root=area(t),cache=join(root,'cache');let n=0;
 const attempt=(entries,options,max)=>{const item=entryFor(cache,'p',entries,options);return ()=>extractBundle({stageDir:join(root,'s'+n++),packages:{'node_modules/p':item},npmCache:cache,...(max?{maxBundleBytes:max}:{})});};
 const manifest=manifestEntry('p');
 for(const [label,entry] of [['package/sym',{path:'package/sym',type:'2',linkpath:'/etc/passwd'}],['package/hard',{path:'package/hard',type:'1',linkpath:'package/package.json'}],['package/dev',{path:'package/dev',type:'3'}],['/abs/file',{path:'/abs/file',data:'x'}],['package/../evil.js',{path:'package/../evil.js',data:'x'}],
  ['package//double.js',{path:'package//double.js',data:'x'}],['package/./dot.js',{path:'package/./dot.js',data:'x'}],['package/node_modules/x/index.js',{path:'package/node_modules/x/index.js',data:'x'}],['package/node_modules/',{path:'package/node_modules/',type:'5'}]])
  assert.throws(attempt([manifest,entry]),e=>e.message==='Bundle tarball unsafe: node_modules/p/'+label,label);
 assert.throws(attempt([manifest,...Array.from({length:8192},(_,i)=>({path:`package/f${i}`,data:'x'}))]),/^Error: Bundle tarball unsafe: node_modules\/p\//);
 assert.doesNotThrow(attempt([manifest,...Array.from({length:8191},(_,i)=>({path:`package/f${i}`,data:'x'}))]));
 assert.throws(attempt([manifest],{corruptChecksum:true}),/^Error: Bundle tarball unsafe: node_modules\/p\//);
 assert.throws(attempt([manifest,{path:'package/big.bin',data:Buffer.alloc(2*2**20,97)}],{},2**20),e=>e.message==='Bundle exceeds 1 GiB');
});
test('every tar entry costs at least 4096 bytes of the bundle cap',t=>{
 const root=area(t),cache=join(root,'cache'),item=entryFor(cache,'p',[manifestEntry('p'),...Array.from({length:300},(_,i)=>({path:`package/f${i}`,data:'x'}))]);
 assert.throws(()=>extractBundle({stageDir:join(root,'s1'),packages:{'node_modules/p':item},npmCache:cache,maxBundleBytes:2**20}),e=>e.message==='Bundle exceeds 1 GiB');
 extractBundle({stageDir:join(root,'s2'),packages:{'node_modules/p':item},npmCache:cache,maxBundleBytes:2**21});
});
test('a bundle of more than 50000 entries is refused',t=>{
 const root=area(t),cache=join(root,'cache'),packages={};
 for(let i=0;i<7;i++){const name='p'+i;packages['node_modules/'+name]=entryFor(cache,name,[manifestEntry(name),...Array.from({length:8000},(_,k)=>({path:`package/f${k}`}))]);}
 assert.throws(()=>extractBundle({stageDir:join(root,'stage'),packages,npmCache:cache}),/^Error: Bundle exceeds 50000 entries$/);
});
test('a path with dots or an absolute look never writes outside the stage',t=>{
 const root=area(t),cache=join(root,'cache'),sentinel=join(root,'sentinel');mkdirSync(sentinel);writeFileSync(join(sentinel,'keep'),'x');
 const item=entryFor(cache,'p',[manifestEntry('p')]);
 const before=readdirSync(root).sort();
 for(const key of ['node_modules/../../sentinel/x','node_modules/..','node_modules/a/../../../sentinel','/abs/path','node_modules//a','node_modules/.hidden','sentinel','node_modules/a/node_modules/..'])
  assert.throws(()=>extractBundle({stageDir:join(root,'stage'),packages:{[key]:item},npmCache:cache}),e=>e.message==='Bundle path unsafe: '+key,key);
 assert.deepEqual(readdirSync(root).sort(),[...before,'stage'].sort());assert.deepEqual(readdirSync(sentinel),['keep']);
 assert.deepEqual(readdirSync(join(root,'stage')),[]);
});
test('extractBundle refuses a target that already exists or is reached through a link',t=>{
 const root=area(t),cache=join(root,'cache'),stageDir=join(root,'stage'),outside=join(root,'outside');mkdirSync(outside);
 const item=entryFor(cache,'p',[manifestEntry('p')]);
 mkdirSync(join(stageDir,'node_modules/p'),{recursive:true});
 assert.throws(()=>extractBundle({stageDir,packages:{'node_modules/p':item},npmCache:cache}),/^Error: Bundle path unsafe: node_modules\/p$/);
 rmSync(join(stageDir,'node_modules/p'),{recursive:true});symlinkSync(outside,join(stageDir,'node_modules/p'));
 assert.throws(()=>extractBundle({stageDir,packages:{'node_modules/p':item},npmCache:cache}),/^Error: Bundle path unsafe: node_modules\/p$/);
 fs.unlinkSync(join(stageDir,'node_modules/p'));rmSync(join(stageDir,'node_modules'),{recursive:true});symlinkSync(outside,join(stageDir,'node_modules'));
 assert.throws(()=>extractBundle({stageDir,packages:{'node_modules/p':item},npmCache:cache}),/^Error: Bundle path unsafe: node_modules\/p$/);
 assert.deepEqual(readdirSync(outside),[]);
});
test('lockedDependencies refuses a dependency name that leaves node_modules',()=>{
 const manifest={name:'proof',version:'1.0.0',license:'MIT',dependencies:{x:'1.0.0'}};
 const item={version:'1.0.0',resolved:'https://registry.npmjs.org/x/-/x-1.0.0.tgz',integrity:'sha512-x'};
 for(const bad of ['..','../evil','.hidden','a/b','@s/..','/abs','a b','']) {
  assert.throws(()=>lockedDependencies({lockfileVersion:3,packages:{'node_modules/x':{...item,dependencies:{[bad]:'1.0.0'}}}},manifest.dependencies,manifest),e=>e.message==='Bundle path unsafe: '+bad,JSON.stringify(bad));
  assert.throws(()=>lockedDependencies({lockfileVersion:3,packages:{'node_modules/x':item}},{[bad]:'1.0.0'},manifest),e=>e.message==='Bundle path unsafe: '+bad,JSON.stringify(bad));
 }
 assert.ok(lockedDependencies({lockfileVersion:3,packages:{'node_modules/x':{...item,dependencies:{'@scope/pkg.js':'1.0.0'}},'node_modules/@scope/pkg.js':{...item,version:'1.0.0'}}},manifest.dependencies,manifest));
});
test('extractBundle ties each package to the lock: name, version, resolved URL, license, install scripts',t=>{
 const root=area(t),cache=join(root,'cache');let n=0;
 const attempt=(name,entries,change={})=>{const item={...entryFor(cache,name,entries),...change};return ()=>extractBundle({stageDir:join(root,'s'+n++),packages:{['node_modules/'+name]:item},npmCache:cache});};
 assert.doesNotThrow(attempt('p',[manifestEntry('p')]));
 assert.throws(attempt('p',[manifestEntry('other')]),/^Error: Bundle package mismatch: node_modules\/p$/);
 assert.throws(attempt('p',[{path:'package/index.js',data:'x'}]),/^Error: Bundle package mismatch: node_modules\/p$/);
 assert.throws(attempt('p',[{path:'package/package.json',data:'not json'}]),/^Error: Bundle package mismatch: node_modules\/p$/);
 assert.throws(attempt('p',[manifestEntry('p',{},'2.0.0')]),/^Error: Bundle package mismatch: node_modules\/p$/);
 assert.throws(attempt('p',[manifestEntry('p',{license:'GPL-3.0-only'})]),/^Error: Bundled license not allowed: p GPL-3.0-only$/);
 assert.throws(attempt('p',[manifestEntry('p',{license:undefined})]),/^Error: Bundled license not allowed: p \(none\)$/);
 for(const script of ['preinstall','install','postinstall'])assert.throws(attempt('p',[manifestEntry('p',{scripts:{[script]:'node x.js'}})]),/^Error: Bundle package has an install script: node_modules\/p$/,script);
 assert.doesNotThrow(attempt('p',[manifestEntry('p',{scripts:{test:'x'}})]));
 assert.throws(attempt('p',[manifestEntry('p'),{path:'package/binding.gyp',data:'{}'}]),/^Error: Bundle package has an install script: node_modules\/p$/);
 assert.throws(attempt('p',[manifestEntry('p')],{resolved:'https://registry.npmjs.org/p/-/p-9.9.9.tgz'}),/^Error: Bundle resolved URL mismatch: node_modules\/p$/);
 assert.throws(attempt('p',[manifestEntry('p')],{resolved:'https://evil.example/p/-/p-1.0.0.tgz'}),/^Error: Bundle resolved URL mismatch: node_modules\/p$/);
 assert.throws(attempt('p',[manifestEntry('p')],{resolved:undefined}),/^Error: Bundle resolved URL mismatch: node_modules\/p$/);
 assert.doesNotThrow(attempt('@s/q',[manifestEntry('@s/q')]));
});
test('maxBundleBytes must be a positive integer of at most 1 GiB',t=>{
 const {root,cache}=bundledRepo(t),message=/^Error: maxBundleBytes must be a positive integer of at most 1 GiB$/;
 for(const bad of [NaN,'5',0,-1,1.5,2**30+1,Infinity,null]) {
  assert.throws(()=>stage(run1(t,{repoDir:root,bundle:true,npmCache:cache,maxBundleBytes:bad})),message,String(bad));
  assert.throws(()=>pack(run1(t,{repoDir:root,bundle:true,npmCache:cache,maxBundleBytes:bad})),message,String(bad));
  assert.throws(()=>extractBundle({stageDir:join(area(t),'s'),packages:{},npmCache:cache,maxBundleBytes:bad}),message,String(bad));
 }
});
test('extractBundle refuses a cache entry that is a FIFO or larger than 256 MiB',t=>{
 const root=area(t),cache=join(root,'cache');
 const good=tarBytes([manifestEntry('p')]),integrity=integrityOf(good),file=cachePath(cache,integrity);
 mkdirSync(dirname(file),{recursive:true});assert.equal(spawnSync('mkfifo',[file]).status,0);
 const item={version:'1.0.0',resolved:registryUrl('p','1.0.0'),integrity};
 assert.throws(()=>extractBundle({stageDir:join(root,'s1'),packages:{'node_modules/p':item},npmCache:cache}),/^Error: Bundle cache entry unsafe: node_modules\/p$/);
 rmSync(file);fs.writeFileSync(file,'');fs.truncateSync(file,257*2**20);
 assert.throws(()=>extractBundle({stageDir:join(root,'s2'),packages:{'node_modules/p':item},npmCache:cache}),/^Error: Bundle cache entry unsafe: node_modules\/p$/);
});
test('executable bits come from the tar entry, whatever the umask',t=>{
 const root=area(t),cache=join(root,'cache'),item=entryFor(cache,'p',[manifestEntry('p'),{path:'package/bin/run.js',data:'x',mode:0o755},{path:'package/plain.js',data:'x',mode:0o644}]);
 const before=process.umask(0o177);try{extractBundle({stageDir:join(root,'stage'),packages:{'node_modules/p':item},npmCache:cache});}finally{process.umask(before);}
 assert.equal(statSync(join(root,'stage/node_modules/p/bin/run.js')).mode&0o777,0o755);
 assert.equal(statSync(join(root,'stage/node_modules/p/plain.js')).mode&0o777,0o644);
 assert.equal(statSync(join(root,'stage/node_modules/p/bin')).mode&0o777,0o755);
});
test('verifyBundleFiles names a staged bundled file that changed after extraction',t=>{
 const root=area(t),cache=join(root,'cache'),item=entryFor(cache,'p',[manifestEntry('p'),{path:'package/index.js',data:'one'}]),stageDir=join(root,'stage');
 const {bundleFiles}=extractBundle({stageDir,packages:{'node_modules/p':item},npmCache:cache});
 verifyBundleFiles(stageDir,bundleFiles);
 writeFileSync(join(stageDir,'node_modules/p/index.js'),'two');
 assert.throws(()=>verifyBundleFiles(stageDir,bundleFiles),/^Error: Bundle file changed before pack: node_modules\/p\/index\.js$/);
 rmSync(join(stageDir,'node_modules/p/index.js'));
 assert.throws(()=>verifyBundleFiles(stageDir,bundleFiles),/^Error: Bundle file changed before pack: node_modules\/p\/index\.js$/);
});
test('stage with a bundle removes its own stage folder when extraction fails',t=>{
 const {root}=bundledRepo(t),options=run1(t,{repoDir:root,bundle:true,maxBundleBytes:2**20,npmCache:join(area(t),'empty')});
 assert.throws(()=>stage(options),/Bundle cache entry missing/);assert.equal(existsSync(options.stageDir),false);
});
test('stage with a bundle refuses a relative npm cache path',t=>{
 const {root}=bundledRepo(t),options=run1(t,{repoDir:root,bundle:true,npmCache:'relative/cache'});
 assert.throws(()=>stage(options),/^Error: npmCache must be an absolute path$/);assert.equal(existsSync(options.stageDir),false);
});
test('a tarball whose few entries create many folders is charged for every folder',t=>{
 const root=area(t),cache=join(root,'cache'),entries=[manifestEntry('p')];
 for(let i=0;i<40;i++)entries.push({path:`package/d${i}/a/b/c/d/e/f/g/h/i/j.txt`,data:'x'});
 const item=entryFor(cache,'p',entries);
 assert.throws(()=>extractBundle({stageDir:join(root,'s1'),packages:{'node_modules/p':item},npmCache:cache,maxBundleBytes:2**20}),e=>e.message==='Bundle exceeds 1 GiB');
 extractBundle({stageDir:join(root,'s2'),packages:{'node_modules/p':item},npmCache:cache,maxBundleBytes:2**23});
});
test('folders count toward the 50000 entry cap and a path deeper than 32 folders is refused',t=>{
 const root=area(t),cache=join(root,'cache');
 const deep=entryFor(cache,'p',[manifestEntry('p'),{path:'package/'+Array.from({length:40},()=>'a').join('/')+'/x.txt',data:'x'}]);
 assert.throws(()=>extractBundle({stageDir:join(root,'s1'),packages:{'node_modules/p':deep},npmCache:cache}),/^Error: Bundle tarball unsafe: node_modules\/p\//);
 const packages={};
 for(let i=0;i<7;i++){const name='q'+i;packages['node_modules/'+name]=entryFor(cache,name,[manifestEntry(name),...Array.from({length:4000},(_,k)=>({path:`package/d${k}/f`}))]);}
 assert.throws(()=>extractBundle({stageDir:join(root,'s2'),packages,npmCache:cache}),/^Error: Bundle exceeds 50000 entries$/);
});
test('a lock key that hides node_modules inside a scope name takes its package name from the end',t=>{
 const root=area(t),cache=join(root,'cache'),item=entryFor(cache,'bar',[manifestEntry('bar')]);
 assert.throws(()=>extractBundle({stageDir:join(root,'stage'),packages:{'node_modules/@x-node_modules/bar':item},npmCache:cache}),/^Error: Bundle resolved URL mismatch: node_modules\/@x-node_modules\/bar$/);
 const packages={'node_modules/@x-node_modules/bar':{version:'1.0.0'},'node_modules/zeta/node_modules/inner':{version:'2.0.0'}};
 assert.deepEqual(flatDependencies(packages,{}).dependencies,{'@x-node_modules/bar':'1.0.0'});
 assert.throws(()=>flatDependencies({'node_modules/x/y':{version:'1.0.0'}},{}),/^Error: Unpinnable dependency: node_modules\/x\/y$/);
});
test('extractBundle refuses a cache entry that is a symbolic link or a FIFO without reading it',t=>{
 const root=area(t),cache=join(root,'cache'),good=tarBytes([manifestEntry('p')]),integrity=integrityOf(good),file=cachePath(cache,integrity);
 mkdirSync(dirname(file),{recursive:true});
 const item={version:'1.0.0',resolved:registryUrl('p','1.0.0'),integrity};
 symlinkSync('/dev/zero',file);
 assert.throws(()=>extractBundle({stageDir:join(root,'s1'),packages:{'node_modules/p':item},npmCache:cache}),/^Error: Bundle cache entry unsafe: node_modules\/p$/);
 rmSync(file);fs.writeFileSync(join(root,'real'),good);symlinkSync(join(root,'real'),file);
 assert.throws(()=>extractBundle({stageDir:join(root,'s2'),packages:{'node_modules/p':item},npmCache:cache}),/^Error: Bundle cache entry unsafe: node_modules\/p$/);
 rmSync(file);assert.equal(spawnSync('mkfifo',[file]).status,0);
 assert.throws(()=>extractBundle({stageDir:join(root,'s3'),packages:{'node_modules/p':item},npmCache:cache}),/^Error: Bundle cache entry unsafe: node_modules\/p$/);
});
test('a node_modules folder directly under the package, in any case or form, is refused; a deeper one is kept',t=>{
 const root=area(t),cache=join(root,'cache');let n=0;
 for(const path of ['package/NODE_MODULES/x/index.js','package/Node_Modules/x/index.js','package/node_moduleſ/x/index.js','package/node_modules/','package/node_modules'])
  assert.throws(()=>extractBundle({stageDir:join(root,'s'+n++),packages:{'node_modules/p':entryFor(cache,'p',[manifestEntry('p'),{path,...(path.endsWith('/')?{type:'5'}:{data:'x'})}])},npmCache:cache}),e=>e.message==='Bundle tarball unsafe: node_modules/p/'+path,path);
});
test('a node_modules folder deeper inside a package passes',t=>{
 const root=area(t),cache=join(root,'cache'),item=entryFor(cache,'p',[manifestEntry('p'),{path:'package/dist/node_modules/x/index.js',data:'x'}]);
 extractBundle({stageDir:join(root,'stage'),packages:{'node_modules/p':item},npmCache:cache});
 assert.ok(existsSync(join(root,'stage/node_modules/p/dist/node_modules/x/index.js')));
});
test('extraction never changes the process umask',t=>{
 const root=area(t),cache=join(root,'cache'),item=entryFor(cache,'p',[manifestEntry('p'),{path:'package/bin/run.js',data:'x',mode:0o755}]),original=process.umask,calls=[];
 process.umask=(...args)=>{calls.push(args);return original.apply(process,args);};
 try{extractBundle({stageDir:join(root,'stage'),packages:{'node_modules/p':item},npmCache:cache});}finally{process.umask=original;}
 assert.deepEqual(calls.filter(args=>args.length>0),[]);
 assert.equal(statSync(join(root,'stage/node_modules/p/bin/run.js')).mode&0o777,0o755);
});
test('pack with a bundle holds every lock package, matches bundleDependencies, and is byte-deterministic',t=>{
 const {root,cache,lock}=bundledRepo(t),one=run1(t,{repoDir:root,bundle:true,maxBundleBytes:2**20,npmCache:cache}),two=run1(t,{repoDir:root,bundle:true,maxBundleBytes:2**20,npmCache:cache});
 const a=pack(one),b=pack(two);assert.equal(a.sha256,b.sha256);
 const listing=spawnSync('tar',['-tzf',a.file],{encoding:'utf8',maxBuffer:2**24}).stdout.split('\n');
 for(const path of Object.keys(lock.packages).filter(Boolean))assert.ok(listing.includes('package/'+path+'/package.json'),path);
 assert.equal(a.bundle.packages,10);assert.ok(a.bundle.files>=22);assert.ok(a.bundle.bytes>0);
 assert.equal(a.files,collect({repoDir:root}).files.size);
});
function stubSpawn(t,change) {
 const original=childProcess.spawnSync;
 childProcess.spawnSync=(...args)=>change(original(...args),args);syncBuiltinESMExports();
 t.after(()=>{childProcess.spawnSync=original;syncBuiltinESMExports();});
}
test('pack refuses an npm pack result that lists a bundled file the stage lacks',t=>{
 const {root,cache}=bundledRepo(t);
 stubSpawn(t,r=>{if(r.stdout&&r.stdout.startsWith('[')){const info=JSON.parse(r.stdout);info[0].files.push({path:'node_modules/jose/extra.js'});return {...r,stdout:JSON.stringify(info)};}return r;});
 assert.throws(()=>pack(run1(t,{repoDir:root,bundle:true,maxBundleBytes:2**20,npmCache:cache})),/^Error: Bundle packed files differ from the staged bundle$/);
});
const bundledOptions=(t,ctx)=>run1(t,{repoDir:ctx.root,bundle:true,maxBundleBytes:2**20,npmCache:ctx.cache});
const rewriteList=(t,change)=>stubSpawn(t,r=>{if(r.stdout&&r.stdout.startsWith('[')){const info=JSON.parse(r.stdout);change(info[0]);return {...r,stdout:JSON.stringify(info)};}return r;});
test('pack refuses a tarball that lacks the main file, a bin target, the readme, or the license of a package',t=>{
 for(const missing of ['node_modules/jose/index.js','node_modules/jose/bin/x.js','node_modules/jose/README.md','node_modules/jose/LICENSE']) {
  const ctx=bundledRepo(t),original=childProcess.spawnSync;
  childProcess.spawnSync=(...args)=>{const r=original(...args);if(r.stdout&&r.stdout.startsWith('[')){const info=JSON.parse(r.stdout);info[0].files=info[0].files.filter(f=>f.path!==missing);return {...r,stdout:JSON.stringify(info)};}return r;};syncBuiltinESMExports();
  try{assert.throws(()=>pack(bundledOptions(t,ctx)),/^Error: Bundle packed files differ from the staged bundle$/,missing);}finally{childProcess.spawnSync=original;syncBuiltinESMExports();}
 }
});
test('pack accepts a package that npm drops a changelog from, and records the packed counts',t=>{
 const ctx=bundledRepo(t),result=pack(bundledOptions(t,ctx)),staged=Object.keys(ctx.lock.packages).length;
 const listing=spawnSync('tar',['-tzf',result.file],{encoding:'utf8',maxBuffer:2**24}).stdout.split('\n');
 assert.ok(!listing.includes('package/node_modules/jose/CHANGELOG.md'));assert.ok(listing.includes('package/node_modules/jose/README.md'));
 const inTar=listing.filter(p=>p.startsWith('package/node_modules/')&&!p.endsWith('/')).length;
 assert.equal(result.bundle.files,inTar);assert.equal(result.record.bundle.extractedFiles,inTar);assert.equal(result.record.bundle.extractedBytes,result.bundle.bytes);
 assert.ok(staged>0);
});
test('pack refuses a bundled file that changes after the staged files were verified',t=>{
 const ctx=bundledRepo(t),original=childProcess.spawnSync;
 childProcess.spawnSync=(...args)=>{if(args[0]==='npm'&&!args[1].includes('--dry-run'))writeFileSync(join(args[2].cwd,'node_modules/jose/index.js'),"module.exports='changed';\n");return original(...args);};syncBuiltinESMExports();
 try{assert.throws(()=>pack(bundledOptions(t,ctx)),/^Error: Bundle packed files differ from the staged bundle$/);}finally{childProcess.spawnSync=original;syncBuiltinESMExports();}
});
test('pack refuses an npm pack result that lacks the package.json of a lock package',t=>{
 const ctx=bundledRepo(t);rewriteList(t,info=>{info.files=info.files.filter(f=>f.path!=='node_modules/jose/package.json');});
 assert.throws(()=>pack(bundledOptions(t,ctx)),/^Error: Bundle packed files differ from the staged bundle$/);
});
test('pack refuses an npm pack result that lacks a staged bundled file it should have kept',t=>{
 const ctx=bundledRepo(t);rewriteList(t,info=>{info.files=info.files.filter(f=>f.path!=='node_modules/jose/index.js');});
 assert.throws(()=>pack(bundledOptions(t,ctx)),/^Error: Bundle packed files differ from the staged bundle$/);
});
test('pack refuses an npm pack result whose bundled names differ from bundleDependencies',t=>{
 for(const change of [info=>{info.bundled=[...info.bundled,'extra'];},info=>{info.bundled=info.bundled.slice(1);},info=>{delete info.bundled;}]) {
  const ctx=bundledRepo(t),original=childProcess.spawnSync;
  childProcess.spawnSync=(...args)=>{const r=original(...args);if(r.stdout&&r.stdout.startsWith('[')){const info=JSON.parse(r.stdout);change(info[0]);return {...r,stdout:JSON.stringify(info)};}return r;};syncBuiltinESMExports();
  try{assert.throws(()=>pack(bundledOptions(t,ctx)),/^Error: Bundle packed files differ from the staged bundle$/);}finally{childProcess.spawnSync=original;syncBuiltinESMExports();}
 }
});
test('pack refuses npm pack output that is not JSON',t=>{
 const ctx=bundledRepo(t);stubSpawn(t,(r,args)=>args[0]==='npm'?{...r,stdout:'not json at all'}:r);
 assert.throws(()=>pack(bundledOptions(t,ctx)),/^Error: npm pack output is not JSON$/);
});
test('npm pack runs with the update notifier off',t=>{
 const ctx=bundledRepo(t);let seen;stubSpawn(t,(r,args)=>{if(args[0]==='npm')seen=args[2].env;return r;});
 pack(bundledOptions(t,ctx));assert.equal(seen.npm_config_update_notifier,'false');
});
test('DISTRIBUTION.json of a bundled stage inventories the bundle and keeps node_modules out of files',t=>{
 const {root,cache,lock}=bundledRepo(t),options=run1(t,{repoDir:root,bundle:true,maxBundleBytes:2**20,npmCache:cache});
 stage(options);const record=JSON.parse(readFileSync(join(options.stageDir,'DISTRIBUTION.json')));
 assert.equal(record.bundle.packageCount,11);assert.equal(record.bundle.entries.length,11);
 assert.ok(record.bundle.extractedFiles>0);assert.ok(record.bundle.extractedBytes>0);
 const paths=record.bundle.entries.map(e=>e.path);assert.deepEqual(paths,[...paths].sort((a,b)=>a.localeCompare(b)));
 assert.deepEqual(record.bundle.entries[0],{path:paths[0],version:lock.packages[paths[0]].version,integrity:lock.packages[paths[0]].integrity,license:'MIT'});
 assert.ok(!record.files.some(f=>f.path.includes('node_modules')));
 assert.match(readFileSync(join(options.stageDir,'README.md'),'utf8'),/ship inside|ship with/);
});
test('the real closure passes the license gate and every recorded license is allowed',()=>{
 const {record}=real();assert.equal(record.bundle.packageCount,148);
 for(const entry of record.bundle.entries)assert.ok(licenseAllowed(entry.license),entry.path+' '+entry.license);
 assert.equal(record.bundle.entries.find(e=>e.path==='node_modules/type-fest')?.license,'(MIT OR CC0-1.0)');
});
test('pack refuses when npm pack output overflows its buffer',t=>{
 const {root,cache}=bundledRepo(t);
 stubSpawn(t,(r,args)=>args[0]==='npm'?{status:null,stdout:'',stderr:'',error:Object.assign(new Error('spawnSync npm ENOBUFS'),{code:'ENOBUFS'})}:r);
 assert.throws(()=>pack(run1(t,{repoDir:root,bundle:true,maxBundleBytes:2**20,npmCache:cache})),/^Error: npm pack output exceeds 64 MiB$/);
});
test('requireFreeSpace names the bound and passes when space is free',t=>{
 const parent=area(t);
 assert.throws(()=>requireFreeSpace(parent,2**60),e=>e.message.startsWith('12 GiB reserve plus 1073741824 GiB bound required'));
 requireFreeSpace(parent,0);
});
test('licenseAllowed accepts exactly the seven ids',()=>{
 for(const id of ['MIT','ISC','Apache-2.0','BSD-2-Clause','BSD-3-Clause','0BSD','BlueOak-1.0.0'])assert.equal(licenseAllowed(id),true,id);
 for(const id of ['GPL-3.0-only','mit','CC0-1.0'])assert.equal(licenseAllowed(id),false,id);
});
test('licenseAllowed reads OR as one allowed side and AND as every side',()=>{
 for(const v of ['(MIT OR CC0-1.0)','CC0-1.0 OR MIT','MIT AND ISC'])assert.equal(licenseAllowed(v),true,v);
 for(const v of ['CC0-1.0 OR GPL-3.0-only','MIT AND GPL-3.0-only'])assert.equal(licenseAllowed(v),false,v);
});
test('licenseAllowed binds AND tighter than OR and checks parentheses',()=>{
 for(const v of ['(MIT OR GPL-3.0-only) AND ISC','MIT OR GPL-3.0-only AND ISC'])assert.equal(licenseAllowed(v),true,v);
 for(const v of ['(GPL-3.0-only OR CC0-1.0) AND MIT','(MIT','MIT)','()'])assert.equal(licenseAllowed(v),false,v);
});
test('licenseAllowed refuses WITH, plus, and LicenseRef forms',()=>{
 for(const v of ['MIT WITH Classpath-exception-2.0','Apache-2.0 WITH LLVM-exception','MIT+','LicenseRef-x'])assert.equal(licenseAllowed(v),false,v);
});
test('licenseAllowed refuses missing, wrongly typed, lower case operator, long, and trailing text values',()=>{
 for(const v of [undefined,null,'','   ',123,'mit or isc','M'.repeat(201),'MIT ISC'])assert.equal(licenseAllowed(v),false,String(v));
});
test('collect with a bundle names the first bundled license that fails, and without a bundle does not check',t=>{
 const root=fixture(t),path=join(root,'package-lock.json'),lock=JSON.parse(readFileSync(path)),write=()=>writeFileSync(path,JSON.stringify(lock,null,2)+'\n');
 lock.packages['node_modules/tar'].license='GPL-3.0-only';write();
 assert.throws(()=>collect({repoDir:root,bundle:true}),/^Error: Bundled license not allowed: tar GPL-3.0-only$/);
 delete lock.packages['node_modules/tar'].license;write();
 assert.throws(()=>collect({repoDir:root,bundle:true}),/^Error: Bundled license not allowed: tar \(none\)$/);
 lock.packages['node_modules/ajv'].license='GPL-3.0-only';write();
 assert.throws(()=>collect({repoDir:root,bundle:true}),/^Error: Bundled license not allowed: ajv GPL-3.0-only$/);
 assert.doesNotThrow(()=>collect({repoDir:root}));
});
test('the release candidate description ends with the approved tagline',t=>{
 const {root}=betaStreamRecord(t,'unreleased');
 assert.ok(collect({repoDir:root,releaseCandidate:true}).manifest.description.endsWith(TAGLINE));
});

// Offline proofs: pack needs the cache, the install does not.
test('a bundled tarball installs offline with an empty npm cache and starts',{timeout:600000,skip:process.env.BOWERLOOM_PACK_INSTALL_PROOF!=='1'&&'set BOWERLOOM_PACK_INSTALL_PROOF=1'},t=>{
 const root=area(t),one=pack({repoDir:repo,stageDir:join(root,'stage'),outputDir:join(root,'out'),bundle:true,npmCache:defaultNpmCache()});
 const install=join(root,'prefix'),emptyCache=join(root,'empty-cache');mkdirSync(install);mkdirSync(emptyCache);writeFileSync(join(install,'.empty-npmrc'),'');
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,npm_config_userconfig:'/dev/null',npm_config_globalconfig:join(install,'.empty-npmrc'),npm_config_cache:emptyCache,npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_update_notifier:'false'};
 const npm=spawnSync('npm',['install','--prefix',install,'--offline','--ignore-scripts','--no-audit','--no-fund','--no-save',one.file],{cwd:install,env,encoding:'utf8',timeout:300000,maxBuffer:2**24});
 assert.equal(npm.status,0,npm.stderr||npm.stdout);
 const version=spawnSync(join(install,'node_modules/.bin/bowerloom'),['--version'],{env,encoding:'utf8',timeout:30000});
 assert.equal(version.status,0,version.stderr);
});

// Online proofs: public npm registry only.
const shrinkMap=(stageDir,prefix)=>Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(stageDir,'npm-shrinkwrap.json'))).packages).filter(([k])=>k).map(([k,v])=>[prefix+k,v.version]));
function walkInstalled(dir,rel,out={}) {
 for(const name of readdirSync(dir).sort()) {
  if(name.startsWith('.'))continue;
  for(const sub of name.startsWith('@')?readdirSync(join(dir,name)).map(n=>name+'/'+n):[name]) {
   const folder=join(dir,sub);out[rel+'/'+sub]=JSON.parse(readFileSync(join(folder,'package.json'),'utf8')).version;
   if(existsSync(join(folder,'node_modules')))walkInstalled(join(folder,'node_modules'),rel+'/'+sub+'/node_modules',out);
  }
 }
 return out;
}
function differences(installed,expected) {
 const list=[];for(const key of new Set([...Object.keys(installed),...Object.keys(expected)]))if(installed[key]!==expected[key])list.push(`${key}@${installed[key]??'(absent)'} expected ${expected[key]??'(absent)'}`);
 return list;
}
const online=process.env.BOWERLOOM_PACK_ONLINE_PROOF==='1'?{}:null;
// A skip inside a proof group that was asked for is a failure, so a requested proof never passes by skipping.
const proofRequested=process.env.BOWERLOOM_PACK_ONLINE_PROOF==='1'||process.env.BOWERLOOM_PACK_INSTALL_PROOF==='1';
const proofSkip=(t,message)=>{if(proofRequested)assert.fail('Requested proof did not run: '+message);t.skip(message);return null;};
function onlineContext(t) {
 try{requireFreeSpace(tmpdir(),4*(2**30+0.05*2**30));}catch(e){return proofSkip(t,e.message);}
 if(online.root)return online;
 const root=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-online-proof-')));chmodSync(root,0o700);online.root=root;
 online.pack=pack({repoDir:repo,stageDir:join(root,'stage'),outputDir:join(root,'out'),bundle:true,npmCache:defaultNpmCache()});
 const rc=join(root,'empty-npmrc');writeFileSync(rc,'');
 online.env=cache=>({PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,npm_config_userconfig:'/dev/null',npm_config_globalconfig:rc,npm_config_cache:cache,npm_config_ignore_scripts:'true',npm_config_update_notifier:'false'});
 return online;
}
test.after(()=>{if(online?.root)rmSync(online.root,{recursive:true,force:true});});
const onlineOptions={timeout:600000,skip:online?false:'set BOWERLOOM_PACK_ONLINE_PROOF=1'};
test('online 1: a local tarball install gets exactly the packed shrinkwrap versions',onlineOptions,t=>{
 const ctx=onlineContext(t);if(!ctx)return;
 const prefix=join(ctx.root,'local');mkdirSync(prefix);
 const npm=spawnSync('npm',['install','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund','--no-save','--loglevel=http',ctx.pack.file],{cwd:prefix,env:ctx.env(join(ctx.root,'cache-local')),encoding:'utf8',timeout:540000,maxBuffer:2**26});
 assert.equal(npm.status,0,npm.stderr||npm.stdout);ctx.localOutput=npm.stdout+npm.stderr;ctx.localPrefix=prefix;
 const expected=shrinkMap(join(ctx.root,'stage'),'node_modules/bowerloom/');
 const hidden=JSON.parse(readFileSync(join(prefix,'node_modules/.package-lock.json'),'utf8')).packages,fromLock={};
 for(const [k,v] of Object.entries(hidden))if(k.startsWith('node_modules/bowerloom/'))fromLock[k]=v.version;
 const walked=walkInstalled(join(prefix,'node_modules/bowerloom/node_modules'),'node_modules/bowerloom/node_modules');
 const walkDiff=differences(walked,expected);assert.deepEqual(walkDiff,[],'Installed packages differ from the shrinkwrap: '+walkDiff.join(', '));
 assert.ok(Object.keys(fromLock).length>0,'.package-lock.json lists no bundled package');
 const lockDiff=differences(fromLock,expected);assert.deepEqual(lockDiff,[],'Installed packages differ from the shrinkwrap: '+lockDiff.join(', '));
});
test('online 2: a global tarball install gets exactly the packed shrinkwrap versions and starts',onlineOptions,t=>{
 const ctx=onlineContext(t);if(!ctx)return;
 const prefix=join(ctx.root,'global');mkdirSync(prefix);
 const npm=spawnSync('npm',['install','--global','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund','--loglevel=http',ctx.pack.file],{cwd:prefix,env:ctx.env(join(ctx.root,'cache-global')),encoding:'utf8',timeout:540000,maxBuffer:2**26});
 assert.equal(npm.status,0,npm.stderr||npm.stdout);
 const walked=walkInstalled(join(prefix,'lib/node_modules/bowerloom/node_modules'),'node_modules/bowerloom/node_modules'),diff=differences(walked,shrinkMap(join(ctx.root,'stage'),'node_modules/bowerloom/'));
 assert.deepEqual(diff,[],'Installed packages differ from the shrinkwrap: '+diff.join(', '));
 const version=spawnSync(join(prefix,'bin/bowerloom'),['--version'],{env:ctx.env(join(ctx.root,'cache-global')),encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
});
test('online 3: the four reported packages are at the packed versions',onlineOptions,t=>{
 const ctx=onlineContext(t);if(!ctx)return;if(!ctx.localPrefix)return proofSkip(t,'online 1 did not run');
 const expected=shrinkMap(join(ctx.root,'stage'),'');
 for(const name of ['express','@langchain/core','@langchain/langgraph-checkpoint','@langchain/langgraph-sdk'])
  assert.equal(JSON.parse(readFileSync(join(ctx.localPrefix,'node_modules/bowerloom/node_modules',name,'package.json'),'utf8')).version,expected['node_modules/'+name],name);
});
test('online 4: the local install names no registry fetch',onlineOptions,t=>{
 const ctx=onlineContext(t);if(!ctx)return;if(ctx.localOutput===undefined)return proofSkip(t,'online 1 did not run');
 assert.ok(ctx.localOutput.split('\n').some(line=>line.includes('npm http')),'the install printed no http log line, so the next check proves nothing');
 assert.deepEqual(ctx.localOutput.split('\n').filter(line=>line.includes('registry.npmjs.org')),[]);
});
test('online 5: the installed CLI starts',onlineOptions,t=>{
 const ctx=onlineContext(t);if(!ctx)return;if(!ctx.localPrefix)return proofSkip(t,'online 1 did not run');
 const version=spawnSync(join(ctx.localPrefix,'node_modules/.bin/bowerloom'),['--version'],{env:ctx.env(join(ctx.root,'cache-local')),encoding:'utf8',timeout:30000});assert.equal(version.status,0,version.stderr);
});
