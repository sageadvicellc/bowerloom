# Build your tutorial

The landing page lets you assemble a prompt for your personal agent. Your agent creates a local report from supplied synthetic data.

This tutorial has two separate results. Bowerloom validates an included definition. Your personal agent creates the report outside the Bowerloom execution backend.

The implemented Labs-to-blog seed remains a separate path. This report exercise does not prove arbitrary team execution or acceptance across harnesses.

## Prerequisites

The alpha source repository is public. This alpha does not have a published npm package.

Use Git, npm 11, and Node 24.11 or later within Node 24. Keep credentials outside the tutorial files.

## Assemble the prompt

1. Open the landing page section named “Build your tutorial.”
2. Choose a palette.
3. Choose a question.
4. Choose a hypothesis, a claim that the data can test.
5. Select “Create my prompt.”
6. Read the prompt and setup instructions.
7. Copy the prompt into your existing personal agent.

If automatic copy fails, use your device’s Copy command on the selected prompt. Changing a choice clears the previous prompt.

The question controls the available hypotheses and source rows. Both questions include a hypothesis that the rows support and one that they do not support.

## Prepare the alpha

If a Bowerloom checkout exists, ask your agent to inspect its branch and local changes first. Do not replace an existing checkout.

For a new checkout, use a parent directory without a `trellis` directory. Run these commands from that parent directory:

```sh
git clone --branch feature/trellis-v1 https://github.com/sageadvicellc/bowerloom.git
cd bowerloom
npm ci --ignore-scripts
npm run build
node dist/apps/cli/src/main.js validate examples/endor/crew.yaml
```

The example reports `runtimeReady: false` by design. Validation reads the definition. It does not start workers or grant execution authority.

The prompt requires the exact Git revision and actual setup result in the evidence notes. Setup failure must remain visible in those notes.

## Review the report

The agent writes `tutorial-output/report.html` and `tutorial-output/evidence.md` in your workspace. It asks before it replaces either existing file.

The HTML uses inline CSS and SVG with system fonts. It has no scripts or remote assets. The report must remain readable on a phone.

1. Open the HTML report locally.
2. Make sure that the headline and chart identify the synthetic data.
3. Compare the data table with the source rows.
4. Read the hypothesis verdict and calculations.
5. Make sure that the notes separate setup evidence from report creation.
6. Open print preview and inspect one A4 or Letter page for clipping.

The tutorial ends at your review. It does not publish, write to GitHub, request secrets, or start a team.

## Reference arithmetic

For the packing question, batch A has durations of 12, 10, 14, and 12 minutes. Its mean is 12 minutes.

Batch B has durations of 8, 9, 10, and 9 minutes. Its mean is 9 minutes. The reduction is `(12 - 9) / 12 = 25%`.

These rows support a reduction of at least 20%. They do not support a reduction of at least 40%.

For the shelf question, baskets sell 15 of 20 units, mugs sell 12 of 30, and prints sell 20 of 25.

Their shares are 75%, 40%, and 80%, respectively. Prints have the highest share. The rows do not support the hypothesis that mugs have the highest share.

These are invented observations. Neither question establishes a causal effect, statistical significance, customer behavior, or a measured Bowerloom benefit.

## Prompt source and sample

The pure `buildTutorialPrompt` function in `apps/landing/src/tutorial.ts` defines the prompt. The landing page does not call a model or store your choices remotely.

For the default sample, select Sage picnic, the packing question, and the 20% hypothesis. The following command prints that exact prompt from the repository root:

```sh
node --input-type=module -e 'import { buildTutorialPrompt, initialSelection } from "./apps/landing/src/tutorial.ts"; console.log(buildTutorialPrompt(initialSelection))'
```

The generated prompt includes all eight fictional rows, the setup commands, report requirements, and action limits. Tests cover every available combination and reject mismatched hypotheses.
