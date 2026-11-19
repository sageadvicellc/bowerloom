import { ready, textOf } from '../support.mjs';

describe('launch', () => {
  it('starts the app, its window has the title, and the core becomes ready', async () => {
    await ready();
    expect(await browser.getTitle()).toBe('Bowerloom Tauri Spike E2E');
    expect(await textOf('status')).toBe('ready');
  });
});
