# Portable authoring

This package validates a personal agent's project files and exports their pinned bytes. It starts no model, process, database, or browser.

The alpha profile accepts one frozen craft-shop scenario. Owners, task names, prompts, skills, and output names remain authored choices.

## Files and revisions

| File | Versioned format | Purpose |
| --- | --- | --- |
| `authoring.json` | `trellis/authoring/v0.7-alpha` | Connect the project brief, crew, skills, maps, and scenario. |
| `crew.yaml` | `trellis/crew/v0.7-alpha` | Define owners, tasks, typed inputs, permissions, budgets, and approvals. |
| Skill descriptor | `trellis/skill/v0.7-alpha` | Bind text instructions to owners and required capabilities. |
| Relay map | `trellis/relay-map/v0.7-alpha` | Declare each dependency and accepted output handoff. |
| Vines map | `trellis/vines-map/v0.7-alpha` | Declare local logging channels for each task and owner. |
| Frozen scenario | `trellis/workbench-scenario/v0.7-alpha` | Pin the brief, synthetic inputs, test, and execution shape. |
| Export | `trellis/authored-crew/v0.7-alpha` | Carry the compiled plan and exact source snapshots. |

The authoring manifest is a portable project artifact. It provides no runtime identity, authentication, approval, or installation authority.

Every referenced document is a declared crew asset, including the authoring manifest itself. Skill instructions also appear in their owners' `skills` lists.

The existing compiler pins asset bytes in `candidateRevision`. `authoringRevision` additionally binds the exported snapshots, manifest asset identifier, and frozen scenario digest.

JSON contracts reject unknown fields, versions, duplicate keys, reserved prototype keys, and unsupported capabilities. Crew YAML retains the existing strict compiler rules.

Relay participants must equal the declared owners. Routes must match every dependency, owner pair, and typed input/output binding exactly.

Vines accepts `runtime.status`, `workspace.receipt`, and `test.acceptance` at the `local-session` sink. Each task must declare all three channels.

Vines remains a logging map. This package neither collects logs nor installs transports, changes approvals, or performs self-improvement.

## Alpha scenario

Workbench owns `craft-shop-v1/r1`. It requires exactly two sequential tasks and these paths:

1. `output/design/index.html`
2. `output/job-board/index.html`

Each task declares one HTML output, one write, and the registered `craft-shop-ui-v1` test. Exact approval and one attempt remain required.

The second task consumes the first task's accepted HTML output. One or two owners are supported; every declared owner owns a task.

Both tasks receive the frozen brief, browser contract, and synthetic orders. Extra declared inputs remain subject to the existing typed graph validation.

The registered tester supplies canonical manifest bytes. Offline validation checks their structure and binding; the installation must authenticate the actual registered tester separately.

A valid export does not authorize its manifest, test environment, owner bindings, budget, or effects for execution.

## API

```ts
const bundle = await compileAuthoring('/project/authoring.json', {
  scenarioFile: '/trusted-workbench/scenario.json',
  root: '/project', // Defaults to the manifest's directory.
});

const verified = validateAuthoredCrew(receivedJsonValue, frozenScenarioBytes);

const graph = authoredGraph(verified, frozenScenarioBytes, {
  workspaceId: 'operator-selected-workspace',
  runId: 'operator-selected-run',
  owners: {
    maker: { subject: 'authenticated:maker', epoch: 1 },
    reviewer: { subject: 'authenticated:reviewer', epoch: 1 },
  },
});
```

The caller selects trusted scenario bytes independently of the received bundle. Revalidation detects changed bytes, missing assets, forged digests, and incompatible graph bindings.

`authoredGraph` returns the existing `GraphInput`. Its binding values come from the trusted installation controller, after that controller's authorization checks.

```ts
interface AuthoredCrew {
  format: 'trellis/authored-crew/v0.7-alpha';
  plan: CompiledPlan;
  assets: Record<string, string>;
  manifestAsset: string;
  scenarioDigest: string;
  authoringRevision: string;
}
```

Returned bundles are detached and recursively frozen. Hashes establish content integrity; they are not signatures or proof of authority.

## Bounds

JSON documents are limited to 32 KiB. Assets are limited to 64 KiB each and 512 KiB combined.

Exported JSON is limited to 1 MiB. Existing graph value-depth, node-count, identifier, and plan limits also apply.

Authoring document and asset reads reject escaping paths, symlinks, hard-linked files, binary text, and detected changes. Compilation writes nothing.

Crew YAML retains the existing compiler's 1 MiB bound and source checks. Its semantic definition and declared assets determine the candidate.

The caller supplies a stable source directory. These checks do not establish filesystem isolation from a concurrent writer with the same operating-system authority.

Secrets, credentials, subscription state, approvals, execution receipts, and local runtime identities belong outside versioned project files.

## Integration boundary

The [authored installation helpers](../../docs/authoring/installation.md) consume this package's portable input and validation boundary. The live Workbench comparison runner remains separate work.

The installer must validate the bundle against trusted scenario bytes, match its registered tester, and supply authenticated owner bindings.

It must retain existing admission holds, exact approvals, controlled effects, cancellation, and uncertainty handling. Existing execution controls remain authoritative.

The reference fixture and authoring tests prove offline behavior. They do not prove a personal agent's authored crew completed a live run.
