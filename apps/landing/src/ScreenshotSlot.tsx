import { screenshotSlots, type ScreenshotSlotId } from './screenshots';

/**
 * One neutral placeholder for a screenshot that arrives after launch.
 * Swap this component for the real image in each slot. The caption stays.
 */
export default function ScreenshotSlot({ slot }: { slot: ScreenshotSlotId }) {
  const item = screenshotSlots.find(entry => entry.id === slot)!;
  return <figure className="screenshot-slot" data-screenshot-slot={item.id}>
    <div className="screenshot-frame" role="img" aria-label={`Screenshot to come. ${item.caption}`}>
      <span aria-hidden="true">Screenshot to come</span>
    </div>
    <figcaption>{item.caption}</figcaption>
  </figure>;
}
