---
title: "Adopt and install a harness"
description: "Read the engine files of a project into one harness, install it for Claude Code and Codex, and check or undo the result."
section: "Guides"
order: 6.5
---

This guide is the main path of Bowerloom 0.8.0-beta.1. You adopt the engine files that a project already has into one harness. Then you install that harness for each engine. [Harness, engines, and fidelity](/docs/concepts/harness-and-fidelity/) defines the words. The [desktop app](/docs/app/) does the same steps on screen.

Every command that writes shows a plan and a revision first. Nothing is written until you run the same command again with `--approve <revision>`. [Approvals and exit codes](/docs/cli/#approvals-and-exit-codes) explains the exit codes. No harness command runs an engine or a model.

## Ask your agent

```text
Read the Bowerloom guide "Adopt and install a harness" for 0.8.0-beta.1. In my project folder, run bowerloom harness status. Then run bowerloom harness adopt and show me the plan. Wait for my approval of the exact revision. After that, run bowerloom harness install and show me the plan, including every line that is weakened or absent. Never approve a weaker line for me. Run bowerloom harness drift after each install. Do not edit engine files by hand.
```

## Agent procedure

### Before you start

Install the CLI as [Install Bowerloom](/docs/start/) describes. Run the commands in the project folder, or pass `--dir <absolute-folder>` to any harness command. Keep the project out of iCloud Drive folders. A project in a cloud-synced folder refuses with `PROJECT_IN_CLOUD_FOLDER`.

`bowerloom help harness` prints every form and flag of these commands.

### 1. Read the state

```sh
bowerloom harness status
```

`status` changes nothing. It says whether the folder has a harness, which engines it lists, whether an install is recorded, and whether a run stopped part way. If the folder has no harness, it says `Next: bowerloom harness adopt`.

### 2. Adopt the files you have

```sh
bowerloom harness adopt
```

Adopt reads the engine files of the folder and writes only `.bowerloom`. It changes no engine file. It exits 3 with a plan that lists each `.bowerloom` file it would write. The plan can also hold these items:

- A conflict. Two engines hold an item of the same name and the copies differ. Answer each one with `--pick <conflict>=<variant>`, or with `--rename <conflict>:<variant>=<id>` to keep both under new ids.
- A line `Not adopted`. Bowerloom did not read the entry. When the line says so, add `--acknowledge <id>` to leave it out on purpose.
- A secret value. Bowerloom replaces it with a reference.
- A confirmation. Some items need your confirmation, for example a text that more engines would read after the install. The plan prints the reason. Add `--confirm <part/id>` for each one after you read it. Without every confirmation, adopt refuses with `ADOPTION_APPROVAL_REQUIRED`.
- An engine-wide choice. By default an adopted item applies only to the engines whose files held it. `--every-engine guardrails`, `--every-engine hooks`, or `--every-engine mcp` makes every item of that part apply to every engine. An item that differs between engines keeps its own engines, and the plan says why.

To name the engines and their versions, add `--engine <id>[@<version>]` once for each engine. `<id>` is `claude-code`, `codex`, `opencode`, `pi`, or `deepseek-harness`.

Apply the plan with the revision it printed and the answers you chose:

```sh
bowerloom harness adopt --approve <revision>
```

Add the same `--pick`, `--rename`, `--acknowledge`, `--every-engine`, and `--confirm` flags that you used for the plan. If a file changed after you saw the plan, Bowerloom refuses with `ADOPTION_STALE_APPROVAL` and writes nothing. If the folder already has a harness, adopt refuses with `ADOPTION_DEFINED`.

### 3. Install the harness

```sh
bowerloom harness install
```

Install writes the engine files from `.bowerloom`. The plan lists each file with its action, and it lists every part that an engine does not carry exactly, with the word `translated`, `weakened`, or `absent`. It also prints any code or command that an engine will run, in full, so that you can read it first.

By default install covers each supported engine that the harness lists. To choose, add `--engine <id>` once for each engine. `OpenCode`, `Pi`, and `DeepSeek Harness` install only with `BOWERLOOM_PREVIEW_ENGINES=1` set. Without it, naming one refuses with `ENGINE_PREVIEW`.

If both `AGENTS.md` and `CLAUDE.md` exist and differ, choose what to do with `--reconcile`:

- `accept-agents` makes `CLAUDE.md` one line that reads `@AGENTS.md`.
- `merge` is the value that follows `bowerloom harness merge`. That command first moves the text of `CLAUDE.md` into `.bowerloom/instructions/AGENTS.md`. It shows its own plan and needs its own `--approve`.
- `keep-both` leaves `CLAUDE.md` as it is, so Claude Code keeps reading it.

Two more flags apply in narrow cases. `--write-claude-md` accepts an offer in the plan to write `CLAUDE.md` as `@AGENTS.md` when no `CLAUDE.md` exists. `--pi-trust-saved` applies only when the install includes Pi, which is a preview engine.

When nothing would change, install prints `Nothing to change.` and exits 0 with no approval.

### 4. Approve a weaker line, only if you accept it

If an engine would carry a rule that the harness enforces more weakly, install refuses with `PORTABLE_FIDELITY` and exits 1. It prints each refused line with a key like this:

```text
guardrails/no-force-push@codex:1a2b3c4d5e6f
```

Read the reason under each line. For each line that you accept, run:

```sh
bowerloom harness accept <key>
```

`accept` saves your approval of that one line, tied to the entry as it is now. It changes no project file. Then run `bowerloom harness install` again. A line whose entry has no match in the harness cannot be approved. Change the harness instead. If the entry changed since the key was printed, `accept` refuses with `HARNESS_APPROVAL_STALE`. Run install again to see the new line.

### 5. Apply and check

```sh
bowerloom harness install --approve <revision>
bowerloom harness drift
bowerloom harness drift --check
```

`drift` lists the files that Bowerloom wrote and that changed since. `drift --check` does the same and fails with `PORTABLE_DRIFT`, exit 1, when a file changed or when `CLAUDE.md` does not follow `AGENTS.md`. It fails with `PORTABLE_NOTHING_PROJECTED` when nothing is installed. Use it in a script or a CI job. Add `--json` for the machine form.

### 6. Undo

```sh
bowerloom harness remove
bowerloom harness remove --approve <revision>
```

Remove puts back every file that install replaced, and deletes the files that install created. A file that you changed since is kept, and the result says so.

### 7. Recover a run that stopped

Bowerloom keeps a record while it writes. If a run stops part way, `status` says so, and the next write refuses until you recover.

```sh
bowerloom harness recover
bowerloom harness recover --adoption
```

- `recover` finishes or takes back a stopped install or removal. To keep your own version of a changed file, add `--keep <path>`. For a file whose mode changed, add `--restore-mode <path>` to put the recorded mode back, or `--record-mode <path>` to keep the new mode.
- `recover --adoption` settles an adoption or a merge that stopped. It takes none of the three path flags.
- A save of the harness that stopped part way in the desktop app blocks install, remove, accept, adopt, and merge until the app finishes it. `status` says so.

Both forms print a plan first and need `--approve <revision>`.

## Flags that every harness command takes

- `--dir <absolute-folder>` names the folder. The default is the working folder.
- `--json` prints machine-readable output. A command that writes prints its plan and revision, and exits 3.
- `--approve <revision>` applies a plan. Only the commands that write take it: `adopt`, `install`, `merge`, `remove`, and `recover`. `status`, `accept`, and `drift` take no `--approve`.

[CLI reference](/docs/cli/#harness) lists every command and its flags in one place. [Errors](/docs/reference/errors/#harness-refusals) lists the refusal codes.
