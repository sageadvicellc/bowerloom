/**
 * Waits for the prototype e2e specs. Each one waits on a state that can be read from the page (a picture that has stopped moving, animations that
 * have finished, a frame that has been painted), never on a fixed number of milliseconds. A wait that does not end fails with a plain message.
 */
import type { Page } from '@playwright/test';

/** Waits for the next two painted frames: a resize or a change of the page has been laid out and drawn. */
export async function framesPainted(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Waits until every animation and transition on the page has finished. An animation that never ends fails the wait after 10 seconds. */
export async function animationsDone(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const deadline = performance.now() + 10_000;
    for (;;) {
      const running = document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
      if (running.length === 0) return;
      if (performance.now() > deadline) throw new Error(`${running.length} animations did not finish.`);
      await Promise.race([...running.map(a => a.finished.catch(() => undefined)), new Promise(r => setTimeout(r, 250))]);
    }
  });
  await framesPainted(page);
}

/**
 * Waits until the harness graph has stopped moving: the viewport has the same transform for 10 frames in a row and no animation is running.
 * With `fitted`, it also waits until every node is inside the graph's frame, which is the state after the first fit of a new scope.
 */
export async function canvasSettled(page: Page, options: { fitted?: boolean } = {}): Promise<void> {
  await page.evaluate(({ fitted }) => new Promise<void>((resolve, reject) => {
    let last = '', same = 0, tries = 0;
    const inside = (): boolean => {
      const root = document.querySelector('.hc-root');
      const nodes = [...document.querySelectorAll('.react-flow__node')];
      if (root === null || nodes.length === 0) return false;
      if (!fitted) return true;
      const c = root.getBoundingClientRect();
      return nodes.every(n => { const b = n.getBoundingClientRect(); return b.left >= c.left - 2 && b.right <= c.right + 2 && b.top >= c.top - 2 && b.bottom <= c.bottom + 2; });
    };
    const tick = (): void => {
      const viewport = document.querySelector('.react-flow__viewport'), now = viewport === null ? 'none' : (viewport as HTMLElement).style.transform;
      const moving = document.getAnimations().some(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
      same = now === last && !moving && inside() ? same + 1 : 0;
      last = now; tries += 1;
      if (same >= 10) resolve(); else if (tries > 900) reject(new Error('The graph never stood still.')); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { fitted: options.fitted === true });
}
