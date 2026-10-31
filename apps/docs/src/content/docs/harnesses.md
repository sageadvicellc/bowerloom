---
title: "Codex and Claude Code"
description: "See which engines Bowerloom supports, what each one receives, and how the Codex permission profile works."
section: "Guides: Connections and shared work"
order: 12
---

A harness is the set of skills, agents, tools, rules, and context that surrounds a coding model. An engine is an application that runs a model and reads that harness from files, such as Claude Code or Codex. Bowerloom 0.8.0-beta.1 keeps one harness in `.bowerloom` and writes the files of each engine from it. [Harness, engines, and fidelity](/docs/concepts/harness-and-fidelity/) defines the words.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads pinned skills only from public sources. A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`, as [Where your items come from](/docs/guides/item-sources/#private-store) explains. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

## Ask your agent

```text
Explain what Bowerloom 0.8.0-beta.1 supports for my engines. Separate the supported engines from the preview engines. Tell me what bowerloom harness install would write for each engine, and which lines are weakened or absent. Do not change my configuration.
```

## Agent procedure

### Supported and preview engines

- Supported in beta.1: Claude Code (`claude-code`) and Codex (`codex`).
- Preview: OpenCode (`opencode`), Pi (`pi`), and DeepSeek Harness (`deepseek-harness`). Install to a preview engine works only with `BOWERLOOM_PREVIEW_ENGINES=1`. Without it, install refuses a preview engine that you name with `ENGINE_PREVIEW`. Adopt, drift, status, and remove work for every engine.

Bowerloom reads files and writes files. It never starts an engine and never calls a model. Keep the access controls that your engine already has. A harness install does not give an engine new authority.

[Adopt and install a harness](/docs/guides/adopt-and-install/) gives the commands.

### What each engine receives

The install plan lists every file before Bowerloom writes it. These are the paths that the plan can name for the two supported engines.

- Claude Code: `CLAUDE.md`, `.claude/skills`, `.claude/agents`, `.claude/settings.json` for rules and hooks, and `.mcp.json` for servers.
- Codex: `AGENTS.md`, `.agents/skills`, `.codex/agents`, `.codex/config.toml`, `.codex/hooks.json`, and `.codex/rules/bowerloom.rules`.

Bowerloom keeps your own entries. When a file already holds an entry of the same name, install refuses with `PORTABLE_CONFLICT`. When a target holds files that Bowerloom did not write, install refuses with `PORTABLE_PATH_OCCUPIED`. It never overwrites them.

The two engines read different instruction files. Codex reads `AGENTS.md`. Claude Code reads `CLAUDE.md`. When both exist and differ, the plan asks you to choose with `--reconcile`. The default in the desktop app is to accept `AGENTS.md`, which makes `CLAUDE.md` one line that reads `@AGENTS.md`.

Codex reads the `.codex` folder of a project only after you trust the project. The plan lists a file that waits for that trust as pending trust. Claude Code asks you to approve each project server in `.mcp.json` before it runs.

### The Codex permission profile

Bowerloom carries the path rules and the sandbox rules of a harness into Codex as a permission profile.

When the harness holds a path rule or a sandbox rule, `harness install` adds these to `.codex/config.toml`:

- `default_permissions = "bowerloom"` at the top level, which selects the profile.
- A table `permissions.bowerloom` that extends `:workspace`, the built-in Codex profile for the project folder.
- Under it, a filesystem table for `:workspace_roots` that holds one entry for each path rule, as deny, read, or write. When two rules name one path, the stricter one wins.

If your own `.codex/config.toml` sets `sandbox_mode`, `sandbox_workspace_write`, or `profile` at the top level, each one counts as a conflict, because it could override the profile. Install refuses with `PORTABLE_CONFLICT`. Bowerloom never edits your entries.

Bowerloom reports every line that the profile carries as `weakened`. It checked on Codex 0.157.0 that the profile loads and that a deny entry for one path at the project root blocks a read. It did not check the network and write limits of `:workspace`, user or managed Codex configuration, a profile chosen on the command line, or start flags such as `--sandbox`. The plan says so on each line. A rule that the harness enforces therefore needs your `harness accept` before install writes it.

Bowerloom writes no Codex allow rule from a neutral allow rule. A Codex allow rule runs a command outside the sandbox without asking. The sandbox profile and the approval policy of Codex decide instead.

### Model execution is separate

Harness commands do not start models or grant execution authority. If the selected files are live and you are unsure of their scope, read the plan and stop before you approve.

## The 0.7 skill and prompt copies

`bowerloom skills sync` and `bowerloom apply` put pinned skills and prompts in place for Claude Code, Codex, or both. Skills go to `.claude/skills` and `.agents/skills`. A prompt becomes the Claude Code command `.claude/commands/<name>.md` and the Codex skill `.agents/skills/prompt-<name>`. `bowerloom up --team <name>` targets both by default. Pass `--harness claude`, `--harness codex`, or `--harness both` to `apply` to choose. [Add third-party skills](/docs/guides/add-skills/) explains the commands.

`bowerloom apply` projects the agents of a team into `.claude/agents` for Claude Code. It does not project Codex agents. `bowerloom harness install` writes Codex agents to `.codex/agents`. These copies are files. A copy does not prove that an engine finds or runs it. Bowerloom never edits `AGENTS.md` or `CLAUDE.md` in the 0.7 commands. `apply` prints a line for you to add.

The separate `bowerloom portable` installer projects reviewed skill files into a new workspace. The `codex` value projects them into `.agents/skills/`. The `claude` value projects them into `.claude/skills/`. It does not support an existing target.

## Support boundary

[Current support](/docs/status/#harnesses) records the limits. [Security boundaries](/docs/security/) explains host tool rights.
