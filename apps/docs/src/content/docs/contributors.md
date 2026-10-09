---
title: "Contribute from source"
description: "Prepare a focused source change for independent review."
section: "Help"
order: 28
---

A source checkout is for contributors. Normal users follow [Install Bowerloom](/docs/start/).

## Ask your agent

```text
Help me prepare a Bowerloom contribution from the selected source revision. Show the proposed change and review plan before editing or building.
```

## Agent procedure

### Prerequisites

Use Git and the Node/npm versions declared at the selected repository revision. Read that revision's contributor and task instructions.

Choose the reviewed commit or task branch before installing dependencies or building. Keep the checkout separate from the project receiving `.bowerloom/`.

### Prepare the source checkout

The example clones the repository. Select the source revision for your contribution before installing dependencies.

```sh
git clone https://github.com/sageadvicellc/bowerloom.git
cd bowerloom
```

Select the agreed revision in that checkout before the next commands. Follow the current repository scope and storage limits.

### Build within the selected task

From that selected checkout, use its declared tools:

```sh
npm ci --ignore-scripts
npm run build
node dist/apps/cli/src/main.js --help
```

Dependency installation writes local package files. The build creates development output for the selected source revision.

If declared tools or the selected revision differ, resolve those prerequisites first. Normal users install the CLI through the installation guide.

### Prepare review evidence

Include the concrete problem, intended effect, focused reproduction, and relevant checks. Mark unrun tests as unrun.

For documentation, preserve route fragments and release facts. Compare visible prompts and commands with their complete Markdown exports.

Keep credentials, customer data, private campaign paths, and raw receipts out of public contributions.

## Independent review

Submit the current revision for independent review. Include evidence for the changed behavior.

Follow the repository's contribution instructions for the selected revision. Discuss the scope in an issue before a large change.

[Bug reports and feedback](/docs/feedback/) · [Reference](/docs/reference/) · [Release notes](/docs/releases/)
