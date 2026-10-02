export class RecipeError extends Error { constructor(readonly code: string) { super(code); this.name = 'RecipeError'; } }
export interface RecipeSpec {
  format: 'trellis/recipe/labs-to-blog/v1'; id: string; sourceRevision: string;
  github: { host: 'github.com'; owner: string; repo: string; baseBranch: string; branchPrefix: string; draftPath: string; evidencePrefix: string };
}
export interface EvidenceFile { id: string; path: string; content: string; digest: string }
export interface Experiment {
  id: string; status: 'completed'; completedAt: string; commit: string;
  record: EvidenceFile; evidence: EvidenceFile[];
}
export interface AgentDraft {
  title: string; markdown: string;
  claims: { text: string; evidenceIds: string[] }[];
}
export interface ReportedMetrics {
  setupMinutes: number | null; draftingMinutes: number | null; reviewMinutes: number | null;
  corrections: number | null; inputTokens: number | null; outputTokens: number | null;
  baselineMinutes: number | null;
}
export interface Pull { number: number; draft: boolean; state: 'open' | 'closed'; head: string; base: string; title: string; body: string; url: string }
export interface RemoteFile { sha: string; content: string }
/** Controller-owned connection. Values in a recipe cannot select a token, endpoint or shell command. */
export interface GitHubPort {
  readonly owner: string; readonly repo: string;
  ref(branch: string): Promise<string | null>;
  file(path: string, ref: string): Promise<RemoteFile | null>;
  pull(branch: string): Promise<Pull | null>;
  createBranch(branch: string, sha: string): Promise<void>;
  writeFile(branch: string, path: string, content: string, previousSha: string | null, expectedHead: string, message: string): Promise<void>;
  createPull(branch: string, base: string, title: string, body: string): Promise<void>;
  updatePull(number: number, title: string, body: string): Promise<void>;
}
export interface Plan {
  format: 'trellis/recipe-plan/v1'; jobId: string; spec: RecipeSpec; specDigest: string;
  experiment: Experiment; draft: AgentDraft; metrics: ReportedMetrics;
  branch: string; baseSha: string; expectedHead: string | null; expectedFileSha: string | null; existingPull: number | null;
  content: string; pullBody: string; digest: string;
}
export type Step = 'branch' | 'file' | 'pull';
export interface StepState { status: 'READY' | 'SENDING' | 'UNKNOWN' | 'DONE'; claimedAt: number | null; completedAt: number | null; reason: string | null }
export interface Job {
  format: 'trellis/recipe-job/v1'; id: string; plan: Plan;
  approval: { planDigest: string; subject: string; at: number } | null;
  cancelled: boolean; steps: Record<Step, StepState>; pull: Pull | null;
  createdAt: number; updatedAt: number;
  history: { planDigest: string; completedAt: number; pull: Pull }[];
}
export type JobStatus = 'WAITING_APPROVAL' | 'APPROVED' | 'NEEDS_RECONCILIATION' | 'DRAFT_PR_READY' | 'CANCELLED' | 'CANCELLED_WITH_POSSIBLE_EFFECT';
export interface RecipeStore {
  setup(spec: RecipeSpec): Promise<RecipeSpec>;
  spec(id: string): Promise<RecipeSpec>;
  read(id: string): Promise<Job | null>;
  change<T>(id: string, mutate: (current: Job | null) => { job: Job; result: T }): Promise<T>;
  exclusive<T>(id: string, body: (guard: () => Promise<void>) => Promise<T>): Promise<T>;
}
export interface ApprovalBinding { jobId: string; planDigest: string }
export interface RecipeDependencies {
  store: RecipeStore; github: GitHubPort; allowedRecipe: RecipeSpec;
  authorizeApproval(credential: unknown, binding: ApprovalBinding): Promise<{ subject: string }>;
  now?: () => number;
}
