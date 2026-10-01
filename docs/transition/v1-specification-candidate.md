---
type: report
status: draft
created: 2026-10-01
updated: 2026-10-01
brief: evidence-index.md
check: evidence-index.md
audience: Hanna
---

# Trellis specification candidate

## Summary

The founder selected Codex-first `v0.7-alpha` for personal testing, baseline measurements, and marketing preparation before beta. Trellis v0.7-beta follows, then a separate Sagespec product team. This candidate proposes contracts, acceptance gates, and implementation order. The research does not yet establish a working release or settle every architecture choice.

The next decision is the [alpha build approval packet](alpha-build-approval.md). It bundles recommended defaults and separates alpha implementation from later release gates. It does not record founder approval.

## Findings and proposed specification

### 1. Product boundary and release sequence

The canonical release sequence is `v0.7-alpha`, `v0.7-beta`, `v1-beta`, and `v1-rc`. A release candidate is a build proposed for final acceptance. Legacy names such as `Sagespec v3` remain historical references. Current plans use the canonical release names.

Trellis is the MIT-licensed, self-hosted framework for owners who direct automation through personal agents. Sagespec is Hanna's flagship product built on Trellis to automate her entire business. Generic examples belong in Trellis. Sagespec's product brief, business rules, knowledge, and assets belong in its own project.

Codex-first `v0.7-alpha` precedes `v0.7-beta`, which supports Codex and Claude Code. Sagespec development starts on the accepted beta and targets automation of Hanna's entire business. Alpha gives Hanna a working test release and a measured baseline for beta. It also enables a marketing and social team to prepare the campaign before beta.

The marketing team is separate from the later Sagespec product team. Each crew needs its own scope, permissions, writable state, and shared-account capacity accounting. Trellis `v1-beta` and `v1-rc` work continues alongside downstream product development. This specification appoints neither lead and starts neither team.

Beta must test independent personal installations and shared company use. Multiple employees work through one company server while retaining autonomous personal installations on their own machines. Personal use and company participation coexist. This is an approved founder requirement. Supabase is now a conditional backend requirement. PostgreSQL throughout is the favored direction, while packaging and execution details remain proposals.

The founder requested Endor and Star Wars references in tutorials, example names, and occasional success messages. The [language direction](language-and-tutorials.md) maps independent installations to trees and scoped connections to bridges. Technical terms, commands, permissions, and approval text remain explicit.

Coda is the Solution Lead and Emery the Design Lead in the default demonstration crew. These are configurable crew roles. Their names grant no universal framework privilege. Leads propose work within enforced ownership, permission, budget, and approval rules.

Framework approvers are configurable and authenticated. For this campaign, only `hannasage` reviews and merges the exact candidate revision into `main`. Agents never push or merge into `main`. Agents review one another and merge into feature branches within approved work. Each integration merge requires independent review and relevant passing tests. It does not require separate founder approval. [Founder requirements, clarified October 1, 2026]

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

The following boundaries are proposed. One versioned contract package supplies shared fields and acceptance fixtures. Modules own specialized payloads and retain explicit build boundaries inside the approved monorepo.

A graph records tasks and their dependencies. A harness runs an agent session. An adapter connects Trellis to an external tool.

| Component | Owns | Required boundary |
|---|---|---|
| Coordinator | Graph compilation, durable task state, claims, admission, approvals, execution, cancellation, recovery | Code decides whether work can proceed. Conversation cannot change authority. |
| trellis-crew | Portable teams, prompts, skills, model mappings, permissions, harness adapters | Harness files are generated views. Missing required behavior blocks launch. |
| trellis-relay | Addressed messages, delivery receipts, team conversations, event references | Delivery neither transfers task ownership nor proves completion. |
| trellis-roots | Versioned sources, retrieval, access, citations, freshness, supersession | Retrieved prose is evidence and cannot grant permission. |
| trellis-vines | Observations, audit exports, usage observations, evaluation evidence | Audit records do not decide workflow state. General metadata excludes private content. |
| trellis-workbench | Isolated experiments, pinned inputs, comparisons, promotion evidence | An experiment cannot change production or promote itself. |

