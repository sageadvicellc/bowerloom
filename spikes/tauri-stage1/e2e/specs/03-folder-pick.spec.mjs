import { press, ready } from '../support.mjs';

describe('folder pick', () => {
  it('the test-only switch answers the folder chooser with the fixture folder', async () => {
    await ready();
    const folder = await press('pick', 'folder', /Projects\/a$/);
    expect(folder.endsWith('/Projects/a')).toBe(true);
  });
});
