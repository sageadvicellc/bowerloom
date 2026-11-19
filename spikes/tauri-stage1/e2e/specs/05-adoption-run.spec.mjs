// This spec runs before the one that writes, because a written folder cannot be planned again (the later specs share one fixture folder).
import { press, ready } from '../support.mjs';

describe('plan shown last', () => {
  it('after the core restarts, running the old plan returns NOT_THE_PLAN_SHOWN', async () => {
    await ready();
    await press('pick', 'folder', /Projects\/a$/);
    await press('plan', 'plan-out', /^plan /);
    await press('kill', 'kill-out', /^restarted$/);
    expect(await press('run', 'run-out', /^(written|[A-Z_]+)$/)).toBe('NOT_THE_PLAN_SHOWN');
  });
});
