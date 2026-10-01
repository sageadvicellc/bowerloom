import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compileCrew } from '../../../dist/packages/crew/src/index.js';
import { canonicalJson, digest, graphOrder, validateDefinition } from '../../../dist/packages/contracts/src/index.js';
export { canonicalJson, digest };
export function seal(plan) {
  const { candidateRevision: _, ...body } = structuredClone(plan);
  validateDefinition(body.definition); Object.assign(body, graphOrder(body.definition));
  return { ...body, candidateRevision: digest(canonicalJson(body)) };
}
export async function input(runId = 'graph-test') {
  const plan = structuredClone(await compileCrew(resolve('examples/endor/crew.yaml')));
  const capabilities = ['workspace.write','approval.exact-revision'];
  plan.definition.requiredCapabilities = capabilities;
  plan.definition.tasks = plan.definition.tasks.slice(0,2);
  const [design, build] = plan.definition.tasks;
  for (const task of plan.definition.tasks) {
    task.requires = capabilities; task.approval = 'required'; task.policy.maxAttempts = 1; task.policy.backoffSeconds = 0;
  }
  design.effects = [{ operation:'workspace.write', path:'output/design/brief.json' }];
  design.outputs = { brief: { kind:'record', fields: { title:{kind:'string'}, count:{kind:'integer'} } } };
  build.inputs.brief.type = structuredClone(design.outputs.brief);
  build.effects = [{ operation:'workspace.write', path:'output/job-board/index.html' }];
  const assets = Object.fromEntries(await Promise.all(Object.entries(plan.assets).map(async ([id, value]) => [id, await readFile(resolve('examples/endor', value.path),'utf8')])));
  const owners = Object.fromEntries(plan.definition.owners.map(owner => [owner.id,{ subject:`agent:${owner.id}`,epoch:1 }]));
  return { plan:seal(plan),workspaceId:'synthetic-workspace',runId,assets,owners };
}
export function observed(request, status='RUNNING', content) {
  const base = { executionId:request.executionId,requestDigest:request.requestDigest,status,reason:null,completion:null };
  if (status !== 'COMPLETED') return base;
  const task = request.plan.definition.tasks.find(task=>task.id===request.taskId);
  const proposal = { format:'trellis/action/v0.7-alpha',scope:{workspaceId:request.workspaceId,runId:request.runId,taskId:request.taskId},requestId:'write',
    candidateRevision:request.candidateRevision,ownerEpoch:request.ownerEpoch,
    edit:{operation:'workspace.write',path:task.effects[0].path,expectedDigest:null,content:content ?? (task.id==='design'?canonicalJson({title:'Treehouse',count:2}):'<p>Treehouse</p>')} };
  const actionDigest = digest(canonicalJson(proposal));
  base.completion = {proposal,receipt:{format:'trellis/effect-receipt/v0.7-alpha',actionDigest,
    operationKey:digest(canonicalJson({scope:proposal.scope,requestId:proposal.requestId,actionDigest})),workspaceId:request.workspaceId,path:proposal.edit.path,
    beforeDigest:null,afterDigest:digest(proposal.edit.content),bytes:Buffer.byteLength(proposal.edit.content),appliedAtMs:100},evidenceRef:'synthetic-accepted'};
  return base;
}
export class Executor {
  submitted=[]; observations=new Map(); inspections=0;
  async submit(request) { this.submitted.push(structuredClone(request)); }
  async inspect(request) { this.inspections++; return structuredClone(this.observations.get(request.taskId) ?? observed(request)); }
  complete(index=0, content) { const request=this.submitted[index]; this.observations.set(request.taskId,observed(request,'COMPLETED',content)); }
}
// Reference store only for deterministic tests. Production callers use PostgresGraphStore.
export class TestStore {
  data = new Map(); #tail = Promise.resolve(); afterCommit;
  async transaction(id, change) {
    let release; const previous=this.#tail; this.#tail=new Promise(resolve=>{release=resolve;}); await previous;
    try {
      const output=change(structuredClone(this.data.get(id)??null));
      const next=structuredClone(output.state); const result=structuredClone(output.result);
      this.data.set(id,next); if(this.afterCommit) this.afterCommit(next); return result;
    } finally {release();}
  }
}
