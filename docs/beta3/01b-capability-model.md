# Design 01b: a capability model that no harness owns

Status: design for the maintainer's decision. Nothing here is built. Codex agents ship after the maintainer approves it.

Source: sageadvicellc/bowerloom#84, decision 6 (https://github.com/sageadvicellc/bowerloom/issues/84#issuecomment-6333531579). Decision 3 (a Codex copy never has more power than its source) moves here from spec 01. Spec 01a (`docs/beta3/01a-team-agents-claude.md`) is the base.

Terms used below:

- A **harness** is an agent application that reads project files. The two harnesses are Claude Code and Codex.
- A **role** is one agent definition, the file `.bowerloom/teams/<team>/agents/<role>.md`.
- A **capability** is one kind of power a role can have, such as running shell commands or editing files.
- To **enforce** a limit means that the harness itself blocks the action. An instruction in a prompt does not enforce anything.
- A **subagent** is an agent that a running session starts for one task. Claude Code reads subagents from `.claude/agents/`. Codex reads custom agents from `.codex/agents/`.
- A **session** is one run of a harness that a person starts. Session settings come from settings files and command-line flags.
- An **own session** is a session that runs one role alone, started with that role's limits as session settings.
- To **compile** means to turn the capabilities of a role into the files and flags that one harness reads.
- A **plan** is what `bowerloom apply` prints before it writes. A **hold** is a reported reason that one item is not applied.

## 1. Decision summary for the owner

1. Each role declares its power once, in a `capabilities` block in its frontmatter: read, edit, shell, web, mcp, agents, network.
2. Bowerloom compiles that block per harness into one of three outcomes: enforced as a subagent, enforced as its own session, or held as not enforceable.
3. Claude Code enforces most limits in the agent file, so most roles stay subagents there. Codex enforces only the shell limit in the agent file, so most restricted Codex roles run as their own session.
4. A Codex own session gets its limits from `-c` flags, not from a profile. Flags rank above the project settings file. A profile ranks below that file and cannot live in the project.
5. A new command, `bowerloom run <role> --harness <h>`, starts an own session. `apply` and `up` still never start a process.

## 2. The enforcement facts per harness

Sources, all fetched or run on 2026-10-22:

- [S1] https://code.claude.com/docs/en/sub-agents
- [S2] https://code.claude.com/docs/en/tools-reference
- [S3] https://code.claude.com/docs/en/permissions
- [S4] https://code.claude.com/docs/en/sandboxing
- [S5] https://code.claude.com/docs/en/settings
- [S6] `claude --help`, Claude Code 2.1.292, run locally
- [C1] https://learn.chatgpt.com/docs/agent-configuration/subagents
- [C2] https://learn.chatgpt.com/codex/config-file/config-reference
- [C3] https://learn.chatgpt.com/docs/config-file/config-advanced.md
- [C4] https://learn.chatgpt.com/docs/config-file/config-basic
- [C5] https://learn.chatgpt.com/docs/agent-approvals-security
- [C6] https://learn.chatgpt.com/docs/cli/reference
- [C7] `codex --help`, `codex exec --help`, and `codex features list`, codex-cli 0.157.0, run locally

"Agent file" means the limit can live in the role's own file. "Session" means it can live only in session settings or flags. "Not at all" means no verified key exists.