The coordinator is a framework component, not a sixth named module. It resides in the approved framework monorepo. Existing Crew, Relay, Roots, and Vines interfaces cover parts of these boundaries. They do not implement the complete proposal. [contracts-F1 to F3]

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
| Codex 0.157.0 | Local help/version and structured interfaces | Selected first harness for alpha. Live control tests remain required. |
| Claude Code 2.1.286 | Local help/version and structured interfaces | Required alongside Codex for v0.7-beta. Live control tests and valid capacity admission remain required. |
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

The founder now favors PostgreSQL throughout and requires Supabase if it satisfies the stated needs. Ease of use includes installation, maintenance, and Studio access. The v1 core must avoid proprietary coordination dependencies. [Founder direction, October 1]

The [storage and data lifecycle direction](storage-and-data-policy.md) proposes Supabase-backed PostgreSQL and the MIT DBOS library with one supervised coordinator per installation. It excludes Conductor from the core. Exact packaging and engine adoption remain proposals pending tests. The [earlier comparison](shared-durability-options.md) retains its documentary findings, but its optional-Supabase and lightweight-storage recommendation predates this direction.

The proposed company boundary keeps company task ownership and approvals on the company server. Personal installations retain private definitions, credentials, and state. Employees select a company workspace explicitly. Company participation does not grant access to unrelated local files, credentials, or personal work.

Local execution of company tasks requires a scoped grant and declared machine capacity. Personal work can continue during a company outage. Disconnected workers cannot assume new company authority. Reconnection must resolve stale ownership and uncertain effects before company work resumes. These boundaries remain proposed acceptance requirements, not implemented capabilities.

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

### 8a. Shared knowledge and data lifecycle

Roots must support centralized company knowledge with scoped access to sources, citations, chunks, and embeddings. Personal and client-private corpora remain separately authorized. Shared infrastructure grants no access by itself. Supabase does not replace Roots source tracking or retrieval policy.

Vines must separate necessary local operational records from optional telemetry sent to Sage Advice. Optional transmission starts disabled. Consent identifies the recipient, purpose, permitted fields, and retention policy. Revocation stops new optional collection and transmission. Every retained class needs a deletion rule.

A versioned policy must name owners, retention triggers, deadlines, and deletion methods. Offboarding revokes access and stops scoped workers and streams. Export and retained-data deletion follow their declared policies. A retained copy grants no continuing monitoring permission.

Deletion must cover source records, derived embeddings, caches, traces, file objects, workflow arguments and results, and controlled exports. Backups need explicit expiry. Restoration must apply deletion records before serving restored data. A soft-delete marker alone does not satisfy deletion. Detailed periods remain product policies, separate from generic framework requirements.

### 9. Release acceptance

Alpha is a usable Codex-first release on this Mac. Its proposed acceptance requires a complete local workflow through portable definitions, structured progress, and a reviewable result. Its supported actions must pass live permission, approval, capacity, cancellation, and recovery tests. Alpha records known limits and recovery instructions. A renamed simulation does not satisfy this milestone.

The proposed alpha backend uses Supabase and PostgreSQL. Acceptance must include usable setup, process restart, and optional telemetry disabled by default. This proposal requires measured resource and compatibility evidence.

Alpha freezes repeatable tasks, synthetic inputs, acceptance criteria, and versions for beta comparison. Runs record accepted outcomes, founder interventions, elapsed time, observed usage, and recovery results. Missing measurements remain explicit. Alpha also supports a separate Codex marketing crew that produces reviewable campaign drafts. Beta completion is not a prerequisite for that crew.

