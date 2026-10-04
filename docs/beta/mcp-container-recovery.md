# Read-only container recovery planning

`container-recovery.ts` is an internal, pure planning boundary for synthetic observations. It classifies a known discovery operation after an uncertain result. It performs no filesystem read, database transaction, Docker command, process lookup, signal, retry or cleanup. It is not exported through the public MCP package entry point or a CLI.

Every report leaves durable authority unchanged and sets `cleanupAuthorized`, `retryAuthorized`, `executionAuthorized`, `liveVerified` and `hostRestartSafetyVerified` to false. `requiresReconciliation` stays true even when an exact container-ID query reported absence. Absence does not prove that earlier effects succeeded or that discovery completed. It cannot turn an uncertain operation into a completed one or make it safe to redispatch.

## Input and binding

The input format is `bowerloom/mcp-container-recovery-input/v1beta1` with `synthetic: true`. It requires:

- A validated discovery authority snapshot and its exact container launch. The operation must already be `NEEDS_RECONCILIATION` before observations receive a non-hold classification.
- `expectedJob`: the independently selected operation key, launch revision and original guardian deadline. The deadline must remain within the committed intent. The guardian's session timeout can shorten the intent deadline, so this separate exact job binding is required.
- `journal`: a status, bounded canonical JSON text, and an expected SHA256 digest. The accepted `trusted-snapshot` status is an input assertion from a future collector, not trust established by this function. A digest supplied alongside arbitrary text is not provenance or authenticity.
- `observations`: one observation time, a host-session assertion, exact guardian/attach PID observations and an exact-CID query result. `nowMs` is supplied explicitly to keep the function pure. Future or more-than-five-second-old observations are held. Observations before the intent start or any recorded journal wall-time event are held as temporally inconsistent. The same hold covers recorded wall times before intent start, stop before last renewal, absence before stop, and reaping before last renewal; a clock discontinuity is not evidence of successful recovery.

The journal must match the authority operation, launch operation, launch revision, expected name, and exact expected deadline. Its schema, recorded PIDs, lifecycle stage, CID, reason and lease fields are strictly checked. The launch name is checked for consistency only; a name or label never establishes ownership. Unknown, missing, noncanonical, duplicate-key, digest-mismatched and malformed journals cannot supply a recovered identity.

The report binds all supplied evidence in `evidenceRevision`, the journal bytes in `journalSha256`, and the normalized result in `revision`. These hashes detect changed snapshots; they do not attest that the observations happened.

## Findings

| Finding | Interpretation |
| --- | --- |
| `EXACT_ID_ABSENCE_OBSERVED` | The supplied current exact-CID observation reports absence, both recorded PIDs report absent, and all snapshot bindings agree. This is not live verification or completed reconciliation. |
| `KNOWN_ID_PRESENT` | The recorded CID is still present according to the supplied exact-ID query. No inspect-derived ownership or cleanup authority is inferred. |
| `HOLD_UNKNOWN_IDENTITY` | No CID was durably recorded. Name/label matches and unrelated absence cannot fill that gap. |
| `HOLD_PROCESS_ACTIVE` | A recorded guardian or attach PID is present. The planner neither adopts nor signals it; a reused PID also stays held. |
| `HOLD_PROCESS_UNKNOWN` | Process absence is not established. A known CID with an unrecorded attach PID is also held: a crash can happen between spawning the attach process and persisting its PID. |
| `HOLD_TEMPORAL_INCONSISTENCY` | Supplied wall times contradict operation/event ordering. Guardian-monotonic expiry is never compared with wall time. |
| Other `HOLD_*` findings | Authority, host-session continuity, freshness, journal integrity, exact process binding, or exact container observation is missing or inconsistent. |

An expired journal lease does not establish that a process has exited. Its monotonic timestamp belongs to the original guardian and is never compared with another process's clock. An unknown/restarted host session always stays held; the current journal has no boot identifier or process-start identity, so this slice cannot make host-restart claims. Absent PIDs are input observations rather than a substitute for OS reaping evidence.

## Next boundary before live use

A future trusted collector must read and pin current durable authority, preserve its reconciliation hold, safely snapshot the private journal against independent provenance, identify the relevant host session, and collect fresh PID and exact-container observations. It must treat permission errors, daemon errors, ambiguous process identity and changed files as unknown. The current function does not provide that collector or any transactional fence for a later action.

Any future cleanup executor needs a separately reviewed operation with durable authority, exact complete container inspection, race handling, absence and reaping evidence, and a fresh check before effects. This report cannot authorize it. Unknown-create identity and an unrecorded attach process remain concrete blockers; they are not solved by this planning slice.

## Validation

Synthetic tests cover exact absence/presence, immutable input and revision changes, missing/untrusted/tampered journals, substituted bindings, unknown create identity, active/unknown/mismatched PIDs, missing attach PID, host restart ambiguity, stale/future observations, wrong-CID results, daemon uncertainty, active durable operations, deadline extension, malformed objects, and inert getters. Existing authority and guardian tests run alongside the planner tests. No live Docker or database recovery is claimed.
