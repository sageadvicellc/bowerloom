# trellis: coordinator spec

Status: draft, 2026-09-29. Specification only. Nothing here is built, and
the founder approves this design before any build starts. Sources are
listed at the end, each with the date it was read. A fact that no source
states is written as a gap.

## Purpose

Trellis has four parts. Each lives in its own repository and has its own
install and start steps today.

- `trellis-crew` launches a crew of agent sessions.
- `trellis-relay` is the message bus between sessions.
- `trellis-roots` is the headless backend.
- `trellis-vines` is the audit trail and trace store.

A user who wants all four must learn four sets of steps. This repository
holds the coordinator that removes that work. It has one thin command
line tool, `trellis`, and one config file, `trellis.yml`.

The coordinator does three things:

- `trellis init` sets up the parts that a project uses.
- `trellis up` starts them in the right order.
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
- The project root is the folder that holds `trellis.yml`.
- The front part is the one part that runs in the foreground, in the
  terminal where the user ran `trellis up`.

## 1. How this spec splits from the crew addendum

The crew side is `docs/crew-addendum.md` in pull request 17 of
`trellis-crew`, at commit `22983cf`. This table gives each topic one
owner.

| Topic | Owner | Where |
|---|---|---|
| `trellis.yml`, the list of parts, their order | coordinator | sections 3 and 6 |
| Finding `trellis.yml` from a project folder | coordinator | section 4 |
| Starting more than one part | coordinator | section 6 |
| The part contract: install, configure, health, version | coordinator defines it, each part implements it | section 5 |
| `crew.yml`: schema and checks | crew | addendum section 2 |
| Crew repository, role modules, catalog | crew | addendum sections 3 and 4 |
| Harness adapters, harness flags, permission modes | crew | addendum sections 5 to 7 |
| Front session, background sessions, `spawn`, `down` | crew | addendum sections 1, 5, and 6 |
| Project root when `crew up` runs alone | crew: the folder of its `crew.yml` | section 7 |
| The skill source files of each part | that part | section 10.1 |
| The marketplace file and the `trellis` plugin | coordinator | sections 10.2 and 10.3 |
| The adapter layer that converts skills for other harnesses | crew, which already owns it | sections 10.4 and addendum section 7 |

The trimmed crew addendum makes these changes.

1. It defines the project root as the folder that holds the `crew.yml`
   that `up` reads. Addendum sections 1 and 8 now define it as the git
   top level. `up` reads `./crew.yml`, or the file named by `--config`. It
   does not search upward.
2. It drops any text that starts or orders other parts.
3. It adds a `trellis-part.yml` file to the crew repository (section 5),
   and two commands, `version --json` and `health --json` (section 9).
4. It keeps everything else. The open review findings on that pull
   request stay with crew, because each one is about crew's own scope.

## 2. The commands

```
trellis init   [--dir <folder>] [--parts <name,...>] [--harness <name>] [--yes]
trellis up     [--config <file>] [--only <name,...>] [--dry-run] [--yes]
trellis doctor [--config <file>] [--json]
```

Every command also takes `--help`. `trellis --version` prints the
coordinator's own version. The user runs each command from a project
folder. The coordinator never assumes a fixed home folder or a fixed
project root.

- `init` creates `trellis.yml` for the chosen parts, then installs and
  configures each part. Section 2.1 gives the steps.
- `up` starts the parts in dependency order and ends with the front part
  in the foreground. Section 6 gives the steps.
- `doctor` changes nothing. It reads the config, asks each part for its
  version and its health, and prints one report. Section 2.2 gives the
  checks.

Exit codes, the same for all three commands:

| Code | Meaning |
|---|---|
| 0 | Done, and every part is healthy. |
| 1 | A part failed, or is unhealthy or not set up. |
| 2 | A config or usage error. Nothing was started. |
| 3 | The user did not confirm, or no terminal was present and `--yes` was not given. Nothing was started. |

### 2.1 `init`

1. The folder is `--dir`, or the current folder. If `trellis.yml` exists
   there, `init` does not change it. It only sets up parts the file
   already names.
