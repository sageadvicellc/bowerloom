---
type: report
status: draft
created: 2026-10-01
updated: 2026-10-01
brief: evidence-index.md
check: evidence-index.md
audience: Hanna
---

# Trellis v1 specification candidate

## Summary

The founder's sequence starts with a bounded Trellis v0.7-beta. A separate Sagespec team follows while framework v1 hardening continues. This candidate proposes contracts, acceptance gates, and implementation order. The research supports further implementation, but it establishes neither a working beta nor an approved architecture.

## Findings and proposed specification

### 1. Product boundary and release sequence

Trellis is the MIT-licensed, self-hosted framework for owners who direct automation through personal agents. Sagespec is Hanna's downstream product and business workflows. Generic examples belong in Trellis. Sagespec's product brief, business rules, knowledge, and assets belong in its own project.

The release sequence is Trellis v0.7-beta acceptance, a separate Sagespec team using that pinned release, and continued Trellis v1 hardening. Sagespec does not wait for every v1 ambition. Its lead, scope, permissions, and product acceptance criteria need their own brief and approval. This specification appoints no downstream lead.

Coda is the Solution Lead and Emery the Design Lead in the default demonstration crew. These are configurable crew roles. Their names grant no universal framework privilege. Leads propose work within enforced ownership, permission, budget, and approval rules.

Framework approvers are configurable and authenticated. For this campaign, only `hannasage` can approve a merge, and approval binds the exact candidate revision. Agent identities cannot supply it. [Founder requirements]

### 2. What the evidence establishes

The independent review confirmed 67 registered facts on October 1, 2026. No fact was changed, failed, or unsupported. Confirmation preserves each fact's original scope. A fixture is a controlled test setup.

| Evidence | Passed result | Limit |
|---|---|---|
| Admission fixture | 45 cases. Two admissions from 16 simultaneous requests | Synthetic allowances and signals. No provider reserve proof |
| Module composition | 52 assertions across two generic demos | Local stubs and subset checks. No production integration |
| Portability fixture | 33 checks | Zero harness sessions. No native permission proof |
| Recovery fixture | 15 cases. 12 effects. Zero duplicates. Seven simulated interventions | Local ledger and scripted decisions. No real connector or human-burden measurement |
| Repository model | 14 assertions | Modeled compatibility and rollback. No migration or installation |
| Existing Roots validator | Four cases | Validator only. No transport, database, or Relay runtime |

The inspected coordinator repository contains documentation only. Roots keeps its bootstrap repeat-action receipts in memory. Relay's inspected source provides local persistence mechanisms, but message durability does not prove durable business actions. Existing code is a starting point for reviewed reuse. [capacity-F7, contracts-F4, hp-F18, durable-F1, F2, F8, rstruct-F1, F4, F10]

### 3. Ownership and shared contracts

The following boundaries are proposed. One versioned contract package supplies shared fields and acceptance fixtures. Modules own specialized payloads and retain explicit build boundaries under either repository layout.

A graph records tasks and their dependencies. A harness runs an agent session. An adapter connects Trellis to an external tool.

| Component | Owns | Required boundary |
|---|---|---|
| Coordinator | Graph compilation, durable task state, claims, admission, approvals, execution, cancellation, recovery | Code decides whether work can proceed. Conversation cannot change authority. |
| trellis-crew | Portable teams, prompts, skills, model mappings, permissions, harness adapters | Harness files are generated views. Missing required behavior blocks launch. |
| trellis-relay | Addressed messages, delivery receipts, team conversations, event references | Delivery neither transfers task ownership nor proves completion. |
| trellis-roots | Versioned sources, retrieval, access, citations, freshness, supersession | Retrieved prose is evidence and cannot grant permission. |
| trellis-vines | Observations, audit exports, usage observations, evaluation evidence | Audit records do not decide workflow state. General metadata excludes private content. |
| trellis-workbench | Isolated experiments, pinned inputs, comparisons, promotion evidence | An experiment cannot change production or promote itself. |

The coordinator is a framework component, not a sixth named module. Its placement follows the repository decision. Existing Crew, Relay, Roots, and Vines interfaces cover parts of these boundaries. They do not implement the complete proposal. [contracts-F1 to F3]

