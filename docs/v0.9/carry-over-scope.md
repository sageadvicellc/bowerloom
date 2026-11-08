# Bowerloom 0.9: which 0.8 work to carry over

Status: draft for the maintainer. Date: 2026-11-08.

This document sorts the 0.8 work into Keep, Drop, and Unsure. It deletes, closes, reverts, and merges nothing. The maintainer decides each drop after reading it.

## Why this exists

The maintainer wants 0.9 to be a much larger upgrade of the app and the product idea. Only the 0.8 work that 0.9 needs will carry over. The user interface is the first example of work that 0.9 might not need.

## What 0.9 needs

These items come from the maintainer's stated direction of 2026-11-07 and 2026-11-08. They are direction, not specifications. Each has an id, so the sort below can cite it.

- V9-1, memory explorer. It explores markdown memory in the style of a note-taking app, with analytics. It shows a user their memory against their harness context.
- V9-2, engine views. For each engine, it shows harness configuration and usage across the whole environment. It adds visual explorers that show harnesses at work. The first move is modules for existing multi-engine environments. A Bowerloom-owned runtime interface over `relay` (the layer that launches one engine from another) is not first. The claims about the external environments are not verified yet.
- V9-3, extensions. An extensions harness lets people build their own modules. The memory explorer, the engine views, and the explorers ship as stock extensions.
- V9-4, three surfaces. The CLI is the agent surface. The desktop app is a human surface. A new terminal app is a human surface.
- V9-5, bring-your-own-interface engine. One engine for desktop and terminal. Its open-source status and prior art are not researched yet.
- V9-6, traces and logging API. It records sessions, reviews, usage, and working-tree locks. The maintainer wants it specified only after two working harnesses exist.
- V9-7, a possible new name. Research only. Nothing is decided.

## State of 0.8 on 2026-11-08

- `main` holds `0.8.0-beta.1`. It is published.
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
- Discovery and the scan cache (pull requests 150 and 152). V9-2 shows configuration across the whole environment. That needs a scan the user trusts, and the cache stops a rescan on every launch. Both sit in the unreleased beta.2 work, so decision 2 affects them.
- The Electron shell: `apps/desktop/main`, `preload`, `shared`, and the security checks. V9-4 names the desktop app as a human surface. This sort keeps the shell and leaves the screens to Unsure.
- The linking of a notes folder: `packages/notes-source` and `kits/wiki-keeper`. V9-1 starts from a linked knowledge root. The package treats the source as a pointer and never opens a page, so V9-1 will add a reader.
- The wiki-linking part of issue 143. V9-1 depends on a link flow that is easy to find. The Context page part of the issue is Unsure.
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

- The 52 `task/0.8-*` branches, as branches. No 0.9 item depends on a branch name. Their work reached `main` inside pull request 110, which squash-merged the `release/0.8.0-beta.1` branch. Pull requests 111 to 123 merged into that release branch first. Only 110 and 120 appear in the history of `main`. No pull request has one of these branches as its head. History cannot prove that each branch is fully in `main`, so the drop waits for decision 4.

No product code is a Drop. A Drop needs proof that no 0.9 item depends on a piece. The stated direction names no 0.9 item for any piece under Unsure, and none that rules it out.

### Unsure

- The desktop screens: Overview grid, Projects, Start, Library, and the unmerged Compare and Runs. V9-3 says only that the memory explorer, the engine views, and the explorers ship as stock extensions. It does not mention these screens. No extension interface exists yet, so no evidence says whether any screen becomes an extension. This is decision 1.
- Issue 145, Compare and Runs. Runs data can overlap the V9-6 traces API, which is not specified yet.
- The unreleased beta.2 work itself. This is decision 2.
- The documentation site and the landing site. They describe the 0.8 app. The new product concept will change them. No 0.9 item names them, and no decision in this round covers them.
- The desktop end-to-end suite and the journey tests. They follow the screens decision.
- Four packages that no Keep piece imports from source: `claude-adapter`, `roots`, `team`, and `workbench`. No 0.9 item names them. They are not proven safe to remove, because other files refer to them:
  - `claude-adapter`: nothing imports it, and the CLI pack list omits it. It is a process launcher, not a configuration reader.
  - `roots`, `team`, and `workbench`: the root test scripts and `tsconfig.json` refer to `roots` and `team`. The CLI pack list in `tools/cli-distribution/pack.mjs` names `roots` and `workbench`. A development tool under `tools/step5` imports `team`. Tests and the startup demo read `workbench` files.
  This is decision 3. A removal needs its own pull request that updates those references.
- `apps/mcp`. It is a root workspace and a published `bowerloom-mcp` bin. The root test script runs its tests. It imports no package. No 0.9 item names it. No decision in this round covers it.
- Export and import of harness bundles. It shipped in `0.8.0-beta.1`. The code (`packages/harness-bundle`) is a dependency of the Keep shell, so it stays. Whether export and import stays a supported feature is not a 0.9 call that any item makes.
- The knowledge graph idea in closed pull request 106. V9-1 can reuse it. See "Branches".
- Issues older than 138. This sort leaves them out. Issues 156 to 160 already group part of them as tech debt.

### Missing data

- A search of the `main` tree found no extension interface document or code, no terminal app, and no `relay` package. V9-2, V9-3, and V9-4 start from nothing in this repository.
- The claims about the external multi-engine environments are the maintainer's description. They are not checked against those products' documents.
- Trademark and name checks for V9-7 are not done.
- The state of issues and pull requests comes from GitHub, read on 2026-11-08. Git cannot confirm it.
- The import scan reads static and dynamic imports in source files of `main` at commit `d66fc965`. It skips tests. It does not read scripts, configuration files, or string references.

## Branches

- 52 `task/0.8-*` branches, dated 2026-10-28 to 2026-11-05. None has a pull request of its own. Their work reached `main` through pull request 110, which squash-merged the beta.1 release branch. Pull requests 111 to 123 merged into that release branch first. A squash leaves no shared history. A file-by-file compare against `main` is also not conclusive, because `main` has moved since. Every branch differs from `main` in 26 to 216 files for that reason. The audit therefore cannot prove that a branch is fully in `main`.
- 7 `task/0.8b2-*` branches. Each has a merged pull request (149 to 155) into the beta.2 release branch. They are not on `main` until beta.2 merges, so they are not stale.
- `task/open-beta-release-01`. It is 0.7 work, last changed 2026-10-06, and has no pull request.
- Closed unmerged pull requests 104 to 109. They hold the folder grant summary kind, a read-only desktop viewer, a node map with a knowledge graph, and three clickable 0.8 prototypes. Their branches no longer exist on the remote. GitHub keeps their commits behind the pull request references. V9-1 can reuse the knowledge graph idea from pull request 106. That is Unsure until the maintainer says so.

## Decisions

Each decision is a separate comment on the pull request. The comment says what the options are.

1. How much of the current desktop interface survives.
2. What happens to the unreleased beta.2 work and the two unbuilt issues.
3. What happens to the four packages that no Keep piece imports from source.
4. What happens to the stale 0.8 branches.
