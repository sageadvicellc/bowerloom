# Bowerloom 0.9: which 0.8 work to carry over

Status: the maintainer answered decisions 1 to 4 on 2026-11-09 (UTC). See "Decisions". A later direction change, relayed through chat and not on GitHub, amends answer 1C on how the interface is built, and it overrides the removable reading of follow-up answer (a). It also puts follow-up answer (d) in question. The maintainer confirmed three readings of the direction change in chat. Answer 1C stands as recorded on GitHub until the maintainer records the change there. See "Direction change". The acceptance list for "v0.9 working" is in "Acceptance: v0.9 working". Date: 2026-11-08, updated 2026-11-09.

This document sorts the 0.8 work into Keep, Drop, and Unsure. The document itself deletes, closes, reverts, and merges nothing. The maintainer has decided the product calls, except where "Direction change" puts a call in question. Each removal still needs its own step. The one step done so far is decision 4C: see "Branches".

## Why this exists

The maintainer wants 0.9 to be a much larger upgrade of the app and the product idea. Only the 0.8 work that 0.9 needs will carry over. The user interface is the first example of work that 0.9 might not need.

## What 0.9 needs

These items come from the maintainer's stated direction. V9-1 to V9-7 date from 2026-11-07 and 2026-11-08. V9-8 and V9-9 date from 2026-11-09. They are direction, not specifications. Each has an id, so the sort below can cite it.

- V9-1, memory explorer. It explores markdown memory in the style of a note-taking app, with analytics. It shows a user their memory against their harness context. Under the relayed direction change, this becomes an engine concept with an API (relayed, not on GitHub). The principle is confirmed in chat. Applying it to this item is an inference to confirm.
- V9-2, engine views. For each engine, it shows harness configuration and usage across the whole environment. It adds visual explorers that show harnesses at work. The first move is modules for existing multi-engine environments. A Bowerloom-owned runtime interface over `relay` (the layer that launches one engine from another) is not first. The claims about the external environments are not verified yet. Under the relayed direction change, this becomes an engine concept with an API (relayed, not on GitHub). The principle is confirmed in chat. Applying it to this item is an inference to confirm.
- V9-3, extensions. An extensions harness lets people build their own modules. The memory explorer, the engine views, and the explorers were to ship as stock extensions. Decided 2026-11-09 (answer 1C): Bowerloom positions itself as an engine. The interface is rebuilt on a new extensions API and ships as included default extensions. The default flavor is what the Bowerloom app was, with libraries, harnesses, and visual management of them. A later chat answer (a), relayed and not on GitHub, said the defaults must not lock a user in. The relaying session read that as: a user can remove them. The maintainer also wants Bowerloom to run on other host platforms, and always as a CLI. Extensions and mods are two layers, as that answer described: extensions add features, including interfaces and code that calls APIs. Mods change interface parts, such as navigation, that Bowerloom otherwise does not change, to allow full theming and not only color changes. A relayed direction change overrides the removable reading (relayed, not on GitHub). See "Direction change". Whether extensions and mods stay as layers for other features is an open question.
- V9-4, three surfaces. The CLI is the agent surface. The desktop app is a human surface. A new terminal app is a human surface. Under the direction change, each surface becomes a client of the engine API (relayed, not on GitHub, an inference to confirm).
- V9-5, bring-your-own-interface engine. One engine for desktop and terminal. Its open-source status and prior art are not researched yet. The direction change fits this item, and it adds no new content to it (relayed, not on GitHub, an inference to confirm).
- V9-6, traces and logging API. It records sessions, reviews, usage, and working-tree locks. The maintainer wants it specified only after two working harnesses exist. Under the relayed direction change, it becomes one more engine API (relayed, not on GitHub, an inference to confirm).
- V9-7, a possible new name. Research only. Nothing is decided.
- V9-8, structured agent output in the included chat interface. A request relayed through chat on 2026-11-09, not on GitHub. It is a request, not a build. See "New feature request".
- V9-9, host-neutral API contract. Relayed through chat on 2026-11-09, not on GitHub. The maintainer confirmed in chat that it is a requirement. The relayed text says the concepts also ship as extensions on other platforms where possible. The engine API must work for hosts beyond the Bowerloom app. The shape of the contract is open (question 6). A requirement, not a build. See "Direction change".

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
- The Electron shell: `apps/desktop/main`, `preload`, `shared`, and the security checks. V9-4 names the desktop app as a human surface. The screens are in Drop under decision 1C. The shell stays. Under the direction change, the shell becomes a client of the engine API (relayed, not on GitHub, an inference to confirm). Question 7 under "Direction change" asks whether the shell framework changes.
- The linking of a notes folder: `packages/notes-source` and `kits/wiki-keeper`. V9-1 probably starts from a linked knowledge root. That is an inference, because the V9-1 text does not say it. The package treats the source as a pointer and never opens a page, so V9-1 will add a reader.
- The wiki-linking part of issue 143. V9-1 probably depends on a link flow that is easy to find. That is also an inference. The Context page part of the issue is Unsure. Decision 2B leaves issue 143 unfinished for beta.2. The need moves to the 0.9 rebuild.
- The release script and workflow tools (pull request 161) and the files in `release/`. This is an exception to the sort rule: no V9 item depends on them. Releasing 0.9 needs them, and they are process, not product. They also sit in the unreleased beta.2 work.
- `apps/cli`. V9-4 names the CLI as the agent surface.

