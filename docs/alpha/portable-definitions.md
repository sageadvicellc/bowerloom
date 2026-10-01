# Portable definitions in alpha

This slice loads portable crew YAML and compiles an offline task plan. A graph records tasks and their dependencies. A candidate revision identifies the complete plan through a SHA-256 digest. The compiler reads declared files and prints JSON. It starts no models, commands, backend, or workers.

The Endor example describes a fictional craft-shop job board. Coda and Emery are configurable owners. Their names grant no additional permission. The example is a workflow definition. This slice does not build the job board.

## Run the source build

The tested host uses macOS 15.5 arm64, Node 24.11.0, and npm 11.6.1. Run these commands from the monorepo root. Keep at least 12 GiB of host disk space free during this campaign.

1. Install the locked dependencies without package scripts.

   ```sh
   npm ci --ignore-scripts --no-audit --no-fund
   ```

2. Build the TypeScript sources.

   ```sh
   npm run build
   ```

3. Make sure that the Endor definition is valid.

   ```sh
   npm run --silent trellis -- validate examples/endor/crew.yaml
   ```

4. Print the compiled plan.

   ```sh
   npm run --silent trellis -- plan examples/endor/crew.yaml
   ```

The development script invokes the `trellis` entry point. A packaged installation remains later work. For direct invocation after the build, use `node dist/apps/cli/src/main.js` in place of the development script.

Both commands accept `--root <directory>` after the definition path. Without that flag, the source root is the directory that contains the definition. All asset paths use this root. Use `--root` when a definition and its assets occupy different directories inside one source project.

For example, from the monorepo root:

```sh
npm run --silent trellis -- plan examples/endor/crew.yaml --root examples/endor
```

Successful commands print one JSON record to standard output. Errors print a safe error code and explanation to standard error. Exit status is zero for success, one for invalid source, and two for invalid command arguments. `validate` includes `runtimeReady: false`. A successful plan grants no execution authority.

## Source contract

The accepted format is `trellis/crew/v0.7-alpha`. The schema resides in `packages/contracts/src/index.ts` as `crewSchema`. Every record rejects unknown fields. Unknown format versions and mandatory capabilities fail. This slice supplies no implicit migration or optional vendor extension.

| Field | Meaning |
|---|---|
| `format` | Exact source format identifier |
| `id`, `description` | Crew identity and plain-language purpose |
| `requiredCapabilities` | Controls that a future runtime must support |
| `budget` | Requested worker count, reserve, and prohibition on paid fallback |
| `scope` | Maximum declared effects for this crew |
| `assets` | Named source files with relative paths and media types |
| `owners` | Named roles, prompt and skill references, model classes, and permissions |
| `tasks` | Owned work with typed inputs, outputs, dependencies, effects, policy, and acceptance criteria |

Identifiers use lowercase letters, digits, and hyphens. Each identifier starts with a letter and contains at most 64 characters. Reserved object keys are forbidden. Every owner and task needs a unique ID. Each task references one existing owner.

Owners select `economy`, `standard`, or `reasoning` as their model class. These are portable preferences. This slice maps no class to a vendor, account, or model. Vendor credentials, harness configuration, machine paths, private logs, and runtime state remain outside portable source.

Prompt and skill references name declared text assets. Other assets can contain binary data. Text assets and the definition must use UTF-8. The compiler pins all declared assets, including assets without task references. No asset content becomes executable during compilation.

The schema rejects credential fields. It does not detect secrets embedded in arbitrary prose or files. Keep credentials and private runtime state outside this source project. The compiled plan exposes declarations and relative paths, but excludes asset contents and absolute host paths.

## Typed graph

Each task declares `dependsOn`, `inputs`, and `outputs`. An input references either an asset or a named output from another task. A referenced task must appear directly in `dependsOn`. Missing references and cycles fail compilation.

Types include `string`, `number`, `integer`, `boolean`, `array`, `record`, and `artifact`. An array declares its item type. A record declares its named fields. An artifact declares its media type. Input and source types must match exactly, including nested fields and media types.

The compiler does not infer compatibility or convert values. An `integer` output does not satisfy a `number` input. A source asset has the `artifact` type associated with its declared media type. Media type declarations do not establish file content validity.

The compiler groups dependency-ready tasks into sorted layers. A layer contains tasks with no remaining dependency on another layer member. Tasks within each layer use lexical ID order. These layers describe dependency structure. They do not reserve capacity or authorize parallel execution.

