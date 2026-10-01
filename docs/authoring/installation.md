# Prepare an authored alpha installation

The trusted controller prepares an authored snapshot and provisions its storage. These helpers start no models, DBOS workflows, browsers, or containers.

The controller supplies authenticated owner subjects, epochs, exact permission grants, the existing admission account, and the installed tester's canonical manifest.

Project text supplies none of that authority. The helpers compare supplied bindings; they do not authenticate the caller or discover registrations.

## Inputs

Use `prepareAuthoredCraftShop` and `provisionAuthoredInstallation` from `apps/cli/src/provision.ts`.

The accepted scenario is `craft-shop-v1/r1`, with digest:

```text
sha256:bc620b68e6c6a147f0e121327d5175a50c0b89ea23514e3202b8464ccb6827b8
```

The controller reads those exact Workbench bytes independently. Changing the embedded scenario and recomputing bundle hashes does not select a different installation profile.

Obtain `registeredManifest` from the reviewed installed tester. The existing Linux executor derives it from pinned implementation, runner, contract, and environment assets.

Do not copy the authored bundle's manifest into the controller registration. A matching agent-supplied string alone proves no registration.

The current session CLI separately checks its installed executor against the graph's pinned manifest before dispatch.

## Prepare

```ts
const authority: AuthoredInstallationAuthority = {
  bundle: exportedAuthoredCrew,
  frozenScenario: trustedScenarioBytes,
  registeredManifest: installedTester.manifest,
  permissions: {
    maker: [
      { operation: 'workspace.write', path: 'output/design/index.html' },
      { operation: 'command.test', command: 'craft-shop-ui-v1' },
    ],
    editor: [
      { operation: 'workspace.write', path: 'output/job-board/index.html' },
      { operation: 'command.test', command: 'craft-shop-ui-v1' },
    ],
  },
};

const graph = await prepareAuthoredCraftShop({
  ...authority,
  destination: '/absolute/private-parent/new-snapshot',
  workspaceId: 'operator-workspace',
  runId: 'operator-run',
  owners: {
    maker: { subject: 'authenticated:maker', epoch: 4 },
    editor: { subject: 'authenticated:editor', epoch: 5 },
  },
});
```

Use the actual authored owner IDs. One owner also works when its grants include both exact writes and the registered test.

Every controller grant must match its owner's declared permission. Only the two exact scenario write paths and registered test are accepted.

Preparation validates all bundle bytes, maps, scenario, tester, and bindings before creating a directory. The destination's existing parent must be private and owned.

Creation is exclusive. Existing destinations, symlink aliases, public parents, file collisions, and path-prefix collisions are refused.

The snapshot contains generated crew YAML with unchanged semantics and every pinned asset byte. The helper recompiles it and compares the entire plan.

Directories use mode `0700`; files use `0600`. Output directories exist, but no HTML output is created during preparation.

A failed creation leaves its new partial directory for inspection. The helper never overwrites or removes an older snapshot.

Protect the source snapshot from concurrent local writers. Filesystem checks do not isolate another process with the same operating-system authority.

## Provision

```ts
const receipt = await provisionAuthoredInstallation({
  installationId: 'alpha-authored-example',
  database: existingLoopbackDatabase,
  schemas: distinctUnusedSchemasWithExistingAdmission,
  graph,
  bridge: { accountAlias: existingAlias, modelRoute: admittedModelRoute },
  workspaceRoot: '/absolute/private-parent/new-snapshot',
  codex: { stopUsedPercent: effectiveStopThreshold },
}, authority);
```

The structural configuration also accepts the existing controller's complete private `LocalInstallation` object. Its format remains unchanged.

Provisioning reconstructs the graph and compares it before reading credentials. It checks private snapshot bytes and recompiles the plan before database access.

The existing transaction creates runtime, broker, effects, graph, and test schemas together. It requires the existing admission schema and account.

It creates no account, records no usage, reserves no allowance, and changes no capacity policy. The receipt records `launches: 0`.

Existing target schemas and foreign DBOS workflow history are refused. Alpha still requires one live installation and coordinator per selected database.

Unknown commit acknowledgement returns `PROVISION_COMMIT_UNKNOWN`. Inspect persisted schemas before another attempt; do not assume the transaction failed.

The legacy `prepareEndorAlpha` and `provisionLocalInstallation` remain available for earlier prepared-crew proofs.

## Remaining acceptance

Automated tests use synthetic manifests and isolated PostgreSQL databases. They prove preparation, rejection, atomic rollback, and preservation of held allowance.

The Workbench runner and live authored-crew acceptance remain separate work. Provisioning success is neither effect approval nor completed browser acceptance.
