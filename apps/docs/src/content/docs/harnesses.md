---
title: "Codex and Claude Code"
description: "Read the supported synthetic scope before changing an agent application."
section: "Guides: Connections and shared work"
order: 12
---

A harness is an application that runs a model and exposes tools. Bowerloom separates portable definitions from harness-specific configuration.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads skills only from public sources. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

## Ask your agent

```text
Explain what the current Bowerloom beta supports for my agent application. Separate synthetic projection from live execution. Do not change my configuration.
```

## Agent procedure

### Selected synthetic configuration

Install the matching CLI version through [Install Bowerloom](/docs/start/).

The CLI supports selected fixture import, planning, approved projection, removal, and recovery for `codex` and `claude`.

These commands require separately reviewed synthetic files. Do not point them at live `.codex/` or Claude Code configuration.

The `--synthetic` flag records the caller's assertion. It cannot prove that the selected data is synthetic.

### Read the exact reference

[CLI reference](/docs/cli/#harness) lists all seven command forms. Import and planning read the selected fixture.

Approved projection and removal change only that selected synthetic configuration. Recovery requires its recorded operation approval.

The supported subset preserves explicit provider model names. It does not convert one provider's permissions into another's authority.

<a id="native-execution-remains-gated"></a>

### Model execution is separate

These harness commands do not start models or grant execution authority. They do not provide a live team runner.

Keep your agent application's existing access controls. Do not substitute an older or less restricted path.

If the selected inputs are live or their scope is unclear, stop before changing them.

## Portable skills for Codex and Claude Code

For an existing project, `bowerloom skills sync` and `bowerloom apply` put pinned skills and prompts in place for Claude Code, Codex, or both. Skills go to `.claude/skills` and `.agents/skills`. A prompt becomes the Claude Code command `.claude/commands/<name>.md` and the Codex skill `.agents/skills/prompt-<name>`. `bowerloom up --team <name>` targets both harnesses by default. Pass `--harness claude`, `--harness codex`, or `--harness both` to `apply` to choose. [Add third-party skills](/docs/guides/add-skills/) explains the commands.

These copies are files. Native discovery of them by Claude Code and Codex is not observed. A copy does not prove that either harness finds or runs it. Bowerloom never edits `AGENTS.md` or `CLAUDE.md`. `apply` prints a line for you to add.

The separate `bowerloom portable` installer projects reviewed skill files into a new workspace. The `codex` value projects them into `.agents/skills/`. The `claude` value projects them into `.claude/skills/`. The synthetic configuration commands above do not project skill files. Portable skill installation for an existing target remains unsupported.

## Support boundary

[Current support](/docs/status/#harnesses) records the runtime limit. [Security boundaries](/docs/security/) explains host tool rights.
