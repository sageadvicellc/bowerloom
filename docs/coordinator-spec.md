# trellis: coordinator spec

Status: draft, 2026-09-29. Specification only. Nothing here is built, and
the maintainer approves this design before any build starts. Sources are
listed at the end, each with the date it was read. A fact that no source
states is written as a gap.

## Purpose

Trellis has four parts. Each lives in its own repository and has its own
install and start steps today.

- `trellis-crew` launches a crew of agent sessions.
- `trellis-relay` is the message bus between sessions.
- `trellis-roots` is the headless backend.
- `trellis-vines` is the audit trail and trace store.

A fifth repository, `trellis-workbench`, sits beside the four. It is not a
part (section 9.1).

A user who wants all four must learn four sets of steps. This repository
holds the coordinator that removes that work. It has one thin command
line tool, `trellis`, and one config file, `trellis.yml`.

The coordinator does four things:

- `trellis init` sets up the parts that a project uses.
- `trellis up` starts them in the right order.
- `trellis down` stops the parts that `up` started.
- `trellis doctor` checks them.

The coordinator holds no part's logic. Each capability stays in its own
part's repository. It also hosts the Claude Code marketplace for the
whole framework (section 10). Four rules frame this spec:

1. Every part works alone. In particular, `crew up` works with no
   coordinator, and `trellis up` calls it.
2. Config discovery and multi-part startup live here. `trellis-crew` does
   neither.
3. Each part owns its skills, as `skills/<name>/SKILL.md` files in its own
   repository. The coordinator lists them and never edits them.
4. The marketplace ships the tools that make specs. It never ships a
   company's role modules, which are its staff.

Not in scope: the design of any single part, harness flags and harness
permission modes (they belong to `trellis-crew`), fetching parts from a
registry, and any code.

Terms used below:

- A part is one of the four repositories, or any later one that follows
  the contract in section 5.
- The crew part is the enabled part named `crew` in `trellis.yml`.
- The project root is the folder that holds `trellis.yml`.
- The user state folder is `$TRELLIS_HOME`, or `~/.trellis` when that
  variable is unset. It sits outside every project. Section 8 gives the
  rules that it must meet.
- The front part is the one part that runs in the foreground, in the
  terminal where the user ran `trellis up`.
- To read a file as data means to open it and parse it. Reading as data
  never starts a program.
- To run a part means to start any program that a part or its manifest
  names. That includes `manifest`, `version`, `health`, and every other
  operation in section 5.
- An HMAC (keyed hash) is a value made from a key and some content. Only
  a holder of the key can make a value that matches the content.

## 1. How this spec splits from the crew addendum

The crew side is `docs/crew-addendum.md` in `trellis-crew`, at `afb827d`,
the head of pull request 17, which has merged into `main`. This table
gives each topic one owner, and marks each row where that addendum needs
a change.

| Topic | Owner | Where | Crew addendum at `afb827d` |
|---|---|---|---|
| `trellis.yml`, the list of parts, their order | coordinator | sections 3 and 6 | not applicable |
| Finding `trellis.yml` from a project folder | coordinator | section 4 | not applicable |
| Starting and stopping more than one part | coordinator | sections 6 and 6.1 | matches: it starts no other part |
| The part contract: install, configure, health, version | coordinator defines it, each part implements it | section 5 | change 3 |
| `crew.yml`: schema and checks | crew | addendum section 2 | matches |
| Crew repository, role modules, catalog | crew | addendum sections 3 and 4 | change 2 |
| Harness adapters, harness flags, permission modes | crew | addendum sections 5 to 7 | matches |
| Stage folder, skill conversion, harness check | crew | section 10.4 and addendum section 7 | change 4 |
| Front session, background sessions, `spawn`, `down` | crew | addendum sections 1, 5, and 6 | matches |
| Project root when `crew up` runs alone | crew: the folder of its `crew.yml` | section 7 | change 1 |
| Benchmarks and self-improvement loops | `trellis-workbench`, later. Pending decision 11 | section 9.1 | not applicable |
| The skill source files of each part | that part | section 10.1 | not applicable |
| The marketplace file and the `trellis` plugin | coordinator | sections 10.2 and 10.3 | not applicable |

The crew addendum at `afb827d` does not yet hold the four changes below.
A follow-up change to that addendum makes them. Until it lands, this spec
states the boundary from the coordinator's side only.

1. Project root. Addendum sections 1 and 8 define it as the top level of
   the git work tree. The change defines it as the folder that holds the
   `crew.yml` that `up` reads. `up` reads `./crew.yml`, or the file named
   by `--config`. It does not search upward.
2. No download outside `install`. Required before crew ships as a part:
   crew `up` never downloads or fetches. Addendum section 3 lets `up`
   clone `crew.git` and lets `up --update` fetch. The change moves the
   `crew.git` clone and the `--update` fetch into `install`. When the
   cached clone is missing, `up` stops with a message that names the fix.
   Section 5.4 states the contract rule. Tracked as slice D6, "No
   download in `up`: the clone moves to install", in
   `docs/crew-build-plan.md` of
   https://github.com/sageadvicellc/trellis-crew/pull/18 (an open draft).
3. The contract. The crew repository adds a `trellis-part.yml`, and the
   crew CLI adds `version --json` and `health --json` (section 9).
4. Skill conversion and the harness check. The crew CLI adds
   `export-skills` and `check-harness` (section 10.4). `export-skills`
   writes under the output folder it is given, not under the addendum's
   own stage folder in the user's home folder. Both refuse when their
   `--harness` value differs from the `harness` in `crew.yml`.

Both specs call the person who approves a design the maintainer.

## 2. The commands

```
trellis init   [--dir <folder>] [--parts <name,...>]
               [--use <part>=path:<folder> | <part>=bin:<name> ...]
               [--harness <name>|none] [--yes]
trellis up     [--config <file>] [--only <name,...>] [--dry-run] [--yes]
trellis down   [--config <file>] [--only <name,...>] [--yes]
trellis doctor [--config <file>] [--json] [--yes]
```

Every command also takes `--help`. `trellis --version` prints the
coordinator's own version. The user runs each command from a project
folder. The coordinator never assumes a fixed project root.

- `init` creates `trellis.yml` for the chosen parts, then installs and
  configures each part. Section 2.1 gives the steps.
- `up` starts the parts in dependency order and ends with the front part
  in the foreground. Section 6 gives the steps.
- `down` stops the parts that `up` started. Section 6.1 gives the steps.
- `doctor` changes nothing. It reads the config and reports on each part.
  Section 2.2 gives the checks.

Exit codes:

| Code | Meaning for `init`, `up`, and `down` | Meaning for `doctor` |
|---|---|---|
| 0 | Done. Every part was `ok` or `degraded` (`down`: every recorded part stopped). Each `degraded` part was printed as a warning. | Every check passed and every part is `ok`. |
| 1 | A part failed, is down, or is not set up (`down`: a `down` operation failed, or a recorded part has no `down`). | Any static check failed, or any part checked is `degraded`, `down`, or `unconfigured`. |
| 2 | A config or usage error. Nothing ran. | The same. |
| 3 | The user did not confirm, or no terminal was present and `--yes` was not given. Nothing ran. | Every static check passed, and the runtime checks were skipped because nothing was confirmed. |

### 2.1 `init`

