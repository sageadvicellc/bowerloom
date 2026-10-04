# Local team stop controls

Bowerloom can stop work that its registered local owners control. The stop commands preserve project files, definitions, outputs, and saved history.

`destruct` means stop. It does not delete a team or its data. It does not stop Docker or the local Supabase backend.

## Enroll a team

Enrollment is separate from `init` approval. The default private registry is `~/.local/state/bowerloom`.

Run commands from the compiled source checkout. Select an installed team file beneath `.bowerloom/teams/<team-id>/`.

```sh
node dist/apps/cli/src/main.js control plan \
  --root /absolute/project \
  --team first-team \
  --spec teams/first-team/team.yaml
```

Read the plan. Register the same inputs with its exact revision:

```sh
node dist/apps/cli/src/main.js control register \
  --root /absolute/project \
  --team first-team \
  --spec teams/first-team/team.yaml \
  --approve EXACT_64_CHARACTER_REVISION
```

This enrollment starts no work. A team with no registered execution reports `NOT_RUNNING` when stopped.

For a graph installation, add `--adapter graph --installation /absolute/private/installation.json` to both commands. Use `--adapter recipe` for a recipe installation.

The graph installation must name the same root and team definition. A recipe binding explicitly assigns that installation to the selected team.

The plan binds the root identity, team file, private installation, registry state, and adapter. Changed inputs require another plan and approval.

Use `--registry /absolute/private/registry` consistently for an isolated registry. This argument does not add other registries to emergency stop scope.

## Stop work

Stop one registered team:

```sh
node dist/apps/cli/src/main.js destruct first-team --root /absolute/project
```

Stop every registered team in one local registry:

```sh
node dist/apps/cli/src/main.js destruct all
```

The default wait is 10 seconds. `--timeout-ms` accepts 100 through 30000 milliseconds. A timeout preserves the request and returns an incomplete result.

The command sends requests to every selected owner before it waits. Repeated calls reuse the stop records and continue to observe unresolved owners.

The stop latch prevents another execution. A later explicit registration with a new approved generation can clear a settled team's latch.

Unresolved owners prevent new registration. The alpha has no automatic takeover, resume command, or unsafe PID cleanup.

## Result meaning

`STOPPED` means the registered owner acknowledged a stop after cleanup. `NOT_RUNNING` means no execution started, or all earlier executions already finished.

`STOP_UNCONFIRMED` means an owner or cleanup outcome remains unresolved. An offline owner, stale process ID, or elapsed timeout does not prove termination.

An incomplete command returns exit code 2. Read its per-team results before another action.

The registry retains stop requests and owner evidence. It does not overwrite earlier stop history when an approved new generation is registered.

Codex owners use the existing guardian to reap their own process groups. They never adopt a PID from a registry record.

Recipe cancellation aborts local HTTP requests and blocks subsequent effects. A request that GitHub accepted can still take effect.

The recipe preserves uncertain claims for reconciliation. Stopping local work does not undo an approved external write.

A fresh `recipe reconcile` command can inspect an uncertain external outcome after a stop. It sends no new effect and does not clear the latch.

Reconciliation can update local evidence from observed GitHub state. An already-aborted service cannot reuse its transport, so use a fresh command.

Used subscription allowance remains held. Only proven unused reservations can be released through existing admission controls.

## Scope and limits

Emergency stop covers one registry for the current user. It does not stop another machine, another user, or an unregistered personal-agent session.

A connection between project roots grants no stop authority. Both teams need independent enrollment in the selected registry to appear in `destruct all`.

New production CLI execution requires approved enrollment. Read-only inspection does not. Low-level test APIs remain available without automatic enrollment.

The registry is private local state. It assumes a trusted operating-system user and does not defend against a hostile process with the same filesystem authority.

The owner acknowledges cleanup after its registered operations settle. Owner loss before acknowledgement remains unresolved, even when the orphan guardian subsequently stops its child.

No model-generated handoff is required. The command keeps incomplete artifacts and reports their saved state.