### Needed by a Keep piece

A scan of imports, run on `main` and again on the base `release/0.8.0-beta.2`, found that the Keep pieces reach more packages than the Keep list names. These packages stay while their importer stays.

- Reached from the desktop shell, the core packages, or the engine adapters, directly or through another package:
  - `contracts`, `context-slices`, `harness-bundle`, `crew`, and `codex-adapter`.
  - `project-config`, `project-context`, `project-authoring`, and `managed-skills`.
  - `skill-manifest`, `skill-sources`, `diagnostics`, and `authoring`.
  - `admission`, `broker`, `mcp-connections`, and `runtime`.
  - `broker-postgres`, `controlled-tests`, `graph`, `portable`, and `startup`.
- Reached only through `apps/cli`: `connections`, `harness-portability`, `linux-browser`, `local-backend`, `local-control`, `recipes`, `routines`, `runtime-bridge`, and `workspace-effects`.

Most of the 0.7-era packages are in this list. Removing one breaks a Keep piece. The scan reads imports in non-test source, including dynamic `import()` calls.

### Drop

- The beta.2 screens as built: Overview grid, Projects, Start, Library, and the unbuilt Compare and Runs. Decision 1C removes them at the start of 0.9 and rebuilds what 0.9 needs. Under the direction change, the exclusive ideas live in the core engine behind APIs, and their interfaces ship as non-removable default extensions (relayed, not on GitHub, an inference to confirm). The Electron shell and the data layer stay. Decision 1C does not draw the line between the screens and the shell. A later chat answer, relayed and not on GitHub (see "Follow-up answers"), proposed a layering: navigation is a mod, and the screens are extensions. The relayed direction change puts that layering in question for the exclusive ideas. The renderer also holds navigation and the notes link flow, and shared code that Keep lines name. The removal needs its own plan. This pull request removes nothing.
- The 52 `task/0.8-*` branches, as branches. No 0.9 item depends on a branch name. Their work reached `main` inside pull request 110, which squash-merged the `release/0.8.0-beta.1` branch. Pull requests 111 to 123 merged into that release branch first. Only 110 and 120 appear in the history of `main`. No pull request has one of these branches as its head. History cannot prove that each branch is fully in `main`, so decision 4C drops them by tagging each tip and then deleting. On 2026-11-09 all 52 tips were tagged `archive/0.8-*` on the remote, and then the branches were deleted.

Two Drops come from the maintainer's decisions, not from proof: the screens (1C) and the branches (4C). Any other Drop needs proof that no 0.9 item depends on a piece, and no other piece has it. The stated direction names no 0.9 item for any piece under Unsure, and none that rules it out.

### Unsure

