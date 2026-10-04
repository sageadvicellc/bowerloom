# Revision and harness plans

This beta slice adds setup revision and synthetic harness projections. It does not complete the two-harness runtime gate.

## Revise a setup

A revision replaces an approved setup with a new exact plan. Bowerloom retains the previous installation in a private journal directory.

Use the existing Node 24 installation and a freshly compiled checkout. Replace the example paths with absolute paths on your computer.

```sh
node dist/apps/cli/src/main.js revise plan \
  --target /absolute/project --brief /absolute/new-brief.json
```

Read the old goal, proposed goal, and file replacement scope. Ask your personal agent to explain any unclear changes.

Use the same brief for application. Copy both revision values from the reviewed plan.

```sh
node dist/apps/cli/src/main.js revise apply \
  --target /absolute/project --brief /absolute/new-brief.json \
  --from OLD_INSTALLATION_REVISION --approve EXACT_PLAN_REVISION
```

The command refuses changed files, extra managed files, stale approvals, and unsafe paths. Unrelated files outside `.bowerloom` stay unchanged.

The original approval also permits recovery of that exact revision. If an update stops, choose one recovery action.

```sh
node dist/apps/cli/src/main.js revise recover \
  --target /absolute/project --approve EXACT_PLAN_REVISION --action resume
```

Use `--action rollback` to restore the recorded original during interrupted work. Recovery retains all recorded directories and does not grant cleanup permission.

Registered work stops at its next guard observation when the setup changes. Previously issued effects can still require reconciliation.

Old connections and runtime enrollment do not authorize the revised setup. Review their bindings separately before further execution.

Revision needs a temporary loopback socket for writer exclusion. A port collision refuses the operation. Process termination releases the socket.

## Plan harness preferences

The importer reads an explicitly selected synthetic file. It does not discover or edit live Codex or Claude configuration.

```sh
node dist/apps/cli/src/main.js harness import \
  --harness codex --file /absolute/synthetic/config.toml --synthetic
```

Save only the result's `neutral` object to a private JSON file. Set its mode to `0600` before the next command.

```sh
chmod 600 /absolute/synthetic/neutral.json
node dist/apps/cli/src/main.js harness plan \
  --harness claude --file /absolute/synthetic/settings.json \
  --neutral /absolute/synthetic/neutral.json --synthetic
```

A projection is a proposed change to a harness file. The command returns a plan and leaves the file unchanged.

Portable output includes supported reasoning preferences and explicit native model names. The tool never translates models or permissions between providers.

Unsupported fields, conflicting values, and sensitive references appear in the report. Sensitive or unrecognized string values block proposed file content.

The `--synthetic` flag records your assertion about the input. It does not prove that a selected file contains synthetic data.

The restricted TOML parser refuses syntax outside its supported subset. Read the harness package documentation for exact limits.

## Install a synthetic projection

The managed plan includes the exact source, proposed changes, and a new private recovery directory. This command still requires synthetic input.

Use the neutral file and harness file from the previous example. Choose a new state directory with an existing parent.

```sh
node dist/apps/cli/src/main.js harness managed-plan \
  --harness claude --file /absolute/synthetic/settings.json \
  --neutral /absolute/synthetic/neutral.json \
  --state /absolute/synthetic/projection-state --synthetic
```

Read the proposed changes. Apply the same inputs with the exact managed-plan revision.

```sh
node dist/apps/cli/src/main.js harness apply \
  --harness claude --file /absolute/synthetic/settings.json \
  --neutral /absolute/synthetic/neutral.json \
  --state /absolute/synthetic/projection-state --synthetic \
  --approve EXACT_MANAGED_PLAN_REVISION
```

The command preserves original bytes and file mode. Changed source or parent identity invalidates the approval.

## Remove a synthetic projection

Removal restores the original file only when the current projection still matches its receipt. A separate plan records that removal.

```sh
node dist/apps/cli/src/main.js harness removal-plan \
  --state /absolute/synthetic/projection-state --synthetic
node dist/apps/cli/src/main.js harness remove \
  --state /absolute/synthetic/projection-state --synthetic \
  --approve EXACT_REMOVAL_PLAN_REVISION
```

The state directory stays available after removal. The command does not delete its recovery records.

If a recorded operation stops, use its exact approval for recovery.

```sh
node dist/apps/cli/src/main.js harness recover \
  --state /absolute/synthetic/projection-state --synthetic \
  --approve EXACT_RECORDED_OPERATION_REVISION
```

Unknown changes or incomplete records stop recovery. Inspect the preserved files before another action.

## Choose an optional demo

The installed setup can supply a read-only handoff for the frozen synthetic craft-shop exercise.

Use the installed revision from `init status`. The command derives its explanation from the installed profile.

```sh
node dist/apps/cli/src/main.js init demo-plan \
  --target /absolute/project --from INSTALLED_REVISION
```

Add `--json` for the complete plan. Your personal agent can explain its scenario, task bounds, milestones, and further approvals.

The demo handoff differs from the installed three-role setup. It proposes two execution owners for the existing two-task Workbench scenario.

The plan does not start a demo. Authoring, provisioning, capacity admission, and action approval remain separate steps.

The research profile proposes a comparison. It does not claim a measured gain.

## Remaining work

Live configuration import, application, removal, and effective precedence remain open. Two-harness execution remains a separate gate.

Synthetic projection approval grants only its recorded file changes. It grants no model execution authority.
