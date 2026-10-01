# Codex subscription proposal adapter

This alpha package connects the broker/runtime interface to a pinned, proposal-only Codex process. It includes an authenticated no-thread observation reader and a separate orphan guardian. It has no action dispatch capability: its only successful result is one strict `trellis/action/v0.7-alpha` proposal string, which still requires the broker's ownership, scope, revision, approval, permission, deadline, and idempotency checks.

Integrated and exercised by the two-lead live demo at `6e16e709174549faf8dd48e4a844449b5dd30212`. Both generated proposals passed exact approval, real writes, and registered browser acceptance. Final independent alpha review remains pending.

The packaged native adversarial test observed no tool events, unchanged canaries, and no connections to owned listeners. Direct command probes separately demonstrated denied reads, writes, child writes, TCP, and Unix access. These results do not prove arbitrary hidden native invocation denial, complete provider telemetry suppression, or total harness egress isolation. See [current alpha evidence](../../docs/alpha/acceptance-status.md).

## Controller contract

`CodexAdapter` structurally implements the runtime `ModelAdapter`: `start({launcherId, taskInput, modelRoute}, signal)` returns `{identity, result, terminate}`. The local controller supplies it to the supervised runtime. Its identity contains an opaque `processRef`, an ownership digest bound to a fresh control-channel nonce and created process IDs, the worker PID/group ID, and the original launcher ID. There is no PID adoption, attach, resume, or arbitrary-command option on the adapter.

- `modelRoute` is exactly `codex:gpt-5.5:low`. There is no model, account, API, or paid fallback.
- Task input is bounded UTF-8 text; the entire fixed preamble plus task input is at most 32,768 bytes. The trusted controller supplies only synthetic task data for this alpha. The adapter cannot infer whether arbitrary prose contains private business data.
- `result` resolves only after the child leader is reaped, its process group is observed absent, guardian exit is observed, streams close, the strict protocol/proposal parser passes, and the owned workspace is unchanged and cleaned up. Tools, agents, effects, errors, malformed/duplicate JSON, extra turns/messages, missing usage, and unexpected output all reject. Accepted proposal contents are untrusted until the broker authorizes them.
- `terminate()` addresses only the original owned guardian channel. It waits for verified leader/group cleanup. An unverified guardian/group loss quarantines the adapter instance; a new call cannot silently replace that group. No recovery action signals a PID discovered from disk or a database.
- A start rejection can occur after native dispatch. It is not a not-started or zero-usage attestation. The controller must retain uncertain launch reservations for trusted reconciliation; event counts are not authoritative model-request counts.
- The caller must still use durable account admission and runtime ownership. This adapter's conservative usage hold is not a reservation system or provider calibration. A process identity does not itself authorize an effect.

Supply an `Installation` from a private trusted registry: absolute native binary path, its SHA-256, version, and an existing controller-owned `workRoot` with mode 0700. Supported macOS arm64 pins are Codex 0.157.0 (`ad0be20d04e2ba6146ecdb51d7f8b7b0fe15420a15dc9b0057518d858f1f3714`) and 0.159.2 (`50ac633af64851511f9bbc71032cdae7f1ba20b3234c189687d61ba846c354c5`). The controller supplies the pin, and the adapter refuses a different supported-version claim or hash. The native binary is invoked directly; no wrapper, shell, PATH discovery, or downloaded replacement is used. Private machine paths, credentials, source inputs, and provider identifiers do not belong in the versioned policy.

Portable definition example (mapping for the trusted controller, not a new crew-schema extension):

```yaml
adapterPolicy: codex-subscription-proposal/v0.7-alpha.3
modelRoute: codex:gpt-5.5:low
installationRef: local-codex-alpha
accountAlias: founder-subscription
telemetry: disabled
```

The installation/account references resolve locally. `src/policy.ts` is the version-controlled metaharness policy; no user harness file is written. Fresh run directories contain an empty synthetic cwd and an output schema outside that cwd. Unexpected entries or replaced schemas are preserved for investigation rather than recursively deleted.

## Authenticated observation

