# Bowerloom 0.9: which 0.8 work to carry over

Status: the maintainer answered decisions 1 to 4 on 2026-11-09. See "Decisions". Date: 2026-11-08, updated 2026-11-09.

This document sorts the 0.8 work into Keep, Drop, and Unsure. It deletes, closes, reverts, and merges nothing. The maintainer has decided the product calls. Each removal still needs its own step.

## Why this exists

The maintainer wants 0.9 to be a much larger upgrade of the app and the product idea. Only the 0.8 work that 0.9 needs will carry over. The user interface is the first example of work that 0.9 might not need.

## What 0.9 needs

These items come from the maintainer's stated direction of 2026-11-07 and 2026-11-08. They are direction, not specifications. Each has an id, so the sort below can cite it.

- V9-1, memory explorer. It explores markdown memory in the style of a note-taking app, with analytics. It shows a user their memory against their harness context.
- V9-2, engine views. For each engine, it shows harness configuration and usage across the whole environment. It adds visual explorers that show harnesses at work. The first move is modules for existing multi-engine environments. A Bowerloom-owned runtime interface over `relay` (the layer that launches one engine from another) is not first. The claims about the external environments are not verified yet.
- V9-3, extensions. An extensions harness lets people build their own modules. The memory explorer, the engine views, and the explorers ship as stock extensions. Decided 2026-11-09: Bowerloom positions itself as an engine. The interface is rebuilt on a new extensions API and ships as included default extensions. The default flavor is what the Bowerloom app was, with libraries, harnesses, and visual management of them. The reply says "uninstallable". It does not say whether a user can uninstall the defaults, because the word can mean either.
- V9-4, three surfaces. The CLI is the agent surface. The desktop app is a human surface. A new terminal app is a human surface.
- V9-5, bring-your-own-interface engine. One engine for desktop and terminal. Its open-source status and prior art are not researched yet.
- V9-6, traces and logging API. It records sessions, reviews, usage, and working-tree locks. The maintainer wants it specified only after two working harnesses exist.
- V9-7, a possible new name. Research only. Nothing is decided.

## State of 0.8 on 2026-11-08

- `main` holds `0.8.0-beta.1`. Pull request 135 records it as published on npm. Git cannot confirm that.
- `release/0.8.0-beta.2` is 8 merged pull requests ahead of `main`, and it is not published. These are the pull requests:
  - 149, the Overview grid.
  - 150, Discovery.
  - 151, Projects actions.
  - 152, the scan cache.
  - 153, Start.
  - 154, review follow-ups.
  - 155, the Library Add form.
  - 161, the release script and workflow tools.
- The beta.2 issues 141, 142, 144, 146, 147, and 148 are still open. The merged pull requests above match them by title.
- Two beta.2 issues have no work merged. They are 143 (fill the Context page and make wiki linking easy) and 145 (Compare and Runs on real folders). Issue 138 is the umbrella.
- Before this pull request, the repository had no open pull requests.
- Before this pull request, the remote held 60 `task/*` branches. See "Branches".
- Pull requests 104 to 109 are closed and unmerged. They hold the 0.7 desktop viewer and three clickable 0.8 prototypes. See "Branches".

## The sort

If a 0.9 item depends on a piece, the piece is Keep, and the line names the item. If no 0.9 item depends on a piece, the piece is Drop. If the evidence is missing, or the call belongs to the maintainer, the piece is Unsure.

### Keep

