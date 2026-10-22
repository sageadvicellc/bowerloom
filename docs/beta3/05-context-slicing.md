# Spec 05: context slicing

## 1. Header

- Source issue: sageadvicellc/bowerloom#86, https://github.com/sageadvicellc/bowerloom/issues/86. Hanna set the scope and the decisions on 2026-10-22, in a chat session. The issue records them.
- Binding decisions, as the issue words them:
  - Decision 1, delivery: "Apply writes one generated skill per slice, `.claude/skills/slice-<id>/SKILL.md`, which lists paths and titles. An agent preloads it through its existing `skills` key and reads files where they are. A page edit is live at once. Only titles are copied."
  - Decision 2, roots outside the project: "A slice can name a root outside its layer, such as the knowledge base, through a named root registered in the store (spec 03). This builds after the store foundation."
  - Decision 3, read guard: "`bowerloom context guard`, added as a per-agent `PreToolUse` hook, blocks Read, Grep, and Glob outside the agent's slices. It needs workspace trust. Shell access stays a documented gap, and the plan notes it."
  - Decision 4, create command: "Add `bowerloom slice create <id>`, with a plan, like `skill create`. `bowerloom context show` previews what a slice selects."
- Defaults that the issue records, and that bind this spec until Hanna overrides one:
  - An agent names a slice with `skills: slice-<id>`. There is no new frontmatter key.
  - An agent with slices and without `omitClaudeMd: true` gets a plan note.
  - An agent that names an unknown `slice-` skill gets a warning, not a refusal.
  - Codex: Claude Code only in beta.3. Spec 01b covers Codex.
  - Plan format: slices join the unreleased `v1beta2` apply plan format of spec 01a. Beta.3 bumps the format once.
  - Token estimate: bytes divided by 4, with an assumed band of 3.0 to 4.5 bytes per token, labelled not calibrated. `--bytes-per-token` calibrates it. Ratios against the baseline come from exact bytes.
  - Index summaries: the first heading of each file.
  - The plan binds the rendered index and the member paths, not the hash of each file body. A page edit does not make an approved plan stale.
  - The baseline of the measure is every non-hidden `.md` file under the deepest common folder of the slice roots.
- Lane: 1, after spec 01a. The README lane list (`docs/beta3/README.md:27`) puts this spec after 01a.
- Branch: `beta3/05-context-slicing`, from `release/0.7.0-beta.3`.
- Dependencies:
  - Spec 01a for everything. This spec extends its agent item, its `claudeCopyBytes` function, its `parseAgent` function, and its `v1beta2` plan format.
  - Spec 03 and spec 04 for named roots only. Part B of this spec (section 11) uses `inspectStoreWith`, `openStoreWith`, `verifyStorePins`, and `pathInsideStore` from spec 03 (03 section 6), and `withStoreForWrite` from spec 04 (04 section 6). Part A needs neither spec.
- Files that other specs also change. The builder resolves merge conflicts there: `packages/managed-skills/src/v2-observed.ts`, `packages/project-sync/src/apply-project.ts`, `packages/project-sync/src/agents.ts` (from 01a), `packages/managed-skills/src/agent-copy.ts` (from 01a), `apps/cli/src/ls.ts` (spec 04), `apps/cli/src/main.ts` and `apps/cli/src/human.ts` (every spec), and `apps/docs/src/content/docs/releases.md`.
- Line numbers below were checked against the `release/0.7.0-beta.3` tree at commit d2613ba, whose code equals 0.7.0-beta.2. Spec 01a moves some of them. If a line moved, find the place by its function name. A place that 01a creates is named by its 01a section.

Terms used below. Each term keeps one meaning in this spec.

- A **layer** is a folder that holds `.bowerloom/`. A **project** is the layer that holds the working folder, found as `discoverProject` finds it (`packages/project-context/src/discovery.ts:147`).
- A **slice** is a named selection of files from one folder. Its definition is the file `.bowerloom/slices/<id>.yaml`.
- A **root** is the one folder a slice selects from. A **project root** is a folder inside the project. A **named root** is a folder outside the project that `bowerloom root add` registered in the store.
- The **store** is the folder `~/.bowerloom` of spec 03.
- A **member** is one file that a slice selects.
- The **index skill** is the file `.claude/skills/slice-<id>/SKILL.md` that apply writes for a slice. It lists the members. It holds no member text except one title line per member.
- A **covered folder** is a folder under the root whose every file is a member. Section 3.5 defines it exactly.
- The **guard** is the command `bowerloom context guard`. Apply adds it to an agent copy as a `PreToolUse` hook.
- A **guarded area** is the root of a slice whose `guard` key is `root`, for an agent that names that slice.
- A **hold** is a reported reason that one item is not applied. The rest of the plan still applies. A **refusal** stops the whole plan, and nothing is written.
- The **plan revision** is the 64-character hash that binds every input of a plan. Approval names it.
- The **baseline** is the same agent loaded at start with every `.md` file of the baseline folder.
- A **subagent** is an agent that Claude Code starts for one task, from `.claude/agents/<name>.md`.

## 2. Problem

Today an agent learns about a knowledge base in two ways. It loads the always-on files at start, which are CLAUDE.md or AGENTS.md and their imports. Then it reads whatever it decides to read. Nothing limits an agent to the part of the knowledge base that its role needs. Nothing measures what each agent loads.

Hanna's words in the issue: "Strapping all agents with our knowledge-base is a bad idea for both large scale companies and refinement of harnesses. Let's make sure beta.3 includes the ability to slice context without duplicating storage of it. We'll want to ensure a technically sound solution and measure our context usage per agent against a larger agent strapped with our entire knowledge-base."

Facts from the Sage Advice workbench, counted by hand with `wc -c` on 2026-10-22. They are examples, not tool output:

- The knowledge base holds 696 non-hidden `.md` files with 11,301,404 bytes. That is about 2.85 million tokens at 4 bytes per token. No context window holds it, so a full load is a ceiling, not a runnable agent.
- The research-lead agent starts at about 89,943 bytes, about 22.5k tokens. That is its body (3,569 bytes), two AGENTS.md files (61,041 bytes), and two preloaded skills (25,333 bytes).
- Claude Code finds project agents only by walking up from where it starts (code.claude.com/docs/en/sub-agents, "Choose the subagent scope", fetched 2026-10-22). A session started at the workbench root does not see the knowledge-base layer's agents, unless it passes `--add-dir knowledge-base`.

Verified Claude Code facts this spec relies on. Each was read on 2026-10-22 at code.claude.com/docs/en/<page>:

1. sub-agents: the `skills` key preloads "the full skill content", "up to the first 32 distinct names in the list". A skill with `disable-model-invocation: true` cannot be preloaded.
2. sub-agents: a subagent loads every level of the CLAUDE.md files, including AGENTS.md, unless `omitClaudeMd: true` is set. With `omitClaudeMd`, a subfolder's CLAUDE.md and path-scoped rules still load when the subagent works with files there.
3. sub-agents: frontmatter hooks of a project subagent run only after the person accepts the workspace trust dialog for the folder that holds the agent file. A `-p` session does not count as trusted.
4. hooks: a `PreToolUse` hook receives JSON on stdin with `cwd`, `tool_name`, and `tool_input`. For Read, `tool_input.file_path` is always absolute. Grep takes an optional `path` and `glob`. Glob takes `pattern` and an optional `path`.
5. hooks: a hook that prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` and exits 0 blocks the call, and Claude sees the reason. Exit 2 also blocks. A hook with `onFailure: "block"` blocks the call when it cannot start, fails, or times out. That field needs Claude Code 2.1.295 or later.
6. hooks: exec form (`command` plus `args`) runs the program from `PATH` with no shell. `${CLAUDE_PROJECT_DIR}` is substituted into `args` and exported as an environment variable.
7. hooks: matcher `Read|Grep|Glob` matches those three tool names exactly.
8. permissions: `Read` deny rules in settings apply to the whole session. A Bash command that reads files without naming them is not covered. `disallowedTools` with a specifier removes the whole tool.
9. skills: `user-invocable: false` hides a skill from the `/` menu. Claude can still use it.
10. permissions: files outside the working folders may need approval, unless the folder is added with `--add-dir` or `permissions.additionalDirectories`.

## 3. Behavior

### 3.1 What a slice does, end to end

1. A person or agent runs `bowerloom slice create <id>`. It writes `.bowerloom/slices/<id>.yaml` from a template and registers it in `.bowerloom/authoring/receipt.json`.
2. The person edits the file: the root, the path patterns, the frontmatter filter, the links, and the guard mode.
3. The person adds `slice-<id>` to the `skills` list of an agent file, `.bowerloom/teams/<team>/agents/<role>.md`.
4. `bowerloom apply` plans one managed item per slice. After approval, it writes the index skill and a catalog record. It also writes the agent copy of spec 01a, with a guard hook when a slice of that agent has `guard: root`.
5. Claude Code starts the agent. The agent loads the index skill at start and reads members where they are.
6. Before each Read, Grep, and Glob of that agent, Claude Code runs the guard. The guard blocks a call that reaches a file under a guarded area when no slice of the agent lists that file.
7. `bowerloom context measure` reports what each agent loads at start and on demand, and compares it with the baseline.

Apply never copies member text. It never removes a copy. It never fetches. It starts no process.

### 3.2 `bowerloom slice create`

Usage, verbatim:

```
bowerloom slice create <name> [--root <folder>] [--named-root <root>] [--include <pattern>]... [--approve <revision>] [--json]
```

Flags:

- `<name>` is the slice id. It matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` and has at most 57 characters. Otherwise the command refuses `SLICE_NAME_INVALID`.
- `--root <folder>`: the folder that the patterns start from. Without `--named-root`, it is a folder inside the project, relative to the project folder. With `--named-root`, it is a folder inside the named root. The default is `.`. The value follows the root path rules of section 4.1. A bad value refuses `USAGE`.
- `--named-root <root>`: the name of a root that `bowerloom root add` registered. This flag works only after Part B lands. In Part A it refuses `USAGE` with the text `--named-root needs bowerloom root add, which this build does not have yet.` In Part B, a name that the store does not hold refuses `ROOT_NOT_FOUND`.
- `--include <pattern>`: one path pattern of section 4.2. Repeat it up to 64 times. The default is the one pattern `**/*.md`. A bad pattern refuses `USAGE`.
- `--approve <revision>` and `--json` work as for every create command (`apps/cli/src/create.ts:38-39`).
- Any flag given twice, other than `--include`, refuses `USAGE`. `--team` and `--global` refuse `USAGE`, because a slice belongs to its layer.

The usage error text is `Use bowerloom slice create <name> [--root <folder>] [--named-root <root>] [--include <pattern>]..., with optional --approve <revision> and --json.`

The command plans first. It reads only. It finds the project with `discoverProject`. Then:

1. If `.bowerloom-revision.json` exists, it refuses `REVISION_PENDING`, as `plan` does today (`packages/project-authoring/src/create.ts:183`).
2. It reads the authoring state and finishes or discards an interrupted create, exactly as today (`create.ts:185-196`).
3. If the receipt lists slice `<name>` and its file exists, it refuses `SLICE_EXISTS`.
4. If the receipt lists slice `<name>` and its file is gone, it refuses `AUTHORING_ITEM_MISSING`. The next step is `git restore .bowerloom/slices/<name>.yaml`.
5. If `.bowerloom/slices/<name>.yaml` exists and the receipt does not list it, the plan registers that file and keeps its bytes. The file must pass `parseSlice` (section 4.1). If it fails, the command refuses `SLICE_INVALID`, and the extra text names the key or the rule. With this path, `--root`, `--named-root`, and `--include` refuse `USAGE`, because the file already says them.
6. A name that differs from an existing file name only in case refuses `SLICE_EXISTS`.
7. Otherwise the plan writes the template of section 4.3.

Plan lines, verbatim. `<root line>` is `Root: <folder> in this project` for a project root, and `Root: <folder> in root <root> (~/<rel>)` for a named root. `<rel>` is the registered path. `<patterns>` joins the patterns with `, `.

New slice:

```
Create slice <name> in .bowerloom/slices/<name>.yaml
  <root line>
  Include: <patterns>
  Files: 1
After this, bowerloom apply puts the index skill slice-<name> in place. An agent loads it when its skills list names slice-<name>.
You and your agents own these files and can edit them.
This writes inside .bowerloom only. It starts no workers and runs nothing.
```

Existing unregistered file:

```
Register slice <name> from .bowerloom/slices/<name>.yaml, which is already there
  Its bytes stay as they are.
After this, bowerloom apply puts the index skill slice-<name> in place. An agent loads it when its skills list names slice-<name>.
You and your agents own these files and can edit them.
This writes inside .bowerloom only. It starts no workers and runs nothing.
```

The lines about scratch, settle, discard, and finish (`apps/cli/src/create.ts:59-62`) print before these lines, as for every create.

Write order, after approval, under the project lock (`apps/cli/src/create.ts:101-103`):

1. Plan again. Refuse `STALE_APPROVAL` if the revision differs.
2. Remove Bowerloom's own scratch, settle or discard a pending record, as `applyCreate` does today (`create.ts:274-372`).
3. New slice: create `.bowerloom/slices` with mode 0755 when it is absent. Write the pending record. Stage the file. Move it in place. Write the receipt. Remove the pending record.
4. Register path: check that the file still has the planned sha256 and size. Otherwise refuse `STALE_APPROVAL`. Write the receipt. No pending record is written, because no file moves.

Crash recovery is the create recovery of today. A crash after the move and before the receipt leaves a pending record whose file landed. The next `slice create <name>` plans `Finish slice <name> from an interrupted create.` A crash before the move leaves a pending record whose file is absent. The next create of any item plans `Clear the record of an interrupted create of slice <name>.`

Exit codes: 0 when the create finished, 3 when approval is required, 2 for a usage error. A refusal throws and prints its code, sentence, and next step.

### 3.3 Named roots: `bowerloom root add`, `root list`, `root remove` (Part B)

A named root lets a slice select from a folder outside its project, such as the workbench knowledge base for an agent of the `code` layer. The registration lives in the store at `~/.bowerloom/roots/<name>.json`. Its path is relative to the home folder, so a store that spec 07 syncs to another machine names the same place there.

Usage, verbatim:

```
bowerloom root add <name> <folder> [--approve <revision>] [--json]
bowerloom root list [--json]
bowerloom root remove <name> [--approve <revision>] [--json]
```

These commands work from any folder. They never look for a project. A usage error prints `Use bowerloom root add <name> <folder>, bowerloom root list, or bowerloom root remove <name>, with optional --approve <revision> and --json.`

`root add` checks, in this order. The first failure refuses.

1. `<name>` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` with at most 64 characters. Otherwise `ROOT_NAME_INVALID`.
2. The store passes the safety rules of spec 03 section 3.3, or is absent. A `foreign` store refuses `STORE_INVALID`. Another `STORE_*` refusal keeps its code.
3. `<folder>` resolves against the working folder. Its real path (`realpathSync`) must exist. Otherwise `ROOT_UNSAFE` with the extra text `The folder does not exist.`
4. The real path must be strictly below `realpath(home)`. Home itself and folders outside home refuse `ROOT_UNSAFE`.
5. `checkProjectPathWith(real, home)` (`packages/project-context/src/discovery.ts:115`) must pass. `PROJECT_IN_CLOUD_FOLDER` becomes `ROOT_IN_CLOUD_FOLDER`. Any other code becomes `ROOT_UNSAFE`.
6. Every folder from `realpath(home)` down to the root folder must be a real folder, not a link, owned by the user, with no group or world write. Otherwise `ROOT_UNSAFE`.
7. No path segment below home starts with `.`. Otherwise `ROOT_UNSAFE`.
8. The folder is not the store, not inside the store, and does not hold the store (`pathInsideStore`, spec 03 section 6). Otherwise `ROOT_UNSAFE`.
9. The path relative to `realpath(home)` has at most 1024 bytes. Otherwise `ROOT_UNSAFE`.
10. The store does not hold `roots/<name>.json` already. Otherwise `ROOT_EXISTS`. A name that differs only in case also refuses `ROOT_EXISTS`.

`root add` plan lines, verbatim:

```
Create the store at ~/.bowerloom (store.json). It holds definitions only.
Register root <name> in the store at ~/.bowerloom/roots/<name>.json
  Folder: ~/<rel>
  A slice names it with root: { named: <name> }. Bowerloom reads this folder and never writes it.
