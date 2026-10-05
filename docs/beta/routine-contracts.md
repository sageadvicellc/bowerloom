# Portable routine contract: first beta slice

This internal contract validates and plans one portable Labs-to-blog routine in memory.
It creates no files, starts no workers, contacts no service, and grants no authority.
Issue #66 Path B still requires manual execution, harness integration, recovery, security checks, and installed-package evidence.

## Definitions and runs

A routine references reusable definitions. A run needs separate inputs, installed bindings, current grants, state, and exact effect approvals.
This slice defines no run record, launch operation, approval receipt, scheduler, or trigger.
A plan reports `executionAuthorized: false`, `effectsAuthorized: false`, and an empty grant list.

The proposed portable directory remains `.bowerloom/routines/`. This library neither creates that directory nor changes startup's managed file inventory.
Do not add routine files to an existing startup installation through this library. No installation or migration command exists here.

## Internal API

| Function | Result |
| --- | --- |
| `validateRoutine(value)` | A detached, closed-schema definition with sorted references |
| `parseRoutine(text)` | A definition from bounded, strict JSON text |
| `exportRoutine(value)` | Canonical JSON text with a final newline |
| `routineDependencyDigest(content)` | SHA-256 of exact supplied UTF-8 text |
| `planRoutine({ routine, dependencies, inputs })` | A deterministic definition plan with direct dependency pins and no authority |

These functions live in `packages/routines/src/index.ts`. There is no public CLI command or installed package entrypoint for this slice.
The object API rejects accessors, serialization hooks, proxies, custom prototypes, cycles, sparse arrays, and symbol keys.
Parser diagnostics use fixed codes and never include supplied content or parser messages.

JSON is an internal first-slice encoding. It does not replace the proposed portable YAML user experience.
A future YAML parser needs separate duplicate-key, alias, tag, bound, and round-trip acceptance.

## Closed definition

The format is `bowerloom/routine/v1beta1`. The routine identifier is `labs-to-blog`.
The implementation selector is `registered-recipe` with identifier `labs-to-blog-v1`.
That selector names the bounded adapter intended for the existing Labs-to-blog recipe. It proves no installed recipe registration.
General task graphs, other recipe identifiers, commands, schedules, and automatic invocation are refused.

A definition contains these fields only:

- `format`, `id`, and a numeric three-part `version`.
- `inputs.experiment.type`, fixed to `resource-reference`.
- `outputs.draft`, fixed to a Markdown artifact.
- `implementation`, with the selector, portable recipe reference, and digest.
- `team`, with a portable team reference and digest.
- `skills` and `connections`, each containing portable references and digests.
- `review`, requiring exact action approval before effects and founder review at completion.
- `limits`, with worker, attempt, and deadline bounds and no paid fallback.
- `invocation`, fixed to `manual`.

The research sketch's owner and free-form summary fields are omitted from this bounded schema.
A reference contains exactly `ref` and `digest`. Digests use `sha256:` followed by 64 lowercase hexadecimal characters.
The recipe reference is `recipes/labs-to-blog/recipe.json`.
Team references use `teams/<id>/team.yaml`. Skill references select Markdown under `skills/`.
Connections use `connections/<id>.json` and contain portable MCP declarations, not installed endpoint or credential bindings.
References are logical portable paths. They are not instructions to read a local file.
Absolute paths, traversal, hidden paths, encoded paths, and reserved private-state path segments are refused.

## Caller-supplied dependency evidence

Each dependency contains exactly `kind`, `ref`, and `content`.
Kinds are `recipe`, `team`, `skill`, and `connection`. Every referenced dependency must be supplied exactly once.
Missing, extra, duplicate, or mismatched kind/reference records are refused.
A changed byte, including whitespace, invalidates the recorded digest. Explicitly repinning valid changed content changes the plan revision.
Ordering dependencies or references differently does not change the plan.

The recipe content passes the existing Labs-to-blog `RecipeSpec` validator.
The team content passes the existing crew parser. Connection content passes the portable MCP declaration validator.
Skills are bounded, nonempty Markdown text. Their instructions are neither interpreted nor executed.
Known private-key, token, credential-assignment, and absolute-path patterns are refused in dependency text.
These checks are not a general secret detector. Review definitions and dependency content before sharing them.

Dependency content remains a caller-supplied claim. The planner does not read disk or authenticate a source, installation, account, or service.
It hashes direct file bytes, not the transitive execution closure of every asset or import referenced by those files.
A recipe descriptor's source revision is not proof that installed code matches that revision.
The plan states `authenticationVerified: false`, `transitiveClosureVerified: false`, and `runtimePortabilityVerified: false`.
Future execution must verify those boundaries separately.

The selected experiment input contains only a bounded logical `id` and a content `digest`.
The planner does not load that resource, accept raw experiment records, or establish their truth.
Changing either input field changes the plan revision.

## Bounds and exports

- A definition is at most 64 KiB, with bounded object depth and node count.
- Each dependency is at most 256 KiB; aggregate dependency text is at most 1 MiB.
- A routine references one recipe, one team, one to 16 skills, and one to eight connections.
- Worker and attempt limits are one or two. The deadline is one to 1,800 seconds.
- Every limit is declarative here. No worker, retry, timeout, or effect is executed.

The plan exports direct hashes, byte counts, selected input identity, and the validated routine. It omits dependency text and installed state.
Exporting a routine does not export a run, credential, private binding, grant, or approval.
It does not approve publication. Logical identifiers can still carry private meaning.

## Verification and remaining gates

Focused tests cover strict parsing, malformed definitions, private-field refusal, dependency drift, missing records, bounds, inert object inputs, and deterministic round trips.
They also verify detached outputs and absence of filesystem, network, or process calls in the planner.

No Codex or Claude session ran this routine. No GitHub write, MCP invocation, backend setup, or model call occurred.
Manual execution, current grant checks, stop, durable recovery, duplicate-effect prevention, native bypass denial, and both harness trials remain separate required work.
This contract alone satisfies none of those execution gates.
