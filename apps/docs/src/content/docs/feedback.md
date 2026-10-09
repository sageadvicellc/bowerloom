---
title: "Bug reports and feedback"
description: "Report bugs, ask questions, share feedback, and discuss feature ideas."
section: "Help"
order: 26.5
---

Use GitHub Issues for reproducible bugs. Use Discussions for questions, general feedback, and feature proposals.

## Choose a channel

| Your topic | Destination |
| --- | --- |
| A reproducible bug | [Issues](https://github.com/sageadvicellc/bowerloom/issues) |
| A setup or usage question | [Q&A](https://github.com/sageadvicellc/bowerloom/discussions/categories/q-a) |
| General feedback about the experience | [General](https://github.com/sageadvicellc/bowerloom/discussions/categories/general) |
| A proposed feature or improvement | [Ideas](https://github.com/sageadvicellc/bowerloom/discussions/categories/ideas) |

These channels support community discussion. A report or proposal does not guarantee a fix, a response time, or a release date.

## Find an existing report

Search open and closed [Issues](https://github.com/sageadvicellc/bowerloom/issues) for the error code, command family, or task.

Search [Discussions](https://github.com/sageadvicellc/bowerloom/discussions) for related questions and proposals.

If the same problem already appears, add your version and new reproduction details to that thread. Link related reports when useful.

Keep the original report and its history. Do not delete reports to remove duplicates.

## Report a bug

Use a title that names the command or task and the unexpected result.

Include these details:

1. State the Bowerloom version and installation method.
2. State the OS, architecture, Node version, and npm version.
3. Name the harness, the agent application such as Codex or Claude Code, and its version when relevant.
4. Describe the expected result.
5. Describe the actual result and exact error code.
6. Give the smallest reproduction with synthetic inputs.
7. Include sanitized output or logs for the failing step.
8. Link related issues and matching documentation.

For an installed CLI, read its version:

```sh
bowerloom --version
```

Copy the actual result. If installation fails before this command works, record the requested package version and the npm error instead.

Use this report outline:

```text
Title: [Command or task] produces [unexpected result]

Bowerloom version:
Installation method:
OS and architecture:
Node and npm versions:
Harness and version, if relevant:

Expected result:
Actual result and error code:

Minimal reproduction:
1. Start with [synthetic input or unused workspace].
2. Run [sanitized command with placeholders for private paths].
3. Observe [result].

Sanitized output or logs:
Related reports or documentation:
```

A setup refusal can be expected behavior. Read [Troubleshooting](/docs/troubleshooting/) and [Status and error reference](/docs/reference/errors/) before selecting another operation.

## Protect private data

Inspect every file, log, command, and screenshot before posting it. Replace private paths and host names with clear placeholders.

Exclude credentials, tokens, customer records, personal information, and raw installation receipts. Keep the original evidence private.

Use synthetic examples instead of real business data. Keep the relevant error code and sequence intact when sanitizing output.

Do not post credentials or sensitive security evidence in public Issues or Discussions.

## Ask a question

Use [Q&A](https://github.com/sageadvicellc/bowerloom/discussions/categories/q-a) for installation, setup, and usage questions.

State your goal, version, harness, relevant guide, and the step that needs clarification. Include sanitized output when it explains the question.

If a reply resolves the question, mark the relevant reply as the answer when GitHub offers that control.

## Share general feedback

Use [General](https://github.com/sageadvicellc/bowerloom/discussions/categories/general) for feedback about wording, onboarding, or the overall experience.

Describe the task and where the experience becomes unclear. Include the page address and a concrete improvement when possible.

## Discuss a feature

Use [Ideas](https://github.com/sageadvicellc/bowerloom/discussions/categories/ideas) for feature proposals.

Describe the task, current problem, desired result, and workaround. Name the affected workflow and its permission or privacy requirements.

Search for related proposals first. Add a distinct use case to an existing idea instead of repeating it.

A discussion does not grant implementation or connected-action approval. Scope and review remain part of each later change.

[Current support](/docs/status/) · [Troubleshooting](/docs/troubleshooting/) · [Contribute from source](/docs/contributors/)