| Capability | Claude Code | Codex |
|---|---|---|
| Shell | Agent file. `tools` or `disallowedTools` removes `Bash`, `PowerShell`, and `Monitor` [S1, S2]. A command pattern is session only: a `disallowedTools` entry such as `Bash(git push *)` "still removes the whole tool", and a pattern rule goes in `permissions.deny` [S1]. | Agent file. `features.shell_tool = false` is one of five supported feature keys [C1]. Session: `--disable shell_tool` [C7]. Whether it also removes the `unified_exec` command tool is unverified (section 7, R4). |
| File edit | Agent file for the file tools: `Edit`, `Write`, `NotebookEdit` [S2]. Shell commands can still write. Only the session sandbox limits shell writes [S4]. | Session only. An agent file cannot override `sandbox_mode`, `approval_policy`, `model_provider`, or `mcp_servers`. The parent session's values apply [C1]. `sandbox_mode` is `read-only`, `workspace-write`, or `danger-full-access` [C2]. |
| File read scope | Session only. `Read` deny rules and `permissions.blockReadsOutsideWorkingDirectories` [S3, S5]. The sandbox `filesystem.denyRead` limits shell reads only. It does not stop the `Read` tool [S4]. `--restricted` "confines the file tools to the working directories" [S6]. | Session only. `default_permissions` and `permissions.<name>.filesystem` [C2]. How these interact with `sandbox_mode` is unverified (R10). |
| Web | Agent file: `WebFetch` and `WebSearch` [S1, S2]. | Session only: `web_search = "disabled"` [C2]. Not in the agent-file key list [C1]. The network proxy "does not filter web search" [C5]. |
| MCP servers by name | Agent file. `tools: mcp__github__*` gives one server. `disallowedTools: mcp__*` withholds every MCP tool [S1]. An allow list by name needs a `tools` list. Inline `mcpServers` in a project agent are not used until the folder is trusted [S3]. | Session only: `mcp_servers.<id>.enabled`, `enabled_tools`, `disabled_tools` [C2]. Agent files cannot override `mcp_servers` [C1]. `features.apps` and `features.plugins` can be set false in the agent file [C1]. |
| Subagent spawning | Agent file: omit `Agent` from `tools` or add it to `disallowedTools` [S1]. | Session only: `agents.enabled` and `features.multi_agent` [C2]. Not one of the five agent-file feature keys [C1]. |
| Network | Session only. The sandbox limits network for shell commands [S4]. It does not cover file tools, web tools, MCP servers, or hooks [S4]. | Session only. `sandbox_workspace_write.network_access` and `permissions.<name>.network.enabled` [C2]. Network is off by default in `workspace-write` [C5]. |
| Approval | Agent file `permissionMode`, with a gap. If the main session is in `bypassPermissions`, `acceptEdits`, or auto mode, Claude Code ignores it [S1]. Session: `--permission-mode` [S6]. | Session only: `approval_policy` [C2]. "Subagents inherit the parent turn's current sandbox and approval settings" [C1]. |

Facts about session settings that the design depends on:

- Codex profiles are files at `$CODEX_HOME/<name>.config.toml`, selected with `--profile <name>` [C3, C6]. Since Codex 0.134.0, `[profiles.<name>]` tables in `config.toml` are no longer read [C3].
- Codex ignores `profile` and `profiles` in a project `.codex/config.toml` [C2, C3]. A project cannot define a profile.
- Codex precedence, highest first [C4]:
  1. CLI flags and `--config` overrides.
  2. Project settings files, in trusted projects only.
  3. Profile files.
  4. The user settings file.
  5. Cloud-managed defaults.
  6. The system settings file.
  7. Built-in defaults.

  So a trusted project's settings file beats a profile.
- If a project is not trusted, Codex skips its `.codex/` layers: the project settings file, hooks, and rules [C2, C4].
- `codex exec` has `--ignore-user-config`. The interactive `codex` command does not. `codex exec` has no `--ask-for-approval` flag, so approval is set with `-c approval_policy=...` [C7].
- Codex protects `<writable_root>/.codex` as read-only inside the sandbox [C5].
- Claude Code settings precedence, highest first: managed, command line (`--settings`), project local, shared project, user [S5]. Lists such as `permissions.deny` merge across scopes, and a deny at any level wins [S3, S5].
- Claude Code skips a project subagent's frontmatter `hooks` and inline `mcpServers` until the folder is trusted [S1, S3].
- `claude --agent <name>` starts a session where "the main thread itself takes on that subagent's tool restrictions and model" [S1]. `--agents <json>` defines agents for one session at priority 2, above `.claude/agents/` [S1, S6].

What the repository already has:

- `packages/harness-portability/src/index.ts:9` defines `Harness` as `'codex' | 'claude'`. Lines 11-16 define `NeutralConfig` with `executionAuthorized: false`. It carries model and effort only, no capability.
- `apps/docs/src/content/docs/harnesses.md:36` says the supported subset "does not convert one provider's permissions into another's authority". Line 42 says the harness commands "do not start models or grant execution authority".
- `apps/docs/src/content/docs/permissions.md:40` says "A portable definition names capabilities. It does not contain a live credential or an installed permission grant."
- `packages/codex-adapter/src/installation.ts:46-51` already starts Codex with `-c` overrides, `--ignore-user-config`, and an inline permissions profile (`default_permissions` plus `permissions.<name>={filesystem=...,network={enabled=false}}`).
- `packages/codex-adapter/src/policy.ts:15-126` lists the controls it passes: `--disable shell_tool`, `--disable unified_exec`, `--disable multi_agent`, `--disable apps`, `--disable plugins`, `-c agents.enabled=false`, and `-c web_search="disabled"`. Lines 8-12 pin the tested Codex versions 0.157.0, 0.159.2, and 0.160.0.
- `packages/codex-adapter/src/reader.ts:14` reads the effective settings with the app-server call `config/read` and `includeLayers: true`. `packages/codex-adapter/src/observation.ts:19-29` checks that the feature keys are false and that no non-user layer adds `mcp_servers`.
- `packages/claude-adapter/src/policy.ts:57-62` and `packages/claude-adapter/src/limited-policy.ts:12` start Claude Code with `--tools ''`, `--disallowedTools '*'`, `--permission-mode dontAsk`, `--strict-mcp-config`, and `--restricted`.
- `apps/cli/src/up.ts:16` says `up` "never starts claude, codex or any other process".
- `packages/harness-portability/src/index.ts:168` already flags a settings file that sets both `default_permissions` and `sandbox_mode` with `NATIVE_PERMISSION_SYSTEMS_REQUIRE_REVIEW`.

