/**
 * Journey 3 (spec section 12): "Undo and versions". The person makes a bad edit, opens the history, compares two versions, and restores one.
 *
 * It runs on the made-up home (tools/made-up-home.ts), project `rope-yard`. The history is the Builder's "Save points" drawer. The step "compares two versions" is the review of a go-back
 * (owner decision): it lists what changes between the current harness and the save point, and writes nothing until the person approves. Every step runs for real, and each file is read from disk by the test.
 */
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { bundleOnce } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { linkSkillToAgent, newMadeUpHome, openInBuilder, readTree, saveFromBuilder, saveSheet, startApp } from './journey-support.js';
import { removeTempDirs } from './temp-dirs.js';

let h: RealHarness;
test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); });

/** The paths whose bytes differ between two trees, or that exist in only one. */
function changed(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(path => a[path] !== b[path]).sort();
}

test('Journey 3: make a bad edit, open the save points, and go back to an earlier one; the harness is byte for byte as that save point left it', async () => {
  test.setTimeout(240_000);
  const home = newMadeUpHome(), dir = home.rope, def = join(dir, '.bowerloom');
  const asItWas = readTree(def);
  h = await startApp(home, 'harnesses');
  const p = h.page;
  await openInBuilder(h, dir, 'rope-yard');

  // A good edit first, so the history holds more than the start: knot-guide joins tallyman.
  let afterGood: Record<string, string>;
  await test.step('3.0 a good edit, saved: the second save point', async () => {
    await linkSkillToAgent(p, 'knot-guide', 'tallyman');
    await expect(p.locator('[data-draft]')).toContainText('1 change, not saved yet.');
    const listed = await saveFromBuilder(h);
    afterGood = readTree(def);
    expect(Object.keys(listed).map(f => f.replace(/^\.bowerloom\//, '')).sort()).toEqual(changed(asItWas, afterGood));
    await saveSheet(p).getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(p.locator('[data-draft]')).toContainText('No change yet.');
  });

  let afterBad: Record<string, string>;
  await test.step('3.1 a bad edit: the skill splice, which the agent foreman uses, is removed and saved; the files on disk show it', async () => {
    expect(afterGood['skills/splice/SKILL.md']).toBeDefined();
    await p.locator('[data-skill-row="splice"]').getByRole('button', { name: 'Remove: splice', exact: true }).click();
    await expect(p.locator('[data-draft]')).toContainText('change');
    expect(readTree(def), 'a draft writes nothing').toEqual(afterGood);
    const listed = await saveFromBuilder(h);
    afterBad = readTree(def);
    expect(afterBad['skills/splice/SKILL.md'], 'the skill is gone').toBeUndefined();
    expect(Object.keys(listed).map(f => f.replace(/^\.bowerloom\//, '')).sort(), 'the review listed exactly the files that changed').toEqual(changed(afterGood, afterBad));
    await saveSheet(p).getByRole('button', { name: 'Close', exact: true }).last().click();
  });

  let ids: string[];
  await test.step('3.2 open the history: three save points, newest first, the newest marked as the one in use', async () => {
    await p.getByRole('button', { name: 'Save points', exact: true }).click();
    const drawer = p.getByRole('dialog', { name: 'Save points' });
    const points = drawer.locator('[data-version]');
    await expect(points).toHaveCount(3);
    ids = await points.evaluateAll(els => els.map(e => e.getAttribute('data-version') ?? ''));
    expect(new Set(ids).size).toBe(3);
    await expect(points.nth(0)).toHaveAttribute('data-current', '');
    await expect(points.nth(1)).not.toHaveAttribute('data-current', '');
    await expect(points.nth(2)).toContainText(/as it was/i);
  });

  await test.step('3.4 restore the second save point: the review lists what would change, nothing is written until she approves, then the harness is byte for byte as that save point left it', async () => {
    const drawer = p.getByRole('dialog', { name: 'Save points' });
    await drawer.locator(`[data-version="${ids[1]}"]`).getByRole('button', { name: `Go back to ${ids[1]}`, exact: true }).click();
    const t = saveSheet(p), back = t.locator('[data-save-review="restore"]');
    await expect(back).toBeVisible();
    const listed = await back.locator('[data-file]').evaluateAll(els => els.map(e => (e.getAttribute('data-file') ?? '').replace(/^\.bowerloom\//, '')).sort());
    expect(listed, 'the review lists exactly the files that differ from the save point').toEqual(changed(afterBad, afterGood));
    expect(readTree(def), 'nothing is written while the person reads').toEqual(afterBad);
    await back.locator('[data-approve-plan] input').check();
    await t.getByRole('button', { name: `Go back to ${ids[1]}`, exact: true }).click();
    await expect(t.locator('[data-version-kept]')).toBeVisible();
    expect(readTree(def)).toEqual(afterGood);
    expect((await h.asked()).at(-1)!.message).toContain(ids[1]!);
  });

  await test.step('3.5 the go-back is itself a save point, and an earlier one can still be reached', async () => {
    await saveSheet(p).getByRole('button', { name: 'Close', exact: true }).last().click();
    await p.getByRole('button', { name: 'Save points', exact: true }).click();
    const drawer = p.getByRole('dialog', { name: 'Save points' });
    const points = drawer.locator('[data-version]');
    await expect(points).toHaveCount(4);
    await expect(points.nth(0)).toHaveAttribute('data-current', '');
    const start = ids[2]!;
    await drawer.locator(`[data-version="${start}"]`).getByRole('button', { name: `Go back to ${start}`, exact: true }).click();
    const t = saveSheet(p), back = t.locator('[data-save-review="restore"]');
    await back.locator('[data-approve-plan] input').check();
    await t.getByRole('button', { name: `Go back to ${start}`, exact: true }).click();
    await expect(t.locator('[data-version-kept]')).toBeVisible();
    expect(readTree(def), 'the start state, byte for byte').toEqual(asItWas);
  });
});

test('Journey 3, step 3.3: the Go back review is the compare; it lists what changes between the current harness and the save point, and nothing is written until the person approves', async () => {
  test.setTimeout(120_000);
  const home = newMadeUpHome(), def = join(home.rope, '.bowerloom');
  const asItWas = readTree(def);
  h = await startApp(home, 'harnesses');
  const p = h.page;
  await openInBuilder(h, home.rope, 'rope-yard');
  await linkSkillToAgent(p, 'knot-guide', 'tallyman');
  await saveFromBuilder(h);
  const current = readTree(def), whole = readTree(home.rope), askedBefore = (await h.asked()).length;
  expect(changed(asItWas, current), 'the save changed the harness').not.toEqual([]);
  await saveSheet(p).getByRole('button', { name: 'Close', exact: true }).last().click();
  await p.getByRole('button', { name: 'Save points', exact: true }).click();
  const drawer = p.getByRole('dialog', { name: 'Save points' });
  await expect(drawer.locator('[data-version]')).toHaveCount(2);
  const start = (await drawer.locator('[data-version]').nth(1).getAttribute('data-version'))!;
  await drawer.locator(`[data-version="${start}"]`).getByRole('button', { name: `Go back to ${start}`, exact: true }).click();
  const t = saveSheet(p), back = t.locator('[data-save-review="restore"]');
  await expect(back).toBeVisible();
  const listed = await back.locator('[data-file]').evaluateAll(els => els.map(e => (e.getAttribute('data-file') ?? '').replace(/^\.bowerloom\//, '')).sort());
  expect(listed, 'the review lists the files that differ between the current harness and the save point').toEqual(changed(current, asItWas));
  expect(readTree(def), 'nothing is written while the person reads').toEqual(current);
  expect(readTree(home.rope), 'no file of the whole folder changes while the person reads').toEqual(whole);
  expect(await h.asked(), 'main asks nothing before the approval').toHaveLength(askedBefore);
  // Leaving the review without approval writes nothing either.
  await t.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(t).toBeHidden();
  expect(readTree(def), 'closing the review writes nothing').toEqual(current);
  expect(readTree(home.rope), 'no file of the whole folder changes after Close').toEqual(whole);
});
