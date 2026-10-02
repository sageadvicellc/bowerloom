# Build your first team tutorial

The landing page prepares a project prompt for your existing personal agent. It does not call a model or start workers.

Choose a useful project, then describe your goal. Select a palette and a review style. Copy the resulting prompt into your personal agent.

The examples cover client onboarding, a product launch kit, and a weekly project review. Use fictional details for your first project.

## Agree before work starts

Your agent proposes a lead, a maker, and an independent reviewer. The agreement assigns files, deliverables, tools, and acceptance criteria.

Your agent inspects available capabilities before it proposes an execution path. General authored-team execution remains unproven in this alpha.

If native subagents provide the available path, your agent names that path in the agreement. It asks for your approval before work starts.

A native subagent run does not prove Bowerloom runtime support. A validated definition does not establish that a team ran.

If the required controls or account capacity are unavailable, your agent records the blocker. It does not simulate workers or claim execution.

## Review at milestones

Both review styles require approval of the working agreement. Both end at your review of the final result.

With milestone review, the agent also waits for approval of the first draft. With more autonomy, it sends an update and continues within the agreement.

Mandatory tool approvals always apply. Neither style permits spending, publication, messages to other people, connected-application writes, or a public deployment.

The prompt limits the team to two active workers. It requires current account capacity and a reserve of at least 25 percent.

## Inspect the result

The team saves local artifacts in a new `tutorial-output` directory. Existing files require an explicit replacement decision or a new directory.

The handoff includes the following artifacts:

- The project brief and working agreement.
- Proposed or validated team definitions and versioned skills.
- Deliverables, milestone evidence, and independent review findings.

The local `index.html` links to the work and uses your chosen palette. Claims of execution require actual tool evidence.

## Setup and evidence limits

Optional checkout setup requires Git, Node 24.11 within Node 24, and npm 11. The prompt contains the actual setup commands.

The existing offline example returns `runtimeReady: false`. This result means that validation grants no execution authority.

The earlier [report exercise](one-page-report.md) remains a historical example. The [Labs-to-blog workflow](../recipes/labs-to-blog.md) retains its separate runtime evidence and approval controls.

The page stores choices only in React memory. It sends no goal text to a model, backend, or local storage.

Prompt instructions do not enforce controls in another agent application. This tutorial does not establish general runtime acceptance or production readiness.
