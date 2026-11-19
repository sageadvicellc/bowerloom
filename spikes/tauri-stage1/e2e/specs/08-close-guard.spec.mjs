// Runs last: its Leave step ends the app. Leave is pressed from the page 4 seconds after the spec ends, so the runner can end its WebDriver session on a live app.
// The launcher hook `onComplete` in wdio.conf.mjs then checks, from outside, that the app process ended. That check belongs to this spec.
import { spawnSync } from 'node:child_process';
import { click, press, ready } from '../support.mjs';

const running = () => spawnSync('pgrep', ['-f', 'target-e2e/release/bundle/macos/Bowerloom Tauri Spike E2E.app/Contents/MacOS/bowerloom-tauri-spike'], { encoding: 'utf8' }).stdout.trim() !== '';

describe('close guard', () => {
  it('with the guard on, a close request is held and asks; Stay keeps the window; Leave is pressed the second time', async () => {
    await ready();
    await press('guard', 'guard-out', /^on$/);
    await browser.execute(() => { window.__TAURI__.window.getCurrentWindow().close(); });
    const dialog = await browser.$('#guard-dialog');
    await browser.waitUntil(async () => dialog.isDisplayed(), { timeout: 10000, timeoutMsg: 'the guard did not ask' });
    await click('stay');
    await browser.waitUntil(async () => !(await dialog.isDisplayed()), { timeout: 10000, timeoutMsg: 'Stay did not close the question' });
    expect(await browser.getTitle()).toBe('Bowerloom Tauri Spike E2E');
    expect(running()).toBe(true);

    await browser.execute(() => { window.__TAURI__.window.getCurrentWindow().close(); });
    await browser.waitUntil(async () => dialog.isDisplayed(), { timeout: 10000, timeoutMsg: 'the guard did not ask the second time' });
    expect(running()).toBe(true);
    await browser.execute(() => { setTimeout(() => document.getElementById('leave').click(), 4000); });
  });
});
