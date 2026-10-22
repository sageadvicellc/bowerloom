---
title: "Build with your agent"
description: "Set up the skills, prompts, and teams your agents use, and approve every change."
section: "Start here"
order: 0
---

Bowerloom is an agent environment manager. It sets up the skills, prompts, and teams that Claude Code and Codex use in your project. Each change shows its exact plan first, and Bowerloom writes nothing until you approve that plan. It records what it installed, and it does not overwrite a copy that you changed. Start with your existing project and the work you do by hand or with one agent.

## Choose your next step

| Your task | Start here |
| --- | --- |
| Map your current process into a team specification | [Map your existing workflow](/docs/guides/integrate-workflow/) |
| Install the CLI for your project | [Install Bowerloom](/docs/start/) |
| Add pinned skills from npm or GitHub | [Add third-party skills](/docs/guides/add-skills/) |
| Create a team, skill, or prompt | [Create teams, skills, and prompts](/docs/guides/create-items/) |
| Add the reviewed specification to your project | [Integrate your first team](/docs/learn/first-team/) |
| Change an installed goal or profile | [Revise an installed setup](/docs/revision/) |
| Understand definitions and approval | [Concepts](/docs/concepts/) |
| Find a command, field, or error | [Reference](/docs/reference/) |

## What setup gives you

The fixed template includes a personal-agent profile, team roles, a working agreement, milestones, and two reading guides. The lead scopes the work, the maker prepares a draft, and the reviewer receives both scope and draft. Planning proposes 20 files, and exact approval installs them with one private receipt. The CLI does not import your project, assess goal feasibility, or start workers. Compare the specification with your existing process before approving later project work.

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

Ask your existing agent to read the page for your current task. Each practical guide pairs a human prompt with a precise procedure and its prerequisites. [The agent index](/docs/llms.txt) finds the relevant page, and each page offers its complete Markdown text. A copied prompt grants no new tool access or execution permission. [Plans and exact approval](/docs/permissions/) explains the operation that you review.

## Optional new workspace

If you want a separate unused workspace, follow [Prepare a separate workspace](/docs/guides/new-workspace/). Existing-project integration remains the primary path.

[Current support](/docs/status/) · [Roadmap](/docs/roadmap/) · [Bug reports and feedback](/docs/feedback/) · [Main site](/)
