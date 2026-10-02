import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { RecipeService, validateRecipe } from '../packages/recipes/src/index.js';
import { digest } from '../packages/recipes/src/validation.js';
import { recipeInstallation } from '../apps/cli/src/recipe.js';
import { fixture, packet, spec } from './recipes-fixtures.js';
const prepare=async()=>{const f=fixture();await f.service.setup();const plan=await f.service.plan(packet());return{...f,plan};};
test('portable spec rejects host, escaping paths, mutable source revisions and extra authority',()=>{
  for(const change of [{...spec,sourceRevision:'main'},{...spec,token:'secret'},{...spec,github:{...spec.github,host:'attacker.invalid'}},
    {...spec,github:{...spec.github,draftPath:'../main.md'}},{...spec,github:{...spec.github,branchPrefix:'main'}},{...spec,github:{...spec.github,draftPath:'.github/workflows/publish.md'}}])assert.throws(()=>validateRecipe(change));
});
test('duplicate setup is idempotent; concurrent planning preserves one stable job',async()=>{
  const f=fixture();await Promise.all([f.service.setup(),f.service.setup()]);assert.equal(f.store.recipes.size,1);
  const outcomes=await Promise.allSettled([f.service.plan(packet()),f.service.plan(packet())]);assert.equal(f.store.jobs.size,1);
  assert.ok(outcomes.some(r=>r.status==='fulfilled'));assert.equal((await f.service.plan(packet())).jobId,[...f.store.jobs.keys()][0]);assert.deepEqual(f.github.calls,[]);
});
test('plan verifies exact GitHub evidence bytes and citations but does not infer claim truth',async()=>{
  const f=fixture();await f.service.setup();const bad=packet();bad.experiment.evidence[0]!.content='changed';bad.experiment.evidence[0]!.digest=digest('changed');
  await assert.rejects(f.service.plan(bad),{code:'SOURCE_DRIFT'});const unlinked=packet();unlinked.draft.markdown='The synthetic run took 12 ms.';
  await assert.rejects(f.service.plan(unlinked),{code:'UNLINKED_CLAIM'});assert.deepEqual(f.github.calls,[]);
});
test('approval pause survives a new service; exact approval creates one draft PR and repeat run does nothing',async()=>{
  const f=await prepare();assert.equal((await f.service.run(f.plan.jobId) as any).status,'WAITING_APPROVAL');assert.deepEqual(f.github.calls,[]);
  const fresh=new RecipeService(f.dependencies,f.checkpointer);await fresh.approve({jobId:f.plan.jobId,planDigest:f.plan.digest},f.credential);
  const result=await fresh.run(f.plan.jobId) as any;assert.equal(result.status,'DRAFT_PR_READY');assert.equal(result.job.pull.draft,true);
  assert.deepEqual(f.github.calls,['branch','file','pull']);await fresh.run(f.plan.jobId);assert.equal(f.github.calls.length,3);assert.equal(f.github.pulls.size,1);
  assert.equal(result.job.plan.metrics.reviewMinutes,null);assert.equal(result.comparisonGain,null);
});
test('impersonated issuer, stale digest and draft edits cannot reuse approval',async()=>{
  const f=await prepare();await assert.rejects(f.service.approve({jobId:f.plan.jobId,planDigest:f.plan.digest},{subject:'trusted-operator'}),{code:'APPROVAL_NOT_AUTHORIZED'});
  await assert.rejects(f.service.approve({jobId:f.plan.jobId,planDigest:digest('wrong')},f.credential),{code:'STALE_APPROVAL'});
  const changed=packet();changed.draft.title='Changed title';const revised=await f.service.plan(changed);
  await assert.rejects(f.service.approve({jobId:f.plan.jobId,planDigest:f.plan.digest},f.credential),{code:'STALE_APPROVAL'});
  await f.service.approve({jobId:revised.jobId,planDigest:revised.digest},f.credential);await assert.rejects(f.service.plan(packet()),{code:'PLAN_BUSY'});
  await f.service.cancel(revised.jobId);await assert.rejects(f.service.approve({jobId:revised.jobId,planDigest:revised.digest},f.credential),{code:'CANCELLED'});
  await f.service.run(revised.jobId);assert.deepEqual(f.github.calls,[]);
});
test('base drift after approval refuses before any GitHub mutation',async()=>{
  const f=await prepare();await f.service.approve({jobId:f.plan.jobId,planDigest:f.plan.digest},f.credential);f.github.refs.set('main','d'.repeat(40));
  await assert.rejects(f.service.run(f.plan.jobId),{code:'BASE_DRIFT'});assert.deepEqual(f.github.calls,[]);
});
for(const step of ['branch','file','pull'])test(`lost ${step} acknowledgement is held and read reconciliation never sends`,async()=>{
  const f=await prepare();await f.service.approve({jobId:f.plan.jobId,planDigest:f.plan.digest},f.credential);f.github.lostAfter=step;
  await assert.rejects(f.service.run(f.plan.jobId));const before=[...f.github.calls];assert.equal((await f.service.status(f.plan.jobId) as any).status,'NEEDS_RECONCILIATION');
  await f.service.run(f.plan.jobId);assert.deepEqual(f.github.calls,before);await f.service.reconcile(f.plan.jobId);assert.deepEqual(f.github.calls,before);
  await f.service.run(f.plan.jobId);assert.equal((await f.service.status(f.plan.jobId) as any).status,'DRAFT_PR_READY');
  assert.deepEqual(f.github.calls,['branch','file','pull']);
});
test('absent uncertain operation cannot be retried; cancellation preserves ambiguity',async()=>{
  const f=await prepare();await f.service.approve({jobId:f.plan.jobId,planDigest:f.plan.digest},f.credential);f.github.failBefore='branch';
  await assert.rejects(f.service.run(f.plan.jobId));await f.service.reconcile(f.plan.jobId);await f.service.run(f.plan.jobId);
  assert.deepEqual(f.github.calls,['branch']);assert.equal((await f.service.cancel(f.plan.jobId) as any).status,'CANCELLED_WITH_POSSIBLE_EFFECT');
});
test('one job updates the existing draft PR after another exact approval',async()=>{
  const f=await prepare();await f.service.approve({jobId:f.plan.jobId,planDigest:f.plan.digest},f.credential);await f.service.run(f.plan.jobId);
  const revised=packet();revised.draft.title='Revised measured result';revised.draft.markdown+='\nA caveat for review.';
  const p=await f.service.plan(revised);assert.equal(p.jobId,f.plan.jobId);assert.equal(p.existingPull,1);
  await f.service.run(p.jobId);assert.equal(f.github.calls.length,3);await f.service.approve({jobId:p.jobId,planDigest:p.digest},f.credential);await f.service.run(p.jobId);
  assert.deepEqual(f.github.calls,['branch','file','pull','file','update']);assert.equal(f.github.pulls.size,1);
  const result=await f.service.status(p.jobId) as any;assert.equal(result.job.history.length,1);assert.equal(result.job.pull.title,revised.draft.title);
});
test('a PR made ready or closed is never adopted for update',async()=>{
  const f=await prepare();await f.service.approve({jobId:f.plan.jobId,planDigest:f.plan.digest},f.credential);await f.service.run(f.plan.jobId);
  f.github.pulls.get(f.plan.branch)!.draft=false;const revised=packet();revised.draft.title='New';await assert.rejects(f.service.plan(revised),{code:'PULL_DRIFT'});
});
test('two simultaneous runners do not send duplicate effects',async()=>{
  const f=await prepare();await f.service.approve({jobId:f.plan.jobId,planDigest:f.plan.digest},f.credential);
  const out=await Promise.allSettled([f.service.run(f.plan.jobId),f.service.run(f.plan.jobId)]);
  assert.equal(out.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(f.github.calls,['branch','file','pull']);
});
test('private installation seals repository, paths and operator approval instead of accepting tool authority',()=>{
  const v={format:'trellis/recipe-installation/v1',recipe:spec,postgres:{host:'127.0.0.1',port:56582,database:'trellis_test',user:'postgres',passwordFile:'/private/password.json',controlSchema:'trellis_recipe',checkpointSchema:'trellis_recipe_checkpoints'},github:{tokenFile:'/private/token.json'},approval:{subject:'operator',enabled:false}};
  assert.equal(recipeInstallation(v).approval.enabled,false);assert.throws(()=>recipeInstallation({...v,approval:{subject:'operator',enabled:false,token:'x'}}));
  assert.throws(()=>recipeInstallation({...v,postgres:{...v.postgres,host:'remote.invalid'}}));
});
for(const enabled of [false,true])test(`tracing ${enabled?'enabled refuses safely':'disabled executes'} with zero optional transport sends`, {timeout:15000},async()=>{
  const code=`const sends=[];globalThis.fetch=async(...a)=>{sends.push(String(a[0]));return new Response('{}')};await fetch('https://positive-control.invalid');const positive=sends.length;sends.length=0;const {fixture,packet}=await import('./dist/tests/recipes-fixtures.js');const f=fixture();await f.service.setup();const p=await f.service.plan(packet());let error=null;try{await f.service.run(p.jobId);await f.service.approve({jobId:p.jobId,planDigest:p.digest},f.credential);await f.service.run(p.jobId);}catch(e){error=e.code}await new Promise(r=>setTimeout(r,400));process.stdout.write(JSON.stringify({positive,sends,error,status:(await f.service.status(p.jobId)).status}));`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{...process.env,LANGSMITH_TRACING:String(enabled),LANGCHAIN_TRACING_V2:String(enabled),LANGCHAIN_TRACING:'false',LANGSMITH_API_KEY:'synthetic-not-a-key'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;if(stdout.length>16384)child.kill('SIGKILL');});child.stderr.on('data',b=>{stderr+=b;if(stderr.length>16384)child.kill('SIGKILL');});
  const timer=setTimeout(()=>child.kill('SIGKILL'),10000);try{const [code]=await once(child,'exit');assert.equal(code,0,stderr);const result=JSON.parse(stdout);assert.equal(result.positive,1);assert.deepEqual(result.sends,[]);assert.equal(result.error,enabled?'AMBIENT_TRACING_REFUSED':null);assert.equal(result.status,enabled?'WAITING_APPROVAL':'DRAFT_PR_READY');}finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');}
});
