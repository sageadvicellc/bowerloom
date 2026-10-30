# Step 5 live checks

These scripts run one real engine turn each. They answer questions that no document answers. Every script is gated. Set `BOWERLOOM_LIVE_ENGINES=1` to run them. Plain `npm test` skips them.

The scripts call models, so they can cost money. A turn is about 15k to 40k tokens. Checks g1 to g4 and g6 to g11 together are about 20 to 30 turns.

## Before you run anything

1. Build once: `npm run build`.
2. Name each engine command as a JSON list of words. The prompt is added as the last argument.
   - `BOWERLOOM_LIVE_CLAUDE_CODE='["claude","-p"]'`
   - `BOWERLOOM_LIVE_CODEX='["codex","exec","--skip-git-repo-check"]'`
   - `BOWERLOOM_LIVE_OPENCODE='["opencode","run"]'`
   - `BOWERLOOM_LIVE_PI='["pi","-p"]'` (check g3 only)
3. Pass each engine version yourself: `BOWERLOOM_LIVE_CLAUDE_CODE_VERSION`, `BOWERLOOM_LIVE_CODEX_VERSION`, `BOWERLOOM_LIVE_OPENCODE_VERSION`, `BOWERLOOM_LIVE_PI_VERSION`. The scripts never run a binary to find a version. An unset version is recorded as `unknown`.
4. Choose where result lines go: `BOWERLOOM_LIVE_RESULTS=<file>`. If you leave it unset, the run makes a private results folder in the system temp folder and keeps it.

Each run uses a new scratch folder with mode 0700 and a synthetic project. The folder is removed at the end. The Codex checks are the exception: they use the fixed root described under "Codex trust steps". `XDG_STATE_HOME` points inside it. `HOME` stays real, because an engine that signed in through the home folder would lose its login. If the engine signs in with an API key in the environment, you may set `BOWERLOOM_LIVE_ISOLATE_HOME=1`.

A stub command (a small node script) logs argv, the names of environment variables, and standard input. It never logs a value. The checks assert on that log and on files, never on model wording.

## Result lines

Each check appends one JSON line:

- `check`: the id, such as `g7`.
- `engine` and `version`: the version comes from the environment.
- `command`: the command shape, with the prompt shown as `<prompt>`.
- `result`: `pass`, `fail`, or `inconclusive`.
- `observed` and `evidence`: a short summary. No file contents, no private path.
- `date` and `at`: the UTC date and time.

`pass` means the check got a clear answer. For a discovery check, read `observed` to see which answer. `fail` means the engine did the opposite of what Bowerloom relies on. `inconclusive` means the run answered nothing, for example a hook that never ran. An inconclusive run still costs its turns. Fix the cause, then run it again.

## Codex trust steps

Codex reads a project `.codex` folder, and runs a project hook, only after a person trusts them. Codex saves the trust for one project path. It saves the hook trust against the hash of the hook. A random scratch folder per run has a new path and a new hook command every time, so it can never be trusted. Checks g4, g7, g8, and g9 therefore run in one fixed root.

Set up the root once:

1. Pick an empty or new folder outside the system temp folder, such as a folder in your home folder. A reboot can clear a folder under the system temp folder. Then the trust steps start again.
2. Build once with `npm run build`, then run: `node tools/step5/live/codex-trust-setup.mjs "<root>"`. The script makes the root, `<root>/project` with `git init`, the log stub, and the g7 hook file. It prints no environment value and starts no engine.
3. Do the three steps the script prints:
   1. Start Codex in the project: `cd "<root>/project" && codex`
   2. Accept the trust prompt for the folder.
   3. Type `/hooks`, review the hook and trust it, then quit Codex.
4. Set two variables for the live Codex checks: `BOWERLOOM_LIVE_CODEX_ROOT="<root>"` and `BOWERLOOM_LIVE_CODEX_TRUSTED=1`. Every Codex command below needs both.

How the fixed root works:

