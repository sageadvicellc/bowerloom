# Spec 01a: team agents for Claude Code

## 1. Header

- Source issue: sageadvicellc/bowerloom#84.
- Decisions: decisions 1 and 2 are in https://github.com/sageadvicellc/bowerloom/issues/84#issuecomment-6332807422. Decisions 3, 4, and 5 are in https://github.com/sageadvicellc/bowerloom/issues/84#issuecomment-6332928335. Decision 6 splits this work and is in https://github.com/sageadvicellc/bowerloom/issues/84#issuecomment-6333531579. Decision 4 (adopt identical copies, hold different ones, no `--replace-agents`) binds this spec. Decision 3 (a Codex copy is never more powerful) moves to spec 01b.
- Lane: 1. Spec 05 builds on this spec. Spec 01b (the capability model and Codex agents) builds on it too.
- Branch: `beta3/01a-team-agents-claude`, from `release/0.7.0-beta.3`.
- Dependencies: none. This spec shares two files with other specs: `apps/docs/src/content/docs/releases.md` and `packages/managed-skills/src/v2-observed.ts`. The builder resolves merge conflicts there.

Terms used below:

- A **harness** is an agent application that reads project files. The two harnesses are Claude Code and Codex.
- A **managed item** is one thing that `apply` installs and tracks, such as a skill or a prompt. This spec adds the kind `agent`.
- A **surface** is one place a managed item writes to, such as a file.
- A **hold** is a reported reason that one item is not applied. The rest of the plan still applies.
- A **plan revision** is the 64-character hash that binds every input of a plan. Approval names it.
- A **subagent** is an agent that Claude Code starts for one task, defined in `.claude/agents/<name>.md`.

## 2. Problem

`bowerloom apply` copies skills and prompts. It does not copy a team's agents. Claude Code reads subagents only from `.claude/agents/`. A team that defines its roles as agents has no working subagents after `apply`. The copies are ignored by git, so every new clone starts with none.

The Sage Advice workbench keeps six research roles in `.bowerloom/teams/research-desk/agents/*.md`. It copies them by hand. One copy went stale. `bowerloom status` reports the team folder as `edited` because no owner claims the `agents/` files.

Hanna's decisions that bind this spec:

1. Each role has one source file, `.bowerloom/teams/<team>/agents/<role>.md`, in the Claude Code subagent format. `apply` copies it to `.claude/agents/<role>.md`.
2. The `name` key must equal the file name without `.md`.
3. A hand-made file at the target path that matches the copy is adopted. A hand-made file that differs holds that agent with `AGENT_TARGET_OCCUPIED`. There is no `--replace-agents` flag.
4. Codex agents are not part of this spec. Spec 01b designs a harness-neutral capability model, and Codex agents follow from it.

## 3. Behavior

### 3.1 What apply does

1. Apply finds agents. For each team in `.bowerloom/authoring/receipt.json` it reads `.bowerloom/teams/<team>/agents/`. It skips `first-team`, which the startup receipt owns.
2. Apply checks each agent file with the rules in section 4.1.
3. Apply plans each agent as a managed item with id `agent_<role>`. The item has one surface, `agent-claude`, plus the catalog record.
4. The plan lists each agent with the same `up to date` or `update` line that prompts get. The agents are part of the plan revision.
5. After approval, apply writes one transaction per agent. It writes the Claude file and the catalog record together.
6. Apply never removes a copy. It never overwrites a copy that it did not install and that differs from the source. It starts no process. It never fetches. The copy is the source bytes, unchanged.

The flag `--harness claude|codex|both` works like this:

- `claude` and `both` (the default) plan the agents.
- `codex` plans no agent. The plan has no agent lines, and no agent catalog record shows as `kept`. If at least one agent source exists, the plan prints the Codex line of section 3.2.
- With `both`, the Codex line also prints when at least one agent source exists, so a user knows the Codex copies are not made.
- An agent item always has the harness list `['claude']`. A request for an agent with any other harness list is refused by the managed-item request check (section 6.1).

### 3.2 Plan lines, verbatim

`<role>` is the file name without `.md`. `<team>` is the team id. `<pad>` is `''.padEnd(width)`, where `width` is the longest id in the plan plus one, as `apps/cli/src/apply.ts:66` computes it. Agent ids count toward `width`. Item lines start with two spaces.

The title line (`apps/cli/src/apply.ts:69`) becomes:

```
Apply skills, prompts, and agents for <harnesses>, team <team>
```

The `, team <team>` part appears only when a team is given, as it does today.

Per agent, state by state:

```
  <role> install agent: .claude/agents/<role>.md
  <role> update agent: .claude/agents/<role>.md
  <role> adopt agent: .claude/agents/<role>.md
  <role> up to date
  <role> kept: no longer an agent of this project, and apply removes nothing
  <role> held (<code>)
  <pad> Next: <next step>
```

State rules:

- `install`: no catalog record exists and the target file does not exist.
- `adopt`: no catalog record exists, the target file exists, and its bytes equal the source bytes. Apply writes no byte of the file. It records the file in the catalog, so Bowerloom manages it from then on.
- `update`: a catalog record exists and the source bytes changed.
- `up to date`: a catalog record exists and nothing changed.
- `orphaned`: a catalog record exists and the source file is gone, or the team no longer holds the agent.
- `held`: see section 5.

If the target file exists and its bytes differ from the source, and no catalog record exists, the agent is held with `AGENT_TARGET_OCCUPIED`. Nothing about that agent is written.

