# Trellis v0.7-alpha revision 02

Hanna selected this revision on October 1, 2026. It replaces the fixed craft-shop authoring trial as the primary founder experience.

The earlier implementation and its acceptance evidence remain preserved. This revision requires new evidence for its changed behavior.

## Product direction

Trellis is a free, open-source toolkit that agents use to build and operate automations. Start with focused skills, roles, templates, connection helpers, and a small CLI.

Keep the CLI and MCP connected to the same application operations. MCP lets an agent call tools through a standard interface.

Sagespec is the private Labs configuration built with Trellis. Its business choices and private information stay outside the reusable framework.

Workbench holds experiments, reference recipes, and repeated comparisons. It does not impose a permanent team on every user.

Use n8n when an application trigger or connection helps. Use LangGraph for reasoning steps, saved progress, and review pauses. A process does not require both.

## First recipe

The founder asks her existing agent to turn completed Labs experiments into blog drafts for review. The first real connection is GitHub.

The personal agent reads the relevant skill and asks for missing business choices. It creates a versioned recipe with an explicit source and destination.

The recipe reads an agreed experiment record and pins its revision. The agent writes a draft and connects its claims to that evidence.

The controller records the proposed draft, destination, and exact approval. An approved run creates or updates one draft pull request.

The recipe must never merge, publish, or write directly to a protected branch. A changed draft, destination, or evidence revision requires a new plan.

For acceptance, use a sanitized record from the completed Trellis technical experiment. Describe technical acceptance accurately without claiming founder release acceptance.

Keep the campaign's real owner, credentials, and private state outside shipped examples. Ship a synthetic example for another agent to repeat.

## Runtime boundaries

Separate reusable recipe instructions from the private installation. The installation grants repository, branch, path, and operation access.

Treat experiment text and generated prose as data. Neither can add permissions, select arbitrary hosts, or supply executable code.

Use LangGraph to coordinate the recipe's saved steps and review pause. Persist restart evidence in PostgreSQL through the established Supabase installation.

Retain explicit control records for approvals and external effects. LangGraph does not grant effect authority. Each effect has one retry owner.

The recipe effect controller alone owns GitHub mutations and reconciliation. LangGraph nodes call that controller and cannot send writes directly.

Replayed nodes inspect durable effect records before any operation. An unresolved effect remains blocked until reconciliation establishes its outcome.

The private installation selects the trusted approval issuer and its capability. Recipe files, draft text, CLI arguments, and MCP arguments cannot impersonate that issuer.

Bind approval to the recipe revision, evidence revision, draft bytes, repository, base, managed branch, output path, and proposed effects. Check cancellation and revision drift before each effect.

Preserve the earlier DBOS runtime and its proof. Do not nest independent retry loops around the same GitHub write.

The n8n connection helper can supply an event to the recipe. An event identifies work but cannot approve a draft or carry privileged credentials.

The personal agent supplies the draft through the existing subscription. The alpha introduces no paid model provider or hidden model call.

Keep setup, planning, status, review, approval, execution, reconciliation, and cancellation explicit. A successful plan grants no execution authority.

## Repeated setup and recovery

Repeated setup must identify the same installed recipe. The installation records a stable identity and the exact recipe revision.

Repeated execution must reuse the same draft branch and pull request. A completed run returns its existing result without another write.

Claim an external operation before sending it. After an uncertain response, inspect GitHub before another mutation.

Do not infer success from a matching branch name alone. Match the repository, base, draft status, managed path, content, and expected revision.

Concurrent requests must not create duplicate jobs or bypass the review pause. Cancellation blocks new effects and reports any effect already in progress.

An expired credential stops the affected operation. Preserve the run for recovery after access returns.

## Landing page

Hanna selected an interactive cyber-solar workshop with glowing connections. The primary action is “Build with your agent.”

Use the actual Projection UI design system as the starting point. Version 0.1.5 supplies dark surfaces, chartreuse accents, mono type, and compact controls.

Add a live 3D scene that explains the path from experiment to evidence, draft, and review. Keep navigation and reading surfaces in accessible HTML.

The page must describe the implemented alpha accurately. Connect its primary action to working setup instructions and a useful personal-agent prompt.

Support mobile layouts, keyboard access, reduced motion, and rendering failure. Pause unnecessary rendering when the page is hidden or the scene stops.

Set a measured rendering budget before accepting the scene. The visual experience must not obstruct setup instructions or the review path.

Keep documentation and GitHub links visible. Do not add a waitlist, account requirement, tracking, or a service subscription to this alpha.

## Evidence and review gates

Independent code review precedes feature integration. Hanna then performs UAT, which means testing the intended experience herself.

The acceptance packet records the exact source revision, commands, environment, outcomes, and known limits. A video presentation is not required.

The software acceptance cases are:

- Another personal agent can follow the skill and prepare the recipe without the original conversation.
- The real GitHub connection reads the selected experiment and creates one draft pull request after exact approval.
- Repeating setup and a completed run creates no duplicate recipe, job, branch, or pull request.
- An interrupted process resumes with the same saved state and reconciles uncertain GitHub outcomes.
- Changed approvals, destination drift, invalid evidence, and unsupported actions stop before a write.
- A forged approval issuer and a replayed approval for changed content stop before a write.
- A crash after GitHub accepts a write but before local acknowledgment triggers inspection rather than another blind write.
- The CLI and MCP use the same validation and authority checks.
- The landing page provides a usable setup path on desktop and mobile, including reduced-motion and failure modes.

Record setup time, review time, corrections, and available usage observations. Compare the same experiment and output criteria with the existing-tool approach.

Label unavailable usage measurements explicitly. Do not report measured savings from one unmatched run or claim repeated A/B improvement without repeated comparisons.

Founder review time remains unmeasured until Hanna performs the test. Agent review time is a separate measurement.

## Working order

The team owns implementation, independent review, and integration into `feature/trellis-v1`. Hanna alone merges into main.

Public deployment, release publication, new spending, and repository retirement retain their existing gates. Preserve the five module repositories and all earlier evidence.

Keep at most two implementation workers active. Preserve the campaign's five percent capacity reserve and the twelve GiB disk reserve.

Do not restart the old team or start a Sagespec or marketing crew. This revision builds the reusable toolkit and its private acceptance example.

The daily review records the current candidate and remaining founder decisions. During founder downtime, preserve approved work and collect questions for the agreed review window.