1. The folder is `--dir`, or the current folder. If `trellis.yml` exists
   there, `init` does not change it. It only sets up parts the file
   already names. `init` then checks data only. `--harness` names the
   harness for skill setup, or `none` to skip skill setup. There is no
   default. In a terminal with no `--harness`, `init` asks. With no
   terminal and no `--harness`, it exits with code 2. If a crew part
   exists and has `use.path`, `init` reads its manifest as data now. For
   a `--harness` other than `claude-code` and `none`, `init` needs a crew
   part, and it exits with code 2 when that manifest has no
   `export-skills`. If the crew part has `use.bin`, its manifest exists
   only as the output of `<bin> manifest`, so `init` defers these checks
   to step 5.
2. The parts come from `--parts`. In a terminal with no `--parts`, `init`
   shows a checklist. With no terminal and no `--parts`, it exits with
   code 2.
3. Each chosen part needs a source. `--use <part>=path:<folder>` or
   `--use <part>=bin:<name>` gives it, and can repeat. In a terminal,
   `init` asks for any source that is missing. With no terminal and a
   missing source, it exits with code 2.
4. `init` writes `trellis.yml` for the chosen parts. It creates
   `.trellis/` in the project root when that folder does not exist. If
   `.trellis/` exists and breaks a rule of section 4 (a symbolic link, a
   wrong mode or owner, or tracked by git), `init` exits with code 2 and
   touches nothing in it. `init` adds `.trellis/` to the git exclude
   file, which it finds with `git rev-parse --git-path info/exclude`,
   because `.git` is a file in a git worktree. It opens that file without
   following symbolic links. If the file is a symbolic link, `init` skips
   the step and prints a warning. Outside a git work tree it skips the
   exclude step.
5. First confirm screen, only when a part has `use.bin`. `init` shows
   the same screen as `up` step 3 (section 6): each absolute path, its
   SHA-256, and the exact `manifest` command. After yes, it runs each
   `manifest` command and checks each manifest (section 5.1). Then it
   finishes the deferred checks of step 1 for a `bin` crew part, and exits
   with code 2 before any `install` runs when the manifest has no
   `export-skills`. Without a terminal and without `--yes`, it exits with
   code 3.
6. Second confirm screen: `init` prints the plan (section 8) and asks. The
   plan lists every operation that `init` will run, including
   `check-harness`, `export-skills`, `install`, `configure`, and
   `health`. It also names the store path. With `--yes`, `init` prints
   the plan and does not ask, so the log keeps an audit trail. After an
   interactive yes, `init` writes its entry in the trust record. `--yes`
   writes none. A valid trust record skips both screens.
7. With a crew part and a `--harness` other than `none`, `init` runs the
   crew part's `check-harness` operation, including for `claude-code`.
   It runs after the yes in step 6 and before any `install`. It exits
   with code 2 when crew refuses the harness. With no crew part,
   `claude-code` needs no check.
8. For each part in dependency order, `init` runs the part's `install`
   and `configure`, then its `health`, and prints each result.
9. `init` sets up the parts' skills for the chosen harness, as section
   10.4 describes.
10. `init` never starts a part.

### 2.2 `doctor`

`doctor` runs no part unless a valid trust record exists (section 8), or
the user gives `--yes`. With `--yes`, it runs for that call only, writes
no record, and prints both screens without asking. It never writes a
trust record. A record is valid for `doctor` when its `up` entry is valid,
because `doctor` runs only `manifest`, `version`, and `health`.

Static checks. These read data only, and always run.

- A `trellis.yml` was found and passes the section 3 checks.
- Each part resolves. A `path` manifest is read as data and passes the
  section 5.1 checks. A `bin` resolves to an absolute path, which
  `doctor` prints and does not run.
- Each part's dependencies are present in the file.
- Each env var name that a part lists in `env` is set. `doctor` prints
  the name and whether it is set. It never prints a value.
- The user state folder meets the section 8 rules. `doctor` prints the
  store path, and the deny rule that section 8 recommends for it.

Runtime checks. These run only with a valid trust record or `--yes`.

- For a `bin` part, `manifest` runs first, and the manifest passes the
  section 5.1 checks.
- Each part's `version` answers, and its `contract` is one that the
  coordinator supports.
- Each part's `health` answers. The result `ok` passes. The results
  `degraded`, `down`, and `unconfigured` fail the check, and `doctor`
  prints each check that the part reported.

Without a valid record or `--yes`, `doctor` skips the runtime checks and
prints which ones it skipped and why. Its exit code follows the table in
section 2: 2 for a config error, 1 when a static check failed, 3 when
only the runtime checks were skipped. `--json` prints the same report as
one JSON object.

## 3. The config file: `trellis.yml`

```yaml
version: 1
front: crew                     # optional: the one part that runs in the foreground
parts:
  crew:
    use:
      path: ../trellis-crew     # a local folder that holds trellis-part.yml
    config: crew.yml            # the part's own config file, passed by path
  roots:
    use:
      bin: trellis-roots        # a command on PATH
    settings:
      port: 4100                # opaque, passed to the part's configure step
    env: [ROOTS_CALLERS_FILE]   # names of env vars the part needs
```

The values above are examples. The example port is not a decision.

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | Schema version, `1`. |
| `front` | no | The name of the part that runs in the foreground. It must name one entry in `parts` that has a foreground `up`. Without it, `up` ends after every part is started. |
| `parts.<name>` | yes, at least one | One entry per part. The name is lowercase letters, digits, and hyphens. |
| `parts.<name>.use` | yes | Where the part comes from. Exactly one of `path` or `bin`. |
| `parts.<name>.use.path` | one of the two | A local folder that holds `trellis-part.yml`. A relative path resolves against the project root. |
| `parts.<name>.use.bin` | one of the two | The name of a command on `PATH`. The coordinator resolves it to an absolute path. Section 5.1 says how it reads the manifest. |
| `parts.<name>.config` | no | The part's own config file, as a path relative to the project root. The coordinator checks that the file exists and hashes its bytes into the plan. It never parses the file. |
| `parts.<name>.settings` | no | A map that the coordinator does not read. It passes the map to the part's `configure` step. The part validates it. |
| `parts.<name>.env` | no | A list of env var names that the part needs. The file never holds a value. |
| `parts.<name>.enabled` | no | `true` or `false`. Default `true`. A part with `false` is ignored by every command. |

Checks before anything runs. Each failed check prints the file, the
line, the field, and the reason, then exits with code 2.

- The file parses, and `version` is `1`.
- An unknown field fails the check. It is never ignored, so a spelling
  mistake cannot silently change what starts.
- Each part sets exactly one of `use.path` and `use.bin`.
- `use.path` names a folder that holds `trellis-part.yml`. It can point
  outside the project root, because a part usually lives in its own
  clone. The coordinator resolves symbolic links and prints the real
  path on the confirm screen. The trust record stores that real path.
- `front`, when set, names one enabled part.
- Each `config` file exists inside the project root, with no `..`
  segment and no symbolic link that leaves the root.

Rule for authors, not a check: `trellis.yml` holds no secret. A parser
cannot tell a secret from any other string. The only related check is
that `env` holds names.

## 4. Finding the project

The coordinator finds `trellis.yml` in this order. The first hit wins.

1. The file named by `--config`.
2. The file named by the env var `TRELLIS_CONFIG`.
3. A file named `trellis.yml` in the current folder, then in each parent
   folder, up to and including the top level of the git work tree that
   holds the current folder. Outside a git work tree, only the current
   folder is searched.