The proposed `v0.7-beta` includes the portable loader, typed acyclic graph compiler, simulation mode, and coordinator controls. It requires Codex and Claude Code support with live control evidence. It also includes module integration, authorized retrieval at the chosen scope, and two generic demos. Its release statement lists only tested behavior. Documentation-only adapters remain experimental.

Beta also requires independent personal installations and a company server with multiple employees. Proposed acceptance tests cover concurrent company tasks, private-state separation, scoped machine access, server outages, employee disconnection, access revocation, and reconnection. Tests must make sure that personal work continues independently and stale company ownership cannot dispatch actions. No existing fixture establishes these results.

Beta must also test limited access to shared knowledge and consent withdrawal. Its data tests cover embeddings, direct storage reads, deletion failures, backup expiry, and restoration after deletion. These are proposed gates, not completed results.

The proposed `v1-beta` adds a mapping-only harness switch and interrupted handoff without repeating completed effects. `v0.7-beta` already requires the common workflow and mandatory controls on Codex and Claude Code. Every release gate requires proven mandatory controls within its claimed scope. `v1-beta` broadens the evidence for recovery, schema migrations, retrieval, model routing, and independent evaluations. It does not inherit untested platform or scale claims.

The proposed `v1-rc` fixes a candidate revision and repeats the release acceptance suite against its packaged artifacts. Blocking defects require fixes and renewed tests. Its release record includes pinned versions, supported platforms, known limits, and recovery instructions.

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

The complete portability suite also covers clean clone/start, mandatory-capability removal, reproducible generation, generated-file drift, and contributor experiment isolation. `v0.7-beta` must pass the common workflow and applicable runtime cases on Codex and Claude Code. The switch and interrupted handoff complete the proposed `v1-beta` portability gate. Every pass needs saved evidence rather than a simulator label.

### 10. Implementation queue and preservation

The remaining implementation queue begins after specification approval. Hanna selected `sageadvicellc/trellis` as the monorepo on October 1, 2026. The integration branch remains `feature/trellis-v1`. Sagespec stays in a separate repository.

This queue covers the full roadmap. The current approval packet authorizes work only through alpha acceptance. Later milestones retain their stated gates.

Workers branch from the integration branch and open task pull requests against it. Another agent reviews each change against its acceptance criteria. The integration lead merges accepted work into the feature branch and runs relevant integration tests. Changed code needs renewed review and tests. Hanna receives the assembled feature for review and merge into `main`.

| Gate | Work and owner | Exit evidence |
|---|---|---|
| 0. Founder specification | Hanna decides on the bounded alpha build packet | Approved alpha scope, recommended defaults, delegated engineering choices, and explicit later gates |
| 1. Preservation and import | Integration ownership maps retained files and PRs into the monorepo | Reviewed disposition map, license reconciliation, private-content boundary, retained history and recovery sources. Archive old repositories after cutover gates pass. |
| 2. Contracts and source | Coordinator and module owners implement shared contracts, YAML validation, versioning, graph compiler, simulation | Actual schema engine. Invalid graph/path/version cases. Generation, drift, migration and rollback tests |
| 3. Control state | Coordinator implements ownership, approval, admission, cancellation, and recovery | Actual runtime failure matrix, authenticated scope, persistent reservations, ambiguous-effect holds |
| 4. First harness | Crew implements Codex and the platform runner for alpha | Effective-policy denial tests, subscription route, measured admission, startup and complete teardown |
| 5. Module integration | Module owners bind Relay, Roots, Vines, and Crew. The integration owner freezes the synthetic application brief and measurable pass/fail behavior. | Request/event compatibility, approved retrieval boundary, trace evidence, two-team access and state tests. The application brief is ready before demo acceptance. |
| 6. Alpha acceptance | Integration owner delivers the usable Codex-first release | Local workflow, live control tests, founder test instructions, known limits, baseline records, exact-revision founder review |
| 7. Early use | Hanna tests alpha. A separate marketing and social crew prepares campaign drafts when started. | Repeatable measurements, actionable defects, separate crew state and permissions, shared-account admission. No beta dependency. |
| 8. Beta acceptance | Integration owner assembles both demos on Codex and Claude Code | Both harnesses, independent personal use, simultaneous company participation, autonomy tests, alpha comparison, and exact-revision founder approval |
| 9. Sagespec handoff | Separate product lead and team, once appointed | Approved product brief, pinned beta, own definitions/state/credentials/approvals, shared-account admission |
| 10. v1-beta | Trellis owners harden the full framework scope. Workbench supplies independent evidence. | All portability cases, calibrated profiles, broader retrieval/recovery evidence, reviewed promotion |
| 11. v1-rc | Integration owner prepares the release candidate | Pinned artifacts, repeated release suite, resolved release blockers, recovery instructions, and exact-revision founder review |