- Every run of g4, g7 (Codex case), g8, and g9 uses `<root>/project` as the project, and the same `home`, `state`, `stubs`, and `evidence.jsonl` beside it. The stub path, the log path, and the g7 hook command are the same on every run, so the hook hash does not change.
- Only g7 defines a hook. Checks g4, g8, and g9 write project config and rules. These need the folder trust only.
- Before each run, and after it, the checks clear what is inside `project`, `home`, `state`, and `stubs`, and remove the log. They keep the root, the `.bowerloom-live-codex-root` marker file, and the folders. They never delete the root. Each run also makes a new `.git` folder in the project. Codex finds the project root by that folder.
- A run refuses a relative path, a symlink, a folder owned by another user, and a non-empty folder that has no marker file.
- A run takes a lock file named `.bowerloom-live-codex-lock` in the root, and removes it at the end, also after a failure. A second run refuses while the lock exists. A run that was killed can leave the lock. The message names the process. When no run is active, delete the lock file by hand.
- Claude Code and OpenCode runs keep their random scratch folders.

If you set `BOWERLOOM_LIVE_CODEX_TRUSTED=1` and leave out `BOWERLOOM_LIVE_CODEX_ROOT`, these four tests refuse before any turn. They fail with a message that names both variables and the setup script, and they record an inconclusive line. Without the trust variable they refuse the same way.

If you move the root, change its path, or change the g7 hook, run the setup script and the three steps again.

## Check g1: AGENTS.md alone loads

- **Command:** `BOWERLOOM_LIVE_ENGINES=1 node --test packages/project-sync/test/portable-live.test.mjs --test-name-pattern='check 1 '`
- **Proves:** a project whose only instruction file is `AGENTS.md` makes Claude Code, Codex, and OpenCode answer from it.
- **Settles:** Spec P acceptance check 1. No constant changes. The result is the recorded proof.
- **Turns:** 3
- **Prerequisite:** the three engines are signed in. No trust step.

## Check g2: OpenCode lists a skill that sits in both skill roots

- **Command:** `BOWERLOOM_LIVE_ENGINES=1 node --test packages/project-sync/test/portable-live.test.mjs --test-name-pattern='check 11 '`
- **Proves:** how many times OpenCode lists one skill that Bowerloom writes to both `.claude/skills` and `.agents/skills`.
- **Settles:** Spec P decision 1, warn about the duplicate name or not.
- **Turns:** 1
- **Prerequisite:** OpenCode is signed in.

## Check g3: Pi trust detection for a project skill

- **Command:** `BOWERLOOM_LIVE_ENGINES=1 BOWERLOOM_LIVE_PI='["pi","-p"]' node --test packages/project-sync/test/portable-live.test.mjs --test-name-pattern='check 10 '`
- **Proves:** before trust is saved, a non-interactive Pi run skips the project skill, as the plan's `pendingTrust` list says.
- **Settles:** Pi trust detection, `pendingTrust` in `packages/project-sync/src/portable.ts`.
- **Turns:** 1
- **Prerequisite:** Pi 1.4.0 or later. Pi is not installed on this machine today, so this check waits.

## Check g4: Codex expands `${NAME}` in an MCP server

- **Command:** `BOWERLOOM_LIVE_ENGINES=1 BOWERLOOM_LIVE_CODEX_TRUSTED=1 BOWERLOOM_LIVE_CODEX_ROOT="<root>" BOWERLOOM_LIVE_CODEX='["codex","exec","--skip-git-repo-check"]' node --test packages/project-sync/test/locked-live.test.mjs --test-name-pattern='g4 \(live\)'`
- **Proves:** whether Codex expands `${PROBE}` in the arguments, the env table, the URL, and an HTTP header of a `.codex/config.toml` server. The run sets `PROBE`, and a stub plus a local probe server log what they receive. The `env_vars` entry is the control.
- **Settles:** the `absent` lines of `codex()` in `packages/fidelity/src/locked-mcp.ts`.
- **Turns:** 1
- **Prerequisite:** the Codex trust steps, `BOWERLOOM_LIVE_CODEX_ROOT`, and `BOWERLOOM_LIVE_CODEX_TRUSTED=1`.

## Check g5: OpenCode approval order

- **Command:** Manual. See the runbook below. A headless run cannot answer an approval prompt.
- **Proves:** whether a saved "always allow" outranks a config `deny` for the same command.
- **Settles:** the "unverified" statement of Spec L section 8.3 rule 9. In the code, the nearest line is the `ordered` sentence in `packages/fidelity/src/opencode.ts`.
- **Turns:** 3
- **Prerequisite:** OpenCode is signed in, and you can use a terminal.

Manual runbook:

1. Make a scratch folder and run `git init` in it.
2. Write `opencode.json` with `{"permission":{"bash":{"touch *":"ask"}}}`.
3. Start `opencode` in the folder. Ask: `Run: touch first.txt`.
4. When OpenCode asks, choose "always allow". This saves an approval.
5. Stop OpenCode. Change `opencode.json` to `{"permission":{"bash":{"touch *":"deny"}}}`.
6. Start `opencode` again. Ask: `Run: touch second.txt`.
7. Write down which of three things happened: the command ran, OpenCode asked again, or OpenCode refused.
8. Add one result line by hand to the results file: check `g5`, the engine, the version you passed, the command `opencode`, the result, and the three-way answer in `observed`.

## Check g6: OpenCode plugin inputs

- **Command:** `BOWERLOOM_LIVE_ENGINES=1 BOWERLOOM_LIVE_OPENCODE='["opencode","run"]' node --test packages/project-sync/test/locked-live.test.mjs --test-name-pattern='g6 \(live\)'`
- **Proves:** which keys the plugin hooks of the generated Bowerloom plugin receive, before and after a tool call. The stub logs the JSON that the plugin sends on standard input.
- **Settles:** the unverified note in `packages/fidelity/src/locked-hooks.ts` (ruling B19), about `output.args` after a tool runs.
- **Turns:** 1
- **Prerequisite:** OpenCode is signed in. The scratch project allows `bash`, so the run needs no approval.

## Check g7: Hook blocking

- **Command:** `BOWERLOOM_LIVE_ENGINES=1 BOWERLOOM_LIVE_CODEX_TRUSTED=1 BOWERLOOM_LIVE_CODEX_ROOT="<root>" BOWERLOOM_LIVE_CLAUDE_CODE='["claude","-p"]' BOWERLOOM_LIVE_CODEX='["codex","exec","--skip-git-repo-check"]' BOWERLOOM_LIVE_OPENCODE='["opencode","run"]' node --test packages/project-sync/test/locked-live.test.mjs --test-name-pattern='g7 \(live\)'`. To run one engine, add its name to the pattern, such as `'g7 \(live\).*opencode'`.
- **Proves:** a `PreToolUse` hook that exits 2 stops `touch blocked.txt`. If the hook ran and the file does not exist, the check passes. If the hook ran and the file exists, the check fails.
- **Settles:** Spec L section 7.3, and the weakened and translated lines for hooks in `packages/fidelity/src/locked-hooks.ts`. It also settles how a person's `permissions.defaultMode` meets the hook (the note in `packages/project-sync/src/locked.ts`).
- **Turns:** 3 to 5. One per engine. A rerun costs one more.
- **Prerequisite:** for Codex, the trust steps, `BOWERLOOM_LIVE_CODEX_ROOT`, and `BOWERLOOM_LIVE_CODEX_TRUSTED=1`. Claude Code runs with `--allowedTools Bash` and the prompt on standard input. Codex runs with `--sandbox workspace-write -c approval_policy="never"`.

## Check g8: Codex permission profile

- **Command:** `BOWERLOOM_LIVE_ENGINES=1 BOWERLOOM_LIVE_CODEX_TRUSTED=1 BOWERLOOM_LIVE_CODEX_ROOT="<root>" BOWERLOOM_LIVE_CODEX='["codex","exec","--skip-git-repo-check"]' node --test packages/project-sync/test/locked-live.test.mjs --test-name-pattern='g8 \(live\)'`
- **Proves:** a config with `default_permissions = "bowerloom"` and a profile that extends `:workspace` loads, and its `deny` entry stops Codex from reading and from patching `secret.txt`. Turn one reads both files. Turn two patches the denied file.
- **Settles:** `CODEX_PROFILE_ENABLED` in `packages/project-sync/src/locked.ts` (ruling B6) and ruling R17, the weakened patch line in `packages/fidelity/src/codex.ts`.
- **Turns:** 2
- **Prerequisite:** the Codex trust steps, `BOWERLOOM_LIVE_CODEX_ROOT`, and `BOWERLOOM_LIVE_CODEX_TRUSTED=1`.

## Check g9: `--ignore-rules`

