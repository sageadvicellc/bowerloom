---
title: "Files and configuration"
description: "Portable team files and private installation state have different jobs."
---
## Portable setup

The first setup includes an explicit brief, personal-agent profile, team YAML, prompts and skills, relay and Vines maps, a working agreement, milestones, and reading guides.

```text
.bowerloom/
├── START-HERE.md
├── startup-review.md
├── brief.json
├── working-agreement.md
├── milestones.md
├── skills/personal-assistant/
└── teams/first-team/
    ├── team.yaml
    └── maps/
        ├── relay.json
        └── vines.json
```

This is a selected reading map, not the complete 20-file inventory. The exact plan supplies every file and hash. Read it before applying.

## Private local records

Application adds `installation-receipt.json`. Revision creates private transaction history outside the managed directory. Optional connection, runtime and backend installations add their own separately approved records.

Do not copy receipts as if they grant authority on another machine. Do not publish raw installation plans without checking local paths and private context.

## Configuration changes

Use `revise` to change an installed goal or template. Direct edits can produce drift and block readiness. Preserve a pending revision's original files and marker until explicit recovery resolves it.

Legacy installations retain their original identity rules. New Darwin identity handling does not silently upgrade older receipts or authorize replacement folders. Never edit recorded identity fields to clear a refusal.

## Evidence and limits

Source: [`packages/startup`](https://github.com/sageadvicellc/bowerloom/tree/cd62b530644dae0fca1cef9e11e287b24356c250/packages/startup), reviewed trial `cd62b530`. Optional and planned future runtime folders are not presented as startup-generated files.
