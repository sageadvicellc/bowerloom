# Harness preference import and projection

A read-only beta slice for explicitly selected synthetic Codex and Claude configuration files. It produces portable preferences and a local report, then plans additive projections with exact byte edits. It never installs, changes, removes or executes harness configuration.

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

## Deliberate limits

No settings application/removal, secret retrieval, history migration, API calls, provider fallback, shell hooks, MCP conversion, role/skill conversion, permission translation, effective-settings resolution or team execution is implemented here. A projection is an exact proposal, not an approval or installation. `executionAuthorized` and `writesAuthorized` remain false. Private plan text should never be exported as a portable definition or displayed as an ordinary summary when a CLI adds integration.

The read checks provide a bounded observation under a trusted same-user filesystem. They do not defend against a hostile writer with the same account replacing ancestors at precisely timed points. Only the selected file is read; includes, imports, hooks, private endpoints and referenced files are never followed.

After one coordinated root build:

```sh
node --test packages/harness-portability/test/*.test.mjs
```

Tests use temporary synthetic files only and cover byte-preserving round trips, additive cross-harness preferences without model substitution, conflicts, secret suppression, duplicates, unsupported syntax, changed source identity, symlinks/hardlinks, bounds, Unicode and input validation. Passing them proves this planning slice only.
