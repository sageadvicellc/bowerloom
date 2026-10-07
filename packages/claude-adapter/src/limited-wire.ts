// Fixed conservative candidate subset of 2.1.292 stream-json. No native fixture is qualified here.
// Unknown events/identity/tool/finality fields fail closed; registry custody is checked by the controller.
import { MODEL,NATIVE_VERSION,LIMITS,route,effort,inert,exact,digest,id } from './policy.js';
import { decodeEnvelope } from './wire.js';
import { requireLaunch,LaunchError } from './boundary.js';
import { LIMITED_POLICY,LIMITED_PROFILE_REVISION } from './limited-policy.js';
import { validateLimitedResponse } from './limited-protocol.js';
import { createHash } from 'node:crypto';
function fields(v:any,required:string[],optional:string[]=[]):void{requireLaunch(v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k)));}
export class LimitedClaudeWire {
 readonly #chunks:Buffer[]=[];#bytes=0;#closed=false;
 feed(data:Buffer):void{requireLaunch(!this.#closed&&Buffer.isBuffer(data)&&data.length<=LIMITS.stdoutBytes-this.#bytes);this.#bytes+=data.length;this.#chunks.push(Buffer.from(data));}
 finish(expected:unknown):any{
  requireLaunch(!this.#closed);this.#closed=true;
  try{
   const e=inert(expected);exact(e,['requestedRoute','requestRevision','parentOutputRevision','launchPlanRevision','qualificationRevision','ownerApprovalRevision']);const r=route(e.requestedRoute),raw=Buffer.concat(this.#chunks,this.#bytes);
   const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);requireLaunch(Buffer.from(text).equals(raw)&&!text.startsWith('\uFEFF'));
   const lines=text.endsWith('\n')?text.slice(0,-1).split('\n'):text.split('\n');requireLaunch(lines.length===3&&lines.every(l=>l.length>0));
   const [init,assistant,result]=lines.map(l=>decodeEnvelope(Buffer.from(l))) as any[];
   fields(init,['type','subtype','session_id','model','tools','mcp_servers'],['cwd','claude_code_version','permissionMode','apiKeySource','uuid','slash_commands','agents','skills','plugins','output_style','fast_mode_state']);
   requireLaunch(init.type==='system'&&init.subtype==='init'&&id(init.session_id)&&init.model===MODEL&&Array.isArray(init.tools)&&init.tools.length===0&&Array.isArray(init.mcp_servers)&&init.mcp_servers.length===0);
   for(const key of ['slash_commands','agents','skills','plugins'])if(Object.hasOwn(init,key))requireLaunch(Array.isArray(init[key])&&init[key].length===0);
   if(Object.hasOwn(init,'claude_code_version'))requireLaunch(init.claude_code_version===NATIVE_VERSION);if(Object.hasOwn(init,'permissionMode'))requireLaunch(init.permissionMode==='dontAsk');if(Object.hasOwn(init,'fast_mode_state'))requireLaunch(init.fast_mode_state==='off');
   fields(assistant,['type','message','parent_tool_use_id','session_id','uuid','request_id'],['timestamp']);requireLaunch(assistant.type==='assistant'&&assistant.parent_tool_use_id===null&&assistant.session_id===init.session_id&&id(assistant.uuid)&&id(assistant.request_id));
   const message=assistant.message;fields(message,['id','type','role','model','content','stop_reason','stop_sequence','usage'],['context_management']);requireLaunch(id(message.id)&&message.type==='message'&&message.role==='assistant'&&message.model===MODEL&&message.stop_sequence===null&&(message.stop_reason===null||message.stop_reason==='end_turn'));
   requireLaunch(Array.isArray(message.content)&&message.content.length===1);exact(message.content[0],['type','text']);requireLaunch(message.content[0].type==='text'&&typeof message.content[0].text==='string');
   fields(result,['type','subtype','is_error','num_turns','result','stop_reason','permission_denials','uuid','session_id'],['duration_ms','duration_api_ms','total_cost_usd','usage','modelUsage']);
   requireLaunch(result.type==='result'&&result.subtype==='success'&&result.is_error===false&&result.num_turns===1&&result.stop_reason==='end_turn'&&id(result.uuid)&&result.uuid!==assistant.uuid&&result.session_id===init.session_id&&Array.isArray(result.permission_denials)&&result.permission_denials.length===0&&result.result===message.content[0].text);
   if(Object.hasOwn(result,'modelUsage'))requireLaunch(result.modelUsage&&typeof result.modelUsage==='object'&&!Array.isArray(result.modelUsage)&&Object.keys(result.modelUsage).every(k=>k===MODEL));
   // ModelUsage, init.model and JSON text are never used as provider-model evidence.
   const output=decodeEnvelope(Buffer.from(result.result));const body={format:'bowerloom/claude-limited-response/v1',policyVersion:LIMITED_POLICY,...e,wireProfileRevision:LIMITED_PROFILE_REVISION,requested:{model:MODEL,effort:effort(r),nativeVersion:NATIVE_VERSION},provider:{model:message.model,sessionId:init.session_id,messageId:message.id,requestId:assistant.request_id,responseEvidenceSha256:createHash('sha256').update(raw).digest('hex')},output,appliedEffort:'unknown',strictPolicyAccepted:false,ordinaryQualification:false,retainedChargesMustRemain:true};return validateLimitedResponse({...body,revision:digest(body)},e);
  }catch{throw new LaunchError();}
 }
}