A built-in name warning (section 4.2) follows the agent's main line:

```
  <pad> Warning: <role> is the name of a built-in agent of Claude Code. Your agent takes precedence.
```

A notice line for an agent that can grant tools, shell access, or hooks. It follows the style of `noticeLine` in `apps/cli/src/apply.ts:36`:

```
  Note: agent <role> sets hooks and lists shell tools in tools. Claude Code applies them when the agent runs. Review .bowerloom/teams/<team>/agents/<role>.md.
```

The notice names these items, in this order, joined with `, ` and a final ` and `:

1. `sets hooks`, when the key `hooks` is present.
2. `sets mcpServers`, when the key `mcpServers` is present.
3. `sets permissionMode bypassPermissions`, when `permissionMode` has that value.
4. `lists shell tools in tools`, when `tools` has an entry whose tool name is `Bash`, `PowerShell`, or `Monitor`. The tool name is the part before any `(`. Monitor runs commands, so it counts as a shell tool.
5. `lists file-editing tools in tools`, when `tools` has an entry whose tool name is `Edit`, `Write`, or `NotebookEdit`.

The notice appears only when the item action is `install`, `update`, or `adopt`. It never quotes file text. If `tools` is absent, the agent inherits all tools, and no tool notice prints.

The Codex line, unindented, printed once after all item lines and before the `Network:` line (`apps/cli/src/apply.ts:71`), when `--harness` is `codex` or `both` and at least one agent source exists:

```
Codex agents are not projected in this beta. See the capability model design.
```

The pointer text (`packages/project-sync/src/apply-project.ts:44-58`) gains an agents sentence for the Claude harness:

- Claude only: `Project skills are in .claude/skills. Prompts are Claude Code commands in .claude/commands. Agents are in .claude/agents.`
- Both: `Project skills are in .claude/skills and .agents/skills. Prompts are Claude Code commands in .claude/commands, and Codex skills named prompt-<name>. Agents are in .claude/agents.`
- Codex only: unchanged.

The empty-plan text (`apps/cli/src/apply.ts:70`) becomes `  Nothing in .bowerloom/skills.json, .bowerloom/prompts, or .bowerloom/teams/*/agents to apply yet.`

Result words (`apps/cli/src/apply.ts:77-85`): the name function prints `agent <role>` for kind `agent`. The lines read `  agent <role>: installed`, `  agent <role>: updated`, `  agent <role>: held (<code>). Next: <next>`, and `kept, no longer listed: agent <role>`. An adopted agent counts as `installed`.

### 3.3 Help text

`apps/cli/src/human.ts` changes:

- Line 100: `apply   when skills, prompts, or agents of the team need copies for Claude Code and Codex: apply.`
- Lines 111 to 120 (the `apply` help): keep the usage line. Add these sentences after the existing ones:
  - `Agents come from .bowerloom/teams/<team>/agents/<role>.md. Apply copies each one to .claude/agents/<role>.md for Claude Code. Codex agents are not projected in this beta.`
  - `A file at .claude/agents/<role>.md that Bowerloom did not install is adopted when it equals the source. If it differs, apply holds that agent. Move the file aside, then run bowerloom apply.`
- Line 116: the sentence about copies adds `.claude/agents/<role>.md for an agent`.
- Line 133 is about skill ids. It stays.

### 3.4 Exit codes

They do not change (`apps/cli/src/apply.ts:99`):

- `0`: the apply finished, or there was nothing to change.
- `3`: approval is required.
- A refusal throws. The code is printed with its sentence and next step.

A hold is not a refusal. A plan with only holds prints `Nothing to change.` and exits 0. `AGENT_TARGET_OCCUPIED` and `AGENT_SOURCE_MISSING` are holds. `APPLY_AGENT_DUPLICATE`, `AGENT_INVALID`, `AGENT_KEY_UNKNOWN`, `AGENT_NAME_MISMATCH`, and `AGENT_LIMIT` refuse the whole plan, because a bad source file means the user's input is wrong.

### 3.5 Write order and crash recovery

Apply keeps the order it has today (`packages/project-sync/src/apply-project.ts:181-215`):

1. Plan under the project lock. Refuse `STALE_APPROVAL` if the revision differs.
2. Create private folders.
3. Phase B for skills, then prompts, then agents. No project write happens in phase B. Agents are sorted by `<role>` in byte order.
4. Phase C, `applyChildren`, runs each child in the same order. Each agent child is one managed transaction. The transaction stages the Claude file and the catalog record, renames them, and commits the receipt last. An adopted agent stages only the catalog record.
5. Interrupt: the signal is read between children, never inside one. Done agents are complete. Left agents are untouched. The message is `SKILLS_SYNC_INTERRUPTED` with `bowerloom apply` as the rerun command, as prompts do.
6. Crash inside a transaction: `.bowerloom/managed-pending.json` stays. The next plan refuses with `MANAGED_SKILL_RECOVERY_REQUIRED` and the next step `bowerloom skills recover plan --item agent_<role>`. Recovery resumes, abandons, or rolls back that one agent, as it does for a prompt.

## 4. Schemas and formats

### 4.1 Agent file validation

The function is `parseAgent(text, stem, team)`. It is pure. It lives in `packages/project-authoring/src/agent-file.ts`, so both the authoring owner and project-sync can import it. Every rule below is a check. A failed check throws the named code. No message quotes file text.