The Relay beta proposal permits one shared socket lane. V1 targets ad-hoc conversations and a durable lead/master record. Both require explicit conversation scope, access rules, and retention. These are proposed founder targets. No transport is selected or tested here.

A digest identifies content. Every request carries format, team, run, task, request ID, operation, source revision, and payload digest. The coordinator binds these to an authenticated caller and rejects conflicting reuse. Events carry scope, ID, sequence, actor, correlation, cause, and payload reference. A durable writer assigns order.

Artifacts carry a digest, media type, relative path, classification, and source revision. Errors carry a stable code, safe explanation, evidence reference, and retry class. Approvals bind scope, action digest, candidate revision, approver, expiry, and proof. Capabilities distinguish declared support from runtime evidence. Budgets record account, source, observation time, windows, allowance, and worker limit.

Retrieval results identify permitted source revisions and passages, freshness, and missing evidence. Handoffs identify completed and pending tasks, artifact digests, ambiguous effects, remaining budget, and required next steps. Structured setup, plan, start, progress, approve, result, cancel, and handoff interfaces remain available to personal agents without requiring one vendor's interface.

### 4. Portable source and natural-language planning

The metaharness is the authoritative configuration layer outside individual harnesses. Version-controlled YAML holds crew roles, prompts, skills, workflow graphs, permissions, model preferences, budgets, and evaluations. Assets use repository-relative paths or declared environment parameters. Secrets, machine paths, private logs, and runtime state remain outside this source.

A schema defines a record's structure. Definitions and dependencies are versioned. Runs pin module, schema, adapter, harness, model-route, and dataset references. Format changes require explicit migration and recovery procedures. Unknown or incompatible versions stop admission.

The research examples use JSON and custom validators. YAML parsing and full schema validation remain implementation work.

A personal agent submits intent and evidence. A planning model proposes a typed graph with inputs, outputs, dependencies, owners, effects, deadlines, bounded retries, evaluation criteria, and escalation conditions. Requirements link to their source or founder decision. The beta graph has no cycles. Retries belong to explicit task policy.

The compiler rejects missing owners, incompatible inputs, unknown capabilities, cycles, unlimited retries, and effects outside scope. Required approval binds the accepted graph revision. A later proposal creates a new candidate. It cannot rewrite the active graph or its completion evidence. The composition fixture tested an ordered dependency subset and a self-cycle, not a general graph compiler. [contracts-F4]

Adapters translate source into deterministic harness configuration. Fresh generation from trusted source and pinned dependencies detects drift. An edited manifest beside generated files cannot authenticate those files. Reconciliation restores generated output or reviews a source change and regenerates it.

Extensions name their namespace and compatibility cost. Unsupported mandatory permissions, approvals, budgets, or skills stop execution. Optional extensions can differ through declared mappings. Portability preserves business intent and required controls, not identical model responses or hidden session history. [hp-F18, proposed contracts]

### 5. Runtime permissions and harness proof

Each adapter needs structured capability description, validation, planning, materialization, effective-policy verification, start, events, approval, cancellation, and handoff operations. Start requires both verified effective policy and capacity admission.

| Candidate | Checked evidence | Proposed disposition for review |
|---|---|---|
| Codex 0.157.0 | Local help/version and structured interfaces | First runtime-validation candidate |
| Claude Code 2.1.286 | Local help/version and structured interfaces | Second candidate, subject to valid capacity admission |
| OpenCode | Homebrew receipt 1.18.30. Three startup inspection timeouts | Defer until startup is understood |
| Goose | Source and documentation. Absent from PATH | Later composition experiment |

This Mac, macOS 15.5 arm64, is an experimental target. Other platforms have documentary evidence only. No harness or platform is certified by this research. [hp-F1 to F4, F18, F20, F21]

Acceptance tests must cover denied reads, writes, network access, unmanaged tools, approval bypass, and subprocess escape. Tests must make sure that the intended configuration actually loads. They must also cover the credential route, required skills, cancellation, and process-tree cleanup. A generated file or successful exit is insufficient.

Codex documents precedence hazards between older sandbox configuration and permission profiles. Claude documents skipped invalid configuration and separate boundaries for Bash, file tools, and desktop use. OpenCode's provider page contains conflicting Claude subscription statements. Goose ACP adds nested permission and accounting layers and lacks native ACP resume/fork. These affect adapter validation and support claims. [hp-F6 to F8, F12, F15, primary sources below]

