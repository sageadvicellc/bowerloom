---
title: "Workbench"
description: "Read the comparison method without treating a plan as a completed experiment."
section: "Guides: Connections and shared work"
order: 16
---

Workbench holds reference teams and repeatable scenarios. They are not required teams inside every Bowerloom setup.

## Ask your agent

```text
Explain how the current Bowerloom Workbench records a supported comparison. Separate a planned example from a completed run and an improvement claim.
```

## Agent procedure

### Prerequisites

Use a versioned scenario with fixed inputs and measures. Review its license and execution permissions before any real comparison.

If a source license or execution permission is absent, stop before the affected work.

### Read a planned handoff

The CLI exposes `init demo-plan` for an installed setup and its exact revision. [CLI reference](/docs/cli/#init) lists its syntax.

This handoff describes a synthetic Workbench plan. It does not execute the installed team or grant action approval.

### Record a comparison

Record the scenario, input, source revision, model, harness (the agent application, such as Claude Code or Codex), approval scope, outputs, measures, and limits. Retain failed and interrupted attempts.

Use repeated supported comparisons before claiming an improvement. One example cannot establish an A/B winner or time saving.

Report planned tests as plans. Report completed measurements only when their results exist.

## Vines records what happened

Vines is the logging system. Logs do not establish self-improvement. Logs alone do not improve a model or team.

## Labs and release names

`v0.7-workbench` describes a Labs team or version. It is not the public framework release that end users install.

A manual Labs comparison needs its own scenario and accepted harness evidence. The setup commands do not schedule triggers.

## Support boundary

[Current support](/docs/status/) records the beta limit. [Contribute from source](/docs/contributors/) explains review of proposed changes.