Conclusion: both harnesses have two places to enforce. One is the agent file. The other is the session. Claude Code puts most limits in the agent file. Codex puts almost all of them in the session.

## 3. The capability schema

### 3.1 Where it lives

The block is a frontmatter key, `capabilities`, in `.bowerloom/teams/<team>/agents/<role>.md`. One role keeps one file. Decision A offers a sibling file instead.

```
---
name: fact-checker
description: Checks each claim in a draft against its cited source.
tools: Read, Grep, Glob, Write, WebFetch, WebSearch
capabilities:
  edit: allow
  web: allow
---
Check each claim against its source. Write findings to notes/checks.md.
```

### 3.2 Fields

Every field takes one of the listed values. Any other field or value is `AGENT_INVALID`, and the message names the field.

| Field | Values | Default | Meaning |
|---|---|---|---|
| `read` | `allow`, `project` | `allow` | `project` keeps every file read inside the project folder. `allow` leaves reads to the session. |
| `edit` | `none`, `allow` | `none` | `none` blocks every file change, by file tools and by shell commands. |
| `shell` | `none`, `allow` | `none` | `none` removes command execution. |
| `web` | `none`, `search`, `allow` | `none` | `search` permits web search only. `allow` also permits fetching pages. |
| `mcp` | a list of server names, or `allow` | `[]` | A list permits only those MCP servers, and connectors and plugins count as servers. `[]` permits none. |
| `agents` | `none`, `allow` | `none` | `none` blocks starting other agents, sending messages to other sessions, and scheduling remote agent runs. |
| `network` | `none`, `allow` | `none` | Network access for shell commands. Web and MCP have their own fields. |

Rules:

