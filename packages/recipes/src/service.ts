import { Annotation, Command, END, START, StateGraph, interrupt } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { getCurrentRunTree, traceable } from 'langsmith/traceable';
import { RecipeError } from './types.js';
import type { ApprovalBinding, Job, Plan, RecipeDependencies, RecipeSpec, Step, StepState, WriteReceipt } from './types.js';
import { bodyFor, canonicalJson, checkPull, clone, contentFor, digest, fail, hash, id, inputs, jobId, planDigest, same, specCopy, status } from './validation.js';
const steps: Step[] = ['branch','file','pull'];
const ready = (): StepState => ({ status:'READY',claimedAt:null,completedAt:null,reason:null });
const State = Annotation.Root({ planDigest: Annotation<string>(), stopped: Annotation<boolean>() });
export class RecipeService {
  readonly #spec: RecipeSpec; readonly #now: () => number;
  constructor(readonly dependencies: RecipeDependencies, readonly checkpointer: BaseCheckpointSaver) {
    this.#spec = specCopy(dependencies.allowedRecipe); this.#now = dependencies.now ?? Date.now;
    if (dependencies.github.owner !== this.#spec.github.owner || dependencies.github.repo !== this.#spec.github.repo) fail('CONNECTION_SCOPE');
  }
  #time(): number { const t = this.#now(); if (!Number.isSafeInteger(t) || t < 0) fail('CLOCK_UNAVAILABLE'); return t; }
  inspect(): object { return { recipe: clone(this.#spec), recipeDigest: digest(canonicalJson(this.#spec)), engine:'langgraph', durability:'postgres-required', modelCalls:0, publication:false }; }
  setup(): Promise<RecipeSpec> { return this.dependencies.store.setup(this.#spec); }
  async #job(key: string): Promise<Job> {
    if (!hash(key)) fail('INVALID_JOB_ID'); const job = await this.dependencies.store.read(key); if (!job) return fail('UNKNOWN_JOB');
    if (!same(job.plan.spec,this.#spec)) fail('RECIPE_DRIFT'); return job;
  }
  async review(key: string): Promise<object> { const job = await this.#job(key); return { status:status(job),job,metricsProvenance:'personal-agent-reported',subscriptionRate:null,comparisonGain:null }; }
  status(key: string): Promise<object> { return this.review(key); }
  async plan(value: { experiment: unknown; draft: unknown; metrics: unknown }): Promise<Plan> {
    const spec = await this.dependencies.store.spec(this.#spec.id); if (!same(spec,this.#spec)) fail('RECIPE_DRIFT');
    const input = inputs(spec,value.experiment,value.draft,value.metrics), key = jobId(spec,input.experiment.id), old = await this.dependencies.store.read(key);
    if (old && !same(old.plan.spec,spec)) fail('RECIPE_DRIFT');
    if (old && same({ experiment:old.plan.experiment,draft:old.plan.draft,metrics:old.plan.metrics },input)) return clone(old.plan);
    if (old && status(old) !== 'DRAFT_PR_READY' && (old.approval || Object.values(old.steps).some(s=>s.status!=='READY'))) fail('PLAN_BUSY');
    const gh = this.dependencies.github;
    // Only exact commit-addressed evidence is accepted. The agent supplies text; this connection verifies bytes.
    for (const file of [input.experiment.record,...input.experiment.evidence]) {
      const source = await gh.file(file.path,input.experiment.commit); if (!source || digest(source.content) !== file.digest || source.content !== file.content) fail('SOURCE_DRIFT');
    }
    const branch = `${spec.github.branchPrefix}/${key.slice(7,31)}`, baseSha = await gh.ref(spec.github.baseBranch);
    if (!baseSha) fail('BASE_NOT_FOUND');
    const expectedHead = await gh.ref(branch), pull = await gh.pull(branch);
    if ((!old || old.steps.pull.status !== 'DONE') && (expectedHead || pull)) fail('BRANCH_ALREADY_EXISTS');
    if (old?.steps.pull.status === 'DONE' && (!expectedHead || !pull || pull.number !== old.pull?.number || !pull.draft || pull.state !== 'open'
      || pull.head !== branch || pull.base !== spec.github.baseBranch || pull.body !== old.plan.pullBody)) fail('PULL_DRIFT');
    if(old?.steps.pull.status==='DONE'&&!await this.#writeReceipt(old))fail('WRITE_NOT_OBSERVED');
    const previousFile = await gh.file(spec.github.draftPath,expectedHead ?? baseSha);
    if (!old && previousFile) fail('DESTINATION_EXISTS');
    if (old?.steps.pull.status === 'DONE' && (!previousFile || previousFile.content !== old.plan.content)) fail('DRAFT_DRIFT');
    const specDigest = digest(canonicalJson(spec));
    const body: Omit<Plan,'digest'> = { format:'trellis/recipe-plan/v1',jobId:key,spec,specDigest,...input,branch,baseSha,expectedHead,
      expectedFileSha:previousFile?.sha ?? null,existingPull:pull?.number ?? null,
      content:contentFor(key,specDigest,input.experiment,input.draft),pullBody:bodyFor(spec,key,input.experiment) };
    const plan: Plan = { ...body,digest:planDigest(body) }, timestamp = this.#time();
    return this.dependencies.store.change(key,current => {
      if (!same(current,old)) fail('PLAN_CHANGED');
      const history = current ? [...current.history,...(current.pull ? [{planDigest:current.plan.digest,completedAt:current.updatedAt,pull:current.pull}] : [])] : [];
      if (history.length > 20) fail('REVISION_LIMIT');
      const job: Job = { format:'trellis/recipe-job/v2',id:key,plan,approval:null,cancelled:false,steps:{branch:ready(),file:ready(),pull:ready()},writeReceipt:null,pull:null,
        createdAt:current?.createdAt ?? timestamp,updatedAt:timestamp,history };
      return { job,result:plan };
    });
  }
  async approve(binding: ApprovalBinding, credential: unknown): Promise<object> {
    if (!hash(binding.jobId) || !hash(binding.planDigest)) fail('INVALID_APPROVAL');
    const auth = await this.dependencies.authorizeApproval(credential,clone(binding)); if (!auth || !id(auth.subject)) fail('APPROVAL_IDENTITY');
    const observed = await this.#job(binding.jobId); if (observed.plan.digest !== binding.planDigest) fail('STALE_APPROVAL');
    await this.dependencies.store.change(binding.jobId,current => {
      if (!current || current.plan.digest !== binding.planDigest) fail('STALE_APPROVAL');
      if (current.cancelled) fail('CANCELLED');
      current.approval ??= { planDigest:binding.planDigest,subject:auth.subject,at:this.#time() }; current.updatedAt = this.#time();
      return { job:current,result:null };
    });
    return this.review(binding.jobId);
  }
  async cancel(key: string): Promise<object> {
    await this.#job(key);
    await this.dependencies.store.change(key,current => { if (!current) return fail('UNKNOWN_JOB'); current.cancelled = true; current.updatedAt = this.#time(); return {job:current,result:null}; });
    return this.review(key);
  }
  async #writeReceipt(job:Job):Promise<WriteReceipt|null>{
    const p=job.plan,receipt=await this.dependencies.github.verifyWrite(p.branch,p.spec.github.draftPath,p.content,p.expectedHead??p.baseSha,`docs: Labs draft ${p.digest}`);
    if(receipt&&job.writeReceipt&&!same(receipt,job.writeReceipt))fail('WRITE_RECEIPT_DRIFT');
    return receipt;
  }
  async #observed(job: Job, step: Step): Promise<boolean> {
    const p = job.plan, gh = this.dependencies.github;
    if (step === 'branch') return await gh.ref(p.branch) === (p.expectedHead ?? p.baseSha);
    const receipt=await this.#writeReceipt(job);if(!receipt)return false;
    if (step === 'file') return true;
    const pull = await gh.pull(p.branch); if (!pull) return false;
    checkPull(pull,p,receipt.head); if (p.existingPull !== null && pull.number !== p.existingPull) fail('PULL_DRIFT');
    return true;
  }
  async #done(job: Job, step: Step): Promise<void> {
    const pull = step === 'pull' ? await this.dependencies.github.pull(job.plan.branch) : null;
    const receipt=step==='branch'?null:await this.#writeReceipt(job);if(step!=='branch'&&!receipt)fail('WRITE_NOT_OBSERVED');
    if (step === 'pull') { checkPull(pull,job.plan,receipt!.head); if (job.plan.existingPull !== null && pull.number !== job.plan.existingPull) fail('PULL_DRIFT'); }
    await this.dependencies.store.change(job.id,current => {
      if (!current || current.plan.digest !== job.plan.digest) fail('PLAN_CHANGED');
      if (!['SENDING','UNKNOWN','DONE'].includes(current.steps[step].status)) fail('UNCLAIMED_EFFECT');
      if(receipt){if(current.writeReceipt&&!same(current.writeReceipt,receipt))fail('WRITE_RECEIPT_DRIFT');current.writeReceipt=receipt;}
      current.steps[step] = { ...current.steps[step],status:'DONE',completedAt:this.#time(),reason:null }; if (pull) current.pull = pull;
      current.updatedAt = this.#time(); return { job:current,result:null };
    });
  }
  async reconcile(key: string): Promise<object> {
    return this.dependencies.store.exclusive(key,async guard => {
      const job = await this.#job(key);
      for (const step of steps) {
        if (!['SENDING','UNKNOWN'].includes(job.steps[step].status)) continue;
        await guard(); if (await this.#observed(job,step)) await this.#done(job,step);
        // Absence cannot fence a paused sender. It never releases or retries a claim.
        break;
      }
      return this.review(key);
    });
  }
  async #effect(key: string, expected: string, step: Step, guard: () => Promise<void>): Promise<boolean> {
    await guard(); let job = await this.#job(key);
    if (job.plan.digest !== expected) fail('PLAN_CHANGED');
    if (job.cancelled) return false;
    if (job.approval?.planDigest !== expected) fail('APPROVAL_REQUIRED');
    if (job.steps[step].status === 'DONE') return true;
    if (job.steps[step].status !== 'READY') return false;
    const p = job.plan, gh = this.dependencies.github;
    // Drift checks happen before consuming the claim. The file adapter uses a non-forced ref update, not an exact CAS.
    if (await gh.ref(p.spec.github.baseBranch) !== p.baseSha) fail('BASE_DRIFT');
    if (step === 'branch' && await gh.ref(p.branch) !== p.expectedHead) fail('HEAD_DRIFT');
    if (step === 'file') {
      const head = await gh.ref(p.branch); if (head !== (p.expectedHead ?? p.baseSha)) fail('HEAD_DRIFT');
      const file = await gh.file(p.spec.github.draftPath,head!); if ((file?.sha ?? null) !== p.expectedFileSha) fail('FILE_DRIFT');
    }
    if (step === 'pull') {
      if (!await this.#observed(job,'file')) fail('DRAFT_DRIFT');
      const pull = await gh.pull(p.branch);
      if (p.existingPull === null ? pull !== null : !pull || pull.number !== p.existingPull || !pull.draft || pull.state !== 'open'
        || pull.base !== p.spec.github.baseBranch || pull.head !== p.branch) fail('PULL_DRIFT');
    }
    await guard();
    const claimed = await this.dependencies.store.change(key,current => {
      if (!current || current.plan.digest !== expected) fail('PLAN_CHANGED');
      if (current.cancelled || current.steps[step].status !== 'READY') return {job:current,result:false};
      if (current.approval?.planDigest !== expected) fail('APPROVAL_REQUIRED');
      current.steps[step] = {status:'SENDING',claimedAt:this.#time(),completedAt:null,reason:null}; current.updatedAt = this.#time();
      return {job:current,result:true};
    });
    if (!claimed) return false;
    try {
      await guard(); job = await this.#job(key); if (job.cancelled) return false;
      if (step === 'branch') { if (!p.expectedHead) await gh.createBranch(p.branch,p.baseSha); }
      if (step === 'file') await gh.writeFile(p.branch,p.spec.github.draftPath,p.content,p.expectedFileSha,p.expectedHead ?? p.baseSha,`docs: Labs draft ${p.digest}`);
      if (step === 'pull') {
        const receipt=await this.#writeReceipt(job);if(!receipt||!job.writeReceipt)fail('WRITE_NOT_OBSERVED');
        if (p.existingPull === null) await gh.createPull(p.branch,p.spec.github.baseBranch,p.draft.title,p.pullBody,receipt.head);
        else await gh.updatePull(p.existingPull,p.draft.title,p.pullBody,p.branch,receipt.head);
      }
      if (!await this.#observed(job,step)) fail('EFFECT_NOT_OBSERVED');
      await this.#done(job,step); return true;
    } catch (error) {
      // Includes lost control-store acknowledgements: only an independent read can resolve the claim.
      try { await this.dependencies.store.change(key,current => {
        if (!current || current.plan.digest !== expected) fail('PLAN_CHANGED');
        if (current.steps[step].status !== 'DONE') current.steps[step] = {...current.steps[step],status:'UNKNOWN',reason:'EXTERNAL_OUTCOME_UNKNOWN'};
        current.updatedAt = this.#time(); return {job:current,result:null};
      }); } catch { /* original durable SENDING remains a hold */ }
      throw error instanceof RecipeError ? error : new RecipeError('EXTERNAL_OUTCOME_UNKNOWN');
    }
  }
  async run(key: string): Promise<object> {
    // Upstream callbacks may consult ambient tracing after an async graph boundary.
    // Refuse that environment instead of changing global settings or quietly exporting private draft data.
    for (const name of ['LANGSMITH_TRACING','LANGCHAIN_TRACING','LANGCHAIN_TRACING_V2','LANGSMITH_OTEL_ENABLED','OTEL_ENABLED','LANGCHAIN_VERBOSE','LANGSMITH_DEBUG']) {
      const value = process.env[name]; if (value && !['false','0','off'].includes(value.toLowerCase())) fail('AMBIENT_TRACING_REFUSED');
    }
    if ((process.env.LANGSMITH_TRACING_MODE && process.env.LANGSMITH_TRACING_MODE !== 'langsmith')
      || (process.env.OTEL_TRACES_EXPORTER && process.env.OTEL_TRACES_EXPORTER !== 'none') || getCurrentRunTree(true)?.tracingEnabled === true) fail('AMBIENT_TRACING_REFUSED');
    return this.dependencies.store.exclusive(key,async guard => {
      const job = await this.#job(key); if (job.cancelled || status(job) === 'DRAFT_PR_READY' || status(job) === 'NEEDS_RECONCILIATION') return this.review(key);
      const expected = job.plan.digest;
      const graph = new StateGraph(State)
        .addNode('review',async state => {
          if (state.planDigest !== expected) fail('CHECKPOINT_DRIFT'); await guard();
          const current = await this.#job(key); if (current.cancelled) return { stopped:true };
          if (!current.approval) {
            const answer = interrupt({jobId:key,planDigest:expected,action:'review exact draft PR plan'});
            if (answer !== expected) fail('STALE_APPROVAL');
          }
          const approved = await this.#job(key); if (approved.plan.digest !== expected || approved.approval?.planDigest !== expected) fail('APPROVAL_REQUIRED');
          return {stopped:approved.cancelled};
        })
        .addNode('branch',async() => ({stopped:!await this.#effect(key,expected,'branch',guard)}))
        .addNode('file',async() => ({stopped:!await this.#effect(key,expected,'file',guard)}))
        .addNode('pull',async() => ({stopped:!await this.#effect(key,expected,'pull',guard)}))
        .addEdge(START,'review')
        .addConditionalEdges('review',s=>s.stopped?END:'branch')
        .addConditionalEdges('branch',s=>s.stopped?END:'file')
        .addConditionalEdges('file',s=>s.stopped?END:'pull').addEdge('pull',END).compile({checkpointer:this.checkpointer});
      // No user config, callbacks or model is passed to LangGraph. Explicit context suppresses ambient tracing.
      const config = {configurable:{thread_id:`${key}:${expected}`},callbacks:[],recursionLimit:12};
      await traceable(async() => {
        const saved = await graph.getState(config);
        const paused = saved.tasks.some(t=>t.interrupts?.length);
        await graph.invoke(paused && job.approval ? new Command({resume:expected}) : paused ? null : {planDigest:expected,stopped:false},config);
      },{tracingEnabled:false})();
      return this.review(key);
    });
  }
}