- `packages/harness-definition`. Its README says every package that reads or writes a harness imports it. V9-1, V9-2, and V9-3 all read a harness.
- `packages/fidelity`. It decides how each engine carries a harness, and it reports every loss. V9-2 needs exactly that per-engine view.
- `packages/adoption` and the portable projection in `packages/project-sync`. Adoption reads engine files and writes a harness definition by copy. V9-2 needs the harness read from each engine.
- Discovery and the scan cache (pull requests 150 and 152). V9-2 shows configuration across the whole environment. That needs a scan the user trusts, and the cache stops a rescan on every launch. Both sit in the unreleased beta.2 work, so decision 2 affects them. Decision 2B carries them into the 0.9 branch.
- The Electron shell: `apps/desktop/main`, `preload`, `shared`, and the security checks. V9-4 names the desktop app as a human surface. This sort keeps the shell and leaves the screens to Unsure.
- The linking of a notes folder: `packages/notes-source` and `kits/wiki-keeper`. V9-1 probably starts from a linked knowledge root. That is an inference, because the V9-1 text does not say it. The package treats the source as a pointer and never opens a page, so V9-1 will add a reader.
- The wiki-linking part of issue 143. V9-1 probably depends on a link flow that is easy to find. That is also an inference. The Context page part of the issue is Unsure. Decision 2B leaves issue 143 unfinished for beta.2. The need moves to the 0.9 rebuild.
- The release script and workflow tools (pull request 161) and the files in `release/`. This is an exception to the sort rule: no V9 item depends on them. Releasing 0.9 needs them, and they are process, not product. They also sit in the unreleased beta.2 work.
- `apps/cli`. V9-4 names the CLI as the agent surface.

### Needed by a Keep piece

A scan of imports on `main` found that the Keep pieces reach more packages than the Keep list names. These packages stay while their importer stays.

- Reached from the desktop shell, the core packages, or the engine adapters, directly or through another package:
  - `contracts`, `context-slices`, `harness-bundle`, `crew`, and `codex-adapter`.
  - `project-config`, `project-context`, `project-authoring`, and `managed-skills`.
  - `skill-manifest`, `skill-sources`, `diagnostics`, and `authoring`.
  - `admission`, `broker`, `mcp-connections`, and `runtime`.
  - `broker-postgres`, `controlled-tests`, `graph`, `portable`, and `startup`.
- Reached only through `apps/cli`: `connections`, `harness-portability`, `linux-browser`, `local-backend`, `local-control`, `recipes`, `routines`, `runtime-bridge`, and `workspace-effects`.

Most of the 0.7-era packages are in this list. Removing one breaks a Keep piece. The scan reads imports in non-test source, including dynamic `import()` calls.

### Drop

- The beta.2 screens as built: Overview grid, Projects, Start, Library, and the unbuilt Compare and Runs. Decision 1C removes them at the start of 0.9 and rebuilds what 0.9 needs as default extensions. The Electron shell and the data layer stay. This pull request removes nothing.
- The 52 `task/0.8-*` branches, as branches. No 0.9 item depends on a branch name. Their work reached `main` inside pull request 110, which squash-merged the `release/0.8.0-beta.1` branch. Pull requests 111 to 123 merged into that release branch first. Only 110 and 120 appear in the history of `main`. No pull request has one of these branches as its head. History cannot prove that each branch is fully in `main`, so the drop waits for decision 4.

No product code is a Drop. A Drop needs proof that no 0.9 item depends on a piece. The stated direction names no 0.9 item for any piece under Unsure, and none that rules it out.

### Unsure

- Issue 145, Compare and Runs. Decision 2B leaves it unbuilt for beta.2. Decision 1C rebuilds the screens as extensions if 0.9 wants them. Runs data can overlap the V9-6 traces API, which is not specified yet.
- The unreleased beta.2 work. Decision 2B: do not release beta.2, and carry the 8 merged pull requests into the 0.9 branch. Most of those pull requests are screens, and decision 1C rebuilds the screens. The decisions do not say which merged code stays as the base of the rebuild.
- The documentation site and the landing site. They describe the 0.8 app. The new product concept will change them. No 0.9 item names them, and no decision in this round covers them. Keep pieces read from them, so they cannot be dropped first: the desktop shell build copies fonts from `apps/landing`. About a dozen test files read `apps/docs` pages, among them CLI tests and the `harness-bundle` contract test. A desktop test reads `apps/landing`. A CI workflow filters on `apps/landing` paths, and a preview check reads both sites. The root package lists `apps/landing` as a workspace. Tests of several needed packages also read `examples/`.
- The desktop end-to-end suite and the journey tests. No V9 item names them. They follow the screens decision. They test the screens that decision 1C removes, so the rebuilt screens need new tests.
- Four packages that no Keep piece imports from source: `claude-adapter`, `roots`, `team`, and `workbench`. No 0.9 item names them. Decision 3 is B for now and C later. For now, freeze them: mark each unsupported in its README and the docs, do no new work, and remove nothing. That marking is not done yet. Later, remove them in a separate reviewed pull request that updates every reference. The reply gives no date or trigger for the removal. They are not proven safe to remove, because other files refer to them:
  - `claude-adapter`: nothing imports it, and the CLI pack list omits it. The test coverage check in `tools/test/test-coverage.test.mjs` lists its tests, so removal needs that entry gone first.
  - `roots` and `team`: the root test scripts name both, and `tsconfig.json` includes the `roots` tests.
  - `roots` and `workbench`: the CLI pack list in `tools/cli-distribution/pack.mjs` names both.
  - `team`: a development tool under `tools/step5` imports it.
  - `workbench`: three tests under `tests/` and one startup test read its fixtures.
  A removal needs its own pull request that updates those references.
