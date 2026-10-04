# Revision and harness plans

This beta slice adds setup revision and read-only harness planning. It does not complete the two-harness runtime gate.

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

## Remaining work

Live import, approved application, removal, effective configuration precedence, and two-harness execution remain open. These planning results grant no execution authority.