Register an `AccountBinding` in the controller with a canonical Trellis account ID, its approved aliases, `providerAccountSha256`, and explicit required/optional windows. The provider fingerprint is `accountBindingDigest(providerAccountId)`, a domain-separated SHA-256 of the authenticated `account/rateLimits/read` account ID. Provision it through a trusted existing observation, not worker input. Neither the raw provider ID nor account email is returned or logged. This registration binds aliases to the same canonical account; it is not automatic discovery of account equivalence.

`CodexObservationReader.read(alias)` launches only a private stdio app-server. Its method allowlist is `initialize`, `config/read`, `configRequirements/read`, `environment/status`, `account/read` with refreshToken=false, `model/list`, and `account/rateLimits/read`; `initialized` is the only notification it sends. There is no thread/turn start, configured MCP invocation, tool call, auth-file read, token interception/copy, login, reset-credit consumption, or shared daemon.

It requires current ChatGPT subscription authentication, matching `pro` account and bucket plans or matching `promax` plans, the registered provider account fingerprint, ordinary usage explicitly allowed, the known `codex` bucket, no restriction, explicit false spend-control state, and available `gpt-5.5`/low. Every primary/secondary window must be declared required or optional. A missing optional window stays null; missing required or malformed reported windows reject. Durations must be finite, positive, and safely convertible to milliseconds; reset times must be future integer seconds. Unknown accounts, source layers, routes, models, extra usage buckets, malformed eligibility, and stale/future observation timing reject.

Each returned window sets `accountedThroughMs: null`. The provider response does not supply an authoritative accounting watermark. `observedAtMs` is the controller's bounded read time, not proof that the provider has accounted for every prior token. Total read duration must fit 30 seconds. Launch repeats no-model observation and local checks, and the observation must still be at most 30 seconds old immediately before spawn. Every available window requires `usedPercent + provisionalPercent < stopUsedPercent`. Defaults are a ten-point margin and 75-percent ceiling. The trusted controller accepts an explicit margin from two through ten points and an authorized ceiling up to 95 percent. The local CLI checks that the margin covers stored coordination headroom and the largest proposed model allowance. Durable admission also counts retained reservations.

The standalone observer loads user config. It checks non-user instruction/provider/MCP provenance and refuses custom selected providers/endpoints/catalogs/workspace overrides before interpreting account/usage responses. The worker uses `--ignore-user-config --ignore-rules`; user-only MCP entries are excluded by that pinned loader path. The observer's effective configuration is not a complete worker prompt/tool manifest. Authentication changes by another trusted application between observation and inference remain a coordination limit; serialize sign-in changes and deny if fresh binding checks differ.

## Controls and lifecycle

The reviewed feature/control array is preserved in `src/policy.ts`. Workers use strict configuration parsing, ignored user configuration/rules, ephemeral JSON exec, root filesystem denial/minimal read, network=false, approval=never, pinned provider/login/model/effort, and no code-mode host. Host skills, plugins, hooks, apps, browser/computer tools, both multi-agent paths, workspace dependencies, shell snapshots, shell tools, image tools, memory imports, and search are disabled. Global AGENTS/override and environments.toml must be absent by metadata-only checks. Their absence is rechecked; there is no claim that project_doc_max_bytes suppresses the global instruction provider.

The constructed environment preserves HOME and CODEX_HOME unchanged, including CODEX_HOME's absence, plus optional TMPDIR/LANG/LC_ALL. It uses a fixed minimal PATH and adds `CODEX_EXEC_SERVER_URL=none` plus the reviewed process-local remote-control opt-out. No API/provider/proxy/noise-transport variables or NODE_OPTIONS are inherited. The no-environment sentinel is an explicit version-bound source mechanism. UnifiedExec can normalize on in configuration reporting; the separate environment/ShellTool gates still exclude shell dispatch. apply_patch has its own environment condition. Do not replace these gates with a feature-list assertion.

One guardian owns one newly created child process group. The guardian has the original private Node IPC channel; the worker receives only stdin/stdout/stderr. Control-channel loss, cancellation, deadline, input overflow, output overflow, or protocol rejection causes termination. SIGTERM escalates to one SIGKILL, the child leader is reaped, and the original group must become absent within a bounded check. A transient EPERM during macOS group teardown is rechecked; persistent EPERM or an extant group fails cleanup. The guardian never discovers or adopts another PID. The controller waits for the guardian's own close event before resolving completion. The guardian is trusted lifecycle code; its own OS-level crash/kill cannot be represented as successful cleanup. Such uncertainty stays quarantined and requires trusted reconciliation.

