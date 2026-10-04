import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { ControlError, planControl, registerControl, type ControlInput } from '../../../packages/local-control/src/index.js';
export async function runControlCommand(args:string[]):Promise<unknown>{
  try{
    const [name,operation,...flags]=args;if(name!=='control'||!['plan','register'].includes(operation??''))throw new ControlError('CONTROL_USAGE');
    const values=new Map<string,string>();for(let i=0;i<flags.length;i+=2){const k=flags[i],v=flags[i+1];if(!k||!['--root','--team','--spec','--adapter','--installation','--registry','--approve'].includes(k)||!v||v.startsWith('--')||values.has(k))throw new ControlError('CONTROL_USAGE');values.set(k,v);}
    if(!values.has('--root')||!values.has('--team')||!values.has('--spec')||(operation==='register')!==values.has('--approve'))throw new ControlError('CONTROL_USAGE');
    const input:ControlInput={root:values.get('--root')!,team:values.get('--team')!,spec:values.get('--spec')!,...(values.has('--adapter')?{adapter:values.get('--adapter') as 'graph'|'recipe'}:{}),...(values.has('--installation')?{installation:values.get('--installation')!}:{}),...(values.has('--registry')?{registry:values.get('--registry')!}:{})};
    return operation==='plan'?planControl(input):registerControl(input,values.get('--approve')!);
  }catch(error){if(error instanceof ControlError)throw new DefinitionError(error.code,'Control enrollment stopped. Read the proposed root, team, installation, and registry before another attempt.');throw error;}
}
