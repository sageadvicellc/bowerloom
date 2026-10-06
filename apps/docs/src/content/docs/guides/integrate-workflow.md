---
title: "Map your existing workflow"
description: "Turn manual or one-to-one agent work into a specification for your current project."
section: "Learn"
order: 2.5
---

Start with a process you already perform manually or with one agent. Describe its inputs, decisions, outputs, and handoffs before choosing a team profile. Bowerloom gives that process a specification in files that follow you, with proposed roles, access, and review points. The beta's setup installer governs the approved file write. It does not import project contents, generate an arbitrary graph, or execute the workflow.

## Understand the team graph

A team graph describes tasks and their handoffs. The fixed first-team specification assigns scope to the lead, a draft to the maker, and review to the reviewer. The draft depends on scope, while review depends on both scope and draft. The role prompts, declared outputs, and handoff map express that relationship. Review the fixed structure against your process before accepting it as your starting specification.

```text
Lead: scope ────→ Maker: draft ────→ Reviewer: review
     └────────────────────────────→ Reviewer: review
```

## Ask your agent

```text
Help me map my existing manual or one-to-one agent workflow into a Bowerloom team specification for this project. Ask what each step reads and produces, where work changes hands, and which decisions stay with me. Use my description as input and ask before reading additional project files. Compare the workflow with the fixed Engineer, Founder, or Research profile. Show the roles, handoffs, proposed access, working agreement, and gaps. Stop for my review before installation or project execution.
```

## Agent procedure

### Describe the current process

Use the human's supplied description as input. Ask before reading additional project files or past conversations.

Record each step's input, output, owner, and decision. Identify the handoff to the next step.

### Compare the fixed profile

Choose the relevant [Engineer, Founder, or Research profile](/docs/concepts/teams-and-files/).

Compare the process with scope, draft, and review. Identify responsibilities that the fixed profile does not cover.

Do not claim an automatic workflow import or arbitrary graph generator. Keep proposed permissions separate from actual tool access.

### Review the specification

Show the proposed roles, handoffs, outputs, access, and review points to the human. Explain gaps before requesting installation approval.

Use [Integrate your first team](/docs/learn/first-team/) for the exact existing-project plan and installation sequence.

If `.bowerloom/` already exists, use [revision](/docs/revision/) for supported goal or profile changes.

### Review the installed result

Read the local guides, team specification, role prompts, and handoff map with the human. Compare them with the agreed workflow.

Record any remaining mismatch before separately approved project work. Setup approval grants no worker, backend, or connected-action authority.

## Example mapping

An existing website project can begin with an accepted design brief, an implementation proposal, and a review of that proposal. The Engineer lead scopes the change, the maker prepares the draft, and the reviewer assesses it against scope. The specification declares the intended outputs and handoffs. You still decide whether that proposed structure fits the project. Installation stores the files without implementing the website.

[Install Bowerloom](/docs/start/) · [Integrate your first team](/docs/learn/first-team/) · [Bug reports and feedback](/docs/feedback/)
