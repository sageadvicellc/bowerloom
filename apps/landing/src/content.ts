import { installAvailable, release } from './release.ts';

/**
 * Page copy for 0.8.0-beta.1, approved on 2026-10-31. Backticks mark inline code.
 * Keep the wording as approved. Change it only with the owner.
 */
export const repository = release.urls.repository;
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
  "Eyebrow": "Open beta",
  "H1": "One setup, two engines",
  "Body": "Define your skills, agents, tools, rules, and context once. Bowerloom installs them into Claude Code and Codex. Before it writes a file, it shows what each engine can carry and what it cannot.",
  "Primary CTA": "Get the app (beta)",
  "Secondary link": "Install the command line",
  "Note": "Free and open source under the MIT license. For macOS.",
} as const;

export const whatItDoes = {
  heading: "Keep one definition. Install it everywhere.",
  intro: "Each coding agent keeps its own skills folder, agent files, tool list, and permission rules. A change in one does not reach the other. Bowerloom keeps one harness in a `.bowerloom` folder and writes each engine's files from it. A harness is the set of skills, agents, tools, rules, and context around a coding model.",
  features: [
    { title: "See what each engine can carry", body: "The preview marks each part of your harness, per engine, as Exact, Translated, Weakened, or Absent. If an engine carries a rule more weakly than you wrote it, Bowerloom holds that rule until you approve that line. An installed copy is never more permissive than its source." },
    { title: "Read the plan before anything is written", body: "Every change that writes shows a plan first. Nothing is written until you approve that exact plan." },
    { title: "Go back", body: "Each save keeps a save point. Go back restores the harness as it was then. Remove puts back every file an install replaced." },
    { title: "Start from what you have", body: "Adopt reads your Claude Code and Codex files and builds one harness. It changes no engine file." },
  ],
} as const;

export const howItWorks = {
  heading: "How it works",
  steps: [
    { title: "Adopt", body: "Bowerloom reads the Claude Code and Codex files in your project. It writes one harness into `.bowerloom` and nothing else." },
    { title: "Preview", body: "Pick your engines. Bowerloom lists every file it plans to write and gives one result per part, per engine. Weaker rules wait for you, one line at a time." },
    { title: "Install and watch", body: "You approve the plan by its revision. Bowerloom writes the engine files and records what it wrote. Drift lists the files that changed since." },
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
  supported: ["Claude Code", "Codex"],
  preview: ["OpenCode", "Pi", "DeepSeek Harness"],
} as const;

export const install = {
  heading: "Install",
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

/** Shown wherever the command would be, until the release record says npm has it. */
export const arrivalNote = "The install command arrives when the beta publishes.";
const needs = "needs Node 24.11 or a later 24.x, and npm 11.";

/**
 * The npm command shows only after the release record says the package is published.
 * Until then the section says when the command arrives.
 */
export function installView(available: boolean = installAvailable): { command: string | null; text: string } {
  return available
    ? { command: release.npm.installCommand, text: `This ${needs} To update, run the same command again. Do not use \`npm update -g\`.` }
    : { command: null, text: `${arrivalNote} The command line ${needs}` };
}

export const questions = [
  { question: "Does Bowerloom run my agents?", answer: "No. It sets up files. It starts no workers and grants no access." },
  { question: "What does Weakened mean?", answer: "The engine carries a rule more weakly than your harness says. Bowerloom holds that rule until you approve it." },
  { question: "Can I undo an install?", answer: "Yes. Remove puts back what the install replaced. In the app, Go back restores a saved harness." },
  { question: "Why is the app unsigned?", answer: "Apple did not sign it. The steps above open it. The command line does the harness work without the app." },
  { question: "What does it send?", answer: "Nothing. The usage log stays on your computer. `bowerloom report` builds a bundle for you to read, and you open the issue yourself." },
  { question: "What does it cost?", answer: "Bowerloom is free and open source. Your Claude Code and Codex accounts are separate." },
] as const;