With no hit, the command exits with code 2. It prints each folder it
searched and points to `trellis init`.

The project root is the folder that holds the file that was found. The
coordinator does the following.

- It resolves every relative path in the file against the project root.
- It runs every part operation with the project root as its working
  directory. The one exception is `manifest` (section 5.1).
- It writes only these things: `trellis.yml` (only in `init`), the folder
  `.trellis/` in the project root, the git exclude file (only in `init`),
  the temporary folder that `manifest` uses (section 5.1), and the trust
  store in the user state folder (section 8). A part writes only what its
  `effects` lines declare (section 5.1).
- It contains no default project path. A user can write an absolute path
  in their own file. The coordinator never supplies one.

Rules for `.trellis/`. It holds run records and stage output. It holds no
trust record.

- It must be a real directory, not a symbolic link, with mode 0700, owned
  by the current user. `init` creates it. Any other command that finds it
  wrong exits with code 2 and touches nothing in it.
- The coordinator creates each file in it with no-follow and exclusive
  flags, and replaces a file by writing a new one and renaming it. It
  never follows a symbolic link when it writes.
- A `.trellis/` that git tracks is refused. Any command that needs to
  read or write it exits with code 2 and says so.

## 5. The part contract

Every part implements four operations: `version`, `install`,
`configure`, and `health`. A part can also implement `up` and `down`,
`export-skills`, and `check-harness` (section 10.4). The coordinator calls
them the same way for every part, in any language.

### 5.1 The manifest

A part ships one file, `trellis-part.yml`, in the root of its repository.

- For a part with `use.path`, the coordinator reads that file as data.
  It runs nothing to get it.
- For a part with `use.bin`, the manifest is the output of
  `<absolute path of bin> manifest`, at most 64 KiB, with no side effect.
  This is the one command that runs before the plan is confirmed. The
  first confirm screen in section 8 shows the absolute path and the
  exact command first, and the command runs only after that screen is
  confirmed or a valid trust record covers that executable. The
  coordinator hashes the executable again right before it runs, and
  refuses if the hash changed. It runs the command in a new empty
  temporary folder, with mode 0700, that it removes afterward. So a file
  in the project cannot change what the command sees. The command gets
  only `PATH`, `HOME`, `TERM`, `LANG`, `TMPDIR`, and `TRELLIS_CONTRACT`.
  It gets no other `TRELLIS_*` variable and no part variable.

```yaml
contract: 1
name: roots
requires: []                    # parts that must be healthy first
effects:                        # plain lines shown on the confirm screen
  - Starts an HTTP server on 127.0.0.1.
operations:
  version:   ["{bin}", "version", "--json"]
  install:   ["{bin}", "install"]
  configure: ["{bin}", "configure"]
  health:    ["{bin}", "health", "--json"]
  up:
    mode: background            # background or foreground
    argv: ["{bin}", "up"]
    startup_timeout: 60         # seconds to wait for health after up returns
  down: ["{bin}", "down"]
  export-skills: ["{bin}", "export-skills", "--harness", "{harness}", "--skills", "{skills_dir}", "--out", "{out_dir}", "--config", "{config}"]
  check-harness: ["{bin}", "check-harness", "--harness", "{harness}", "--config", "{config}"]
skills_dir: skills              # optional, default "skills", inside the part's folder
config_schema: schema/config.schema.json   # optional, inside the part's folder
```

The values above are examples, not the real commands of any part.

Rules for the manifest. Each failed rule exits with code 2.

- `contract` is an integer. The coordinator refuses a part whose
  `contract` is higher than the value it supports, and says so.
- `name` matches the name in `trellis.yml`.
- Each operation is an array of strings, never one shell string. The
  coordinator never runs a shell.
- The first element is a bare command name that is found on `PATH`, the
  placeholder `{bin}`, or a relative path to an executable inside the
  part's folder. `{bin}` is only valid for a part with `use.bin`, and it
  means the absolute path that `use.bin` resolved to. An absolute path,
  a `..` segment, or a symbolic link that leaves the part's folder fails.
