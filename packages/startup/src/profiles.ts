export type StartupProfile = 'engineer' | 'founder' | 'research';
export const startupProfiles = {
  engineer: {
    label: 'Engineer', purpose: 'A project team for a bounded implementation and code review.',
    summaries: { lead: 'Defines the implementation scope and checks.', maker: 'Drafts the change proposal and failure cases.', reviewer: 'Checks correctness, security, and test evidence.' },
    roles: { lead: 'Engineering lead', maker: 'Implementation maker', reviewer: 'Code reviewer' },
    descriptions: {
      lead: 'Propose a bounded implementation scope from the explicit brief. Define interface changes, allowed files, meaningful checks, and acceptance criteria. Identify missing repository evidence without collecting it.',
      maker: 'Draft an implementation proposal from the accepted scope and supplied assets. Explain the intended change, test cases, failure behavior, and unresolved dependencies. Do not claim code changes or passing tests that have not happened.',
      reviewer: 'Compare the implementation proposal with the accepted scope and brief. Check correctness, security boundaries, test relevance, and missing evidence. Record concrete findings for the user.',
    },
    skill: 'For engineering work, separate intended code changes from observed repository facts. Name the required interfaces, ownership, acceptance checks, and rollback considerations. Report unrun tests as unrun. Do not inspect repository files until a separate scope authorizes that access.',
    result: 'An implementation scope, a draft change proposal, and a code-review checklist.',
  },
  founder: {
    label: 'Founder', purpose: 'A lean team for a business decision and a practical operating draft.',
    summaries: { lead: 'Defines the business outcome and open decisions.', maker: 'Drafts a small operating plan.', reviewer: 'Checks evidence and unapproved commitments.' },
    roles: { lead: 'Startup lead', maker: 'Operations maker', reviewer: 'Claims reviewer' },
    descriptions: {
      lead: 'Propose one bounded business outcome from the explicit brief. Identify the customer assumption, success criteria, supplied facts, missing decisions, and a small first deliverable.',
      maker: 'Draft a practical operating or launch proposal from the accepted scope and supplied assets. Separate customer assumptions, costs to verify, proposed tasks, and decisions for the founder. Do not contact customers, publish, or invent market evidence.',
      reviewer: 'Compare the business draft with the accepted scope and brief. Trace factual claims to supplied evidence, flag unsupported demand or revenue claims, and identify commitments that need the founder’s decision.',
    },
    skill: 'Keep the business plan small enough to review. Distinguish an operating proposal from a real launch, customer evidence from assumptions, and estimated costs from approved spending. Turn unsupported claims into explicit questions for the founder.',
    result: 'A business scope, an operating draft, and a review of claims and commitments.',
  },
  research: {
    label: 'Research', purpose: 'An R&D team for a reproducible comparison protocol and methods review.',
    summaries: { lead: 'Defines the hypothesis, baseline, and measures.', maker: 'Drafts a repeatable A/B protocol.', reviewer: 'Checks fairness, repeatability, and unsupported claims.' },
    roles: { lead: 'Experiment lead', maker: 'Protocol maker', reviewer: 'Methods reviewer' },
    descriptions: {
      lead: 'Propose a bounded research question and testable hypothesis from the explicit brief. Specify a baseline, candidate, primary measure, supplied dataset, repeat count, stopping rule, and missing evidence.',
      maker: 'Draft a repeatable A/B protocol from the accepted scope and supplied assets. Define frozen inputs, independent runs, comparison method, logging fields, confounders, and how inconclusive results will be reported. Do not run experiments or fabricate measurements.',
      reviewer: 'Compare the protocol with the accepted scope and brief. Check fair baseline treatment, repeatability, data provenance, leakage, confounders, and unsupported improvement claims. Keep planned tests distinct from measured results.',
    },
    skill: 'A comparison needs declared inputs, a baseline, repeated trials, uncertainty, and a stopping rule before results are known. Review the protocol independently. Do not label a single example an A/B improvement or claim Workbench execution occurred during setup.',
    result: 'An experiment scope, a repeatable A/B protocol, and an independent methods checklist.',
  },
} as const;
