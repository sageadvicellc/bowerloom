# harness-definition

The harness definition core of Bowerloom 0.8. It holds what Bowerloom stores before any part moves into an engine. Every later lane imports it.

Specs: `2026-10-27-bowerloom-harness-definition.md`, and sections 2 to 4 of `2026-10-27-bowerloom-locked-in-parts.md`.

## What it does

- `loadDefinition(folder)` reads one `.bowerloom` folder laid out as in section 8 of the definition spec. It returns the definition, or every problem it found. It writes nothing.
- `resolveLayers(chain, options)` joins layers from the user store down to one project layer.
- `selectForEngine(source, engine)` gives the view for one engine. The view also lists what it left out.
- `checkFidelity(source, report, approvals, options)` judges a loss report.
- `computeRevision(files)` gives the revision hash. `scanSecrets(files)` finds secret values.
- `loadDefinitionFiles(files)` runs the same loader over files held in memory. It reads and writes nothing on disk.
- `editDefinition(def, edits)` applies a closed set of edits to one loaded definition. It returns the full target file set and a change list, or a typed refusal. It is pure. A file that no edit names stays byte-identical, and `loadDefinitionFiles` checks the result. The edits are `set-skill`, `add-skill`, `remove-skill`, `set-agent` (skills, tools, and notes), `set-instructions`, `set-engines`, `set-source`, and `remove-source`. The refusal codes are `EDIT_BAD_EDIT`, `EDIT_UNSAFE_ID`, `EDIT_UNKNOWN_ID`, `EDIT_DUPLICATE_ID`, `EDIT_UNSAFE_PATH`, `EDIT_TOO_LARGE`, `EDIT_SECRET_FOUND`, and `EDIT_INVALID`.
- `storedKnowledgePath(folder, { root, home })` gives the stored form of a folder a person picked, or a typed refusal. It reads no disk.

## A 0.8 folder

If a `.bowerloom` folder holds `harness.json`, it is a 0.8 definition. Otherwise it is not. `isDefinitionFolder` checks this.

Each top-level name is either a section 8 name or a 0.7 name in `LEGACY_NAMES`. The loader neither reads nor changes a 0.7 name. It refuses any other name, so a typo such as `guardrail.json` is not lost silently. The 0.7 list is a snapshot of 0.7.0-beta.3. When 0.7 adds a name, add it to the list.

## Knowledge sources

A knowledge source is a pointer: a kind, a name, and a path (0.8 spec, sections 6.9 and 6.10). Bowerloom never reads page content.

- `knowledge.json` at the top of the `.bowerloom` folder lists the sources: `{ "sources": [ { "kind": "wiki-folder", "name": "wiki", "path": "notes" } ] }`. `wiki-folder` is the one kind. It is not a part, so `harness.json` holds no pointer to it.
- A name is an id. A path is `.` (the harness folder, which holds `.bowerloom`), a path relative to the harness folder, or `~/<path>`. It is never absolute and holds no `..`, backslash, backtick, or control character. Each name and each path is used once. Load problems: `KNOWLEDGE_KIND`, `KNOWLEDGE_PATH`, `KNOWLEDGE_DUPLICATE_PATH`, and the shared `INVALID_ID`, `DUPLICATE_ID`, `INVALID_FIELD`, and `UNKNOWN_FIELD`. A message never repeats a path.
- An agent lists the sources it reads in its frontmatter: `notes: [wiki]`. A name that is not a source of the same folder is `NOTES_SOURCE_UNKNOWN`.
- `remove-source` takes the name out of every agent's `notes`, as `remove-skill` does for skills, and removes a list it leaves empty. The last source removed deletes `knowledge.json`.
- `storedKnowledgePath` refuses `KNOWLEDGE_PATH_OUTSIDE` for an absolute folder outside both the harness folder and home, `KNOWLEDGE_PATH_ESCAPES` for a `..` that leaves the harness folder or home, and `KNOWLEDGE_PATH_UNSAFE` for home itself and odd text.
- The revision hashes `knowledge.json` in canonical form, as the other machine files.

## Trust boundary

A lower layer, such as a cloned project, is less trusted than the user store above it.

- A lower layer can only restrict what a higher layer set. Without a `LayerApproval` it cannot:
  - add an `allow` rule.
  - replace an `allow` rule with another `allow` rule.
  - hide or replace a hook, an MCP server, or a subagent.
- No approval can let a lower layer hide or replace a `deny` rule, an `ask` rule, or a sandbox requirement.
- A lower layer can add hooks, MCP servers, and subagents. Some of these get `needsApproval` on the resolved entry, with the layer they came from:
  - Every hook, because it runs a command.
  - Every MCP server that uses `stdio`, because it runs a command too.
  - Every server or subagent that holds a `${NAME}` or keychain reference.
  - Every entry with an `x-<engine>` block.
  The projection plan must show these entries to a person before Bowerloom writes anything.
- A child layer's engines can only narrow the engines of its parent.

## Approvals

There are two approval records. Each record has four shared fields:

- `who`: the person who approved.
- `when`: the time. It cannot be in the future.
- `reason`: why the person approved.
- `entryHash`: the hash of the approved entry. `entryHash(entry)` computes it.

