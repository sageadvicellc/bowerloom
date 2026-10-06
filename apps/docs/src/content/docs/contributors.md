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

The example clones the repository. It does not pin a qualified release or establish public CLI support.

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

Dependency installation writes local package files. The build creates development output. Neither operation qualifies the public release.

If declared tools or the selected revision differ, resolve those prerequisites first. A source checkout is not an alternative public installation.

### Prepare review evidence

Include the concrete problem, intended effect, focused reproduction, and relevant checks. Mark unrun tests as unrun.

For documentation, preserve route fragments and release facts. Compare visible prompts and commands with their complete Markdown exports.

Keep credentials, customer data, private campaign paths, and raw receipts out of public contributions.

## Independent review

The author cannot provide the independent acceptance review. Changed work needs review of its current revision.

The integration lead combines accepted task changes under the repository's workflow. Main merge and publication remain founder decisions.

[Reference](/docs/reference/) · [Release notes](/docs/releases/)