### 6. Durable execution and ambiguous effects

Durable state survives a process restart. The proposed state model is `READY`, `PREPARED`, `IN_FLIGHT`, `NEEDS_RECONCILIATION`, `COMPLETED`, and `CANCELLED`.

An epoch distinguishes one ownership period from another. A lease gives a worker temporary task ownership. Task claims include team, run, task, candidate revision, definition digest, owner, ownership epoch, and lease.

Before dispatch, one transaction must make sure that ownership, dependencies, cancellation, artifact hashes, permissions, and exact approval permit dispatch. It records durable dispatch intent before releasing the action. The connector receives a stable operation key. Completion requires an accepted result or authoritative receipt.

An intent without a receipt is an unknown outcome. Ordinary claims and automatic retries stop. A connector can record an existing effect without repeating it. A negative result permits retry only when it also rules out a pending or later effect. Otherwise reconciliation remains a human decision. Restart, lease expiry, and harness replacement do not establish non-execution.

Cancellation stops future dispatch and records `cancel_requested` separately from the effect outcome. It cannot undo an external action. Unreliable state storage stops dispatch. Recovery must not silently start with an empty database.

The recovery fixture supports these rules in its local ledger. It does not establish universal exactly-once behavior. Actual runtime tests must repeat its crash, stale-owner, stale-approval, storage-error, cancellation, and artifact-handoff cases. [durable-F8 to F10]

The notes recommend a small local durable journal and single dispatch authority for the bounded Mac beta. DBOS TypeScript with self-hosted Postgres is the named alternative. Its documented recovery machinery still requires Trellis controls around approvals, admission, cancellation, and external outcomes. Neither implementation is selected here. [durable-F3 to F7, proposed comparison]

### 7. Capacity and model routing

Retain the founder's 25 percent reserve as an admission policy. For every applicable reported window, usage plus retained reservations plus the proposed allowance must stay within the 75 percent threshold. One controller per provider account records observations and reserves capacity transactionally.

Missing, stale, invalid, or out-of-order observations refuse new model work. A reset requires a fresh observation. Reservations survive process disappearance and remain until completion plus a later observation. Changed work receives a new admission decision. Lead, review, retries, and running work count toward account usage. Shared accounts share the same allowance across teams.

This campaign permits two active workers. Proposed subscription profiles range from two to seven workers, but profile calibration is unfinished. The proposed `--pro`, `--5x`, and `--20x` setup choices cannot override measured admission or enable paid fallback. Unknown plan detection requires an explicit profile choice.

Codex's installed server returned rate limits without starting a model turn. Claude's documented status-line signal appears after a response and can omit windows. A historical local Claude sample did not support admission of a live experiment. These findings do not establish reporting-delay bounds. [capacity-F1 to F3, F9]

The 45-case fixture used an illustrative freshness limit and invented allowances. Production values and model routes require measurement. Other clients can consume the shared account, reports can lag, and running jobs can exceed allowances. Trellis therefore cannot promise a provider-enforced 25 percent reserve. Paid fallback remains disabled. [capacity-F4, F5, F7, F8]

### 8. Roots retrieval and Workbench promotion

QMD 2.8.3 lexical search completed 100, 1,000, and 5,000 short synthetic documents. The largest corpus was about 3.82 MiB of text. Its original run recorded 2.59 seconds indexing, a 14,077,952-byte database, and 299.0 MiB peak indexing RSS. These are dated observations, not a production ceiling. [qmd-F1, F6]

Use corrected `scored-summary.json` results. At every size, eight exact queries found the expected passages and two paraphrases failed. Aggregate recall@5 was 0.80. Both unknown queries returned no results. The initial zero scores were a URI identity-scoring error corrected against unchanged raw results and gold queries. [qmd-F7, F12]

Collection filtering removed restricted and stale search hits, but direct retrieval of a restricted document still succeeded at all three sizes. Scoped search is not authorization. Roots must enforce caller and task scope before search, get, batch fetch, raw storage access, configuration changes, and artifact delivery. Source eligibility must come from trusted policy outside model-supplied arguments. [qmd-F8]

