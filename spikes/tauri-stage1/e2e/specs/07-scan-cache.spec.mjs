import { press, ready } from '../support.mjs';

describe('scan cache', () => {
  it('nothing is saved at first, a scan keeps its read, and the read is found after the core restarts', async () => {
    await ready();
    expect(await press('saved', 'saved-out', /^none$/)).toBe('none');
    expect(await press('scan', 'scan-out', /^9 items$/)).toBe('9 items');
    await press('kill', 'kill-out', /^restarted$/);
    expect(await press('saved', 'saved-out', /^saved 9$/)).toBe('saved 9');
  });
});