- Issue 145, Compare and Runs. Decision 2B leaves it unbuilt for beta.2. Decision 1C rebuilds the screens if 0.9 wants them. Under the relayed direction change, the concepts sit in the core behind APIs (relayed, not on GitHub, an inference to confirm). Runs data can overlap the V9-6 traces API, which is not specified yet.
- The unreleased beta.2 work. Decision 2B: do not release beta.2, and carry the 8 merged pull requests into the 0.9 branch. Half of those pull requests are screens (149, 151, 153, and 155), and decision 1C rebuilds the screens. The relayed direction change puts their concepts in the core engine behind APIs (relayed, not on GitHub, an inference to confirm). A later chat answer, relayed and not on GitHub (see "Follow-up answers"), says to base off the latest and build from there. The answer does not say whether the latest is `main` or the beta.2 release branch. The maintainer confirmed it in chat on 2026-11-09 with the word "beta.2", relayed by an assistant agent and not on GitHub: the base is `release/0.8.0-beta.2`. The check made before the confirmation: the tip of `main` (`d66fc965`) is an ancestor of the tip of that branch (`d4c8a478`), so `main` holds 0 commits that the branch lacks. The branch has 8 commits that `main` lacks, and decision 2B keeps those 8 pull requests. `main` holds no commit that the base lacks, so nothing needs merging into the base.
- The documentation site and the landing site. They describe the 0.8 app. The new product concept will change them. No 0.9 item names them, and no decision in this round covers them. Keep pieces read from them, so they cannot be dropped first: the desktop shell build copies fonts from `apps/landing`. About a dozen test files read `apps/docs` pages, among them CLI tests and the `harness-bundle` contract test. A desktop test reads `apps/landing`. A CI workflow filters on `apps/landing` paths, and a preview check reads both sites. The root package lists `apps/landing` as a workspace. Tests of several needed packages also read `examples/`.
- The desktop end-to-end suite and the journey tests. No V9 item names them. They follow the screens decision. They test the screens that decision 1C removes, so the rebuilt screens need new tests.
- Four packages that no Keep piece imports from source: `claude-adapter`, `roots`, `team`, and `workbench`. No 0.9 item names them. Decision 3 is B for now and C later. For now, freeze them: mark each unsupported in its README and the docs, do no new work, and remove nothing. That marking is not done yet. Later, remove them in a separate reviewed pull request that updates every reference. A later chat answer, relayed and not on GitHub (see "Follow-up answers"), says no date is known. They are not proven safe to remove, because other files refer to them:
  - `claude-adapter`: nothing imports it, and the CLI pack list omits it. The test coverage check in `tools/test/test-coverage.test.mjs` lists its tests, so removal needs that entry gone first.
  - `roots` and `team`: the root test scripts name both, and `tsconfig.json` includes the `roots` tests.
  - `roots` and `workbench`: the CLI pack list in `tools/cli-distribution/pack.mjs` names both.
  - `team`: a development tool under `tools/step5` imports it.
  - `workbench`: three tests under `tests/` and one startup test read its fixtures.
  A removal needs its own pull request that updates those references.
- `apps/mcp`. It is a root workspace and a declared bin (`bowerloom-mcp`) of the private root package. The root test script runs its tests. It imports no package. No 0.9 item names it. No decision in this round covers it.
- Export and import of harness bundles. It shipped in `0.8.0-beta.1`. The code (`packages/harness-bundle`) is a dependency of the Keep shell, so it stays. Whether export and import stays a supported feature is not a 0.9 call that any item makes, unless question 1 under "Direction change" puts it on the exclusive list.
- The knowledge graph idea in closed pull request 106. V9-1 can reuse it. See "Branches".
- Issues older than 138. No V9 item names them. This sort leaves them out. Issues 156 to 160 already group part of them as tech debt.

### Missing data

- A search of the `main` tree found no extension interface document or code, no terminal app, and no `relay` package. The extension interface, the terminal app, and `relay` start from nothing in this repository.
- The claims about the external multi-engine environments are the maintainer's description. They are not checked against those products' documents.
- Trademark and name checks for V9-7 are not done.
- The relayed chat items are not on GitHub, and git cannot check them. They are the follow-up answers, the V9-8 request, the direction change and its confirmation, the confirmation of the `release/0.8.0-beta.2` base, and the scope selections in the acceptance section.
- The state of issues and pull requests comes from GitHub, read on 2026-11-08. Git cannot confirm it.
- The import scan reads static and dynamic imports in source files, and it skips tests. It first ran on `main` at commit `d66fc965`. It was rerun on the base, `release/0.8.0-beta.2` at commit `d4c8a478`, with the same result: 22 packages reached from the core, 9 reached only through the CLI, and the same four unreached. It does not read scripts, configuration files, or string references.

