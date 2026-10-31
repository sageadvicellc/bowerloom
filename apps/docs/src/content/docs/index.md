---
title: "Build with your agent"
description: "Keep one harness for Claude Code and Codex, install it after a preview, and approve every change."
section: "Start here"
order: 0
---

Bowerloom lets you define one harness and install it into Claude Code and Codex. A harness is the set of skills, agents, tools, rules, and context that surrounds a coding model. You keep one definition in a `.bowerloom` folder. Bowerloom writes the files of each engine from it. An engine is an agent application, such as Claude Code or Codex.

Every change shows its exact plan first, and Bowerloom writes nothing until you approve that plan. It records what it wrote, so you can see drift and undo an install. When an engine cannot carry a part of your harness, the plan says so, part by part, as exact, translated, weakened, or absent. An installed copy is never more permissive than its source.

You can use Bowerloom 0.8.0-beta.1 in two ways. Both do the same adopt, install, and remove steps. The desktop app is a beta. It also has the Builder and Save points.

- The command line: `bowerloom harness adopt`, `install`, `drift`, and `remove`.
- The [desktop app](/docs/app/), for macOS.

## Choose your next step

| Your task | Start here |
| --- | --- |
| Install the CLI and read its version | [Install Bowerloom](/docs/start/) |
| Open the unsigned macOS app | [Desktop app (beta)](/docs/app/) |
| Understand harness, engine, and fidelity | [Harness, engines, and fidelity](/docs/concepts/harness-and-fidelity/) |
| Adopt your files and install for Claude Code and Codex | [Adopt and install a harness](/docs/guides/adopt-and-install/) |
| See what each engine receives, and the Codex permission profile | [Codex and Claude Code](/docs/harnesses/) |
| Point agents at your notes, or add the Notes keeper | [Notes and the Notes keeper](/docs/guides/notes/) |
| Add pinned skills from npm or GitHub | [Add third-party skills](/docs/guides/add-skills/) |
| Find a command, flag, or error | [Reference](/docs/reference/) |

## Engines in this beta

Beta.1 supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness are preview engines. Install to a preview engine works only when you set `BOWERLOOM_PREVIEW_ENGINES=1`. Without it, install refuses a preview engine that you name. Adopt, drift, status, and remove work for every engine.

No Bowerloom command runs an engine or a model.

## Team setup from 0.7

The 0.7 flow set up a personal agent and a team with `bowerloom up`. These pages describe it. They are under Legacy 0.7 team setup in the menu.

- [Install and prepare a team with `up`](/docs/learn/first-team/)
- [Map your existing workflow](/docs/guides/integrate-workflow/)
- [Revise an installed setup](/docs/revision/)

## Give your agent the docs

Ask your existing agent to read the page for your current task. Each practical guide pairs a human prompt with a precise procedure and its prerequisites. [The agent index](/docs/llms.txt) finds the relevant page, and each page offers its complete Markdown text. A copied prompt grants no new tool access or execution permission. [Plans and exact approval](/docs/permissions/) explains the operation that you review.

[Current support](/docs/status/) · [Roadmap](/docs/roadmap/) · [Bug reports and feedback](/docs/feedback/) · [Main site](/)
