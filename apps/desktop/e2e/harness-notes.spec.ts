/**
 * Journey 5 on the sample launch (--prototype-v3): the notes step and the tour that builds the Notes keeper. Nothing is read or written on disk; the made-up
 * folders answer. The notes step: "Start fresh" shows the starter files and "Create" makes them. "Build my Notes keeper" opens the edit of a folder's agents
 * with the guided tour: the keeper is added from the kit, the person drags the first skill onto Skills, presses "Add the other skills", and puts the notes on
 * the Notes shelf. The review lists the files, Save keeps them, the Notes panel shows the folder, and "What next" ends the tour. A second test does the whole
 * walk with the keyboard alone. The expected skill names and starter files are read from the kit's own folder on disk by the test.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './temp-dirs.js';
import { fresh, launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';
import { kitSkillIds, kitStarter, keyPress, tabTo } from './harness-notes-support.js';

let h: Harness;
const page = (): Page => h.page;
const NOTES_ROUTE = '#prototype-v3/notes';
const NOTES_ID = 'sample-new-notes';

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => { await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); await fresh(page(), NOTES_ROUTE); });

const saveSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Edit a folder\'s harness' });
const tour = (p: Page): Locator => p.getByRole('dialog', { name: 'Tour' });

test('the notes step, "Start fresh", the tour that builds the keeper, the review, Save, the Notes panel, and "What next"', async () => {
  const p = page();
  const skills = kitSkillIds();
  const starter = [...kitStarter().keys()];
  expect(skills.length).toBeGreaterThan(1);
  expect(skills).toContain('add-source');

  // 1. The notes step asks one question and offers two ways.
  await expect(p.getByRole('heading', { level: 1, name: 'Your notes' })).toBeFocused();
  await expect(p.getByText('Where do you keep your notes?')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Use my notes', exact: true })).toBeVisible();
  await p.getByRole('button', { name: 'Start fresh', exact: true }).click();

  // 2. "Start fresh" lists the starter files, exactly the files of the kit's starter folder, and "Create" makes them.
  const step = p.locator('[data-notes-step="starter"]');
  await expect(step).toBeVisible();
  await expect(step.locator('[data-starter-file]')).toHaveCount(starter.length);
  expect(await step.locator('[data-starter-file]').evaluateAll(els => els.map(e => e.getAttribute('data-starter-file')).sort())).toEqual([...starter].sort());
  await step.getByRole('button', { name: 'Create', exact: true }).click();
  const done = p.locator('[data-notes-done="created"]');
  await expect(done).toBeVisible();
  await expect(done).toContainText('Your notes are ready, with a history from the start.');

  // 3. "Build my Notes keeper" opens the edit of a folder's agents and the tour starts.
  const build = p.getByRole('button', { name: 'Build my Notes keeper', exact: true });
  await expect(build).toBeFocused();
  await build.click();
  const s = saveSheet(p);
  await expect(s).toBeVisible();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const t = tour(p);
  await expect(t).toBeVisible();
  await expect(t).toContainText('Step 1 of 7');
  await expect(t).toContainText('These are your AI agents, from every tool.');
  await t.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(t).toContainText('Your notes are what your agents can read.');
  await t.getByRole('button', { name: 'Next', exact: true }).click();

  // 4. The keeper is added from the kit as a draft when the tour reaches it, and the step after it waits for the person to build it.
  await expect(t).toContainText('This agent looks after your notes.');
  await expect(s.locator('[data-keeper]')).toBeVisible();
  await t.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(t).toContainText('Skills are what it knows how to do.');
  await expect(p.locator('[data-tour-hint]')).toHaveText('Drag add-source onto Skills, or press its Add button.');
  const skillsShelf = s.locator('[data-shelf="skills"]'), notesShelf = s.locator('[data-shelf="notes"]');
  await expect(skillsShelf.locator('[data-on-shelf]')).toHaveCount(0);

  // 5. Drag add-source onto Skills; then the hint asks for the other skills.
  const tray = s.locator('[data-section="keeper-build"]');
  await tray.locator('[data-card="add-source"]').dragTo(skillsShelf);
  await expect(skillsShelf.locator('[data-on-shelf="add-source"]')).toBeVisible();
  await expect(skillsShelf.locator('[data-on-shelf]')).toHaveCount(1);
  await expect(p.locator('[data-tour-hint]')).toHaveText('Now press Add the other skills.');
  await s.getByRole('button', { name: 'Add the other skills', exact: true }).click();
  expect(await skillsShelf.locator('[data-on-shelf]').evaluateAll(els => els.map(e => e.getAttribute('data-on-shelf')).sort())).toEqual(skills);
  await expect(p.locator('[data-tour-hint]')).toHaveText('Drag your notes onto the Notes shelf, or press Add.');

  // 6. Put the notes on the Notes shelf; the tour moves on to Save by itself.
  await tray.locator(`[data-card="${NOTES_ID}"]`).dragTo(notesShelf);
  await expect(notesShelf.locator(`[data-on-shelf]`)).toHaveCount(1);
  await expect(t).toContainText('Changes wait here until you press Save.');
  await expect(t).toContainText('Step 5 of 7');
  await t.getByRole('button', { name: 'Skip tour', exact: true }).click();
  await expect(t).toHaveCount(0);

  // 7. Review the save: every file of the kit's agent and skills is a new file, and the agent reads the notes. Then Save.
  await s.getByRole('button', { name: 'Review the save', exact: true }).click();
  const review = s.locator('[data-save-review="save"]');
  await expect(review).toBeVisible();
  await expect(review.locator('[data-file=".bowerloom/agents/notes-keeper.md"]')).toHaveAttribute('data-action', 'create');
  for (const id of skills) await expect(review.locator(`[data-file=".bowerloom/skills/${id}/SKILL.md"]`)).toHaveAttribute('data-action', 'create');
  await expect(review.locator('[data-agent-notes-after="notes-keeper"]')).toBeVisible();
  await review.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: /^Save \d+ files$/ }).click();
  await expect(s.locator('[data-version-kept]')).toBeVisible();

  // 8. Back in the edit, the Notes panel shows the folder, and the agent that reads it.
  await s.getByRole('button', { name: 'Edit', exact: true }).click();
  const panel = s.locator('[data-section="notes"]');
  await expect(panel).toBeVisible();
  const card = panel.locator('[data-card]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Notes');
  await expect(card.locator('[data-pages]')).toHaveText(`${[...kitStarter().keys()].filter(f => f.endsWith('.md')).length} pages`);
  await expect(card.locator('[data-last-change]')).toHaveText(/^Last change \d{4}-\d{2}-\d{2}$/);
  await expect(card.locator('[data-readers]')).toContainText('notes-keeper');
  await expect(card.locator('[data-report]')).toContainText('No tidy-up report yet.');
  await expect(panel.locator('[data-more-kinds]')).toBeVisible();

  // 9. Help replays the tour, and its last step is "What next": three ideas, in the middle, with Done.
  await s.getByRole('button', { name: 'Help: replay the tour', exact: true }).click();
  await expect(t).toBeVisible();
  for (let i = 0; i < 6; i++) await t.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(t).toContainText('Step 7 of 7');
  await expect(t).toContainText('What next? Three ideas for your Notes keeper.');
  await expect(t.locator('[data-tour-list] li')).toHaveCount(3);
  await expect(t).toContainText('Help sits at the top of this sheet.');
  await t.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(t).toHaveCount(0);
});

test('the same walk with the keyboard alone: no pointer press, no drag', async () => {
  const p = page();
  const skills = kitSkillIds();
  const press = async (control: Locator): Promise<void> => keyPress(p, control);

  // The notes step: Tab to "Start fresh", Enter; Tab to "Create", Enter.
  await press(p.getByRole('button', { name: 'Start fresh', exact: true }));
  const step = p.locator('[data-notes-step="starter"]');
  await expect(step).toBeVisible();
  await press(step.getByRole('button', { name: 'Create', exact: true }));
  await expect(p.locator('[data-notes-done="created"]')).toBeVisible();

  // The first-run page puts the focus on "Build my Notes keeper": Enter opens the edit, and the folder step takes Enter on Next.
  await expect(p.getByRole('button', { name: 'Build my Notes keeper', exact: true })).toBeFocused();
  await p.keyboard.press('Enter');
  const s = saveSheet(p);
  await expect(s).toBeVisible();
  await press(s.getByRole('button', { name: 'Next', exact: true }));

  // The tour: its Next button has the focus at each step.
  const t = tour(p);
  await expect(t).toContainText('Step 1 of 7');
  const next = t.getByRole('button', { name: 'Next', exact: true });
  for (let i = 0; i < 3; i++) { await expect(next).toBeFocused(); await p.keyboard.press('Enter'); await expect(t).toContainText(`Step ${i + 2} of 7`); }
  await expect(t).toContainText('Skills are what it knows how to do.');

  // The keeper is built inside the tour's waiting step, with Tab and Enter alone: the first Add button has the focus.
  const tray = s.locator('[data-section="keeper-build"]');
  await expect(tray.getByRole('button', { name: 'Add add-source to the Notes keeper', exact: true })).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(s.locator('[data-shelf="skills"] [data-on-shelf="add-source"]')).toBeVisible();
  await press(tray.getByRole('button', { name: 'Add the other skills', exact: true }));
  await expect(s.locator('[data-shelf="skills"] [data-on-shelf]')).toHaveCount(skills.length);
  await press(tray.getByRole('button', { name: 'Put Notes on the Notes shelf', exact: true }));
  await expect(s.locator('[data-shelf="notes"] [data-on-shelf]')).toHaveCount(1);

  // The keeper is built, so the tour moves on by itself. Its Next button has the focus again; Enter walks to the end, and Done closes it.
  await expect(t).toContainText('Step 5 of 7');
  for (let i = 5; i < 7; i++) { await expect(next).toBeFocused(); await p.keyboard.press('Enter'); await expect(t).toContainText(`Step ${i + 1} of 7`); }
  const doneButton = t.getByRole('button', { name: 'Done', exact: true });
  await expect(doneButton).toBeFocused();
  await p.keyboard.press('Enter');
  await expect(t).toHaveCount(0);

  // Then Tab to "Review the save", Enter, Tab to the tick, Space, Tab to Save, Enter.
  await press(s.getByRole('button', { name: 'Review the save', exact: true }));
  const review = s.locator('[data-save-review="save"]');
  await expect(review).toBeVisible();
  const tick = review.locator('[data-approve-plan] input');
  await tabTo(p, tick);
  await p.keyboard.press('Space');
  await expect(tick).toBeChecked();
  await press(s.getByRole('button', { name: /^Save \d+ files$/ }));
  await expect(s.locator('[data-version-kept]')).toBeVisible();
});

/**
 * In the tour step that waits for the keeper to be built, the tour takes Tab and cycles through the controls of the lit area that take the focus, then its own
 * card. A skill card that can be dragged is not one of them: its Add button is. So Tab moves on from the first Add button and reaches "Add the other skills".
 */
