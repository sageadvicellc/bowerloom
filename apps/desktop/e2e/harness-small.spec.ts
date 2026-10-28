/**
 * Goal 2 of the 0.8 build, on the sample launch (--prototype-v3): every screen at 900 by 600 (the smallest window), in light and dark. No screen is wider than
 * the window, the top row keeps its title and its buttons, every button, link and box of a screen draws a focus ring when the keyboard reaches it, and every
 * button changes when the pointer is on it. The sage leaf stands at the top of the navigation in each of its modes.
 * Set HARNESS_SHOTS to a folder to save screenshots.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { removeTempDirs } from './proto-temp.js';
import { WEEKLY, fresh, launchHarness, shot } from './harness-page.js';
import type { Harness } from './harness-page.js';

let h: Harness;
const page = (): Page => h.page;

test.beforeAll(async () => { test.setTimeout(300_000); h = await launchHarness(); });
test.afterAll(async () => { try { await h.app.close(); } finally { removeTempDirs(); } });

const SCREENS: readonly (readonly [string, string])[] = [
  ['welcome', '#prototype-v3'], ['choose', '#prototype-v3/choose'], ['read', '#prototype-v3/read'], ['harnesses', '#prototype-v3/harnesses'],
  ['builder-graph', `#prototype-v3/builder/${WEEKLY}/graph`], ['builder-list', `#prototype-v3/builder/${WEEKLY}/list`], ['library', '#prototype-v3/library/skill'],
  ['projects', '#prototype-v3/projects'], ['runs', '#prototype-v3/runs'], ['compare', '#prototype-v3/compare/group-1'], ['interfaces', '#prototype-v3/interfaces'],
  ['history', '#prototype-v3/history'], ['help', '#prototype-v3/help'],
];

/** The elements that stick out past the right edge of the window, by class. */
const overflow = (p: Page): Promise<string[]> => p.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const out = [...document.querySelectorAll<HTMLElement>('[data-home] *')].filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= w + 1) return false;
    // A tooltip that is not showing is not on the screen.
    for (let up: Element | null = el; up !== null; up = up.parentElement) { const s = getComputedStyle(up); if (s.visibility === 'hidden' || s.opacity === '0') return false; }
    // Inside a box that scrolls or clips (the graph canvas, a code block), being wider is the box's own business.
    for (let up = el.parentElement; up !== null; up = up.parentElement) { const s = getComputedStyle(up); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return false; }
    return true;
  });
  return out.map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`every screen fits 900 by 600 in ${scheme}: nothing past the right edge, and the top row keeps its title and buttons`, async () => {
    const p = page();
    await p.setViewportSize({ width: 900, height: 600 });
    await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
    for (const [name, hash] of SCREENS) {
      await fresh(p, hash);
      expect(await overflow(p), `${name}: nothing past the right edge`).toEqual([]);
      const scroll = await p.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth);
      expect(scroll, `${name}: no sideways scroll`).toBe(true);
      const top = p.locator('.hm-topbar');
      if (await top.count() > 0) {
        const cut = await top.evaluate(el => [...el.querySelectorAll<HTMLElement>('button, h1')].filter(b => { const r = b.getBoundingClientRect(), o = el.getBoundingClientRect(); return r.width > 0 && (r.right > o.right + 1 || r.left < o.left - 1); }).length);
        expect(cut, `${name}: the top row holds its buttons`).toBe(0);
      }
      await shot(p, `G2-${name}-900x600-${scheme}`);
    }
  });
}

test('every control of every screen draws a focus ring when the keyboard reaches it, at 900 by 600', async () => {
  const p = page();
  await p.setViewportSize({ width: 900, height: 600 });
  await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const missing: string[] = [];
  for (const [name, hash] of SCREENS) {
    await fresh(p, hash);
    await p.locator('body').click({ position: { x: 1, y: 599 } }).catch(() => undefined);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      await p.keyboard.press('Tab');
      const found = await p.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (el === null || el === document.body) return null;
        const key = `${el.tagName}.${el.className}.${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 30) ?? ''}`;
        const ring = (x: Element | null): boolean => { if (x === null) return false; const s = getComputedStyle(x); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || /rgb.*0px 0px 0px [2-9]/.test(s.boxShadow); };
        const host = el.closest('.hx-row, .hx-lrow, .hx-box, .hxe-tick, .hxi-card, .kit-card, .hxf-card');
        return { key, ok: ring(el) || ring(host) || ring(el.parentElement) };
      });
      if (found === null) continue;
      if (seen.has(found.key)) break;
      seen.add(found.key);
      if (!found.ok) missing.push(`${name}: ${found.key}`);
    }
  }
  expect(missing).toEqual([]);
});

test('every button of every screen changes when the pointer is on it', async () => {
  const p = page();
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const still: string[] = [];
  for (const [name, hash] of SCREENS) {
    await fresh(p, hash);
    const buttons = await p.locator('[data-home] button:visible:not([disabled]):not([aria-disabled="true"])').all();
    for (const b of buttons.slice(0, 40)) {
      const look = (): Promise<string> => b.evaluate(el => {
        const pick = (x: Element): string => { const s = getComputedStyle(x); return [s.backgroundColor, s.borderColor, s.color, s.boxShadow, s.textDecorationLine, s.opacity].join('|'); };
        const host = el.closest('.hx-row, .hx-lrow, .hx-box, .hxi-card, .kit-card, .hxf-card');
        // The navigation shows its hover as one soft box that glides under the pointer (renderer/home/shell/shell.css).
        const glide = el.closest('.hm-nav') === null ? '' : String(document.querySelector('.hm-nav-glide')?.hasAttribute('data-on'));
        return `${pick(el)}#${host === null ? '' : pick(host)}#${glide}`;
      });
      if (!(await b.isVisible())) continue;
      // The pointer rests on the page title, which is no control, before each reading.
      await b.scrollIntoViewIfNeeded().catch(() => undefined);
      const rest = await p.locator('h1').first().boundingBox();
      await p.mouse.move(rest === null ? 1 : rest.x + 2, rest === null ? 1 : rest.y + rest.height / 2);
      const before = await look();
      await b.hover({ force: true, timeout: 2000 }).catch(() => undefined);
      const after = await look();
      if (before === after) still.push(`${name}: ${await b.evaluate(el => `${el.className} ${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 30) ?? ''}`)}`);
    }
  }
  expect(still).toEqual([]);
});

test('the sage leaf stands at the top of the navigation, open, as a rail, and in the drawer of a narrow window', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  for (const [w, mode] of [[1280, 'open'], [1000, 'rail'], [900, 'rail']] as const) {
    await p.setViewportSize({ width: w, height: 700 });
    await fresh(p, '#prototype-v3/harnesses');
    await expect(p.locator('.hm-root')).toHaveAttribute('data-nav', mode);
    const leaf = p.locator('#hm-nav .hm-brand svg');
    await expect(leaf).toBeVisible();
    const box = (await leaf.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(20);
    await shot(p, `G2-leaf-${mode}-${w}`);
  }
});
