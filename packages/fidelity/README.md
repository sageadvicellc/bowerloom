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

- **Shell**: Claude Code's Bash pattern. `*` matches any text. A trailing ` *` or `:*` that is the only wildcard also matches the bare command. A command line is split into its simple commands. When any of them matches, a `deny` or `ask` fires. An `allow` needs every one to match.
  - Runs of spaces and tabs count as one space.
  - The wrappers that Claude Code strips are stripped, and so are `command -p` and `xargs` with options before a literal program. A `deny` or `ask` also skips a leading `NAME=value`.
  - A deny or ask compares the program word in any letter case.
  - Some forms are not fully parsed. For these, the model never allows. When the program word of a deny or ask rule appears in the text, it asks. Otherwise the engine default applies. The forms:
    - a here-document, a comment, `$'...'`, `case`, a function, `eval`, `exec`, `trap`, or `coproc`;
    - a shell, `source`, or `.` as the program, with or without `-c`;
    - a program that runs another command, such as `sudo`, `env`, `busybox`, `ssh`, or `find -exec`;
    - a wrapper option outside the tables, `--`, or combined short flags;
    - a program word that is quoted, escaped, or built at run time;
    - for a deny or ask rule, a `$`, backtick, `{`, `*`, `?`, `[`, or `~` in the words the rule names.
  - A here-string (`<<<`) is one operator. `test/round3.test.mjs` checks the splitter against real bash with a seeded generator. When bash is missing, that test is skipped and says why.
- **Read, edit, write**: a path relative to the project root, in gitignore style. `*` stays in one folder, and `**` spans folders. A bare name matches at any depth. A pattern with a `/` matches from the root in an `allow`, and at any depth in a `deny` or `ask`. A `deny` or `ask` ignores letter case. `edit` and `write` are one action. A `read` deny also blocks a change.
  - A request path is resolved first: `//`, `./`, and `..`. When a path is absolute or leaves the project, it matches no rule. A deny or ask that could apply then makes the request ask.
- **Web**: a host name. The host contract applies to the pattern and the request alike: userinfo, a port, and a trailing dot are dropped, and letter case does not count. A `deny` or `ask` also covers subdomains. The pattern `*` also covers web search.
- **MCP**: `server`, `server/tool`, or `*`.
- **Subagent and skill**: a name, where `*` matches any text.

A pattern outside this language is `absent` in every engine and never written. Examples: an absolute path, `..`, `!`, `?` in a path, or a URL in a web rule.

## Tighten, then refuse

When an engine cannot carry a rule exactly:

- When the engine can block more, a `deny` or `ask` is tightened. The line is `translated` and names what it blocks extra.
- An `allow` is never widened. When the engine reads it more widely, the line is `absent` and nothing is written.
- A neutral `allow` never becomes a Codex `allow` rule. The line is `translated`, and it says nothing was written.
- When a listed escape covers common forms of the rule's own program, the line is `weakened`.
- A Claude Code deny or ask line cites the research-note vector that documents its form. A form with no documented vector is `weakened` until the live check of step 5.
- A sandbox requirement names no path or host, so it never makes a line `exact` or lifts a `weakened` one. The note names the sandbox that may cover the rule, and step 5 checks it.
- A rule the engine has no place for is `absent`. `checkFidelity` refuses an enforced one unless a recorded approval exists.

| | Claude Code | Codex | OpenCode 1.x | Pi | DeepSeek Harness |
| --- | --- | --- | --- | --- | --- |
| Shell deny or ask | translated | weakened; absent with no literal prefix | translated, spaces written as `*` | absent | absent |
| Shell allow | translated | translated, not written | translated, or absent for a wider reading | absent | absent |
| Path deny or ask | translated | read: translated; change: weakened | translated | absent | absent |
| Path allow | weakened, because `..` or letter case can reach past it | translated, not written | weakened, or absent for a wider reading | absent | absent |
| Web deny or ask | weakened: the trailing-dot form has no vector | absent | translated | absent | absent |
| Skill, subagent deny or ask | weakened: no vector | absent | exact | absent | absent |
| Skill, subagent allow | exact, or absent with a wildcard | absent | exact | absent | absent |
| MCP deny or ask | cites CC27; `mcp__*` weakened | translated to disabled tools | exact, or tightened | absent | absent |
| Sandbox | exact | exact | absent | absent | absent |

Each engine form also records its default for a request that no rule matches (`defaults`). For OpenCode, whose own default is allow, Bowerloom writes `"*": { "*": "ask" }` as the first key. Pi has no place for a default, so its default stays allow. The defaults of Claude Code and DeepSeek Harness stay recorded as `default`: the research notes do not say what their modes decide, and the live check of step 5 records them.

## Known escapes

Matching is on the text as written, so some forms escape a rule. `KNOWN_ESCAPES` lists each one, with the engines it applies to. Every shell loss line lists the shell escapes of its engine, and every path loss line the path escapes.

