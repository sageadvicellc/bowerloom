import { openControlOwner } from '../../../dist/packages/local-control/src/index.js';
import { startGuardian } from '../../../dist/packages/codex-adapter/src/supervisor.js';
let owner,child;
process.on('message',async message=>{
  if(message.type==='start')try{
    owner=openControlOwner(message.installation,'graph',message.registry);
    let ready;const started=new Promise(r=>ready=r);
    owner.onStop(async()=>{await started;let done=null,confirmed=true;try{if(child){await child.terminate();done=await child.done;}}catch{confirmed=false;}await owner.finish({done,process:child?.identity??null},confirmed);process.send({type:'stopped'});});
    process.send({type:'registered'});
    if(message.delay)await new Promise(r=>setTimeout(r,message.delay));
    ready();owner.guard();child=await startGuardian({executable:process.execPath,argv:['-e','setInterval(()=>{},1000)'],cwd:message.root,env:{},seconds:20,stdoutBytes:65536,stderrBytes:1024},owner.signal,()=>{});
    child.done.catch(()=>{});ready();process.send({type:'started',pid:child.identity.pid,guardianPid:child.guardianPid,id:owner.id});
  }catch(e){await owner?.finish({noChild:!child},!child);process.send({type:'refused',code:e.code});}
  if(message.type==='close'){await child?.terminate();await owner?.finish({closed:true});process.exit(0);}
});
