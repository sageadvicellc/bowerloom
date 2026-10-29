# project-sync

`skills sync`, `apply`, recovery, migration, and the cache commands of Bowerloom 0.7, and the portable projection of
Bowerloom 0.8.

## The portable projection

`planPortable` and `applyPortable` write the portable parts of one harness definition into the project paths of each
engine: `AGENTS.md`, a `CLAUDE.md` that is the single line `@AGENTS.md` when a person accepts it, and skill folders in
`.claude/skills` and `.agents/skills`. The source is `src/portable.ts` (the plan), `src/portable-run.ts` (apply,
removal, and recovery), `src/portable-files.ts` (every read and write in the project), and `src/portable-state.ts`
(the private state folder).

A plan reads only. A person approves its revision. Apply plans again under the project lock and writes only when the
revision is the same. Scripts and engine-private files are not projected yet: the plan reports them `absent` and says
that the projection is partial. The line of a file under `engines/<engine>/` names the part `engine-private`.

The private block of a skill (`x-<engine>` in `harness.json`) is written back into the engine's `SKILL.md`, after the
core fields, as `key: <JSON value>` lines (`src/skill-private.ts`). A skill folder is shared by the engines that read it,
so a path takes a block only when every engine that writes it holds the same block. Otherwise the plan reports the
block `absent` and writes the core fields only.

A skill folder a person made is taken over, with nothing written, when its file set and every file but `SKILL.md` match
the plan in bytes and mode, and its `SKILL.md` means the same: the same frontmatter values and the same body. Key order,
quoting, comments, and line endings do not matter; a changed value, a missing or extra key, or a body change refuses
`PORTABLE_PATH_OCCUPIED`. The receipt records the held bytes, so a later plan finds nothing to update until the
definition says something else.

## Supported engines

Beta.1 supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness are preview engines. They stay in the code, but install to them is refused unless `BOWERLOOM_PREVIEW_ENGINES=1` is set. Any other value leaves it off.

- An engine named on purpose (`--engine opencode`) is refused with `ENGINE_PREVIEW` before any write.
- With no engine named, install uses the supported engines that `harness.json` lists. The plan names the preview engines it skipped (`skippedPreview`) and the switch that turns them on. If no supported engine is left, install is refused with `ENGINE_PREVIEW`.
- The plan covers the engine set it installs, so a plan made with the switch off cannot be approved with it on.
- With the switch off, what an earlier flagged install wrote for a preview engine is left alone. A file that only preview engines read stays an unchanged target: it is not deleted and not restored. The new receipt still lists those engines and their files, and carries their recorded approvals forward. The plan names them in `keptPreview` and in its notice. A file shared with a supported engine follows the supported engine.
- Adopt, drift, status, and remove are not gated. Remove still removes the files an earlier flagged install wrote.

The list, `isPreviewEngine`, and `previewEnginesAllowed` are in `packages/harness-definition/src/words.ts`. `PortableInput.previewEngines` sets the switch for one call; without it the plan reads the environment. The command line and the app both plan here, so they cannot differ.

## The locked-in parts (step 3)

The same plan writes MCP servers, subagents, hooks, guardrails, and the sandbox. `src/locked.ts` plans the files and
`src/locked-text.ts` edits and renders them. The translations are pure functions in `packages/fidelity`.

| Engine | MCP servers | Subagents | Hooks | Guardrails and sandbox |
| --- | --- | --- | --- | --- |
| Claude Code 2.1.310 | `.mcp.json` | `.claude/agents/<id>.md` | `.claude/settings.json` | `.claude/settings.json` |
| Codex 0.157.0 | `.codex/config.toml` | `.codex/agents/<id>.toml` | `.codex/hooks.json` | `.codex/rules/bowerloom.rules`, `.codex/config.toml` |
| OpenCode 1.18.30 | `opencode.json` | `.opencode/agents/<id>.md` | `.opencode/plugins/bowerloom-hooks.js` | `opencode.json` |
| Pi 1.4.0 | `.pi/mcp.json` | none | none | none |
| DeepSeek Harness 0.2.2-alpha.2 | `.dsh/bowerloom.patch.yml` | none | none | none |

- **A person's file keeps its bytes.** Bowerloom adds entries to `.mcp.json`, `.claude/settings.json`,
  `.codex/config.toml`, `.codex/hooks.json`, `opencode.json`, and `.pi/mcp.json` by inserting text. In TOML, managed
  keys go in one marked block at the top and managed tables in one marked block at the end. The base of the insertion
  is the file as it was before Bowerloom first wrote it, so a second projection gives the same bytes, and the file keeps
  its mode. A new file is 0644. Removal restores that file.