- **Command:** `BOWERLOOM_LIVE_ENGINES=1 BOWERLOOM_LIVE_CODEX_TRUSTED=1 BOWERLOOM_LIVE_CODEX_ROOT="<root>" BOWERLOOM_LIVE_CODEX='["codex","exec","--skip-git-repo-check"]' node --test packages/project-sync/test/locked-live.test.mjs --test-name-pattern='g9 \(live\)'`
- **Proves:** with the Codex start command of `packages/team/src/engines.ts` (only the binary comes from your variable), a project rule that forbids `touch` is kept or dropped. If `ignore-probe.txt` exists, the rule was dropped.
- **Settles:** `TEAM_START_UNPINNED` for a Codex member whose guardrails write `.codex/rules/bowerloom.rules` (`packages/team/src/start.ts`, ruling V4).
- **Turns:** 1
- **Prerequisite:** the Codex trust steps, `BOWERLOOM_LIVE_CODEX_ROOT`, and `BOWERLOOM_LIVE_CODEX_TRUSTED=1`.

## Check g10: Claude Code `--setting-sources`

- **Command:** `BOWERLOOM_LIVE_ENGINES=1 BOWERLOOM_LIVE_CLAUDE_CODE='["claude","-p"]' node --test packages/project-sync/test/locked-live.test.mjs --test-name-pattern='g10 \(live\)'`
- **Proves:** first, `claude --help` (no tokens) names the flag, and the first line is recorded. Then a project deny of `touch pinned.txt` holds under `--setting-sources project,local` and does not apply under `--setting-sources user`.
- **Settles:** `pinned: null` for Claude Code in `packages/team/src/engines.ts`, and the `TEAM_START_UNPINNED` refusal for Claude Code.
- **Turns:** 2
- **Prerequisite:** Claude Code is signed in. This check runs `claude --help` itself, which is the only engine call that spends no tokens.

## Check g11: Claude Code defaults

- **Command:** `BOWERLOOM_LIVE_ENGINES=1 BOWERLOOM_LIVE_CLAUDE_CODE='["claude","-p"]' node --test packages/project-sync/test/locked-live.test.mjs --test-name-pattern='g11 \(live\)'`
- **Proves:** which of Read, Edit, Bash, and WebFetch a headless Claude Code run denies. The project has no rules. The run uses `--output-format json`. The result line lists the tool names in `permission_denials`, whether `notes.txt` changed, and whether the local server was fetched.
- **Settles:** `CLAUDE_CODE_DEFAULT` in `packages/fidelity/src/claude-code.ts`. DeepSeek Harness defaults wait on decision I7.
- **Turns:** 1
- **Prerequisite:** Claude Code is signed in. The WebFetch target is a local server on `127.0.0.1`.

## Check g12: Claude Code sandbox keys

- **Command:** Manual. Start with a documentation read, then run one turn per candidate key. See the runbook below.
- **Proves:** which keys of a sandbox `x-claude-code` block only restrict the sandbox or change nothing.
- **Settles:** `CLAUDE_SANDBOX_BLOCK_KEYS` in `packages/project-sync/src/locked.ts`. The list is empty today.
- **Turns:** 1 per candidate key. Plan on 1 until the documentation read names candidates.
- **Prerequisite:** Claude Code is signed in, and you can read the Claude Code sandboxing page.

Manual runbook:

1. Read the Claude Code sandboxing documentation and the settings reference. Write down, for each sandbox key, the source page and what the key does.
2. Keep only keys that restrict the sandbox or change nothing. A key that grants access, asks, or trusts is permission-like, so it does not belong in a private block.
3. Fill in this table. The two keys marked "written by Bowerloom" are known from the code. Everything else is a placeholder until the documentation read names it.

   | Key | Source | Verdict |
   |---|---|---|
   | `enabled` | written by Bowerloom today | not a candidate |
   | `allowUnsandboxedCommands` | written by Bowerloom today | not a candidate |
   | `<candidate key 1>` | `<documentation page>` | `<restricts, neutral, or permission-like>` |
   | `<candidate key 2>` | `<documentation page>` | `<restricts, neutral, or permission-like>` |

4. For each candidate that passes step 2, make a scratch project with `.claude/settings.json` holding `{"sandbox":{"enabled":true,"allowUnsandboxedCommands":false,"<candidate key>":<value>}}`.
5. Run one turn: `claude -p "Run: echo hi"` with `--output-format json`. Check that the key does not widen what the sandbox allows and that Claude Code accepts it without an error.
6. Add one result line by hand per key to the results file: check `g12`, the engine, the version you passed, the result, and the key in `observed`.
7. Hand the passing keys, each with its source, to the person who owns the follow-up edit of `CLAUDE_SANDBOX_BLOCK_KEYS`. This folder changes no source file.