Keyword retrieval, semantic retrieval, and answer generation need separate acceptance. Hybrid search, embeddings, citation quality, source retirement, and a production corpus envelope remain untested. The inspected Roots runtime did not establish a QMD binding in the scoped files. [qmd-F3, F4, F11]

Workbench experiments use permitted frozen snapshots, pinned versions, and independent writable state. Credentials and writable production mounts stay outside the experiment. Separate directories alone do not prove containment. Production prompts, knowledge, or policy change only through reviewed promotion into an approved release. Existing corpus and ownership controls must survive repository changes. [rstruct-F9, proposed contracts]

### 9. Bounded beta and v1 acceptance

The proposed v0.7-beta includes the portable loader, typed acyclic graph compiler, simulation mode, coordinator controls, and one measured runtime target. It also includes module integration, authorized retrieval at the chosen scope, and two generic demos. Its release statement lists only tested behavior. Documentation-only adapters remain experimental.

V1 additionally requires the same workflow on two supported harnesses, a mapping-only switch, and actual interrupted handoff without repeating completed effects. Both release gates require proven mandatory controls within their claimed scope. V1 broadens the evidence for recovery, schema migrations, retrieval, model routing, and independent evaluations. It does not inherit untested platform or scale claims.

Both demos begin with a clean installation, portable source, synthetic inputs, pinned dependencies, declared permissions, and acceptance instructions. The current composition fixture produced a fixed HTML artifact and a fixed invoice report. These are contract demonstrations, not completed product demos. [contracts-F4]

The proposed personal-agent documentation entry is `docs.sagetrellis.ai`. The documentation site and onboarding tool remain proposed targets. The proposed command is `trellis up --demo --pro`. Alternative profile flags are `--5x` and `--20x`.

Onboarding infers a subscription profile only when known. Otherwise, it requests a choice. Measured admission still governs launch. Headless startup runs without an interactive application window. It reports readiness and progress, then returns the local demo and acceptance instructions. [Founder requirements]

For the technical-founder path:

1. Submit the frozen synthetic local-application brief through a personal agent.
2. Review the proposed graph, owners, allowed effects, and acceptance criteria.
3. Run the workflow through the admitted harness.
4. Inspect structured progress and artifacts.
5. Open the built local application.
6. Execute the brief's acceptance instructions.
7. Make sure that protected publication refuses missing approval and approval for changed content.
8. Interrupt the workflow.
9. Recover through recorded state and artifacts.
10. Make sure that completed actions do not repeat.

For the administrative-founder path:

1. Load the two synthetic invoices for 1,200 and 3,400 cents.
2. Request the report.
3. Inspect its proposed graph and permission scope.
4. Make sure that the proposed result contains count two and total 4,600 cents.
5. Before the broker publishes its local report artifact, approve the exact candidate.
6. Change the candidate.
7. Make sure that the old approval cannot authorize it.
8. Repeat a completed request.
9. In a separate case, cancel before dispatch.
10. Exercise ambiguous-outcome recovery without duplicate publication.

The complete portability suite also covers clean clone/start, mandatory-capability removal, reproducible generation, generated-file drift, and contributor experiment isolation. Beta must pass the applicable runtime cases. The two-harness workflow, switch, and handoff complete the v1 portability gate. Every pass needs saved evidence rather than a simulator label.

### 10. Implementation queue and preservation

This queue begins only after specification approval. One integration feature branch, `feature/trellis-v1`, remains the review home. That branch does not decide repository topology.

