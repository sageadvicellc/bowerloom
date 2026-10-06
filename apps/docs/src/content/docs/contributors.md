---
title: "Contribute from source"
description: "Keep source development separate from normal CLI installation."
---
A source checkout is for contributors. Normal users follow the [CLI installation guide](/docs/start/).

Use `git` and the tool versions declared in `package.json`. Keep the checkout separate from the project receiving `.bowerloom/`.

```sh
git clone https://github.com/sageadvicellc/bowerloom.git
cd bowerloom
npm ci --ignore-scripts
npm run build
node dist/apps/cli/src/main.js --help
```

Choose the reviewed commit or task branch for your work before building. The example clones the repository; it does not pin a qualified release or establish a supported installation.

Include a focused reproduction and meaningful checks. Keep credentials, customer data, and private source records out of issues and pull requests.

Changes need independent review. Main merge and publication remain founder decisions.
