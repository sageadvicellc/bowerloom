// The real runner: the preview app in an Electron window, driven through Playwright's Electron API inside this one process. A persona never gets
// the page, the DOM, a script hook or a file. It gets the words of `look`, short results of actions, and screenshots saved to the out folder.
import { join } from 'node:path';
import { electronBinary } from '../run.mjs';
import { HANDLE_KEY, collectPage, formatLook } from './look.mjs';
import { HandleTable, coveredMessage, goneMessage, hiddenMessage, outMessage } from './handles.mjs';
import { PersonaError, SCREENS, redact } from './protocol.mjs';
import { writeBytes } from './files.mjs';

const nap = ms => new Promise(resolve => setTimeout(resolve, ms));
/** The environment of the app window: the person's own, without anything that looks like a secret. */
export function appEnv(source = process.env) {
  const out = {};
  for (const [name, value] of Object.entries(source)) if (value !== undefined && !/(token|secret|password|passwd|credential|api_?key|private_?key)/i.test(name)) out[name] = value;
  out.ELECTRON_DISABLE_SECURITY_WARNINGS = '1';
  return out;
}

/**
 * Opens the preview app and answers { run(cmd, args), closed (a promise that ends when the window is gone), close() }.
 * `desktop` is the app folder, `userDataDir` the temporary data folder, `outDir` the only place screenshots go, `hide` the folders to keep out of results.
 */
