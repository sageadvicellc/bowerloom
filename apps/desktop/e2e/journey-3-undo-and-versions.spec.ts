/**
 * Journey 3 (spec section 12): "Undo and versions". Hanna makes a bad edit, opens the history, compares two versions, and restores one.
 *
 * It runs on the made-up home (tools/made-up-home.ts), project `rope-yard`. The history is the Builder's "Save points" drawer. The step "compares two versions" is NOT BUILT in beta.1:
 * the drawer lists each save point with "Go back" and nothing else, and the only preview is the review of a go-back, which lists the files that would change against the folder as it is
 * now. That step is a `test.fixme` below, with an absence check that records what the drawer offers. Every other step runs for real, and each file is read from disk by the test.
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

test('Journey 3, compare: the save points drawer offers "Go back" for each point and no way to compare two of them', async () => {
  test.setTimeout(120_000);
  const home = newMadeUpHome();
  h = await startApp(home, 'harnesses');
  const p = h.page;
  await openInBuilder(h, home.rope, 'rope-yard');
  await linkSkillToAgent(p, 'knot-guide', 'tallyman');
  await saveFromBuilder(h);
  await saveSheet(p).getByRole('button', { name: 'Close', exact: true }).last().click();
  await p.getByRole('button', { name: 'Save points', exact: true }).click();
  const drawer = p.getByRole('dialog', { name: 'Save points' });
  await expect(drawer.locator('[data-version]')).toHaveCount(2);
  const names = await drawer.getByRole('button').evaluateAll(els => els.map(e => e.getAttribute('aria-label') ?? e.textContent ?? ''));
  expect(names.filter(n => !/^(Go back to |Close)/.test(n.trim())), 'no control but Go back and Close').toEqual([]);
  await expect(drawer.getByRole('checkbox')).toHaveCount(0);
  await expect(drawer.getByText(/compare|difference|diff\b|side by side/i)).toHaveCount(0);
});

test.fixme('Journey 3, step 3.3: compare two versions (NOT BUILT in beta.1: no screen shows the difference between two save points)', () => {
  // The spec says "compares two versions". The Builder lists save points and restores one. It has no view of two save points side by side, and no list of the files that differ between them.
  // The check above records what the drawer offers. Write the real test when the owner decides what "compare" means (see the report).
});