File rules (the reading code applies them with the authoring guards `folderNames` and `readGuarded` in `packages/project-authoring/src/files.ts:28,40`):

- The folder `.bowerloom/teams/<team>/agents/` may hold only plain files named `<stem>.md`. A folder, another extension, a hidden name, or a link is `AGENT_INVALID`.
- A file is at most 64 KiB (65536 bytes).
- A file is valid UTF-8 with no byte order mark and no carriage return. A lone surrogate, a null byte, or a carriage return is `AGENT_INVALID`.
- The stem matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, has at most 64 characters, and does not start with `prompt-`. A bad stem is `AGENT_NAME_MISMATCH`.
- A project holds at most 128 agents in total. More is `AGENT_LIMIT`.

Frontmatter rules:

- The first line is `---`. Trailing spaces and tabs on a fence line are allowed. The closing fence is the next line that matches.
- The block parses with `parseDocument(block, { uniqueKeys: true })` and `toJS({ maxAliasCount: 0 })`. A parse error, an alias, a merge key, a duplicate key, or a result that is not a map is `AGENT_INVALID`.
- The body is everything after the closing fence line. Remove every trailing line break. If the rest is empty or only white space, the file is `AGENT_INVALID`. Validation does not change the file. The copy is the original bytes.

Allowed keys, in this order (Claude Code subagent fields, from code.claude.com/docs/en/sub-agents, fetched 2026-10-22):

```
name, description, tools, disallowedTools, model, permissionMode, maxTurns,
autoCompactWindow, skills, mcpServers, hooks, memory, background,
omitClaudeMd, effort, isolation, color, initialPrompt, experimental
```

Any other key is `AGENT_KEY_UNKNOWN`, and the message names the key. Keys are checked before values.

Value rules:

- `name`: required string. It must equal the stem, or the code is `AGENT_NAME_MISMATCH`. It has at most 64 characters and no `:`. (Claude Code allows up to 256 characters. Bowerloom is stricter because the name is a file name.)
- `description`: required string, at least 1 and at most 2048 characters.
- `tools`, `disallowedTools`, `skills`: a comma-separated string or a list of strings. To split a string, cut at each comma outside parentheses, then trim each entry. Each entry is 1 to 128 characters. The list has at most 64 entries. A tool entry matches `^[A-Za-z0-9_.:*-]+(\(.{0,100}\))?$`. So `Bash(npm run *)` and `Edit(/src/**)` are valid. An empty entry is `AGENT_INVALID`.
- `model`: string matching `^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,127}$`.
- `permissionMode`: one of `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`, `manual`.
- `maxTurns`: integer, 1 to 10000.
- `autoCompactWindow`: integer, 100000 to 1000000.
- `mcpServers`, `hooks`: any YAML map or list. Depth at most 6. At most 4096 bytes when written as JSON. Bowerloom never reads their meaning.
- `memory`: `user`, `project`, or `local`.
- `background`, `omitClaudeMd`: boolean.
- `effort`: `low`, `medium`, `high`, `xhigh`, or `max`.
- `isolation`: `worktree`.
- `color`: `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, or `cyan`.
- `initialPrompt`: string, at most 8192 bytes.
- `experimental`: a map with only the key `cacheTtl`, whose value is `5m` or `1h`.

A bad value is `AGENT_INVALID`, and the message names the key.

### 4.2 Names

- One role name belongs to one team in a layer. Two teams with the same stem are `APPLY_AGENT_DUPLICATE`. The check is case-insensitive after NFC normalization, and it runs before any write.
- A role named like a built-in Claude Code agent produces the warning line in section 3.2. It does not stop the plan. The match is on the lowercase name.
- The built-in names live in one constant, `BUILTIN_AGENT_NAMES`, in `packages/project-sync/src/agents.ts`:

| Name | Status |
|---|---|
| `explore` | Unverified |
| `plan` | Unverified |
| `general-purpose` | Unverified |

The tools reference of 2026-10-22 lists tool names, not built-in agents, so none of these names is verified from a source in hand. Section 12 says how to check them.

### 4.3 Tool names (for notices)

The verified Claude Code tool names (code.claude.com/docs/en/tools-reference, fetched 2026-10-22):

- Shell tools: `Bash`, `PowerShell`, and `Monitor`. Monitor runs commands.
- File-editing tools: `Edit`, `Write`, and `NotebookEdit`.
- Web tools: `WebFetch` and `WebSearch`.
- MCP tools: any name that starts with `mcp__`.
- `Agent` starts subagents.

`MultiEdit`, `BashOutput`, and `KillShell` are not in the current tool list. This spec does not name them. A permission pattern such as `Bash(npm run *)` or `Edit(/src/**)` is a valid tool entry. Its tool name is the part before `(`.

Only the notice rule of section 3.2 uses these classes. Bowerloom does not refuse or hold on any tool name. A name in none of these classes is accepted and ignored.

### 4.4 Managed item and receipt shape

- Item reference: `{ kind: 'agent', id: '<role>' }`.
- Private folder name and catalog name: `agent_<role>`. The underscore is the reason: catalog names are parsed back into item references (`packages/managed-skills/src/v2-observed.ts:254-257`), and skill ids cannot hold an underscore (`packages/managed-skills/src/local-source.ts:15`). A skill named `agent-foo` can still exist and does not collide.
- Surfaces: `agent-claude` (a file) at `.claude/agents/<role>.md`, and `catalog` (a file) at `.bowerloom/managed/catalog/agent_<role>.json`. No `canonical` and no `projection-*` surface exists for an agent.
- Source: a member with kind `agent`, the team id, and the role name. The closure source path is `teams/<team>/agents/<role>.md`.
- The catalog record keeps the existing format, with `item.kind` set to `agent`. Its `inventory` holds the source file's path (`<role>.md`), hash, and size. Its `harnesses` list is `["claude"]`.
- Moving an agent to another team changes the closure source path. That is an `update`, though the copy bytes stay the same.
- Format bump: the apply plan format changes from `bowerloom/project-apply-plan/v1beta1` to `v1beta2`, and the result format from `bowerloom/project-apply-result/v1beta1` to `v1beta2` (`packages/project-sync/src/apply-project.ts:38-39`). The bump stays in the Claude-only design. The plan gains the field `agents`, and the result item kind gains `agent`. A reader that knows only v1beta1 would silently skip those. A new format string makes it fail loudly. Update every test that asserts the old strings.

### 4.5 Status ownership

`bowerloom status` claims the agent sources through the authoring owner. The owner verifies a registered team folder as a whole and compares its files with the receipt pins (`packages/project-authoring/src/verifiers.ts:66-70`). Agent sources are hand-placed and never registered, so they must not count as a difference.

- The team verifier ignores the subtree `teams/<id>/agents/` in the pin comparison.
- The verifier checks each file in that subtree with `parseAgent`. A bad file returns `refused('AGENT_INVALID')` for the team folder. A duplicate role across teams is not a status finding. It is a plan refusal.
- The copies in `.claude/agents` are outside `.bowerloom/`. Owners never see them. Their drift appears as holds from the apply plan, in `bowerloom status` and `bowerloom up`, as prompt drift does (`apps/cli/src/project-status.ts:42-53`). The line format is `  agent <role>: held (<code>). Next: <next>`.

## 5. Refusal codes

| Code | Cause | Next step |
|---|---|---|
| `AGENT_INVALID` | An agent file is unreadable, too large, has bad frontmatter, a bad value, a carriage return, a lone surrogate, or sits in `agents/` with a name that is not `<stem>.md`. The `agents/` folder holds a folder or a link. | `Fix .bowerloom/teams/<team>/agents/<file>, then run bowerloom apply.` The message names the key or the entry. |
| `AGENT_KEY_UNKNOWN` | The frontmatter has a key outside the allowed list. | `Remove the key <key> from .bowerloom/teams/<team>/agents/<role>.md, then run bowerloom apply.` |
| `AGENT_NAME_MISMATCH` | `name` differs from the file name without `.md`, or the file name is not a valid role name. | `Make the name key equal <stem> in .bowerloom/teams/<team>/agents/<role>.md, then run bowerloom apply.` |
| `AGENT_LIMIT` | The project holds more than 128 agents. | `Move agents out of the teams, then run bowerloom apply.` |
| `APPLY_AGENT_DUPLICATE` | Two teams in one layer hold the same role name. The message names both teams. | `Rename one of the two files and its name key, then run bowerloom apply.` |
| `AGENT_TARGET_OCCUPIED` | The target file exists, Bowerloom did not install it, and it differs from the source. This is a hold. | `.claude/agents/<role>.md was not installed by Bowerloom and differs from .bowerloom/teams/<team>/agents/<role>.md. Move it aside, then run bowerloom apply.` |
| `AGENT_SOURCE_MISSING` | A catalog record names an agent whose team folder still exists but whose source file is gone, while the agent was installed. This is a hold, and the copy stays. | `<source path> is gone. Restore it from version control, then run bowerloom apply.` |

Existing codes this spec reuses: `APPLY_NAME_COLLISION` (the agent surface would take the path of a skill or prompt), `STALE_APPROVAL`, `MANAGED_SKILL_LOCAL_DRIFT` (the copy was edited after install), `MANAGED_SKILL_RECOVERY_REQUIRED`, and `SKILLS_SYNC_INTERRUPTED`.

Where each code is registered:

- Message: `packages/project-sync/src/refusal.ts:25-26` (the `MESSAGES` object).
- Sentence and next step: `apps/cli/src/human.ts:275-276`.
- Docs row: `apps/docs/src/content/docs/reference/errors.md:127-128`.
- The list in `apps/docs/src/content/docs/guides/add-skills.md:282`.

## 6. Where to change

Paths are checked against the beta.3 tree.

### 6.1 managed-skills

- `packages/managed-skills/src/v2-types.ts:14`: add `'agent-claude'` to `ItemSurfaceId`.
- `packages/managed-skills/src/v2-types.ts:20`: `ItemRef.kind` becomes `'skill' | 'prompt' | 'agent'`.
- `packages/managed-skills/src/v2-types.ts:21`: `ItemSource` gains a member with kind `agent` and the string fields `team` and `name`.
- `packages/managed-skills/src/v2-types.ts:31`: `LocalClosure.source` gains a member with kind `agent` and the string field `path`.
- `packages/managed-skills/src/v2-observed.ts:32`: `ITEM_SURFACES` gains `agent-claude`.
- `packages/managed-skills/src/v2-observed.ts:40`: `itemId` returns `'agent_' + item.id` for kind `agent`.
- `packages/managed-skills/src/v2-observed.ts:41-44`: `itemRef` accepts kind `agent`. A skill id must not start with `agent_`. The `prompt-` rule stays.
- `packages/managed-skills/src/v2-observed.ts:55`: the request check accepts `source.kind === 'agent'` only with `item.kind === 'agent'`, `source.name === item.id`, a valid team id, and the harness list exactly `['claude']`.
- `packages/managed-skills/src/v2-observed.ts:79-91`: `locateV2` for kind `agent` emits no `canonical` and no `projection-*` surface. It emits `agent-claude` at `.claude/agents/<name>.md`. Line 85 adds `projection-codex` for every item whose harness list holds Codex, so add the guard `item.kind !== 'agent'`. The check at line 81 (`!name.startsWith('prompt-')`) stays.
- `packages/managed-skills/src/v2-observed.ts:118-132`: `materialV2` writes `agent-claude` as `fileOf(c.name + '.md', text)`, the source bytes.
- `packages/managed-skills/src/v2-observed.ts:254-257`: the `catalogItem` expression becomes `/^(?:(prompt-)|(agent_))?([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/` and returns kind `agent` for the second group.
- `packages/managed-skills/src/v2-transaction.ts:81`: `STAGE_NAME` gains `agent-claude`.
- `packages/managed-skills/src/local-source.ts:43-47`: `base` takes the area `'skills' | 'prompts' | 'teams'`. Add `readLocalAgent(projectDir, team, role, live)` after `readLocalPrompt` (line 65). It reads `.bowerloom/teams/<team>/agents/<role>.md` with `authored(file, LIMITS.file)` and returns the closure with source path `teams/<team>/agents/<role>.md`.

### 6.2 project-sync

- New file `packages/project-sync/src/agents.ts`: `BUILTIN_AGENT_NAMES`, `agentNotices`, `registeredAgents`, `agentSurfaces`, `classifyAgent`, `orphanAgent`, `agentRequest`, `checkAgentChild`. Copy the structure of `packages/project-sync/src/prompts.ts` (`classifyPrompt` at line 121, `orphanPrompt` at 179, `promptRequest` at 186, `checkPromptChild` at 196, `promptNotices` at 53, `registeredPrompts` at 89). `classifyAgent` differs in two ways: the harness list is always `['claude']`, and a differing existing file is a per-item hold, not a thrown collision (`prompts.ts:163-166` throws). A matching existing file sets state `adopt`.
- `packages/project-sync/src/apply-project.ts:38-39`: bump the two format strings.
- `packages/project-sync/src/apply-project.ts:44-58`: `applyPointer` text, as in section 3.2.
- `packages/project-sync/src/apply-project.ts:69-82`: `ApplyPlan` gains `agents: AgentItem[]`.
- `packages/project-sync/src/apply-project.ts:83`: `ApplyItemRef.kind` gains `'agent'`.
- `packages/project-sync/src/apply-project.ts:95`: add `agentActionable`.
- `packages/project-sync/src/apply-project.ts:103-115`: `checkNames` takes agents. Agent rows use the agent surfaces. Add the duplicate-role check here.
- `packages/project-sync/src/apply-project.ts:118-178`: `observeApply`. After the prompt block (line 143), build `agents` from `registeredAgents` filtered by team (as prompts at line 137), only when the harness list holds `claude`. Skip agents and their orphan scan when it does not. Include agents in `checkNames` (line 144), the `create` list (lines 148-152), `body` (line 153), `binding` (line 163), and `actionable` (line 158). Add a boolean `codexAgentsSkipped` to the plan when an agent source exists and the harness list holds `codex`.
- `packages/project-sync/src/apply-project.ts:181-215`: `applyProjectApply`. After the prompt loop (lines 194-203), build agent children with `agentRequest` and `checkAgentChild`. Extend `refOf` (line 206) and the `held`, `upToDate`, and `orphaned` lists (lines 211-213).
- `packages/project-sync/src/index.ts:15-17`: export `AgentItem` and `AgentState`.
- `packages/project-sync/src/recover.ts:19`: `ITEM_ID` becomes `/^(?:prompt-|agent_)?[a-z0-9]+(?:-[a-z0-9]+)*$/`. The length check below it stays valid (`agent_` plus 64 is 70).
- `packages/project-sync/src/recover.ts:31`: the `owner` expression gains the kind `agent`.
- `packages/project-sync/src/plan.ts:119`: the pending-operation message uses `itemId(m.item)` for all kinds.
- `packages/project-sync/src/refusal.ts:25-26`: add the seven `MESSAGES` entries.

### 6.3 authoring (status)

- New file `packages/project-authoring/src/agent-file.ts`: `parseAgent` and its constants. Project-sync already imports from project-authoring (`packages/project-sync/src/prompts.ts:19`), so the dependency direction is right.
- `packages/project-authoring/src/files.ts:64`: `readTree(bowerloom, relative, skip?)` takes an optional folder prefix to skip. The skipped files do not count toward `LIMITS.itemEntries` (line 12).
- `packages/project-authoring/src/verifiers.ts:66-70`: for a team folder, call `readTree` with the skip prefix `teams/<id>/agents`. Then read the agents folder with `parseAgent`. A bad file returns `refused('AGENT_INVALID')`.

### 6.4 CLI

- `apps/cli/src/apply.ts:25`: `SURFACE_HARNESS` gains `'agent-claude': 'claude'`.
- `apps/cli/src/apply.ts:36-44`: add `agentNoticeLine`.
- `apps/cli/src/apply.ts:45-58`: add `agentLine` and `agentState`, modeled on `promptLine` and `promptState`.
- `apps/cli/src/apply.ts:65-76`: `renderApplyReview` adds agent ids to `width`, adds agent lines, the Codex line, and the new title and empty text.
- `apps/cli/src/apply.ts:77-85`: `resultWords`.
- `apps/cli/src/held.ts:15`: `HeldItem.kind` gains `'agent'`. `apps/cli/src/held.ts:45` adds agent holds next to the prompt holds.
- `apps/cli/src/up.ts:148`: the step text says `Put the skills, prompts, and agents of team <name> in place for <harnesses>.`
- `apps/cli/src/sync.ts:106`: use `itemId` for the running item name.
- `apps/cli/src/human.ts:100, 111-120, 275-276`: as in sections 3.3 and 5.
- `apps/cli/src/project-status.ts:53`: the held-line format already prints `item.kind`. Only the type changes.

## 7. Edge cases

1. A team has no `agents/` folder. Result: no agent lines. No error.
2. `agents/` is empty. Result: no agent lines.
3. The file is `Scribe.md`. Result: `AGENT_NAME_MISMATCH`.
4. The file is `scribe.md` with `name: Scribe`. Result: `AGENT_NAME_MISMATCH`.
5. A file `notes.txt` is in `agents/`. Result: `AGENT_INVALID`, naming `notes.txt`.
6. Two teams hold `scribe.md`. Result: `APPLY_AGENT_DUPLICATE`, naming both teams. Nothing is written.
7. A key `tool:` (a typo). Result: `AGENT_KEY_UNKNOWN`.
8. `tools: Read, Grep`. Result: installs. No tool notice, because no shell or edit tool is listed.
9. `tools: Read, Bash(npm run *), Edit(/src/**)`. Result: installs. The notice reads `lists shell tools in tools and lists file-editing tools in tools`.
10. `tools: Monitor`. Result: the notice names shell tools.
11. `tools: MultiEdit`. Result: valid entry, no notice, because the name is not in a class.
12. `tools: Bash(a, b)` as a comma string. Result: one entry, because the comma is inside parentheses.
13. `--harness codex` with agent sources. Result: no agent lines, one Codex line, and no `kept` line for an installed agent.
14. `--harness both` with agent sources. Result: agents planned, and the Codex line prints.
15. `--harness claude`. Result: agents planned. No Codex line.
16. No agent sources and `--harness codex`. Result: no Codex line.
17. The source file is deleted. Result: the catalog still exists. The agent is `orphaned`. The copy stays. `AGENT_SOURCE_MISSING` applies only when the team folder exists and a catalog says the agent was installed but the file is gone (a restore from version control fixes it).
18. A user edits `.claude/agents/scribe.md` after install. Result: `MANAGED_SKILL_LOCAL_DRIFT` hold with the prompt-style `Next:` text, naming the agent source path. Apply overwrites nothing.
19. A skill is named `agent-scribe` and an agent is named `scribe`. Result: both install, with no collision.
20. A role is named `plan`. Result: the built-in warning, and the agent installs.
21. The `--team` filter names a team. Result: only that team's agents are planned.
22. A source file is a link. Result: `AGENT_INVALID`.
23. A project with 129 agents. Result: `AGENT_LIMIT`.
24. Interrupt between two agents. Result: `SKILLS_SYNC_INTERRUPTED`, and a rerun finishes.
25. The user is offline. Result: no change. Apply never fetches.
26. A `.claude/agents` folder does not exist. Result: apply creates it with the transaction. If it exists, apply leaves other files in it alone.

## 8. Migration from beta.2

Beta.2 never wrote `.claude/agents`. A project may hold hand-made files there. The workbench copies six research roles by hand.

On the first beta.3 `bowerloom apply`, for each agent:

1. The target file is absent. The agent is `install`.
2. The target file exists and equals the source. The agent is `adopt`. Bowerloom writes no byte of that file. It records the file in the catalog, so it manages the file from then on.
3. The target file exists and differs. The agent is held with `AGENT_TARGET_OCCUPIED`. The `Next:` line names the path. Nothing about that agent is written.

Hand-made `.claude/agents/<role>.md` copies of the source are usually byte-identical to it. The workbench copies are adopted, except the stale `research-lead.md`, which is held.

How the user releases a held file:

1. Move the file aside, for example `mv .claude/agents/research-lead.md .claude/agents/research-lead.md.old`.
2. Run `bowerloom apply`. The plan shows `install agent`.
3. Approve with `--approve <revision>`.

If the hand-made file holds edits the user wants, the user first copies those edits into `.bowerloom/teams/<team>/agents/<role>.md`, then moves the file aside.

Hand-made `.codex/agents/*.toml` files are not touched. Apply does not read, adopt, or hold them in this beta.

Bowerloom never edits `.gitignore` outside `.bowerloom/managed/.gitignore`. The agents guide tells the user to commit the source files and to decide for themselves whether git tracks `.claude/agents`.

If the v2 planner cannot adopt a matching file, section 12 gives the fallback.

## 9. Docs changes

All paths are under `apps/docs/src/content/docs/`.

- `cli.md:88-91`: the `apply` paragraph. Add agents, the adopt rule, and the sentence that Codex agents are not projected in this beta. Keep `It never overwrites a copy you changed.` and extend it with `or a copy that Bowerloom did not install`.
- `reference/errors.md:127-128`: seven new rows. Use the sentence column of `human.ts` and the next step of section 5.
- `guides/add-skills.md:282`: add the agent codes to the list.
- New page `guides/agents.md`, titled "Project agents for Claude Code". It holds: where to put the source file, the allowed keys, the validation rules, what each notice means, the built-in names with their status, how to adopt or release a hand-made file, the git note, and the sentence that Codex agents are not projected in this beta.
- `guides/index.md`: a link to the new page. The builder checks the docs navigation setup in `apps/docs/astro.config.*` and adds the page there if the sidebar is listed by hand (section 12).
- `guides/create-items.md`: one paragraph that a team folder can hold an `agents/` folder.
- `harnesses.md`: one sentence that Claude Code agents are projected and Codex agents are not.
- `status.md:37-55`: agent sources are not reported as `edited`.
- `releases.md:16`: under a new heading `## 0.7.0-beta.3`, above the beta.2 heading, add:
  - `apply` copies the agents of a team to `.claude/agents` for Claude Code.
  - A hand-made agent file that equals the source is adopted. One that differs holds that agent with `AGENT_TARGET_OCCUPIED`.
  - `bowerloom status` no longer reports a team's `agents/` files as edited.
  - Codex agents are not projected in this beta.

## 10. Acceptance tests

Write the tests first. All new files sit inside the existing globs in `package.json` line 30 (`packages/managed-skills/test/*.test.mjs`, `packages/project-authoring/test/*.test.mjs`, `packages/project-sync/test/*.test.mjs`, and `dist/tests/*.test.js` for `tests/*.test.ts`), so rule 5 of the index needs no glob change.

### 10.1 `packages/managed-skills/test/v2-agent.test.mjs`

1. `locateV2` for an agent returns `agent-claude` and `catalog`, and no `projection-codex`, `projection-claude`, or `canonical`.
2. `requestV2` refuses an agent request whose harness list is `['codex']` or `['claude', 'codex']`.
3. `itemId` returns `agent_scribe`.
4. `catalogItem('agent_scribe.json')` is kind `agent`. `catalogItem('agent-scribe.json')` is a skill. `catalogItem('prompt-x.json')` is still a prompt.
5. `itemRef` refuses a skill id that starts with `agent_`.
6. `materialV2` writes the source bytes to `agent-claude`.
7. `STAGE_NAME` accepts `new-agent-claude`, `old-agent-claude`, and `returned-agent-claude`.
8. A transaction installs, updates, and rolls back an agent, as the prompt tests do (copy the cases of `v2-transaction.test.mjs`).
9. `readLocalAgent` refuses a link, a group-writable file, and a file over the limit.

### 10.2 `packages/project-authoring/test/agents-parse.test.mjs`

1. Each allowed key passes with a valid value.
2. Each value rule fails with `AGENT_INVALID` for one bad value (one case per key).
3. An unknown key is `AGENT_KEY_UNKNOWN`.
4. A name that differs from the stem is `AGENT_NAME_MISMATCH`.
5. A stem with a capital letter, an underscore, a colon, or 65 characters is `AGENT_NAME_MISMATCH`.
6. A missing description, an empty body, and a body of only blank lines each give `AGENT_INVALID`.
7. A carriage return, a null byte, and a byte order mark each give `AGENT_INVALID`.
8. A file over 65536 bytes gives `AGENT_INVALID`.
9. A duplicate YAML key, an alias, and a merge key each give `AGENT_INVALID`.
10. `tools` as a comma string and as a list give the same entries. `Bash(a, b)` stays one entry.
11. `Bash(npm run *)`, `Edit(/src/**)`, and `mcp__server__tool` are valid tool entries. An entry with a space outside parentheses is `AGENT_INVALID`.
12. A stray `notes.txt` and a subfolder in `agents/` each give `AGENT_INVALID`.

### 10.3 `packages/project-authoring/test/agents-owner.test.mjs`

1. A registered team with a valid `agents/` folder verifies as `verified` and not `edited`.
2. A bad agent file returns `refused` with `AGENT_INVALID`.
3. Files in `agents/` do not count toward the 256-entry limit.
4. A change outside `agents/` still makes the team `edited`.

### 10.4 `packages/project-sync/test/agents-plan.test.mjs`

1. The plan lists an agent as `install agent` with the Claude path.
2. After apply, a second plan says `up to date` and `Nothing to change.`
3. Editing the source gives `update agent` and a different revision.
4. The plan revision changes when an agent is added.
5. `STALE_APPROVAL` happens if the source changes after the plan.
6. `--team` filters agents.
7. The source file is deleted. The agent is `kept: no longer an agent of this project, and apply removes nothing`.
8. `APPLY_AGENT_DUPLICATE` with nothing written, and the message names both teams.
9. An agent surface collides with a skill surface: `APPLY_NAME_COLLISION`.
10. The built-in warning prints for `explore`, `plan`, and `general-purpose`, and not for `scribe`.
11. The notice line is exact for each of the five items of section 3.2, and for all five together.
12. `--harness codex` with agents: no agent line, the Codex line once, no `kept` line for an installed agent.
13. `--harness both` with agents: agent lines and the Codex line.
14. `--harness claude`: agent lines and no Codex line.
15. `--harness codex` with no agent sources: no Codex line.
16. JSON output has the format `bowerloom/project-apply-plan/v1beta2` and the field `agents`.

### 10.5 `packages/project-sync/test/agents-apply.test.mjs`

1. Apply writes `.claude/agents/<role>.md` equal to the source bytes.
2. The catalog record exists, names kind `agent`, and lists harnesses `["claude"]`.
3. Apply writes no file under `.codex`.
4. Interrupt between two agents leaves the first complete and the second untouched.
5. A crash inside a transaction leaves the marker, and `skills recover plan --item agent_<role>` resumes it.
6. Drift on the Claude copy holds with `MANAGED_SKILL_LOCAL_DRIFT` and nothing is overwritten.
7. Apply never removes a copy when the source is removed.
8. Other files in `.claude/agents` stay unchanged.

### 10.6 `packages/project-sync/test/agents-migrate.test.mjs`

1. A byte-identical Claude file is `adopt`. No byte changes. A catalog is written.
2. A differing Claude file holds with `AGENT_TARGET_OCCUPIED`. Nothing is written for that agent.
3. After the user moves the file aside, the next plan says `install agent`.
4. The other agents in the same plan still apply when one is held.
5. A hand-made `.codex/agents/<role>.toml` is not read, changed, or reported.

### 10.7 `tests/apply-agents-cli.test.ts` and `tests/status-agents.test.ts`

1. `renderApplyReview` golden text for install, update, adopt, up to date, kept, held, the notice, the warning, and the Codex line.
2. The title line, the empty-plan line, and the pointer text.
3. The result words.
4. `bowerloom status` prints no `edited:` line for a team with agents.
5. `bowerloom status` prints `  agent <role>: held (AGENT_TARGET_OCCUPIED). Next: ...`.
6. `bowerloom up --team <name>` prints the changed step text.
7. `bowerloom help apply` shows the new sentences.
8. Exit codes: 0 for nothing to change, 3 for approval required.
9. Every new code appears in `human.ts` and in `errors.md`. A test reads both files and fails when a code in `MESSAGES` lacks a row.

## 11. Build order

1. Write all tests of section 10, failing.
2. `packages/project-authoring/src/agent-file.ts` and its tests (10.2).
3. managed-skills types, `locateV2`, `materialV2`, `catalogItem`, `itemRef`, `STAGE_NAME`, `readLocalAgent` (10.1).
4. `packages/project-sync/src/agents.ts`, `apply-project.ts`, `recover.ts`, `plan.ts`, `refusal.ts` (10.4, 10.5, 10.6).
5. The authoring owner change (10.3).
6. CLI: `apply.ts`, `held.ts`, `up.ts`, `sync.ts`, `human.ts` (10.7).
7. Docs (section 9).
8. Run the gates. Open the pull request into `release/0.7.0-beta.3`.

## 12. Unverified items

Check each item first. If the check fails, take the named fallback.

1. **The v2 planner may not accept a pre-existing file that has the expected bytes at an `install` target.** `classifyPrompt` treats any non-empty pin as occupied (`packages/project-sync/src/prompts.ts:163-166`). I did not read the transaction code that stages and renames. Check by reading `planItemWithLifetime` and `v2-transaction.ts`, and by a test that installs over a matching file. Fallback: hold identical files too, with `AGENT_TARGET_OCCUPIED`, and tell the user to move them aside. Section 8 case 2 and tests 10.6.1 then change to expect a hold.
2. **Built-in Claude Code agent names** (section 4.2) are unverified. Check them against the Claude Code sub-agents page. Fallback: delete the unverified rows. The warning then never prints.
3. **The docs sidebar setup.** Check `apps/docs/astro.config.*` and any docs test that lists pages. Fallback: add the new page to the list the config uses.
4. **A test that checks every code has a docs row.** I did not find one. Test 10.7.9 adds it.
5. **Whether `.claude/agents` needs the project-folder safety checks that other copy folders get** (`checkProjectAncestry`, the ancestry pins). Skill copies in `.claude/skills` already pass through the same managed transaction, so the check should apply. Verify with test 10.5.1 on a project with a group-writable parent. Fallback: refuse with `SKILLS_PROJECT_UNSAFE`, as skills do.

## 13. Forward compatibility with 01b

Spec 01b designs a harness-neutral capability model and Codex agents. This spec keeps the door open:

1. **The source format does not change when Codex arrives.** The file stays `.bowerloom/teams/<team>/agents/<role>.md` in the Claude Code subagent format, with the same allowed keys. 01b reads the same file. If 01b needs a harness-neutral key, adding it relaxes the `AGENT_KEY_UNKNOWN` refusal. That is not a breaking change for existing files.
2. **The managed-item kind allows a second surface.** The kind is `agent`, the id is `agent_<role>`, and the receipt and catalog hold a `harnesses` list and a `surfaces` list. A later spec adds an `agent-codex` surface by extending `ItemSurfaceId`, `ITEM_SURFACES`, `locateV2`, and `materialV2`, and by loosening the harness check in `requestV2`. An installed agent then moves through the existing `harnesses-changed` path (the `add Codex copies` line in `apps/cli/src/apply.ts:54`) with no new state.
3. **The Codex line is the one place to change.** When 01b lands, the line `Codex agents are not projected in this beta. See the capability model design.` is removed, and the agent planner starts to accept the Codex harness. The `codexAgentsSkipped` plan field of section 6.2 is the switch.
4. **The plan format may bump again.** The v1beta2 formats of section 4.4 are for this spec. 01b may bump to v1beta3 if it changes the plan shape.
5. **No Codex file is read or written now.** Hand-made `.codex/agents/*.toml` files stay untouched, so 01b can define how to adopt them.
6. **The private folder name `agent_<role>` is final.** 01b must not rename it, because receipts already use it.

## 14. New decision for Hanna

None. The web-and-MCP decision that this spec once raised moved to spec 01b with the Codex work.
