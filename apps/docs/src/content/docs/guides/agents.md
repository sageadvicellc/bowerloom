---
title: Project agents for Claude Code
description: Put team agents in .claude/agents with bowerloom apply.
section: Guides
order: 7.8
---

A team can hold agents. An agent is a Claude Code subagent: a Markdown file that Claude Code starts for one task. Claude Code reads subagents only from `.claude/agents`. `bowerloom apply` copies the agents of your teams there. It starts no process and never fetches.

## Before you start

Install Bowerloom and run `bowerloom up --team <name> --goal <goal>` once. See [Install Bowerloom](/docs/start/). Keep the project out of iCloud Drive.

Codex agents are not projected in this beta. When the project holds agent files and the harness list includes Codex, `apply` prints one line about this. It reads and writes no file under `.codex`.

## Ask your agent

```text
Add an agent named scribe to the first team in this project. Write it at .bowerloom/teams/first-team/agents/scribe.md. Then run bowerloom apply without --approve and show me the plan. Wait for my approval, then run it again with that revision. Do not edit AGENTS.md or CLAUDE.md.
```

## Agent procedure

### Put the source file in place

Each agent is one file: `.bowerloom/teams/<team>/agents/<role>.md`. The file name without `.md` is the role. A role is lower-case letters and digits in words joined by single hyphens, at most 64 characters. It does not start with `prompt-`.

You place the file by hand. Bowerloom does not create it. The `agents` folder and the file must belong to you, with no write access for the group or others. The file holds at most 64 KiB.

The first team is a team too. Put its agents in `.bowerloom/teams/first-team/agents`. `bowerloom status` does not report that folder as drift.

A file looks like this:

```text
---
name: scribe
description: Writes down what the team decided.
tools: Read, Grep
---
Take notes of each decision. Keep them short.
```

### Run apply

```sh
bowerloom apply
```

The plan lists each agent: `install agent`, `update agent`, `adopt agent`, `agent up to date`, `agent kept`, or `agent held`. After you approve, the copy lands at `.claude/agents/<role>.md`, byte for byte. Bowerloom also records the item in `.bowerloom/managed/catalog/agent_<role>.json`. These copies stay on this machine. Decide for yourself whether git tracks `.claude/agents`. Commit the source files in `.bowerloom/teams`. Bowerloom never edits `.gitignore` outside `.bowerloom/managed/.gitignore`.

Apply never removes a copy. If you delete a source file, the plan shows `agent kept`, and the copy stays.

### The keys a file can use

The file starts with a `---` line, holds YAML, and ends the YAML with a `---` line. Then comes the body. The body must not be empty. A byte order mark, a null byte, or a carriage return at the start or inside the file holds the agent.

Bowerloom accepts only the documented subagent keys, in this order:

```text
name, description, tools, disallowedTools, model, permissionMode, maxTurns,
autoCompactWindow, skills, mcpServers, hooks, memory, background,
omitClaudeMd, effort, isolation, color, initialPrompt, experimental
```