Live bounds are 60 seconds, stdout 65,536 bytes, stderr 32,768 bytes, and 64 protocol events, plus bounded cleanup. Observer bounds are 30 seconds, 2 MiB stdout, and 32 KiB stderr. The guardian also caps aggregate stdin at 65,536 bytes. There is no auto-retry. The instance starts no second worker while the first is active, and it never overlaps its observer with its worker. No listener or public port is opened by this package. A 12 GiB host disk reserve is checked before launch. Signal-based cancellation is checked immediately before spawn and again before delivering the final result.

## Evidence boundaries

| Boundary | Recorded alpha evidence | Remaining limit |
| --- | --- | --- |
| Owned process cleanup | Synthetic guardian, descendant, parent-loss, deadline, cancellation, and overflow tests; packaged live proposals completed cleanup. | No arbitrary PID adoption, host recovery, or general server failover. |
| Authenticated observation | Packaged no-thread account/model/config checks and live subscription admission. | No authoritative provider accounting watermark or tier calibration. |
| Worker tools and broker bypass | Pinned source gates, seven command-boundary probes, bounded adversarial canaries, and approved live artifact writes. | No complete hidden-tool inventory or universal native-invocation proof. |
| Trusted harness traffic | Authentication, account observation, and inference use the existing subscription route. Worker-facing network tools remain denied. | Total harness egress and provider-owned telemetry remain unproved. |
| Optional Trellis telemetry | No remote exporter; local evidence callback defaults to a no-op. DBOS tracing and native analytics are disabled. | The assembled zero-send supplement remains under final acceptance review. It cannot establish provider telemetry suppression. |

The completed live demo connects this adapter to persistent admission, broker effects, graph handoff, and browser acceptance. Separate tests cover interrupted runtime and browser cleanup. The founder walkthrough is ready. Final independent review remains pending. A failed mandatory control stops the affected capability; it does not authorize weakening the boundary.

## Reproduction and source provenance

Run `npm test` and `npm run typecheck` at the repository root. All adapter tests use synthetic Node children and synthetic account/config responses. The orphan test kills only its own test controller and observes the owned worker/guardian disappear; another test confirms an unrelated test process survives cancellation. Tests never start Codex inference, Docker, public listeners, or paid services. Existing PostgreSQL proofs are skipped unless separately configured; those are unrelated integration gates.

Relevant official matching-version source is at OpenAI commit `00c972ed5d6ff6499317fd41b7f23605b8e6850d`: [exec loader selection](https://github.com/openai/codex/blob/00c972ed5d6ff6499317fd41b7f23605b8e6850d/codex-rs/exec/src/lib.rs#L698), [explicit no-environment sentinel](https://github.com/openai/codex/blob/00c972ed5d6ff6499317fd41b7f23605b8e6850d/codex-rs/exec-server/src/environment_provider.rs#L62), [shell/apply_patch environment gates](https://github.com/openai/codex/blob/00c972ed5d6ff6499317fd41b7f23605b8e6850d/codex-rs/core/src/tools/spec_plan.rs#L1037), and [global instruction provider](https://github.com/openai/codex/blob/00c972ed5d6ff6499317fd41b7f23605b8e6850d/codex-rs/codex-home/src/instructions/mod.rs#L40). These are source-backed inferences, not a reproducible-build attestation or a complete live tool inventory. The package's implementation is original Trellis code under the repository MIT license. It bundles no Codex source, binary, credentials, or private campaign evidence.

## Explicit campaign ceiling

The adapter and observer retain a default usage ceiling of 75 percent. The trusted controller can supply `stopUsedPercent` up to 95 after operator authorization.

Pass the same ceiling to `CodexAdapter` and the third argument of `CodexObservationReader`. The observer defaults to a ten-point provisional margin under either ceiling. An explicit `provisionalPercent` from two through ten is supported by both constructors. Pass it as the reader's fourth argument; the local CLI verifies its required headroom.

The PostgreSQL admission policy and crew reserve still apply separately. This argument does not clear held allowances or bypass a refused runtime admission.

An invalid ceiling fails before a native request. Missing or refused account observations still stop model work.