When the entry changes, the approval no longer applies. The entry hash also counts execute bits: a skill lists its executable files, and each script in `scriptEntries` has its own bit. So a `chmod +x` makes an approval of that skill or script void.

A `LayerApproval` also names `folder`, the `.bowerloom` folder of the layer that makes the change. So an approval for one project never applies to another. For `replace`, it also names `targetHash`, the hash of the item it replaces.

- `FidelityApproval` lets Bowerloom project an `enforced` entry that is `weakened` or `absent` in one engine.
- `LayerApproval` lets a lower layer make one of the widening changes listed above.

Approvals live in the app data folder, outside the definition, so they do not change the revision. This package has the record types, their checks, and pure matchers. It has nothing that stores approvals.

`LayerOverride` (`hide`, `replace`) is a different thing: it is part of the definition, in `harness.json`.

## Fidelity

The result words are `exact`, `translated`, `weakened`, and `absent`, everywhere.

`checkFidelity` builds the expected set of part, entry, and engine itself. A missing line is a problem, so an empty report never passes. Every entry needs a line for every engine it applies to, exact ones too.

A loss line names a part key, or `engine-private` for a file under `engines/<engine>/` (`LOSS_PARTS`). Its entry is the path of the file in the definition, such as `engines/codex/config.json`. Such a line is advisory.

Strength comes from the definition (`strengthOf`). A loss line holds no strength:

- A `deny` or `ask` rule is enforced.
- A sandbox requirement is enforced.
- A subagent with a tool limit is enforced.

## For the adoption lane

- `SKILL.md` frontmatter holds the open core fields only: `name`, `description`, `license`, `compatibility`, and `metadata`.
- An engine-only skill key goes in the skill's entry in the `skills` map of `harness.json`, inside an `x-<engine>` block. The skill engine filter also goes there, as `engines`.
- A private block holds no permission-like key at any depth. Examples: `permissions`, `allowed-tools`, `sandbox_mode`, `permissionMode`, `defaultMode`, `approval_policy`, `tools`, `hooks`, `mcpServers`. `isPermissionKey` holds the rule. Adopt Claude Code's `allowed-tools` as a guardrail entry, never as a private block.
- A key that runs a command, fetches a credential, or grants trust to a plugin or a provider is permission-like too: for example `awsAuthRefresh`, `awsCredentialExport`, `extraKnownMarketplaces`, `enabledPlugins`, `notify`, and `model_providers`.
- `mode` alone is not permission-like. OpenCode's agent `mode` (`primary`, `subagent`, or `all`) rides in the agent's `x-opencode` block, and the subagent writer writes it back.
- An engine that `harness.json` does not list cannot be the target of an engine filter, a private block, a model, or an `engines/<id>/` folder.
- The denylist of private-block keys cannot be complete. So the projection lanes treat every private block as untrusted. They run the fidelity check on what they project from a private block, as they do for neutral entries.

## For the projection lanes

- The order of guardrail rules carries no precedence. The precedence is fixed: `deny` beats `ask`, and `ask` beats `allow`. A lane for a last-match-wins engine sorts the rules itself.
- `resolved.hidden` lists each hidden item. Some engines read parent folders themselves. For example, Claude Code reads user and project skills. In such an engine a hidden item can still load, so the lane reports it.
- `selectForEngine(...).excluded` lists the entries that the engine filter left out, and the private blocks of other engines that the view removed.

## sources.json

`sources` lists borrowed sources, each with a pinned version. `claimed: true` marks a source that a 0.7 catalog only claims, which Bowerloom did not check.

`adopted` lists the skills that adoption converted from 0.7 managed copies. Each record is `{ part: "skills", id, adoptedFrom: { kind: "0.7-managed", path, sha256 } }`. `path` is the canonical copy of that very skill: exactly `.bowerloom/managed/skills/<id>` or `.bowerloom-skills/skills/<id>`, with the record's own id (`adoptedPaths`). `sha256` is the hex of the copy's skill content hash (`skillContentHash` without its `sha256:` prefix). The loader checks both strictly. `definition.adopted` holds the records.

The skill content hash says two folders are equal after normalisation, not byte for byte: Markdown line endings become LF, file modes do not count, and an empty folder holds no file, so it does not count either.

## Revision

The revision is a SHA-256 hash over the canonical files:

- Paths are relative and in Unicode NFC.
- The five machine JSON files are hashed in canonical form.
- Markdown files outside `scripts/` and `engines/` have their line endings changed to LF.
- Every other file is hashed as raw bytes.
- File modes do not count. The projection receipt records the mode of each file it writes, so it catches mode drift.

A skill entry carries `contentHash`, a hash of every file in its folder. So when any file of the skill changes, its `entryHash` changes too, and any approval for it no longer applies.

## Secret scan

The scan is linear. A finding never holds the value it found.

The scan fails closed. Each of these gives `SECRET_SCAN_INCOMPLETE`, and the loader refuses the definition:

- A text line over 4096 characters.
- A `.json` file that is not strict JSON.

A hook command has the same 4096-character limit, so the scan always reads all of it. If a YAML file does not parse, the scan reads it line by line.