- `apps/mcp`. It is a root workspace and a declared bin (`bowerloom-mcp`) of the private root package. The root test script runs its tests. It imports no package. No 0.9 item names it. No decision in this round covers it.
- Export and import of harness bundles. It shipped in `0.8.0-beta.1`. The code (`packages/harness-bundle`) is a dependency of the Keep shell, so it stays. Whether export and import stays a supported feature is not a 0.9 call that any item makes.
- The knowledge graph idea in closed pull request 106. V9-1 can reuse it. See "Branches".
- Issues older than 138. No V9 item names them. This sort leaves them out. Issues 156 to 160 already group part of them as tech debt.

### Missing data

- A search of the `main` tree found no extension interface document or code, no terminal app, and no `relay` package. V9-2, V9-3, and V9-4 start from nothing in this repository.
- The claims about the external multi-engine environments are the maintainer's description. They are not checked against those products' documents.
- Trademark and name checks for V9-7 are not done.
- The state of issues and pull requests comes from GitHub, read on 2026-11-08. Git cannot confirm it.
- The import scan reads static and dynamic imports in source files of `main` at commit `d66fc965`. It skips tests. It does not read scripts, configuration files, or string references.

## Branches

- 52 `task/0.8-*` branches, dated 2026-10-28 to 2026-11-05. None has a pull request of its own. Their work reached `main` through pull request 110, which squash-merged the beta.1 release branch. Pull requests 111 to 123 merged into that release branch first. A squash leaves no shared history. A file-by-file compare against `main` is also not conclusive, because `main` has moved since. Every branch differs from `main` in 26 to 216 files for that reason. The audit therefore cannot prove that a branch is fully in `main`. Decision 4C: tag each branch tip, then delete the branches. Nothing is tagged or deleted yet. It waits for the maintainer's go.
- 7 `task/0.8b2-*` branches. Each has a merged pull request (149 to 155) into the beta.2 release branch. They are not on `main` until beta.2 merges, so they are not stale.
- `task/open-beta-release-01`. It is 0.7 work, last changed 2026-10-06, and has no pull request.
- Closed unmerged pull requests 104 to 109. They hold the folder grant summary kind, a read-only desktop viewer, a node map with a knowledge graph, and three clickable 0.8 prototypes. Their branches no longer exist on the remote. GitHub keeps their commits behind the pull request references. V9-1 can reuse the knowledge graph idea from pull request 106. That is Unsure until the maintainer says so.

## Decisions

The maintainer answered on 2026-11-09 in [one comment](https://github.com/sageadvicellc/bowerloom/pull/162#issuecomment-6731232158).

1. How much of the current desktop interface survives. Answer 1C: keep the shell only. Rebuild the interface on the new extensions API and ship it as included default extensions.
2. What happens to the unreleased beta.2 work and the two unbuilt issues. Answer 2B: do not release beta.2. Carry the 8 merged pull requests into the 0.9 branch.
3. What happens to the four packages that no Keep piece imports from source. Answer 3B for now and 3C later: freeze them now, and remove them in a separate reviewed pull request later.
4. What happens to the stale 0.8 branches. Answer 4C: tag each tip, then delete the branches. Nothing is deleted until the maintainer gives the go.