## New feature request

This section records a request that the maintainer made in chat on 2026-11-09. An assistant agent relayed it. It is not on GitHub. It is a request and not a build. Nothing here is decided.

The request: in the included chat interface of 0.9, agents can give structured output that renders like a small dashboard snapshot. The output keeps one consistent, internally defined look. It covers notes, a question and answer form with a submit button, and whatever else an assistant needs in order to get the maintainer's attention and knowledge.

Layer, as a proposal. The component schema and the submit contract belong to the core, so every surface and host shares them. The renderer in the included chat interface was proposed as a default extension, in line with decision 1C. The relayed direction change, applied to V9-8 by this document, keeps the renderer as a non-removable default extension over engine concepts, with the schema and submit contract in the core. That is an inference to confirm, and this split stays an open question, not a decision. [Decision comment 1](https://github.com/sageadvicellc/bowerloom/pull/162#issuecomment-6731689297) on this pull request asked the layer question before the change. Its option A (core holds the schema and submit contract, renderer is a default extension) is closest to the refinement.

Requirements sketch:

1. A defined component schema. Agents emit components from this schema. The chat interface renders them with one consistent look. Agents do not send free-form HTML. The goal is safe rendering, and the limits that reach it are an open question below.
2. Components an assistant needs to get the maintainer's attention and knowledge:
   - A decision card: the question, lettered options, the recommended option, a default with a deadline, and a submit button.
   - A status snapshot: lanes, pull requests, and counts.
   - An approval card: the item, the exact head, the risk class, and a confirm or decline choice.
   - A notes block.
   - A list of evidence or links.
   - A checklist.
   - A progress strip.
   - A diff or change summary.
   - A free-text answer box.
3. A submit action returns a typed answer to the asking agent. The answer says who answered.
4. The same components work in the desktop app, in a CLI fallback, and on other host platforms.

Open questions:

- What format does the schema use, and how is it versioned?
- What limits keep rendering safe: no scripts, a size cap, and a rule for links?
- How does the answer say who answered, and which identity counts as the maintainer's own?
- How does a typed answer reach an agent that is no longer running?
- How does the CLI fallback show a dashboard snapshot?
- Can extensions add new component types, and who reviews them?
- Where are answers stored, and does that overlap the traces API (V9-6)?
- How do the components meet accessibility needs?

## Acceptance: v0.9 working

The maintainer chose the scope in the Claude interface on 2026-11-09. An assistant agent relayed the choice. It is not on GitHub. The choice is a selection from options that the assistant agent listed: "A The 0.8 app on new layers (Recommended)". A selection of a recommended option is weaker evidence than a typed reply, and the maintainer can regroup or change anything below. This section turns the choice into a list that a test or a reviewer can check. The routes come from `apps/desktop/renderer/harness/HarnessApp.tsx` at `release/0.8.0-beta.2` (commit `d4c8a478`).

Items 2, 3, and 4 describe tests that cannot run yet. The base has no extension code, no engine API client, and no contract. The lanes that build them write the tests first.

### Chosen scope and related answers

All lines are relayed, not on GitHub. Each is a selection from options that the assistant agent listed. The relay gives no time and no author beyond the assistant agent.
- Answered in chat, 2026-11-09: v0.9 scope "A The 0.8 app on new layers (Recommended)".
- Answered in chat, 2026-11-09: mods "A Extensions only, no mods (Recommended)". This answers the mods part of question 2. Whether a user can hide or retheme a protected extension, and whether the extensions harness for people who build their own modules survives, stay open.
- Answered in chat, 2026-11-09: exclusive set "A Accept the nine in the doc (Recommended)". This answers question 1.
- Answered in chat, 2026-11-09: API form "A In-process library API first (Recommended)". This answers the first part of question 3. A local server and the question of who can call the API (question 4) stay open.
- Answered in chat, 2026-11-09: Tauri order "A Electron first, Tauri after (Recommended)". It relates to question 7, and it does not answer it.

### What "working" means

Version 0.9 is working when every item below holds on a branch built from `release/0.8.0-beta.2`. Decision 1C removes the beta.2 screens at the start of 0.9. Under this scope, the removal is a rebuild with parity: each removed screen comes back as a default extension with the behavior it had at the base.

1. Parity. The 0.8 app behaves as it does at the base. The routes are `welcome`, `choose`, `read`, `notes`, `overview`, `harnesses`, `builder`, `file`, `library`, `projects`, `runs`, `compare`, `interfaces`, `history`, and `help`. Before the rebuild starts, a route-to-spec matrix lists, for each route, the end-to-end specs that cover it, by name. A route with no spec gets one before it is rebuilt. A spec that tests a rebuilt screen is replaced and not deleted. The replacement keeps every assertion of the original. Sample and preview launches keep working.
2. Default UI extensions. Each work area below is a default UI extension. The registry is the only route table, so a screen renders only through its registration. A test shows that a screen is absent when its registration is removed in a test setup. A test shows that an uninstall of a protected extension returns a named refusal code. The refusal of an uninstall is the only protection behavior that this item fixes. The work areas are:
   - Overview.
   - Harnesses: the list, the builder, and the file view.
   - Library.
   - Projects: with the start, adopt, project, save, install, add, export, and import sheets, and with Runs and Compare mounted unchanged. Any call that Runs or Compare make is bound by item 3.
   - Interfaces, History, and Help.
   - The first-run flow: welcome, choose, read, and the notes link flow.
3. One client of the engine API. The layers are, in order: the screen, a named engine API client, a transport, and the library of the engine API. The transport is the Electron preload bridge today. The library runs in the main process, so "in the same process" holds between the main process and the library, not between the renderer and the library. Tests show:
   - Every entry of `ENGINE_CALLS` (39) and every reader call (3) is served by the library.
   - The preload exposes no call that the library lacks.
   - The calls keep their argument counts and refusal codes. The reader codes are `NOT_ALLOWED`, `BAD_ARGUMENT`, `UNKNOWN_PLACE`, `TOO_MANY`, `BUSY`, `NO_HOME`, and `FAILED`. The engine codes are `NOT_ALLOWED`, `BAD_ARGUMENT`, `UNKNOWN_FOLDER`, `UNKNOWN_BUNDLE`, and `FAILED`.
   - No renderer file reads `window.bowerloomReal` or `window.bowerloomEngine` except the transport adapter of the client.
   - No renderer file imports `electron` or a Node module.
4. A contract for the engine API exists, with conformance tests. It does not depend on the desktop app. It opens no port and no listener. It satisfies V9-9 for 0.9 in its in-process form. Parts of V9-9 beyond that form, such as the shape for other platforms (question 6), come later.
5. The shell keeps its protections. The fuses `runAsNode` and `enableNodeOptionsEnvironmentVariable` stay off. The content security policy, the permission refusal, the page scheme, and the close guard work as at the base. The test files that hold these checks at the base are `tests/packaging.test.ts`, `tests/security.test.ts`, `tests/real-static.test.ts`, and `tests/close-guard.test.ts`, all under `apps/desktop`. The lane that rebuilds the shell records which file covers which protection, and adds a test where none exists.
6. The tests pass. Every test that runs at the base passes, except the specs that item 1 replaces. This covers the unit tests under `apps/desktop` (142 files at the base) and the rest of the root test script. It covers the end-to-end specs (48 at the base), run with hidden windows. The counts are a base reading and not a pass criterion.
7. The command line works. The tests of `apps/cli` pass, and so do the root tests that read `apps/docs`, `apps/landing`, `apps/mcp`, and the four frozen packages.
8. The gates exit 0. The base has no `lint` script. The gates are, at the root, `typecheck`, `build`, and `test`, and in `apps/desktop`, `typecheck`, `test`, `e2e`, and `verify:fuses`. Adding a `lint` step is not part of v0.9 unless the maintainer asks.

### Not needed for "working"

This list is a delivery cut. It does not remove anything from "What 0.9 needs", and the reasons in the Keep list still stand.
- The memory explorer (V9-1), the engine views (V9-2), structured chat output (V9-8), the terminal app (V9-4), the traces API (V9-6), and the name research (V9-7).
- Mods, and a local server for the API.
- A move of the desktop shell to a different framework.
- A release. Publishing, tagging, and npm are separate steps that only the maintainer takes.

### Open points

- The assistant agent that relayed the scope spoke of five default UI extensions. Item 2 lists the work areas of the base, which come to six groups when the first-run flow counts as one. The count is a grouping choice, and the list above does not depend on it.
- The doc has no screen-by-screen behavior list. The route-to-spec matrix in item 1 is the first lane's output, and it becomes the reference.

## Branches

- 52 `task/0.8-*` branches, dated 2026-10-28 to 2026-11-05. None has a pull request of its own. Their work reached `main` through pull request 110, which squash-merged the beta.1 release branch. Pull requests 111 to 123 merged into that release branch first. A squash leaves no shared history. A file-by-file compare against `main` is also not conclusive, because `main` has moved since. Every branch differs from `main` in 26 to 216 files for that reason. The audit therefore cannot prove that a branch is fully in `main`. Decision 4C: tag each branch tip, then delete the branches. On 2026-11-09 the 52 tips were tagged `archive/0.8-*` on the remote, and then the 52 branches were deleted. Every commit stays reachable from the tags. This pull request itself deletes nothing.
- 7 `task/0.8b2-*` branches. Each has a merged pull request (149 to 155) into the beta.2 release branch. They are not on `main` until beta.2 merges, so they are not stale.
- `task/open-beta-release-01`. It is 0.7 work, last changed 2026-10-06, and has no pull request.
- Closed unmerged pull requests 104 to 109. They hold the folder grant summary kind, a read-only desktop viewer, a node map with a knowledge graph, and three clickable 0.8 prototypes. Their branches no longer exist on the remote. GitHub keeps their commits behind the pull request references. V9-1 can reuse the knowledge graph idea from pull request 106. That is Unsure until the maintainer says so.

## Decisions

The maintainer answered on 2026-11-09 in [one comment](https://github.com/sageadvicellc/bowerloom/pull/162#issuecomment-6731232158).

1. How much of the current desktop interface survives. Answer 1C: keep the shell only. Rebuild the interface on the new extensions API and ship it as included default extensions. The relayed direction change below amends the "included default extensions" wording of 1C and its extension-API framing, and it overrides the removable reading of (a). Answer 1C stands as recorded on GitHub until the maintainer records the change there.
2. What happens to the unreleased beta.2 work and the two unbuilt issues. Answer 2B: do not release beta.2. Carry the 8 merged pull requests into the 0.9 branch.
3. What happens to the four packages that no Keep piece imports from source. Answer 3B for now and 3C later: freeze them now, and remove them in a separate reviewed pull request later.
4. What happens to the stale 0.8 branches. Answer 4C: tag each tip, then delete the branches. Done on 2026-11-09, as the Branches section says.

## Follow-up answers

The maintainer answered four questions about the first reply in a chat on 2026-11-09 (UTC). An assistant agent relayed the answers. They are not posted on GitHub.

- (a) Can a user remove the default extensions? Answer: yes, with no lock-in to a bundled style. Bowerloom can also be installed on other host platforms, and always as a CLI. Reading: the defaults are removable. The relayed direction change below overrides this reading (relayed, not on GitHub).
- (b) What is the base of the rebuild? Answer: "base off latest, and build from there". An assistant agent first read this as the latest `main`. The maintainer then confirmed `release/0.8.0-beta.2` in chat on 2026-11-09 with the word "beta.2" (relayed, not on GitHub). Check result: `main` (`d66fc965`) is contained in that branch (`d4c8a478`), 0 commits on `main` are missing from it, and 8 commits on the branch are missing from `main`. Reason: decision 2B keeps those 8 pull requests. `main` holds no commit that the base lacks.
- (c) When is the removal in 3C? Answer: no date known.
- (d) Where is the line between screens and shell? Answer: layer it. The relayed direction change puts this layering in question for the exclusive ideas. See "Direction change". Extensions are new features, including interfaces and code that calls APIs. Mods change interface parts such as navigation, which Bowerloom otherwise does not change, to allow full theming and not only color changes.


## Direction change

This section records a product direction change that the maintainer made in chat on 2026-11-09 (UTC). An assistant agent relayed it in three messages. It is not on GitHub, and the document cannot verify it. Answer 1C stands as recorded on GitHub until the maintainer records the change there.

The change amends answer 1C on how the interface is built, and it overrides the removable reading of follow-up answer (a). Answer 1C itself did not say whether the defaults are removable.

The first message, as relayed: "I need to pivot. We need to build bowerloom exclusive ideas into the core app engine and expose them with APIs, meaning i'm overriding the idea from earlier that we make them removable."

The second message, as relayed: "The interfaces of these elements can still be where we provide default extensions for ui (non removable) but the concepts need to be engine narive. does that make sense? this is our differentiator over other engines and our entire product. it's also what we'll ship as extensions on other platforms where possible, brining them closer to our concepts"

The third message, as relayed: the maintainer answered "correct" to a summary of three readings. The summary said:
- Default UI extensions that are not removable are extensions by mechanism, protected from uninstall.
- The concepts are engine-native, with APIs.
- The host-neutral API contract is a requirement.

The reading of the relaying agent, not the maintainer's words: the concepts are the product differentiator, and so the core product surface.

### Confirmed in chat (relayed, not on GitHub)

The maintainer confirmed principles. A principle does not say which concepts count as exclusive. Each line that applies a principle to one entry is an inference to confirm, and it carries that tag. The relaying agent wrote the summary that the maintainer confirmed with "correct". Three bullets rest on that summary. The third bullet rests on the second relayed message.

- A non-removable default UI extension is an extension by mechanism. Bowerloom protects it from uninstall.
- The concepts are engine-native, with APIs. The first relayed message puts them in the core.
- The interfaces of the concepts can be where default extensions ship, and those extensions are not removable. This comes from the second relayed message, in the maintainer's relayed words.
- The host-neutral API contract (V9-9) is a requirement.

### What it changes

- Removability came from follow-up answer (a), not from answer 1C. The change overrides the removable reading of (a).
- The change amends the "included default extensions" wording of answer 1C, and its extension-API framing. The interface is built on the engine API, with non-removable default UI extensions.
- The layering in follow-up answer (d), with screens as extensions and navigation as a mod, is in question. It is not settled either way.

### What it does not say

- It does not say whether extensions and mods stay as layers for features that are not Bowerloom-exclusive (question 2).
- It does not say which ideas count as exclusive (question 1). The list below is an inference.
- It does not say what "APIs" means: a library, a command line, or a local server (question 3).
- It does not say who can call the API (question 4), or whether the no-lock-in answer of (a) survives (question 5).
- It does not say whether the shell framework changes (question 7).
- It does not change decisions 2, 3, and 4 or the base `release/0.8.0-beta.2`, as far as the relayed text goes.

### Requirement: a host-neutral API contract (V9-9)

The maintainer confirmed in chat that this is a requirement (relayed, not on GitHub). The engine API contract must not depend on the Bowerloom desktop app. The relayed text says the concepts also ship as extensions on other platforms "where possible". Under this requirement, being a host confers no trust to call the API. That is a design stance of this document, not relayed text. Question 4 covers who can call it.

The shape of the contract is open. Two readings exist: other platforms implement Bowerloom's contract, or Bowerloom publishes extensions into each host's own extension system, or both. Question 6 asks. These points are open:
- Who owns and versions the contract.
- How an implementer proves it conforms.
- Which parts of the contract another platform can leave out.

### Entries this changes

Each line says what the entry was, and what it becomes. The change itself is relayed. Which concepts count as exclusive is an inference to confirm. The inline pointers in "What 0.9 needs" and the sort mark most of these entries. The Keep lines for the exclusive-idea packages carry no pointer, and the last bullet below covers them.

- V9-1, memory explorer. Was: a stock extension. Becomes: an engine concept with an API, and a default UI extension that is not removable.
- V9-2, engine views and explorers. Was: stock extensions. Becomes: engine concepts with APIs, and default UI extensions that are not removable.
- V9-3, extensions. Was: the interface rebuilt on a new extensions API and shipped as removable default extensions. Becomes: the interface built on the engine API, with non-removable default UI extensions. The extensions harness for people who build their own modules stays or goes on the maintainer's word.
- V9-4, three surfaces. Unchanged in content. Each surface becomes a client of the engine API.
- V9-5, bring-your-own-interface engine. Unchanged in content. The direction fits it.
- V9-6, traces and logging API. Unchanged in content. It becomes one more engine API. The timing rule stays.
- V9-8, structured agent output. Was: the schema and submit contract in the core, and the renderer as a default extension. Becomes: the same split, with the renderer as a non-removable default extension. This is closest to option A of decision comment 1. The open questions about safe limits, identity, storage, and accessibility stay.
- V9-9 is new.
- The Keep line for the Electron shell. The shell stays, as a client of the engine API.
- The Drop line for the beta.2 screens. Was: rebuild as default extensions. Becomes: concepts in the core behind APIs, and interfaces as non-removable default extensions.
- The Unsure line for issue 145, Compare and Runs. Was: extensions if 0.9 wants them. Becomes: engine concepts if 0.9 wants them. Runs data can overlap the V9-6 traces API.
- The Unsure line for the unreleased beta.2 work. Half of those pull requests are screens. The concepts behind them move to the core.
- The Keep lines for `harness-definition`, `fidelity`, `adoption`, discovery, and `notes-source`, the wiki-linking part of issue 143, and the Unsure line for harness bundle export and import. These stay as they are until question 1 is answered. Several are probably exclusive ideas.

### Ideas that probably count as Bowerloom-exclusive

The maintainer accepted the nine by a relayed selection on 2026-11-09 (see "Acceptance: v0.9 working"). The list is still the relaying agent's inference in origin. The relayed message calls the concepts the differentiator and the entire product.

- Libraries and harnesses: the harness definition, its portable projection, and the per-engine fidelity report that lists every loss.
- Visual management of libraries and harnesses: the ideas behind the Overview, Library, Projects, and Start screens.
- Adoption: reading engine files and writing a harness definition by copy.
- Discovery and the scan cache, which show the whole environment.
- The notes link flow and the memory explorer (V9-1).
- The engine views and visual explorers (V9-2).
- Harness bundle export and import.
- Structured agent output and the submit contract (V9-8).
- The traces and logging API (V9-6).

### Questions for the maintainer (drafted, not posted)

The maintainer decides where these go. This pull request posts nothing. Two questions from the earlier draft are answered by the third relayed message and are dropped.

1. Which ideas count as Bowerloom-exclusive? Answered by a relayed selection: accept the nine. See "Acceptance: v0.9 working".
2. Do extensions and mods stay as layers for features that are not exclusive? If yes, which features are those? Mods are answered by a relayed selection: extensions only, no mods in 0.9. The rest of this question stays open. Does navigation stay a mod for the default UI? Can a user turn off, hide, or retheme a non-removable extension? Does the extensions harness for people who build their own modules survive?
3. What does "expose with APIs" mean? The first form is answered by a relayed selection: an in-process library API. A local server stays open. The question as asked: a library import, a command line with structured output, a local server, or all of these? Which one comes first? This is a security question, because a local server adds listener, authentication, and browser-origin risks.
4. Who can call the API: only Bowerloom surfaces, or also other programs on the same machine? This is a security question. It links to the V9-8 question about who counts as the answerer.
5. Does the earlier request for no lock-in to a bundled style still hold? If yes, how: through theming, or through the API, so that a user can build another interface? Does the host-neutral contract (V9-9) replace it?
6. What shape does the host-neutral contract have: other platforms implement Bowerloom's contract, Bowerloom publishes extensions into each host's own system, or both? Who owns and versions it, and how does an implementer prove it conforms?
7. If the desktop shell framework changes, do the core and its API stay the home of these ideas? [Pull request 163](https://github.com/sageadvicellc/bowerloom/pull/163) is a draft plan for such a move. This pull request makes no claim about it.
