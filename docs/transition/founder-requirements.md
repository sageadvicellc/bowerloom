# Trellis specification baseline

Status: founder requirements for the next specification draft. The founder approved the transition plan and authorized development on September 30, 2026, Eastern time.

This baseline records the founder's requirements and planning decisions from this conversation. It does not replace the research and specification approval gate. The current brief governs conflicting historical decisions.

## Product and release requirements

Trellis is the open-source tooling and framework for building self-managing systems. Sagespec is Hanna's flagship product built on Trellis to automate her entire business. Trellis and Sagespec have separate product scopes.

Deliver `v0.7-alpha` first with Codex. Hanna uses it for personal testing and records a baseline for beta comparisons. Alpha also enables a marketing and social team to prepare the campaign without waiting for beta.

Deliver `v0.7-beta` next. Then build Sagespec on that release through a separate product team with its own lead. Keep Trellis maintenance and Sagespec product delivery under separate ownership. The marketing team and Sagespec product team have different scopes. Their lead assignments remain future work.

Generic demonstrations belong to Trellis. Sagespec-specific workflows, business rules, knowledge, and product assets belong to the downstream Sagespec project. The framework must support multiple independent teams through portable definitions, explicit permissions, and separate writable state.

Trellis is an MIT-licensed framework for business owners who direct automation through their personal agents. V1 targets a reliable, self-hosted core. Its code enforces permissions, task ownership, resource limits, approval boundaries, and recovery behavior.

The v0.7-beta demo has two paths. Technical founders receive a built local application. Administrative founders receive a working business workflow. Both paths use synthetic business data and include acceptance instructions.

Coda is the Solution Lead. Emery is the Design Lead. Subscription profiles set a maximum of two to seven active workers, with lead activity included in usage accounting.

The five modules are trellis-vines, trellis-relay, trellis-roots, trellis-crew, and trellis-workbench. Hanna selected a monorepo on October 1, 2026. The framework modules move into `sageadvicellc/trellis` with separate interfaces, tests, and build boundaries. Sagespec remains a separate product repository. Exact module contracts remain part of the specification review.

Vines is the logging system. It records operational events and evidence. Self-improvement belongs to a later Sagespec layer built on Vines.

Hanna clarified this boundary on October 1, 2026. The alpha film excludes Sagespec and self-improvement references. Workbench retains repeatable crew testing.

Codex is the selected first harness for `v0.7-alpha`. Both Codex and Claude Code are required for `v0.7-beta`. Each requires live evidence for its declared controls. A harness is the agent tool that runs a session. Research also evaluates suitable open-source alternatives.

The canonical release sequence is `v0.7-alpha`, `v0.7-beta`, `v1-beta`, and `v1-rc`. A release candidate is a build proposed for final acceptance. Legacy names such as `Sagespec v3` remain historical references. Current plans use the canonical release names.

## Company use and personal autonomy

Beta must test independent personal installations and shared company use. Multiple employees work through one company server while retaining autonomous personal installations on their own machines. Personal use and company participation coexist. Joining a company must preserve that independence.

The specification must define ownership of company work and boundaries around private personal work. Proposed tests cover separate credentials and state, scoped company access, personal work during server outages, and safe reconnection. These detailed tests remain proposals. Supabase is a conditional requirement, subject to suitability for setup, access, recovery, and deletion. Hanna favors PostgreSQL throughout personal and company installations. The exact packaging and workflow engine remain proposed.

## Language and teaching

Hanna requested Endor and Star Wars references in nomenclature, tutorials, and examples. Use the connected tree-village idea to explain independent installations and scoped connections. Keep ordinary technical terms visible beside the metaphors. Preserve clear commands, permission language, errors, and approval instructions. The detailed tutorial vocabulary remains a proposal.

## Storage and data lifecycle direction

Hanna prioritizes ease of use for both technical and nontechnical founders. Supabase must remain in the supported backend design if it satisfies the stated needs. Studio is part of that requirement. The v1 core must avoid proprietary coordination dependencies.

Company embeddings and wiki content need centralized storage with limited, revocable access over secure connections. Personal and client-private content must retain explicit ownership and access boundaries. Joining a shared company instance preserves personal autonomy.

Trellis must support versioned retention and deletion policies. Optional telemetry sent to Sage Advice from Trellis or Sagespec requires explicit consent and a deletion policy. The detailed contract must cover derived data and backups. Historical Sagespec schedules require reconciliation before adoption. This requirement does not activate collection or authorize deletion of existing data.

## Portability is a core requirement

Trellis owns a metaharness layer, a configuration layer outside individual agent tools. This layer is the authoritative home for team and workflow definitions. Individual harness files are generated representations, not independent sources of truth.

