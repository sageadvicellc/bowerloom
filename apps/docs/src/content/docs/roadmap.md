---
title: "Roadmap"
description: "See what 0.8.0-beta.1 holds today and which items are named for later releases."
section: "Help"
order: 27.5
---

Bowerloom 0.8.0-beta.1 is the current beta. It keeps one harness for a project and installs it for Claude Code and Codex. This page separates what the beta holds today from what is named for later. Later items are not promises, and they have no dates.

## In 0.8.0-beta.1

- The command line: `bowerloom harness status`, `adopt`, `install`, `accept`, `merge`, `drift`, `remove`, and `recover`.
- The fidelity report: exact, translated, weakened, or absent, for each engine and each part.
- Two supported engines, Claude Code and Codex, and the Codex permission profile.
- Three preview engines, OpenCode, Pi, and DeepSeek Harness. They work only with `BOWERLOOM_PREVIEW_ENGINES=1`.
- The desktop app, a beta for macOS, with the Builder, the save step, Save points, Go back, and Set aside. Apple did not sign it.
- Notes, and the Notes keeper kit.
- Pinned skills from npm and GitHub, the store, and the lock file from the 0.7 beta line.

[Current support](/docs/status/) documents each one.

## Named for later

These items are named for later releases. They are not promises.

- Windows and Linux.
- Team sync.
- Signing and automatic updates for the desktop app.
- Other knowledge bases than a folder of notes.
- More engines.

Worker launch is not part of this beta. No Bowerloom command runs an engine or a model. Private npm registries and private Git repositories are limits of the pinned skills feature today. A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`.

## The path from 0.7

The 0.7 beta line is the older setup path, with `bowerloom up --team`, `ls`, `status`, the create commands, `skills.json`, and `apply`. Those commands remain in the CLI. [Release notes](/docs/releases/) describes shipped changes.

[Current support](/docs/status/) describes supported tasks. Discuss proposed features in [Ideas](https://github.com/sageadvicellc/bowerloom/discussions/categories/ideas).