- **Conflicts are refused.** A managed name that the file already holds with other content, a TOML table, key, or
  inline table that a managed table would meet, an OpenCode `permission` the person keeps, an `opencode.jsonc`, and a
  `.opencode/opencode.json` or `.opencode/opencode.jsonc` all refuse `PORTABLE_CONFLICT`. A file that is not strict
  JSON, TOML 1.0, or UTF-8, or that has no bytes, refuses `PORTABLE_TARGET_INVALID`. `src/toml-scan.ts` parses the
  whole TOML file and fails closed: a value it cannot check fully, or a byte order mark, refuses the merge. Its verdicts
  match Python's `tomllib` on the cases in `test/toml-cases.json`.
  A file that a person made at a path Bowerloom owns whole (a subagent, `.codex/rules/bowerloom.rules`, the OpenCode
  plugin, the DeepSeek Harness patch) refuses `PORTABLE_PATH_OCCUPIED`.
- **Versions.** The gate applies to an engine that gets locked-in parts. OpenCode must be 1.18.30 and DeepSeek Harness
  0.2.2-alpha.2, recorded; Claude Code, Codex, and Pi must be at least 2.1.310, 0.157.0, and 1.4.0 by semver, so a
  prerelease of those is older. A version that is not semver, or anything else, refuses `PORTABLE_ENGINE_VERSION`. A newer or unrecorded Claude Code, Codex, or Pi version, and a portable-only
  projection for another OpenCode or DeepSeek Harness version, get a note on every line of that engine.
- **`${NAME:-x}`** and its like forms in MCP env, headers, command, args, or url, or in a hook command, refuse
  `PORTABLE_ENV_DEFAULT`. Subagent text and guardrail patterns are not scanned.
- **Values that would change meaning** refuse `PORTABLE_UNSAFE_VALUE`: `{env:` or `{file:` in a string bound for
  `opencode.json` or into the frontmatter of an OpenCode agent file, and a DeepSeek Harness private block that holds an object shaped like a `!!js` expression. Only a
  `JsExpression`, which Bowerloom builds for a `${NAME}` reference, is written as `!!js`.
- **Fidelity.** Every loss line of an entry goes through `checkFidelity` with `input.approvals`. An enforced entry that
  is weakened or absent with no matching approval refuses `PORTABLE_FIDELITY`; the refusal carries `refused`. The plan
  lists the approvals it uses in `approved`, and the receipt records them in `approvals`.
- **Trust.** `plan.trust` says whether each engine loads a file now. Codex project files are `pending trust` until
  `input.codexTrust.folderTrusted`; each Codex hook also until its entry hash is in `reviewedHooks`. `.pi/mcp.json` is
  `pending trust` until `piTrustSaved`.
- **What a person reads.** `plan.review` lists every executable value: each MCP command with its arguments and its
  environment (`env`: each name with its value, or null for a value that holds a `${NAME}` reference), each Claude Code
  and Codex hook command, by file, and in full the OpenCode plugin, the DeepSeek Harness patch, and
  `.codex/rules/bowerloom.rules`. The plan
  revision covers it. Claude Code project servers in `.mcp.json` are `pending trust`, because Claude Code asks first.
- **The Codex profile is held back** (`CODEX_PROFILE_ENABLED` is false). Bowerloom writes no `default_permissions` and
  no `[permissions.bowerloom]` until the live check of step 5 confirms their syntax. Codex path rules and sandbox
  requirements are `weakened` until then. `codexProfile` keeps the code.
- **Claude Code settings.** A person's `disableAllHooks` or `permissions.defaultMode`, in `.claude/settings.json` or
  `.claude/settings.local.json`, makes the hook lines `weakened`. Every hook line says that user and managed settings
  are not read. A
  sandbox requirement writes `enabled: true` and `allowUnsandboxedCommands: false`. A key of the sandbox's
  `x-claude-code` block is written only when `CLAUDE_SANDBOX_BLOCK_KEYS` lists it: a key the research notes document
  as one that only restricts or changes nothing. The list is empty until the live check of step 5. Every other key gets
  an `absent` line with the field `x-claude-code`, which needs an approval, since the sandbox is enforced.
