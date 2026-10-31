/**
 * Screenshot slots. The real 0.8 screenshots come after the launch change lands.
 * `caption` is the text a reader sees. `capture` tells the person who takes the shot what the screen must show.
 */
export const screenshotSlots = [
  {
    id: 'fidelity-preview',
    caption: 'The preview marks each part of a harness as Exact, Translated, Weakened, or Absent, per engine.',
    capture: 'The install preview with both engines selected. Show one result per part, per engine, and one Weakened rule held for approval.',
  },
  {
    id: 'builder-graph',
    caption: 'The Builder shows one folder\'s harness as a graph.',
    capture: 'The Builder with a folder open. Show agents and skills as a graph, one skill linked to an agent, and the Undo, Redo, and Save controls.',
  },
  {
    id: 'save-files',
    caption: 'Save shows the files first, and every save keeps a save point.',
    capture: 'The Save step listing the files it will write, with the save points list and Go back visible.',
  },
  {
    id: 'notes-keeper-tour',
    caption: 'The first-run tour builds the Notes keeper with you.',
    capture: 'The first-run tour at the step that builds the Notes keeper, with the new agent shown in the graph.',
  },
  {
    id: 'cli-plan',
    caption: 'A command that writes prints its plan first.',
    capture: 'A terminal after bowerloom harness install --engine claude-code --engine codex. Show the plan, the file list, and the revision to approve.',
  },
] as const;
export type ScreenshotSlotId = typeof screenshotSlots[number]['id'];
