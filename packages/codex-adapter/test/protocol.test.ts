import test from 'node:test';
import assert from 'node:assert/strict';
import { ProposalStream } from '../src/protocol.js';
import { execArgs,childEnvironment } from '../src/installation.js';
import { CodexAdapter,CodexObservationReader,MODEL_ROUTE } from '../src/index.js';
import { accountBindingDigest } from '../src/observation.js';
export const proposal={format:'trellis/action/v0.7-alpha',scope:{workspaceId:'w',runId:'r',taskId:'t'},requestId:'q',candidateRevision:'sha256:'+'a'.repeat(64),ownerEpoch:1,edit:{operation:'workspace.write',path:'demo.txt',expectedDigest:null,content:'Synthetic demo'}};
const events=()=>[{type:'thread.started',thread_id:'synthetic'},{type:'turn.started'},{type:'item.completed',item:{id:'i',type:'agent_message',text:JSON.stringify(proposal)}},{type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:0,output_tokens:20,reasoning_output_tokens:0}}];
test('single strict proposal is broker-compatible across arbitrary byte chunks',()=>{const s=new ProposalStream(),bytes=Buffer.from(events().map(e=>JSON.stringify(e)+'\n').join(''));for(const b of bytes)s.feed(Buffer.from([b]));assert.deepEqual(JSON.parse(s.finish()),proposal);assert.equal(s.usage?.input_tokens,100);});
test('tools agents effects errors extra turns and duplicate keys are refused',()=>{
  for(const kind of ['command_execution','file_change','collab_tool_call','mcp_tool_call','web_search','error','unknown']){const s=new ProposalStream();s.event(events()[0]);s.event(events()[1]);assert.throws(()=>s.event({type:'item.completed',item:{id:'tool',type:kind,text:'PRIVATE'}}));assert.doesNotMatch(JSON.stringify(s.counts),/PRIVATE/);}
  const s=new ProposalStream();events().forEach(e=>s.event(e));assert.throws(()=>s.event({type:'turn.started'}));assert.equal(s.usage?.input_tokens,100);
  assert.throws(()=>new ProposalStream().feed(Buffer.from('{"type":"turn.started","type":"turn.started"}\n')));
});
test('unsafe proposal path, extra content, nonfinite usage, unfinished items and partial stream fail',()=>{
  for(const p of [{...proposal,extra:true},{...proposal,edit:{...proposal.edit,path:'../private'}}]){const s=new ProposalStream();s.event(events()[0]);s.event(events()[1]);assert.throws(()=>s.event({type:'item.completed',item:{id:'i',type:'agent_message',text:JSON.stringify(p)}}));}
  const s=new ProposalStream();events().slice(0,3).forEach(e=>s.event(e));assert.throws(()=>s.event({type:'turn.completed',usage:{input_tokens:Infinity,cached_input_tokens:0,output_tokens:1}}));
  const t=new ProposalStream();events().slice(0,2).forEach(e=>t.event(e));t.event({type:'item.started',item:{id:'unfinished',type:'reasoning',text:'synthetic'}});events().slice(2).forEach(e=>t.event(e));assert.throws(()=>t.finish());
  const u=new ProposalStream();u.feed(Buffer.from('{'));assert.throws(()=>u.finish());assert.throws(()=>new ProposalStream().feed(Buffer.from([0xff])));
});
test('public controls preserve homes and remove injected environment',()=>{
  const before={home:process.env.HOME,codexHome:process.env.CODEX_HOME};const env=childEnvironment();
  assert.equal(env.HOME,before.home);assert.equal(env.CODEX_HOME,before.codexHome);assert.equal(env.CODEX_EXEC_SERVER_URL,'none');assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.NODE_OPTIONS,undefined);
  const args=execArgs('/synthetic-owned','/synthetic-schema');for(const a of ['--ignore-user-config','--ignore-rules','--strict-config','--ephemeral','model_reasoning_effort="low"','gpt-6-sol'])assert.ok(args.includes(a));
  assert.equal(args.filter(a=>a==='-m').length,1);assert.equal(args[args.indexOf('-m')+1],'gpt-6-sol');
  assert.deepEqual(args.filter(a=>a.startsWith('model_reasoning_effort=')),['model_reasoning_effort="low"']);
  assert.ok(!args.includes('gpt-5.5')&&!args.includes('gpt-5.6-sol')&&!args.includes('gpt-6.1-sol'));
});
test('invalid routes, cancelled signals, aliases and unpinned installation reject without any launch',async()=>{
  const installation={nativePath:'/synthetic-nonexistent',nativeSha256:'invalid',version:'0.157.0' as const,workRoot:'/synthetic-nonexistent'};
  const binding={canonicalAccountId:'canonical',aliases:['synthetic'],providerAccountSha256:accountBindingDigest('synthetic'),requiredWindows:['primary' as const],optionalWindows:['secondary' as const]};
  const a=new CodexAdapter({installation,binding,accountAlias:'synthetic'});const task={launcherId:'launcher',taskInput:'synthetic',modelRoute:MODEL_ROUTE};
  for(const modelRoute of ['paid','codex:gpt-5.5:low','codex:gpt-5.6-sol:low','codex:gpt-6.1-sol:low','codex:gpt-6-sol:medium'])await assert.rejects(a.start({...task,modelRoute},new AbortController().signal),/UNSUPPORTED_ROUTE/);const cancelled=new AbortController();cancelled.abort();await assert.rejects(a.start(task,cancelled.signal));
  await assert.rejects(a.start(task,new AbortController().signal),/UNSUPPORTED_BINARY/);
  await assert.rejects(new CodexObservationReader(installation,binding).read('worker-controlled-other-alias'),/UNKNOWN_ACCOUNT_ALIAS/);
});
