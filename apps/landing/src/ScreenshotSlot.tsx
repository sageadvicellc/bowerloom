import { screenshotSlots, type ScreenshotSlotId } from './screenshots';

/**
 * One screenshot with its caption. Both the light and the dark file are in the page, and the style sheet shows the one that matches the theme
 * (the site's own theme control sets `data-theme`; with no script the system setting decides). Every image is below the first screen, so it loads late,
 * and an image that is not shown never loads. The files come from `apps/desktop/e2e/landing-shots.spec.ts`.
 */
export default function ScreenshotSlot({ slot }: { slot: ScreenshotSlotId }) {
  const item = screenshotSlots.find(entry => entry.id === slot)!;
  return <figure className="screenshot-slot" data-screenshot-slot={item.id}>
    {(['light', 'dark'] as const).map(theme => <img
      key={theme} className="screenshot-image" data-shot-theme={theme}
      src={`/shots/${item.id}-${theme}.webp`} width={item.width} height={item.height}
      alt={item.alt} loading="lazy" decoding="async" />)}
    <figcaption>{item.caption}</figcaption>
  </figure>;
}