- In every engine: `sudo`, `env`, `bash -c`, an absolute program path, quoting, `find -exec`, and a flag before the subcommand.
- Claude Code, Codex, and OpenCode parse commands themselves, and Bowerloom does not model their parsers. A here-document, `eval`, `exec`, `coproc`, a pipe into a shell, a program name built at run time, a comment, `$'...'`, `case`, and a function are listed. The live check of step 5 confirms each engine.
- Codex and OpenCode strip no wrapper and keep a leading `NAME=value`. Codex splits a `bash -lc` script only when it holds plain words.
- In paths: other letter case, and `//`, `./`, or `..`.

`escapesOf(engine, request, rules)` names the escapes a request uses where the engine reads less than the model.

## For step 3

- The forms are in memory. The OpenCode form is ordered lists, so a pattern such as `"1"` keeps its place. Write the 1.x shape for 1.x.
- `privateBlocks` holds the block of each entry that wrote something. Carry it unchanged. `excludedPrivateBlocks` lists the blocks of entries that wrote nothing, with the reason.
- A Codex prefix rule takes its `justification` from the rule's `x-codex` block when that is one line of text with no control, format (Cf), line, or paragraph separator character (`codexJustification`), and the line says the text comes from the definition. Otherwise it names the rule, `Bowerloom guardrail <id>`.
- A DeepSeek Harness sandbox requirement is `absent`: at the pinned tag a mode covers file effects only, a session can switch it, and no patch row that sets it is confirmed.
- The Codex filesystem table binds only commands that run in the sandbox.
- Codex path rules and the Codex sandbox requirement are `weakened` (rulings B6 and R17). Live check g8 showed that the permission profile loads and that a literal deny entry at the project root blocks a read and leaves the file unchanged after a patch turn. No live check covered a glob entry, a read-only entry, or the network and write bounds of `:workspace`, and each line names what it lacks.

## The rulesync oracle

`test/oracle.test.mjs` runs rulesync 43.2.0, a pinned dev dependency, on the same synthetic fixture. The test compares the decision of each engine for the same requests.

These limits hold for the rulesync process:

- It runs under macOS `sandbox-exec` with a profile that denies all network. A probe test shows that a process under the same profile cannot reach a local server. When `sandbox-exec` is missing or cannot apply the profile, the oracle tests are skipped with that reason. rulesync never runs without it.
- Under the Node permission model, it can read only the rulesync package, `node_modules`, its fresh temporary folder, the Node binary and its own `lib` folder, and the preload. A probe under the same limits shows that a read outside them and a process start are both denied. It can write only inside the temporary folder, and it cannot start a process or a worker. HOME is inside the temporary folder.
- A preload also refuses Node's own network calls.

Each difference must be on the list in section 11, items 3 and 4, of the locked-in parts spec, or the strict test fails.

## MCP servers, subagents, and hooks (step 3)

`translateMcp`, `translateSubagents`, and `translateHooks` give the engine forms of the other locked-in parts, in memory,
with one loss line or more per entry. They write nothing; `packages/project-sync` writes the forms. Spec sections 5 to 7.

- **`${NAME:-x}`** and its like forms (`envDefaultIn`) give an `ENV_DEFAULT` problem and no form, in every engine.
- **MCP servers** are advisory. Claude Code and Pi are `exact`; Codex, OpenCode, and DeepSeek Harness are `translated`.
  `sse` and `ws` are `absent` outside Claude Code. A keychain reference is never written: the server is `absent`. Codex
  documents no expansion, so a reference becomes `env_vars`, `bearer_token_env_var`, or `env_http_headers`, or the
  server is `absent`. DeepSeek Harness rows follow the `dsh-mcp-client` README at the pinned tag.
- **`${NAME:-x}`** is scanned in MCP env, headers, command, args, and url, and in hook commands. Subagent text is not.
- **MCP fields** that do not fit the transport (headers on a command server, env on a URL server) get an `absent`
  field line and are never written. A string bound for `opencode.json` with `{env:` or `{file:`, and a DeepSeek Harness
  private block shaped like a `!!js` expression, are problems that refuse the server.
- **Subagents.** A tool limit is enforced. Claude Code carries it `exact` as `tools`. An empty limit writes no file in
  Claude Code or OpenCode. In OpenCode, `{env:` or `{file:` in the description, the model, or the private block refuses
  the subagent.
  OpenCode carries it as `deny` keys only (a `PermissionPairs` marker), including `codesearch`, `lsp`, `todowrite`, and
  `todoread`, and is `weakened`, because a deny list cannot cover tools added later. An OpenCode agent's `mode` comes
  from its `x-opencode` block when that names `primary`, `subagent`, or `all`; otherwise it is `subagent`. Codex is
  `weakened`: an override
  adds the limit as advisory text. Pi and DeepSeek Harness are `absent`.
- **Hooks.** The matcher is Claude Code tool names joined by `|`; any other character is `absent` everywhere. Claude
  Code is `exact`, but a tool-event matcher that names no Claude Code tool is `absent` and writes no hook, and one that
  names some unknown tools writes the known ones and is `weakened`. Codex is `translated` when advisory and `weakened` when enforced. OpenCode is a generated plugin for
  tool before and after, session start, and compaction: `translated` when advisory, `weakened` when enforced, because
  the plugin fails open. Pi and DeepSeek Harness are `absent`.
