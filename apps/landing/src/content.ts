import { installAvailable, installCommand, repositoryUrl } from './release.ts';

/**
 * Page copy for 0.8.0-beta.1. Backticks mark inline code.
 * The owner approved the wording on 2026-10-31 and revised the hero, the journey, and the step titles after the preview review.
 * The voice is warm and a little cute, built from the bowerbird, the bower, the nest, and the loom. Keep the wording. Change it only with the owner.
 */
export const repository = repositoryUrl;
const branch = `${repository}/blob/main`;
export const destinations = {
  readme: `${branch}/README.md`,
  license: `${branch}/LICENSE`,
  bugs: `${repository}/issues`,
  questions: `${repository}/discussions/categories/q-a`,
  feedback: `${repository}/discussions/categories/general`,
  ideas: `${repository}/discussions/categories/ideas`,
};

export const hero = {
  "Eyebrow": "Open beta · macOS",
  "H1": "A cozy nest for your agents",
  "Body": "Set up your skills, agents, tools, rules, and context once. Bowerloom tucks them into Claude Code and Codex.",
  "Results": ["Exact", "Translated", "Weakened", "Absent"],
  "Primary CTA": "Get the app (beta)",
  "Secondary link": "Install the command line",
  "Note": "Free and open source under the MIT license. For macOS.",
} as const;

export const whatItDoes = {
  heading: "Keep one definition. Install it everywhere.",
  intro: "Each coding agent keeps its own skills folder, agent files, tool list, and permission rules. A change in one does not reach the other. Bowerloom keeps one harness in a `.bowerloom` folder and writes each engine's files from it. A harness is the set of skills, agents, tools, rules, and context around a coding model.",
  features: [
    { title: "See what each engine can carry", body: "The preview marks each part of your harness, per engine, as Exact, Translated, Weakened, or Absent. If an engine carries a rule more weakly than you wrote it, Bowerloom holds that rule until you approve that line. An installed copy is never more permissive than its source." },
  ],
} as const;

export const howItWorks = {
  heading: "How it works",
  steps: [
    { title: "Gather what you already have", body: "Adopt reads the Claude Code and Codex files in your project. Bowerloom writes one harness into `.bowerloom` and nothing else." },
    { title: "Preview what each engine can carry", body: "Pick your engines. Bowerloom lists every file it plans to write and gives one result per part, per engine. Weaker rules wait for you, one line at a time." },
    { title: "Approve the plan, then watch for drift", body: "Nothing is written until you approve that exact plan by its revision. Bowerloom then writes the engine files and records what it wrote. Drift lists the files that changed since." },
    { title: "Go back to a save point", body: "In the app, each save keeps a save point, and Go back restores it. On the command line, Remove puts back every file an install replaced." },
  ],
  boundary: "Setup does not start workers, grant runtime access, or authorize connected actions.",
} as const;

export const app = {
  heading: "The app (beta)",
  body: "The app does the same work in a window. See your agents and skills as a graph, build a harness from a folder, review the plan, and install it.",
  features: [
    { title: "Builder", body: "The Builder shows one folder's harness as a graph. Drag a skill onto an agent to link them. Undo and Redo step through your changes. Nothing is written until you press Save, and Save shows the files first." },
    { title: "Save points", body: "Every save keeps a save point. Go back restores the harness as it was then, and keeps today's version as a save point too. Only an install changes installed files." },
    { title: "Notes keeper", body: "This is a ready-made agent for a folder of notes. It adds sources, files pages, and answers from your notes with citations. It checks the notes for problems and writes a tidy-up report. It works in git, makes one commit per change, and never deletes a source. The first-run tour builds it with you." },
  ],
} as const;

export const commandLine = {
  heading: "The command line",
  body: "Run these commands in a project folder. Each command that writes prints a plan first. To apply the plan, run the command again with `--approve <revision>`.",
  commands: [
    "bowerloom harness adopt",
    "bowerloom harness install --engine claude-code --engine codex",
    "bowerloom harness drift",
    "bowerloom harness remove",
  ],
  note: "No harness command runs an engine or a model.",
} as const;

export const engines = {
  heading: "Two engines now. Three in preview.",
  body: "This beta supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness are preview engines. Bowerloom can read and remove all five. To install into a preview engine, set `BOWERLOOM_PREVIEW_ENGINES=1`.",
  nestLine: "Pick the homes your harness will move into.",
  supported: ["Claude Code", "Codex"],
  preview: ["OpenCode", "Pi", "DeepSeek Harness"],
} as const;

export const install = {
  heading: "Make yourself at home",
  intro: "Start with the app. The command line sits beside it, ready to copy.",
  commandLineTitle: "Command line",
  appTitle: "App",
  appIntro: "Apple did not sign or notarize the app, so macOS blocks it the first time you open it.",
  appSteps: [
    "Move `Bowerloom.app` to Applications.",
    "Open it once, then close the warning.",
    "Open System Settings, then Privacy & Security.",
    "Click Open Anyway next to the Bowerloom message.",
    "If macOS asks for your password, enter it. Then click Open.",
  ],
  appUpdate: "The app does not update itself yet. When a new build is out, download it.",
} as const;

/** Said once, beside the command, while the release record says npm does not have the package. */
export const pendingNote = "The beta is not on npm yet. This command works once it is.";
const needs = "needs Node 24.11 or a later 24.x, and npm 11.";

/**
 * The command always shows, with a copy button. The owner decided this on the preview review, even before npm has the package.
 * While the release record says npm lacks the package, `pending` is true and the note says so, so the page stays honest.
 */
export function installView(available: boolean = installAvailable): { command: string; pending: boolean; text: string; pendingNote: string | null } {
  return {
    command: installCommand,
    pending: !available,
    pendingNote: available ? null : pendingNote,
    text: available ? `This ${needs} To update, run the same command again. Do not use \`npm update -g\`.` : `The command line ${needs}`,
  };
}

export const questions = [
  { question: "Does Bowerloom run my agents?", answer: "No. It sets up files. It starts no workers and grants no access." },
  { question: "What does Weakened mean?", answer: "The engine carries a rule more weakly than your harness says. Bowerloom holds that rule until you approve it." },
  { question: "Can I undo an install?", answer: "Yes. Remove puts back what the install replaced. In the app, Go back restores a saved harness." },
  { question: "Why is the app unsigned?", answer: "Apple did not sign it. The steps above open it. The command line does the harness work without the app." },
  { question: "What does it send?", answer: "Nothing. The usage log stays on your computer. `bowerloom report` builds a bundle for you to read, and you open the issue yourself." },
  { question: "What does it cost?", answer: "Bowerloom is free and open source. Your Claude Code and Codex accounts are separate." },
] as const;
