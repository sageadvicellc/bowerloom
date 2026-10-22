---
title: "Trust and security boundaries"
description: "Read the limits of prompts, portable files, tools, and local access."
section: "Concepts"
order: 20
---

Treat repository content, retrieved pages, tool descriptions, and model proposals as untrusted input. They cannot expand the user's permission.

## The agent allowance is a guardrail

`bowerloom apply --allow-agent` holds back an agent that sets `permissionMode: bypassPermissions`, `hooks`, or `mcpServers`. It works only in a terminal, and you type the role name. That stops a pipe, `--json`, and a CI job from allowing an agent by accident. It is not a boundary against an agent that has a shell or can write files. Such an agent can drive a pseudo-terminal, or write `.claude/agents` itself. Read what you allow.

## The read guard limits context, not access

An agent that names a context slice gets a read guard. Claude Code runs it before each Read, Grep, and Glob of that agent. It limits what those three tools reach under the folder of the slice. Shell tools, MCP tools, `LSP`, nested agents, `claude -p` runs, and an untrusted folder are not checked. The guard is not a security boundary. [Context slices for agents](/docs/guides/context-slices/#what-the-guard-does-not-stop) lists every way that stays open.

## Read a refusal as a boundary

An actual refusal identifies a stopped effect. Find its meaning in [Status and error reference](/docs/reference/errors/).

Use [Troubleshooting](/docs/troubleshooting/) to select inspection or recovery. Do not clear a refusal by editing identity or approval records.

## Trust and limits

Portable file validation does not sandbox a model. A trusted local tool server can retain host filesystem and network rights.

Container controls and synthetic tests narrow specific boundaries. They do not establish universal native containment or arbitrary server safety.

For example, a catalog description can contain a hostile instruction. The agent must treat it as data, not a new tool permission.

Prompts and model refusals do not replace controls outside the model. Setup grants no authority to operate unattended teams.

## Credentials and private bindings

Keep credentials out of portable definitions. Use private bindings where the supported feature requires them.

No parser here guarantees that arbitrary prose contains no secret. Inspect selected files before sharing them.

## The GitHub token for a private store

A store in a private GitHub repository needs a token. Set the environment variable `BOWERLOOM_GITHUB_TOKEN` to a GitHub token that can read the store repository. It is the only setting: there is no file, no flag, and no stored value. Without it, Bowerloom works as before and a private store refuses with `STORE_REMOTE_PRIVATE`.

Bowerloom sends the token to one host, `api.github.com`, and only for the repository of your store remote, or the repositories your lock names for its store items. Each plan that uses the token shows a `Credentials:` line that names those repositories. Bowerloom never stores the token and never prints it. It never writes it to a plan, a lock, a receipt, a log, or any other file. It refuses every redirect, so the token cannot travel to another host. Code that is loaded into the Bowerloom process, for example through `NODE_OPTIONS=--require`, can read the variable, as it can read any environment variable.

`skills add` and the fetch of pinned skills send no credentials. The fetch of store items sends a token. It does so only after you set `BOWERLOOM_GITHUB_TOKEN`.

In a project you did not write, read the `Credentials:` line before you approve. The lock of that project names the repositories, and the token goes to each one it names. Do not script `--approve` in a loop, in CI or anywhere else: a script that approves every plan it sees also approves a repository it has never seen.

Give the token read access to the store repository and nothing more. We advise a fine-grained token limited to that one repository. A classic token needs the `repo` scope, which grants write access to every private repository you can reach. This is advice: Bowerloom does not check the scope of the token.

<a id="installed-security-acceptance"></a>

## Review each execution environment

Review the prompts, skills, model and harness versions (a harness is an agent application such as Claude Code or Codex), tool scopes, and isolation for each later action.

A source scan or valid setup does not grant execution permission. If protected controls change, review the affected action again.

## Getting useful help

Share the package version, command family, safe error code, expected action, and sanitized description. Keep tokens and customer data private.

Keep private paths and raw receipts out of public reports. [Bug reports and feedback](/docs/feedback/) explains useful support context.

## Support boundary

[Current support](/docs/status/#security) records the activation limit. [Plans and approval](/docs/permissions/) explains each separate authority.
