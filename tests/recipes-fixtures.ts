import { MemorySaver } from '@langchain/langgraph';
import { RecipeService, RecipeError } from '../packages/recipes/src/index.js';
import type { RecipeStore, RecipeSpec, Job, GitHubPort, Pull, ReportedMetrics } from '../packages/recipes/src/index.js';
import { clone, digest, same, validateJob, evidenceUrl } from '../packages/recipes/src/validation.js';
export const spec: RecipeSpec = {format:'trellis/recipe/labs-to-blog/v1',id:'labs-blog',sourceRevision:'a'.repeat(40),
  github:{host:'github.com',owner:'example',repo:'labs',baseBranch:'main',branchPrefix:'trellis/labs-blog/alpha',draftPath:'drafts/experiment.md',evidencePrefix:'experiments'}};
export const sourceCommit='b'.repeat(40);
export const experiment = {id:'latency-01',status:'completed' as const,completedAt:'2026-10-01T00:00:00.000Z',commit:sourceCommit,
  record:{id:'record',path:'experiments/latency/record.md',content:'Completed synthetic experiment.',digest:digest('Completed synthetic experiment.')},
  evidence:[{id:'results',path:'experiments/latency/results.json',content:'{"milliseconds":12}',digest:digest('{"milliseconds":12}')} ]};
export const draft={title:'What the synthetic experiment measured',markdown:`The synthetic run took 12 ms. [Evidence](${evidenceUrl(spec,sourceCommit,experiment.evidence[0]!.path)})`,claims:[{text:'The synthetic run took 12 ms.',evidenceIds:['results']}]};
export const metrics: ReportedMetrics={setupMinutes:null,draftingMinutes:null,reviewMinutes:null,corrections:null,inputTokens:null,outputTokens:null,baselineMinutes:null};
export const packet=()=>structuredClone({experiment,draft,metrics});
export class MemoryRecipeStore implements RecipeStore {
  recipes=new Map<string,RecipeSpec>(); jobs=new Map<string,Job>(); busy=new Set<string>();
  async setup(v:RecipeSpec){const old=this.recipes.get(v.id);if(old&&!same(old,v))throw new RecipeError('SETUP_CONFLICT');this.recipes.set(v.id,clone(v));return clone(v);}
  async spec(id:string){const found=this.recipes.get(id);if(!found)throw new RecipeError('UNKNOWN_RECIPE');return clone(found);}
  async read(id:string){return this.jobs.has(id)?validateJob(this.jobs.get(id)):null;}
  async change<T>(id:string, fn:(current:Job|null)=>{job:Job;result:T}){const out=fn(this.jobs.has(id)?validateJob(this.jobs.get(id)):null);const job=validateJob(out.job);this.jobs.set(id,job);return clone(out.result);}
  async exclusive<T>(id:string,body:(guard:()=>Promise<void>)=>Promise<T>){if(this.busy.has(id))throw new RecipeError('RECIPE_BUSY');this.busy.add(id);try{return await body(async()=>{});}finally{this.busy.delete(id);}}
}
export class FakeGitHub implements GitHubPort {
  readonly owner=spec.github.owner;readonly repo=spec.github.repo; refs=new Map([['main','c'.repeat(40)]]); files=new Map<string,Map<string,{sha:string;content:string}>>();
  pulls=new Map<string,Pull>(); calls:string[]=[]; lostAfter:string|null=null; failBefore:string|null=null; counter=1;
  constructor(){this.files.set(sourceCommit,new Map([experiment.record,...experiment.evidence].map(f=>[f.path,{sha:this.sha(),content:f.content}])));this.files.set('c'.repeat(40),new Map());}
  sha(){return (++this.counter).toString(16).padStart(40,'0');}
  async ref(branch:string){return this.refs.get(branch)??null;}
  async file(path:string,ref:string){return structuredClone(this.files.get(this.refs.get(ref)??ref)?.get(path)??null);}
  async pull(branch:string){return structuredClone(this.pulls.get(branch)??null);}
  before(step:string){this.calls.push(step);if(this.failBefore===step)throw Error('synthetic pre-response failure');}
  after(step:string){if(this.lostAfter===step){this.lostAfter=null;throw Error('synthetic lost acknowledgement');}}
  async createBranch(branch:string,sha:string){this.before('branch');if(this.refs.has(branch))throw Error('exists');this.refs.set(branch,sha);this.after('branch');}
  async writeFile(branch:string,path:string,content:string,previousSha:string|null,expectedHead:string,_message:string){this.before('file');if(this.refs.get(branch)!==expectedHead||(await this.file(path,expectedHead))?.sha!==(previousSha??undefined))throw Error('conflict');
    const head=this.sha(),files=new Map(this.files.get(expectedHead));files.set(path,{sha:this.sha(),content});this.files.set(head,files);this.refs.set(branch,head);this.after('file');}
  async createPull(branch:string,base:string,title:string,body:string){this.before('pull');if(this.pulls.has(branch))throw Error('exists');this.pulls.set(branch,{number:1,draft:true,state:'open',head:branch,base,title,body,url:`https://github.com/${this.owner}/${this.repo}/pull/1`});this.after('pull');}
  async updatePull(number:number,title:string,body:string){this.before('update');const p=[...this.pulls.values()].find(p=>p.number===number)!;if(!p.draft||p.state!=='open')throw Error('not draft');Object.assign(p,{title,body});this.after('update');}
}
export function fixture(){const store=new MemoryRecipeStore(),github=new FakeGitHub(),checkpointer=new MemorySaver(),credential=Symbol('operator');
  const dependencies={store,github,allowedRecipe:spec,authorizeApproval:async(value:unknown)=>{if(value!==credential)throw new RecipeError('APPROVAL_NOT_AUTHORIZED');return{subject:'trusted-operator'};}};
  return{store,github,credential,checkpointer,dependencies,service:new RecipeService(dependencies,checkpointer)};}
