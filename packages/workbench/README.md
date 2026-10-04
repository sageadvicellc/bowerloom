# Trellis Workbench

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

## Installed session runner

Authoring and installation happen before execution:

1. `compileAuthoring(authoringFile, { scenarioFile, root })` produces an `AuthoredCrew` snapshot.
2. `validateAuthoredCrew(bundle, frozenScenarioBytes)` verifies transported bytes and the bounded scenario shape.
3. `authoredGraph(bundle, frozenScenarioBytes, { workspaceId, runId, owners })` binds controller-supplied identities.
4. The [authored installation helpers](../../docs/authoring/installation.md) prepare private files and check the existing admission account and registered tester.
5. `createWorkbenchRunner(input, dependencies)` binds that installed graph and returns an explicit session runner.

The runner input contains the validated `bundle`, exact `frozenScenario` bytes, `installedGraph`, installed `registeredManifest` bytes, full 40-character `softwareRevision`, `installationId`, and `designation` (`authored` or `reference`). The scenario's independent digest is sealed in the runner. Bundle, graph, scenario, and tester mismatches fail before a session opens. It snapshots its input and returns detached JSON evidence.

`dependencies.sessions` is a trusted controller capability with an `installationId` and `open(mode)` method returning the existing CLI `SessionPort`. Supply it from the already provisioned installation; never take a factory, identity, installation path, or tester from model output. The runner checks the factory's installation ID and rechecks the opened port's stored graph before advancing, approving, or cancelling.

```ts
const runner = createWorkbenchRunner({
  bundle, frozenScenario, installedGraph, registeredManifest,
  softwareRevision, installationId, designation: 'authored',
}, { sessions: trustedInstalledSessions });

const pending = await runner.execute({ command: 'up', tier: 'pro' }, signal);
const review = await runner.execute({ command: 'review' }, signal);
// A separately authorized controller supplies the exact reviewed candidate and action.
const next = await runner.execute({ command: 'approve', candidate, action }, signal);
const json = serializeWorkbenchEvidence(next);
```

Commands are `up`/`start` with a tier, `read`, `review`, `approve` with exact candidate and action digests, and `cancel`. They delegate to `executeSession`: writes stop at each approval, dispatch stays sequential, and the existing runtime, effect, browser acceptance, cancellation, and cleanup controls still apply. There is no automatic approval. The tier is recorded without claiming a measured subscription rate.

`read` and `review` open the controller's read mode and never call advance, approval, or cancellation. An interrupted read refuses cancellation and still closes its port. Reconstructing the runner does not itself open a session or replay work. Only one command can run on a runner instance at a time; the installed coordinator remains responsible for cross-process exclusion.

The JSON command record includes:

| Field | Evidence |
| --- | --- |
| Source | Exact software revision and authored/reference designation |
| Candidate | Candidate revision, authoring revision, and bundle digest |
| Scenario | Scenario ID, revision, digest, and input digests |
| Environment | Registered tester and execution environment digests |
| Run | Installation/run identity and observed start/end timestamps |
| Outcomes | Latest graph status, task summaries, exact requested approval, durable receipts, and acceptance references; proposals appear only in review |
| Counts | Forwarded port-call attempts and latest observed durable proposals, receipts, acceptances, completed tasks, and model outcomes |
| Capacity | Usage, tokens, retained allowance changes, and actual model/browser/effect starts are unavailable because `SessionPort` exposes no such counters |
| Cleanup | Port close acknowledged, not opened, or unknown; an open or cleanup failure produces an unavailable outcome |

Counts of durable state may include earlier commands. They are not counts of effects performed by the current command. A completed graph is reported accepted only when every observed completed runtime task has a receipt and accepted evidence matching its graph completion. Missing or mismatched evidence yields incomplete. Pending, held, cancelled, failed acceptance, and unavailable states stay distinct. Failures expose bounded codes; arbitrary exception messages are omitted.

The controller must authenticate the caller, authorize approval and cancellation, seal the installed tester and source revision, preserve account holds, and persist returned evidence if a durable command journal is needed. An installation ID or source-revision string is a binding supplied by that trusted controller, not authentication or verification of the loaded executable. This runner cannot prove that an injected factory obeys read mode or closes every resource; `cleanup: closed` records the port's acknowledged contract. An ambiguous open has no returned capability to clean up, so the factory retains cleanup responsibility. There is no new database, provisioner, model route, or filesystem authority here.

The offline runner tests use synthetic ports. Live authored-crew acceptance remains pending. They establish no generated quality, A/B gain, throughput, subscription calibration, provider telemetry result, or independent restart safety of the installed runtime. `comparison` remains `not-evaluated`. Existing runtime and effect proofs retain their own scope.

Vines remains logging only. This slice starts no self-improvement or Sagespec campaign.
