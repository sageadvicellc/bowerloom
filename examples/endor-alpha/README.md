# Endor alpha craft-shop demo

Emery designs a working HTML prototype. After its exact write approval and registered browser acceptance, Coda receives that accepted HTML as the typed `draft` input and refines the final page. The two outputs use separate paths so refinement cannot overwrite the approved prototype.

Both pages must add a job, change its stage, preserve it through reload, and download matching JSON. The pinned [browser contract](assets/craft-shop-contract.md) supplies the identifiers and export format. The included orders are fictional. Assets are supplied as pinned input text; neither task has workspace-read authority or a shell command. The controller alone runs the fixed `craft-shop-ui-v1` test after each approved write.

This directory is a portable template. It deliberately has no `assets/test-manifest.json`: preparation requires the canonical manifest from the installed, reviewed tester. A synthetic manifest is appropriate only in tests and cannot establish browser acceptance. No Pro/5x/20x throughput or subscription calibration is claimed. Public defaults reserve 25% capacity and allow at most two active workers; this graph executes its two tasks sequentially.

From a controller, prepare a new private directory with the exported helper:

```ts
const graph = await prepareEndorAlpha({
  sourceDirectory: '/absolute/path/to/examples/endor-alpha',
  destination: '/absolute/private-parent/endor-run',
  manifest: registeredManifestBytes,
  workspaceId: 'craft-shop',
  runId: 'first-demo',
  // Optional explicit controller identities:
  owners: { emery: { subject: 'agent:emery', epoch: 1 }, coda: { subject: 'agent:coda', epoch: 1 } },
});
```

The destination must not exist. Its parent must be private, owned, and free of symlink aliases. Preparation copies only declared bounded assets, pins the supplied manifest, creates a compiled candidate, and creates private output directories. It changes no source template. A failed preparation may leave a partial new directory for inspection; it never overwrites or removes an older candidate. Rerunning against an existing destination refuses. Protect the destination against other local writers, consistent with the workspace adapter's directory ownership assumption.

The optional `reservePercent` override is explicit, validated by the crew schema, and changes the candidate revision. It cannot replace the admission account's existing policy. The shipped YAML remains at 25%.

`provisionLocalInstallation(config)` accepts the structural database/schema/graph/bridge/workspace/capacity fields of the CLI's `LocalInstallation`. Use the prepared destination as `workspaceRoot`, or supply another existing private root with both output directories. PostgreSQL must already exist at the explicit `127.0.0.1` endpoint; credentials come from an absolute owned private regular JSON file containing `POSTGRES_PASSWORD`. There is no implicit connection target or database creation.

Provisioning checks the existing shared admission schema and alias, current account checksum, admitted model route, threshold, and worker limit. It does not create an admission schema/account, update policy, record usage, request a reservation, or remove held allowance. New runtime, broker, effects, graph, and test schemas must all be absent and distinct from admission. Their creation is atomic in one outer transaction using each package's existing DDL inside savepoints. A refused attempt rolls back its database changes. Unknown commit acknowledgement returns `PROVISION_COMMIT_UNKNOWN`; inspect the schemas before any next action. Existing schemas are never adopted, reset, or removed.

The result records the candidate, created schema names, existing admission checksum, and `launches: 0`. Provisioning does not start DBOS, Codex, a browser, or a container. It does not create the final CLI installation file or register a browser executor.

Alpha currently supports one live installation and coordinator in the selected database. The runtime's shared DBOS system schema does not establish isolation for parallel installations. Public provisioning refuses any rows in `dbos.workflow_status` and refuses a partial DBOS schema without that table. It preserves that history and offers no reset/adoption flag. An absent or empty recognized system history is allowed, but the operator must still keep other live coordinators out of that database. Company-wide parallel isolation remains beta work.

The campaign's existing account and system state require the lead's separate checked setup; this public helper never clears them to make provisioning succeed. The new graph still depends on the CLI's reviewed `command.test` graph profile and registered browser executor before a live run.
