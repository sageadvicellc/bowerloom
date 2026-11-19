import { press, ready } from '../support.mjs';

describe('adoption plan', () => {
  it('planning an adoption shows a plan revision and at least 1 approval', async () => {
    await ready();
    await press('pick', 'folder', /Projects\/a$/);
    const text = await press('plan', 'plan-out', /^plan [0-9a-f]{8} approvals \d+$/);
    expect(Number(text.split(' ').at(-1))).toBeGreaterThanOrEqual(1);
  });
});