The preservation map labels each historical file and PR preserve, reapply, supersede, or leave for review. While porting accepted changes, keep original branches, PR links, and stacked base relationships. The snapshot found 15 open module PRs. Four Crew PRs target `feat/codex-v1`. Shallow research clones are not historical backups. [rstruct-F7]

Do not close PRs, flatten branches, delete checkouts, rewrite history, or change visibility to simplify migration. Review a sanitized framework-only import. Keep private practice material, credentials, state, private evaluation data, and the old workbench outside it. No old-wiki work belongs in this queue.

Before release, reconcile MIT and package metadata. The snapshot found conflicting Relay metadata and missing tracked licenses in the coordinator and Workbench. No full dependency or publication audit cleared a distribution. Preserve the old team's stopped state and disabled schedules. The ten listed automation workflows were disabled. That observation does not cover every scheduler. [rstruct-F6, F8]

Prepare the founder review at 9 a.m. America/New_York. Include outcomes, acceptance instructions, tests, usage, gaps, risks, and decisions. Measure task success, founder intervention, usage per accepted result, completion time, recovery reliability, and retrieval accuracy.

No release date or daily output rate is supported yet. Agents coordinate implementation, peer review, and feature merges within approved scope. Hanna reviews the assembled feature and merges its exact approved revision into `main`. [Founder requirements]

## Decision for Hanna

The immediate decision is approval of the linked alpha build packet and its recommended defaults. Approval opens the Codex-first implementation campaign. It does not approve a release, merge into `main`, repository retirement, or customer-data collection.

For alpha, the proposal uses Supabase/PostgreSQL, the MIT DBOS library without Conductor, one supervised coordinator, and a controlled action broker. Workers propose bounded workspace changes and test commands. The broker authorizes and dispatches them. Mandatory controls require live evidence before alpha acceptance.

Alpha uses authorized keyword retrieval over synthetic sources and keeps optional telemetry disabled. The team owns compatible version selection, package layout, and implementation details within these limits. Supabase suitability must pass before adoption. A material failure returns a concrete finding and alternatives to Hanna without silently weakening the requirement.

The following choices remain gated later:

1. Beta semantic retrieval needs an embedding model, generation location, frozen quality targets, and access tests before acceptance.
2. Shared company use needs isolation, worker ownership, revocation, reconnect, and recovery evidence while personal installations retain autonomy.
3. Sagespec retention schedules and telemetry treatment need reconciliation before customer use. Framework defaults do not inherit historical customer terms.
4. Capacity calibration needs reliable observations, measured allowances, and declared limits before unattended or tiered operation. The reserve and no-paid-fallback requirements remain fixed.
5. Additional harnesses and automatic replacement of a lost server remain outside the alpha scope. Beta still requires Codex and Claude Code.

The monorepo, release names, main-only founder merge authority, product separation, and personal autonomy requirements remain approved. The approval packet changes none of those decisions.

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

The founder gate is approval or revision of the alpha build packet with this candidate as its supporting specification. That approval authorizes the bounded implementation campaign and delegates its routine engineering choices. Until approval, the first-round specification boundary remains in force. Releases, repository retirement, and merges into `main` retain their separate gates.