Each task needs acceptance criteria and a finite policy. Alpha allows one to three attempts, one to 3,600 seconds per attempt, and at most 300 seconds between attempts. The task deadline spans one to 86,400 seconds from task readiness. It must contain all permitted attempts and backoff periods. `onFailure` must equal `escalate`.

These are static policy declarations. No clock, retry loop, escalation delivery, or result evaluation runs in this slice.

## Declared permissions and capacity

The schema recognizes `workspace.read`, `workspace.write`, `command.test`, and `approval.exact-revision`. Each task capability must appear in the crew declaration. Each effect needs its corresponding task capability. A task with `approval: required` needs `approval.exact-revision`.

Workspace effects declare a path. A granted path covers itself and descendants separated by `/`. A grant for `output/design` excludes `output/design-other`. Owner permissions must fit the crew scope. Task effects must fit their owner permissions.

Test effects name a command ID. They contain no shell string, arguments, or executable path. The registered-test package maps `craft-shop-ui-v1` to its pinned browser executor. Other command IDs remain unsupported by the alpha session. Declared inputs identify data for a task. They do not grant unrestricted filesystem access.

Alpha definitions permit one or two active workers, at least a 5 percent reserve, and `paidFallback: false`. This compiler only makes sure that those declarations meet the schema. The runtime enforces account reservations and fresh usage observations separately. The example retains a 25 percent reserve. A declaration cannot override a runtime refusal.

## Source bounds and paths

The loader accepts one YAML 1.2 document. It rejects duplicate keys, parser warnings, explicit tags, anchors, aliases, and non-string mapping keys. It also rejects non-finite numbers and unsafe integers.

Feature restrictions apply to mapping keys and values. Both count toward the node and depth limits.

| Limit | Bound |
|---|---|
| Definition file | 1 MiB |
| YAML nodes | 20,000 |
| Nested levels | 32 |
| Tasks | 256 |
| Owners | 32 |
| Assets | 128 |
| Each asset | 2 MiB |
| Combined assets | 16 MiB |
| Relative path | 240 characters |

Paths use ASCII letters, digits, underscores, periods, hyphens, and `/` separators. Hidden path components, traversal, backslashes, absolute paths, URLs, platform device names, and trailing periods are forbidden. Asset paths must resolve to regular files inside the selected root. Files and directories below that root cannot be symbolic links.

The caller selects the source root. The loader resolves that root before it reads files, which accommodates host aliases such as macOS `/var`. It refuses observed file replacement or content changes during a read. It bounds reads even when a file grows.

Load a stable source snapshot. These safeguards do not provide operating-system isolation against another process that changes parent directories during a read. They also do not establish runtime action containment. Live containment tests remain an alpha release requirement.

## Revision behavior

The plan includes the full validated definition, compiler version, sorted graph, and SHA-256 digest and byte count for every declared asset. The candidate revision covers that entire body through canonical JSON. Canonical JSON sorts record keys and preserves array order. Any asset byte change changes its digest and the candidate revision.

YAML comments, whitespace, record key order, and the absolute checkout location do not change the candidate. Array order remains part of the definition. Changes to owners, types, permissions, policy, or asset references produce new candidates. The returned plan is deeply frozen in memory.

The plan records digests, not an asset archive or an authenticated signature. It does not authenticate a publisher or approve its own contents. The graph and runtime bridge retain exact source snapshots and compare their digests before use. The compiler does not generate harness files, detect generated-file drift, or bind runtime approvals.

## Evidence and dependencies

Run the source tests and TypeScript analysis from the monorepo root:

```sh
npm test
npm run typecheck
```

The test suite covers deterministic plans, content changes, typed edges, graph failures, scoped effects, parser limits, path escapes, and CLI error behavior. It also tests that prompt text executes no command during offline planning. These tests prove only this source slice.

Exact dependency pins are `yaml` 2.9.1, `ajv` 8.20.0, `typescript` 7.0.2, and `@types/node` 24.11.0. The npm registry returned these versions on October 1, 2026. `package-lock.json` records resolved artifacts and integrity hashes. Installation used `--ignore-scripts`.

The implementation uses the documented [YAML document API](https://eemeli.org/yaml/#parsing-documents) and [Ajv TypeScript support](https://ajv.js.org/guide/typescript.html). The dependency metadata records ISC for YAML, MIT for Ajv and Node types, and Apache-2.0 for TypeScript. This record does not constitute a distribution license audit.

The compiler remains offline. The [local session](local-session.md) composes live Codex proposals, exact approvals, durable effects, and browser acceptance for the prepared Endor alpha demo. General installation packaging, natural-language crew authoring, harness-file generation, and cross-harness drift detection remain unfinished.
