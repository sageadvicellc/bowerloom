---
title: "Harness, engines, and fidelity"
description: "Learn what a harness is, which engines Bowerloom supports, and what exact, translated, weakened, and absent mean."
section: "Concepts"
order: 16
---

Bowerloom 0.8.0-beta.1 lets you keep one definition of your agent setup and install it for more than one engine. This page defines the words that the rest of the docs use.

## Harness

A harness is the set of skills, agents, tools, rules, and context that surrounds a coding model. You keep one harness for a project in its `.bowerloom` folder. The file `.bowerloom/harness.json` names the harness and lists its engines. The other parts sit in folders and files beside it, such as `agents/`, `skills/`, `instructions/AGENTS.md`, `guardrails.json`, `hooks.json`, and `mcp.json`.

## Engines

An engine is an agent application that reads files from your project, such as Claude Code or Codex. Bowerloom writes the files of each engine from the harness.

- Beta.1 supports two engines: Claude Code (`claude-code`) and Codex (`codex`).
- Beta.1 also knows three preview engines: OpenCode (`opencode`), Pi (`pi`), and DeepSeek Harness (`deepseek-harness`). A preview engine works only when you set `BOWERLOOM_PREVIEW_ENGINES=1`. Without it, `harness install` refuses a preview engine that you name with `ENGINE_PREVIEW`, and it skips preview engines when you name none.
- Adopt, drift, status, and remove work for all five engines. Only install to a preview engine needs the setting.

Bowerloom never runs an engine. The version of each engine comes from `harness.json`, or from `--engine <id>@<version>` when adoption writes `harness.json`.

## Fidelity

Two engines do not carry every part in the same way. Before an install writes anything, the plan reports how each engine carries each part of the harness. Each line has one of four words.

| Word | Meaning |
| --- | --- |
| `exact` | The engine carries the part as the harness states it. |
| `translated` | The engine carries the part in its own form. The line says how. |
| `weakened` | The engine carries the part, but less strictly than the harness says. The line says why. |
| `absent` | The engine has no way to carry the part. The line says why. |

Every line that is not `exact` gives its reason. In the desktop app, each line shows a dot and the word, such as Exact, Translated, Weakened, or Absent. Colour is never the only signal.

## Refusal and approval

An installed copy is never more permissive than its source. A rule that the harness enforces, and that an engine carries as `weakened` or `absent`, is refused until you approve that exact line. The refusal code is `PORTABLE_FIDELITY`. A part that only advises the model, and does not enforce anything, is reported but is not refused.

To approve a line, you run `bowerloom harness accept <key>` with the key that the refusal printed. The key names the part, the entry, the engine, and a short hash of the entry. If the entry changes, the hash changes, and the approval no longer applies. Then you install again. The approvals are part of the install record that Bowerloom keeps, and they are not part of the harness. [Adopt and install a harness](/docs/guides/adopt-and-install/) shows the steps.

## Where to go next

- [Adopt and install a harness](/docs/guides/adopt-and-install/) gives the command path.
- [Codex and Claude Code](/docs/harnesses/) says what each engine receives, including the Codex permission profile.
- [Desktop app (beta)](/docs/app/) shows the same steps on screen.
