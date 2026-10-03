import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { ControlError, destruct } from '../../../packages/local-control/src/index.js';
export async function runDestructCommand(args:string[]):Promise<unknown>{
  try{
    const [name,team,...flags]=args;if(name!=='destruct'||!team)throw new ControlError('DESTRUCT_USAGE');
    const values=new Map<string,string>();for(let i=0;i<flags.length;i+=2){const k=flags[i],v=flags[i+1];if(!k||!['--root','--registry','--timeout-ms'].includes(k)||!v||v.startsWith('--')||values.has(k))throw new ControlError('DESTRUCT_USAGE');values.set(k,v);}
    const raw=values.get('--timeout-ms');if(raw!==undefined&&!/^[0-9]+$/.test(raw))throw new ControlError('DESTRUCT_USAGE');
    const result=await destruct({team,...(values.has('--root')?{root:values.get('--root')!}:{}),...(values.has('--registry')?{registry:values.get('--registry')!}:{}),...(raw!==undefined?{timeoutMs:Number(raw)}:{})});
    if(!result.complete)process.exitCode=2;return result;
  }catch(error){if(error instanceof ControlError)throw new DefinitionError(error.code,'The stop request is incomplete. Inspect the local registry. Unregistered work and other machines are outside this command.');throw error;}
}