- `name` is required. It must equal the file name without `.md`.
- `description` is required, from 1 to 2048 characters.
- `tools`, `disallowedTools`, and `skills` take a comma-separated string or a list of strings, at most 64 entries of at most 128 characters. A comma inside parentheses does not split an entry. `tools: []` means no tools. A tool entry such as `Bash(npm run *)` is valid. Tool names are case-sensitive.
- `model` is a model name of at most 128 characters.
- `permissionMode` is one of `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`, or `manual`.
- `maxTurns` is a whole number from 1 to 10000. `autoCompactWindow` is a whole number from 100000 to 1000000.
- `mcpServers` and `hooks` are a map or a list. Each is at most 6 levels deep, and at most 4096 bytes when written as JSON. Bowerloom never reads their meaning.
- `memory` is `user`, `project`, or `local`. `effort` is `low`, `medium`, `high`, `xhigh`, or `max`. `isolation` is `worktree`.
- `background` and `omitClaudeMd` are `true` or `false`.
- `color` is `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, or `cyan`.
- `initialPrompt` is text of at most 8192 bytes.
- `experimental` is a map with only the key `cacheTtl`, set to `5m` or `1h`.

A key with an empty value is not valid. A repeated key, an alias, and a merge key are not valid.

### What the notices mean

Some keys take effect when the agent runs. Claude Code applies them. The plan names them in a `Note:` line and never quotes the file. Read the agent before you approve.

- `sets hooks` means the file has a `hooks` key.
- `sets mcpServers` means the file has an `mcpServers` key.
- `sets permissionMode <value>` means the mode is not `default` and not `plan`.
- `lists shell tools in tools` means `tools` names `Bash`, `PowerShell`, or `Monitor`, with or without a pattern in parentheses.
- `inherits every tool, including shell tools` means the file has no `tools` key.

### Built-in names

Claude Code ships these subagents: `Explore`, `Plan`, `general-purpose`, `statusline-setup`, `claude-code-guide`, and `claude`. A role that matches one of them, in any case, still installs. The plan adds a `Warning:` line. The Claude Code docs do not say how a project agent ranks against a built-in, so Bowerloom makes no claim. Check which one Claude Code uses.

### If a hand-made file is already there

A file at `.claude/agents/<role>.md` that Bowerloom did not install is never overwritten.

- If it is a plain file that you own, with mode 0644 and one link, and its bytes equal the copy, `apply` adopts it. The plan says `adopt agent`. Bowerloom keeps your original as a backup until the operation commits. After that the file is managed.
- If it differs, `apply` holds that agent with `AGENT_TARGET_OCCUPIED`.
- The same code holds a link, a folder, and a file with another mode or owner. It also holds a file with two links, and a name that differs only in case.

To release a held file:

1. Move it aside, for example `mv .claude/agents/scribe.md .claude/agents/scribe.md.old`.
2. Run `bowerloom apply`. The plan shows `install agent`.
3. Approve with `--approve <revision>`.

If the hand-made file holds edits you want, copy them into `.bowerloom/teams/<team>/agents/<role>.md` first. When its bytes equal the copy, `chmod 644` also fixes a file with mode 0600 or 0664.

A copy that you edit after Bowerloom installed it is held with `MANAGED_SKILL_LOCAL_DRIFT`. Bowerloom never overwrites it.

### If an agent is held

A hold affects one agent. Every other skill, prompt, and agent still applies. The `Next:` line says what to do.

- `AGENT_INVALID` means the file cannot be used. The line names the problem. Other entries in `agents/` hold with it too: a folder, a hidden name, a name that does not end in `.md`, and a link.
- `AGENT_KEY_UNKNOWN` means a key is not a documented subagent key.
- `AGENT_NAME_MISMATCH` means the `name` key differs from the file name, or the file name is not a valid role.
- `APPLY_AGENT_DUPLICATE` means two teams hold an agent with the same role. Both are held. Rename or remove one. An agent that was installed before stays installed.
- `AGENT_TARGET_OCCUPIED` means a file that Bowerloom did not install is at the target.

Two problems stop the whole `apply`, and nothing is written. `AGENT_LIMIT` means the project holds more than 128 agent files. `APPLY_AGENTS_FOLDER_UNSAFE` means `.claude` or `.claude/agents` is a link or others can write to it. An unsafe `agents` folder in `.bowerloom` stops it with `AUTHORING_UNSAFE_PATH`. [Errors](/docs/reference/errors/) lists each code.

## Limits in this beta

- Codex agents are not projected in this beta.
- `bowerloom revise` refuses while `.bowerloom/teams/first-team/agents` exists. Move the folder out, revise, then move it back.
- A 0.7.0-beta.2 CLI cannot read a project that holds agent catalogs. It refuses.
- Native discovery of the copies by Claude Code is not observed. This page asserts nothing about whether Claude Code needs a restart to see a new file.
