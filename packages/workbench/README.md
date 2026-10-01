# Trellis Workbench reference assets

Workbench owns frozen scenarios and reference crews used to compare authored crews. Trellis packages provide their portable contracts and execution controls.

The initial scenario is [craft-shop-v1/r1](scenarios/craft-shop-v1/scenario.json). Its brief and synthetic inputs are pinned by content digest and byte count.

The scenario freezes two sequential HTML outputs, their paths, and four browser criteria: add a job, change stage, reload, and export.

The [control crew](reference-crews/craft-shop-control/README.md) uses Coda and Emery. Personal agents choose their own roles, prompts, skills, and task names.

Historical examples and consumed proofs remain unchanged. This directory adds current reference material without rewriting earlier evidence.

## Frozen inputs

Select the scenario from trusted Workbench files before accepting an authored bundle. Never accept the bundle's own scenario as independent validation evidence.

Keep the frozen scenario, brief, and inputs unchanged for a comparison. A changed scenario requires a new revision and comparison record.

The tester manifest is supplied during preparation from the installed registry. It is absent from the versioned reference template.

Record its tester and environment digests in each comparison. A synthetic manifest is limited to offline test fixtures.

## Runner handoff

This directory contains assets, not a live scenario runner. The next integration uses these existing boundaries:

1. `compileAuthoring(authoringFile, { scenarioFile, root })` produces an `AuthoredCrew` snapshot.
2. `validateAuthoredCrew(bundle, frozenScenarioBytes)` verifies transported bytes and the bounded scenario shape.
3. `authoredGraph(bundle, frozenScenarioBytes, { workspaceId, runId, owners })` binds controller-supplied identities.
4. A generic installation adapter prepares private files and checks the existing admission account and registered tester.
5. Existing session commands execute the graph through runtime approval, effect, and acceptance controls.

The adapter needs the snapshot, trusted scenario, registered tester, private destination, installation policy, and authenticated owner subjects and epochs.

It must preserve consumed claims and held allowances. Neither authoring nor preparation starts a model or changes approval authority.

The runner's comparison record needs these fields:

| Field | Evidence |
| --- | --- |
| Source | Exact software revision and authored/reference designation |
| Candidate | Candidate revision, authoring revision, and immutable exported bytes |
| Scenario | Scenario ID, revision, digest, and input digests |
| Environment | Registered tester and execution environment digests |
| Run | Installation/run identity and observed start/end timestamps |
| Outcomes | Task proposals, exact approvals, write receipts, browser results, and accepted handoff references |
| Capacity | Available usage observations and retained allowance changes; unavailable counters stay unavailable |
| Restart | Evidence that replay and fresh reads did not repeat completed effects |

The runner and new live authored-crew comparison remain pending. Offline fixtures do not establish generated quality, throughput, subscription calibration, or provider telemetry.

Vines remains logging only. This slice starts no self-improvement or Sagespec campaign.