2. The parts come from `--parts`. In a terminal with no `--parts`, `init`
   shows a checklist. With no terminal and no `--parts`, it exits with
   code 2.
3. `init` writes `trellis.yml` for the chosen parts, and creates
   `.trellis/` in the project root. It adds `.trellis/` to
   `.git/info/exclude` when the folder is inside a git work tree.
4. For each chosen part, in dependency order, `init` prints the part's
   confirm screen (section 8), unless `--yes` is given. Then it runs the
   part's `install` and `configure`, then its `health`. It prints the
   result for each part.
5. `init` sets up the parts' skills for the chosen harness, as section
   10.4 describes. `--harness` names the harness. Without it, `init` asks
   in a terminal, and exits with code 2 with no terminal.
6. `init` never starts a part.

### 2.2 `doctor`

`doctor` runs these checks and prints each one as pass, warn, or fail.

- A `trellis.yml` was found and passes the section 3 checks.
- Each part resolves, and its manifest passes the section 5 checks.
- Each part's `version` answers, and its `contract` is one that the
  coordinator supports.
- Each part's dependencies are present in the file.
- Each env var name that a part lists in `env` is set. `doctor` prints
  the name and whether it is set. It never prints a value.
- Each part's `health` answers, and the result is `ok`.

`--json` prints the same report as one JSON object. The exit code is 0
when no check fails and no part is unhealthy, and 1 otherwise.

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
      bin: trellis-roots        # a command on PATH that prints its manifest
    settings:
      port: 4100                # opaque, passed to the part's configure step
    env: [ROOTS_CALLERS_FILE]   # names of env vars the part needs