This writes the store only. It changes no project, and it installs nothing.
```

The first line prints only when the store is absent, as in spec 04 section 3.3.

The `root add` plan revision binds: the store pins (or its absence), the identity of `roots/` or its absence, the sorted list of names in `roots/`, the relative path, and the identity of the root folder (device, inode, and birth time).

`root add` write order, after approval:

1. Run `withStoreForWrite(home, signal, work)` from spec 04. It creates the store when needed and holds the store lock.
2. Inside `work`, plan again. Refuse `STALE_APPROVAL` if the revision differs.
3. Create `roots/` with mode 0700 when it is absent.
4. Remove any leftover temporary file whose name matches `^\.root-[a-z0-9-]{1,64}\.[a-f0-9]{16}\.tmp$`.
5. Write `.root-<name>.<16 hex>.tmp` with `O_CREAT | O_EXCL | O_NOFOLLOW`, mode 0644. Write the bytes of section 4.4. Flush it.
6. Link it to `roots/<name>.json`. If the link fails with `EEXIST`, refuse `STALE_APPROVAL`.
7. Remove the temporary name. Flush the folder.

A crash leaves at most a temporary file or a complete registration. Readers ignore temporary names. The next `root add` or `root remove` removes them.

`root list` reads only. It prints:

```
Roots in ~/.bowerloom/roots
  <name>  ~/<rel>  <state>
```

`<state>` is `ready`, `missing` (the folder is gone), or `refused (<CODE>)` (a check of `root add` fails, or the file is not valid). The names are padded to the longest name. Without registrations it prints `  none yet`. Without a store it prints `Roots: none yet. There is no store at ~/.bowerloom.` It exits 0 in every one of these states. `--json` prints format `bowerloom/root-list/v1beta1` with `roots: [{ name, path, state, code }]`, where `path` is `~/<rel>` and `code` is null unless `state` is `refused`.

`root remove` refuses `ROOT_NOT_FOUND` when the store or the registration is absent. Its plan lines, verbatim:

```
Remove root <name> from the store: ~/.bowerloom/roots/<name>.json
  Folder: ~/<rel>. The folder stays. Bowerloom never writes it.
  Slices that name this root are held with SLICE_ROOT_MISSING until the name is registered again.
