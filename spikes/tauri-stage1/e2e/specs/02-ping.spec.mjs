import { press, ready } from '../support.mjs';

describe('call path', () => {
  it('a ping goes page, shell, sidecar and comes back as pong', async () => {
    await ready();
    expect(await press('ping', 'ping-out', /^pong$/)).toBe('pong');
  });
});
