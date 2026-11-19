// This spec writes the fixture folder, so it runs after the specs that plan the same folder.
import { press, ready } from '../support.mjs';

describe('adoption run', () => {
  it('running the plan that was shown writes it', async () => {
    await ready();
    await press('pick', 'folder', /Projects\/a$/);
    await press('plan', 'plan-out', /^plan /);
    expect(await (await browser.$('#plan')).getAttribute('data-calls')).toBe('1');
    expect(await press('run', 'run-out', /^(written|[A-Z_]+)$/)).toBe('written');
  });
});