| Gate | Work and owner | Exit evidence |
|---|---|---|
| 0. Founder specification | Hanna settles the decisions below | Approved revision, scope, topology, runtime direction, and unresolved items explicitly bounded |
| 1. Preservation and import | Integration ownership maps retained files and PRs into the chosen layout | Reviewed disposition map, license reconciliation, private-content boundary, retained recovery sources |
| 2. Contracts and source | Coordinator and module owners implement shared contracts, YAML validation, versioning, graph compiler, simulation | Actual schema engine. Invalid graph/path/version cases. Generation, drift, migration and rollback tests |
| 3. Control state | Coordinator implements ownership, approval, admission, cancellation, and recovery | Actual runtime failure matrix, authenticated scope, persistent reservations, ambiguous-effect holds |
| 4. First harness | Crew implements the selected adapter and platform runner | Effective-policy denial tests, subscription route, measured admission, startup and complete teardown |
| 5. Module integration | Module owners bind Relay, Roots, Vines, and Crew. The integration owner freezes the synthetic application brief and measurable pass/fail behavior. | Request/event compatibility, approved retrieval boundary, trace evidence, two-team access and state tests. The application brief is ready before demo acceptance. |
| 6. Beta acceptance | Integration owner assembles both demos and release manifest | Clean setup, application/workflow acceptance, recovery runbook, documented limits, exact-revision founder approval |
| 7. Sagespec handoff | Separate product lead and team, once appointed | Approved product brief, pinned beta, own definitions/state/credentials/approvals, shared-account admission |
| 8. V1 hardening | Trellis owners continue. Workbench supplies independent evidence | Second harness and all portability cases. Calibrated profiles, broader retrieval/recovery evidence, reviewed promotion |

The preservation map labels each historical file and PR preserve, reapply, supersede, or leave for review. While porting accepted changes, keep original branches, PR links, and stacked base relationships. The snapshot found 15 open module PRs. Four Crew PRs target `feat/codex-v1`. Shallow research clones are not historical backups. [rstruct-F7]

Do not close PRs, flatten branches, delete checkouts, rewrite history, or change visibility to simplify migration. Review a sanitized framework-only import. Keep private practice material, credentials, state, private evaluation data, and the old workbench outside it. No old-wiki work belongs in this queue.

Before release, reconcile MIT and package metadata. The snapshot found conflicting Relay metadata and missing tracked licenses in the coordinator and Workbench. No full dependency or publication audit cleared a distribution. Preserve the old team's stopped state and disabled schedules. The ten listed automation workflows were disabled. That observation does not cover every scheduler. [rstruct-F6, F8]

Prepare the founder review at 9 a.m. America/New_York. Include outcomes, acceptance instructions, tests, usage, gaps, risks, and decisions. Measure task success, founder intervention, usage per accepted result, completion time, recovery reliability, and retrieval accuracy. No release date or daily output rate is supported yet. Agent implementation and review remain subordinate to exact-revision founder approval. [Founder requirements]

## Decisions for Hanna

1. Repository topology: the notes recommend one framework source repository with separate module directories and artifacts. This requires reviewed imports, packaging changes, and consolidated CI. Coordinated module repositories preserve existing access and branch homes but require explicit release pins and PR dependency tracking. Both need shared contract tests and complete rollback manifests.
2. Import scope and release prerequisites: approve the sanitized framework-only file/PR map before moves. Retain historical work while accepted changes are ported. Require license reconciliation, reproducible pins, preserved Workbench controls, and actual clean setup before release readiness.
3. Initial runtime support: choose two experimental adapters pending gates on this Mac, or test one harness first. The two-adapter choice covers Codex and Claude. It tests portability earlier. Testing one harness first reduces initial integration work. The notes propose Codex first. Neither choice supports a certified-runtime claim today.
4. Open-source breadth: defer OpenCode and retain Goose as a documentary candidate, or authorize a separate bounded repair/install/validation pass. Broader coverage adds configuration and nested-accounting work. OpenCode's conflicting subscription claims do not authorize that route.
5. Mandatory action boundary: choose read/propose with a separately enforced action broker, or include broader tools in the initial contract. The broader choice includes direct code and external-action tools. It requires broader escape and permission tests. Documentation, fixtures, and native proof remain separate. Weakening mandatory proof requires a revision to the founder's control requirements.
6. Recovery implementation: the notes recommend a local durable journal and one dispatch authority for beta. DBOS with self-hosted Postgres is the alternative, pending a live spike. The local choice leaves more recovery tooling to Trellis. DBOS adds engine and database operations. Both retain ambiguous-effect reconciliation and artifact-based portable handoff.
7. Retrieval scope: choose explicit keyword retrieval over an authorized corpus for beta, or require semantic/hybrid validation first. Keyword scope is narrower and failed both selected paraphrases. Semantic scope adds model isolation and resource validation.
8. Retrieval access and targets: choose separate indexes with enforced process boundaries, or a trusted broker over shared state. The broker must close every unauthorized path. Separate indexes can duplicate storage. Shared state enlarges the authorization surface. Set exact/paraphrase recall, stale-evidence, access, and missing-answer criteria. Choose whether to accept the 5,000-short-document observation or require more tests before choosing the v1 envelope. Those further tests cover byte volume and semantic retrieval.
9. Capacity calibration and routing: choose proven freshness sources and measured sampling limits, job allowances, route mappings, and unattended-operation limits. The founder's 25 percent reserve and existing-subscription requirement remain in force. The notes recommend expressing the reserve as an admission policy with stated limits. No fixture selects a threshold or profile calibration. Live Claude work remains pending valid admission. Paid fallback stays disabled.
10. Module contracts and demos: approve or revise the proposed ownership/contracts and two-demo acceptance criteria. The founder already directed beta acceptance before a separate Sagespec team starts. That team needs its own lead, product brief, and writable state. Trellis v1 work continues independently. This decision does not choose the Sagespec lead or product scope.

