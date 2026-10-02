import { canonicalJson, digest } from '../../contracts/src/index.js';
import { copyJson } from '../../graph/src/validation.js';
import { RecipeError } from './types.js';
import type { RecipeSpec, Experiment, AgentDraft, ReportedMetrics, Job, Plan, JobStatus } from './types.js';
import {createHash} from 'node:crypto';
export { canonicalJson, digest };
export const clone = <T>(v: T): T => copyJson(v, 2 * 1024 * 1024);
export function fail(code: string): never { throw new RecipeError(code); }
export const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
export const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(v);
export const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
export const hash = (v: unknown): v is string => typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v);
export const exact = (v: unknown, keys: string[]): boolean => !!v && typeof v === 'object' && !Array.isArray(v) && same(Object.keys(v).sort(), [...keys].sort());
export const path = (v: unknown): v is string => typeof v === 'string' && v.length <= 240 && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(v)
  && v.split('/').length <= 8 && v.split('/').every(p => p !== '' && p !== '.' && p !== '..' && !p.endsWith('.lock')) && !v.includes('//') && !v.includes('..');
export const branch = (v: unknown): v is string => path(v) && !v.endsWith('.') && !v.includes('@{');
export function specCopy(value: unknown): RecipeSpec {
  const v = clone(value) as RecipeSpec;
  if (!exact(v, ['format','id','sourceRevision','github']) || v.format !== 'trellis/recipe/labs-to-blog/v1' || !id(v.id) || !sha(v.sourceRevision)) fail('INVALID_RECIPE');
  const g = v.github;
  if (!exact(g, ['host','owner','repo','baseBranch','branchPrefix','draftPath','evidencePrefix']) || g.host !== 'github.com'
    || typeof g.owner !== 'string' || typeof g.repo !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(g.owner) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(g.repo)
    || !branch(g.baseBranch) || !branch(g.branchPrefix) || !g.branchPrefix.startsWith('trellis/labs-blog/') || g.baseBranch.startsWith(g.branchPrefix + '/')
    || !path(g.draftPath) || !g.draftPath.endsWith('.md') || !path(g.evidencePrefix)
    || g.draftPath.startsWith('.github/') || g.draftPath.startsWith(g.evidencePrefix + '/')) fail('INVALID_GITHUB_SCOPE');
  return v;
}
export const evidenceUrl = (spec: RecipeSpec, commit: string, p: string): string =>
  `https://github.com/${spec.github.owner}/${spec.github.repo}/blob/${commit}/${p.split('/').map(encodeURIComponent).join('/')}`;
