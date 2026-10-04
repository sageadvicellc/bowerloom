# Harness preference import and projection

A beta slice for explicitly selected synthetic Codex and Claude configuration files. Import and projection planning remain read-only. A separate managed API can apply an exactly approved additive projection and restore the original file after a separately approved removal plan. It never executes harness configuration or selects live native settings.

Syntax observations: Codex CLI 0.157.0 and Claude Code 2.1.288. See [sources and local help evidence](evidence/SOURCES.md). These versions identify the observed syntax, not runtime compatibility.

## APIs

```ts
importHarnessConfig({
  harness: 'codex', // or 'claude'
  file: '/absolute/synthetic/config.toml', // Claude: *.json
  synthetic: true,
});

planHarnessProjection({
  harness: 'claude',
  file: '/absolute/synthetic/settings.json',
  synthetic: true,
  neutral: {
    format: 'bowerloom/harness-preferences/v1beta1',
    preferences: { reasoningEffort: 'high' },
    nativeModels: { claude: 'sonnet' },
    executionAuthorized: false,
  },
});
```

`ImportResult.neutral` is the only portable export. It contains a four-label reasoning preference and optional explicit native model choices. Recognized Codex identifiers are `gpt-6.1-sol` and `o3`; Claude aliases are `opus`, `sonnet` and `fable`. They came from the cited official reference or installed CLI help, not from application model slugs. Every other identifier is reported as unsupported. Models are never translated between harnesses. Reasoning preferences do not guarantee the selected model supports them.

The import result also includes a local source binding (path, SHA256, bytes and filesystem identity), syntax/adapter version, a deterministic revision, and a report. The report has `mapped`, `unsupported`, `conflicts` and `secretReferences` arrays of `{field, code}`. No values are copied into findings. Unknown fields are reported, never merged into neutral output. A sensitive field can be reported in `secretReferences` instead of `unsupported`.

`ProjectionPlan` returns `status: blocked | unchanged | review-required`, source binding, `edits` as original-byte offsets plus inserted text, and proposed text/hash. An unchanged plan preserves byte identity. Added root TOML preferences go before the first table. JSON additions preserve every existing byte. Existing different values or nested structures at a requested field are conflicts; the first slice does not overwrite them. Plans are deterministic for the same source identity, bytes and neutral request. Replacement files or changed bytes change their revision.

`proposedText` is private local review content, never portable export. Sensitive references or unrecognized string values block projection, yielding null proposed text/hash and no edits. Known native permission enum values may remain in the original file, but are reported as unsupported and carry no assertion of equivalent or safe execution. No runtime authority follows from importing or planning.

## Accepted file syntax

- Claude: strict JSON object; duplicate keys (including escape aliases), invalid Unicode, prototype keys, trailing commas and comments fail. Its report traverses nested objects and arrays. No user/project/managed precedence resolution is attempted.
- Codex: one assignment per line; bare or dotted keys; basic bare table names; one-line double-quoted JSON-compatible strings or literal single-quoted strings; JSON-compatible booleans, finite numbers and primitive arrays; JSON-only escaped slashes and surrogate code-unit escapes are rejected; `#` comments. Keys must be safe bounded ASCII identifiers. All duplicate keys, redefined tables and scalar/prefix collisions fail. Quoted keys, multiline strings/arrays, inline tables, dates, nulls and other TOML features are rejected. This is deliberately not a full TOML parser.

Both formats are bounded at 64 KiB and 1,024 reported entries. Input must be valid UTF-8 without a BOM, format controls or hidden control characters. Only tab and line breaks are retained. Parent and selected file must be owned by the current user and not group/world writable. Symbolic links, hardlinks, nonregular files and source changes during the read fail. Paths must be absolute, canonical and NFC-normalized. Known live harness, credential, system and protected-project locations are refused. Nothing is discovered automatically.

The caller must explicitly assert synthetic input. The library cannot prove an arbitrary selected file's provenance; callers must not relabel live settings as synthetic. Sensitive detection is conservative and blocks unrecognized strings, explicit credential containers, endpoint/path strings, and credential-like comments. It is not a general-purpose secret detector for arbitrary prose. Original comments stay local and never enter the neutral export.

