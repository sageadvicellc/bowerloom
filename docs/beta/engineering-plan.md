# Beta engineering plan

Hanna approved v0.7-beta on October 4, 2026. Issue #51 records the release scope.
The baseline is merged alpha commit `edc491ad8c0206f2b77aae31eba20c5a1d7eef32`.
This document selects engineering work. It does not claim that its acceptance gates passed.

## Delivery order

1. Prepare the installable artifact and repair the saved setup handoff. Preserve both alpha receipt formats.
2. Add reviewed installation revisions, neutral harness definitions, and import reports.
3. Add controlled local and remote MCP connections, then bounded execution in both harnesses.
4. Extend resource links into a shared company service with independent personal installations.
5. Complete live Workbench comparisons and both demonstrations from the packaged artifact.
6. Assemble security, recovery, installation, and animation evidence for founder acceptance.

The first task branch is `task/beta-foundation`. Reviewed work integrates into `feature/bowerloom-beta`.
Only Hanna merges `main`. The alpha production deployment stays pinned until a separately approved release.
Existing brand, content, knowledge, and independent review chats keep their roles. The PM coordinates those chats.
The coding lead runs at most two implementation workers with distinct file ownership.

## Portable definitions and installed state

Retain the current crew contracts where they remain sufficient. Version new envelopes separately from historical receipts.
Portable definitions contain roles, skills, allowed resources, and connection declarations. They contain no credentials or machine-specific installation paths.
An installed binding records canonical paths, file hashes, source revision, harness version, and the exact approval.
An import report lists mapped fields, unsupported fields, conflicts, and secret references. It never imports conversation history by default.

The first adapters target observed Codex CLI 0.157.0 and Claude Code 2.1.288. These observations do not establish compatibility.
Test version-specific projections in isolated directories before changing any real harness files.
Preserve original files, comments, and unrelated fields. Removal affects only a matching managed projection.
Unexpected drift blocks replacement. A revised goal needs a new plan bound to the prior receipt and exact proposed changes.

A revision transaction records expected old hashes, new hashes, and its journal before replacing managed files.
Interrupted writes must resume or restore the old complete revision without accepting mixed state.
Concurrent updates, symlinks, replaced directories, and unrelated files require explicit negative tests.
Do not reuse the installation command to bypass its existing-directory guard.

## Runtime and approval boundary

Keep the deterministic controller as the authority for task state, effect approval, admission, and registered stop requests.
Harness adapters supply model output. They do not authorize their own writes or choose their own external destinations.
Native harness permission fields do not replace controller enforcement.
A projected team definition alone does not prove runtime isolation or execution.

Preserve PostgreSQL, the supported Supabase services, and MIT DBOS without Conductor.
Record every effect intent before dispatch. Reconcile uncertain external effects before any retry.
Both adapters need a tested route that denies effects outside the reviewed workspace and tool surface.
Missing provider capacity evidence blocks new model calls. Codex usage is not evidence of Claude subscription capacity.

## MCP boundary

Separate portable declarations from installed endpoint and secret bindings.
Remote private endpoints belong in local bindings. Public endpoint templates require an explicit disclosure review.
Never place a bearer token, authorization header, or secret value in a portable definition.

A connection plan shows the executable or endpoint, protocol, discovered tools, permission class, and proposed harness changes.
Tool descriptions and annotations are untrusted inputs. The controller applies its own permission policy.
Bind approval to the selected tool schema and server identity. Changed tools require renewed review.
Use a controlled gateway for approved tools when native harness controls cannot enforce the required boundary.
Test that native alternative routes cannot bypass that gateway before claiming safe execution.

Local stdio and remote Streamable HTTP are beta targets. No remote token crosses server or user boundaries.
Reject wrong audience, issuer, expiry, and scope. Test discovery changes, revocation, and interrupted calls.
Use a synthetic remote service if Greenhouse is unavailable. This does not establish Greenhouse readiness.

