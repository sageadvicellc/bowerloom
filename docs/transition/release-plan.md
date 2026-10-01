# Trellis release plan

Hanna added `v0.7-alpha` on October 1, 2026. Codex is its first harness. The milestone enables founder testing, a baseline for beta comparisons, and marketing preparation before beta.

The canonical release sequence is `v0.7-alpha`, `v0.7-beta`, `v1-beta`, and `v1-rc`. A release candidate is a build proposed for final acceptance. Legacy names such as `Sagespec v3` remain historical references. Current plans use the canonical release names.

Sagespec is Hanna's flagship product built on Trellis to automate her entire business. Its implementation starts on accepted `v0.7-beta` and proceeds in reviewed stages.

## Release sequence

| Milestone | Purpose | Required evidence |
|---|---|---|
| v0.7-alpha | Give Hanna a usable Codex-first release on this Mac | A complete local workflow, live control tests, reviewable results, test instructions, and known limits |
| Alpha use | Establish the beta baseline and enable a marketing and social crew | Repeatable test records, defects, separate crew state, and reviewable campaign drafts |
| v0.7-beta | Support Codex and Claude Code with two tested demonstration paths | Live controls on both harnesses, both demos, alpha comparisons, and recovery instructions |
| Sagespec development | Build the flagship for automation of Hanna's entire business on accepted beta | Separate product scope, lead, permissions, and writable state |
| v1-beta | Exercise the full framework scope and prove portability | Workflow switching, interrupted handoff, and broader reliability evidence |
| v1-rc | Prepare the release candidate for final acceptance | Repeatable release tests, resolved release blockers, pinned artifacts, and recovery instructions |

The release names and harness sequence are approved. Detailed acceptance criteria remain part of the specification proposal. `v0.7-alpha` is Codex-first, and `v0.7-beta` requires Codex and Claude Code.

## Company beta

Beta must support independent personal installations and shared company use. One company server serves multiple employees who retain autonomous personal installations on their machines. Both uses coexist. Joining the company must preserve personal independence.

Proposed tests cover private personal state, scoped company access, concurrent company work, server outages, revoked access, and reconnection. Company work retains explicit ownership during disconnection. Personal work remains independently useful. Supabase is a conditional requirement, with PostgreSQL throughout as the favored direction. Exact packaging and the workflow engine remain proposed. No implementation passed these tests yet.

## Backend and data gates

The proposed alpha backend packages Supabase and PostgreSQL with usable setup, restart recovery, and optional telemetry disabled by default. The proposed runtime uses the MIT DBOS library without Conductor. Resource and compatibility tests must establish suitability.

Beta adds shared knowledge access, consent withdrawal, offboarding, and deletion tests. Tests cover source documents, embeddings, files, caches, traces, and stored workflow data. Backup expiry and restoration after deletion need separate evidence. Detailed product retention schedules remain outside generic framework defaults.

## Proposed alpha baseline

The team freezes the task definitions, synthetic inputs, acceptance criteria, and version references. Each run records success, founder interventions, elapsed time, observed usage, and recovery outcomes. Missing observations remain explicit.

Beta repeats the same tasks for comparison. Changed tasks receive new versions. The records must distinguish software changes from changes in the experiment.

Alpha must exercise real Codex sessions within its declared scope. Synthetic fixtures alone do not satisfy release acceptance. Portable definitions and mandatory controls remain requirements from the first release.

## Early marketing work

A separate marketing and social crew can prepare campaign work during alpha use. It does not depend on beta completion. It has its own scope, permissions, writable state, and share of account capacity.

This record does not start that crew or appoint its lead. Sagespec product development retains its beta dependency. No campaign material is sent or published by this specification update.
