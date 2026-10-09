#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,realpathSync,readFileSync,writeFileSync,mkdirSync,statfsSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {verifyInstalledContainerProof} from './installed-container-guard.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('INSTALLED_CONTAINER_PREPARATION_REFUSED');};
const helperRoot=dirname(fileURLToPath(import.meta.url));
function real(path,directory=false){if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||realpathSync(path)!==path)fail();const s=lstatSync(path);if(s.isSymbolicLink()||(directory?!s.isDirectory():!s.isFile())||(!directory&&(s.nlink!==1||s.size>64*1024*1024)))fail();return path;}
/** Offline preparation only. Running the generated proof remains an explicit root action. */
export function prepareInstalledContainerProof({artifactFile,artifactSha256,repoDir,proofRoot,imageEvidenceDir}){
 if(Object.keys(process.env).some(name=>/^NODE_/i.test(name)&&process.env[name]!==undefined&&!(name==='NODE_TEST_CONTEXT'&&process.env[name]==='child-v8')))fail();
 const repo=real(repoDir,true),artifact=real(artifactFile),images=real(imageEvidenceDir,true);
 if(!/^[a-f0-9]{64}$/.test(artifactSha256)||hash(readFileSync(artifact))!==artifactSha256)fail();
 if(typeof proofRoot!=='string'||!isAbsolute(proofRoot)||resolve(proofRoot)!==proofRoot||existsSync(proofRoot)||proofRoot.startsWith(repo+sep)||repo.startsWith(proofRoot+sep)||proofRoot===repo)fail();
 real(dirname(proofRoot),true);const disk=statfsSync(dirname(proofRoot));if(disk.bavail*disk.bsize<12.7*2**30)fail();
 const sourceFiles=[['driver/container-proof-driver.mjs',join(helperRoot,'container-proof-driver.mjs')],['driver/installed-container-guard.mjs',join(helperRoot,'installed-container-guard.mjs')],...['binding','catalog','declaration'].map(k=>[`fixtures/stdio-${k}.json`,join(repo,'packages/mcp-connections/test/fixtures',`stdio-${k}.json`)]),...['config','index','manifest'].map(k=>[`evidence/image-${k}.json`,join(images,`image-${k}.json`)])];
 const supplied=sourceFiles.map(([path,file])=>({path,bytes:readFileSync(real(file))}));
 // Pin the already-qualified cached Linux arm64 image. There is no pull, retag or image build.
 const imageIndex=supplied.find(f=>f.path==='evidence/image-index.json');if(hash(imageIndex.bytes)!=='64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4')fail();
 const node=realpathSync(process.execPath),npm=realpathSync(join(dirname(node),'npm'));
 const trustedHome=homedir(),env={HOME:trustedHome,PATH:dirname(node)+':/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',NODE_V8_COVERAGE:undefined,npm_config_userconfig:'/dev/null',npm_config_globalconfig:join(proofRoot,'empty-npmrc'),npm_config_offline:'true',npm_config_ignore_scripts:'true'};
 mkdirSync(proofRoot,{mode:0o700});for(const name of ['driver','fixtures','evidence','install'])mkdirSync(join(proofRoot,name),{mode:0o700});
 writeFileSync(join(proofRoot,'empty-npmrc'),'',{mode:0o600,flag:'wx'});writeFileSync(join(proofRoot,'artifact.tgz'),readFileSync(artifact),{mode:0o600,flag:'wx'});
 // Extract only the record from the pinned artifact before npm writes any installed package bytes.
 const extracted=spawnSync('/usr/bin/tar',['-xOf',join(proofRoot,'artifact.tgz'),'package/DISTRIBUTION.json'],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:10000,maxBuffer:2**20});if(extracted.status!==0)fail();
 const distributionSha256=hash(Buffer.from(extracted.stdout));
 const installed=spawnSync(node,[npm,'install','--prefix',join(proofRoot,'install'),'--offline','--ignore-scripts','--no-audit','--no-fund','--no-save',join(proofRoot,'artifact.tgz')],{cwd:join(proofRoot,'install'),env,encoding:'utf8',timeout:120000,maxBuffer:2**20});
 writeFileSync(join(proofRoot,'evidence','offline-install.log'),installed.stdout+'\n'+installed.stderr,{mode:0o600,flag:'wx'});if(installed.status!==0)fail();
 for(const item of supplied)writeFileSync(join(proofRoot,item.path),item.bytes,{mode:0o600,flag:'wx'});
 const launcher=`import {readFileSync,writeFileSync} from 'node:fs';import {fileURLToPath,pathToFileURL} from 'node:url';import {join} from 'node:path';import {installProofResolutionGuard} from './installed-container-guard.mjs';const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\\/$/,'');const configPath=join(root,'proof.json');const pin=installProofResolutionGuard(configPath,{provenanceFile:join(root,'evidence','runner-provenance.jsonl')});if(process.env.BOWERLOOM_MCP_CONTAINER_POSTGRES_PROOF!=='trellis-alpha-proof@127.0.0.1:56582')throw Error('INSTALLED_CONTAINER_PROOF_NOT_ENABLED');process.env.BOWERLOOM_MCP_CONTAINER_EVIDENCE=join(root,'evidence');const runtime=await import(pin.moduleUrl);const {default:pg}=await import(pin.pgUrl);const {registerContainerPostgresProof}=await import('./container-proof-driver.mjs');registerContainerPostgresProof({runtime,pg,moduleUrl:pin.moduleUrl,pgUrl:pin.pgUrl,fixturesDir:join(root,'fixtures'),installedGuard:{moduleUrl:new URL('./installed-container-guard.mjs',import.meta.url).href,configPath,proofRoot:root,guardianPath:pin.guardianPath}});writeFileSync(join(root,'evidence','installed-provenance.json'),JSON.stringify({...pin,unregister:undefined},null,2)+'\\n',{mode:0o600});`;
 writeFileSync(join(proofRoot,'driver/run-proof.mjs'),launcher,{mode:0o600,flag:'wx'});supplied.push({path:'driver/run-proof.mjs',bytes:Buffer.from(launcher)});
 const config={format:'bowerloom/installed-container-proof/v1',proofRoot,checkout:repo,installedRoot:join(proofRoot,'install/node_modules/bowerloom'),artifactSha256,distributionSha256,files:supplied.map(({path,bytes})=>({path,sha256:hash(bytes)}))};
 const configPath=join(proofRoot,'proof.json');writeFileSync(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
 const verified=verifyInstalledContainerProof(configPath,{});
 return {proofRoot,configPath,launcher:join(proofRoot,'driver/run-proof.mjs'),node,artifactSha256,distributionSha256,inventoryCount:verified.inventoryCount,offlineInstall:true,proofRun:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2),values={};for(let i=0;i<args.length;i+=2){if(!['--artifact','--sha256','--repo','--root','--images'].includes(args[i])||!args[i+1]||values[args[i]])fail();values[args[i]]=args[i+1];}console.log(JSON.stringify(prepareInstalledContainerProof({artifactFile:values['--artifact'],artifactSha256:values['--sha256'],repoDir:values['--repo'],proofRoot:values['--root'],imageEvidenceDir:values['--images']}),null,2));}catch{console.error('INSTALLED_CONTAINER_PREPARATION_REFUSED');process.exitCode=1;}
}
