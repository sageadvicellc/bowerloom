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
revision is the same. Scripts, engine-private files, and the private blocks of skills are not projected yet: the plan
reports them `absent` and says that the projection is partial.

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
  is the file as it was before Bowerloom first wrote it, so a second projection gives the same bytes. Removal restores
  that file.
- **Conflicts are refused.** A managed name that the file already holds with other content, a TOML table, key, or
  inline table that a managed table would meet, an OpenCode `permission` the person keeps, an `opencode.jsonc`, and a
  Codex `sandbox_mode` beside the managed profile all refuse `PORTABLE_CONFLICT`. A file that is not strict JSON, TOML,
  or UTF-8 refuses `PORTABLE_TARGET_INVALID`. A subagent file a person made refuses `PORTABLE_PATH_OCCUPIED`.
- **Versions.** A recorded OpenCode version other than 1.18.30, or a DeepSeek Harness tag other than 0.2.2-alpha.2,
  refuses `PORTABLE_ENGINE_VERSION`. With no recorded version, either engine is refused when it gets locked-in parts.
- **`${NAME:-x}`** and its like forms are refused with `PORTABLE_ENV_DEFAULT` wherever an entry holds one. They never
  reach a written file.
- **Fidelity.** Every loss line of an entry goes through `checkFidelity` with `input.approvals`. An enforced entry that
  is weakened or absent with no matching approval refuses `PORTABLE_FIDELITY`; the refusal carries `refused`. The plan
  lists the approvals it uses in `approved`, and the receipt records them in `approvals`.
- **Trust.** `plan.trust` says whether each engine loads a file now. Codex project files are `pending trust` until
  `input.codexTrust.folderTrusted`; each Codex hook also until its entry hash is in `reviewedHooks`. `.pi/mcp.json` is
  `pending trust` until `piTrustSaved`.
- **Code to read.** The OpenCode hook plugin is in `plan.review` in full. The plan revision covers it.
- **The Codex profile.** Path rules and a sandbox requirement go to `[permissions.bowerloom]`, which extends
  `:workspace`, and `default_permissions = "bowerloom"` selects it. The live check of step 5 confirms both keys.
- **DeepSeek Harness.** MCP servers are `@deepseek-ai/dsh-mcp-client` rows, read from that package's README at the
  pinned tag. A sandbox requirement is `absent`: a mode there covers file effects only, a session can switch it, and
  Bowerloom has no confirmed row that sets it.

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
