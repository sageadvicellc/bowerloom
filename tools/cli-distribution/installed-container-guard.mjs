import {createHash} from 'node:crypto';
import {lstatSync,realpathSync,readFileSync,readdirSync,appendFileSync,existsSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire,registerHooks} from 'node:module';
export const CONTAINER_RUNTIME_FILES=Object.freeze(['container.js','container-supervisor.js','container-guardian.js','container-policy.js','container-guardian-provenance.js','container-journal-snapshot.js','darwin-boot-session.js'].map(name=>'dist/packages/mcp-connections/src/'+name));
const fail=()=>{throw Error('INSTALLED_CONTAINER_PROOF_REFUSED');};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,path)=>path===root||path.startsWith(root+sep);
function canonical(path,directory=false){
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||realpathSync(path)!==path)fail();
 const s=lstatSync(path);if(s.isSymbolicLink()||(directory?!s.isDirectory():!s.isFile()))fail();return path;
}
function regular(root,path,max=4*1024*1024){
 if(typeof path!=='string'||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..')||isAbsolute(path))fail();
 const full=join(root,path);if(!inside(root,full))fail();canonical(full);const s=lstatSync(full);if(s.nlink!==1||s.size>max)fail();return readFileSync(full);
}
function closed(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail();}
function inventoryFiles(root){
 const paths=[];function visit(directory){for(const name of readdirSync(directory)){if(name==='node_modules')continue;const full=join(directory,name),s=lstatSync(full);if(s.isSymbolicLink())fail();if(s.isDirectory())visit(full);else if(s.isFile()&&s.nlink===1)paths.push(relative(root,full).split(sep).join('/'));else fail();}}visit(root);return paths.sort();
}
function dependencyTree(root){
 // npm's generated .bin symlinks are never module resolution targets for this proof.
 function visit(directory){for(const name of readdirSync(directory)){if(name==='.bin')continue;const full=join(directory,name),s=lstatSync(full);if(s.isSymbolicLink())fail();if(s.isDirectory())visit(full);else if(!s.isFile()||s.nlink!==1)fail();}}visit(root);
}
export function verifyInstalledContainerProof(configPath,environment=process.env){
 try{
  if(Object.keys(environment).some(name=>/^NODE_/i.test(name)&&environment[name]!==undefined&&!(name==='NODE_TEST_CONTEXT'&&environment[name]==='child-v8')))fail();
  const path=canonical(configPath),raw=readFileSync(path);if(raw.length>1024*1024)fail();const config=JSON.parse(raw);
  closed(config,['format','proofRoot','checkout','installedRoot','artifactSha256','distributionSha256','files']);
  if(config.format!=='bowerloom/installed-container-proof/v1'||!/^([a-f0-9]{64})$/.test(config.artifactSha256)||!/^([a-f0-9]{64})$/.test(config.distributionSha256))fail();
  const proofRoot=canonical(config.proofRoot,true),checkout=config.checkout,installedRoot=canonical(config.installedRoot,true);
  if(typeof checkout!=='string'||!isAbsolute(checkout)||resolve(checkout)!==checkout)fail();
  if(inside(checkout,proofRoot)||inside(proofRoot,checkout)||!inside(proofRoot,path)||!inside(proofRoot,installedRoot)||!installedRoot.endsWith('/install/node_modules/bowerloom'))fail();
  const owner=lstatSync(proofRoot);if(owner.uid!==process.getuid?.()||(owner.mode&0o777)!==0o700)fail();
  if(!Array.isArray(config.files)||config.files.length!==9)fail();
  const names=new Set();for(const item of config.files){closed(item,['path','sha256']);if(names.has(item.path)||!/^([a-f0-9]{64})$/.test(item.sha256)||hash(regular(proofRoot,item.path))!==item.sha256)fail();names.add(item.path);}
  const expectedFiles=['driver/container-proof-driver.mjs','driver/installed-container-guard.mjs','driver/run-proof.mjs','fixtures/stdio-binding.json','fixtures/stdio-catalog.json','fixtures/stdio-declaration.json','evidence/image-config.json','evidence/image-index.json','evidence/image-manifest.json'];
  if([...names].sort().join(',')!==expectedFiles.sort().join(','))fail();
  if(hash(regular(proofRoot,'artifact.tgz',64*1024*1024))!==config.artifactSha256)fail();
  const distributionBytes=regular(installedRoot,'DISTRIBUTION.json');if(hash(distributionBytes)!==config.distributionSha256)fail();const distribution=JSON.parse(distributionBytes);
  if(distribution.schema!=='bowerloom/cli-distribution/v0.1'||distribution.name!=='bowerloom'||distribution.private!==true||!Array.isArray(distribution.files))fail();
  const expected=new Set(['DISTRIBUTION.json']);for(const item of distribution.files){if(!item||expected.has(item.path)||!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^([a-f0-9]{64})$/.test(item.sha256))fail();const bytes=regular(installedRoot,item.path);if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)fail();expected.add(item.path);}
  if(inventoryFiles(installedRoot).join(',')!==[...expected].sort().join(','))fail();
  for(const required of ['package.json','npm-shrinkwrap.json','dist/packages/mcp-connections/src/index.js',...CONTAINER_RUNTIME_FILES])if(!expected.has(required))fail();
  const manifest=JSON.parse(regular(installedRoot,'package.json'));if(manifest.name!=='bowerloom'||manifest.private!==true||manifest.scripts||manifest.dependencies?.pg!=='8.16.3')fail();
  const modules=dirname(installedRoot);dependencyTree(modules);
  const resolver=createRequire(join(installedRoot,'package.json')),pgPath=canonical(resolver.resolve('pg'));
  if(!inside(modules,pgPath))fail();
  const pgManifest=JSON.parse(readFileSync(canonical(resolver.resolve('pg/package.json'))));if(pgManifest.version!==manifest.dependencies.pg)fail();
  for(const [name,version]of Object.entries(manifest.dependencies)){
   // Some dependencies expose subpaths only. Package identity does not require a root entrypoint.
   if(!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name))fail();
   const candidates=resolver.resolve.paths(name);if(!candidates)fail();
   const manifestPath=candidates.map(directory=>join(directory,name,'package.json')).find(path=>existsSync(path));
   if(!manifestPath||!inside(modules,manifestPath))fail();
   const installed=JSON.parse(readFileSync(canonical(manifestPath)));if(installed.name!==name||installed.version!==version)fail();
  }
  return Object.freeze({proofRoot,checkout,installedRoot,modules,moduleUrl:pathToFileURL(join(installedRoot,'dist/packages/mcp-connections/src/index.js')).href,pgUrl:pathToFileURL(pgPath).href,guardianPath:join(installedRoot,'dist/packages/mcp-connections/src/container-guardian.js'),artifactSha256:config.artifactSha256,distributionSha256:config.distributionSha256,inventoryCount:distribution.files.length});
 }catch{fail();}
}
export function installProofResolutionGuard(configPath,{provenanceFile}={}){
 const verified=verifyInstalledContainerProof(configPath);
 if(typeof provenanceFile!=='string'||!isAbsolute(provenanceFile)||resolve(provenanceFile)!==provenanceFile||!inside(verified.proofRoot,provenanceFile)||realpathSync(dirname(provenanceFile))!==dirname(provenanceFile))fail();
 if(existsSync(provenanceFile)){canonical(provenanceFile);const stat=lstatSync(provenanceFile);if(stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o777)!==0o600)fail();}
 const allowedDriver=join(verified.proofRoot,'driver','container-proof-driver.mjs');
 const record=value=>appendFileSync(provenanceFile,JSON.stringify(value)+'\n',{mode:0o600});
 record({event:'verified',pid:process.pid,...verified});
 const hook=registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.startsWith('node:'))return result;if(!result.url.startsWith('file:'))fail();const path=canonical(fileURLToPath(result.url));if(!inside(verified.modules,path)&&path!==allowedDriver)fail();record({event:'resolved',pid:process.pid,url:result.url,parentURL:context.parentURL??null});return result;}});
 return {...verified,unregister:()=>hook.deregister()};
}
