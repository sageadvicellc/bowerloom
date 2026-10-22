---
title: Context slices for agents
description: Give each agent only its part of a knowledge base, and measure the difference.
section: Guides
order: 7.9
---

A context slice gives an agent only its part of a knowledge base. A slice selects files from one folder. `bowerloom apply` turns it into a short list of paths that the agent loads at start. The files stay where they are. Nothing is copied except one title line for each file, so a page you edit is live at once.

## Before you start

Install Bowerloom and run `bowerloom up --team <name> --goal <goal>` once. See [Install Bowerloom](/docs/start/). Slices work with Claude Code in this beta. Codex gets no slice. See [Harnesses](/docs/harnesses/).

## Ask your agent

```text
Make a context slice named wiki over the folder wiki in this project. Run bowerloom slice create wiki --root wiki without --approve and show me the plan. Wait for my approval, then run it again with that revision. Then add slice-wiki to the skills list of the agent file I name, run bowerloom apply without --approve, and show me the plan. Do not approve either plan yourself. Then run bowerloom context measure and tell me what each agent loads at start.
```

## Agent procedure

### Create a slice

```sh
bowerloom slice create wiki --root wiki --include 'research/**/*.md'
```

The command shows a plan, then writes `.bowerloom/slices/wiki.yaml` and lists it in `.bowerloom/authoring/receipt.json`. `--root` is the folder the patterns start from. The default is the project folder. `--include` adds a path pattern and repeats up to 64 times. The default is `**/*.md`. If `.bowerloom/slices/wiki.yaml` is already there and not registered, `slice create wiki` registers the file and keeps its bytes. A slice id is lower-case letters and digits in words joined by single hyphens, at most 57 characters, and it does not start with `prompt-`. Ids that start with `slice-` are reserved for new skills and prompts.

### The slice file

The file is YAML with these keys, in this order. Any other key holds the slice with `SLICE_KEY_UNKNOWN`.

```text
format, description, root, include, exclude, where, links, summary, maxFiles, guard
```

- `format` is required and is `bowerloom/context-slice/v1beta1`.
- `description` is required, from 1 to 1024 characters. It becomes the description of the index skill.
- `root` is a folder inside the project, written relative to it. The default is `.`. A map with `registered` names a registered folder outside the project. This beta has no command to register one, so such a slice is held with `SLICE_ROOT_MISSING`.
- `include` is required: 1 to 64 patterns. `exclude` is a list of 0 to 64 patterns.
- `where` keeps a `.md` file only when its frontmatter matches. Every key must match, and a key matches when its value equals one of the listed strings. A list value matches when any element matches.
- `links` follows `[[wikilinks]]` and relative markdown links from the files it selects: `follow` takes `wikilink` and `markdown`, and `depth` is 1 or 2.
- `summary` is `heading` (the first line that starts with `# `, the default), `frontmatter:<key>`, or `none`.
- `maxFiles` is from 1 to 256. The default is 256.
- `guard` is `root` (the default) or `none`.

