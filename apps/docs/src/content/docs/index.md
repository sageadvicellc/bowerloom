---
title: "Build with your agent"
description: "Turn a goal into a team setup that you can read and review."
section: "Start here"
order: 0
---

Bowerloom is an open-source framework for agent teams in readable files. Start with your existing agent and a goal.

Review the roles, skills, working agreement, and milestones before approving the exact file plan. Your first result is a setup to inspect.

<!-- release:status:start -->
**Open beta · unreleased** · `0.7.0-beta.0`

**Unavailable until publication.** The npm package is not published. Run the installation command only after this exact version is published.

Setup does not start workers, grant runtime access, or authorize connected actions.

- Full runtime acceptance remains incomplete.
- The initial beta needs founder acceptance and publication approval.
- Unattended support requires an independently accepted installed security configuration.
<!-- release:status:end -->

## Choose your next step

| Your goal | Start here |
| --- | --- |
| Try the setup example | [Learn Bowerloom](/docs/learn/) |
| Add a setup to your project | [Guides](/docs/guides/) |
| Understand files and permissions | [Concepts](/docs/concepts/) |
| Find a command, field, or error | [Reference](/docs/reference/) |

## What setup gives you

The first setup proposes 20 files. Exact approval installs those files and adds one private receipt.

The fixed template includes a personal-agent profile, team roles, working agreement, milestones, and two reading guides. It does not assess goal feasibility.

```text
.bowerloom/
├── START-HERE.md
├── startup-review.md
├── working-agreement.md
├── milestones.md
├── skills/personal-assistant/
└── teams/first-team/
    ├── team.yaml
    ├── prompts/
    └── skills/
```

This reading map shows selected files. [Files and configuration](/docs/configuration/) lists the full inventory.

## Give your agent the docs

Ask your existing agent to read the current page for your task. Each task pairs a human prompt with a procedure.

Use [the agent index](/docs/llms.txt) to find one relevant page. Each page also offers its complete Markdown text.

A documentation prompt grants no new tool access or execution permission. [Plans and exact approval](/docs/permissions/) explains the next decision.

[Install Bowerloom](/docs/start/) · [Current support](/docs/status/) · [Main site](/)
