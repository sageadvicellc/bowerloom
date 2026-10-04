# Synthetic container discovery

Bowerloom can discover a synthetic MCP tool catalog inside an approved, cached container image. This internal adapter exposes no public connection command.

A trusted host supplies the exact launch plan to the discovery authority controller. The controller records intent and checks an authenticated approval before opening the adapter. The approval permits catalog discovery only. It grants no tool calls or model execution.

The `container-stdio` effect is separate from the existing host `stdio` effect. Its revision includes the image records, entrypoint, arguments, directory, public image environment, and resource limits. The interactive discovery plan has its own revision format. Historical container plans remain unchanged.

The binding must select the same executable and directory. It must contain no secret references. Raw image records and launch plans remain private. Validation does not detect arbitrary secrets embedded in arguments. This slice permits synthetic inputs only.

## Trusted host requirements

The factory requires `trustedDockerDesktop: true` and an existing private `stateRoot` directory. The directory must belong to the current account and have mode `0700`. Symbolic links and noncanonical paths are refused.

The adapter currently supports macOS with Docker Desktop. Other platforms fail closed. It uses `/usr/local/bin/docker` with the fixed `desktop-linux` context. It does not inherit Docker target variables, shell settings, or host secrets. The CLI receives only the account home directory and a fixed executable search path. The home directory lets Docker locate its existing context.

The host trusts the Docker binary, context configuration, daemon, virtual machine, kernel, initialization helper, and built-in seccomp profile. The launch policy pins the cached OCI image chain. Docker must enforce that content identity. The adapter does not download images, build images, or change the daemon.

## Session and cleanup

An independent Node guardian owns container creation, attachment, and cleanup. It receives the exact plan and the approved absolute deadline through its original IPC channel. Its deadline continues when the controller stops running or loses its connection.

The guardian writes and syncs a private operation journal before creation. It records the returned container ID before starting the container. The journal records both the authority operation key and the launch operation key.

The journal lives at `<stateRoot>/<authority operation digest>/journal.json`. Its stages are `PREPARED`, `CREATING`, `CREATED`, `STARTED`, `REAPED`, `CANCELLED`, and `UNCERTAIN`.

A new operation creates its journal directory exclusively. An existing directory never triggers adoption, recovery, or another create attempt. An existing container name also causes refusal. Matching public labels do not establish ownership.

Before starting or removing a container, the guardian checks its exact ID, name, labels, image, command, environment, and confinement settings. Journal corruption or an ownership mismatch stops automatic cleanup and leaves an uncertain result. No cleanup guesses a container ID from a name.

The adapter accepts only initialization, its completion notification, and paginated tool listing. Request order, IDs, response envelopes, UTF-8, output sizes, and time limits are checked. Unexpected server messages fail the session. Their content never executes or enters a diagnostic.

Closing the adapter stops and removes the exact owned container. Successful cleanup requires verified container absence, attachment process reaping, and guardian closure. Killing the Docker attachment process alone does not prove cleanup.

Cleanup has a separate observation limit, with a default of nine seconds. Cleanup time grants no further discovery authority. An expired observation limit produces an uncertain result while the independent guardian still attempts cleanup.

## What the evidence proves

The isolated PostgreSQL and Docker proof passed nine tests across eight scenarios. It exercised catalog discovery, drift, approval refusal, revocation before dispatch, stop, and lost commit acknowledgement. It also killed and suspended controller processes while containers ran detached descendants. The guardian removed those containers and recorded `REAPED` journals. The proof needed no emergency cleanup.

Focused tests cover uncertain creation, corrupt or replaced journals, existing names, and mismatched ownership. They also cover malformed responses, stale IPC failures, cancellation, and incomplete cleanup receipts. These negative tests use mocked Docker responses and create no containers.

## Remaining limits

A lost creation response can leave a container whose ID was never recorded. That operation stays uncertain. This adapter cannot safely adopt or remove it automatically.

Simultaneous controller and guardian failure remains an open recovery problem. Durable reconciliation across host restarts is not implemented. A trusted operator must investigate uncertain operations without blind retry.

PostgreSQL stop and revocation fence dispatch and completion. A stop in the same controller also signals its guardian. A different process does not yet deliver active stop or revocation events to that guardian. The approved independent deadline still applies. The current proof checks revocation before dispatch, not active cross-process termination.

The synthetic proof does not establish production readiness, native harness bypass protection, or containment against a compromised host. General server onboarding, durable reconciliation, and active cross-process revocation remain release gates. There is no new public CLI, tool invocation path, or company service.