A pattern is a path from the root. `**` matches zero or more folders, `*` matches a run of characters inside one name, and `?` matches one character. `\` makes the next character literal. `[`, `{`, and a leading `!` are refused, so use `exclude` in place of negation. A wildcard never matches a name that starts with a dot, and a pattern may not name one, so `.git`, `.obsidian`, and `.bowerloom` are never selected. A pattern with no wildcard names one file, and the slice is held with `SLICE_PATH_MISSING` when that file is gone.

Bowerloom reads a slice only from folders and files that you own, that have one link, and that no other user can write. A link anywhere on the way holds the slice with `SLICE_SOURCE_UNSAFE`. A file is a member only when it is UTF-8 text with a plain name. A file over 1 MiB is listed without a title. A slice holds at most 256 files, 8,192 walked entries, 16 folder levels, and 32 MiB of read text, and its index stays under 64 KiB. Past a limit, the slice is held with `SLICE_TOO_LARGE`.

### Give a slice to an agent

Add `slice-wiki` to the `skills` list in the agent file, `.bowerloom/teams/<team>/agents/<role>.md`:

```text
---
name: lead
description: Leads the research desk.
skills: [slice-wiki]
omitClaudeMd: true
---
Answer from the files in your slice.
```

Claude Code preloads the first 32 skills of the list. `apply` writes `.claude/skills/slice-wiki/SKILL.md`, a list of paths with one title each, and the agent reads the files it needs with the Read tool. A name that matches no slice and no skill gets a warning, and the agent still installs.

### Start an agent with its slices only

A subagent loads every `CLAUDE.md` and `AGENTS.md` file above its working folder, with their `@` imports, at start. For a large project that can be most of what it loads. `omitClaudeMd: true` starts it without the user, project, and local `CLAUDE.md` files. Run `bowerloom context measure` to see the difference. Managed policy files still load. A `CLAUDE.md` or `AGENTS.md` in a folder at or above a file the agent reads still loads when it reads that file.

### The read guard

An agent that names a slice with `guard: root` gets a `PreToolUse` hook in its copy, `.claude/agents/<role>.md`. Before each Read, Grep, and Glob of that agent, Claude Code runs `bowerloom-guard`. The guard blocks a call that reaches a file under the root of the slice when no slice of the agent lists that file. It stays silent for everything else, so it never allows a call that Claude Code would ask about or block. A Grep or Glob must name a path. A search of a folder is allowed when every file below it is a member. A Glob pattern without a slash matches at any depth, so a search from a folder that holds a guarded folder is refused too.

To see what the guard decides, run:

```sh
bowerloom context guard --agent lead --explain wiki/private/notes.md
```

The guard needs these things, and without one of them it does not run or it blocks every call:

- Claude Code 2.1.295 or later. Older versions ignore `onFailure`, so a guard that cannot start lets the call through. The guard turns every error of its own into a deny, so only a guard that cannot start is affected. In a test on Claude Code 2.1.292, a missing `bowerloom-guard` did not block the call.
- A folder that you trusted. Claude Code runs the hook of a project subagent only after you accept the workspace trust dialog. A `claude -p` run, a Routine, and a CI job that uses `claude -p` do not run it.
- `bowerloom-guard` on your `PATH`. Claude Code blocks the call when it is missing.
- The same `XDG_STATE_HOME` as the shell that ran `apply`. Another one finds no receipts, and every call is blocked.
- A copy of the agent that names this machine's project folder. The hook arguments hold the real path of the project and its id. A copy committed to git and checked out on another machine blocks every read there, and `apply` holds the agent with `AGENT_TARGET_OCCUPIED` until you move the file aside. The plan prints a note when `.claude/agents` may not be git-ignored. Bowerloom reads the `.gitignore` files from the project folder up to the repository folder and `.git/info/exclude`. It does not read the global excludes file of git, so the note can show for a folder that git does ignore.

An agent with `isolation: worktree` and a guard list is held with `AGENT_GUARD_WORKTREE`. A worktree holds its own copies of every tracked file, outside the guarded folders. An agent whose `hooks` is not a map, or whose `hooks.PreToolUse` is not a list, is held with `AGENT_GUARD_CONFLICT`.

#### What the guard does not stop

A slice and its guard limit context. They are not a security boundary. These ways stay open:

1. Shell tools (`Bash`, `PowerShell`, `Monitor`) read any file. The plan notes them.
2. `LSP` reads code symbols. The plan notes it.
3. A nested subagent that the agent starts may not be guarded. The plan notes `Agent`.
4. An untrusted folder skips the hook. A `claude -p` run skips it too. So do Routines and CI runs that use `claude -p`.
5. An agent with `Edit` or `Write` can edit its own copy or the managed catalogs. The guard checks a catalog against its receipt, so a casual edit fails closed. A determined edit of the private receipts is not stopped.
6. A file that the agent writes under a guarded area cannot be read back unless a slice lists it.
7. A `bowerloom-guard` on `PATH` from another version reads the same catalog format in beta.3. A failure there blocks the call.
8. Claude Code before 2.1.295 ignores `onFailure`. A guard that cannot start then lets the call through.
9. A Claude Code process with a different `XDG_STATE_HOME` from the shell that ran apply finds no receipts. Every call is then denied.
10. MCP tools read files without the guard. The plan notes them.
11. A hard link outside the root to a file under the root reads that file, whether it was made before or after apply. The guard denies such a Read only when the file has more than one link, sits on the device of a guarded root, and is not a member.
12. Any change between the guard's check and the tool's run, such as a swapped link or a file added to a covered folder, is not seen.
13. Glob may follow links below its target.
14. The Skill tool can load another agent's slice index.
15. A copy of a guarded file elsewhere is outside every area and is read freely. That includes a git worktree, a clone, a backup, a snapshot, or a search index.
16. Another mount of the same folder, such as a bind mount or a network share, is not seen.
17. A `CLAUDE.md` or `AGENTS.md` in a folder at or above a member, under or outside a guarded area, loads when the agent reads that member, even when no slice lists it. `omitClaudeMd` does not stop it.
18. Another `PreToolUse` hook that returns `updatedInput` can change the path after the guard checked it.
19. `disableAllHooks` in any settings file, and `allowManagedHooksOnly` in managed settings, stop the guard.
20. An agent run as the main session (`claude --agent <role>`) may not run its frontmatter hooks.

### Preview a slice

```sh
bowerloom context show wiki
```

It prints the files the slice selects, the index that `apply` writes, whether the installed index matches, the guard mode, the agents that name the slice, and the notes. It reads only.

### Measure what each agent loads

```sh
bowerloom context measure [--agent <role>]... [--team <team>] [--from <folder>] [--baseline <folder>] [--bytes-per-token <number>] [--user] [--json]
```

For each agent, it reports the prompt, the instructions, the preloaded skills, and the slice indexes that load at start. It also reports the files an agent would read on demand, and a baseline: the same agent with every `.md` file of a folder loaded at start. The baseline folder is the deepest folder that holds the roots of the measured slices. `--baseline` names another folder. `--from` is the folder Claude Code starts in; an agent is found only from a folder at or below the project.

Bytes are exact. Tokens are an estimate: bytes divided by 4, with an assumed band of 3.0 to 4.5 bytes per token. The estimate is not calibrated, because Claude has no public offline tokenizer, and the measure uses no network. To calibrate it, divide the bytes of a known file by its token count in the `/context` output of Claude Code, and pass the result as `--bytes-per-token`. If the breakdown does not name single files, compare the totals with and without one file. Ratios come from exact bytes. The output also gives the share of counted bytes that are not ASCII, because the estimate is weaker for text that is not Latin script.

The measure models these rules of Claude Code. Each is marked verified or assumed in the `assumptions` list of the JSON:

- `CLAUDE.md`, `.claude/CLAUDE.md`, and `CLAUDE.local.md` load from the start folder and every folder above it (verified).
- `AGENTS.md` and `.claude/AGENTS.md` load only when no `CLAUDE.md` file of those kinds is on that chain (verified).
- `@path` imports expand up to four hops (verified). The import grammar is Bowerloom's reading of the documentation.
- `.claude/rules` files without a `paths` key load at start (verified).
- `omitClaudeMd` removes the user, project, and local `CLAUDE.md` files (verified). The measure assumes it also removes `AGENTS.md` files and rules files.
- A `CLAUDE.md` or `AGENTS.md` in a subfolder loads when a file there is read (verified).
- A preloaded skill counts as its whole `SKILL.md`, frontmatter included. Whether Claude Code adds the frontmatter is not documented.

The measure does not count Claude Code's own system details and tool definitions, MCP tool definitions, git status, the sibling list, the task message, managed policy files, agent memory, the skill list in the subagent, files the agent reads beyond its slices, or model output. The measure cannot prove answer quality or task success, because a smaller context can be worse when it leaves out what the task needs. It cannot prove what an agent actually reads. It cannot prove that Claude's tokenizer agrees with the estimate. It does not model caching, cost, or speed. Index skills also enter the main session's skill list, one description line each; the measure counts the agent, not the main session. A quality comparison needs a separate evaluation.

### Registered folders

A slice can later name a folder outside the project, such as a knowledge base, through a registered folder. This beta has no command to register one, and a slice that names one is held with `SLICE_ROOT_MISSING`. Use a root inside the project.

### Codex

Codex gets no slice in this beta. A later release designs a harness-neutral model first. Codex reads skills from `.agents/skills`, but it documents no per-agent skill preload, no switch that leaves out `AGENTS.md` for one agent, and no per-agent hook in the agent file.

## On refusal

Stop and report the code. [Status and error reference](/docs/reference/errors/#context-slice-refusals) lists each one. A held slice does not stop the rest of `apply`.
