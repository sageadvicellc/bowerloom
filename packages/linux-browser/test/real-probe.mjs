// Controller-owned acceptance probe. No run until its exact PLAN and scripts are independently approved.
import {readFile,writeFile,mkdir,chmod,realpath,statfs} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {LinuxBrowserExecutor} from '../../../dist/packages/linux-browser/src/index.js';
import {canonicalJson,digest} from '../../../dist/packages/contracts/src/index.js';
const check=(v,c)=>{if(!v)throw Error(c);};
const packet=resolve(process.argv[2]??'');check(process.argv.length===3,'PACKET_ARGUMENT_REQUIRED');
const bytes=await readFile(join(packet,'PLAN.json')),plan=JSON.parse(bytes),review=JSON.parse(await readFile(join(packet,'ROOT-REVIEW.json')));
check(review.approved&&review.planSHA256===createHash('sha256').update(bytes).digest('hex'),'ROOT_REVIEW_REQUIRED');
for(const pin of plan.files)check(digest(await readFile(pin.path))===pin.digest,'SOURCE_CHANGED');
const disk=await statfs(packet);check(disk.bavail*disk.bsize>12.1*2**30,'DISK_RESERVE');
await mkdir(plan.installation.stateRoot,{mode:0o700});await chmod(plan.installation.stateRoot,0o700);check(await realpath(plan.installation.stateRoot)===plan.installation.stateRoot,'STATE_PATH');
await writeFile(join(packet,'consumed'),'once',{flag:'wx',mode:0o600});
const e=await LinuxBrowserExecutor.open(plan.installation),content=await readFile(new URL('./fixture.html',import.meta.url),'utf8'),manifest=JSON.parse(e.manifest),scope={workspaceId:'synthetic-browser',runId:'package-proof-01',taskId:'test'},writeOperationKey=digest('package-proof-01'),operationId=digest(canonicalJson({scope,writeOperationKey})),at=Date.now();
const base={format:'trellis/test-request/v0.7-alpha',operationId,scope,candidateRevision:digest('synthetic-candidate'),ownerEpoch:1,writeRequestId:'synthetic-write',writeOperationKey,writeActionDigest:digest('synthetic-action'),manifest,manifestDigest:digest(e.manifest),artifact:{path:'metadata-only.html',content,digest:digest(content),bytes:Buffer.byteLength(content)}};
const request={...base,requestDigest:digest(canonicalJson(base)),launcherId:'package-proof',startedAtMs:at,deadlineMs:at+25000};let report,error,restartedReap=false;
try{report=await e.execute(request,new AbortController().signal);await (await LinuxBrowserExecutor.open(plan.installation)).reap(operationId);restartedReap=true;}catch(err){error=err.message;}
const result={at:new Date().toISOString(),operationId,manifest:e.manifest,report,error,restartedReap,passed:report?.exitCode===0&&report.checks.every(c=>c.passed)&&report.scratchRemoved&&restartedReap};await writeFile(join(packet,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:result.passed,error,checks:report?.checks}));process.exitCode=result.passed?0:1;