## Gaps

The evidence does not demonstrate a certified runtime, live two-harness workflow, or real cross-harness recovery. It also does not demonstrate authenticated approval, effective OS containment, production module integration, or full schema conformance. Real connector reconciliation, storage failure coverage, backup/restore, migration compatibility, and process teardown remain acceptance work.

There is no calibrated worker tier, measured model-route comparison, subscription reporting-delay bound, empirical job allowance, or hard provider quota reserve. There is no full RAG result, semantic benchmark, production corpus maximum, enforced retrieval authorization, or automatic source-retirement proof.

Repository migration, package publication, private-history clearance, dependency licensing, App write permissions, and required-review enforcement remain unverified. No measured migration cost, human intervention rate, operational recovery target, or release date is available. These gaps constrain claims and gates. They are not passed requirements.

## Sources

All reviewed observations and retrieved documentation below are dated October 1, 2026. Fact IDs address the confirmed register. Proposals and founder requirements remain distinct from measurements.

- Founder requirements: [specification baseline](founder-requirements.md) and [round one](round-one.md).
- Evidence register and verdicts: [CHECK.md](evidence-index.md#review-records). Exact commands, pins, raw observations, proposed contracts, and decision options are in the six checked notes.
- Module contracts, `contracts-F1` to `F4`: [module notes](evidence-index.md#review-records).
- Repository evidence, `rstruct-F1`, `F4`, `F6` to `F10`: [repository notes](evidence-index.md#review-records), with exact-revision source and dated GitHub responses.
- Harness evidence, `hp-F1` to `F4`, `F6` to `F8`, `F12`, `F15`, `F18`, `F20`, `F21`: [harness notes](evidence-index.md#review-records). Primary sources include [Codex permissions](https://learn.chatgpt.com/docs/permissions), [Claude settings](https://code.claude.com/docs/en/settings), [Claude sandboxing](https://code.claude.com/docs/en/sandboxing), [OpenCode providers](https://opencode.ai/docs/providers/), and [Goose ACP](https://goose-docs.ai/docs/guides/acp-providers/).
- Durability, `durable-F1` to `F10`: [durability notes](evidence-index.md#review-records). Primary sources include [DBOS architecture](https://docs.dbos.dev/architecture), [workflow behavior](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial), [step behavior](https://docs.dbos.dev/typescript/tutorials/step-tutorial), and [management methods](https://docs.dbos.dev/typescript/reference/methods).
- Capacity, `capacity-F1` to `F5`, `F7` to `F9`: [capacity notes](evidence-index.md#review-records). Primary sources include [Claude status-line fields](https://code.claude.com/docs/en/statusline), [shared subscription usage](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan), and [cached usage](https://code.claude.com/docs/en/costs).
- Retrieval, `qmd-F1`, `F3`, `F4`, `F6` to `F8`, `F11`, `F12`: [QMD notes](evidence-index.md#review-records). The notes identify corrected scores and original raw outputs. Primary sources include the [QMD v2.8.3 README](https://github.com/tobi/qmd/blob/v2.8.3/README.md) and [package manifest](https://github.com/tobi/qmd/blob/v2.8.3/package.json).

The founder gate is approval or revision of this exact candidate and its named decisions. Research completion alone authorizes no production implementation, repository migration, release, or merge.