Current vendor references are the [Codex MCP guide](https://developers.openai.com/codex/mcp) and [Claude Code MCP guide](https://code.claude.com/docs/en/mcp).
Implementation must compare their current syntax with the installed version and preserve a source snapshot for its support claims.

## Company pilot and lifecycle

Hanna selected cast-based dummy accounts with synthetic project data for the first company trial.
Use Hanna, Miki, and S4-G3 from `company-pilot-fixture.json`. Their dummy addresses use `example.test`.
These personas represent no real employee accounts. Disable email delivery and keep credentials out of fixtures.
Declare memberships and resource grants separately for each test. The identity list grants no access.
Real business data and optional telemetry remain excluded until Hanna approves their retention and deletion schedule.
Keep personal and company databases, credentials, and execution roots separate.
Membership alone grants no resource access. Each resource grant names an owner, recipient, allowed action, and expiry or revocation rule.

Use Supabase Auth identities with explicit membership and resource grants for the first test design.
No hosted service purchase or identity-provider migration is part of this choice.
Test isolated users, revoked membership, expired authority, concurrent tasks, and company outage while personal work continues.
A server cannot reach a personal root merely because the employee joins it.

Represent retention as a versioned policy per data class, with owner, purpose, trigger, deadline, and deletion method.
Synthetic tests use short test deadlines. They do not establish business retention periods.
Cover source records, attachments, derived indexes, caches, traces, task state, exports, backups, and minimal deletion receipts.
Reapply revocations and deletion records before restored data becomes readable.
Keep the revocation record outside the restored backup. A restore without that record remains unavailable.

## Workbench and distribution

Use new code or cleared current-monorepo code. Do not import the historical Workbench repository under its unresolved license hold.
Freeze scenario inputs, tester revision, environment, reference trial, and acceptance criteria independently from authored teams.
Record observed results and uncertainty. A single comparison cannot establish an A/B gain.

Build the CLI from an explicit file allowlist. Exclude private files, test fixtures, credentials, source maps, and historical repositories.
Resolve workspace runtime dependencies in the artifact. Do not require the developer checkout or its node_modules after installation.
Hanna selected the unscoped npm package `bowerloom`, if available. The executable is `bowerloom`.
The registry returned HTTP 404 on October 4. This observation does not reserve the name or authorize publication.
Test installation, help, setup, revision, stop, harness conversion, MCP, Workbench, upgrade, and removal from the actual artifact.
Name supported operating systems explicitly. Do not infer cross-platform support from TypeScript compilation.

## Website and release evidence

The full homepage journey must feature Hanna, Miki, and S4-G3 with the approved brand references.
Animation planning and browser engineering can proceed while the remaining media allowance is reconciled.
Do not repeat completed media jobs. Generation stays within the approved allowance and needs a concrete cost estimate first.
The final sequence requires Hanna's creative acceptance, reverse-scroll continuity, reduced motion, mobile framing, and loading-failure evidence.

Preserve the accepted dark footer and current brand palette while reconciling the older green-footer wording in #42.
Preserve the founder's explicit ban on seed and sprout wording. The spec's older seed-language sentence does not override that instruction.
Content changes must distinguish implemented behavior, tests, and planned features.

Every release gate names source, artifact, harness, scenario, test result, reviewer, and open limitations.
Source unit tests do not replace live tasks or clean installation. Missing security results remain unknown.
Public beta publication, production promotion, and the final merge remain Hanna's decisions.

## Documentation site amendment

Hanna added a full documentation site as required issue #62 on October 4.
Evaluate a small Astro Starlight prototype first, with a pinned version and measured build output.
Starlight supports repository-owned Markdown and MDX through its [documented content layout](https://starlight.astro.build/getting-started/).
Choose a simpler maintained alternative only if the prototype supplies a concrete reason.

Keep content portable and separate from Greenhouse. Do not build CMS integration for this release.
Cover installation, first team, permissions, stop, revision, both harnesses, MCP, company isolation, Workbench, command references, and troubleshooting.
Each capability page states tested versions, source revision, known limits, and whether its example is a fixture.
Run documented commands against the packaged artifact. Test search, links, keyboard access, code readability, and mobile navigation.
Content review owns wording review. Independent review judges the supporting evidence.
Hanna selected `bowerloom.ai/docs`. Build the documentation under `/docs` in the existing landing deployment project.
Protected previews can proceed now. Public deployment remains a separate approval.
