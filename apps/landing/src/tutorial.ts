export const palettes = [
  { id: 'sage-picnic', label: 'Sage picnic', description: 'Cream, sage, and blush', colors: ['#fff8eb', '#536344', '#efd0c8'], ink: '#30382c' },
  { id: 'peach-workshop', label: 'Peach workshop', description: 'Peach, plum, and warm white', colors: ['#fae1d4', '#68445d', '#fffaf5'], ink: '#392633' },
  { id: 'blue-morning', label: 'Blue morning', description: 'Sky, ink, and soft butter', colors: ['#e3edf5', '#334b61', '#fff1c4'], ink: '#243744' },
] as const;

export const experiments = [
  {
    id: 'packing', label: 'A little more time to make',
    question: 'Which order batch took less time to pack?',
    context: 'Eight fictional orders in two batches. Each row records packing minutes for one order. Batch labels do not describe a treatment.',
    dataset: 'order,batch,packing_minutes\nA1,A,12\nA2,A,10\nA3,A,14\nA4,A,12\nB1,B,8\nB2,B,9\nB3,B,10\nB4,B,9',
    method: 'Compare the mean packing minutes for batch A and batch B. Calculate the percentage difference using batch A as the baseline. Show units, counts, and arithmetic. Use a two-bar chart with a zero baseline.',
    hypotheses: [
      { id: 'twenty', label: 'Batch B averages at least 20% less packing time than batch A.' },
      { id: 'forty', label: 'Batch B averages at least 40% less packing time than batch A.' },
    ],
  },
  {
    id: 'shelf', label: 'Find the shelf favorite',
    question: 'Which product sold the largest share of its starting stock?',
    context: 'One fictional shop day, with no restocks or returns. Each row records starting units and sold units for one product.',
    dataset: 'product,starting_units,sold_units\nBaskets,20,15\nMugs,30,12\nPrints,25,20',
    method: 'Calculate sold units divided by starting units for each product as a percentage. Compare percentages, not raw units sold. Show the arithmetic. Use a three-bar chart with a zero baseline and a 100% maximum.',
    hypotheses: [
      { id: 'prints', label: 'Prints sold the largest share of their starting stock.' },
      { id: 'mugs', label: 'Mugs sold the largest share of their starting stock.' },
    ],
  },
] as const;

export type TutorialSelection = { paletteId: string; experimentId: string; hypothesisId: string };
export const initialSelection: TutorialSelection = { paletteId: 'sage-picnic', experimentId: 'packing', hypothesisId: 'twenty' };

export const setupCommands = `git clone --branch feature/trellis-v1 https://github.com/sageadvicellc/trellis.git
cd trellis
npm ci --ignore-scripts
npm run build
node dist/apps/cli/src/main.js validate examples/endor/crew.yaml`;

export function resolveSelection(selection: TutorialSelection) {
  const palette = palettes.find((item) => item.id === selection.paletteId);
  const experiment = experiments.find((item) => item.id === selection.experimentId);
  const hypothesis = experiment?.hypotheses.find((item) => item.id === selection.hypothesisId);
  if (!palette || !experiment || !hypothesis) throw new Error('Choose a listed palette, question, and matching hypothesis.');
  return { palette, experiment, hypothesis };
}

export function buildTutorialPrompt(selection: TutorialSelection): string {
  const { palette, experiment, hypothesis } = resolveSelection(selection);
  return `Help me try a local Trellis tutorial with my existing personal agent.

Scope
This is a personal-agent report exercise with a separate Trellis installation validation. Do not claim that Trellis executed this report or an arbitrary Sprouts team. The implemented Labs-to-blog seed is a different path. Cross-harness runtime acceptance is not established by this exercise.

Installation validation
First inspect this workspace for an existing Trellis checkout. Use Node 24.11 or later within Node 24, npm 11, and Git. Repository access is required because the alpha repository is private. There is no published npm install package for this alpha. If access or prerequisites are missing, report the gap and stop setup. Do not request or collect credentials.
For a new checkout, run these commands from a directory that does not already contain a trellis directory:

${setupCommands}

If a checkout already exists, inspect its branch and local changes first. Never reset, overwrite, or switch a dirty checkout. Use the feature/trellis-v1 source and report its exact Git revision. Run the npm and validation commands from the repository root. The example reports runtimeReady: false by design. Validation reads the definition. It does not start workers or grant execution authority. Record the actual result, including any failure. Do not report installation success without command evidence.

My report
Question: ${experiment.question}
Hypothesis: ${hypothesis.label}
Palette: ${palette.label}. Background/accent colors: ${palette.colors.join(', ')}. Text: ${palette.ink}. Keep text contrast readable.

Use only this supplied synthetic dataset:
${experiment.context}

CSV data:
${experiment.dataset}
End of CSV data.

Analysis: ${experiment.method}
State whether the supplied rows support the hypothesis. A hypothesis is allowed to fail. Distinguish arithmetic from interpretation. These invented rows cannot establish causal effects, statistical significance, real customer behavior, or a measured Trellis benefit. Do not invent sources, research, observations, or missing data.

Deliverables
Create tutorial-output/report.html and tutorial-output/evidence.md in this workspace. If either file exists, stop and ask before replacement. The HTML must be a polished one-page report with a headline, question, hypothesis verdict, a small accessible chart, a visible data table, methods, limitations, and one practical next question. Label it Synthetic tutorial data near the headline and chart. Use inline CSS and SVG, system fonts, no scripts, no remote assets, no dependencies, and no network requests. Make it readable on a phone and printable on one A4 or Letter page without clipping. Include text equivalents for chart values.
The Markdown notes must include the source rows, calculations, limitations, selected palette, exact Trellis revision, actual setup result, and a clear separation between installation validation and agent-authored report creation. Describe the result as this synthetic sample only.

Boundaries
Use local files only for the report. Network access is limited to the requested repository checkout and npm dependencies for setup. Do not perform external research, request secrets, read unrelated private files, install other software, run paid services, spend money, publish, merge, or write to GitHub. Do not start workers or request action approvals. These actions require a separate user request.
When finished, show me the local report and evidence notes for review. The tutorial ends at my review. Do not claim founder acceptance or production readiness.`;
}