## Managed synthetic files

```ts
const input = { harness: 'codex', file: '/absolute/synthetic/config.toml',
  synthetic: true, neutral, stateDir: '/absolute/synthetic/private-state' };
const plan = await planManagedProjection(input);
// Review this private plan's original/proposed text and revision first.
const installed = await applyManagedProjection(input, plan.revision);
const removal = await planProjectionRemoval({ stateDir: input.stateDir });
// Removal has its own exact approval, distinct from the installation.
const removed = await removeManagedProjection({ stateDir: input.stateDir }, removal.revision);
// Only a durably recorded operation can be recovered, using its original approval.
await recoverManagedProjection({ stateDir: input.stateDir }, removal.revision);
```

Both plans expose a top-level `revision` and `executionAuthorized: false`. A managed plan binds the selected file's original bytes, mode and identity, the full projection, the new state directory, and both parent identities. It writes nothing. Apply reconstructs the plan before writing and again under a cooperative target lock. Changed input, bytes, source identity or parent identity invalidates the approval. Unchanged and blocked projections are not actionable.

The state directory must be new, separate from the target, canonical and private. It stores the exact original backup, reviewed plan, durable operation records, stage identities and receipts with mode 0600 in a mode 0700 directory. Source mode is preserved. The target changes by an atomic rename from a sibling staged file after an immediate identity/hash/mode check. No settings outside that explicitly selected synthetic file are changed. Journals and backups remain after removal; there is no automatic deletion or generic cleanup operation.

Removal restores exact original bytes only while the target still matches the installed projection and its file identity. An unrelated edit blocks removal without merging, overwriting or discarding that edit. A changed terminal receipt cannot substitute another status or content hash for the approved operation.

Recovery requires the exact approval recorded for the interrupted install or removal. It can finish a durable staged operation either side of the rename and is idempotent once a valid terminal receipt exists. A dead process's matching cooperative lock can be reclaimed; an active or mismatched lock cannot. A missing stage marker, partial/corrupt journal, lost stage, replaced ancestor, edited backup or drifted target fails closed. These failures retain the source, backup and other surviving records for manual inspection; recovery is not a promise to repair arbitrary disk corruption. There is no replay after removal and no install recovery once removal starts.

Private plans and state contain original and proposed source text. Keep them local; they are not portable exports. The synthetic acknowledgement is a caller assertion, not proof that an arbitrary file is synthetic. Never point these APIs at a user's native configuration.

## Deliberate limits

No live settings application/removal, secret retrieval, history migration, API calls, provider fallback, shell hooks, MCP conversion, role/skill conversion, permission translation, effective-settings resolution or team execution is implemented here. A read-only projection is an exact proposal, not approval. Only the managed write APIs consume a separately supplied exact approval. `executionAuthorized` remains false; the plan itself retains `writesAuthorized: false`. Private plan text should never be exported as a portable definition or displayed as an ordinary summary when a CLI adds integration.

The read checks and cooperative lock assume a trusted same-user filesystem. The immediate pre-rename comparison is optimistic, not an atomic filesystem compare-and-swap. A noncooperating same-account process can race that final comparison, replace ancestors or rewrite private records; this implementation does not defend against that hostile writer. It detects ordinary drift and refuses to discard later unrelated data during removal or recovery. Only the selected file is read; includes, imports, hooks, private endpoints and referenced files are never followed.

After one coordinated root build:

```sh
node --test packages/harness-portability/test/*.test.mjs
```

Tests use temporary synthetic files only and cover byte-preserving round trips, additive cross-harness preferences without model substitution, conflicts, secret suppression, duplicates, unsupported syntax, changed source identity, symlinks/hardlinks, bounds, Unicode and input validation. Managed tests additionally exercise both formats, exact approvals, byte/mode preservation, collisions, source/ancestor drift, active locks, corrupted records and process termination before and after both install and removal renames. Passing them proves synthetic file management, not runtime harness compatibility.
