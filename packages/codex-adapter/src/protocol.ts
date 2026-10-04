import { parseProposal } from '../../broker/src/index.js';
import { check,exact,object,strictJson } from './safe.js';
import { LIMITS } from './policy.js';
// Only proposal data returns to the broker; native tool invocations never authorize effects.
export class ProposalStream {
  readonly counts:Record<string,number>={};usage:Record<string,number>|null=null;
  #decoder=new TextDecoder('utf-8',{fatal:true});#buffer='';#thread=false;#turn=false;#done=false;#events=0;
  #proposal:string|null=null;#items=new Map<string,string>();
  feed(data:Buffer):void {
    this.#buffer+=this.#decoder.decode(data,{stream:true});
    check(Buffer.byteLength(this.#buffer)<=LIMITS.stdoutBytes,'STREAM_BOUND');
    for(;;){const i=this.#buffer.indexOf('\n');if(i<0)break;const line=this.#buffer.slice(0,i);this.#buffer=this.#buffer.slice(i+1);this.event(strictJson(line,LIMITS.stdoutBytes));}
  }
  event(value:unknown):void {
    check(++this.#events<=LIMITS.events&&!this.#done,'EXTRA_OR_EXCESS_EVENTS');const event=object(value);
    const known=['thread.started','turn.started','item.started','item.updated','item.completed','turn.completed'];
    const kind=known.includes(event.type)?event.type:'unexpected';this.counts[kind]=(this.counts[kind]??0)+1;
    if(kind==='thread.started'){exact(event,['type','thread_id']);check(!this.#thread&&!this.#turn&&typeof event.thread_id==='string'&&event.thread_id.length<=128,'THREAD_EVENT');this.#thread=true;}
    else if(kind==='turn.started'){exact(event,['type']);check(this.#thread&&!this.#turn,'TURN_EVENT');this.#turn=true;}
    else if(kind.startsWith('item.')){
      exact(event,['type','item']);check(this.#turn,'ITEM_BEFORE_TURN');const item=exact(event.item,['id','type','text']);
      check((item.type==='reasoning'||item.type==='agent_message')&&typeof item.id==='string'&&item.id.length<=128&&typeof item.text==='string','NATIVE_TOOL_AGENT_EFFECT_OR_UNKNOWN_ITEM');
      const old=this.#items.get(item.id);check(old===undefined||old===item.type,'ITEM_REUSED');this.#items.set(item.id,kind==='item.completed'?'completed':item.type);
      if(kind==='item.completed'&&item.type==='agent_message'){
        check(this.#proposal===null,'EXTRA_PROPOSAL');const parsed=strictJson(item.text,LIMITS.stdoutBytes);
        const canonical=JSON.stringify(parsed);parseProposal(canonical);this.#proposal=canonical;
      }
    }else if(kind==='turn.completed'){
      exact(event,['type','usage']);check(this.#turn&&this.#proposal!==null,'EARLY_COMPLETION');const usage=object(event.usage);
      check(['input_tokens','cached_input_tokens','output_tokens'].every(k=>Object.hasOwn(usage,k))&&Object.keys(usage).every(k=>['input_tokens','cached_input_tokens','output_tokens','cache_write_input_tokens','reasoning_output_tokens'].includes(k)),'USAGE_KEYS');
      check(Object.values(usage).every(v=>Number.isSafeInteger(v)&&v>=0),'USAGE_VALUES');this.usage={...usage};this.#done=true;
    }else check(false,'UNKNOWN_OR_FAILED_EVENT');
  }
  finish():string {
    this.#buffer+=this.#decoder.decode();check(this.#buffer.length===0&&this.#thread&&this.#turn&&this.#done&&this.#proposal!==null,'INCOMPLETE_STREAM');
    check([...this.#items.values()].every(v=>v==='completed'),'INCOMPLETE_ITEM');return this.#proposal;
  }
}
const string={type:'string'};
export const PROPOSAL_SCHEMA={type:'object',additionalProperties:false,
  required:['format','scope','requestId','candidateRevision','ownerEpoch','edit'],properties:{
    format:{type:'string',enum:['trellis/action/v0.7-alpha']},
    scope:{type:'object',additionalProperties:false,required:['workspaceId','runId','taskId'],properties:{workspaceId:string,runId:string,taskId:string}},
    requestId:string,candidateRevision:{type:'string',pattern:'^sha256:[a-f0-9]{64}$'},ownerEpoch:{type:'integer',minimum:1},
    edit:{type:'object',additionalProperties:false,required:['operation','path','expectedDigest','content'],properties:{
      operation:{type:'string',enum:['workspace.write']},path:string,expectedDigest:{type:['string','null']},content:string}}
  }};
