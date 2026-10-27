# Bowerloom 0.7.0-beta.3

This folder holds the frozen specifications for beta.3. Hanna set the scope on 2026-10-22. A builder implements one specification and nothing outside it.

## Scope

| Spec | Track | Source |
|---|---|---|
| [01a-team-agents-claude.md](01a-team-agents-claude.md) | `apply` projects team agents into `.claude/agents` | sageadvicellc/bowerloom#84 |
| [01b-capability-model.md](01b-capability-model.md) | Design: a harness-neutral capability model, and Codex agents | sageadvicellc/bowerloom#84, decision 6 |
| [02-install-pins.md](02-install-pins.md) | Every install path keeps the dependency pins, and the social preview test matches the tagline | Found in the beta.2 proof |
| [03-store-foundation.md](03-store-foundation.md) | `~/.bowerloom` is the store, and `bowerloom.json` marks a project | sageadvicellc/bowerloom#80, phase 4 |
| [04-store-writes.md](04-store-writes.md) | `--global` on the create commands, `skills add`, and `ls` | sageadvicellc/bowerloom#80, phase 5 |
| [05-context-slicing.md](05-context-slicing.md) | An agent loads only its slice of a knowledge base, and a measure compares it with a full load | Hanna, 2026-10-22 |
| [06-config-and-lock.md](06-config-and-lock.md) | `bowerloom.json`, the resolver, `use` and `unuse`, `team adopt`, `bowerloom.lock.json`, and `--frozen` | sageadvicellc/bowerloom#80, phase 6 and decisions 12 to 24 |
| [07-private-store-token.md](07-private-store-token.md) | An opt-in GitHub token for a private store remote | sageadvicellc/bowerloom#80, decision 21 |
| [08-store-migrate.md](08-store-migrate.md) | `store migrate` and `receipt clean` | sageadvicellc/bowerloom#80, phase 7 and decision 18 |
| [09-cache-admin.md](09-cache-admin.md) | `cache list` and `cache prune` | sageadvicellc/bowerloom#80, phase 8 |
| [10-docs-item-sources.md](10-docs-item-sources.md) | The docs page "Where your items come from", and the beta.3 docs | sageadvicellc/bowerloom#80, phase 9 and decision 20 |

Decision records: sageadvicellc/bowerloom#80 comments 6332752507, 6332968796, 6333018480, and 6333364163; sageadvicellc/bowerloom#84 comments 6332807422, 6332928335, and 6333531579.

## Lanes

The repository allows two builders at once.

1. Lane 1: spec 01a, then spec 05. Spec 05 builds on the agent projection in spec 01a.
2. Lane 2: spec 02, then 03, 04, 06, 07, 08, and 09, in that order. Each needs the one before it.
3. Spec 10 is written last, against the merged code. It is a release requirement.

Every specification is reviewed by an independent reviewer before its build starts. Spec 07 also needs a security review before it merges.

## Rules for every track

1. Branch from `release/0.7.0-beta.3`. Name the branch `beta3/<spec-number>-<slug>`.
2. Write the tests first. The acceptance tests decide that a track is done.
3. Run the gates before every commit: `npm run typecheck` with 0 errors and `npm test` with 0 failures. If the track touches the landing or the docs, also run `node tools/run-node-tests.mjs apps/landing/test/*.test.mjs` and `npm test` in `apps/docs`.
4. Every new refusal code gets a sentence and a next step in `apps/cli/src/human.ts`, and a row in `apps/docs/src/content/docs/reference/errors.md`.
5. Every new test file is listed in the explicit `test` glob in `package.json`, or it does not run.
6. User-visible changes get a line under `## 0.7.0-beta.3` in `apps/docs/src/content/docs/releases.md`.
7. Open a pull request into `release/0.7.0-beta.3`. An independent reviewer reviews it before it merges. Only Hanna merges into `main`.
8. A decision that this specification does not settle takes the default named here. Record it in the pull request as a lettered decision for Hanna.
9. Never publish to npm. Never push to `main`.
