# harness-definition

The harness definition core of Bowerloom 0.8. It holds what Bowerloom stores before any part moves into an engine. Every later lane imports it.

Specs: `2026-10-27-bowerloom-harness-definition.md`, and sections 2 to 4 of `2026-10-27-bowerloom-locked-in-parts.md`.

## What it does

- `loadDefinition(folder)` reads one `.bowerloom` folder laid out as in section 8 of the definition spec. It returns the definition, or every problem it found. It writes nothing.
- `resolveLayers(chain, options)` joins layers from the user store down to one project layer.
- `selectForEngine(source, engine)` gives the view for one engine. The view also lists what it left out.
- `checkFidelity(source, report, approvals, options)` judges a loss report.
- `computeRevision(files)` gives the revision hash. `scanSecrets(files)` finds secret values.

## A 0.8 folder

If a `.bowerloom` folder holds `harness.json`, it is a 0.8 definition. Otherwise it is not. `isDefinitionFolder` checks this.

Each top-level name is either a section 8 name or a 0.7 name in `LEGACY_NAMES`. The loader neither reads nor changes a 0.7 name. It refuses any other name, so a typo such as `guardrail.json` is not lost silently. The 0.7 list is a snapshot of 0.7.0-beta.3. When 0.7 adds a name, add it to the list.

## Trust boundary

A lower layer, such as a cloned project, is less trusted than the user store above it.

- A lower layer can only restrict what a higher layer set. Without a `LayerApproval` it cannot:
  - add an `allow` rule.
  - replace an `allow` rule with another `allow` rule.
  - hide or replace a hook, an MCP server, or a subagent.
- No approval can let a lower layer hide or replace a `deny` rule, an `ask` rule, or a sandbox requirement.
- A lower layer can add hooks, MCP servers, and subagents. Some of these get `needsApproval` on the resolved entry, with the layer they came from:
  - Every hook, because it runs a command.
  - Every server or subagent that holds a `${NAME}` or keychain reference.
  The projection plan must show these entries to a person before Bowerloom writes anything.
- A child layer's engines can only narrow the engines of its parent.

## Approvals

There are two approval records. Each record has four shared fields:

- `who`: the person who approved.
- `when`: the time. It cannot be in the future.
- `reason`: why the person approved.
- `entryHash`: the hash of the approved entry. `entryHash(entry)` computes it.

When the entry changes, the approval no longer applies.

- `FidelityApproval` lets Bowerloom project an `enforced` entry that is `weakened` or `absent` in one engine.
- `LayerApproval` lets a lower layer make one of the widening changes listed above.

Approvals live in the app data folder, outside the definition, so they do not change the revision. This package has the record types, their checks, and pure matchers. It has nothing that stores approvals.

`LayerOverride` (`hide`, `replace`) is a different thing: it is part of the definition, in `harness.json`.

## Fidelity

The result words are `exact`, `translated`, `weakened`, and `absent`, everywhere.

`checkFidelity` builds the expected set of part, entry, and engine itself. A missing line is a problem, so an empty report never passes. Every entry needs a line for every engine it applies to, exact ones too.

Strength comes from the definition (`strengthOf`). A loss line holds no strength:

- A `deny` or `ask` rule is enforced.
- A sandbox requirement is enforced.
- A subagent with a tool limit is enforced.

## For the adoption lane

- `SKILL.md` frontmatter holds the open core fields only: `name`, `description`, `license`, `compatibility`, and `metadata`.
- An engine-only skill key goes in the skill's entry in the `skills` map of `harness.json`, inside an `x-<engine>` block. The skill engine filter also goes there, as `engines`.
- A private block holds no permission-like key at any depth. Examples: `permissions`, `allowed-tools`, `sandbox_mode`, `approval_policy`, `tools`, `hooks`, `mcpServers`. `isPermissionKey` holds the rule. Adopt Claude Code's `allowed-tools` as a guardrail entry, never as a private block.
- An engine that `harness.json` does not list cannot be the target of an engine filter, a private block, a model, or an `engines/<id>/` folder.

## For the projection lanes

- The order of guardrail rules carries no precedence. The precedence is fixed: `deny` beats `ask`, and `ask` beats `allow`. A lane for a last-match-wins engine sorts the rules itself.
- `resolved.hidden` lists each hidden item. Some engines read parent folders themselves. For example, Claude Code reads user and project skills. In such an engine a hidden item can still load, so the lane reports it.
- `selectForEngine(...).excluded` lists the entries that the engine filter left out, and the private blocks of other engines that the view removed.

## Revision

The revision is a SHA-256 hash over the canonical files:

- Paths are relative and in Unicode NFC.
- The five machine JSON files are hashed in canonical form.
- Markdown files outside `scripts/` and `engines/` have their line endings changed to LF.
- Every other file is hashed as raw bytes.
- The execute bit counts. A file system with no execute bit, such as one on Windows, reads every file as not executable.

## Secret scan

The scan is linear. It fails closed: a text line over 4096 characters, and a `.json` file that is not strict JSON, give `SECRET_SCAN_INCOMPLETE`. A finding never holds the value it found.
