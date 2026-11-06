---
title: "Teams, agreements, and files"
description: "Legacy 0.7. Understand the fixed profiles and the documents that guide their review."
section: "Legacy 0.7 team setup"
order: 18
---

> **Legacy (0.7).** This page describes the team setup flow of Bowerloom 0.7. Its commands are still in the CLI help of 0.8.0-beta.1. The current path is [Adopt and install a harness](/docs/guides/adopt-and-install/).

Your existing personal agent helps turn a workflow into defined roles, handoffs, and review points. Bowerloom stores the resulting specification in files that follow you, alongside your project. The fixed profile provides a starting structure for comparison with your actual process. Setup governs the approved file write and records its result. It does not grant runtime permissions or execute the proposed team.

## Fixed profiles

The profile selects a fixed template. It does not ask a model to invent a team or assess your goal's feasibility.

| Profile | Roles | Proposed outcome |
| --- | --- | --- |
| Engineer | Engineering lead, Implementation maker, Code reviewer | Implementation scope, change proposal, and review checklist |
| Founder | Startup lead, Operations maker, Claims reviewer | Business scope, operating draft, and claims review |
| Research | Experiment lead, Protocol maker, Methods reviewer | Experiment scope, A/B protocol, and methods checklist |

These are intended outcomes in the definitions. Setup does not perform that work.

## Agreement and milestones

A working agreement records the team's proposed scope and review expectations. Milestones mark planned review points within that process. Read both alongside the role responsibilities, inputs, outputs, and proposed access. The fixed task graph sends scope to the draft, then sends both scope and draft to review. These declarations create no runtime permission or automatic schedule.

## Readable definitions

`.bowerloom/slices/` holds context slice files, and `apply` writes the index skill `.claude/skills/slice-<id>` for each one. The setup includes team YAML, role prompts, skills, maps, and supporting assets. [Files and configuration](/docs/configuration/) lists all 20 files.

Crew describes team definitions. Relay describes communication structure. Roots concerns knowledge access. Vines records activity.

Module names do not imply that setup starts those services. A map declaration does not open a socket or retrieve company data.

## Portable and private

Portable definitions describe the work and its proposed boundaries. Private installation records bind approved file effects to their actual paths and state. This separation lets the definitions follow your project without transferring local credentials or approval. Inspect each definition for private context before sharing it. Moving a file does not prove that another harness, an agent application such as Claude Code or Codex, can execute it.

Your store, `~/.bowerloom`, holds definitions only and stays on your machine. `bowerloom.json` and `bowerloom.lock.json` are portable, so commit them. The skills cache and the store cache stay private to each machine. [Where your items come from](/docs/guides/item-sources/) explains how they fit together.

[Read and review your setup](/docs/learn/review-your-setup/) connects these concepts to the installed guides.