test('in the tour step that waits, Tab moves from the first Add button on to "Add the other skills"', async () => {
  const p = page();
  await keyPress(p, p.getByRole('button', { name: 'Start fresh', exact: true }));
  await keyPress(p, p.locator('[data-notes-step="starter"]').getByRole('button', { name: 'Create', exact: true }));
  await expect(p.getByRole('button', { name: 'Build my Notes keeper', exact: true })).toBeFocused();
  await p.keyboard.press('Enter');
  const s = saveSheet(p);
  await keyPress(p, s.getByRole('button', { name: 'Next', exact: true }));
  const t = tour(p);
  await expect(t).toContainText('Step 1 of 7');
  for (let i = 0; i < 3; i++) { await expect(t.getByRole('button', { name: 'Next', exact: true })).toBeFocused(); await p.keyboard.press('Enter'); await expect(t).toContainText(`Step ${i + 2} of 7`); }
  await expect(t).toContainText('Skills are what it knows how to do.');
  const first = s.locator('[data-section="keeper-build"]').getByRole('button', { name: 'Add add-source to the Notes keeper', exact: true });
  await expect(first).toBeFocused();
  const other = s.locator('[data-section="keeper-build"]').getByRole('button', { name: 'Add the other skills', exact: true });
  let reached = false;
  for (let i = 0; i < 20 && !reached; i++) { await p.keyboard.press('Tab'); reached = await other.evaluate(el => el === document.activeElement); }
  expect(reached, 'Tab reaches "Add the other skills"').toBe(true);
  // The focus never sat on a card that cannot take it: each Tab moved it.
  await expect(first).not.toBeFocused();
});