- The only placeholders are `{bin}`, `{config}` (the absolute path of the
  part's `config` file), `{project_root}`, and, for `export-skills` and
  `check-harness` only, `{harness}`, `{skills_dir}` (the absolute path of
  the part's skills folder), and `{out_dir}`. An operation that uses
  `{config}` fails the manifest check when the part has no `config`.
- `version`, `install`, `configure`, and `health` are required. `up`,
  `down`, `export-skills`, and `check-harness` are optional. A part with
  `up` and no `down` is allowed. `trellis down` reports it as not
  stoppable (section 6.1).
- `up.mode` is `foreground` or `background`. At most one enabled part can
  be foreground, and it must be the `front` part.
- `requires` lists part names. Each must be an enabled part in
  `trellis.yml`. A cycle fails.
- `effects` is a list of plain lines that describe changes the part makes
  outside its own folder, including any download. The confirm screen
  prints them.
- `skills_dir` and `config_schema` each name a path inside the part's
  folder, with no absolute path, no `..` segment, and no symbolic link
  that leaves the part's folder. Each folder in `skills_dir` that holds a
  `SKILL.md` is one skill.

### 5.2 The operations

Every operation runs with the project root as its working directory,
except `manifest` (section 5.1). Its output is one JSON object on
standard output. Free text goes to standard error. Exit code 0 means
success for every operation. Any other exit code is a failure, except the
`health` codes below. Each operation has a timeout. The manifest can raise
it up to the maximum. A timeout counts as a failure. A foreground `up` has
no timeout, because the coordinator replaces its own process with it.

Right before it starts any operation, the coordinator hashes the
executable, and each regular file that an argument names, again. It
refuses the operation when a hash differs from the confirmed plan. One
window stays open: another file in the part's tree that the operation
imports can change between the plan and the run. Section 8 states this
limit.

| Operation | What it does | Standard input | Standard output | Default timeout, maximum |
|---|---|---|---|---|
| `version` | Reports the part's version and contract. No side effect and no network. | none | `{"contract":1,"part":"<name>","version":"<x.y.z>"}` | 10 s, 30 s |
| `install` | Prepares the part on this machine or in this project. Safe to run again. It starts no long-running process. It is the only operation that can download code. | none | `{"changed":true,"notes":["..."]}` | 600 s, 1800 s |
| `configure` | Writes the part's own config from the settings. Safe to run again. | the JSON object below | `{"changed":true,"notes":["..."]}` | 60 s, 300 s |
| `health` | Reports the part's state. No side effect. | none | `{"status":"ok","checks":[{"name":"...","status":"ok","detail":"..."}]}` | 10 s, 60 s |
| `up` | Starts the part. In `background` mode it returns after the part is running. In `foreground` mode the coordinator replaces its own process with it. | none | background only: `{"started":true,"pid":1234}`, where `pid` can be `null` | background: 60 s, 300 s. Foreground: none |
| `down` | Stops what `up` started. Safe to run again. | none | `{"stopped":true}` | 60 s, 300 s |
| `export-skills` | Section 10.4. | none | section 10.4 | 120 s, 600 s |
| `check-harness` | Section 10.4. It writes nothing. | none | `{"harness":"<name>","ok":true}` | 10 s, 30 s |

`startup_timeout` is a different value from the `up` timeout. It is the
number of seconds that the coordinator waits for `health` to report `ok`
or `degraded` after a background `up` returns. Default 60, maximum 300.

The `configure` input:

```json
{
  "project_root": "<absolute path>",
  "config": "<absolute path, or null>",
  "settings": {},
  "state_dir": "<absolute path of .trellis/>"
}
```

Health states and exit codes. A `health` command exits with the code
that matches the `status` it prints.

| Status | Exit code | Meaning |
|---|---|---|
| `ok` | 0 | The part works. |
| `degraded` | 1 | The part works, with a problem that the checks name. |
| `down` | 2 | The part is installed and configured but not running or not reachable. |
| `unconfigured` | 3 | The part needs `install` or `configure` first. |

Output that is not one JSON object with the fields above is a failure.

### 5.3 What the coordinator passes to a part

Each operation gets a small environment, and nothing else from the
user's shell:

- `PATH`, `HOME`, `TERM`, `LANG`, and `TMPDIR`, as the user has them.
- The variables the part lists in `parts.<name>.env`, with the user's
  values.
- `TRELLIS_CONTRACT` (the integer), `TRELLIS_PART` (the name),
  `TRELLIS_PROJECT_ROOT`, `TRELLIS_CONFIG` (the absolute path of
  `trellis.yml`), and `TRELLIS_STATE_DIR`. The `manifest` command gets
  only `TRELLIS_CONTRACT` (section 5.1).

A secret never travels on a command line. The coordinator does not log
an env value. It replaces any value of a declared env var that appears
in captured output with `***`. It keeps at most 64 KiB of each
operation's captured output.

### 5.4 Rules every part follows

- An operation that says "safe to run again" changes nothing on the
  second run and reports `"changed": false`.
- `health` and `version` change nothing on disk and open no listener.
- No operation other than `install` downloads or clones code. A part
  that needs a clone, such as the crew repository named by `crew.git`,
  makes it in `install`. When the clone is missing later, the part stops
  with a message and does not fetch.
- A part never requires `trellis` to run. Every operation works when
  called directly, with the same inputs. The five variables in section
  5.3 are optional inputs for a part, never a requirement.

## 6. Starting more than one part

`trellis up` runs these steps. It stops at the first failure and starts
nothing more. A valid trust record (section 8) skips the confirm screens
in steps 3 and 5.

1. Find and check `trellis.yml` (sections 3 and 4). This reads data only.
2. Resolve each enabled part as data. A `path` manifest is read. A `bin`
   resolves to an absolute path, and its SHA-256 is computed.
3. First confirm screen, only when a part has `use.bin`: print each
   absolute path, its SHA-256, and the exact `manifest` command. Warn on
   the screen when a `bin` resolves to a path inside the project root.
   Then ask. After yes, run each `manifest` command (section 5.1) and
   check each manifest. Without a terminal and without `--yes`, exit
   with code 3.
4. Order the parts so that each one comes after every part in its
   `requires`. With `--only`, the coordinator starts only the named
   parts, and each part they require must already be `ok` or `degraded`.
   It does not start the others.
5. Second confirm screen: print the plan (section 8) and ask, unless
   `--yes` is given. With `--yes`, it prints the plan and does not ask,
   so the log keeps an audit trail. Without a terminal and without
   `--yes`, exit with code 3. After an interactive yes, write the `up`
   entry in the trust record.
6. For each part in order, run `version` and check its `contract`, then
   run `health`, and act as this table says.

   | `health` | Part has `up` | Action |
   |---|---|---|
   | `ok` | yes or no | Leave it alone. It is already running, so `up` does not start it a second time. |
   | `degraded` | yes or no | Leave it alone. It works. Print each check it reported as a warning, and continue. |
   | `down` | yes | Run its background `up`. Then poll `health` every second until it reports `ok` or `degraded`, or `startup_timeout` passes. |
   | `down` | no | Exit with code 1. Say that the part is down and has no `up`. |
   | `unconfigured` | yes or no | Exit with code 1. Tell the user to run `trellis init`. `up` never installs and never configures. |

   The front part is different. It is never left alone and never polled.
   `down`, `ok`, and `degraded` all lead to step 8. Only `unconfigured`
   stops it.
7. If a part fails to become healthy, run `down` on each part that this
   `up` started, in reverse order. Then exit with code 1.
8. When every other part is ready, run the front part's foreground `up`.
   The coordinator replaces its own process with that command, in the same
   terminal. No other window or terminal opens.
9. With no front part, print one line per part and exit with code 0.

`--dry-run` reads data only. It runs steps 1, 2, and 4 and prints the
order, each command with its placeholders expanded, each env var name,
and each hash it can compute from a file it can open. It runs no part.
For a `bin` part it prints the command that reads the manifest, and says
that it did not run that command.

The coordinator records each part that it started in
`.trellis/run/<part>.json`, with the time, the reported `pid`, and the
contract version. The file has mode 0600.

### 6.1 Stopping parts: `trellis down`

`trellis down` runs part code, so the main rule of section 8 covers it.
It runs these steps and stops at the first refusal.

1. Find and check `trellis.yml` (sections 3 and 4), and read the records
   in `.trellis/run/`. With no record, print that nothing is running and
   exit with code 0. `--only` limits the parts to the named ones.
2. Resolve each recorded part as data, as `up` step 2 does. Run the
   first confirm screen for a `bin` part, as `up` step 3 does.
3. Print the plan for `down`. It lists each recorded part's `down`
   operation and the hashes of its executable. Ask, unless `--yes` is
   given. `--yes` prints the plan and does not ask. Without a terminal
   and without `--yes`, exit with code 3. After an interactive yes, write
   the `down` entry in the trust record.
4. Take the recorded parts in the reverse of the order in which `up`
   started them. For each part that has a `down` operation, run it. On
   success, delete that part's record. On failure, keep the record, print
   the reason, and go on to the next part.
5. A recorded part with no `down` operation is reported as not
   stoppable. Its record stays.
6. Exit with code 0 when every recorded part stopped. Exit with code 1
   when any `down` failed or any part is not stoppable.

The front part is not recorded, because the coordinator replaces its own
process with it. The user ends it in the terminal, or by its own stop
command. Crew stops its own background sessions with `crew down`, which
its manifest names as its `down` operation.

## 7. `crew up` alone, and under `trellis up`

`trellis-crew` implements the part contract with its own
`trellis-part.yml`. It does not depend on the coordinator in any way.

Alone. The user runs `crew up` in a folder that holds a `crew.yml`. The
command in the crew addendum is `trellis-crew up`, and its name is the
first open decision in that addendum. This spec writes `crew up` for
either name. Crew reads `./crew.yml`, or the file named by `--config`. It
does not read `trellis.yml`, does not search upward, and does not call
`trellis`.

Under the coordinator. The crew entry in `trellis.yml` gives the path of
the `crew.yml`. The coordinator checks that the file exists, hashes its
bytes into the plan, and never parses it. The crew manifest runs the same
`crew up` as its foreground `up`, with the config path as the placeholder
`{config}`. The result is the same command that a user types by hand.

Who writes `crew.yml`. The user writes it, or a crew skill such as
`new-crew-spec` writes it at the user's request. The coordinator never
writes it. Crew's `configure` never writes it from `settings`. Crew's
`configure` is allowed to be a no-op that reports `"changed": false`.

Two rules keep the parts independent:

- Crew never reads the coordinator's five variables (section 5.3) to
  decide what to do. Crew's own variables, such as `TRELLIS_CREW_PATH`,
  keep their meaning. The only effect of running under the coordinator is
  that the command line and the working directory are the ones the
  manifest gives.
- The coordinator never parses `crew.yml`. A crew can change its schema
  with no change here.

## 8. Security

Everything the coordinator runs, it runs as the user. The controls below
limit what a cloned or copied project can make it run.

The main rule: no part runs before a confirmation or a valid trust
record. This holds for `init`, `up`, `down`, `doctor`, and `--dry-run`.
Reading data never counts as running.

- A part manifest and `trellis.yml` are trusted input, as a script is. A
  cloned repository can hold both, written by another author. A cloned
  `trellis.yml` picks which folder or command runs, so nothing in it runs
  before a confirmation.
- The tree hash. It stands for everything a part runs. For a part with
  `use.path`, it is the SHA-256 over the sorted list of each regular
  file's relative path and content hash in the part's folder. The list
  includes every path under a folder named `dist` or `build`, even when
  git ignores it, because build output is what a Node part runs. It
  leaves out `.git/`, `node_modules/`, and every other path that git
  ignores. When the folder is a git work tree, the coordinator also
  records the commit id and refuses a tree with uncommitted changes to
  files that git does not ignore. For a part with `use.bin`, the tree is
  the resolved package root: the outermost folder that holds a
  `package.json`, found from the executable, after the coordinator
  resolves symbolic links, by walking up until a folder that holds `.git`
  or the file system root. With no `package.json` on that walk, the tree
  is the executable file alone, and the confirm screen says so. A
  symbolic link inside a tree is hashed by the content of its target. A
  link that leaves the tree is listed on the screen.
- The argument files. For each operation, the plan also holds the SHA-256
  of the executable and of each regular file that an argument names,
  whatever its ignore status. So `["node", "dist/main.js"]` ties both
  `node` and `dist/main.js` to the plan. The coordinator hashes them again
  right before the operation (section 5.2).
- The config bytes. For each part that has a `config`, the plan holds the
  SHA-256 of that file's bytes. Hashing the bytes is not parsing them. So
  a pulled change to `crew.yml` changes the plan hash, and the coordinator
  asks again.
- The limit of the tree hash, stated plainly: it does not cover
  `node_modules`, a build folder with another name (such as `out`), or any
  other path that git ignores. A module that a part imports from those
  paths is trusted as `install` and the build left it, and a change there
  runs with no prompt. A part that needs stronger cover pins its
  dependencies in a tracked lockfile.
- The plan. The plan is the data that the second confirm screen prints,
  for each enabled part in order: the part name, its source (the real
  path of a `path` folder, or the absolute path of a `bin`), the SHA-256
  of the manifest, the tree hash, the config hash, each operation's
  argument list with placeholders expanded, the argument-file hashes, the
  working directory, the env var names, and the `effects` lines. The plan
  holds the operations of the command that is running: `init` lists
  `check-harness`, `export-skills`, `install`, `configure`, and `health`.
  `up` lists `version`, `health`, `up`, and `down`. `down` lists `down`.
  For `init`, it also lists what each `claude` command from section 10.4
  changes, including the project's `.claude/settings.json`. Every screen
  prints the store path. The plan hash is the SHA-256 of the plan in a
  fixed order, together with the SHA-256 of the `trellis.yml` content.
- The first confirm screen is the one in section 6 step 3. It covers only
  the `bin` executables, so the coordinator can run `manifest`.
- The user state folder. `$TRELLIS_HOME` must be an absolute path. Its
  real path, after the coordinator resolves symbolic links, must lie
  outside the project root and outside every git work tree. The folder
  must be a real directory, owned by the current user, with mode 0700.
  The coordinator checks all of this on every run that reads or writes
  the store, and exits with code 2 when a check fails. The reason is that
  a tool that sets the shell environment from project files (such as
  direnv, mise, a devcontainer, or an editor setting) can point
  `$TRELLIS_HOME` at a key and a record that ship with the project. The
  default `~/.trellis` meets the same rule. When the home folder is a git
  work tree, the default fails, and the user sets `$TRELLIS_HOME` to
  another folder. The coordinator creates the folder, with mode 0700, the
  first time `init`, `up`, or `down` writes a record after an interactive
  yes. `doctor` and `--dry-run` never create it.
- The trust store. Trust records live in `$TRELLIS_HOME/trust/`, which
  must be a real directory owned by the user, with mode 0700. The folder
  holds one key file, `key`. It is 32 bytes from the operating system's
  cryptographic random source, written with mode 0600 the first time a
  record is written. Before each use, the coordinator checks that `key` is
  a regular file, not a link, owned by the user, with mode 0600 and
  exactly 32 bytes. Each record is the file `<SHA-256 of the real project
  root>.json`, with mode 0600, with the same checks. It holds the real
  project root, and, for each command (`init`, `up`, and `down`), a plan
  hash and, for each part, its source, its manifest hash, its tree hash,
  its config hash, and its executable and argument-file hashes. It ends
  with an HMAC-SHA-256 over that content, made with `key`. A command
  writes only its own entry, and rewrites the file whole and atomically.
  A command's entry is valid only when all of these hold: the file and
  `key` pass their checks, the HMAC verifies, the project root equals the
  current real path, the hashes that the coordinator recomputes now equal
  that command's stored ones, and `.trellis/` is not tracked by git. So a
  clone, an archive, and any process that can write only the project never
  carry trust with them. A `git pull` in a `path` part's folder, a new
  build of a `bin`, or a change to a `config` file changes a hash, and
  the coordinator asks again.
- The limit of the trust store, stated plainly: a process that runs as the
  user and can write the user state folder can forge a record. The store
  stops trust from arriving with a project. It does not stop code that
  already runs as the user.
- The agent case. An agent session that runs as the user can read `key`
  and write a record. That skips the user's next review of changed part
  code. The mitigation is a deny rule for the store path, in the harness
  settings: `sandbox.filesystem.denyRead` and
  `sandbox.filesystem.denyWrite` with the value of `$TRELLIS_HOME`. Claude
  Code documents these settings as blocks on subprocess access to specific
  paths, and the operating system enforces them for shell commands and
  their child processes. `doctor` prints the rule with the real store path.
  The spec does not use an operating system keychain. Its access list names
  the `node` program, which every session runs, so it adds little.
- The coordinator writes a record entry only after an interactive yes to
  a second screen, in `init`, `up`, or `down`. `doctor` and `--dry-run`
  never write one. `--yes` skips the questions for that one call, prints
  the screens, and writes no record. A later call without `--yes` asks
  again (section 11, decision 8).
- No download by the coordinator. `up`, `doctor`, and `--dry-run` never
  download code. The contract forbids every operation except `install`
  from downloading (section 5.4). `init` is the only command that can
  run `install`, and the confirm screen prints each part's `effects`
  first.
- No shell. Operations are argument arrays. No placeholder can hold a
  shell fragment.
- A small environment (section 5.3). A part sees only the variables it
  lists.
- No secret in any file the coordinator writes. `trellis.yml` holds env
  var names only.
- Every operation has a timeout, and its captured output is bounded.
- The coordinator adds no permission flag, no bypass flag, and no
  harness flag to any command. It starts no harness itself. Harness
  behavior belongs to `trellis-crew`. The two Claude Code commands that
  `init` can run (section 10.4) run only after the confirm screens.
- Skills and marketplace content are trusted input too. A skill is
  instructions that an agent follows. Every marketplace entry is pinned
  to a commit, and a plugin holds skills only (section 10.5).

## 9. The four parts today

The table lists only what each repository's own README states. Every
part has a gap: none ships a `trellis-part.yml` yet.

| Part | Entry point today | Config today | Health today |
|---|---|---|---|
| crew | `trellis-crew install`, `update`, `start`, `status`, `stop`, `respawn` (Node 24 or later) | `~/.trellis-crew/install.yml`, and `sagespec.yml` in the project | none documented |
| roots | `npm start` runs `dist/main.js` (Node 24.11.0) | env vars `ROOTS_PORT`, `ROOTS_HOST`, `ROOTS_CALLERS_FILE` | `GET /healthz` answers `200 {"ok":true}` with no authentication |
| relay | `node dist/src/cli/main.js daemon` runs the daemon in the foreground | none documented | none documented |
| vines | `supabase start` starts the local stack, and `supabase/migrations/` holds the schema | none documented | none documented |

Gaps for each part to close in its own repository:

- Every part: a `trellis-part.yml`, and a `version` command that prints
  the section 5.2 object. No README documents a version command for any
  of the four.
- crew: the four changes in section 1. Its `install` can change
  user-scope harness settings and can clone `crew.git`, so its manifest
  must list both under `effects`.
- roots: a `health` command that wraps `GET /healthz`, plus `install`
  and `configure` entries. Its callers file holds a secret hash. The
  part must issue the secret itself and must not pass it through the
  coordinator.
- relay: a `health` command, and a way to run the daemon in the
  background.
- vines: an `up` entry that wraps `supabase start`, and a `health` check
  that reads its state.

### 9.1 Beside the parts: `trellis-workbench`

`sageadvicellc/trellis-workbench` is a private repository, created on
2026-09-29. Its description reads "Testbench and development environment
for the Trellis framework". This spec treats it as follows.

- It is the development and benchmark environment. The self-administered
  tests for constant improvement run there.
- It is the future home of the benchmarks of the Benchmarking role, the
  crew role that measures how the crew works, and of the self-improvement
  loops. The loops part is pending decision 11: the trellis v3 spec in
  `sageadvicellc/workbench` names `trellis-workbench` as the public
  framework template that every install sets up, and keeps the
  self-improvement routines in Sagespec. So this line can conflict with
  that spec. It follows the maintainer's instruction of 2026-09-29.
- It is not a runtime part. `trellis.yml` never composes it, and it has no
  `trellis-part.yml`. `init` and `up` never install it, start it, or check
  its health.
- `trellis doctor`, or a later benchmark command, can point to it. A
  pointer is a printed line. It is not a dependency and not a check.
- It is not `sageadvicellc/workbench`, the root repository of the
  practice. The two repositories share no code and no config.
- Nothing is built there yet. Today it holds a `README.md` only. This spec
  designs nothing inside it.

## 10. Skills and the marketplace

### 10.1 Where skills live

Each part keeps its skills in its own repository, one folder per skill:
`skills/<name>/SKILL.md`. A skill is a `SKILL.md` file with frontmatter
and instructions. The format is the Agent Skills open standard, which
Claude Code follows and which other AI tools also read. A part limits
its frontmatter to the fields that the standard defines, so the same
file loads in every harness. Claude Code's own extra fields do not
carry over.

Each part owns its skills. The coordinator lists them and never edits
them. Examples, proposed and not built:

- crew: `new-crew-spec`.
- relay: `new-relay-rule`.
- roots: `ingest-source`.
- vines: skills as they fit.

Today crew ships seven `department-*` skills, and relay ships one,
`sage-relay`. Roots and vines ship none.

### 10.2 The marketplace

This repository hosts `.claude-plugin/marketplace.json`. It follows
Claude Code's plugin marketplace format. The layout matches that format:
one marketplace file at the root, one entry per plugin, and a
`.claude-plugin/plugin.json` and a `skills/` folder in each plugin.

```json
{
  "name": "trellis",
  "owner": { "name": "<owner name>" },
  "description": "Tools that make specs for agent crews.",
  "plugins": [
    { "name": "trellis", "source": "./plugins/trellis",
      "description": "The coordinator's own skills." },
    { "name": "trellis-crew",
      "source": { "source": "github", "repo": "sageadvicellc/trellis-crew",
                  "ref": "main", "sha": "<40-hex commit>" },
      "description": "Skills that make crew specs." },
    { "name": "trellis-relay",
      "source": { "source": "github", "repo": "sageadvicellc/trellis-relay",
                  "ref": "main", "sha": "<40-hex commit>" },
      "description": "Skills that make relay rules." },
    { "name": "trellis-roots",
      "source": { "source": "github", "repo": "sageadvicellc/trellis-roots",
                  "ref": "main", "sha": "<40-hex commit>" },
      "description": "Skills that ingest sources into memory." },
    { "name": "trellis-vines",
      "source": { "source": "github", "repo": "sageadvicellc/trellis-vines",
                  "ref": "main", "sha": "<40-hex commit>" },
      "description": "Skills for the trace store." }
  ]
}
```

The owner name is the maintainer's to set. Each description is an
example. Each `sha` is a real commit that a reviewed change sets.

Rules, each from the Claude Code documentation:

- The file needs `name`, `owner`, and `plugins`. Each entry needs `name`
  and `source`.
- A relative `source` is a path from the marketplace root. It never
  contains `..`.
- An entry's `name` equals the `name` in its plugin's `plugin.json`.
  Otherwise an install by the manifest name fails. Crew's manifest is
  named `trellis-crew` today, so its entry uses that name.
- A `github` source takes `ref` and `sha`. Every entry that points to a
  part repository sets both, so a push to a part's branch reaches no user
  until a reviewed change here moves the `sha`.
- `version` is set in the plugin's own `plugin.json` only, not in both
  places.
- A skill's command is `/<plugin>:<skill folder>`, so the crew skill
  `new-crew-spec` runs as `/trellis-crew:new-crew-spec`.

A Claude Code user adds the marketplace once, then installs only the
parts they want:

```
/plugin marketplace add sageadvicellc/trellis
/plugin install trellis-crew@trellis
```

Each plugin is independent. A plugin in this marketplace holds skills
only. Installing it adds skills. It does not install or start the part
itself. That is what `trellis init` and `trellis up` do. Section 10.5
says how the skills-only rule is enforced.

Access. Claude Code runs `git` on the user's machine, with the user's
own git credentials, and `marketplace.json` has no field for a token.
`trellis-crew` is public. This repository, `trellis-relay`,
`trellis-roots`, and `trellis-vines` are private. So every user needs
read access to this repository, and to each private part repository whose
plugin they install. Decision 5 covers this.

Gaps to close in each part's repository before the marketplace works:

- relay, roots, and vines have no `.claude-plugin/plugin.json`. Each
  needs one, with the `name` that the entry uses.
- roots and vines have no skills folder yet.

### 10.3 The `trellis` plugin

The `trellis` plugin lives in this repository at `plugins/trellis/`. It
holds a `.claude-plugin/plugin.json` named `trellis` and a `skills/`
folder with the coordinator's own skills. It holds nothing else. The
same checks as every other plugin apply to it (section 10.5).

### 10.4 Other harnesses: one source, many harnesses

Claude Code reads the `SKILL.md` sources natively through the marketplace.
Other harnesses do not. `trellis init --harness <name>` converts the same
sources through the adapter layer of the crew addendum (section 7). This
spec adds no second adapter layer. The `--harness` value is lowercase
letters, digits, and hyphens, and it names a harness that the adapter
layer supports.

The crew part implements two optional operations with that adapter layer.

- `check-harness` writes nothing. It exits with code 0 when its
  `--harness` value matches the `harness` in `crew.yml`, and prints
  `{"harness":"<name>","ok":true}`. Otherwise it exits nonzero. `init`
  runs it for every chosen harness, including `claude-code`, after the
  second confirm screen and before any `install` (section 2.1, step 7).
- `export-skills` converts skills. `init` checks first that a crew part
  is enabled and has `export-skills` (section 2.1, steps 1 and 5). Then,
  for each enabled part that has a skills folder, it runs the crew part's
  `export-skills` with the harness name, the part's skills folder, the
  crew config path, and an output folder,
  `.trellis/stage/<harness>/<part>/`.

`export-skills`:

- converts the skills for that harness, and places them where the
  harness's adapter says.
- writes only inside the project root or `.trellis/`, never in a user
  scope.
- refuses, with a nonzero exit, when `--harness` differs from the
  `harness` in `crew.yml`, so the two cannot disagree. Crew owns the
  harness choice, and the coordinator never parses `crew.yml`.
- lists every place it writes under `effects` in the manifest, so the
  confirm screen shows them before it runs.
- is safe to run again, and prints one JSON object:
  `{"harness":"<name>","skills":["<name>"],"written":["<path>"]}`.

`init` calls `export-skills` only after the confirm screens (section 8).

For Claude Code, `init` does not call `export-skills`. It prints these
two commands, and after confirmation it runs them from the project root:

```
claude plugin marketplace add sageadvicellc/trellis --scope project
claude plugin install <plugin>@trellis --scope project
```

The Claude Code help for both commands lists `--scope` with the values
`user`, `project`, and `local`. The default is `user`. The documentation
says `--scope project` writes the marketplace into the project's
`.claude/settings.json`. Project scope keeps the skills out of every
unrelated session. `init` runs the install command once for each part the
user chose. The confirm screen lists these changes before they run.

The per-harness gaps in the crew addendum (where Codex and Cursor read
skills, and how a staged folder reaches one session) apply to
`export-skills`. This spec does not restate them.

### 10.5 What the marketplace never holds

The marketplace ships tools that make specs, not staff. It never holds a
company's role modules, such as the `roles/<name>/` folders of a private
crew repository, and never their memory.

A plugin can carry more than skills. Claude Code plugins can also hold
commands, agents, hooks, MCP servers, and other components. In this
marketplace they hold skills only. A list of what to forbid misses a
component type that Claude Code adds later, so the checks below are
allowlists.

Three checks keep both rules. None is built.

- Each entry's `source` is `./plugins/trellis` or a repository in a fixed
  list of part repositories kept in this repository. Adding to the list
  needs a reviewed change. Each entry holds only the keys `name`,
  `source`, and `description`. Each `github` source holds only the keys
  `source`, `repo`, `ref`, and `sha`. Each part entry is pinned to a
  `sha`.
- A check in this repository's CI reads each part's plugin at the pinned
  `sha`, and reads `plugins/trellis/` in this repository the same way. It
  passes only when all of these hold. Each top-level path of the plugin is
  in the allowlist kept here for that part. The `plugin.json` holds only
  allowed keys: `name`, `displayName`, `version`, `description`,
  `author`, `license`, `keywords`, and `skills`, with each `skills` entry
  under `skills/`. Each folder in `skills/` holds regular files only. The
  frontmatter of each `SKILL.md` holds only the keys `name`,
  `description`, `license`, `compatibility`, and `metadata`. So a skill
  cannot carry `hooks`, `shell`, `agent`, `allowed-tools`, or any other
  Claude Code extra. No `SKILL.md` body holds either form that runs a
  shell command in a Claude Code skill: an exclamation mark followed by a
  backtick, or a fenced block that opens with three backticks and an
  exclamation mark. The skills documentation names both forms.
- A check in the same job fails when any plugin folder here holds a
  `roles/` or `memory/` folder. The same job runs
  `claude plugin validate` on the marketplace.

The allowlist for a part lists exactly the top-level paths that its
repository holds at the pinned `sha` and that Claude Code does not load as
a plugin component. Examples are `src`, `docs`, `tests`, and
`package.json`. A reviewer adds a name only after checking the components
documentation, and any new top-level path in a part fails the check until
then.

## 11. Decisions for the maintainer

Each decision gives lettered options, a default, and what each option
causes. The owner says who answers. The Tech Lead answers the technical
ones. The maintainer answers the rest. A ruling line records the Tech
Lead's answer, given 2026-09-29.

### Decision 1. `trellis down` in v1. Owner: tech lead.

- (a) Add `trellis down`. Section 6.1 specifies it. Cost: a fourth
  command to build and test.
- (b) No `down` in v1. A background part that `up` starts keeps running
  until the user stops it by that part's own command. Cost: the user
  needs to know every part's stop command.

Default: (a). Ruling: (a). `up` already records what it started and runs
`down` on failure, and without `down` background parts have no stop path.

### Decision 2. Where parts come from, and pinning. Owner: tech lead.

- (a) Local `path` and `bin` on `PATH` only. Nothing is fetched. Cost: a
  user installs each part first, by cloning it or by a package manager.
- (b) Add `npm` and `git` sources with a pinned version and a hash. Cost:
  a fetch and pinning design comes first, and `install` gets more code.

Default: (a). Ruling: (a). No fetching in version 1 means no supply-chain
surface until a pinning design exists.

### Decision 3. The command and package name. Owner: maintainer.

- (a) Keep `trellis`, and check the name again on the registries before
  any build. Cost: a collision found late means a rename.
- (b) Choose another name now. Cost: the framework name and the command
  name stop matching.

Default: (a). Source: the name check in `sageadvicellc/workbench` at
`central-context/docs/2026-09-29-trellis-mesh/REPORT.md`, section "Name
check", read 2026-09-29. It rated the bare name "Trellis" as a direct
collision with another project's AI coding-agent framework. It checked
the exact string "trellis-mesh" on the registries, and did not check the
string `trellis`. That is a gap.

### Decision 4. The default part set for `init` in a terminal. Owner: maintainer.

- (a) The checklist starts with `crew` only, and the other parts are
  opt-in. Cost: a user who wants everything ticks three more boxes.
- (b) The checklist starts with all four parts. Cost: a user who wants
  only crew unticks three, and `init` sets up parts they did not want if
  they press enter.

Default: (a).

### Decision 5. Marketplace access. Owner: maintainer.

`trellis-crew` is public. This repository and the other three parts are
private.

- (a) Keep them private. Every user needs read access to this repository
  and to each private part repository whose plugin they install. Cost:
  access is granted one user at a time.
- (b) Make this repository and the three private parts public at the
  framework release. The trace store's README says it stays private until
  that release. Cost: everything in them becomes public, so each needs a
  content review first.

Default: (a) until the framework release.

### Decision 6. How other harnesses get converted skills. Owner: tech lead.

- (a) Crew's adapter layer, through the `export-skills` operation.
  Cost: skill conversion needs the crew part enabled.
- (b) One shared adapter package that both the coordinator and crew use.
  Cost: a new package to build and version, and crew changes to use it.

Default: (a). Ruling: (a). One adapter layer, and the harness check stays
in crew.

### Decision 7. Plugin names, and how a rename is done. Owner: tech lead for the mechanics, maintainer for the names.

- (a) Keep `trellis-crew`, `trellis-relay`, `trellis-roots`, and
  `trellis-vines`. Crew's manifest already has the first name. Cost: the
  commands read `/trellis-crew:new-crew-spec`.
- (b) Use short names, such as `crew`, so the commands read
  `/crew:new-crew-spec`. Cost: crew renames its manifest, and the
  marketplace adds a `renames` entry so existing installs keep working.

Default: (a). Ruling on the mechanics: (a), so there is nothing to
rename. If the maintainer picks (b), the `renames` map is used before the
first public release.

### Decision 8. What `--yes` does. Owner: tech lead.

- (a) `--yes` skips the questions for that call, prints the plan, and
  writes no trust record. Cost: a script that runs often passes `--yes`
  every time.
- (b) `--yes` also writes a trust record. Cost: one unattended run
  trusts that plan for later runs, until a hash changes.

Default: (a). Ruling: (a). An unattended run never creates lasting trust.

### Decision 9. Marketplace pinning and the skills-only check. Owner: tech lead.

- (a) Pin every part entry to a `ref` and a `sha`, and add the section
  10.5 checks as allowlists. Cost: each change in a part reaches users
  only after a reviewed change here moves the `sha`.
- (b) Track each part's branch head with no `sha`. Cost: an unreviewed
  push to a part reaches every user, and a plugin can gain hooks or MCP
  servers without review.

Default: (a). Ruling: (a), after the skills-only check is an allowlist,
as section 10.5 now states.

### Decision 10. Where the trust record lives. Owner: tech lead.

- (a) A user-scope trust store outside every project, with a per-user
  key and an HMAC on each record (section 8). Cost: the record does not
  travel with a project, so each user confirms a project once on each
  machine. It stops trust from arriving in a clone or an archive. It does
  not stop code that already runs as the user.
- (b) A record in `.trellis/` inside the project, signed with a key that
  is also in the project. Cost: anything that can write the project can
  forge the record, so the confirm screens can be skipped.

Default: (a). Ruling: (a). A user-scope store, keyed per user. Section 8
adds the rules for `$TRELLIS_HOME`, the agent case, and the deny rule.

### Decision 11. Where the self-improvement loops live. Owner: maintainer.

The trellis v3 spec in `sageadvicellc/workbench` keeps the
self-improvement routines in Sagespec, and names `trellis-workbench` the
public framework template. The maintainer's instruction of 2026-09-29
puts the loops in `trellis-workbench`.

- (a) `trellis-workbench` hosts both the benchmarks and the
  self-improvement loops, as section 9.1 now states. Cost: the v3 spec
  changes, and the loops become part of a repository that the v3 spec
  makes public.
- (b) `trellis-workbench` hosts the benchmarks only, and the loops stay in
  Sagespec, as the v3 spec says. Cost: the loops need a home outside the
  framework, and section 9.1 loses its loops line.

Default: (b), because it matches the spec that the maintainer already
approved.

## Later work

- Fetching parts from `npm` or `git`, with a pinned version and a hash.
- `trellis status`.
- A shared structure for the trace records that each part writes to
  `trellis-vines`.
- A `trellis part check` command that a part author runs to test their
  manifest against this contract.
- The three marketplace checks in section 10.5, in this repository's CI.
- A `trellis benchmark` command that points to `trellis-workbench`
  (section 9.1). It is not designed here. Any command that runs code
  there goes through the confirm screens and the trust store of section
  8.

## Sources

Read 2026-09-29.

- The crew addendum: `docs/crew-addendum.md` in `sageadvicellc/trellis-crew`
  at `afb827d`, the head of pull request 17, which has merged. It is the
  source for the four changes in section 1 and for the crew facts in
  sections 7 and 10.4.
- The crew build plan: `docs/crew-build-plan.md` in pull request 18 of
  `sageadvicellc/trellis-crew`, an open draft, for slice D6 in section 1.
- `sageadvicellc/trellis-crew`: `README.md`, `package.json`, and
  `docs/cli-addendum.md`, for the command list, `install.yml`, and Node
  version.
- `sageadvicellc/trellis-roots`: `README.md`, for the start command, the
  three env vars, and `GET /healthz`.
- `sageadvicellc/trellis-relay`: `README.md`, for the daemon command.
- `sageadvicellc/trellis-vines`: `README.md`, for `supabase start` and
  the migrations folder.
- `sageadvicellc/trellis-workbench`: the repository description, and the
  file list (`README.md` only), for section 9.1.
- The trellis v3 spec: `docs/specs/2026-09-27-trellis-v3-spec.md` in
  `sageadvicellc/workbench`, on `main`, for the conflict in section 9.1
  and decision 11.
- The file lists of the three part repositories and of `trellis-crew`'s
  `.claude-plugin/plugin.json`, for the skills and plugin-manifest facts
  in section 10. The public or private state of each repository was read
  from the GitHub repository list.
- The name check in `sageadvicellc/workbench`, for decision 3 (see the
  path in that decision).
- Claude Code, create a marketplace, for the `marketplace.json` fields,
  the plugin source types, the entry-name rule, and the add and install
  commands: https://code.claude.com/docs/en/plugin-marketplaces
- Claude Code, host and maintain a marketplace, for private repository
  access, `ref` and `sha` on an entry, the `--scope project` form, and
  the `version` rule: https://code.claude.com/docs/en/plugins/host-marketplace
- Claude Code, add components to a plugin, for `skills/<name>/SKILL.md`,
  the `/<plugin>:<skill>` command name, `plugin.json`, and the other
  component types: https://code.claude.com/docs/en/plugins/components
- Claude Code, plugin commands reference, for the `--scope` values:
  https://code.claude.com/docs/en/plugins/cli-reference
- The local help of `claude plugin install --help` and
  `claude plugin marketplace add --help`, Claude Code 2.1.285, run
  2026-09-29, for `-s, --scope <scope>` with `user`, `project`, or
  `local`, default `user`.
- Claude Code skills, for the Agent Skills open standard, the frontmatter
  fields, and the two shell forms (the field table lists `hooks`, `shell`,
  `agent`, and `allowed-tools`; the spec fields are `name`,
  `description`, `license`, `compatibility`, `metadata`, and
  `allowed-tools`): https://code.claude.com/docs/en/skills and
  https://agentskills.io
- Claude Code, configure the sandboxed Bash tool, for
  `sandbox.filesystem.denyRead`, `sandbox.filesystem.denyWrite`, and the
  operating-system enforcement for shell commands and their child
  processes: https://code.claude.com/docs/en/sandboxing

Gap: the maintainer's own local marketplace served as a model for the
layout in section 10.2. It is not in any repository, so it is not a
source. A reader needs only the Claude Code documentation above.

The Claude Code commands and settings named in sections 8 and 10 are the
only harness flags in this spec. Every other harness flag, and its
vendor source, is in the crew addendum.