export async function openPreview({ desktop, userDataDir, outDir, size, hide = [] }) {
  const { _electron } = await import('@playwright/test');
  const executablePath = electronBinary(desktop);
  if (executablePath === null) throw new PersonaError('The app window is not installed. Run npm run dev once in apps/desktop to install it.');
  const app = await _electron.launch({ executablePath, args: [desktop, '--prototype-v2', `--user-data-dir=${userDataDir}`], env: appEnv(), timeout: 30000 });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-home]', { timeout: 20000 });

  const table = new HandleTable();
  let labels = [];
  let shots = 0;
  let emulation = null;

  async function setSize(w, h) {
    try { await app.evaluate(({ BrowserWindow }, [width, height]) => { const win = BrowserWindow.getAllWindows()[0]; if (win) win.setContentSize(width, height); }, [w, h]); } catch { /* the emulation below sets the size the page sees */ }
    emulation ??= await page.context().newCDPSession(page);
    await emulation.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await page.waitForFunction(([ww, hh]) => window.innerWidth === ww && window.innerHeight === hh, [w, h], { timeout: 2500 });
  }
  await setSize(size.width, size.height);

  // Waits for movement to stop, so a look and its screenshot show the settled screen. It never waits long.
  const settle = (limit = 1200) => page.evaluate(async cap => {
    const end = performance.now() + cap;
    while (performance.now() < end) {
      const running = document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
      if (running.length === 0) break;
      await new Promise(r => setTimeout(r, 40));
    }
    await Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise(r => setTimeout(r, 300))]);
  }, limit);

  // A short fingerprint of the words and states on the screen, so an action can say whether anything changed.
  const fingerprint = () => page.evaluate(() => {
    const t = document.body.innerText || '';
    let h = 0;
    for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) | 0;
    const states = ['aria-pressed', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-current'].map(a => [...document.querySelectorAll(`[${a}]`)].map(e => e.getAttribute(a)).join('')).join('|');
    return `${t.length}:${h}:${states}:${document.querySelectorAll('[role=dialog],dialog[open]').length}`;
  });

  async function after(before, did) {
    await settle(600);
    const now = await fingerprint();
    return `${did} ${now === before ? 'The words and states on the screen did not change.' : 'The screen changed. Run look to see it.'}`;
  }

  async function locate(n) {
    const index = table.indexOf(n);
    const found = await page.evaluate(({ key, i }) => {
      const list = window[Symbol.for(key)];
      const el = list && list[i];
      if (!el || !el.isConnected) return { state: 'gone' };
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return { state: 'hidden' };
      if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) return { state: 'out' };
      const x = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      const label = top ? top.closest('label') : null;
      const ok = top !== null && (el === top || el.contains(top) || (label !== null && label.control === el));
      return { state: ok ? 'ok' : 'covered', x, y };
    }, { key: HANDLE_KEY, i: index });
    if (found.state === 'gone') throw new PersonaError(goneMessage(n));
    if (found.state === 'hidden') throw new PersonaError(hiddenMessage(n));
    if (found.state === 'out') throw new PersonaError(outMessage(n));
    if (found.state === 'covered') throw new PersonaError(coveredMessage(n));
    return { x: found.x, y: found.y, label: labels[index] ?? `control [${n}]` };
  }

  const handlers = {
    async look() {
      await settle();
      const raw = await page.evaluate(collectPage, { maxItems: 400, maxText: 240, key: HANDLE_KEY });
      const controls = raw.items.filter(i => i.t === 'control');
      table.replace(controls.length);
      labels = controls.map(c => `${c.role}${c.name ? ` "${c.name}"` : ''}`);
      shots += 1;
      const file = join(outDir, `look-${String(shots).padStart(3, '0')}.png`);
      writeBytes(file, await page.screenshot({ type: 'png', scale: 'css', timeout: 3000 }));
      return formatLook(raw, { shot: file, redactor: text => redact(text, [...hide, outDir]) });
    },
    async click([n]) {
      const spot = await locate(n);
      const before = await fingerprint();
      await page.mouse.click(spot.x, spot.y);
      return after(before, `Pressed [${n}] ${spot.label}.`);
    },
    async hover([n]) {
      const spot = await locate(n);
      await page.mouse.move(spot.x, spot.y, { steps: 4 });
      await settle(600);
      return `Pointer is over [${n}] ${spot.label}. Run look to see what appeared.`;
    },
    async type([n, text]) {
      const spot = await locate(n);
      const before = await fingerprint();
      await page.mouse.click(spot.x, spot.y);
      const editable = await page.evaluate(() => { const a = document.activeElement; return a !== null && (a.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=""], [contenteditable="true"]')); });
      if (!editable) throw new PersonaError(`[${n}] ${spot.label} is not a place to type. Nothing was typed.`);
      await page.keyboard.type(text, { delay: 0 });
      return after(before, `Typed ${text.length} characters into [${n}] ${spot.label}.`);
    },
    async press([key]) {
      const before = await fingerprint();
      await page.keyboard.press(key);
      return after(before, `Pressed the ${key} key.`);
    },
    async drag([from, to]) {
      const a = await locate(from);
      const before = await fingerprint();
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(a.x + 6, a.y + 6, { steps: 3 });
      const b = await locate(to);
      await page.mouse.move(b.x, b.y, { steps: 12 });
      await nap(60);
      await page.mouse.up();
      return after(before, `Dragged [${from}] ${a.label} onto [${to}] ${b.label}.`);
    },
    async scroll([way, n]) {
      const view = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
      const spot = n === undefined ? { x: Math.round(view[0] / 2), y: Math.round(view[1] / 2) } : await locate(n);
      const before = await fingerprint();
      await page.mouse.move(spot.x, spot.y);
      await page.mouse.wheel(0, (way === 'down' ? 1 : -1) * Math.round(view[1] * 0.8));
      await nap(150);
      return after(before, `Scrolled ${way}.`);
    },
    async resize([w, h]) {
      await setSize(w, h);
      await settle(600);
      return `The window is now ${w} by ${h}. Run look to see it.`;
    },
    async theme([which]) {
      await page.emulateMedia({ colorScheme: which });
      const followed = await page.waitForFunction(l => document.documentElement.getAttribute('data-theme') === l, which, { timeout: 1500 }).then(() => true, () => false);
      await settle(600);
      return followed ? `Colours are now ${which}. Run look to see it.` : `Asked for ${which} colours, but the app did not seem to follow. Run look and check.`;
    },
    async motion([which]) {
      await page.emulateMedia({ reducedMotion: which === 'reduce' ? 'reduce' : 'no-preference' });
      return which === 'reduce' ? 'Asked for reduced motion.' : 'Motion is back to normal.';
    },
    async goto([screen]) {
      table.invalidate();
      await page.evaluate(hash => { location.hash = hash; location.reload(); }, SCREENS[screen]).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
      await page.waitForSelector('[data-home]', { timeout: 3000 });
      await settle(600);
      return `Started again at the ${screen === 'welcome' ? 'first minute (welcome)' : screen === 'map' ? 'map' : 'map with the tour'}. Old control numbers no longer work. Run look.`;
    },
  };

  const closed = new Promise(resolve => app.on('close', () => resolve()));
  return {
    async run(cmd, args) {
      const handler = handlers[cmd];
      if (handler === undefined) throw new PersonaError(`I do not know "${cmd}".`);
      return handler(args);
    },
    closed,
    async close() {
      await Promise.race([app.close().catch(() => {}), nap(4000)]);
      try { app.process().kill('SIGKILL'); } catch { /* it is already gone */ }
    },
  };
}