- **Guardrail private blocks.** A `justification` in a Codex rule's `x-codex` block becomes the justification of its
  prefix rule, when it is one line with no control, format, or separator character; the line says the text comes from
  the definition. The line of any other guardrail entry with a private block names the keys that are not written.
- **Receipt format.** The receipt is `v1beta4`: a source record carries `claimed: true` when the 0.7 catalog only
  claims the source. A `v1beta3` or `v1beta2` receipt still reads, and the next apply writes `v1beta4`.
- **DeepSeek Harness.** MCP servers are `@deepseek-ai/dsh-mcp-client` rows, read from that package's README at the
  pinned tag. A sandbox requirement is `absent` in the fidelity translation itself.
- **The no-link fallback.** Where the file system has no link(), a new file is created with O_EXCL. A write that fails
  after that removes the file it created, so no truncated file stays behind.

### A folder that a 0.7 managed copy holds

A skill folder that a 0.7 skills sync manages refuses `PORTABLE_MANAGED_COPY`, unless adoption converted that copy.
Then `sources.json` records the skill in `adopted`, with the hex of the copy's skill content hash. A cloned project can
forge both the record and the marker files, so the plan also reads the canonical copy the record names
(`.bowerloom/managed/skills/<id>` or `.bowerloom-skills/skills/<id>`) and its catalog, which must parse as a JSON
object. Only when the canonical copy, the record, and the folder have the same hash, and every file in the folder is
one the projection writes, does the plan replace the files and save the originals. Removal then restores the 0.7 copy.
Anything else is refused as before.

One exception comes first, for any 0.7 item, a skill or a prompt. A folder that already holds exactly the files, bytes, and modes install would write is taken over, and nothing is written. The plan action is `take-over`, and removal keeps the folder. A forged marker gains nothing, because nothing is written. This is how the Codex skill folder of a 0.7 prompt installs after adoption: adoption reads that folder as a skill and does not convert the prompt. A 0.7 folder whose content would change, and that adoption did not convert, still refuses `PORTABLE_MANAGED_COPY`; the 0.7 sync owns it.

The hash means equal after normalisation, not byte for byte: Markdown line endings become LF, file modes do not count,
and an empty folder does not count. A file that differs only in those ways is still replaced, and its original bytes
and mode are saved and restored.

### What the private state folder keeps

The state folder holds `receipt.json`, `pending.json` while a run is unfinished, and `blobs/`, the saved bytes of files.

- Backups of the files a projection replaced stay in the state folder until removal. Removal puts them back and then
  deletes them. A run also saves the current bytes of each file just before it overwrites or deletes it. Those copies
  go once the run, or its recovery, finishes, with one exception: when a run stops on drift, the copy of the changed
  file it found is kept.
- When recovery keeps a person's version of a path, the saved original of that path moves to `kept/` in the state
  folder, which no cleanup touches. The path leaves the receipt, and the next apply targets it again.
- A restore keeps permission bits only: the read, write, and execute bits of owner, group, and others. The setuid,
  setgid, and sticky bits of a replaced file are not restored.
- A lost state folder means that Bowerloom no longer knows what it projected. The next plan treats the projected
  `AGENTS.md`, `CLAUDE.md`, and skill files as files a person made: it saves them as originals, and a later removal
  restores Bowerloom's own text. A projected skill folder is refused as occupied.
- The engine version in the receipt is recorded. The plan uses it only to decide whether Claude Code reads `AGENTS.md`
  when no `CLAUDE.md` exists (version 2.1.277 or later).

### Records are checked, not trusted

The revision of a record is a checksum, not a seal. Each record is read against a strict shape: every path must be
`AGENTS.md`, `CLAUDE.md`, a file of a skill folder under `.claude/skills` or `.agents/skills`, one of the locked-in files
in the table above (`LOCKED_FILES`), or `<id>.md` or `<id>.toml` directly in a subagent folder, and the record must name
this project. A receipt approval is checked with the contract's `parseFidelityApproval`. A record that fails is refused with `PORTABLE_STATE_INVALID` or `PORTABLE_STATE_FOREIGN`.

### The remaining window

Each write, rename, and unlink checks the folders above its path just before it acts. A rename reads its target again
inside that last check, and an unlink compares the device and inode of its folder with the value checked a moment
before. A folder is changed to mode 0755 through a descriptor that does not follow a link. A remaining window stays
between that last check and the system call itself: a program that runs as the same user and swaps a folder or edits a
file in that instant is not caught. The project lock keeps other Bowerloom commands out; it does not stop other programs.