- `allow` never widens the session. It means "this role adds no limit here". So the compiled output only ever narrows a session, and never sets a value wider than the session already has.
- A server name matches `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, does not contain `__`, and does not end with `_`. Claude Code reads those two forms as other server names [S3].
- `network: none` with `shell: none` is always enforced, because without a shell there is no command to reach the network.

Approval is not a field in this version. Decision G covers it.

### 3.3 Defaults: deny or allow

When the block is present, an omitted field takes the narrow value (deny by default), except `read`, which takes `allow`.

- Deny by default is safe. A forgotten field removes power, and the plan shows it, so the author sees the gap and adds the field.
- Allow by default is shorter to write. A forgotten `mcp` field gives the role every MCP server of the session. That breaks the owner's rule without any sign in the plan.
- `read` defaults to `allow` because a role that cannot read is useless, and `project` needs an own session on both harnesses.

The cost: under deny by default, `mcp: []` and `agents: none` apply to every role that does not name them. On Codex both need an own session. So most declared roles run as Codex own sessions unless the author writes `mcp: allow` and `agents: allow`. Decision B names the variants.

### 3.4 Roles with no block

A role with no `capabilities` block gets capabilities derived from its Claude Code keys. The plan labels them `derived from tools`. The derivation is conservative. A source key can only remove power.

| Source key | Derived capability |
|---|---|
| `tools` absent and `disallowedTools` absent | every field `allow` |
| `tools` lists none of `Bash`, `PowerShell`, `Monitor` | `shell: none` and `network: none` |
| `tools` lists a shell tool only with a pattern, such as `Bash(git status *)` | shell is restricted by pattern. No value fits, so the role is not enforceable on Codex. |
| `tools` lists none of `Edit`, `Write`, `NotebookEdit` | `edit: none` |
| `tools` lists neither `WebFetch` nor `WebSearch` | `web: none` |
| `tools` lists `WebSearch` and not `WebFetch` | `web: search` |
| `tools` lists `mcp__<name>__*` entries | `mcp: [<names>]` |
| `tools` lists no `mcp__` entry and `mcpServers` is absent | `mcp: []` |
| `tools` lacks `Agent` | `agents: none` |
| `disallowedTools` names a whole class | that field `none` |
| `permissionMode: plan` | `edit: none` and `shell: none` |

`hooks` never narrows a derived capability. A hook is not a limit Bowerloom can rely on, because Claude Code skips project agent hooks in an untrusted folder [S1].

### 3.5 Relation to Claude Code's `tools` list

Both stay, with a consistency check. The `capabilities` block is the authority. The author can keep the `tools` list as an extra Claude Code filter.

1. The generated Claude copy keeps the source `tools` list and adds a generated `disallowedTools` list. Claude Code applies `disallowedTools` first, then resolves `tools` against what remains [S1]. So the generated list can only narrow.
2. If `tools` names a tool that `capabilities` forbid, the plan refuses with `AGENT_CAPABILITY_CONFLICT`. The role says two things, and the author must choose one.
3. If `mcpServers` names a server outside `capabilities.mcp`, the plan refuses with `AGENT_CAPABILITY_CONFLICT`.
4. If the remaining tool pool is empty, the plan refuses with `AGENT_INVALID`, because Claude Code refuses to start an agent with zero tools [S1].

Tool classes, from the Claude Code tools reference [S2]:

| Class | Tools |
|---|---|
| shell | `Bash`, `PowerShell`, `Monitor` |
| edit | `Edit`, `Write`, `NotebookEdit` |
| read | `Read`, `Grep`, `Glob`, `LSP` |
| web | `WebFetch`, `WebSearch` |
| agents | `Agent`, `Workflow`, `SendMessage`, `RemoteTrigger` |
| mcp | any name that starts with `mcp__` |

`Workflow` "orchestrates many subagents". `SendMessage` reaches other sessions. `RemoteTrigger` creates cloud scheduled tasks [S2]. Each one starts or steers other agents, so each one belongs to `agents`. Decision F covers tools in no class.

## 4. Compilation per harness

Rule for every harness: if a verified agent-file key enforces a field, the field compiles to the agent file. If not, the field needs an own session. If no verified session setting enforces it either, the role is held on that harness.

### 4.1 Claude Code

Per field, for a subagent:

| Field and value | Subagent output | Enforced as a subagent? |
|---|---|---|
| `shell: none` | `disallowedTools` adds `Bash`, `Monitor`, `PowerShell` | yes |
| `edit: none`, with `shell: none` | adds `Edit`, `NotebookEdit`, `Write` | yes |
| `edit: none`, with `shell: allow` | adds the edit tools | no. Shell can still write. Needs an own session. |
| `read: project` | nothing | no. Needs an own session. |
| `web: none` | adds `WebFetch`, `WebSearch` | yes |
| `web: search` | adds `WebFetch` | yes |
| `mcp: []` | adds `mcp__*` | yes |
| `mcp: [names]`, with a source `tools` list | the `tools` list must hold `mcp__<name>__*` for each name and no other `mcp__` entry | yes |
| `mcp: [names]`, without a `tools` list | nothing | no. Held. Claude Code needs a `tools` list to allow servers by name, and an own session cannot add server definitions it does not have. |
| `agents: none` | adds `Agent`, `RemoteTrigger`, `SendMessage`, `Workflow` | yes |
| `network: none`, with `shell: none` | nothing more | yes |
| `network: none`, with `shell: allow` | nothing | no. Needs an own session. |

Subagent output file, `.claude/agents/<role>.md`:

1. The generator copies the source bytes.
2. It removes the byte range of the `capabilities` key from the frontmatter.
3. It removes the byte range of an existing `disallowedTools` key.
4. It inserts one line before the closing fence: `disallowedTools: <entries>`. The entries are the union of the source entries and the generated entries, in byte order, joined with `, `.
5. The body stays byte for byte. A role with no `capabilities` block and no generated entries is copied unchanged, as in spec 01a.

Golden example. The source of section 3.1 gives:

```
---
name: fact-checker
description: Checks each claim in a draft against its cited source.
tools: Read, Grep, Glob, Write, WebFetch, WebSearch
disallowedTools: Agent, Bash, Monitor, PowerShell, RemoteTrigger, SendMessage, Workflow, mcp__*
---
Check each claim against its source. Write findings to notes/checks.md.
```

Claude own session. A role that needs one gets no `.claude/agents/<role>.md` file. Without that rule, any Claude Code session can start the role as a subagent, and the session limits do not apply. Apply writes a session record instead (section 4.3). `bowerloom run <role> --harness claude` starts:

```
claude --agents '<json>' --agent <role> --settings '<json>'
```

- `--agents` carries the role, with the generated `disallowedTools`. The exact field names of the JSON are unverified (R13).
- `--settings` carries only what the role needs. `<project>` is the absolute project path, filled in at start. A relative path in `--settings` is avoided, because its base folder is unverified.

```json
{
  "permissions": { "blockReadsOutsideWorkingDirectories": true },
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "filesystem": { "denyRead": ["~/"], "allowRead": ["<project>"], "denyWrite": ["<project>"] },
    "network": { "allowedDomains": [] }
  }
}
```

| Field and value | Own-session output |
|---|---|
| `read: project` | `permissions.blockReadsOutsideWorkingDirectories: true`, sandbox `denyRead` and `allowRead`, and the `--restricted` flag with `--tools` naming the role's allowed built-in tools |
| `edit: none`, with `shell: allow` | sandbox `enabled`, `allowUnsandboxedCommands: false`, and `denyWrite` |
| `network: none`, with `shell: allow` | sandbox `enabled`, `allowUnsandboxedCommands: false`, and `network.allowedDomains: []` |

`--restricted` also ignores user, project, and local settings files [S6]. That keeps a project's `sandbox.excludedCommands` from moving a command outside the sandbox.

### 4.2 Codex

Per field:

| Field and value | Agent file | Own session |
|---|---|---|
| `shell: none` | `features.shell_tool = false` | `--disable shell_tool --disable unified_exec` |
| `edit: none` | not possible | `--sandbox read-only -c approval_policy="never"` |
| `read: project` | not possible | not enforceable in this version (R10) |
| `web: none` or `web: search` | not possible | `-c web_search="disabled"` for `none`. `search` adds nothing, because Codex has no page-fetch tool apart from the shell. |
| `mcp: []` | not possible | `-c features.apps=false -c features.plugins=false`, and `-c mcp_servers.<id>.enabled=false` for every observed server |
| `mcp: [names]` | not possible | the same, except the named servers stay as the session has them |
| `agents: none` | not possible | `-c agents.enabled=false -c features.multi_agent=false` |
| `network: none`, with `shell: allow` | not possible | `-c sandbox_workspace_write.network_access=false -c approval_policy="never"` |

`approval_policy="never"` is added whenever a limit rests on the sandbox. Without it, the role can ask the person to approve an edit or a network call that its capabilities forbid.

**(a) Subagent.** In this case the agent file can enforce every limit. Every field is `allow`, with one exception: `shell` can be `none`. Apply writes `.codex/agents/<role>.toml` with the writer of spec 01, section 4.4:

```
# Generated by bowerloom apply from .bowerloom/teams/notes/agents/scribe.md. Edit that file, not this one.
name = "scribe"
description = "Writes notes."
features.shell_tool = false
developer_instructions = """
Write notes.
"""
```

**(b) Own session.** In this case at least one limit needs session settings. Apply writes no `.codex/agents/<role>.toml`. So no Codex session can start the role as an unlimited subagent. Apply writes the session record `.bowerloom/managed/sessions/<role>.codex.json`:

```json
{
  "format": "bowerloom/agent-session/v1beta1",
  "role": "fact-checker",
  "team": "research-desk",
  "harness": "codex",
  "source": { "path": "teams/research-desk/agents/fact-checker.md", "sha256": "<64 hex>" },
  "capabilities": { "read": "allow", "edit": "allow", "shell": "none", "web": "allow", "mcp": [], "agents": "none", "network": "none" },
  "args": [
    "--disable", "shell_tool",
    "--disable", "unified_exec",
    "-c", "features.apps=false",
    "-c", "features.plugins=false",
    "-c", "agents.enabled=false",
    "-c", "features.multi_agent=false"
  ],
  "mcp": { "keep": [], "disableEveryOther": true },
  "instructions": { "sha256": "<64 hex>", "bytes": 72 }
}
```

The person starts it with `bowerloom run fact-checker --harness codex`. The command:

1. If the source or the record differs from the catalog record of the last approved apply, it refuses with `AGENT_SESSION_STALE`. Without this check, a role with `edit: allow` can widen its own next session by editing its source.
2. Runs the Codex app-server read (`config/read` with `includeLayers: true`, as `packages/codex-adapter/src/reader.ts:14` does) with the same `args`. It lists every MCP server id in the effective settings.
3. Adds `-c mcp_servers.<id>.enabled=false` for every id outside `mcp.keep`.
4. Adds `-c developer_instructions=<body as a TOML string>`. `developer_instructions` is "Additional developer instructions injected into the session" [C2].
5. Runs the read again with the full flag list and checks every limit in the effective settings. A mismatch refuses with `AGENT_SESSION_UNVERIFIED`, and nothing starts.
6. Prints the full command, then starts `codex <flags> -C <project>` in the foreground.

Flags are used, not a profile. Flags rank above a trusted project's `.codex/config.toml`. A profile ranks below it [C4] and must live in `$CODEX_HOME`, outside the project [C3]. Decision D keeps the profile as a variant.

**(c) Not enforceable, held.** In this case a field has no verified enforcement on the harness. Apply writes nothing for that harness. It holds the role with `AGENT_NOT_ENFORCEABLE`. The other harness still installs. In this version, these cases hold:

- Codex: `read: project`.
- Codex: a shell pattern from a derived role.
- Claude Code: `mcp: [names]` without a `tools` list.
- Either harness: a harness version outside the tested list (decision H).

### 4.3 Managed items

The item stays `agent_<role>`, as spec 01a fixes. Its surfaces grow:

| Surface | Path | When |
|---|---|---|
| `agent-claude` | `.claude/agents/<role>.md` | Claude Code, enforced as a subagent or no limits declared |
| `agent-session-claude` | `.bowerloom/managed/sessions/<role>.claude.json` | Claude Code, own session |
| `agent-codex` | `.codex/agents/<role>.toml` | Codex, enforced as a subagent or no limits declared |
| `agent-session-codex` | `.bowerloom/managed/sessions/<role>.codex.json` | Codex, own session |
| `catalog` | `.bowerloom/managed/catalog/agent_<role>.json` | always |

A role uses at most one surface per harness. A change of outcome, such as subagent to own session, is an `update`. The update removes the old surface in the same transaction, because Bowerloom installed it. That is the only removal, and the plan names it.

## 5. The plan display, verbatim

`<pad>` and the line rules follow spec 01a, section 3.2. These lines follow an agent's main line, in this order: the capabilities line, the Claude Code line, then the Codex line. If a harness is not chosen, its line does not print.

Capabilities line, one of:

```
  <pad> Capabilities: read <v>, edit <v>, shell <v>, web <v>, mcp <v>, agents <v>, network <v>
  <pad> Capabilities derived from tools: read <v>, edit <v>, shell <v>, web <v>, mcp <v>, agents <v>, network <v>
  <pad> Capabilities: not declared. The agent can use everything the session allows.
