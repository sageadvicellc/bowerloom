/**
 * The app sets its words in the website's faces, Manrope and Newsreader. A face that fails to load falls back to a system face with no error, and the app would
 * still look plausible, so this checks in the real window (hidden) that both faces loaded from the app's own folder.
 */
import { expect, test } from '@playwright/test';
import { launchHarness } from './harness-page.js';
import type { Harness } from './harness-page.js';
import { removeTempDirs } from './temp-dirs.js';

let h: Harness;

test.beforeAll(async () => { test.setTimeout(240_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h?.app.close(); } finally { removeTempDirs(); } });

test('Manrope and Newsreader are loaded, and the body and the page title use them', async () => {
  const p = h.page;
  await p.evaluate(() => { location.hash = '#sample/harnesses'; });
  await p.waitForSelector('.hm-topbar h1');
  const faces = await p.evaluate(async () => {
    await Promise.all([document.fonts.load('14px Manrope'), document.fonts.load('22px Newsreader'), document.fonts.load('italic 18px Newsreader')]);
    await document.fonts.ready;
    const loaded = [...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family}:${f.style}`);
    return {
      loaded: [...new Set(loaded)].sort(),
      body: getComputedStyle(document.querySelector('[data-home]')!).fontFamily,
      title: getComputedStyle(document.querySelector('.hm-topbar h1')!).fontFamily,
    };
  });
  expect(faces.loaded).toEqual(['Manrope:normal', 'Newsreader:italic', 'Newsreader:normal']);
  expect(faces.body.split(',')[0]!.trim()).toBe('Manrope');
  expect(faces.title.split(',')[0]!.trim()).toBe('Newsreader');
});