This writes the store only. It changes no project.
```

Its revision binds the store pins and the sha256, size, and identity of the registration file. After approval, under `withStoreForWrite`, it plans again, checks the bytes, removes the file, and flushes the folder. A changed file refuses `STALE_APPROVAL`.

Exit codes for `root add` and `root remove`: 0 done, 3 approval required, 2 usage. `root list` exits 0 or 2.

### 3.4 How apply reads a root

For each registered slice, apply resolves the root before it walks.

Project root (`root` is a string):

1. The folder is `join(project.dir, root)`.
2. If it is absent, the slice is held with `SLICE_PATH_MISSING`.
3. Every folder from the project folder down to it must be a real folder, not a link, owned by the user, with no group or world write. Otherwise the slice is held with `SLICE_ROOT_UNSAFE`.

Named root (`root` is a map, section 4.1):

1. In Part A, a named root holds the slice with `SLICE_ROOT_MISSING` and the next step `This build has no named roots yet. Use a root inside the project.`
2. In Part B, the store must be a valid store (`inspectStoreWith`, spec 03). An absent store, or a registration that is absent, holds the slice with `SLICE_ROOT_MISSING`.
3. A registration that fails the rules of section 4.4, or a store that fails a safety rule, holds the slice with `SLICE_ROOT_UNSAFE`.
4. The folder is `join(realpath(home), rel, path)`. If it is absent, the hold is `SLICE_ROOT_MISSING`.
5. Checks 4 to 8 of `root add` (section 3.3) run again on this folder. A failure holds the slice with `SLICE_ROOT_UNSAFE`.
6. A named root folder inside the project folder holds the slice with `SLICE_ROOT_UNSAFE`. The next step says `Use root: <path relative to the project> instead.` A named root that holds the project is allowed.
7. The plan binds the folder's real path, its identity (device, inode, birth time), and the registration file's sha256.

### 3.5 How a slice selects files

`resolveSlice(def, reader)` is a pure function of the definition and a read-only view of the tree. It returns the members, the covered folders, the notes, the holds, and the rendered index. The same function runs at plan time and inside the managed planner, so the two runs agree or the run refuses.

1. **Walk.** The walk starts at the root. It visits names in byte order. It never enters or matches an entry whose name starts with `.`, so `.bowerloom`, `.claude`, `.git`, and `.obsidian` are never members. It enters a folder only when some `include` pattern can match below it (`canMatchBelow`). When `links` is set, it lists every non-hidden folder under the root once, to build the stem index of step 6. Limits: 8192 entries, 16 levels below the root, and 1024 names per folder (`names`, `packages/managed-skills/src/observed.ts:56`). Over a limit, the slice is held with `SLICE_TOO_LARGE`.
2. **Guards.** Every folder the walk enters, and every member, must be a real entry, not a link, owned by the user, with no group or world write. A member must have one hard link. The read rules of `authored` (`packages/managed-skills/src/local-source.ts:23-32`) apply to member files. A failure holds the slice with `SLICE_SOURCE_UNSAFE`, and the next step names the path.
3. **Include, then exclude.** A path is a candidate when an `include` pattern matches it and no `exclude` pattern matches it. Patterns follow section 4.2. A pattern with no wildcard is a **literal**. A literal that matches no file holds the slice with `SLICE_PATH_MISSING`, and the next step names the literal. A pattern with a wildcard that matches nothing gives a note.
4. **Text only.** A candidate must decode as UTF-8 with `new TextDecoder('utf-8', { fatal: true })`. Its path must hold no backtick, line break, or control character, and have at most 512 bytes. A candidate that fails is left out, with a note that counts it.
5. **Frontmatter filter.** When `where` is set, a `.md` candidate must start with a `---` line and a closing `---` line, as 01a section 4.1 defines. The block parses with `parseDocument(block, { uniqueKeys: true })` and `toJS({ maxAliasCount: 0 })` and must give a map. Every key of `where` must match (AND). A key matches when the frontmatter value, as `String(value)` for a string, number, or boolean, equals one of the listed strings (OR). A frontmatter list matches when any element matches. A missing key does not match. A file whose frontmatter does not parse, or that has none, does not match, and the plan names it in a note. A candidate that is not `.md` never matches a `where` filter.
6. **Links.** When `links` is set, each member that is a `.md` file is scanned outside fenced code blocks and inline code spans. The forms are `[[target]]`, `[[target|alias]]`, `[[target#heading]]`, `![[target]]`, and `[text](relative/path.md#anchor)`. A wikilink target that holds `/` is a path relative to the root, with `.md` added when it has no extension. A wikilink target without `/` is a stem. It resolves when exactly one non-hidden `.md` file under the root has that stem, compared after NFC normalization and case folding. More than one match is ambiguous. No match is unresolved. A markdown link resolves relative to the linking file. It must have no scheme, must not start with `/` or `#`, and must stay under the root. Its `#` and `?` parts are dropped, and it is percent-decoded. A linked file must pass `exclude`, the text rule of step 4, and `where`. Depth 1 adds the files linked from included files. Depth 2 adds the files linked from those. The search runs breadth first, in byte order. Ambiguous and unresolved links are counted in notes.
7. **Bounds.** A member over 1 MiB is listed with no summary, and its links are not followed. It gets a note. The walk reads at most 32 MiB of member text. More than `maxFiles` members, more than 32 MiB read, or a rendered index over 65536 bytes (`LIMITS.file`, `observed.ts:14`, enforced at `packages/managed-skills/src/v2-observed.ts:121`) holds the slice with `SLICE_TOO_LARGE`. Zero members hold it with `SLICE_EMPTY`.
8. **Summaries.** `summary: heading` takes the first line that starts with `# ` after the frontmatter, within the first 64 lines. `summary: frontmatter:<key>` takes that key's string value. `summary: none` takes nothing. The text loses control and format characters, its white space collapses to single spaces, and it is cut at 160 characters. An empty result means no summary.
9. **Covered folders.** A folder under the root, or the root itself, is covered when all of these hold: the walk entered it and every folder below it, it holds at least one member, every regular file below it is a member, and it holds no hidden entry and no link. Covered folders let the guard allow a search of a whole folder.
10. **Consistent reads.** The reader pins every folder and file it reads and checks them again at the end, as `closing` does (`local-source.ts:34-36`). A change during the read refuses the plan with `STALE_APPROVAL` and the extra text `A file of slice <id> changed while Bowerloom read it. Run bowerloom apply again.`

### 3.6 The index skill

Apply writes `.claude/skills/slice-<id>/SKILL.md`, the bytes of `renderSliceIndex`, exactly as section 4.5 shows. It writes nothing else under `.claude/skills/slice-<id>/`.

Why this is not a second store of the knowledge base:

- The index holds paths and at most one 160-character title per member. With `summary: none` it holds paths only.
- The catalog record holds the member paths and the covered folders, never member text.
- The private receipt holds the hash of the index and of the catalog, as for every managed item.
- The members stay where they are. An agent reads them in place, so a page edit is live at once.

`bowerloom context measure` prints the index bytes as a share of the member bytes, so the copied titles stay visible.

### 3.7 `bowerloom apply` with slices

Apply plans slices whenever the harness list includes `claude`. Slice items are Claude Code only in beta.3. Their harness list is always `['claude']`.

#### 3.7.1 Check order

Apply runs these checks after the agent checks of 01a section 3.6. The first refusal wins. Holds are collected.

1. Listing. `.bowerloom/slices` absent means no slices. If it exists, it must pass `realFolder` and `folderNames` (`packages/project-authoring/src/files.ts:22,28`). A failure refuses the whole plan with `AUTHORING_UNSAFE_PATH`.
2. `SLICE_LIMIT`: more than 64 registered slices refuses the whole plan.
3. Per registered slice, in id byte order:
   1. The file is gone: hold `AUTHORING_ITEM_MISSING`, with the next step `.bowerloom/slices/<id>.yaml is gone. Restore it from version control, then run bowerloom apply.`
   2. The file fails `parseSlice`: hold `SLICE_INVALID` or `SLICE_KEY_UNKNOWN`.
   3. The root fails section 3.4: hold `SLICE_PATH_MISSING`, `SLICE_ROOT_MISSING`, or `SLICE_ROOT_UNSAFE`.
   4. The selection fails section 3.5: hold `SLICE_SOURCE_UNSAFE`, `SLICE_PATH_MISSING`, `SLICE_EMPTY`, or `SLICE_TOO_LARGE`.
   5. The target and the managed state: hold `SLICE_TARGET_OCCUPIED`, `MANAGED_SKILL_LOCAL_DRIFT`, `MANAGED_SKILL_RECOVERY_REQUIRED`, `MANAGED_SKILL_HISTORY_FULL`, or `SKILLS_STATE_STRAY_ENTRY`, as `classifyPrompt` does (`packages/project-sync/src/prompts.ts:135-170`).
4. A file in `.bowerloom/slices` that the receipt does not list is skipped, and gets a note.
5. Orphans: a catalog `slice_<id>.json` whose slice the receipt does not list is `kept`.
6. Agents. For each planned agent, apply reads its `skills` list (01a section 4.1) and fills its context fields (section 4.7). It decides the guard and computes the agent copy (section 3.8).

`--team <t>` plans only the slices that team `t`'s agents name. The orphan scan uses every slice, so a filter never shows a slice as kept. Without `--team`, every registered slice is planned.

#### 3.7.2 States

- `install` (state `new`): no catalog record exists and `.claude/skills/slice-<id>` does not exist.
- `update` (state `edited`): a catalog record exists, and the index bytes, the member list, the covered list, the root, or the guard mode differ from the record.
- `up to date`: a catalog record exists and nothing differs.
- `kept` (state `orphaned`): a catalog record exists and the receipt does not list the slice. The copy and the catalog stay.
- `held`: a hold of section 3.7.1. A hold of an installed slice keeps its index and catalog as they are.

A target folder that exists without a catalog record holds the slice with `SLICE_TARGET_OCCUPIED`. Apply never adopts a slice index, because only Bowerloom writes one.

#### 3.7.3 Plan lines, verbatim

`<id>` is `id.padEnd(width)`. `width` is the longest id in the plan plus one (`apps/cli/src/apply.ts:66`), and slice ids count toward it. `<pad>` is `''.padEnd(width)`.

The title line (`apps/cli/src/apply.ts:69`) becomes the following when the harness list includes `claude`. It replaces the 01a title.

```
Apply skills, prompts, agents, and context slices for <harnesses>, team <team>
```

The `, team <team>` part appears only when a team is given. Under `--harness codex` the title stays as today.

The empty-plan text (`apps/cli/src/apply.ts:70`) under `claude` becomes:

```
  Nothing in .bowerloom/skills.json, .bowerloom/prompts, .bowerloom/teams/*/agents, or .bowerloom/slices to apply yet.
```

Slice lines come after the prompt lines and before the agent lines:

```
  <id> install slice: .claude/skills/slice-<id>/SKILL.md (<n> files from <where>)
  <id> update slice: .claude/skills/slice-<id>/SKILL.md (<changes>)
  <id> slice up to date
  <id> slice kept: no longer a slice of this project, and apply removes nothing
  <id> slice held (<code>)
  <pad> Next: <next step>
```

- `<where>` is `the project folder` for root `.`, `<root>` for another project root, and `root <name> (<display>)` for a named root. `<display>` is the root path relative to the project folder, such as `../knowledge-base/wiki`.
- `<changes>` is `<a> added, <g> gone, <s> summaries changed`, then `, root changed` when the root differs, then `, guard changed` when the guard mode differs.

Slice notes follow their slice line, only for `install` and `update`, in this order. `<list>` names up to three paths joined with `, ` and a final ` and `, then `, and <k> more` when more exist.

```
  Note: slice <id> left out <n> files whose frontmatter does not parse: <list>.
  Note: slice <id> has <u> links that point to no file and <m> links that point to more than one file.
  Note: slice <id>: the pattern <pattern> matches no file.
  Note: slice <id> left out <n> files that are not UTF-8 text or have unusual names.
  Note: slice <id> lists <n> files over 1 MiB without a summary.
  Note: slice <id> reads <display>, outside this project. Claude Code may ask before it reads there. Start Claude Code with --add-dir <display>, or add the folder to permissions.additionalDirectories.
  Note: slice <id> guards the whole project folder. An agent that names it reads only the slice's files there with Read, Grep, and Glob.
```

A line prints only when its count is above zero or its case applies. The unregistered-file note prints once per file, after all slice lines:

```
  Note: .bowerloom/slices/<file> is not registered, so apply skips it. Run bowerloom slice create <stem> to register it.
```

Agent lines (01a section 3.2) gain these lines. They print after the 01a warning and before the 01a notice, for every agent state except `kept` and `held`:

```
  <pad> Warning: agent <role> names slice-<x>, and no slice <x> is registered. Claude Code skips a preloaded skill it cannot find.
  <pad> Warning: slice-<x> is skill <n> in the skills list of agent <role>. Claude Code preloads the first 32 only.
```

These notes print after the 01a notice, only for the actions `install`, `update`, and `adopt`:

```
  Note: agent <role> names slices and also loads the CLAUDE.md or AGENTS.md files at start. Set omitClaudeMd: true to start it with its slices only. bowerloom context measure shows the difference.
  Note: agent <role> gets the Bowerloom read guard for slices <ids>. Claude Code runs it only in a folder you trusted, never in a claude -p run, and only when bowerloom is on your PATH. It needs Claude Code 2.1.295 or later.
  Note: agent <role> can still read files with <ways>. The guard checks Read, Grep, and Glob only.
```

- The first note prints when the agent names at least one registered slice and `omitClaudeMd` is not `true`.
- The second note prints when the agent copy holds the guard. `<ids>` joins the guarded slice ids with `, ` and a final ` and `.
- The third note prints when the copy holds the guard and `<ways>` is not empty. `<ways>` lists, in this order: `shell tools` (when `tools` is absent or names `Bash`, `PowerShell`, or `Monitor`), `LSP` (when `tools` is absent or names `LSP`), and `nested agents` (when `tools` is absent or names `Agent`). It joins them with `, ` and a final ` and `.

The Codex line of 01a section 3.2 becomes this line when the harness list includes `codex` and at least one agent file or registered slice exists:

```
Codex agents and context slices are not projected in this beta. See the capability model design.
```

The pointer text (`packages/project-sync/src/apply-project.ts:44-58`) adds one sentence for the Claude harness, after the 01a agents sentence: ` Context slices are skills named slice-<name> in .claude/skills.`

Result words (`apps/cli/src/apply.ts:77-85`): kind `slice` prints `slice <id>`. The lines are `  slice <id>: installed`, `  slice <id>: updated`, `  slice <id>: held (<code>). Next: <next>`, and `kept, no longer listed: slice <id>`.

#### 3.7.4 Write order and crash recovery

Apply keeps the order of 01a section 3.7, with slices before agents:

1. Plan under the project lock. Refuse `STALE_APPROVAL` if the revision differs.
2. Create the private folders.
3. Phase B for skills, then prompts, then slices, then agents. Slices and agents are each sorted by id in byte order. No project write happens in phase B.
4. Phase C, `applyChildren`, runs each child in the same order. Each slice child is one managed transaction. It stages the index folder and the catalog, renames them in, and commits the receipt last.
5. Slices come before agents, so an agent copy with a guard never lands before the catalogs it reads.
6. Interrupt: the signal is read between children, never inside one. The message is `SKILLS_SYNC_INTERRUPTED` with `bowerloom apply` as the rerun command.
7. Crash inside a transaction: `.bowerloom/managed-pending.json` stays. The next plan refuses with `MANAGED_SKILL_RECOVERY_REQUIRED` and the next step `bowerloom skills recover plan --item slice_<id>`. Recovery resumes, abandons, or rolls back that one slice.

An agent child that lands while a slice child before it was held or interrupted still holds the guard. The guard then blocks reads under that slice's root, as section 3.9 says, until apply finishes. This fails closed.

### 3.8 How an agent names slices, and the guard in its copy

An agent names slice `<x>` by the entry `slice-<x>` in the `skills` list of its source file. Apply sorts the entries of each agent:

- `slice-<x>` is a **slice entry** when the receipt registers slice `<x>`.
- `slice-<x>` is a **plain skill** when no slice `<x>` is registered and the project has a local skill or a `skills.json` entry with the id `slice-<x>`.
- Otherwise `slice-<x>` is **unknown**. The plan prints the warning of section 3.7.3.

The guard list of an agent is every slice entry whose definition does not parse to `guard: none`. A slice whose file is held for `SLICE_INVALID` still counts, so a broken definition fails closed. The agent copy holds the guard when its guard list is not empty.

`claudeCopyBytes` of 01a (01a section 4.4) changes its signature to `claudeCopyBytes(source, extras)`, where `extras` is `{ guard: { role, slices } | null }`. `slices` is the sorted list of every slice entry of the agent, guarded or not. The guard reads all of them, because a member of an unguarded slice is still a member.

- With `guard: null`, the function returns `source`. That is the 01a behavior.
- Otherwise it splits the source at the frontmatter fences as `parseAgent` does. It parses the block with `parseDocument(block, { uniqueKeys: true })` from `yaml` 2.9.1, the version that `package-lock.json` pins. It takes the map `hooks`, or adds it at the end. Under it, it takes the sequence `PreToolUse`, or adds it at the end. It appends the guard entry of section 4.6 to that sequence. The new block is `doc.toString({ lineWidth: 0 })`. The output is the first fence line of the source, the new block, the closing fence line of the source, and every byte after it, unchanged.
- When `hooks` exists and is not a map, or `PreToolUse` exists and is not a sequence, the agent is held with `AGENT_GUARD_CONFLICT`. Nothing about it is written.

`adopt`, `AGENT_TARGET_OCCUPIED`, and drift compare against this output, as 01a requires. A change of the guard list changes the copy bytes, so the agent plans `update`.

The agent request source of 01a section 4.4 gains the key `guard`. It is the sorted list of slice ids passed to `claudeCopyBytes`, or `null`. Its key list becomes `['kind', 'team', 'name', 'guard']`. `readLocalAgent` passes it to `claudeCopyBytes`, so the plan and the managed planner compute the same bytes.

Spec 01b later adds a generated `disallowedTools` list through the same function. The order is fixed: the 01b changes first, then the guard entry.

### 3.9 `bowerloom context guard`

Claude Code runs this command. A person can run its `--explain` form.

Usage, verbatim:

```
bowerloom context guard --agent <role> --project <folder> --slice <id> [--slice <id>]...
bowerloom context guard --agent <role> --explain <path> [--tool Read|Grep|Glob] [--slice <id>]...
```

#### 3.9.1 Hook form

The hook form reads the hook input from stdin and decides. It never prints `allow`. It only blocks or stays silent. So it can never approve a call that Claude Code would ask about or block.

1. **Input.** Read stdin to the end, at most 1 MiB, for at most 5 seconds. Parse it with `strictJson`. It must be an object with a string `tool_name`, an object `tool_input`, and an absolute string `cwd`. Otherwise write `Bowerloom guard: the hook input could not be read, so the call is blocked.` to stderr and exit 2. Claude Code shows that text as the reason (`GUARD_INPUT_INVALID`).
2. **Tool.** A `tool_name` other than `Read`, `Grep`, or `Glob` gets no output and exit 0.
3. **Target.**
   - Read: `tool_input.file_path`, which must be an absolute string.
   - Grep: `tool_input.path` when it is a string, else `cwd`. A relative value resolves against `cwd`.
   - Glob: `tool_input.path` when it is a string, else `cwd`. If `tool_input.pattern` is absolute or has a `..` segment, the target becomes the pattern's fixed prefix (the segments before the first `*`, `?`, `[`, or `{`), resolved against the path.
   - Any other shape is `GUARD_INPUT_INVALID`, as in step 1.
4. **Project.** Take `--project`. If its value is the literal text `${CLAUDE_PROJECT_DIR}`, take the environment variable `CLAUDE_PROJECT_DIR`. If that is empty, take `cwd`. Run `discoverProject`. If the project's catalog does not hold `agent_<role>`, deny with `GUARD_PROJECT_MISMATCH`.
5. **Slices.** For each `--slice` id, read the catalog `slice_<id>.json` through `currentV2` (`packages/managed-skills/src/v2-observed.ts:164-173`), with the private state folder of the project. This checks the catalog against its committed receipt. If any slice is absent, not committed, or drifted, deny every call with `GUARD_SLICE_NOT_INSTALLED`, whatever the target.
6. **Roots.** Resolve each slice root from its catalog source (section 4.8). A project root is `join(project.dir, path)`. A named root resolves through the store as section 3.4 says. A root that does not resolve to a real folder denies every call with `GUARD_ROOT_MISSING`.
7. **Classify.** Compare by device and inode, never by path text. That way a link, a case alias, or a relative spelling cannot slip past.
   - The target is **inside** a guarded area when the target or one of its existing parent folders has the identity of a guarded root.
   - The target **holds** a guarded area when a guarded root or one of its parent folders has the identity of the target folder.
   - A member's identity is the `lstat` identity of `root + member path`. A covered folder's identity is that of `root + folder path`.
8. **Decide.**
   - Read inside an area: silent when the target has the identity of a member of a listed slice with that root. Otherwise deny with `GUARD_OUTSIDE_SLICE`.
   - Grep or Glob inside an area: silent when the target has the identity of a member or of a covered folder of a listed slice with that root. Otherwise deny with `GUARD_OUTSIDE_SLICE`.
   - Grep or Glob whose target holds an area: deny with `GUARD_OUTSIDE_SLICE`.
   - Anything else: silent.
9. **Output.** A deny prints one line and exits 0:

```
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}
```

Silence prints nothing and exits 0. Every internal error after step 1 is a deny with the reason of its code. A crash, a timeout, or a missing `bowerloom` blocks the call through `onFailure: "block"`.

Reasons, verbatim. Paths pass through `plainText` (`apps/cli/src/human.ts:217`). `<ids>` joins the listed slice ids with `, `.

- `GUARD_OUTSIDE_SLICE`, Read: `Bowerloom guard: <path> is under <root display>, and no context slice of agent <role> (<ids>) lists it. Read the files that your slice skills list. To widen a slice, ask the main session to edit .bowerloom/slices/<id>.yaml and run bowerloom apply.`
- `GUARD_OUTSIDE_SLICE`, Grep or Glob: `Bowerloom guard: a search of <path> would reach files that no context slice of agent <role> (<ids>) lists. Search one listed file, or a folder whose files are all listed: <folders>.` `<folders>` names up to five covered folders, or says `none` when there are none.
- `GUARD_SLICE_NOT_INSTALLED`: `Bowerloom guard: slice <id> of agent <role> is not installed, or its copy changed. Every read, search, and file listing of this agent is blocked. Run bowerloom apply in <project>.`
- `GUARD_ROOT_MISSING`: `Bowerloom guard: the folder of slice <id> cannot be found, so every read, search, and file listing of agent <role> is blocked. Run bowerloom apply in <project> to see why.`
- `GUARD_PROJECT_MISMATCH`: `Bowerloom guard: the project at <project> does not manage agent <role>. Start Claude Code inside the project that holds .claude/agents/<role>.md.`

#### 3.9.2 Explain form

`--explain <path>` decides for one path without stdin. `--tool` defaults to `Read`. The project is found from the working folder. Without `--slice`, the slices are the slice entries of agent `<role>` in the current apply plan. A role that the plan does not hold refuses `CONTEXT_AGENT_NOT_FOUND`. It prints one line and exits 0:

```
allowed: no guard rule applies to <path>
allowed: <path> is in slice <id>
denied (<CODE>): <reason>
```

#### 3.9.3 Performance

The guard runs before every Read, Grep, and Glob of a guarded agent, so it must be fast.

- It reads the project discovery, one catalog and its receipts per slice, at most one store registration per named root, and at most 64 `stat` calls per parent chain. It walks no tree. The covered folders come precomputed from apply.
- Target: 300 ms or less at the 95th percentile on the reference machine (Apple silicon, Node 24), for a project with four slices of 200 members each. The CLI test checks that each of 20 calls finishes within 2000 ms and prints the 50th and 95th percentile for the pull request.
- If the 95th percentile is above 300 ms, move the static imports of `apps/cli/src/main.ts:8-12` into the branches that use them. Then measure again. Section 12 item 8 holds the check.

#### 3.9.4 What the guard does not cover

The guard limits the context that Read, Grep, and Glob reach. It is not a security boundary. These ways stay open, and the docs say so:

1. Shell tools (`Bash`, `PowerShell`, `Monitor`) read any file. The plan notes them.
2. `LSP` reads code symbols. The plan notes it.
3. A nested subagent that the agent starts is not guarded, unless it has a guard of its own. The plan notes `Agent`.
4. An untrusted folder, and every `claude -p` run, skip the hook. The plan notes it.
5. An agent with `Edit` or `Write` can edit its own copy or the managed catalogs. The guard checks a catalog against its receipt, so a casual edit fails closed. A determined edit of the private receipts is not stopped.
6. A file that the agent writes under a guarded area cannot be read back unless a slice lists it.
7. A `bowerloom` on `PATH` from another version reads the same catalog format in beta.3. A failure there blocks the call.
8. Claude Code before 2.1.295 ignores `onFailure`. A guard that cannot start then lets the call through.

### 3.10 `bowerloom context show`

Usage, verbatim: `bowerloom context show <slice> [--json]`.

It reads only. It resolves the slice as apply would. A slice that the receipt does not register refuses `CONTEXT_SLICE_NOT_FOUND`. It prints:

```
Slice <id>: <n> files from <where>
Index: .claude/skills/slice-<id>/SKILL.md, <bytes> bytes (<installed>)
Guard: <root or none>
Agents: <roles, or none>
Held: <code>. Next: <next>
Notes:
  <each note of section 3.7.3, without the "Note: slice <id>" opening>

<the rendered index, byte for byte>
```

- `<installed>` is `installed and the same`, `installed and out of date`, or `not installed`.
- The `Held:` line prints only for a held slice. Then the index is not printed.
- The `Notes:` block prints only when a note exists.

`--json` prints format `bowerloom/context-slice-show/v1beta1` with `id`, `root`, `members`, `covered`, `notes`, `hold`, `guard`, `agents`, `index` (`{ text, bytes, sha256 }` or null), and `installed`.

### 3.11 `bowerloom context measure`

Usage, verbatim:

```
bowerloom context measure [--agent <role>]... [--team <team>] [--from <folder>] [--baseline <folder>] [--bytes-per-token <number>] [--user] [--json]
```

It reads only. It never uses the network. It writes nothing. It exits 0. A refusal throws.

Flags:

- `--agent <role>`, repeatable: measure only these agents. A role that no team holds refuses `CONTEXT_AGENT_NOT_FOUND`. Without it, every valid agent of the project is measured.
- `--team <team>`: measure only that team's agents.
- `--from <folder>`: the folder Claude Code starts in. The default is the working folder.
- `--baseline <folder>`: the folder of the full load. The default is the deepest common folder of the measured agents' slice roots. If no agent has slices, the default is the project folder. A folder that does not exist, or fails the guards of section 3.4, refuses `CONTEXT_BASELINE_INVALID`.
- `--bytes-per-token <number>`: a decimal from 1.0 to 10.0. It marks the estimate as calibrated by the person.
- `--user`: also count `~/.claude/CLAUDE.md`, the `~/.claude/rules/*.md` files that have no `paths` key, and `~/.claude/skills` for preloaded skills.

**Unit.** Bytes of UTF-8 are exact. Tokens are an estimate, `tokens = ceil(bytes * 1000 / round(bytesPerToken * 1000))`, in integer math. The default `bytesPerToken` is 4. The output names an assumed band of 3.0 to 4.5 bytes per token, labelled not calibrated. Claude has no public offline tokenizer, and this spec allows no network and no paid API. So the error of the estimate against Claude's real tokenizer is not measured. The output also gives `nonAsciiShare` for counted text, because the estimate is weaker for text that is not Latin script. Ratios come from bytes, in parts per million. If tokens are bytes times one constant, a token ratio equals the byte ratio.

**What is counted, per agent.**

| Column | Content | When it loads |
|---|---|---|
| Prompt | The agent body after the closing fence. | At start |
| Instructions | `CLAUDE.md`, `.claude/CLAUDE.md`, and `CLAUDE.local.md` in `--from` and every folder above it. If none exists, every `AGENTS.md` and `.claude/AGENTS.md` there. Their `@path` imports, up to four hops, skipping imports in code spans and fences. `.claude/rules/*.md` files with no `paths` key. Zero when the agent sets `omitClaudeMd: true`. | At start |
| Skills | The whole `SKILL.md` of each preloaded entry that is not a slice entry, among the first 32 distinct names. The search covers `.claude/skills/<name>/SKILL.md` in `--from` and the folders above it, and `~/.claude/skills` with `--user`. Names not found are listed and not counted. | At start |
| Slices | The bytes of each live-rendered index of the agent's slice entries, among the first 32. | At start |
| At start | The sum of the four columns above. | |
| On demand | Every member's bytes, plus each subfolder `CLAUDE.md` or `AGENTS.md` between `--from` and a member that loads when the agent reads there. | Ceiling when the agent reads everything |
| Baseline | Prompt, plus the full instruction files as if `omitClaudeMd` were false, plus Skills, plus every non-hidden `.md` file under the baseline folder, all at start. | |
| Start/baseline | At start divided by Baseline. | |

**Not counted**, and named in every output: Claude Code's own system details and tool definitions, MCP tool definitions, git status, the sibling list, the task message, managed policy files, agent memory, the skill list in the subagent, files the agent reads beyond its slices, and model output. The Read tool may read a large file only in part, so On demand is a ceiling.

**Text output**, verbatim in shape:

```
Context per agent. Project: <project>. Claude Code starts in: <from>.
Unit: tokens, estimated as bytes / <bpt> (<band>). Bytes are exact. Add --json to see them.

Agent          Prompt  Instructions  Skills  Slices  At start  On demand  Baseline  Start/baseline
research-lead    0.8k         15.2k    6.3k    1.8k     24.4k      70.8k  2,848.9k           0.85%
Baseline: each agent with every .md file under <baseline> (<n> files) loaded at start, and its CLAUDE.md or AGENTS.md files.
Not counted: Claude Code's own system details and tool definitions, MCP tools, git status, the task message, managed policy files, agent memory, and files an agent reads beyond its slices.
Notes:
  <role>: <note>
```

- `<band>` is `assumed band 3.0 to 4.5 bytes per token, not calibrated`, or `calibrated by you` with `--bytes-per-token`.
- Token cells show thousands, floored to one decimal, with comma groups, and a `k` suffix.
- The ratio shows a percent floored to two decimals.
- The role column is left-aligned. The other columns are right-aligned. Columns are separated by two spaces. Each column is as wide as its widest cell or header.
- The numbers in the example above are an illustration of the shape, not a measured result.

Notes per agent, in this order, each when its case applies:

```
  <role>: Claude Code started in <from> does not find this agent. It finds agents only in the folders above where it starts. Start it inside <project>, or pass --add-dir <project>.
  <role>: starts with <n> bytes of CLAUDE.md or AGENTS.md files. Set omitClaudeMd: true to start it with its slices only.
  <role>: names <path> in its prompt (<n> bytes). An agent that follows that line reads it on demand.
  <role>: skills not found, so not counted: <names>.
  <role>: slice <id> is held (<code>), so it is not counted.
  <role>: the index of slice <id> is out of date. Run bowerloom apply.
```

The third note scans the body for backtick spans that name an existing file. It shows them and does not add them to any sum.

**JSON output**, format `bowerloom/context-measure/v1beta1`, written with `newCommandJson` (`apps/cli/src/human.ts:208`). Section 4.10 lists the fields.

**Determinism.** The output holds no time. Every list is sorted. Two runs over the same tree give the same bytes.

**What the measure cannot prove.** It cannot prove answer quality or task success. A smaller context can be worse when it leaves out what the task needs. It cannot prove what an agent actually reads. It cannot prove that Claude's tokenizer agrees with the estimate. It does not model prompt caching, cost, or speed. A quality comparison needs a separate evaluation, outside this spec.

### 3.12 `status`, `ls`, and `up`

- `bowerloom status`: the authoring owner claims `slices` (section 6.3). A registered slice whose bytes differ from the receipt pins prints `  edited: .bowerloom/slices/<id>.yaml`. An unregistered file makes the owner refuse with `AUTHORING_UNREGISTERED`. A file that fails `parseSlice` makes it refuse with `SLICE_INVALID`. Slice holds print `  slice <id>: held (<code>). Next: <next>`. An installed slice whose index is out of date prints `  slice <id>: index out of date (<a> added, <g> gone, <s> summaries changed). Next: bowerloom apply`.
- `bowerloom ls slices` lists the slice files in `.bowerloom/slices`, as `ls prompts` lists prompt files. `bowerloom ls` with no section lists slices after prompts. `--json` adds `slices`. The usage text becomes `Use bowerloom ls [teams|skills|prompts|slices] [--json].` Spec 04 changes `ls` too. The builder merges both.
- `bowerloom up --team <name>`: the `apply` step runs when a slice of the team's agents needs a copy. The step text (`apps/cli/src/up.ts:148` as 01a changes it) becomes `Next step: apply. Put the skills, prompts, agents, and context slices of team <name> in place for <harnesses>.` The end line (`up.ts:173` as 01a changes it) becomes `  Team: <team>, with skills, prompts, agents, and context slices in place for <harnesses>.`

### 3.13 Help text

`apps/cli/src/human.ts` changes. All lines are verbatim.

`SECTIONS` (`human.ts:13-31`). Add to `Create (mostly used by agents)`:

```
bowerloom slice create <name> [--root <folder>]
```

Add a new section `Context` after `Create`:

```
bowerloom context measure             Compare each agent's context with a full load.
bowerloom context show <slice>        Show what a slice selects.
bowerloom root add <name> <folder>    Register a folder outside the project.
```

The `root add` line lands with Part B.

`TOPICS.slice`:

```
Usage:
  bowerloom slice create <name> [--root <folder>] [--named-root <root>] [--include <pattern>]... [--approve <revision>] [--json]

Creates a context slice in .bowerloom/slices/<name>.yaml and registers it. A slice selects files from one folder
by path patterns, frontmatter, and links. bowerloom apply turns it into the skill slice-<name>, a list of paths
that an agent loads at start. The files stay where they are. Only their titles are copied.
--root is the folder the patterns start from. The default is the project folder.
--named-root picks a folder outside this project that bowerloom root add registered. --root is then a folder in it.
--include adds a path pattern. The default is **/*.md.
If .bowerloom/slices/<name>.yaml is already there and not registered, create registers it and keeps its bytes.
An agent loads the slice when the skills list in its file names slice-<name>.
It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the file it makes.
It writes inside .bowerloom only. It starts no workers and runs nothing.
```

`TOPICS.context`:

```
Usage:
  bowerloom context show <slice> [--json]
  bowerloom context measure [--agent <role>]... [--team <team>] [--from <folder>] [--baseline <folder>] [--bytes-per-token <number>] [--user] [--json]
  bowerloom context guard --agent <role> --explain <path> [--tool Read|Grep|Glob]

context show prints the files a slice selects and the index skill that apply writes for it. It reads only.
context measure compares what each agent loads at start with the same agent loaded with every .md file of the
knowledge base. Bytes are exact. Tokens are an estimate, bytes divided by 4, unless you pass --bytes-per-token.
It reads only and never uses the network. --from is the folder Claude Code starts in. --baseline is the folder of
the full load. --user also counts your own CLAUDE.md, rules, and skills.
context guard is the read guard that apply adds to an agent with slices. Claude Code runs it before each Read,
Grep, and Glob of that agent, in a folder you trusted. It blocks a read under a slice's folder that no slice of the
agent lists. It never allows what Claude Code would block. It does not check shell commands.
With --explain it prints what the guard decides for one path.
```

`TOPICS.root` (Part B):

```
Usage:
  bowerloom root add <name> <folder> [--approve <revision>] [--json]
  bowerloom root list [--json]
  bowerloom root remove <name> [--approve <revision>] [--json]

A root is a named folder outside a project, such as a knowledge base. Your store keeps it in
~/.bowerloom/roots/<name>.json, as a path below your home folder. A slice names it with root: { named: <name> }.
Bowerloom reads a root and never writes it. The folder must be yours, below your home folder, outside iCloud
folders, and not writable by other users.
These commands work from any folder. add and remove show the plan first. Agents pass --approve <revision> or --json.
remove deletes the registration only. The folder stays.
```

`TOPICS.apply` (`human.ts:111-120`): after the lines that 01a adds, add:

```
'A context slice in .bowerloom/slices/<name>.yaml becomes the skill .claude/skills/slice-<name>/SKILL.md, a list',
'of paths. An agent whose skills list names slice-<name> loads it at start and reads the files where they are.',
'Such an agent also gets a read guard in its copy. See bowerloom help context.',
```

`TOPICS.ls` (`human.ts:46-52`): the usage line becomes `  bowerloom ls [teams|skills|prompts|slices] [--json]`, and the first sentence names slices.

`TOPICS.skill` (`human.ts:130-138`) and `TOPICS.prompt` (`human.ts:139`): the sentence about reserved ids adds `and ids that start with slice-`.

`apps/cli/src/main.ts:122-127` (`helpText`): `help slice create` and `help slice` print `TOPICS.slice`. `help context`, `help root`, `context --help`, and `root --help` print their topics.

### 3.14 Exit codes

They follow the existing commands:

- `slice create`, `root add`, `root remove`, `apply`: 0 done or nothing to change, 3 approval required, 2 usage. A refusal throws.
- `context show`, `context measure`, `root list`, `context guard --explain`: 0, or 2 for usage. A refusal throws.
- `context guard` hook form: 0, with deny output or no output. 2 only for unreadable input.
- A hold is not a refusal. A plan with only holds prints `Nothing to change.` and exits 0.

### 3.15 Codex

Codex gets no slice in beta.3. Spec 01b designs it. What Codex would need, from the Codex docs read on 2026-10-22 (developers.openai.com/codex: agents-md, subagents, skills):

- Codex reads skills from `.agents/skills`. A slice index in the same format would work there as a skill.
- A Codex custom agent (`.codex/agents/<role>.toml`) inherits the parent's skills and can disable some with `skills.config`. No preload like Claude Code's `skills` key is documented, so the index would load on demand, or be rendered into `developer_instructions` as a derived copy.
- No per-agent switch that leaves out AGENTS.md is documented. Codex joins AGENTS.md files from the project root down, up to `project_doc_max_bytes`, 32 KiB by default.
- No per-agent `PreToolUse` hook in the agent file is documented. The guard would need 01b's own-session design.
- `context measure` would need a Codex instruction model: the override files, the 32 KiB cap, and the skill list budget.

## 4. Schemas and formats

### 4.1 The slice file, `.bowerloom/slices/<id>.yaml`

`parseSlice(text, stem)` is pure. It lives in `packages/context-slices/src/slice-file.ts`. It returns `{ ok: true, slice }` or `{ ok: false, code, detail }`. `detail` names a key only when the key matches `^[A-Za-z0-9_.-]{1,64}$`. Any other key is named `a key with unsupported characters`. No detail quotes other file text.

File rules:

- The stem matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` with at most 57 characters. A file in `slices/` with another name is skipped by apply with a note, and refused by the status owner.
- The file has at most 16384 bytes. It is valid UTF-8 with no byte order mark, no carriage return, and no null byte.
- The text parses with `parseDocument(text, { uniqueKeys: true })` and `toJS({ maxAliasCount: 0 })` to a map. A parse error, an alias, a merge key, a duplicate key, or a result that is not a map is `SLICE_INVALID`.

Allowed keys, in this order. Any other key is `SLICE_KEY_UNKNOWN`. Keys are checked before values.

```
format, description, root, include, exclude, where, links, summary, maxFiles, guard
```

Value rules. A bad value is `SLICE_INVALID`, and the detail names the key.

- `format`: required. Exactly `bowerloom/context-slice/v1beta1`.
- `description`: required string, 1 to 1024 characters, no control or format characters.
- `root`: optional. Either a path string, or a map with the keys `named` (required) and `path` (optional).
  - A path string or `path` value: a relative POSIX path of at most 512 bytes, with no empty, `.`-leading, or `..` segment, no leading `/`, no backslash, and no control character. The single value `.` means the folder itself. The default is `.`.
  - `named`: a root name, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters.
- `include`: required list of 1 to 64 patterns. Each pattern has 1 to 256 bytes and follows section 4.2.
- `exclude`: optional list of 0 to 64 patterns.
- `where`: optional map of 1 to 16 keys. Each key matches `^[A-Za-z0-9_-]{1,64}$`. Each value is a string of 1 to 128 characters, or a list of 1 to 32 such strings.
- `links`: optional map with the keys `follow` (required) and `depth` (optional). `follow` is a non-empty list with no repeats, of `wikilink` and `markdown`. `depth` is 1 or 2. The default is 1.
- `summary`: optional. `heading`, `none`, or `frontmatter:<key>`, where `<key>` matches `^[A-Za-z0-9_-]{1,64}$`. The default is `heading`.
- `maxFiles`: optional integer from 1 to 256. The default is 256.
- `guard`: optional. `root` or `none`. The default is `root`.

The type, in `packages/context-slices/src/slice-file.ts`:

```ts
export const SLICE_FORMAT = 'bowerloom/context-slice/v1beta1' as const
export const SLICE_LIMITS = Object.freeze({ fileBytes: 16384, idLength: 57, patterns: 64, patternBytes: 256, whereKeys: 16, whereValues: 32, maxFiles: 256, slices: 64, walkEntries: 8192, walkDepth: 16, memberBytes: 1048576, readBytes: 33554432, indexBytes: 65536, summaryChars: 160, pathBytes: 512 })
export type SliceRoot = { kind: 'project', path: string } | { kind: 'named', name: string, path: string }
export interface SliceDefinition {
  format: typeof SLICE_FORMAT
  description: string
  root: SliceRoot
  include: string[]
  exclude: string[]
  where: Record<string, string[]>
  links: { follow: ('wikilink' | 'markdown')[], depth: 1 | 2 } | null
  summary: { kind: 'heading' } | { kind: 'none' } | { kind: 'frontmatter', key: string }
  maxFiles: number
  guard: 'root' | 'none'
}
```

### 4.2 Path patterns

Bowerloom defines its own small pattern language, so a result never depends on the Node version.

- A pattern is split at `/`. A leading `/`, a leading `./`, an empty segment, and a `..` segment are refused.
- A segment of exactly `**` matches zero or more whole segments.
- `*` matches any run of characters inside one segment. `?` matches one character inside one segment.
- `\` makes the next character literal.
- `[`, `]`, `{`, `}`, and a leading `!` are refused unless escaped. Use `exclude` in place of negation.
- A wildcard never matches a segment that starts with `.`.
- Matching runs on the NFC form of the path relative to the root. It is case-sensitive.
- `canMatchBelow(pattern, folder)` is true when some path under `folder` could match. The walk uses it to skip folders.

### 4.3 The `slice create` template

The file that `slice create <name>` writes. `<root block>` is `root: <json of root path>` for a project root, and the two lines `root:` and `  named: <name of root>` then `  path: <json of root path>` for a named root. Each pattern and the root path are written with `JSON.stringify`, which YAML reads as a double-quoted string.

```
format: bowerloom/context-slice/v1beta1
description: Describe what this slice holds and which agents use it.
<root block>
include:
  - <json of pattern 1>
  - <json of pattern 2>
summary: heading
guard: root
```

The file ends with one line break. A test checks that the template passes `parseSlice` for every flag combination.

### 4.4 The root registration, `~/.bowerloom/roots/<name>.json` (Part B)

The file holds exactly two keys and ends with one line break. The writer emits `{"format":"bowerloom/store-root/v1beta1","path":"<rel>"}` plus `\n`, on one line, with no spaces.

- `format`: exactly `bowerloom/store-root/v1beta1`.
- `path`: the folder relative to `realpath(home)`. It is a POSIX path of 1 to 1024 bytes, with no empty, `.`-leading, or `..` segment, and no leading `/`.
- The reader uses `strictJson(text, 4096)` (`packages/codex-adapter/src/safe.ts:19`). An unknown key, a duplicate key, a byte order mark, invalid UTF-8, or more than 4096 bytes is `ROOT_INVALID`.
- The file must be a plain file: a regular file, one hard link, owned by the user, with no group or world write. Otherwise `ROOT_UNSAFE`.
- The folder `roots/` must be a real folder owned by the user with no group or world write. Its names are `<name>.json` or a temporary name. Any other name makes `root list` report it and refuse it as `ROOT_INVALID`.

### 4.5 The rendered index, `renderSliceIndex`

The exact bytes. Every line ends with `\n`. There is no other text.

```
---
name: slice-<id>
description: <JSON.stringify(description)>
user-invocable: false
---

# Context slice <id>

Bowerloom made this file from .bowerloom/slices/<id>.yaml. Do not edit it. Edit the slice file, then run bowerloom apply.

The files below are the context for your work. They stay where they are. Read a file with the Read tool when your task needs it. Paths are relative to the project folder, the nearest folder above your working folder that holds .bowerloom.

Source folder: <source display>
Files: <n>

- `<path 1>`: <summary 1>
- `<path 2>`
```

- When `guard` is `root`, a line follows the `Files:` line: `Bowerloom's guard blocks a read under the source folder that this list does not name.`
- `<source display>` is `the project folder` for root `.`, the root path for another project root, and `<relative path> (root <name>)` for a named root. The relative path goes from the project folder's real path to the root's real path, such as `../knowledge-base/wiki`.
- Each member line is `- `, the path in backticks, then `: <summary>` when a summary exists. The path is relative to the project folder. For a project root it is the root path joined with the member path. For a named root it starts with the relative path to the root.
- Lines are sorted by path in byte order.
- No hash, size, time, or absolute path appears.

### 4.6 The guard entry in the agent copy

`claudeCopyBytes` appends this object to `hooks.PreToolUse`:

```json
{
  "matcher": "Read|Grep|Glob",
  "hooks": [
    {
      "type": "command",
      "command": "bowerloom",
      "args": ["context", "guard", "--agent", "<role>", "--project", "${CLAUDE_PROJECT_DIR}", "--slice", "<id 1>", "--slice", "<id 2>"],
      "timeout": 10,
      "onFailure": "block"
    }
  ]
}
```

The `--slice` pairs follow the sorted slice entries. A golden test pins the YAML text that `yaml` 2.9.1 writes for an agent with no `hooks` key, and for one with an existing `hooks.PreToolUse` list.

### 4.7 Plan and result shapes

The apply plan keeps the format `bowerloom/project-apply-plan/v1beta2` and the result keeps `bowerloom/project-apply-result/v1beta2`, as 01a sets them. 01a's format is not released, so this spec adds fields without a new format string.

The plan gains:

- `slices: SliceItem[]`
- `codexSlicesSkipped: boolean`. It is true when the harness list includes `codex` and at least one slice is registered.
- `unregisteredSlices: string[]`, the file names that apply skips.

Types, in `packages/project-sync/src/slices.ts`, exported from `index.ts`:

```ts
type SliceState = 'new' | 'edited' | 'up-to-date' | 'drift' | 'orphaned' | 'held'
interface SliceItem {
  id: string
  itemId: string                   // 'slice_' + id
  state: SliceState
  action: 'install' | 'update' | 'none' | 'hold'
  harnesses: ['claude']
  definition: { path: string, sha256: string, bytes: number } | null
  root: { kind: 'project', path: string, dir: string, identity: DirectoryIdentity } | { kind: 'named', name: string, path: string, dir: string, identity: DirectoryIdentity, registrationSha256: string } | null
  guard: 'root' | 'none' | null
  members: string[]                // relative to the root, sorted
  covered: string[]                // relative to the root, each ending in '/', sorted, './' for the root
  changes: { added: number, gone: number, summaries: number, rootChanged: boolean, guardChanged: boolean }
  notes: { unparsed: string[], unresolvedLinks: number, ambiguousLinks: number, emptyPatterns: string[], notText: number, oversize: string[], outsideProject: boolean, wholeProject: boolean }
  agents: string[]                 // roles that name it, sorted
  expected: { files: InventoryRow[], surfaces: ItemSurface[], source: SliceCatalogSource | null }
  before: SyncItem['before']
  previousReceiptRevision: string | null
  history: number
  hold: { code: string, next: string } | null
}
```

`AgentItem` (01a section 4.4) gains:

```ts
context: {
  slices: string[]                 // slice entries, sorted
  guard: string[] | null           // the ids passed to claudeCopyBytes, or null without a guard
  unknown: string[]                // unknown slice- names
  beyondPreloadLimit: string[]     // slice entries after position 32
  plainSkills: string[]            // slice- names that resolve to a plain skill
  omitClaudeMd: boolean
}
```

`ApplyItemRef.kind` gains `'slice'`. The result lists slices in `applied`, `held`, `upToDate`, and `orphaned`, with kind `slice`.

The plan revision binds every field above. It does not bind the hash or size of a member file.

### 4.8 Managed item shapes

- Item reference: `{ kind: 'slice', id: '<id>' }`. Private folder and catalog name: `slice_<id>`. Skill ids cannot hold an underscore (`packages/managed-skills/src/local-source.ts:14`), so a skill named `slice-x` and the catalog `slice_x` never meet.
- Surfaces: `projection-claude`, a folder at `.claude/skills/slice-<id>`, and `catalog`, a file at `.bowerloom/managed/catalog/slice_<id>.json`. There is no `canonical` and no `projection-codex` surface.
- Request source: `{ kind: 'slice', name, root }`, key list `['kind', 'name', 'root']`. `name` equals the item id. `root` is `{ kind: 'project' }`, or `{ kind: 'named', name, dir, identity }` with `dir` an absolute real path and `identity` its device, inode, and birth time.
- Closure source, the catalog `source`: `SliceCatalogSource = { kind: 'slice', path: 'slices/<id>.yaml', root: SliceRoot, guard: 'root' | 'none' }`. It holds no absolute path.
- Closure files: one file, `SKILL.md`, the rendered index. `closure.skill` is null. `closure.name` is the id.
- Closure references: the members, then the covered folders, each sorted. The catalog writes them as `references` (`packages/managed-skills/src/v2-observed.ts:114`).
- `sameSource` (`v2-observed.ts:237`): for kind `slice`, the rule is `was.kind === 'slice'`, so a root or guard change is an update.
- The up-to-date test (`v2-observed.ts:241`) compares the whole catalog text, so a change of members, covered folders, root, or guard plans an update even when the index bytes stay the same.

### 4.9 The authoring receipt

`ItemKind` (`packages/project-authoring/src/state.ts:22`) gains `'slice'`. A slice item has `teams: []` and one file pin, `slices/<id>.yaml`. `itemPath('slice', id)` is `slices/<id>.yaml`. The receipt format stays `bowerloom/authoring-receipt/v1beta1`. A beta.2 CLI refuses a receipt that holds a slice item with `AUTHORING_RECEIPT_INVALID` (section 8).

### 4.10 `context measure --json`

Format `bowerloom/context-measure/v1beta1`. Fields:

| Field | Type | Meaning |
|---|---|---|
| `format` | string | `bowerloom/context-measure/v1beta1` |
| `project` | string | The project folder |
| `from` | string | The `--from` folder |
| `estimator` | object | `{ id: 'bytes-per-token/v1', bytesPerToken: string, band: ['3.0', '4.5'], calibrated: false or 'user' }` |
| `baseline` | object | `{ folder, include: '**/*.md', files, bytes, skipped: { hidden, links, notRegular } }` |
| `agents` | array | One object per agent, below |
| `notCounted` | array | The fixed list of section 3.11 |
| `assumptions` | array | Fixed strings for the unverified items of section 12 that the counts depend on |
| `executionAuthorized` | false | Always false |

Each agent: `role`, `team`, `omitClaudeMd`, `discovered` (true when `--from` is the project folder or below it), `start` (`{ prompt, instructions: { files: [{ path, bytes, via }], bytes }, skills: { files: [{ name, path, bytes }], unresolved, beyondPreloadLimit }, slices: [{ id, indexBytes, memberBytes, indexToMembersPpm, installed, hold }], bytes, tokens, nonAsciiPpm }`), `onDemand` (`{ members: { files, bytes }, instructions: [{ path, bytes }], bytes, tokens }`), `mentioned` (`[{ path, bytes }]`), `listing` (`{ descriptionBytes }`), `baseline` (`{ bytes, tokens }`), `ratios` (`{ startToBaselinePpm, onDemandToBaselinePpm }`), and `reference` (`{ unslicedStartBytes }`, the agent with its slice entries removed). Every count is an integer. Every path is relative to the project folder, except `project` and `from`.

## 5. Refusal codes

Each code gets a `MESSAGES` entry, a `REFUSALS` entry in `apps/cli/src/human.ts:224`, and a row in `apps/docs/src/content/docs/reference/errors.md`. A hold's per-item detail goes in its `next` text. A refusal's detail goes in the extra text of `syncError(code, extra)`.

Where each code lives:

- `packages/project-authoring/src/refusal.ts:7-31`: `SLICE_INVALID`, `SLICE_KEY_UNKNOWN`, `SLICE_NAME_INVALID`, `SLICE_EXISTS`. Create and the status owner raise them. `AUTHORING_REFUSAL_CODES` then holds them.
- `packages/project-sync/src/refusal.ts:11-40`: `SLICE_LIMIT`, `SLICE_PATH_MISSING`, `SLICE_ROOT_MISSING`, `SLICE_ROOT_UNSAFE`, `SLICE_SOURCE_UNSAFE`, `SLICE_EMPTY`, `SLICE_TOO_LARGE`, `SLICE_TARGET_OCCUPIED`, `AGENT_GUARD_CONFLICT`, `CONTEXT_SLICE_NOT_FOUND`, `CONTEXT_AGENT_NOT_FOUND`, `CONTEXT_BASELINE_INVALID`, `CONTEXT_MEASURE_LIMIT`, `GUARD_OUTSIDE_SLICE`, `GUARD_SLICE_NOT_INSTALLED`, `GUARD_ROOT_MISSING`, `GUARD_PROJECT_MISMATCH`, `GUARD_INPUT_INVALID`. `SYNC_REFUSAL_CODES` then holds them.
- `packages/project-context/src/refusal.ts:7-17` (Part B): `ROOT_NAME_INVALID`, `ROOT_EXISTS`, `ROOT_NOT_FOUND`, `ROOT_UNSAFE`, `ROOT_IN_CLOUD_FOLDER`, `ROOT_INVALID`.

| Code | Kind | Cause | Next step | Message (`MESSAGES`) | Sentence (`human.ts`) |
|---|---|---|---|---|---|
| `SLICE_INVALID` | hold, and a create refusal | A slice file cannot be read, has bad YAML, a bad value, or a bad pattern. | `Fix <path>: <detail>. Then run bowerloom apply.` In `human.ts`: `bowerloom help slice` | `A slice file in .bowerloom/slices cannot be used.` | `Bowerloom builds an index only from slice files it can check.` |
| `SLICE_KEY_UNKNOWN` | hold | The slice file has a key outside the list. | `Remove the key <key> from <path>, then run bowerloom apply.` In `human.ts`: `bowerloom help slice` | `A slice file uses a key that slices do not take.` | `Bowerloom accepts only the documented slice keys.` |
| `SLICE_NAME_INVALID` | create refusal | The slice id is not a plain id of at most 57 characters. | `bowerloom help slice` | `A slice id is lower-case letters and digits in words joined by single hyphens, at most 57 characters, such as wiki-engineering.` | `The id becomes a file name and a skill name, so it is kept plain.` |
| `SLICE_EXISTS` | create refusal | The project already registers a slice with that id, or a file differs only in case. | `bowerloom ls slices` | `This project already has a slice with that id.` | `Each slice needs its own id.` |
| `SLICE_LIMIT` | refusal | The project registers more than 64 slices. | `bowerloom ls slices` | `This project registers more than 64 slices. Nothing was changed.` | `This beta applies at most 64 slices.` |
| `SLICE_PATH_MISSING` | hold | The project root folder, or a literal include path, is gone. | `<path> is gone. Fix the path in .bowerloom/slices/<id>.yaml, or restore the file, then run bowerloom apply.` | `A folder or file that a slice names is gone.` | `Bowerloom does not drop a named file without telling you.` |
| `SLICE_ROOT_MISSING` | hold | A named root is not registered, its folder is gone, there is no store, or this build has no named roots. | `Run bowerloom root list, or register the root with bowerloom root add <name> <folder>, then run bowerloom apply.` | `The root that a slice names cannot be found.` | `A named root must be registered in your store and must exist.` |
| `SLICE_ROOT_UNSAFE` | hold | The root folder or a folder above it is a link, is not yours, is writable by others, sits in a cloud folder, or a named root sits inside the project. | `ls -ld <folder>` | `The root that a slice names is not safe to read.` | `Bowerloom reads only folders that you own and that no other user can change.` |
| `SLICE_SOURCE_UNSAFE` | hold | A selected file or a walked folder is a link, has more than one link, is not yours, or is writable by others. | `ls -l <path>` | `A file or folder that a slice selects is not safe to read.` | `Bowerloom will not read through links or files that others can change.` |
| `SLICE_EMPTY` | hold | The slice selects no file. | `Widen include in .bowerloom/slices/<id>.yaml, then run bowerloom apply.` | `A slice selects no file.` | `An empty index would give an agent nothing.` |
| `SLICE_TOO_LARGE` | hold | The slice selects more than maxFiles files, reads more than 32 MiB, walks more than 8192 entries or 16 levels, or its index is over 64 KiB. | `Narrow the slice, or set summary: none, then run bowerloom apply.` | `A slice is larger than this beta allows.` | `A slice index stays small so that an agent can load it at start.` |
| `SLICE_TARGET_OCCUPIED` | hold | `.claude/skills/slice-<id>` exists and Bowerloom did not install it. | `Move .claude/skills/slice-<id> aside, then run bowerloom apply.` | `Something Bowerloom did not install is where a slice index goes.` | `Bowerloom never overwrites what it did not install.` |
| `AGENT_GUARD_CONFLICT` | hold | The agent's `hooks` is not a map, or its `hooks.PreToolUse` is not a list, so the guard cannot be added. | `Make hooks a map and hooks.PreToolUse a list in <path>, then run bowerloom apply.` | `An agent's hooks cannot take the read guard.` | `Bowerloom adds the guard only to hooks it can read as a map of lists.` |
| `CONTEXT_SLICE_NOT_FOUND` | refusal | `context show` names a slice that is not registered. | `bowerloom ls slices` | `This project registers no slice with that id.` | `Only a registered slice can be shown.` |
| `CONTEXT_AGENT_NOT_FOUND` | refusal | `--agent` names a role that no team holds. | `bowerloom ls teams` | `No team of this project holds an agent with that name.` | `Bowerloom measures the agents in .bowerloom/teams/*/agents.` |
| `CONTEXT_BASELINE_INVALID` | refusal | The `--baseline` folder does not exist or is not safe to read. | `bowerloom help context` | `The baseline folder cannot be read safely.` | `The baseline must be a folder you own.` |
| `CONTEXT_MEASURE_LIMIT` | refusal | The baseline walk passes 100000 entries. | `Pass a narrower --baseline.` | `The baseline folder is larger than this beta measures.` | `This beta measures at most 100000 entries.` |
| `GUARD_OUTSIDE_SLICE` | guard deny | A Read, Grep, or Glob reaches a file under a guarded area that no slice of the agent lists. | `bowerloom context show <slice>` | `The read guard blocked a call outside the agent's slices.` | `A slice lists the files an agent reads under its folder.` |
| `GUARD_SLICE_NOT_INSTALLED` | guard deny | A slice of the agent is not installed, or its catalog changed. | `bowerloom apply` | `The read guard blocked every call, because a slice of the agent is not installed.` | `The guard fails closed when it cannot read a slice.` |
| `GUARD_ROOT_MISSING` | guard deny | The folder of a slice cannot be found. | `bowerloom apply` | `The read guard blocked every call, because the folder of a slice cannot be found.` | `The guard fails closed when a slice's folder is gone.` |
| `GUARD_PROJECT_MISMATCH` | guard deny | The project where Claude Code started does not manage the agent. | `cd <project-folder>` | `The read guard found no record of this agent in the project.` | `Start Claude Code inside the project that holds the agent.` |
| `GUARD_INPUT_INVALID` | guard block | The hook input from Claude Code cannot be read. | `claude --debug` | `The read guard could not read its input, so it blocked the call.` | `The guard blocks a call it cannot check.` |
| `ROOT_NAME_INVALID` | refusal | The root name is not a plain id of at most 64 characters. | `bowerloom help root` | `A root name is lower-case letters and digits in words joined by single hyphens, at most 64 characters.` | `The name becomes a file name in your store.` |
| `ROOT_EXISTS` | refusal | The store already holds a root with that name, or one that differs only in case. | `bowerloom root list` | `Your store already has a root with that name.` | `Each root needs its own name.` |
| `ROOT_NOT_FOUND` | refusal | The store or the registration is absent. | `bowerloom root list` | `Your store has no root with that name.` | `Only a registered root can be used or removed.` |
| `ROOT_UNSAFE` | refusal | The folder is missing, is not below home, is home, is a link, is not yours, is writable by others, has a hidden segment, touches the store, or the registration file is not a plain file. | `ls -ld <folder>` | `This folder cannot be a root. It must exist below your home folder, belong to you, and be safe from other users.` | `Bowerloom reads only folders that you own and that no other user can change.` |
| `ROOT_IN_CLOUD_FOLDER` | refusal | The folder is in an iCloud or cloud-synced folder. | `mv <folder> ~/Projects/` | `This folder syncs to a cloud service, so it cannot be a root.` | `Cloud sync changes file times and moves files, which breaks the checks that keep a root safe.` |
| `ROOT_INVALID` | refusal | A registration file has wrong content. | `bowerloom root list` | `A root registration in your store is not valid.` | `Bowerloom reads root registrations strictly, so a hand edit can break one.` |

Existing codes this spec reuses: `USAGE`, `STALE_APPROVAL`, `REVISION_PENDING`, `AUTHORING_UNSAFE_PATH`, `AUTHORING_ITEM_MISSING`, `AUTHORING_UNREGISTERED`, `APPLY_NAME_COLLISION`, `MANAGED_SKILL_LOCAL_DRIFT`, `MANAGED_SKILL_RECOVERY_REQUIRED`, `MANAGED_SKILL_HISTORY_FULL`, `MANAGED_SKILL_LOCKED`, `SKILLS_STATE_STRAY_ENTRY`, `SKILLS_SYNC_INTERRUPTED`, `SKILLS_PROJECT_UNSAFE`, `STORE_INVALID`, `STORE_UNSAFE`, `STORE_LOCKED`.

Messages never carry a path. The `SKILL_NAME_RESERVED` message (`packages/project-authoring/src/refusal.ts:15`) becomes `The skill id personal-assistant and ids that start with prompt- or slice- are reserved.` The `PROMPT_NAME_INVALID` message (`refusal.ts:18`) adds the sentence `An id that starts with slice- is reserved.`

## 6. Where to change

### 6.1 New package `packages/context-slices`

It imports only `yaml`, `packages/contracts`, and `packages/skill-sources/src/validation.ts`. It does no I/O of its own. It takes a reader.

- `src/glob.ts`: `compilePattern`, `matchPattern`, `canMatchBelow`, `isLiteral`.
- `src/frontmatter.ts`: `splitFrontmatter(text)`, shared with `parseAgent` callers. It returns the fence lines, the block, and the rest.
- `src/slice-file.ts`: `SLICE_FORMAT`, `SLICE_LIMITS`, `SLICE_KEYS`, `isSliceId`, `parseSlice`, and the types of section 4.1.
- `src/links.ts`: `extractLinks(text)`, skipping fences and code spans.
- `src/resolve.ts`: `TreeReader` (with `list`, `stat`, and `read`), `resolveSlice(def, reader)`, `SliceResolution`.
- `src/render.ts`: `renderSliceIndex(id, def, resolution, display)` and `sliceTemplate(input)`.
- `src/guard.ts`: `decideGuard(input, view)`, a pure decision over identities. `view` gives `stat`, `realpath`, and the slice data.
- `src/instructions.ts`: `instructionFiles(from, options, reader)` for the measure, with the rules of section 3.11.
- `src/estimate.ts`: `estimateTokens(bytes, bytesPerTokenMilli)`, `ratioPpm(a, b)`, `formatThousands`, `formatPercent`.
- `src/index.ts`: the exports.
- No module may name `child_process`, `worker_threads`, or `cluster`, even in a comment (`tests/no-spawn.test.ts:47-50`).

### 6.2 managed-skills

- `packages/managed-skills/src/v2-types.ts:20`: `ItemRef.kind` gains `'slice'`.
- `v2-types.ts:21`: `ItemSource` gains `{ kind: 'slice', name: string, root: { kind: 'project' } | { kind: 'named', name: string, dir: string, identity: { device: string, inode: string, birthtimeNs: string } } }`. The 01a agent member gains `guard: string[] | null`.
- `v2-types.ts:30-33`: `LocalClosure.source` gains the slice catalog source. `LocalClosure` gains `references: string[]`. Skills, prompts, and agents return `[]`.
- `packages/managed-skills/src/v2-observed.ts:40`: `itemId` returns `'slice_' + item.id` for kind `slice`.
- `v2-observed.ts:41-44`: `itemRef` accepts kind `slice`, with an id of at most 57 characters.
- `v2-observed.ts:53-56` (`requestV2`): accept the slice source only with `item.kind === 'slice'`, `name === item.id`, and the harness list exactly `['claude']`. A named `dir` must be absolute, must pass `path()`, must not equal or sit inside `projectDir` or `stateDir`. It is not added to the `roots` list of line 61. The agent source key list becomes `['kind', 'team', 'name', 'guard']`, where `guard` is null or a sorted list of 1 to 32 slice ids.
- `v2-observed.ts:79-90` (`locateV2`): for kind `slice`, emit `projection-claude` at `join(p, '.claude/skills', 'slice-' + name)`, then the catalog. Line 84 gains the slice case. Line 85 gains the guard `item.kind !== 'slice'`.
- `v2-observed.ts:104-109` (`readClosure`): for `s.kind === 'slice'`, call `readLocalSlice`. Line 108 takes `references` from the local closure.
- `v2-observed.ts:237` (`sameSource`): kind `slice` compares `was.kind === 'slice'`.
- `v2-observed.ts:254-257` (`catalogItem`): the expression gains a third prefix group `(slice_)`, returning kind `slice`.
- `packages/managed-skills/src/local-source.ts:43-46` (`base`): the area gains `'slices'`.
- `local-source.ts`, after `readLocalPrompt` (line 65-71), add `readLocalSlice(projectDir, name, root, live)`. It reads `.bowerloom/slices/<name>.yaml` with `authored(file, 16384)`, runs `parseSlice`, builds a guarded `TreeReader` from `authored`, `folder`, and `closing` (`local-source.ts:21-36`), checks a named root's identity against the request, runs `resolveSlice` and `renderSliceIndex`, and returns the closure. A hold of the resolution throws `MANAGED_SKILL_REFUSED`, because the plan already held that slice.
- `local-source.ts`, 01a's `readLocalAgent`: pass the request's `guard` to `claudeCopyBytes`.
- `packages/managed-skills/src/agent-copy.ts` (01a section 6.1): `claudeCopyBytes(source, extras)`, as section 3.8 says.

### 6.3 project-authoring

- `packages/project-authoring/src/state.ts:22-23`: `ItemKind` and `KINDS` gain `'slice'`.
- `state.ts:29-31`: add `isSliceId`, a copy of the rule in `slice-file.ts`. The authoring package must not import `context-slices` for one regular expression, so the test `slice-id-parity.test.mjs` checks the two agree.
- `state.ts:36-38` (`itemPath`): kind `slice` gives `slices/<id>.yaml`.
- `state.ts:50-55` (`itemFile`): a slice file path is exactly `itemPath('slice', id)`.
- `state.ts:57-73` (`validItem`): the id rule for kind `slice` is `isSliceId`. Teams must be empty.
- `packages/project-authoring/src/create.ts:34-36` (`CreateInput`): add `{ kind: 'slice', project, name, root: SliceRoot, includes: string[] }`.
- `create.ts:83-99` (`normalizeInput`): accept the slice keys.
- `create.ts:101-107` (`checkName`): kind `slice` checks `isSliceId` and refuses `SLICE_NAME_INVALID`. Kinds `skill` and `prompt` also refuse an id that starts with `slice-`, with `SKILL_NAME_RESERVED` and `PROMPT_NAME_INVALID`. `isSkillId` and `isPromptId` stay as they are, because `validItem` reads old receipts with them.
- `create.ts:137-138`: add `SLICE_TEXT(input)`, the template of section 4.3, through `sliceTemplate`.
- `create.ts:180-266` (`plan`): the parent folder of kind `slice` is `slices` (line 201). The exists code is `SLICE_EXISTS` (line 235). Add the register path of section 3.2 step 5. The plan gains `register: AuthoredItem | null`.
- `create.ts:357`: the parent folder of kind `slice` is `slices`. A register plan writes only the receipt.
- `packages/project-authoring/src/refusal.ts:7-31`: the four codes of section 5, and the two message changes.
- `packages/project-authoring/src/verifiers.ts:37-38` (`claims`): claim the directory `slices`.
- `verifiers.ts:52-65`: a branch for `slices`, as the `prompts` branch. Each name must be `<id>.yaml` with a registered or pending slice. Otherwise `AUTHORING_UNREGISTERED`. Each file must pass `parseSlice`. Otherwise `SLICE_INVALID`. A pin difference gives `edited`.
- `packages/skill-manifest/src/add.ts:47` and `apps/cli/src/manifest.ts:54`: a new entry id that starts with `slice-` refuses, as an id that starts with `prompt-` does. `isEntryId` (`packages/skill-manifest/src/schema.ts:55`) stays as it is, because parsing an old `skills.json` uses it.

### 6.4 project-context (Part B)

- New file `packages/project-context/src/roots.ts`: `ROOT_FORMAT`, `ROOTS_DIR`, `isRootName`, `readRootRegistration(store, name)`, `listRoots(store)`, `checkRootFolder(real, home, store)`, `resolveNamedRoot(home, name)` (returns `{ dir, rel, identity, registrationSha256 }` or a hold code), `planRootAdd`, `applyRootAdd`, `planRootRemove`, `applyRootRemove`. It uses the store functions of spec 03 and `withStoreForWrite` of spec 04.
- `packages/project-context/src/refusal.ts:7-17`: the six `ROOT_*` codes.
- `packages/project-context/src/index.ts:19-20`: export the roots functions and types.

### 6.5 project-sync

- New file `packages/project-sync/src/slices.ts`: `registeredSlices`, `scanSlices`, `classifySlice`, `orphanSlice`, `sliceRequest`, `checkSliceChild`, `sliceNotes`, `agentContext`, and the types of section 4.7. Copy the structure of `packages/project-sync/src/prompts.ts` (`registeredPrompts` at 89, `classifyPrompt` at 121, `orphanPrompt` at 179, `promptRequest` at 186, `checkPromptChild` at 196). Differences:
  - The harness list is always `['claude']`.
  - An occupied target is a hold, `SLICE_TARGET_OCCUPIED`, not the throw at `prompts.ts:163-166`.
  - `checkSliceChild` requires `closure.source`, `closure.references`, and `closure.inventory` to equal the plan, then the surface and before-pin checks of `checkPromptChild`.
- `packages/project-sync/src/agents.ts` (01a section 6.2): fill `context` with `agentContext`. Compute the guard list. Hold `AGENT_GUARD_CONFLICT`. Pass `guard` in `agentRequest`. `checkAgentChild` compares the closure text with `claudeCopyBytes(source, extras)`.
- New file `packages/project-sync/src/context-measure.ts`: `measureContext(input)` and `showSlice(input)`. Both read only. They reuse `scanSlices`, `resolveSlice`, 01a's `scanAgents`, and `instructionFiles`.
- `packages/project-sync/src/apply-project.ts:44-58` (`applyPointer`): the slice sentence of section 3.7.3.
- `apply-project.ts:69-83`: `ApplyPlan` gains `slices`, `codexSlicesSkipped`, and `unregisteredSlices`. `ApplyItemRef.kind` gains `'slice'`.
- `apply-project.ts:103-114` (`checkNames`): slice rows use the slice surfaces. A skill named `slice-<id>` meets a slice `<id>` at `.claude/skills/slice-<id>` and refuses `APPLY_NAME_COLLISION`.
- `apply-project.ts:118-166` (`observeApply`): after 01a's agent scan, run `scanSlices` for every run. Plan slices only when the harness list holds `claude`, filtered by `input.team`. Run the orphan scan over every slice. Fill each agent's `context` before its copy is computed. Include slices in `checkNames`, `create`, `body`, `binding`, and `actionable`.
- `apply-project.ts:181-218` (`applyProjectApply`): build slice children with `sliceRequest` and `checkSliceChild` after the prompt loop (lines 194-203) and before the agent children. Extend `refOf` (line 206) and the result lists (lines 211-213).
- `packages/project-sync/src/recover.ts:19`: `ITEM_ID` becomes `/^(?:prompt-|agent_|slice_)?[a-z0-9]+(?:-[a-z0-9]+)*$/`. The length check at line 24 stays valid.
- `recover.ts:31`: the `owner` expression gains kind `slice`.
- `packages/project-sync/src/refusal.ts:11-40`: the eighteen codes of section 5.
- `packages/project-sync/src/index.ts:15-17`: export `SliceItem`, `SliceState`, `measureContext`, and `showSlice`.

### 6.6 CLI

- `apps/cli/src/apply.ts:36-58`: add `sliceLine`, `sliceState`, `sliceNotes`, and the agent context lines of section 3.7.3.
- `apply.ts:65-76` (`renderApplyReview`): slice ids count toward `width`. Slice lines come between the prompt and agent lines. Add the title, the empty text, the unregistered notes, and the Codex line.
- `apply.ts:77-85` (`resultWords`): kind `slice`.
- `apps/cli/src/create.ts:19-26`: `CREATE_NOUNS` gains `'slice'`, with its usage text.
- `create.ts:30-53` (`parseCreateArgs`): the flags `--root`, `--named-root`, and `--include` for the noun `slice`.
- `create.ts:56-82` (`renderCreateReview`): the slice lines of section 3.2.
- `create.ts:85-92` (`runCreateCommand`): build the slice input. In Part B, a `--named-root` is checked with `resolveNamedRoot` at plan time.
- New file `apps/cli/src/context.ts`: `runContextCommand(args, cwd, home, write, env, stdin)` for `show`, `measure`, and `guard`. Its renderers follow sections 3.9 to 3.11.
- New file `apps/cli/src/root.ts` (Part B): `runRootCommand(args, cwd, home, write, io)` for `add`, `list`, and `remove`, through `runApprovalCommand` (`apps/cli/src/confirm.ts:74`).
- `apps/cli/src/main.ts:122-127` (`helpText`): the help routes of section 3.13. Add `'slice'` to the noun list at line 125.
- `main.ts:132` (`COMMANDS`): add `'context'`, `'slice'`, and `'root'`.
- `main.ts:152-157`: route `slice` to `runCreateCommand`.
- `main.ts`, after the `apply` branch at line 173-177: route `context` to `./context.js` and `root` to `./root.js`. The `context guard` route reads stdin and writes stdout only.
- `apps/cli/src/human.ts`: the help text of section 3.13, and the `REFUSALS` entries of section 5 at line 224.
- `apps/cli/src/held.ts:15`: `HeldItem.kind` gains `'slice'`. `planHolds` (`held.ts:42-47`) takes the slices too.
- `apps/cli/src/project-status.ts:41` (`editedFiles`): name the edited slice files, as for prompts. Lines 44-45 pass `plan.slices` to `planHolds`, and add the stale-index lines. Line 53 prints them.
- `apps/cli/src/up.ts:148,150,173`: the step text, the `planHolds` call, and the end line of section 3.12.
- `apps/cli/src/ls.ts:11` (`SECTIONS`): add `'slices'`. `ls.ts:42-55` (`entries`): a `slice` mode that lists `<id>.yaml` files. `ls.ts:58-64` (`listProject`) and `ls.ts:86-87` (usage).

### 6.7 Build and tests

- `package.json:30` (`test`) and `package.json:53` (`test:project`): add `packages/context-slices/test/*.test.mjs`. `tools/check-test-patterns.mjs` fails on a glob that matches no file, so add the glob with the first test file.
- Every other new test file sits inside an existing glob of `package.json:30`. The builder checks each one, as rule 5 of the README says.

## 7. Edge cases

1. `.bowerloom/slices` does not exist. Result: no slice lines, no error.
2. `.bowerloom/slices` is a link, or writable by others. Result: refusal `AUTHORING_UNSAFE_PATH`.
3. 65 registered slices. Result: refusal `SLICE_LIMIT`.
4. A registered slice file is deleted. Result: hold `AUTHORING_ITEM_MISSING`. An installed index stays.
5. A slice file has a duplicate key or an alias. Result: hold `SLICE_INVALID`. Other items apply.
6. A slice file has the key `includes` (a typo). Result: hold `SLICE_KEY_UNKNOWN`, naming the key.
7. A pattern `[abc].md`. Result: hold `SLICE_INVALID`. `slice create --include '[abc].md'` refuses `USAGE`.
8. `root: ../other`. Result: hold `SLICE_INVALID`.
9. The project root folder `wiki` is deleted. Result: hold `SLICE_PATH_MISSING`, naming `wiki`.
10. A literal include `index.md` is renamed. Result: hold `SLICE_PATH_MISSING`, naming `index.md`. The installed index stays.
11. A file matched by `wiki/**/*.md` is renamed. Result: `update slice` with `1 added, 1 gone`.
12. A file matched by a glob is deleted after apply. Result: `status` prints the stale-index line. `context show` says `installed and out of date`. The next apply plans `update`.
13. A member's body changes and its heading does not. Result: `slice up to date`. The agent reads the new text.
14. A member's first heading changes. Result: `update slice` with `1 summaries changed`, and a new revision.
15. A member changes between plan and approval, and its heading does not. Result: the approval still applies.
16. A member changes while apply reads it. Result: refusal `STALE_APPROVAL` with the slice text.
17. A slice selects no file. Result: hold `SLICE_EMPTY`.
18. A slice selects 257 files with `maxFiles` absent. Result: hold `SLICE_TOO_LARGE`.
19. A slice of 400 files whose index passes 65536 bytes. Result: hold `SLICE_TOO_LARGE`. With `summary: none` it may fit.
20. A member is a link. Result: hold `SLICE_SOURCE_UNSAFE`, naming the path.
21. A member has two hard links. Result: hold `SLICE_SOURCE_UNSAFE`.
22. A folder under the root is group-writable and matched by a pattern. Result: hold `SLICE_SOURCE_UNSAFE`.
23. A matched file is a PNG. Result: left out, and the not-text note counts it.
24. A matched path holds a backtick. Result: left out, and the note counts it.
25. A file of 2 MiB is matched. Result: listed with no summary, and the oversize note names it.
26. `where: { status: current }` and a page with frontmatter that does not parse. Result: left out, and the note names it.
27. `where` and a `.txt` member. Result: the `.txt` file never matches.
28. `where: { tags: research }` and a page with `tags: [research, ops]`. Result: it matches.
29. `[[overview]]` with three `overview.md` files under the root. Result: not followed, and the ambiguous count is 1.
30. `[[missing-page]]`. Result: not followed, and the unresolved count is 1.
31. A wikilink inside a fenced code block. Result: ignored.
32. `[x](../../outside.md)` that leaves the root. Result: not followed.
33. A linked file that `exclude` matches. Result: not added.
34. `links.depth: 2` with a cycle `a` to `b` to `a`. Result: each file once.
35. The root holds `.obsidian` and `.bowerloom`. Result: never walked, never members.
36. Two slices with the same root. Result: each has its own index. The guard of an agent that names both allows the union of members.
37. A skill named `slice-wiki` in `skills.json` and a slice `wiki`. Result: refusal `APPLY_NAME_COLLISION`.
38. `skill create slice-x`. Result: refusal `SKILL_NAME_RESERVED`.
39. `prompt create slice-x`. Result: refusal `PROMPT_NAME_INVALID`.
40. An old `skills.json` entry `slice-old` and no slice `old`. Result: it parses and installs as before. An agent that names `slice-old` loads that skill, with no warning.
41. An agent names `slice-wiki`, and no slice `wiki` is registered. Result: the unknown warning. The agent installs.
42. An agent names a slice entry at position 33 of `skills`. Result: the preload warning. The measure does not count it.
43. An agent names a slice with `guard: none` only. Result: no guard in the copy, no guard notes.
44. An agent names one slice with `guard: root` and one with `guard: none`. Result: the guard lists both ids. Only the first root is a guarded area.
45. An agent names a slice that is held for `SLICE_INVALID`. Result: the slice counts as guarded. The guard denies every call with `GUARD_SLICE_NOT_INSTALLED` until the slice installs.
46. An agent source has `hooks: { PreToolUse: [...] }`. Result: the guard entry is appended after the source's entries.
47. An agent source has `hooks: []`. Result: hold `AGENT_GUARD_CONFLICT`.
48. A hand-made `.claude/agents/<role>.md` that equals the source, for an agent whose copy gets a guard. Result: hold `AGENT_TARGET_OCCUPIED`, because the expected copy differs.
49. A slice gains `guard: none`. Result: `update slice (0 added, 0 gone, 0 summaries changed, guard changed)`, and each agent that names only that slice plans `update agent` without the guard.
50. `--harness codex` with slices. Result: no slice lines, the Codex line, no kept lines.
51. `--team a` with a slice that only team `b` names. Result: the slice is not planned and not shown as kept.
52. A slice that no agent names. Result: it is planned and installed with no team filter.
53. `.claude/skills/slice-wiki` exists and was not installed by Bowerloom. Result: hold `SLICE_TARGET_OCCUPIED`.
54. A user edits the installed index. Result: hold `MANAGED_SKILL_LOCAL_DRIFT`. Nothing is overwritten.
55. Interrupt between a slice and an agent. Result: `SKILLS_SYNC_INTERRUPTED`. A rerun finishes.
56. Crash inside a slice transaction. Result: `MANAGED_SKILL_RECOVERY_REQUIRED` with `bowerloom skills recover plan --item slice_<id>`.
57. Guard: Read of a member. Result: no output, exit 0.
58. Guard: Read of a file under the root that is not a member. Result: deny `GUARD_OUTSIDE_SLICE`.
59. Guard: Read of a file outside every guarded area. Result: no output.
60. Guard: Read through a link outside the root that points to a non-member inside the root. Result: deny, because identities are compared.
61. Guard: Read with a case alias of a member path on a case-insensitive disk. Result: allowed, because identities are compared.
62. Guard: Grep with no `path`, and the working folder is the guarded root, which is not covered. Result: deny with the covered folders listed.
63. Guard: Grep of a covered folder. Result: no output.
64. Guard: Grep of the parent of a guarded root. Result: deny.
65. Guard: Glob with pattern `../../secrets/**`. Result: the fixed prefix decides. Inside an area it is denied.
66. Guard: Read of a file that does not exist under the root. Result: deny.
67. Guard: a slice catalog is edited by hand. Result: `currentV2` fails, deny every call with `GUARD_SLICE_NOT_INSTALLED`.
68. Guard: stdin is not JSON. Result: exit 2 with the `GUARD_INPUT_INVALID` text.
69. Guard: `tool_name` is `Bash`. Result: no output. The shell gap note covers it.
70. Guard: the session started at a parent folder with `--add-dir`. Result: deny `GUARD_PROJECT_MISMATCH` when the parent has another `.bowerloom`, or when no project is found.
71. Guard: `bowerloom` is not on `PATH`. Result: Claude Code blocks the call through `onFailure: "block"`.
72. Guard: the folder is not trusted, or the run uses `claude -p`. Result: Claude Code skips the hook. The plan note says so.
73. `context measure` with `--from` above the project. Result: the discovery note for each agent.
74. `context measure` for an agent with `omitClaudeMd: true`. Result: Instructions is 0, and Baseline still counts the instruction files.
75. `context measure` where a preloaded skill lives in a plugin. Result: listed as not found, not counted.
76. `context measure --bytes-per-token 3.5`. Result: the band text says `calibrated by you`, and the JSON says `calibrated: 'user'`.
77. `context measure` run twice on the same tree. Result: the same bytes.
78. `context show` on a held slice. Result: the `Held:` line and no index text.
79. `slice create wiki` when `.bowerloom/slices/wiki.yaml` exists and is not registered. Result: the register plan. The bytes stay.
80. `slice create wiki` when `.bowerloom/slices/Wiki.yaml` exists. Result: refusal `SLICE_EXISTS`.
81. `slice create wiki --team a`. Result: refusal `USAGE`.
82. `slice create wiki --named-root kb` in Part A. Result: refusal `USAGE` with the Part B text.
83. A config-only project of spec 03 with no `.bowerloom`. Result: `slice create` refuses with the code it already uses for a missing `.bowerloom` (03 section 3.7).
84. (Part B) `root add kb ~/Sage Advice/knowledge-base`. Result: the plan registers `Sage Advice/knowledge-base`.
85. (Part B) `root add kb ~`. Result: `ROOT_UNSAFE`.
86. (Part B) `root add kb ~/Library/Mobile Documents/x`. Result: `ROOT_IN_CLOUD_FOLDER`.
87. (Part B) `root add kb` with a folder reached through a link. Result: the real path is registered. A link at the registered path later gives `SLICE_ROOT_UNSAFE`.
88. (Part B) `root add kb` with a group-writable folder above the root, below home. Result: `ROOT_UNSAFE`.
89. (Part B) `root add kb ~/.bowerloom/teams`. Result: `ROOT_UNSAFE`.
90. (Part B) `root add kb` twice. Result: the second refuses `ROOT_EXISTS`.
91. (Part B) A slice names root `kb`, and `kb` is removed. Result: hold `SLICE_ROOT_MISSING`. The installed index stays. The guard of its agents denies every call with `GUARD_ROOT_MISSING`.
92. (Part B) The store syncs to a machine where `~/Sage Advice/knowledge-base` does not exist. Result: hold `SLICE_ROOT_MISSING` on that machine.
93. (Part B) A named root folder sits inside the project. Result: hold `SLICE_ROOT_UNSAFE`, with the next step to use a project root.
94. (Part B) A named root holds the project. Result: allowed. Hidden folders, `.bowerloom` included, are skipped.
95. (Part B) A named root is outside the session's working folders. Result: the plan note about `--add-dir` and `permissions.additionalDirectories`.
96. (Part B) A crash during `root add` after the temporary file. Result: `root list` ignores the temporary file. The next `root add` removes it.

## 8. Migration from beta.2

- Beta.2 has no slices, no roots, and no guard. A beta.2 project plans as before until a person creates a slice.
- A receipt that holds a slice item cannot be read by a 0.7.0-beta.2 CLI. It refuses with `AUTHORING_RECEIPT_INVALID`. The release note says so, as 01a does for agent catalogs.
- A catalog named `slice_<id>.json` makes the beta.2 catalog parser refuse, as 01a describes for `agent_` (01a section 4.4).
- A skill or prompt created in beta.2 whose id starts with `slice-` keeps working. Only new ids are refused. A collision with a new slice of the same name refuses `APPLY_NAME_COLLISION`, and the person renames one of them.
- An agent that names a slice with `guard: root` gets a copy that differs from its source. A hand-made copy equal to the source is held with `AGENT_TARGET_OCCUPIED`. The person moves it aside, as 01a section 8 says.
- A slice file that a person placed by hand before this spec is not registered. Apply skips it with a note. `bowerloom slice create <id>` registers it with its bytes.
- The workbench research-desk agents load two AGENTS.md files today. After this spec, the measure shows that cost, and the plan note proposes `omitClaudeMd: true`. Nothing changes until the person edits the agent file.

## 9. Docs changes

All paths are under `apps/docs/src/content/docs/`.

- New page `guides/context-slices.md`, with the frontmatter `title: Context slices for agents`, `description: Give each agent only its part of a knowledge base, and measure the difference.`, `section: Guides`, and `order: 7.9`. The docs build groups pages by `section` and sorts them by `order` (`apps/docs/src/lib/content.mjs:90`). It holds:
  - What a slice is, and why the files stay in place.
  - The slice file with every key, the pattern language, and the limits.
  - `slice create`, then naming `slice-<id>` in an agent's `skills` list, then `apply`.
  - `omitClaudeMd`, with the measured difference as an example.
  - The guard: what it blocks, the trust rule, `claude -p`, the `PATH` rule, the Claude Code version, and the list of section 3.9.4 under the heading "What the guard does not stop". It states that a slice and its guard limit context and are not a security boundary.
  - Named roots, `root add`, and the `--add-dir` note.
  - `context show` and `context measure`, the unit, the estimate band, calibration, and the list of what the measure cannot prove.
  - The Codex sentence of section 3.15.
- `cli.md`, section `## Create commands` (line 75): add `slice create`. Add a new section `## Context` with `context show`, `context measure`, and `context guard`. Add a section `## Roots` with Part B.
- `cli.md`, section `## Apply` (line 85): one paragraph on slices, the index skill, the guard, and the Codex sentence.
- `reference/errors.md`: a new table `## Context slice refusals` with one row per code of section 5. The columns follow the other tables.
- `guides/add-skills.md:282`: add the slice codes to the list, and say that `slice-` ids are reserved.
- `guides/create-items.md`: one paragraph on `slice create`.
- `guides/index.md:12-21`: a row `Give each agent its part of a knowledge base` that links the new page.
- `concepts/teams-and-files.md`: one sentence that `.bowerloom/slices/` holds slice files, and that apply writes `.claude/skills/slice-<id>`.
- `harnesses.md`: one sentence that context slices are projected for Claude Code and not for Codex.
- `security.md`: one paragraph that the guard limits what Read, Grep, and Glob reach, that shell tools are not checked, and that it is not a security boundary.
- `status.md`: one bullet that `status` names edited, held, and out-of-date slices.
- `releases.md`, under `## 0.7.0-beta.3`, add:
  - `bowerloom slice create` makes a context slice. `apply` turns it into the skill `slice-<id>`, a list of paths that an agent loads at start. Only titles are copied.
  - An agent whose copy names a guarded slice gets the read guard, `bowerloom context guard`, as a `PreToolUse` hook. It checks Read, Grep, and Glob. It does not check shell commands.
  - `bowerloom context measure` compares each agent's context at start with a full load of the knowledge base. Bytes are exact. Tokens are an estimate.
  - `bowerloom context show` previews a slice.
  - `bowerloom root add` registers a folder outside the project for slices. (Part B)
  - Ids that start with `slice-` are reserved for new skills and prompts.
  - A project that holds slices cannot be read by a 0.7.0-beta.2 CLI.

## 10. Acceptance tests

Write the tests first. Each line below is one test case.

### 10.1 `packages/context-slices/test/glob.test.mjs`

1. `**` matches zero segments: `a/**/b.md` matches `a/b.md`.
2. `**` matches many segments: `a/**/b.md` matches `a/x/y/b.md`.
3. `*` does not cross `/`: `a/*.md` does not match `a/x/b.md`.
4. `?` matches one character inside a segment.
5. A wildcard never matches a segment that starts with `.`.
6. `\*` matches a literal `*`.
7. `[`, `{`, and a leading `!` are refused.
8. A leading `/`, a leading `./`, an empty segment, and `..` are refused.
9. `canMatchBelow('wiki/**/*.md', 'wiki/x')` is true and `canMatchBelow('wiki/**/*.md', 'research')` is false.
10. `isLiteral('index.md')` is true and `isLiteral('*.md')` is false.
11. Matching uses NFC: a decomposed name matches its composed pattern.

### 10.2 `packages/context-slices/test/slice-file.test.mjs`

1. Each key passes with a valid value.
2. Each value rule fails with `SLICE_INVALID` for one bad value, one case per key.
3. An unknown key is `SLICE_KEY_UNKNOWN`, and a key with unsupported characters gets the fixed phrase.
4. A missing `format`, `description`, or `include` is `SLICE_INVALID`.
5. A byte order mark, a carriage return, and a null byte each give `SLICE_INVALID`.
6. A file of 16385 bytes gives `SLICE_INVALID`.
7. A duplicate key, an alias, and a merge key each give `SLICE_INVALID`.
8. `root: .` and `root: { named: kb }` give the defaults of section 4.1.
9. `root: ../x`, `root: .hidden`, and `root: /abs` give `SLICE_INVALID`.
10. `isSliceId` accepts 57 characters and refuses 58.
11. `summary: frontmatter:title` parses, and `summary: frontmatter:` fails.

### 10.3 `packages/context-slices/test/resolve.test.mjs`

1. Include then exclude gives the expected sorted members.
2. Hidden folders are never walked.
3. A literal that matches nothing holds with `SLICE_PATH_MISSING`.
4. A glob that matches nothing gives an `emptyPatterns` note.
5. `where` with AND across keys and OR within a list.
6. `where` on a list value matches any element.
7. Unparseable frontmatter is left out and named in `unparsed`.
8. A `.txt` file never matches `where`.
9. A wikilink with a unique stem is followed.
10. A wikilink with two matching stems counts as ambiguous.
11. A wikilink with no match counts as unresolved.
12. A wikilink with `/` resolves as a path.
13. A markdown link with `#anchor` and `%20` resolves.
14. A markdown link that leaves the root is not followed.
15. Links in fences and inline code are ignored.
16. Depth 2 follows two hops, and a cycle adds each file once.
17. A linked file that `exclude` matches is not added.
18. A member that is a link holds with `SLICE_SOURCE_UNSAFE`.
19. A member with two hard links holds with `SLICE_SOURCE_UNSAFE`.
20. A group-writable walked folder holds with `SLICE_SOURCE_UNSAFE`.
21. A non-UTF-8 file is left out and counted.
22. A path with a backtick is left out and counted.
23. A file over 1 MiB is listed without a summary, and its links are not followed.
24. 257 members hold with `SLICE_TOO_LARGE`.
25. More than 8192 walked entries hold with `SLICE_TOO_LARGE`.
26. Zero members hold with `SLICE_EMPTY`.
27. A covered folder is reported when all its files are members.
28. A folder with a hidden file is not covered.
29. A folder with a pruned subfolder is not covered.
30. The root is covered as `./` when all its files are members.
31. A file changed during the read is detected.

### 10.4 `packages/context-slices/test/render.test.mjs`

1. Golden bytes for a project root `.` slice with headings.
2. Golden bytes for a project root `wiki` slice.
3. Golden bytes for a named root slice with `../knowledge-base/wiki` paths.
4. The guard line appears for `guard: root` and not for `guard: none`.
5. `summary: none` gives path-only lines.
6. A description with a colon and quotes is written as a JSON string and parses back equal.
7. A summary of 200 characters is cut to 160.
8. A path with spaces renders inside backticks.
9. No output holds an absolute path, a hash, or a size.
10. The same input gives the same bytes twice.
11. `sliceTemplate` output passes `parseSlice` for a project root, a named root, and three patterns.

### 10.5 `packages/context-slices/test/guard-decide.test.mjs`

1. Read of a member is silent.
2. Read of a non-member under a guarded root is denied with `GUARD_OUTSIDE_SLICE`.
3. Read outside every area is silent.
4. Read through an outside link to a non-member inside is denied.
5. Read of a case alias of a member is silent.
6. Read of a missing file under a root is denied.
7. Grep of a covered folder is silent.
8. Grep of a member file is silent.
9. Grep of an uncovered folder inside an area is denied, and the reason lists covered folders.
10. Grep of a folder that holds an area is denied.
11. Grep with no path takes `cwd`.
12. Glob with `../` in the pattern uses the fixed prefix.
13. A member of a `guard: none` slice with the same root is allowed.
14. A root of a `guard: none` slice is not an area.
15. A missing slice catalog denies every target with `GUARD_SLICE_NOT_INSTALLED`.
16. A missing root denies every target with `GUARD_ROOT_MISSING`.
17. A tool other than the three is silent.
18. No decision is ever `allow`.

### 10.6 `packages/context-slices/test/instructions.test.mjs`

1. A CLAUDE.md anywhere in the chain stops AGENTS.md from counting.
2. Without CLAUDE.md, AGENTS.md counts at every level.
3. `@path` imports count to four hops and stop at the fifth.
4. An import inside a code span or a fence is skipped.
5. An import of a path with a backslash and a space resolves.
6. A rule with no `paths` counts at start, and a rule with `paths` does not.
7. `omitClaudeMd` gives zero at start.
8. A subfolder AGENTS.md between `--from` and a member counts on demand.

### 10.7 `packages/context-slices/test/estimate.test.mjs`

1. `estimateTokens(10, 4000)` is 3.
2. `estimateTokens(0, 4000)` is 0.
3. `estimateTokens(7, 3500)` is 2.
4. `ratioPpm` floors.
5. `formatThousands(2848912)` is `2,848.9k`.
6. `formatPercent(8512)` is `0.85%`.

### 10.8 `packages/managed-skills/test/v2-slice.test.mjs`

1. `locateV2` for a slice gives `projection-claude` at `.claude/skills/slice-<id>` and `catalog`, and nothing else.
2. `requestV2` refuses a slice request whose harness list is not `['claude']`.
3. `requestV2` refuses a named root `dir` that equals or sits inside `projectDir`.
4. `requestV2` refuses an agent source without the `guard` key.
5. `itemId` gives `slice_wiki`.
6. `catalogItem('slice_wiki.json')` is kind `slice`, and `catalogItem('slice-wiki.json')` is a skill.
7. `readClosure` for a slice gives one file `SKILL.md`, `skill === null`, and the references.
8. `materialV2` writes the index into the projection folder.
9. The catalog holds `references` and the slice source, and no absolute path.
10. `sameSource` accepts a root change for a slice.
11. A transaction installs, updates, and rolls back a slice, as the prompt tests do.
12. `readLocalSlice` refuses a named root whose identity differs from the request.

### 10.9 `packages/managed-skills/test/agent-copy-guard.test.mjs`

1. `claudeCopyBytes(source, { guard: null })` returns the source.
2. A source without `hooks` gains the guard entry. The output parses, and every other key is equal.
3. A source with `hooks.PreToolUse` keeps its entries and gains the guard entry last.
4. A source with a comment in its frontmatter keeps the comment.
5. The body bytes after the closing fence are unchanged.
6. The output is the same for the same input.
7. `hooks: []` throws the `AGENT_GUARD_CONFLICT` signal.
8. The args list the slices in sorted order.
9. Golden text for the two cases of section 4.6.

### 10.10 `packages/project-authoring/test/slice-create.test.mjs`

1. `slice create wiki` plans one file with the template bytes and registers it.
2. Apply writes the file and the receipt lists kind `slice`.
3. `--root wiki --include 'a/*.md' --include b.md` writes those values.
4. An existing unregistered valid file gives the register plan, and apply keeps its bytes.
5. An existing unregistered invalid file refuses `SLICE_INVALID`.
6. A registered slice refuses `SLICE_EXISTS`.
7. A registered slice whose file is gone refuses `AUTHORING_ITEM_MISSING`.
8. `Wiki.yaml` beside `slice create wiki` refuses `SLICE_EXISTS`.
9. A 58-character id refuses `SLICE_NAME_INVALID`.
10. A crash after the move plans `Finish slice wiki`.
11. A crash before the move plans the clear line.
12. `skill create slice-x` refuses `SKILL_NAME_RESERVED`, and `prompt create slice-x` refuses `PROMPT_NAME_INVALID`.
13. An old receipt with a skill `slice-old` still parses.
14. `slice-id-parity`: `isSliceId` in authoring equals `isSliceId` in context-slices for 20 ids.

### 10.11 `packages/project-authoring/test/slices-owner.test.mjs`

1. A registered valid slice folder verifies as `verified`.
2. An edited registered slice is `edited`.
3. An unregistered file refuses `AUTHORING_UNREGISTERED`.
4. A registered file that fails `parseSlice` refuses `SLICE_INVALID`.
5. A link in `slices/` refuses `AUTHORING_UNSAFE_PATH`.

### 10.12 `packages/project-sync/test/slices-plan.test.mjs`

1. A new slice plans the exact install line with the file count.
2. After apply, the plan says `slice up to date` and `Nothing to change.`
3. A body-only edit keeps the revision.
4. A heading edit plans `update slice` with `1 summaries changed`, and a new revision.
5. A glob rename plans `1 added, 1 gone`.
6. A literal rename holds `SLICE_PATH_MISSING`, and a prompt in the same plan installs.
7. A root change plans `root changed`.
8. A guard change plans `guard changed`.
9. An unregistered file prints the skip note, and the plan lists it in `unregisteredSlices`.
10. A deleted registration plans `slice kept`.
11. 65 registered slices refuse `SLICE_LIMIT`.
12. An unsafe `slices` folder refuses `AUTHORING_UNSAFE_PATH`.
13. `SLICE_TARGET_OCCUPIED` holds with the exact next step.
14. `APPLY_NAME_COLLISION` for a skill `slice-x` and a slice `x`.
15. `--team` plans only the slices the team's agents name, and shows no kept line for others.
16. `--harness codex` gives no slice line, the combined Codex line, and `codexSlicesSkipped: true`.
17. Every note of section 3.7.3 renders exactly, each in its case.
18. The title and the empty text of section 3.7.3.
19. JSON keeps format `v1beta2` and holds `slices`, `codexSlicesSkipped`, and `unregisteredSlices`.
20. A member that changes during the plan refuses `STALE_APPROVAL` with the slice text.
21. A named root in Part A holds `SLICE_ROOT_MISSING` with the Part A next step.

### 10.13 `packages/project-sync/test/slices-agents.test.mjs`

1. An agent with `skills: slice-wiki` gets `context.slices: ['wiki']`.
2. An unknown `slice-` name prints the warning and fills `context.unknown`.
3. A `slice-old` that resolves to a plain skill gives no warning and fills `context.plainSkills`.
4. A slice entry at position 33 prints the preload warning.
5. A guarded slice puts the guard in the copy and prints the guard note.
6. A `guard: none` slice puts no guard in the copy.
7. Mixed guard modes list both ids in the args.
8. A held `SLICE_INVALID` slice still counts as guarded.
9. Without `omitClaudeMd`, the omit note prints.
10. With `tools: Read, Grep, Glob`, no read-gap note prints.
11. With `tools` absent, the read-gap note names shell tools, LSP, and nested agents.
12. A change of guard list plans `update agent`.
13. A hand-made copy equal to the source holds `AGENT_TARGET_OCCUPIED` when the copy gets a guard.
14. `hooks: []` holds `AGENT_GUARD_CONFLICT`.
15. `STALE_APPROVAL` when a slice's guard mode changes after the plan.

### 10.14 `packages/project-sync/test/slices-apply.test.mjs`

1. Apply writes `.claude/skills/slice-<id>/SKILL.md` with the rendered bytes.
2. Apply writes no member text under `.claude` or `.bowerloom/managed`. A scan for a member sentence finds nothing.
3. The catalog names kind `slice`, harnesses `["claude"]`, the source, and the references.
4. Slices apply before agents in phase C.
5. Interrupt between a slice and an agent leaves the slice complete and the agent untouched.
6. A crash inside a slice transaction leaves the marker, and `skills recover plan --item slice_<id>` resumes it.
7. A drifted index holds `MANAGED_SKILL_LOCAL_DRIFT`, and nothing is overwritten.
8. Apply never removes an index when the slice is unregistered.
9. Apply writes nothing under `.agents` for a slice.

### 10.15 `packages/project-sync/test/context-measure.test.mjs`

1. The fixture gives the exact byte counts of each column.
2. `omitClaudeMd` makes Instructions zero and leaves Baseline unchanged.
3. A preload beyond 32 is not counted.
4. A missing skill is listed and not counted.
5. The baseline folder default is the deepest common folder of the slice roots.
6. The baseline skips hidden entries and links and counts them.
7. Ratios are integer parts per million.
8. `reference.unslicedStartBytes` equals the start without slice indexes.
9. `mentioned` lists backtick paths that exist and adds them to no sum.
10. Two runs give equal JSON bytes.
11. A held slice is reported and not counted.
12. An out-of-date installed index is reported.

### 10.16 `packages/project-context/test/roots.test.mjs` (Part B)

1. `root add` plans the exact lines and the store-create line when the store is absent.
2. Apply writes the exact registration bytes with mode 0644.
3. A second `root add` with the same name refuses `ROOT_EXISTS`.
4. A case alias name refuses `ROOT_EXISTS`.
5. Home refuses `ROOT_UNSAFE`.
6. A folder outside home refuses `ROOT_UNSAFE`.
7. A cloud folder refuses `ROOT_IN_CLOUD_FOLDER`.
8. A group-writable parent below home refuses `ROOT_UNSAFE`.
9. A hidden segment refuses `ROOT_UNSAFE`.
10. A folder inside the store refuses `ROOT_UNSAFE`.
11. A registration with an extra key reads as `ROOT_INVALID`.
12. A registration that is a link reads as `ROOT_UNSAFE`.
13. A leftover temporary file is ignored by `root list` and removed by the next `root add`.
14. `root remove` removes only the file and keeps the folder.
15. `root remove` refuses `STALE_APPROVAL` when the file changed after the plan.
16. `resolveNamedRoot` returns the real path, the identity, and the registration sha256.

### 10.17 `tests/slice-create-cli.test.ts`

1. `bowerloom slice create wiki` prints the plan and exits 3.
2. `--approve <revision>` writes the file and exits 0.
3. `--json` prints the plan JSON.
4. `slice create` with no name exits 2 with the usage text.
5. `slice create wiki --team a` exits 2.
6. `help slice` prints `TOPICS.slice`.

### 10.18 `tests/context-cli.test.ts`

1. `context show wiki` prints the exact text and the index.
2. `context show missing` refuses `CONTEXT_SLICE_NOT_FOUND`.
3. `context measure` prints the exact table for the fixture.
4. `context measure --json` matches the fixture JSON.
5. `context measure --agent nobody` refuses `CONTEXT_AGENT_NOT_FOUND`.
6. `context measure --baseline /nonexistent` refuses `CONTEXT_BASELINE_INVALID`.
7. `context measure --from <parent>` prints the discovery note.
8. `context measure` makes no network call and writes nothing (a folder snapshot before and after).
9. `help context` prints `TOPICS.context`.

### 10.19 `tests/context-guard-cli.test.ts`

1. The CLI with stdin of a member Read prints nothing and exits 0.
2. The CLI with stdin of a non-member Read prints the exact deny JSON and exits 0.
3. Invalid stdin exits 2 with the exact stderr text.
4. `--project '${CLAUDE_PROJECT_DIR}'` with the environment variable set finds the project.
5. A project without `agent_<role>` denies with `GUARD_PROJECT_MISMATCH`.
6. `--explain <path>` prints the exact allowed and denied lines.
7. Twenty calls each finish within 2000 ms, and the test prints the 50th and 95th percentile.
8. The guard writes nothing (a folder snapshot before and after).

### 10.20 `tests/root-cli.test.ts` (Part B)

1. `root add kb <folder>` prints the plan and exits 3.
2. `root list` prints the exact lines for ready, missing, and refused roots.
3. `root list --json` prints format `bowerloom/root-list/v1beta1`.
4. `root remove kb` prints the plan and exits 3.
5. `help root` prints `TOPICS.root`.

### 10.21 `tests/apply-slices-cli.test.ts`

1. `renderApplyReview` golden text for install, update, up to date, kept, and held slices.
2. Golden text for the agent warnings and notes of section 3.7.3.
3. The result words for slices.
4. `bowerloom status` prints the edited, held, and stale-index slice lines.
5. `bowerloom ls slices` lists the slice files, and `ls --json` holds `slices`.
6. `bowerloom up --team <name>` stops at the apply step with the new step text when a slice is the only work.
7. `bowerloom help apply` shows the slice sentences.
8. Every code of section 5 has words in `human.ts` and a row in `errors.md`.

### 10.22 Existing tests that change

1. 01a's `tests/apply-cli.test.ts` title assertions take the new title of section 3.7.3.
2. 01a test 10.5.23 (`claudeCopyBytes` returns its input) passes `{ guard: null }`.
3. 01a test 10.1.2 expects the agent source key list `['kind', 'team', 'name', 'guard']`.
4. `tests/help-human.test.ts` takes the new first screen.
5. `tests/human-refusal.test.ts` covers the new codes through `SYNC_REFUSAL_CODES` and `AUTHORING_REFUSAL_CODES`.
6. `tests/freeze-cli-words.test.ts` pointer assertions take the slice sentence.
7. `tests/no-spawn.test.ts:119`: the `up` and `apply` run adds a slice and an agent that names it, and asserts the index exists, with zero spawn and zero network calls.

## 11. Build order

Part A needs only 01a. Part B needs spec 03 and spec 04 merged into `release/0.7.0-beta.3`.

Part A:

1. Wait for 01a to merge. Rebase on `release/0.7.0-beta.3`.
2. Write the tests of 10.1 to 10.15, 10.17 to 10.19, 10.21, and 10.22, failing. Add the `package.json` globs.
3. `packages/context-slices`: glob, frontmatter, slice-file, links, resolve, render (10.1 to 10.4).
4. `estimate` and `instructions` (10.6, 10.7).
5. `guard.ts` (10.5).
6. managed-skills: types, `itemId`, `itemRef`, `requestV2`, `locateV2`, `readClosure`, `sameSource`, `catalogItem`, `readLocalSlice`, `claudeCopyBytes` (10.8, 10.9).
7. project-authoring: state, create, refusal, owner, reserved ids (10.10, 10.11).
8. project-sync: `slices.ts`, the agent context, `apply-project.ts`, `recover.ts`, `refusal.ts` (10.12 to 10.14).
9. The guard command in `apps/cli/src/context.ts`, and the latency check of section 3.9.3 (10.19). If the 95th percentile is above 300 ms, apply the import change of section 12 item 8.
10. `context-measure.ts`, `context show`, `context measure` (10.15, 10.18).
11. CLI: `apply.ts`, `create.ts`, `held.ts`, `project-status.ts`, `up.ts`, `ls.ts`, `main.ts`, `human.ts` (10.17, 10.21, 10.22).
12. Docs of section 9, without the Part B lines.
13. Run the gates. Open the pull request for Part A into `release/0.7.0-beta.3`, unless Hanna picks option A of new decision 2.

Part B:

14. Wait for specs 03 and 04 to merge. Rebase.
15. Write the tests of 10.16 and 10.20, and the named-root cases of 10.3, 10.4, 10.5, 10.8, and 10.12, failing.
16. `packages/project-context/src/roots.ts` and its codes (10.16).
17. Named roots in `resolveSlice` callers, `readLocalSlice`, the guard, `slice create --named-root`, and the plan note (10.3, 10.5, 10.8, 10.12).
18. `apps/cli/src/root.ts`, `main.ts`, `human.ts` (10.20).
19. Docs of section 9 for Part B.
20. Run the gates. Open the pull request for Part B.

## 12. Unverified items

Each item names the check and the fallback. The builder runs the check first.

1. **`${CLAUDE_PROJECT_DIR}` in frontmatter hook args.** The hooks page says exec form substitutes placeholders in `args`. It does not show this for agent frontmatter. Check: a trusted scratch project, a guarded agent, and `claude --debug`, reading the args the hook received. Fallback: the guard already takes the environment variable and then `cwd` (section 3.9.1 step 4). No change is needed.
2. **Exec form (`args`) and `onFailure` in agent frontmatter.** The pages show them in settings files and say that subagents use the same format. Check: the same scratch run, with `bowerloom` removed from `PATH`. The Read must be blocked. Fallback for `args`: shell form, `command: bowerloom context guard --agent <role> --project "${CLAUDE_PROJECT_DIR}" --slice <id>`. The ids and roles are plain ids, so no quoting is needed beyond the placeholder. Fallback for `onFailure`: the guard turns every internal error into a deny. Only a guard that cannot start lets a call through. The docs page says so.
3. **Comments and key order survive `yaml` 2.9.1 `Document` round trips.** Check: test 10.9.4. Fallback: when the source has no `hooks` key, append the guard block as text before the closing fence. When it has one, use the `Document` path and accept the formatting change. Tell Hanna in the pull request.
4. **Grep and Glob on hidden files.** The docs do not say whether the Grep and Glob tools search hidden files. The covered rule already excludes folders with hidden entries, so either answer is safe. No fallback is needed.
5. **Whether a subagent's frontmatter hook fires for the tool calls of a nested subagent.** Not documented. Section 3.9.4 treats it as not guarded. Check: the scratch run with a guarded agent that starts a general-purpose subagent. If the hook does fire, remove `nested agents` from the read-gap note.
6. **Preloading a `user-invocable: false` skill.** The skills page says the field hides a skill from the menu and that Claude can still use it. The sub-agents page says preloading draws from the skills Claude can invoke. Check: the scratch run, asking the agent to quote its index. Fallback: drop `user-invocable: false` from the index. Each slice then also shows in the `/` menu.
7. **Whether preloaded skill text includes its frontmatter.** Not documented. The measure counts the whole file, an upper bound, and says so in `assumptions`. No fallback is needed.
8. **Guard latency.** `apps/cli/src/main.ts:2-12` imports controller, session, crew, and authoring modules at the top, before `main` runs. Check: test 10.19.7. Fallback: move the imports of lines 8, 9, 11, and 12 into the branches that use them, with dynamic `import()`, as `ls` and `apply` already do (`main.ts:145,174`).
9. **Reads outside the working folders.** The permissions page says that files in the launch folder and in added folders are readable, and that other reads can ask. The exact behavior in each permission mode for a subagent is not tested. The plan note names `--add-dir` and `permissions.additionalDirectories`. No fallback is needed.
10. **The spec 03 and 04 function names.** `inspectStoreWith`, `openStoreWith`, `verifyStorePins`, `pathInsideStore`, and `withStoreForWrite` are names from specs that are not merged. Check: read the merged code before Part B. Fallback: use the merged names. Keep the behavior of section 3.3.
11. **`.claude/rules` files without `paths` under `omitClaudeMd`.** The sub-agents page names CLAUDE.md files only. The measure assumes these rules drop with them, and lists the assumption. Check: the scratch run with `/context` in a session. Fallback: count them at start for every agent, and change the assumption text.
12. **The `/context` output format for calibration.** The docs say `/context` shows a breakdown by category. The guide tells the person to divide a known file's bytes by its tokens there. If the breakdown does not name single files, the guide says to compare the totals with and without one file.
13. **The 30-second managed planning limit** (`LIMITS.duration`, `packages/managed-skills/src/observed.ts:14`). `readLocalSlice` runs inside it. A slice of 256 members with links should finish well within it. Check: a test over 8192 entries. Fallback: if it exceeds the limit, the run refuses `MANAGED_SKILL_TIMEOUT`, and the slice limit in section 4.1 drops until the test passes.

## 13. New decision for Hanna

### Decision 1: what the guard guards

The issue says the guard "blocks Read, Grep, and Glob outside the agent's slices". This spec reads that as root-scoped: it blocks reads under a slice's root that the slice does not list, and leaves other folders alone. A strict reading would block every read outside the slices, which would stop a coding agent from reading its own code.

- A (default): Root-scoped. The guarded area is the root of each `guard: root` slice. Reads elsewhere pass to Claude Code's own rules.
- B: Strict. The agent may read only its slice members, plus the files it wrote in this session. Any other read is blocked. This needs a write log, which this spec does not design.
- C: Both. A slice key `guard: strict` picks B for agents that name it.

It blocks build step 5 (`guard.ts`) and step 9.

### Decision 2: one pull request or two

Named roots need specs 03 and 04, which are in lane 2.

- A: One pull request, opened after specs 03 and 04 merge. Part A waits.
- B (default): Two pull requests from the same branch name. Part A merges after 01a. Part B merges after 04, as a second pull request with the branch `beta3/05-context-slicing-roots`.

It blocks build step 13.
