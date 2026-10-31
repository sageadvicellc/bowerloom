import { screenshotSlots, type ScreenshotSlotId } from './screenshots';

/**
 * One neutral placeholder for a screenshot that arrives after launch.
 * The frame is decoration, so a screen reader skips it and the caption alone carries the meaning.
 * Swap the frame for the real image in each slot. The caption stays.
 */
export default function ScreenshotSlot({ slot }: { slot: ScreenshotSlotId }) {
  const item = screenshotSlots.find(entry => entry.id === slot)!;
  return <figure className="screenshot-slot" data-screenshot-slot={item.id}>
    <div className="screenshot-frame" aria-hidden="true">Screenshot to come</div>
    <figcaption>{item.caption}</figcaption>
  </figure>;
}
