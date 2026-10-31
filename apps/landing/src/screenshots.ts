/**
 * The five screenshots of the page. Each has a light and a dark file in `public/shots`, named `<id>-light.webp` and `<id>-dark.webp`.
 * `apps/desktop/e2e/landing-shots.spec.ts` takes them (`npm run shots`), so they can be taken again after a change to the screens.
 * `caption` is the text a reader sees. `alt` says what the picture shows, for a screen reader. `width` and `height` are the pixel size of the files.
 * `capture` says what the screen must show, for the person who takes the shot again.
 */
export const screenshotSlots = [
  {
    id: 'fidelity-preview',
    caption: 'The preview marks each part of a harness as Exact, Translated, Weakened, or Absent, per engine.',
    alt: 'The install review for a harness. The Codex card counts 1 exact, 1 translated, 1 weakened, and 1 absent. The instructions are marked Exact, a hook is marked Weakened, one server is marked Translated, and one server is marked Absent. The weaker rule was ticked to approve it, and the Write button stays off until the plan is approved.',
    capture: 'The install preview with both engines selected. Show one result per part, per engine, and one Weakened rule held for approval.',
    width: 2560,
    height: 1600,
  },
  {
    id: 'builder-graph',
    caption: 'The Builder shows one folder\'s harness as a graph.',
    alt: 'The Builder open on a harness named weekly. A graph shows two agents, checker and drafter, and three skills, outline, proofread, and summarize. Lines link drafter to outline and checker to summarize. The top bar shows Undo, Redo, and Save, and says 1 change, not saved yet.',
    capture: 'The Builder with a folder open. Show agents and skills as a graph, one skill linked to an agent, and the Undo, Redo, and Save controls.',
    width: 2200,
    height: 1376,
  },
  {
    id: 'save-files',
    caption: 'Save shows the files first, and every save keeps a save point.',
    alt: 'The Save review before anything is written. It lists two files to update, the checker and drafter agent files in the .bowerloom folder, and the skills each agent uses. A box asks you to approve the plan, and the Save 2 files button stays off until you do.',
    capture: 'The Save step listing the files it will write. The save points list and Go back sit in the drawer behind it and cannot show in the same shot.',
    width: 2200,
    height: 1376,
  },
  {
    id: 'notes-keeper-tour',
    caption: 'The first-run tour builds the Notes keeper with you.',
    alt: 'The first-run tour at step 4 of 7. A lit panel shows the Notes keeper agent with its six ready-made skills on the Skills shelf and an empty Notes shelf. A card says skills are what it knows how to do and asks you to drag your notes onto the Notes shelf.',
    capture: 'The first-run tour at the step that builds the Notes keeper, with the keeper and its skills in the lit panel.',
    width: 2200,
    height: 1376,
  },
  {
    id: 'cli-plan',
    caption: 'A command that writes prints its plan first.',
    alt: 'A terminal window. The command bowerloom harness install with the engines claude-code and codex prints its plan: 11 files to change, each marked create, three agent lines marked translated for Codex, then the revision and a line that says approval is required. The output is the real output, as printed. The command is typed as bowerloom, and no path was shortened.',
    capture: 'A terminal after bowerloom harness install --engine claude-code --engine codex. Show the plan, the file list, and the revision to approve.',
    width: 2000,
    height: 1250,
  },
] as const;
export type ScreenshotSlotId = typeof screenshotSlots[number]['id'];
/** The two themes a shot is taken in. */
export const shotThemes = ['light', 'dark'] as const;
/** The path of one file of a shot, in `public/shots`. The page and its enlarged view load the same file. */
export const shotSource = (id: ScreenshotSlotId, theme: typeof shotThemes[number]): string => `/shots/${id}-${theme}.webp`;