```

`mcp <v>` prints `mcp none` for `[]`, `mcp allow` for `allow`, and `mcp github linear` for a list, with names in byte order.

Harness line, one of, where `<Harness>` is `Claude Code` or `Codex` and `<h>` is `claude` or `codex`:

```
  <pad> <Harness>: enforced as a subagent
  <pad> <Harness>: enforced as its own session. Start it with bowerloom run <role> --harness <h>
  <pad> <Harness>: no limits declared. Installed as a subagent.
  <pad> <Harness>: held (AGENT_NOT_ENFORCEABLE). Not enforceable: <items>
  <pad> Next: Change <items> in .bowerloom/teams/<team>/agents/<role>.md, or run bowerloom apply --harness <other h>.
```

`<items>` lists the fields as `<field> <value>`, joined with `, `, in the field order of section 3.2. One sentence per item follows the held line:

```
  <pad> Codex cannot keep reads inside the project in this version.
  <pad> Codex cannot limit shell commands by pattern.
  <pad> Claude Code limits MCP servers by name only through a tools list.
  <pad> <Harness> <version> is not a tested version.
```

A full example, for two harnesses:

```
Apply skills, prompts, and agents for Claude Code and Codex, team research-desk
  fact-checker install agent: .claude/agents/fact-checker.md and .bowerloom/managed/sessions/fact-checker.codex.json
               Capabilities: read allow, edit allow, shell none, web allow, mcp none, agents none, network none
               Claude Code: enforced as a subagent
               Codex: enforced as its own session. Start it with bowerloom run fact-checker --harness codex
  scribe       install agent: .claude/agents/scribe.md and .codex/agents/scribe.toml
               Capabilities: read allow, edit allow, shell none, web allow, mcp allow, agents allow, network allow
               Claude Code: enforced as a subagent
               Codex: enforced as a subagent
  web-scout    install agent: .bowerloom/managed/sessions/web-scout.claude.json
               Capabilities: read project, edit none, shell allow, web allow, mcp none, agents none, network allow
               Claude Code: enforced as its own session. Start it with bowerloom run web-scout --harness claude
               Codex: held (AGENT_NOT_ENFORCEABLE). Not enforceable: read project
               Codex cannot keep reads inside the project in this version.
               Next: Change read project in .bowerloom/teams/research-desk/agents/web-scout.md, or run bowerloom apply --harness claude.