export function inputs(spec: RecipeSpec, experiment: unknown, draft: unknown, metrics: unknown): { experiment: Experiment; draft: AgentDraft; metrics: ReportedMetrics } {
  const e = clone(experiment) as Experiment, d = clone(draft) as AgentDraft, m = clone(metrics) as ReportedMetrics;
  if (!exact(e, ['id','status','completedAt','commit','record','evidence']) || !id(e.id) || e.status !== 'completed' || !sha(e.commit)
    || typeof e.completedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.completedAt) || !Number.isFinite(Date.parse(e.completedAt))
    || !Array.isArray(e.evidence) || e.evidence.length < 1 || e.evidence.length > 8) fail('INVALID_EXPERIMENT');
  const files = [e.record, ...e.evidence];
  if (new Set(files.map(f => f.id)).size !== files.length || new Set(files.map(f => f.path)).size !== files.length) fail('DUPLICATE_EVIDENCE');
  for (const f of files) if (!exact(f, ['id','path','content','digest']) || !id(f.id) || !path(f.path) || !f.path.startsWith(spec.github.evidencePrefix + '/')
    || typeof f.content !== 'string' || f.content.includes('\0') || Buffer.byteLength(f.content) > 32768 || f.digest !== digest(f.content)) fail('INVALID_EVIDENCE');
  if (!exact(d, ['title','markdown','claims']) || typeof d.title !== 'string' || !d.title.trim() || d.title.length > 120 || /[\r\n\0]/.test(d.title)
    || typeof d.markdown !== 'string' || !d.markdown.trim() || d.markdown.includes('\0') || Buffer.byteLength(d.markdown) > 65536
    || !Array.isArray(d.claims) || d.claims.length < 1 || d.claims.length > 32) fail('INVALID_DRAFT');
  for (const c of d.claims) {
    if (!exact(c, ['text','evidenceIds']) || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 1000 || !d.markdown.includes(c.text)
      || !Array.isArray(c.evidenceIds) || c.evidenceIds.length < 1 || c.evidenceIds.length > 8) fail('UNLINKED_CLAIM');
    for (const key of c.evidenceIds) { const f = files.find(f => f.id === key); if (!f || !d.markdown.includes(evidenceUrl(spec, e.commit, f.path))) fail('UNLINKED_CLAIM'); }
  }
  if (!exact(m, ['setupMinutes','draftingMinutes','reviewMinutes','corrections','inputTokens','outputTokens','baselineMinutes'])) fail('INVALID_METRICS');
  for (const [key, value] of Object.entries(m)) if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9
    || (['corrections','inputTokens','outputTokens'].includes(key) && !Number.isSafeInteger(value)))) fail('INVALID_METRICS');
  return { experiment: e, draft: d, metrics: m };
}
export const jobId = (spec: RecipeSpec, experimentId: string): string => digest(canonicalJson({ recipe: spec.id, owner: spec.github.owner, repo: spec.github.repo, experimentId }));
export const planDigest = (p: Omit<Plan, 'digest'> | Plan): string => { const { digest: ignored, ...body } = p as Plan; return digest(canonicalJson(body)); };
export function validateJob(value: unknown): Job {
  const v = clone(value) as Job;
  if (!exact(v, ['format','id','plan','approval','cancelled','steps','writeReceipt','pull','createdAt','updatedAt','history']) || v.format !== 'trellis/recipe-job/v2') fail('CORRUPT_JOB');
  const p = v.plan;
  if (!exact(p, ['format','jobId','spec','specDigest','experiment','draft','metrics','branch','baseSha','expectedHead','expectedFileSha','existingPull','content','pullBody','digest'])
    || p.format !== 'trellis/recipe-plan/v1') fail('CORRUPT_PLAN');
  const spec = specCopy(p.spec); inputs(spec, p.experiment, p.draft, p.metrics);
  if (v.id !== jobId(spec, p.experiment.id) || p.jobId !== v.id || p.digest !== planDigest(p) || p.specDigest !== digest(canonicalJson(spec))
    || p.branch !== `${spec.github.branchPrefix}/${v.id.slice(7,31)}` || !sha(p.baseSha) || (p.expectedHead !== null && !sha(p.expectedHead))
    || (p.expectedFileSha !== null && !sha(p.expectedFileSha)) || (p.existingPull !== null && (!Number.isSafeInteger(p.existingPull) || p.existingPull < 1))
    || p.content !== contentFor(p.jobId, p.specDigest, p.experiment, p.draft) || p.pullBody !== bodyFor(spec, p.jobId, p.experiment)) fail('CORRUPT_PLAN');
  if (typeof v.cancelled !== 'boolean' || !exact(v.steps, ['branch','file','pull']) || !Number.isSafeInteger(v.createdAt) || v.createdAt < 0
    || !Number.isSafeInteger(v.updatedAt) || v.updatedAt < v.createdAt || !Array.isArray(v.history) || v.history.length > 20) fail('CORRUPT_JOB');
  if (v.approval && (!exact(v.approval, ['planDigest','subject','at']) || v.approval.planDigest !== p.digest || !id(v.approval.subject) || !Number.isSafeInteger(v.approval.at))) fail('CORRUPT_APPROVAL');
  for (const s of Object.values(v.steps)) if (!exact(s, ['status','claimedAt','completedAt','reason']) || !['READY','SENDING','UNKNOWN','DONE'].includes(s.status)
    || (s.reason !== null && !/^[A-Z_]{1,100}$/.test(s.reason)) || (s.claimedAt !== null && !Number.isSafeInteger(s.claimedAt))
    || (s.completedAt !== null && !Number.isSafeInteger(s.completedAt)) || (s.status === 'READY' && s.claimedAt !== null)
    || (s.status === 'DONE' && s.completedAt === null) || (['SENDING','UNKNOWN'].includes(s.status) && s.claimedAt === null)) fail('CORRUPT_STEP');
  if (Object.values(v.steps).some(s => s.status !== 'READY') && !v.approval) fail('CORRUPT_APPROVAL');
  if (v.steps.file.status !== 'READY' && v.steps.branch.status !== 'DONE') fail('CORRUPT_STEP');
  if (v.steps.pull.status !== 'READY' && v.steps.file.status !== 'DONE') fail('CORRUPT_STEP');
  if(v.writeReceipt!==null){
    const bytes=Buffer.from(p.content),blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if(!exact(v.writeReceipt,['head','parent','tree','blob'])||!Object.values(v.writeReceipt).every(sha)
      ||v.writeReceipt.parent!==(p.expectedHead??p.baseSha)||v.writeReceipt.blob!==blob||v.steps.file.status!=='DONE')fail('CORRUPT_WRITE_RECEIPT');
  }
  if(v.steps.file.status==='DONE'&&!v.writeReceipt)fail('CORRUPT_WRITE_RECEIPT');
  if (v.pull) {if(!v.writeReceipt)fail('CORRUPT_WRITE_RECEIPT');checkPull(v.pull, p,v.writeReceipt.head);}
  if (v.steps.pull.status === 'DONE' && !v.pull) fail('CORRUPT_STEP');
  return v;
}
export const contentFor = (job: string, specDigest: string, e: Experiment, d: AgentDraft): string => `${d.markdown.trimEnd()}\n\n<!-- trellis labs-to-blog job=${job} recipe=${specDigest} source=${e.commit} -->\n`;
export const bodyFor = (s: RecipeSpec, job: string, e: Experiment): string => `Draft for human review. No publication or merge is authorized.\n\nExperiment: ${evidenceUrl(s,e.commit,e.record.path)}\n\n<!-- trellis-job:${job} -->`;
export function checkPull(v: unknown, p: Plan, expectedHead:string): asserts v is import('./types.js').Pull {
  const x = v as import('./types.js').Pull;
  if (!exact(x, ['number','draft','state','head','headSha','base','baseSha','title','body','url']) || !Number.isSafeInteger(x.number) || x.number < 1 || x.draft !== true || x.state !== 'open'
    || x.head !== p.branch || x.headSha!==expectedHead || x.base !== p.spec.github.baseBranch || x.baseSha!==p.baseSha || x.body !== p.pullBody || x.title !== p.draft.title
    || x.url !== `https://github.com/${p.spec.github.owner}/${p.spec.github.repo}/pull/${x.number}`) fail('PULL_DRIFT');
}
export function status(job: Job): JobStatus {
  const uncertain = Object.values(job.steps).some(s => ['SENDING','UNKNOWN'].includes(s.status));
  return job.cancelled ? uncertain ? 'CANCELLED_WITH_POSSIBLE_EFFECT' : 'CANCELLED' : uncertain ? 'NEEDS_RECONCILIATION'
    : job.steps.pull.status === 'DONE' ? 'DRAFT_PR_READY' : job.approval ? 'APPROVED' : 'WAITING_APPROVAL';
}
