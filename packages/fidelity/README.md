# fidelity

The fidelity engine of Bowerloom 0.8. It decides how each engine carries a harness's guardrails, and it reports every loss. It writes no file and runs no engine. Step 3 writes the engine forms.

Spec: `2026-10-27-bowerloom-locked-in-parts.md`, sections 2, 3, 8, 10, 11, and 12. The contract is `packages/harness-definition`.

## What it does

- `neutralDecision(rules, request)` gives what the definition decides for one request: `deny`, `ask`, `default`, or `allow`. `deny` beats `ask`, and `ask` beats `allow`, whatever the order. `default` means no rule matched, so the engine default applies.
- `translateGuardrails(engine, { rules, sandbox })` gives the engine form in memory, one loss line per entry, the list of what it wrote, and the private blocks it carries.
- `engineDecision(form, request)` gives what the translated engine form decides for the same request.
- `projectGuardrails(source, approvals)` translates to every engine of the source and judges the report with `checkFidelity`. `judgeGuardrails` judges a report alone.
- A matcher per engine reads the engine's own rules: `claudeCodeDecide`, `codexDecide`, `codexFilesystemDecide`, `openCodeDecide`, and the hook matchers. The 64 vectors of the matching-semantics note run through them.

## The neutral pattern language

A guardrail pattern is plain text in the contract. This package gives it a meaning.

- **Shell**: Claude Code's Bash pattern. `*` matches any text. A trailing ` *` or `:*` that is the only wildcard also matches the bare command. A command line is split into its simple commands. When any of them matches, a `deny` or `ask` fires. An `allow` needs every one to match. The wrappers that Claude Code strips are stripped. A `deny` or `ask` also skips a leading `NAME=value`.
- **Read, edit, write**: a path relative to the project root, in gitignore style. `*` stays in one folder, and `**` spans folders. A bare name matches at any depth. A pattern with a `/` matches from the root in an `allow`, and at any depth in a `deny` or `ask`. `edit` and `write` are one action. A `read` deny also blocks a change.
- **Web**: a host name. The pattern `*` also covers web search.
- **MCP**: `server`, `server/tool`, or `*`.
- **Subagent and skill**: a name, where `*` matches any text.

A pattern outside this language is `absent` in every engine and never written. Examples: an absolute path, `..`, `!`, `?` in a path, or a URL in a web rule.

Claude Code reads these languages natively, so most Claude Code results are `exact`.

## Tighten, then refuse

When an engine cannot carry a rule exactly:

- When the engine can block more, a `deny` or `ask` is tightened. The line is `translated` and names what it blocks extra.
- An `allow` is never widened. When the engine reads it more widely, the line is `absent` and nothing is written.
- A neutral `allow` never becomes a Codex `allow` rule. The line is `translated`, and it says nothing was written.
- A rule the engine has no place for is `absent`. `checkFidelity` refuses an enforced one unless a recorded approval exists.

| | Claude Code | Codex | OpenCode 1.x | Pi | DeepSeek Harness |
| --- | --- | --- | --- | --- | --- |
| Shell deny or ask | exact | translated to a literal prefix, or absent with no prefix | translated, ordered | absent | absent |
| Shell allow | exact | translated, not written | translated, or absent for a wider reading | absent | absent |
| Path rules | exact | translated to the sandbox filesystem table | translated | absent | absent |
| Web, skill, subagent | exact, or tightened | absent | translated or exact | absent | absent |
| MCP | exact, or tightened | translated to disabled tools | exact, or tightened | absent | absent |
| Sandbox | exact | exact | absent | absent | translated |

## Known escapes

Matching is on the command text, so some forms escape a rule. Every shell loss line lists the escapes of its engine. In every engine: `sudo`, `env`, `bash -c`, an absolute program path, and quoting. Codex and OpenCode also strip no wrapper and keep a leading `NAME=value`. For a `bash -lc` script of plain words, Codex splits the commands. For any other script, it does not. `escapesOf(engine, request)` names the escapes a request uses.

## For step 3

- The forms are in memory. The OpenCode form is ordered lists, so a pattern such as `"1"` keeps its place. Write the 1.x shape for 1.x.
- `privateBlocks` holds each entry's own block. Carry it unchanged.
- The DeepSeek Harness sandbox form names what the requirement asks for. The writer picks the mode for the pinned tag.
- The Codex filesystem table binds only commands that run in the sandbox.

## The rulesync oracle

`test/oracle.test.mjs` runs rulesync 43.2.0, a pinned dev dependency, on the same synthetic fixture. It runs in a child process. That process can write only inside a fresh temporary folder, and it cannot start a process or use the network. The test compares the decision of each engine for the same requests. Each difference must be on the section 11 list. The findings of 2026-10-28 that the list does not hold are kept apart in `FOUND_2026_10_28`. Until Hanna decides on them, the strict test is a TODO, and a pinned test fails on any new difference.