The specification must include these requirements:

1. Store portable definitions in version-controllable text files. Include crew roles, prompts, skills, workflow graphs, permissions, model preferences, budgets, and evaluation requirements.
2. Reference shared files through repository-relative paths or declared environment parameters. Keep secrets, credentials, machine paths, runtime state, and private execution logs outside the portable definitions.
3. Version the definition format and its dependencies. Make changes reviewable through ordinary Git diffs. Provide explicit migrations and a recovery path for format changes.
4. Use adapters to translate Trellis definitions into supported harness behavior. An adapter is a connector for an external tool. Record adapter versions with each run.
5. Declare each harness's supported capabilities. Reject unsupported mandatory capabilities before execution. Never silently discard a permission, budget, approval rule, or required skill.
6. Keep harness-specific extensions explicitly named and optional to the portable core. Report their effect on compatibility before a user changes harnesses.
7. Preserve business intent and required controls across supported harnesses. Model choices and optional features can differ only through declared, reviewable mappings.
8. Give personal agents documented, structured interfaces for setup, execution, progress, approvals, and results. No single personal agent or vendor owns the user interface.
9. Keep workbench experiments independent of production configuration and writable state. Support portable experiment definitions with pinned module, adapter, model, and dataset references.
10. Document supported operating systems and prerequisites. Separate portable definitions from platform-specific installation and process control.

Portability does not promise identical model responses or transfer of hidden session state. Recovery uses recorded tasks, artifacts, and explicit handoffs. The supported platform and harness matrix remains a research deliverable.

## Portability acceptance scenarios

The research and release gates must include these scenarios:

1. Clone one example configuration into a clean supported environment. Start it without copying private harness directories or machine-specific files.
2. Run the same business workflow on two supported harnesses. Apply the same acceptance criteria and permission boundaries to both results.
3. Change the selected harness through a declared mapping. Keep the business workflow definition unchanged.
4. Remove a mandatory capability from an adapter. Make sure that execution stops before any affected action starts.
5. Regenerate harness files from the same source and adapter versions. Make sure that the generated configuration remains reproducible.
6. Detect edits that cause generated harness files to diverge from their source. Require an explicit reconciliation before those edits become authoritative.
7. Resume an interrupted task through its saved artifacts and handoff on another supported harness. Make sure that completed external actions do not repeat.
8. Run a contributor's benchmark separately from production. Make sure that neither credentials nor writable production state enter the experiment.

## GitHub identities

Prefer coda-crew for technical coordination and integration work. Prefer h4n-n4 for worker-authored activity. Use sagehanna if App access is unavailable or requires disproportionate setup work. Preserve the same role restrictions when using the fallback account.

The founder named the worker App as h4n-na. GitHub returned h4n-n4 as the registered worker App. The existing workbench helper supports both coda-crew and h4n-n4.

The observed identities are:

- coda-crew: App ID 5104842, owned by sageadvicellc.
- h4n-n4: App ID 5127467, owned by sageadvicellc.
- hannasage: founder approval identity, never an agent fallback.

Both Apps completed a scoped repository metadata read. coda-crew also pushed the review branch and created its draft pull request. Other App permission coverage remains untested.

Only hannasage reviews and merges the exact candidate revision into `main`. Agents never push or merge into `main`. Within approved work, agents review one another and merge task branches into feature branches without founder approval for each merge. An independent reviewer and relevant passing tests precede each integration merge.

The founder clarified this boundary on October 1, 2026. The founder-only merge rule applies to `main`, not feature branches. This direction supersedes earlier blanket merge restrictions in campaign records.

## Development operating requirements

Development runs on this Mac using existing subscriptions. Preserve 25 percent of reported subscription capacity through admission limits and an allowance for work already running. Pause new model work when reliable usage information is unavailable.

The founder reports that the handoff is complete and the old team is stopped. Preserve useful branches and evidence for review against the new specification. The startup inventory also shows that the listed workbench merge and agent automation workflows are disabled. The team will retire the five dispersed framework repositories after migration and cutover. Retirement means archive, not deletion. Preserve history and useful open work before archiving.

Prepare one daily review at 9 a.m. America/New_York. Include completed outcomes, acceptance instructions, test evidence, remaining risks, and required founder decisions. Measure task success, founder intervention, usage per accepted result, completion time, recovery reliability, and retrieval accuracy.

The first campaign completed its specification gate. Hanna approved the bounded alpha build on October 1, 2026. Implementation now follows that packet and its delegated engineering choices. Later release and main-merge gates remain separate.
