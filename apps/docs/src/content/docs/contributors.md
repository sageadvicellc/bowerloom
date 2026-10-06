---
title: "Contributor checkout"
description: "Source builds are a contributor path, separate from beta installation."
---
A checkout is for development and historical reproduction. The private candidate uses the separate [installed artifact path](/docs/start/). Its supplied archive and cached dependencies are prerequisites.

:::caution[Historical source pin]
The commands below reproduce the earlier alpha setup candidate. They are not a beta installation path or a recommendation to run the latest development branch.
:::

## Prepare a development checkout

Use `git`, Node 24.11 or a later Node 24 version, and `npm` 11. Keep the source checkout separate from the project receiving `.bowerloom/`.

```sh
git clone --branch feature/bowerloom-beta https://github.com/sageadvicellc/bowerloom.git
cd bowerloom
git checkout --detach cd62b530644dae0fca1cef9e11e287b24356c250
npm ci --ignore-scripts
npm run build
node dist/apps/cli/src/main.js --help
node dist/apps/cli/src/main.js --version
node dist/apps/cli/src/main.js init --help
```

The version output is `Bowerloom 0.7.0-alpha.0`. The pin deliberately names the reviewed setup candidate, not whichever commit the branch reaches later.


[Return to beta installation status](/docs/start/).