```

The values above are examples. The example port is not a decision.

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | Schema version, `1`. |
| `front` | no | The name of the part that runs in the foreground. It must name one entry in `parts` that has a foreground `up`. Without it, `up` ends after every part is healthy. |
| `parts.<name>` | yes, at least one | One entry per part. The name is lowercase letters, digits, and hyphens. |
| `parts.<name>.use` | yes | Where the part comes from. Exactly one of `path` or `bin`. |
| `parts.<name>.use.path` | one of the two | A local folder that holds `trellis-part.yml`. A relative path resolves against the project root. |
| `parts.<name>.use.bin` | one of the two | The name of a command on `PATH`. The coordinator reads the manifest by running `<bin> manifest` (section 5.1). |
| `parts.<name>.config` | no | The part's own config file, as a path relative to the project root. The coordinator checks that the file exists. It never reads the file. |
| `parts.<name>.settings` | no | A map that the coordinator does not read. It passes the map to the part's `configure` step. The part validates it. |
| `parts.<name>.env` | no | A list of env var names that the part needs. The file never holds a value. |
| `parts.<name>.enabled` | no | `true` or `false`. Default `true`. A part with `false` is ignored by every command. |

Checks before anything runs. Each failed check prints the file, the
line, the field, and the reason, then exits with code 2.

- The file parses, and `version` is `1`.
- An unknown field fails the check. It is never ignored, so a spelling
  mistake cannot silently change what starts.
- Each part sets exactly one of `use.path` and `use.bin`.
- `front`, when set, names one enabled part.
- Each `config` file exists inside the project root, with no `..`
  segment and no symbolic link that leaves the root.
- The file holds no value for a secret. Any field that needs a secret
  names an env var in `env`.

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
  directory.
- It writes only under `<project root>/.trellis/`. It never writes to a
  fixed home folder.
- It contains no default path. A user can write an absolute path in their
  own file. The coordinator never supplies one.

## 5. The part contract

Every part implements four operations: `version`, `install`,
`configure`, and `health`. A part can also implement `up` and `down`,
and `export-skills` (section 10.4). The coordinator calls them the same
way for every part, in any language.

### 5.1 The manifest

A part ships one file, `trellis-part.yml`, in the root of its repository.
A part that is a command on `PATH` prints the same content when run as
`<bin> manifest`. The output is at most 64 KiB and the command has no
side effect.

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
    startup_timeout: 60         # seconds until health must be ok
  down: ["{bin}", "down"]
  export-skills: ["{bin}", "export-skills", "--harness", "{harness}", "--skills", "{skills_dir}", "--out", "{out_dir}"]
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
  means the command that `use.bin` resolves to. An absolute path, a `..`
  segment, or a symbolic link that leaves the part's folder fails.
- The only placeholders are `{bin}`, `{config}` (the absolute path of the
  part's `config` file), `{project_root}`, and, for `export-skills` only,
  `{harness}`, `{skills_dir}` (the absolute path of the part's skills
  folder), and `{out_dir}`.
- `version`, `install`, `configure`, and `health` are required. `up`,
  `down`, and `export-skills` are optional. A part with `up` and no `down`
  is allowed, and the coordinator reports that it cannot stop it (section
  11).
- `up.mode` is `foreground` or `background`. At most one enabled part can
  be foreground, and it must be the `front` part.
- `requires` lists part names. Each must be an enabled part in
  `trellis.yml`. A cycle fails.
- `effects` is a list of plain lines that describe changes the part makes
  outside its own folder. The confirm screen prints them.
- `skills_dir` names a folder inside the part's folder, with no absolute
  path, no `..` segment, and no symbolic link that leaves the part's
  folder. Each folder in it that holds a `SKILL.md` is one skill.

### 5.2 The operations

Every operation runs with the project root as its working directory. Its
output is one JSON object on standard output. Free text goes to
standard error. Each operation has a timeout. The manifest can raise it
up to the maximum. A timeout counts as a failure.

| Operation | What it does | Standard input | Standard output | Default timeout, maximum |
|---|---|---|---|---|
| `version` | Reports the part's version and contract. No side effect and no network. | none | `{"contract":1,"part":"<name>","version":"<x.y.z>"}` | 10 s, 30 s |
| `install` | Prepares the part on this machine or in this project. Safe to run again. It starts no long-running process. | none | `{"changed":true,"notes":["..."]}` | 600 s, 1800 s |
| `configure` | Writes the part's own config from the settings. Safe to run again. | the JSON object below | `{"changed":true,"notes":["..."]}` | 60 s, 300 s |
| `health` | Reports the part's state. No side effect. | none | `{"status":"ok","checks":[{"name":"...","status":"ok","detail":"..."}]}` | 10 s, 60 s |
| `up` | Starts the part. In `background` mode it returns after the part is running. In `foreground` mode the coordinator replaces its own process with it. | none | background only: `{"started":true,"pid":1234}`, where `pid` can be `null` | `startup_timeout`, default 60 s, maximum 300 s |
| `down` | Stops what `up` started. Safe to run again. | none | `{"stopped":true}` | 60 s, 300 s |

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

Any other exit code from any operation is a failure. So is output that is
not one JSON object with the fields above.

### 5.3 What the coordinator passes to a part

Each operation gets a small environment, and nothing else from the
user's shell:

- `PATH`, `HOME`, `TERM`, `LANG`, and `TMPDIR`, as the user has them.
- The variables the part lists in `parts.<name>.env`, with the user's
  values.
- `TRELLIS_CONTRACT` (the integer), `TRELLIS_PART` (the name),
  `TRELLIS_PROJECT_ROOT`, `TRELLIS_CONFIG` (the absolute path of
  `trellis.yml`), and `TRELLIS_STATE_DIR`.

A secret never travels on a command line. The coordinator does not log
an env value. It replaces any value of a declared env var that appears
in captured output with `***`. It keeps at most 64 KiB of each
operation's captured output.

### 5.4 Rules every part follows

- An operation that says "safe to run again" changes nothing on the
  second run and reports `"changed": false`.
- `health` and `version` change nothing on disk and open no listener.
- A part never requires `trellis` to run. Every operation works when
  called directly, with the same inputs. The `TRELLIS_*` variables are
  optional inputs for a part, never a requirement.

## 6. Starting more than one part

`trellis up` runs these steps. It stops at the first failure and starts
nothing more.

1. Find and check `trellis.yml` (sections 3 and 4).
2. Resolve each enabled part. Read its manifest, check it (section 5.1),
   and run its `version`.
3. Order the parts so that each one comes after every part in its
   `requires`. With `--only`, the coordinator starts only the named
   parts, and each part they require must already be healthy. It does
   not start the others.
4. Print the confirm screen and ask (section 8), unless `--yes` is given.
   Without a terminal and without `--yes`, exit with code 3.
5. For each part in order, run `health`.
   - `unconfigured`: exit with code 1. Tell the user to run
     `trellis init`. `up` never installs and never configures.
   - `ok` on a part that has `up`: leave it alone. It is already running,
     so `up` does not start it a second time.
   - Otherwise, run its background `up`, then poll `health` every second
     until the result is `ok` or the startup timeout passes.
6. If a part fails to become healthy, run `down` on each part that this
   `up` started, in reverse order. Then exit with code 1.
7. When every part is healthy, run the front part's foreground `up`. The
   coordinator replaces its own process with that command, in the same
   terminal. No other window or terminal opens.
8. With no front part, print one line per part and exit with code 0.

`--dry-run` runs steps 1 to 3, prints the order, each command, and each
env var name, and starts nothing. It runs `manifest` and `version` only.

The coordinator records each part that it started in
`.trellis/run/<part>.json`, with the time, the reported `pid`, and the
contract version. The file has mode 0600.

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
the `crew.yml`. The coordinator checks that the file exists and never
reads it. The crew manifest runs the same `crew up` as its foreground
`up`, with the config path as the placeholder `{config}`. The result is
the same command that a user types by hand.

Two rules keep the parts independent:

- Crew never reads `TRELLIS_*` variables to decide what to do. The only
  effect of running under the coordinator is that the command line
  and the working directory are the ones the manifest gives.
- The coordinator never reads `crew.yml`. A crew can change its schema
  with no change here.

## 8. Security

Everything the coordinator runs, it runs as the user. The controls below
limit what a cloned or copied project can make it run.

- A part manifest and `trellis.yml` are trusted input, as a script is. A
  cloned repository can hold both, written by another author.
- The confirm screen. Before it runs any operation other than
  `manifest` and `version`, the coordinator prints, for each part: the
  part name, where it resolves, the absolute path of each executable,
  each argument list, the env var names, the working directory, and the
  `effects` lines. Then it asks. `--yes` skips the question. With no
  terminal and no `--yes`, it runs nothing and exits with code 3.
- The trust record. After the user confirms, the coordinator stores a
  hash of the confirmed plan in `.trellis/trusted.json`, with the
  absolute project root. A later run that finds the same hash does not
  ask again. A record with a different project root, a different hash,
  a mode other than 0600, or an owner other than the current user is
  ignored, and the coordinator asks again. So a `.trellis/` folder that
  came with a clone is never trusted.
- No fetch and no install outside `init`. `up` and `doctor` never
  download code and never call `install` or `configure`.
- No shell. Operations are argument arrays. No placeholder can hold a
  shell fragment.
- A small environment (section 5.3). A part sees only the variables it
  lists.
- No secret in any file the coordinator writes or reads. `trellis.yml`
  holds env var names only.
- Files under `.trellis/` have mode 0600, and the folder has mode 0700.
- Every operation has a timeout, and its captured output is bounded.
- The coordinator adds no permission flag, no bypass flag, and no
  harness flag to any command. It starts no harness itself. Harness
  behavior belongs to `trellis-crew`. The one Claude Code command that
  `init` can run, `claude plugin marketplace add ... --scope project`,
  runs only after the confirm screen.
- Skills and marketplace content are trusted input too. A skill is
  instructions that an agent follows. The marketplace lists only the
  parts in the fixed list (section 10.5), and never a company's role
  modules.

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
- crew: `health --json` and `version --json` (section 1, change 3). Its
  `install` can change user-scope harness settings, so its manifest must
  list that under `effects`.
- roots: a `health` command that wraps `GET /healthz`, plus `install`
  and `configure` entries. Its callers file holds a secret hash. The
  part must issue the secret itself and must not pass it through the
  coordinator.
- relay: a `health` command, and a way to run the daemon in the
  background.
- vines: an `up` entry that wraps `supabase start`, and a `health` check
  that reads its state.

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
Claude Code's plugin marketplace format. The layout follows the founder's
local marketplace: one marketplace file at the root, one entry per plugin,
and a `.claude-plugin/plugin.json` and a `skills/` folder in each plugin.

```json
{
  "name": "trellis",
  "owner": { "name": "<owner name>" },
  "description": "Tools that make specs for agent crews.",
  "plugins": [
    { "name": "trellis", "source": "./plugins/trellis",
      "description": "The coordinator's own skills." },
    { "name": "trellis-crew",
      "source": { "source": "github", "repo": "sageadvicellc/trellis-crew" },
      "description": "Skills that make crew specs." },
    { "name": "trellis-relay",
      "source": { "source": "github", "repo": "sageadvicellc/trellis-relay" },
      "description": "Skills that make relay rules." },
    { "name": "trellis-roots",
      "source": { "source": "github", "repo": "sageadvicellc/trellis-roots" },
      "description": "Skills that ingest sources into memory." },
    { "name": "trellis-vines",
      "source": { "source": "github", "repo": "sageadvicellc/trellis-vines" },
      "description": "Skills for the trace store." }
  ]
}
```

The owner name is the founder's to set. Each description is an example.

Rules, each from the Claude Code documentation:

- The file needs `name`, `owner`, and `plugins`. Each entry needs `name`
  and `source`.
- A relative `source` is a path from the marketplace root. It never
  contains `..`.
- An entry's `name` equals the `name` in its plugin's `plugin.json`.
  Otherwise an install by the manifest name fails. Crew's manifest is
  named `trellis-crew` today, so its entry uses that name.
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

Each plugin is independent. Installing a plugin adds skills only. It
does not install or start the part itself. That is what `trellis init`
and `trellis up` do.

Access. Claude Code runs `git` on the user's machine, with the user's
own git credentials, and `marketplace.json` has no field for a token. So
each user needs read access to this repository and to each part
repository that they install. All five repositories are private today.
Decision 5 covers this.

Gaps to close in each part's repository before the marketplace works:

- relay, roots, and vines have no `.claude-plugin/plugin.json`. Each
  needs one, with the `name` that the entry uses.
- roots and vines have no skills folder yet.

### 10.3 The `trellis` plugin

The `trellis` plugin lives in this repository at `plugins/trellis/`. It
holds a `.claude-plugin/plugin.json` named `trellis` and a `skills/`
folder with the coordinator's own skills. It holds nothing else.

### 10.4 Other harnesses: one source, many harnesses

Claude Code reads the `SKILL.md` sources natively through the marketplace.
Other harnesses do not. `trellis init --harness <name>` converts the same
sources through the adapter layer of the crew addendum (section 7). This
spec adds no second adapter layer.

The crew part implements the optional `export-skills` operation with that
adapter layer. For each enabled part that has a skills folder, `init`
runs the crew part's `export-skills` with the harness name, the part's
skills folder, and an output folder, `.trellis/stage/<harness>/<part>/`.
The operation:

- converts the skills for that harness, and places them where the
  harness's adapter says;
- writes only inside the project root or `.trellis/`, never in a user
  scope;
- lists every place it writes under `effects` in the manifest, so the
  confirm screen shows them before it runs;
- is safe to run again, and prints one JSON object:
  `{"harness":"<name>","skills":["<name>"],"written":["<path>"]}`.

`init` calls `export-skills` only after the confirm screen (section 8).
Without an enabled crew part, `init --harness <other>` exits with code 2
and says that skill conversion needs the crew part (decision 6).

For Claude Code, `init` does not call `export-skills`. It prints the
marketplace commands from section 10.2. After confirmation, it can run
`claude plugin marketplace add sageadvicellc/trellis --scope project`.
The Claude Code documentation says this writes the marketplace into the
project's `.claude/settings.json`, which the user can commit. Project
scope keeps the skills out of every unrelated session. Gap: the scope
flag of `claude plugin install` is not verified in this spec. A build
verifies it first.

The per-harness gaps in the crew addendum (where Codex and Cursor read
skills, and how a staged folder reaches one session) apply to
`export-skills`. This spec does not restate them.

### 10.5 What the marketplace never holds

The marketplace ships tools that make specs, not staff. It never holds a
company's role modules, such as the `roles/<name>/` folders of a private
crew repository, and never their memory.

Two checks keep it that way. Neither is built.

- Each entry's `source` is `./plugins/trellis` or a repository in a fixed
  list of part repositories kept in this repository. Adding to the list
  needs a reviewed change.
- A check in this repository's CI fails when any plugin folder here holds
  a `roles/` or `memory/` folder. The same job runs
  `claude plugin validate` on the marketplace.

## 11. Decisions for the founder

1. Whether v1 has `trellis down`. This spec has only `init`, `up`, and
   `doctor`. Without `down`, a background part that `up` starts keeps
   running until the user stops it by its own command. The option is to
   add `trellis down`, which runs each recorded part's `down` in reverse
   order.
2. Where parts come from. This spec allows a local `path` and a `bin` on
   `PATH`, and it fetches nothing. The alternative is to add `npm` and
   `git` sources, which needs a pinning and hash design first.
3. The command and package name. An earlier name check found that the
   bare word `trellis` collides with another project's name. Check the
   name again before any build.
4. The default part set for `init` in a terminal. The options are all
   four parts, or `crew` only, with the others opt-in.
5. Marketplace access while the repositories are private. The options are
   to keep all five private and give each user read access, or to make
   this repository and the four parts public at the framework release.
   The trace store's README says it stays private until that release.
6. How other harnesses get converted skills. This spec uses crew's adapter
   layer through the `export-skills` operation, so conversion needs the
   crew part. The alternative is one shared adapter package that both the
   coordinator and crew use.
7. Plugin names. This spec keeps `trellis-crew`, `trellis-relay`,
   `trellis-roots`, and `trellis-vines`, because crew's manifest already
   has the first name. The alternative is short names, such as `crew`, so
   the commands read `/crew:new-crew-spec`. That needs crew to rename its
   manifest, and a rename needs an entry in the marketplace's `renames`
   map.

## Later work

- Fetching parts from `npm` or `git`, with a pinned version and a hash.
- `trellis down` and `trellis status`, if decision 1 says yes.
- A shared structure for the trace records that each part writes to
  `trellis-vines`.
- A `trellis part check` command that a part author runs to test their
  manifest against this contract.
- The two marketplace checks in section 10.5, in this repository's CI.

## Sources

Read 2026-09-29.

- The crew addendum: `docs/crew-addendum.md` in pull request 17 of
  `sageadvicellc/trellis-crew`, at commit `22983cf`. Its review comment
  states the open findings that stay with crew.
- `sageadvicellc/trellis-crew`: `README.md`, `package.json`, and
  `docs/cli-addendum.md`, for the command list, `install.yml`, and Node
  version.
- `sageadvicellc/trellis-roots`: `README.md`, for the start command, the
  three env vars, and `GET /healthz`.
- `sageadvicellc/trellis-relay`: `README.md`, for the daemon command.
- `sageadvicellc/trellis-vines`: `README.md`, for `supabase start` and
  the migrations folder.
- The file lists of the three part repositories and of `trellis-crew`'s
  `.claude-plugin/plugin.json`, for the skills and plugin-manifest facts
  in section 10.
- Claude Code, create a marketplace, for the `marketplace.json` fields,
  the plugin source types, the entry-name rule, and the add and install
  commands: https://code.claude.com/docs/en/plugin-marketplaces
- Claude Code, host and maintain a marketplace, for private repository
  access, the `--scope project` form, and the `version` rule:
  https://code.claude.com/docs/en/plugins/host-marketplace
- Claude Code, add components to a plugin, for `skills/<name>/SKILL.md`,
  the `/<plugin>:<skill>` command name, and `plugin.json`:
  https://code.claude.com/docs/en/plugins/components
- Claude Code skills, for the Agent Skills open standard and the fields
  that carry over to other tools: https://code.claude.com/docs/en/skills
  and https://agentskills.io

The Claude Code commands in section 10 are the only harness flags in this
spec. Every other harness flag, and its vendor source, is in the crew
addendum.
