# Native Codex proposal boundary

This internal beta entry adds a qualification gate to the existing Codex proposal adapter.
It does not qualify an installation by itself. The bootstrap probe entry remains unavailable.
No live model result, native-tool denial, Claude parity or complete beta readiness is established by this implementation.

## Trusted host inputs

A host constructs `CodexBetaAdapter` with the existing installation and account binding plus a private `boundary` configuration.
The task supplies only its launcher, bounded input and fixed model route. It cannot select alpha, probe mode or a qualification record.

The boundary contains a pinned receipt identifier and revision, an approved artifact inventory, and a trusted registry lookup function.
The lookup must retrieve independently reviewed records. Never implement it by returning arbitrary task JSON.
A well-formed receipt or matching hash alone grants no trust.

The host derives artifact inventory and tarball identity from independently pinned distribution records.
The adapter independently measures every supplied file and requires the executing boundary module under that exact installed root.
Required files include the adapter, reader, policy, protocol, guardian, supervisor and Bowerloom broker/contracts modules.
Canonical paths, regular single-link files, owner identity, writable-mode restrictions and before/after metadata checks guard those measurements.
The host also verifies package provenance and external dependency resolution through its installed proof.
The boundary does not prove a reproducible vendor build or defeat concurrent malicious same-user replacement.

The exact receipt binds the launch plan, artifact identity, native version/hash, account binding, review and probe-suite revisions, and expiry.
Missing, revoked, stale, replaced or mismatched records refuse. Ordinary beta execution never falls back to alpha or probe mode.
The original `CodexAdapter` remains the explicitly selected historical alpha entry with its original limitations.

## Launch and authority

The gate runs before workspace creation or account observation, then repeats before model dispatch.
Cancellation is checked after asynchronous gate work and before subsequent dispatch.
The existing adapter rechecks native bytes, environment, workspace and account-observation freshness before its existing guardian starts.
A final synchronous expiry and cancellation check precedes dispatch.
Registry checks are trusted-host snapshots, not a new transactional revocation service or cross-process runtime-stop mechanism.
Existing runtime admission, local-control fences, guardian deadlines and uncertain-launch handling remain required.

The model receives synthetic task text and returns one bounded proposal.
The existing broker retains every effect approval. No database, broker approval or GitHub credentials enter the model arguments or environment.
The trusted vendor CLI still uses existing subscription authentication; this is not credential isolation from the CLI itself.
Native policy controls and post-run detection are distinct from operating-system containment.
The historic evidence fields for universal native denial and total egress remain false.

A proposal-only result means that proposal data was returned for review. It does not mean a write happened.
Only a separate exact approval, broker dispatch and effect receipt support a completed-write claim.

## Bootstrap remains blocked

`refuseCodexQualificationProbe()` always throws `BOUNDARY_PROBE_UNAVAILABLE`.
No boolean, receipt-shaped object or free-form prompt can activate a probe path in this slice.

The current adapter start contract does not receive the runtime's durable admission claim.
A later implementation must bind finite fixture bytes, plan/artifact/native identities, account, operation, expiry and that claim.
It must consume a durable one-use authorization before dispatch and hold uncertain claims without automatic replay.
This work does not add another executor, authority store or fabricated qualification receipt.
Therefore an installation without existing independent qualification remains blocked for ordinary beta model work.

## Validation and remaining gates

Focused tests cover trusted lookup refusal, forged receipts, artifact drift, unsafe files, inert accessor handling, cancellation and no downgrade.
The positive gate test measures compiled local modules using synthetic trusted-host records. It is not installed qualification or a live model test.
The installed distribution proof remains separate and must bind exact artifact bytes and import locations.
Supported native controls still need their bounded negative and positive model-session qualification under fresh admission.

Claude needs its own pinned adapter, fresh subscription-capacity reader, supported restricted launch and installed qualification.
Codex observations and settings projections provide no Claude execution evidence.
Tool-capable routines and public MCP invocation remain outside this proposal-only boundary.