```

JSON plan: each agent item gains two fields.

- `capabilities` holds the resolved block. Its `source` is `declared`, `derived`, or `none`.
- `enforcement` is a list with one entry per chosen harness, for example `{ "harness": "codex", "status": "held", "notEnforceable": ["read project"] }`. The `status` is `subagent`, `session`, `unlimited`, or `held`.

`bowerloom status` and `bowerloom up` print a held role as `  agent <role>: held on <Harness> (AGENT_NOT_ENFORCEABLE). Next: <next>`.

## 6. What changes in spec 01a so the later change is additive

01a can ship nearly as written. These changes keep 01b additive and avoid a second format bump:

1. **Source format.** No change. `capabilities` stays refused with `AGENT_KEY_UNKNOWN` in beta.3 (01a line 184). 01b admits the key. That relaxes a refusal and breaks no existing file, as 01a section 13 item 1 says.
2. **One function makes the Claude copy.** 01a adds `claudeCopyBytes(source)` in `packages/project-sync/src/agents.ts`. In 01a it returns the source bytes. The `adopt` state (01a line 78), the `AGENT_TARGET_OCCUPIED` check (line 84), and drift checks compare against its output, never against the source bytes. 01b then changes only that function.
3. **Generator version in the catalog.** 01a records `generator: "agent-copy/v1"` in the item's closure or catalog record. A later generator change then plans as `update`. If the catalog format cannot take a field, 01a names the format bump now.
4. **Reserved plan fields.** 01a's `AgentItem` JSON carries `capabilities: null` and `enforcement: []`. 01b fills them without bumping `bowerloom/project-apply-plan/v1beta2`.
5. **Surface names.** 01a's `STAGE_NAME` pattern (`packages/managed-skills/src/v2-transaction.ts:81`) and `ItemSurfaceId` accept new members later. 01b adds `agent-codex`, `agent-session-claude`, and `agent-session-codex`. The private folder `.bowerloom/managed/sessions/` is new in 01b.
6. **One surface per harness, possibly none.** 01a assumes an agent always has `agent-claude`. 01b lets an own-session role have no `.claude/agents` file. 01a's `locateV2` for kind `agent` takes the surface list from the item, not from a constant, so this needs no rewrite.
7. **Held items carry a harness.** `HeldItem` (`apps/cli/src/held.ts:15`) gains `kind: 'agent'` in 01a. 01a adds an optional `harness` field now, so a hold of one harness of one role fits.
8. **The Codex line.** 01a's line `Codex agents are not projected in this beta. See the capability model design.` (01a lines 108-112) and the `codexAgentsSkipped` field stay as the switch, as 01a section 13 item 3 says.
9. **No process from apply.** 01a keeps "It starts no process" (01a line 42). `bowerloom run` is a separate command.

## 7. Risks and unverified items

Each item names the check that resolves it. A failed check moves the field toward "not enforceable", never toward "enforced".

- **R1. Trust of the Codex project settings file.** A trusted project's `.codex/config.toml` ranks above a profile [C4]. A role that can edit files can write that file and widen the next session. Codex protects `.codex` inside the sandbox [C5], but only within a writable root. Check: use the `config/read` of step 5 in section 4.2 (b). It must show that each limit comes from the session flag layer. That layer is `sessionFlags` in `packages/codex-adapter/src/observation.ts:24`.
- **R2. Codex project agents in an untrusted project.** For a project that is not trusted, Codex skips the project settings file, hooks, and rules. The docs do not say whether `.codex/agents/` loads. Check: run Codex in an untrusted scratch project with a generated agent file, and ask it to list agents.
- **R3. Profile name collisions.** This risk is for the profile variant of decision D only. Profiles share `$CODEX_HOME` with the person's own profiles. Check: name the file `bowerloom-<role>-<first 8 hex of the project path hash>.config.toml`, and refuse to write over a file that the catalog does not list.
- **R4. `features.shell_tool = false` and `unified_exec`.** The repository's own controls disable both (`packages/codex-adapter/src/policy.ts:60-63`). Whether the agent-file key alone removes every command tool is unverified. Check: spawn a generated agent with only `features.shell_tool = false` and ask it to run `echo`. Fallback: Codex `shell: none` needs an own session.
- **R5. Read-only sandbox and file edits.** That `--sandbox read-only` with `approval_policy="never"` blocks the Codex patch tool is unverified. Check: ask such a session to create a file, then check that the file is absent.
- **R6. MCP servers from every layer.** That `-c mcp_servers.<id>.enabled=false` disables a server defined in the project settings file, the user settings file, or a plugin is unverified. Check: the step 5 read lists no enabled server outside `mcp.keep`.
- **R7. Codex nested agents.** Whether a Codex subagent can start its own subagents is not documented. If it cannot, `agents: none` is enforced for a Codex subagent with no key. Check: the Codex subagents page and one spawn test.
- **R8. `agents.<name>.config_file`.** The Codex settings reference lists this key as a path to a settings layer for one role [C2]. If that layer can set `sandbox_mode` or `web_search` for one role, many Codex roles can stay subagents. Check: one role with a layer that sets `sandbox_mode = "read-only"`, then an edit attempt.
- **R9. New Claude Code tools.** The generated `disallowedTools` is a deny list. A tool added in a later Claude Code version passes through it. Check: compare the tools reference with the class table of section 3.5 for every tested version (decisions F and H).
- **R10. Codex read scope.** The permissions profile keys exist [C2]. Their syntax for the project root and their effect together with `sandbox_mode` are unverified, and the repository already flags the pair (`packages/harness-portability/src/index.ts:168`). Check: a session with a read profile tries to read a file outside the project.
- **R11. Claude sandbox details.** An empty `allowedDomains`, `denyWrite` on the project path, and the `--restricted` flag are unverified in use. `--restricted` is documented only in `claude --help` [S6]. Check: run the probe table of the sandboxing page [S4] in an own session.
- **R12. Self-widening.** A role with `edit: allow` can change its own source or its session record. Check: a test that edits the source after apply and expects `AGENT_SESSION_STALE` from `bowerloom run`.
- **R13. `--agents` JSON fields.** That `--agents` takes `tools`, `disallowedTools`, and the prompt for one agent is unverified. Check: start a session with a one-agent JSON and list its tools. Fallback: Claude own sessions are held.
- **R14. Instructions through a flag.** A 64 KiB body in `-c developer_instructions` can hit an argument limit. It also shows in the process list. Check: start a session with the largest allowed body. Fallback: refuse bodies above the tested size.
- **R15. Harness version drift.** Codex changed how profiles load in 0.134.0 [C3]. Keys can change again. Check: decision H.
- **R16. Two capability words.** `packages/authoring/src/contracts.ts:18` already has `requiredCapabilities` for alpha skills (`workspace.write`, `command.test`, `approval.exact-revision`). Check: the docs page names both and says they are separate.
- **R17. Approval under a permissive parent.** Claude Code ignores a subagent's `permissionMode` under `bypassPermissions`, `acceptEdits`, or auto mode [S1]. The design never uses `permissionMode` to enforce a limit. Check: a test that the compiler output never depends on it.

## 8. Owner decisions and build effort

Each decision has a recommended default.

**Decision A: where capabilities live.**
- A1 (default): a `capabilities` key in the role's frontmatter.
- A2: a sibling file, `.bowerloom/teams/<team>/capabilities/<role>.yaml`. If no generated entry is needed, the Claude copy then stays byte-identical. A role then has two files that can drift.

**Decision B: defaults for omitted fields.**
- B1 (default): deny by default, except `read: allow`.
- B2: allow by default. Shorter, and a forgotten field grants power.
- B3: every field is required. Clear, and seven lines per role.

**Decision C: roles with no block.**
- C1 (default): derive capabilities from the Claude Code keys (section 3.4), and label them `derived`.
- C2: hold the Codex copy until the role declares a block.
- C3: treat the role as unlimited on both harnesses.

**Decision D: how a Codex own session starts.**
- D1 (default): `bowerloom run` starts Codex with `-c` flags after a settings read.
- D2: apply writes a profile to `$CODEX_HOME`, and the person runs `codex --profile <name>`. A trusted project settings file can override it (R1).
- D3: `bowerloom run --print` prints the command, and the person runs it. Enforcement then depends on the person running it unchanged.

**Decision E: Claude Code own sessions.**
- E1 (default): yes, through `bowerloom run --harness claude`, for `read: project`, and for `edit: none` or `network: none` with `shell: allow`.
- E2: no. Those roles are held on Claude Code.

**Decision F: Claude compile style.**
- F1 (default): a deny list, `disallowedTools`, with the class table reviewed for each tested version.
- F2: a generated allow list, `tools`, from a pinned list of built-in tools. New tools are blocked, and a missing helper tool can break a role.

**Decision G: approval.**
- G1 (default): not a capability in this version.
- G2: add `approval: ask`. Codex sets `approval_policy`. Claude Code needs an own session (R17).

**Decision H: harness versions.**
- H1 (default): claim enforcement only on tested versions. The Codex list starts from `packages/codex-adapter/src/policy.ts:8-12`. Other versions hold with the version sentence.
- H2: claim enforcement on any version.

**Build effort, in rough units:**

| Part | Size | What drives it |
|---|---|---|
| Schema, parser, derivation, conflict checks | medium | one test per field and value, and the derivation table |
| Claude compiler and the generated copy | medium | byte-range edits of frontmatter, golden files, and the adopt and drift changes |
| Codex agent file | small | the spec 01 writer exists as a design |
| Plan lines, JSON fields, refusal codes, docs | medium | four new codes, the plan goldens, and a docs page |
| `bowerloom run` for Codex | large | a new command that starts a process, the settings read and check, the stale-record check, and a security review |
| `bowerloom run` for Claude Code | medium | the `--agents` and `--settings` builder, and the sandbox probes |
| Checks R2 to R14 | small each | one scratch-project run each, about ten in all |

Total: large. A split keeps it reviewable. Phase 1 ships the schema, both compilers, and the plan display, and holds every role that needs an own session. Phase 2 ships `bowerloom run`.
