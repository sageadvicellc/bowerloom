import { useRef, useState, type MouseEvent, type Ref } from 'react';
import { screenshotSlots, shotSource, shotThemes, type ScreenshotSlotId } from './screenshots';

/**
 * One screenshot with its caption. Both the light and the dark file are in the page, and the style sheet shows the one that matches the theme
 * (the site's own theme control sets `data-theme`; with no script the system setting decides). Every image is below the first screen, so it loads late,
 * and an image that is not shown never loads. The files come from `apps/desktop/e2e/landing-shots.spec.ts`.
 *
 * The shot is a button. It opens the same file at full size in a native modal dialog (`showModal`), which keeps the keyboard focus inside, closes on
 * Escape, and gives the focus back to the shot. The dialog holds no image until the first time it opens, so a visit that never enlarges a shot loads
 * nothing extra. The dialog names itself with the alt text, so the image inside it carries an empty alt and a screen reader does not say the text twice.
 */
export default function ScreenshotSlot({ slot }: { slot: ScreenshotSlotId }) {
  const item = screenshotSlots.find(entry => entry.id === slot)!;
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);
  const open = () => { setOpened(true); dialog.current?.showModal(); };
  // The browser gives the focus back by itself. This line covers a browser that does not.
  const closed = () => { opener.current?.focus(); };
  return <>
    <figure className="screenshot-slot" data-screenshot-slot={item.id}>
      <button ref={opener} type="button" className="screenshot-open" aria-haspopup="dialog" aria-label={`Enlarge the screenshot: ${item.caption}`} onClick={open}>
        {shotThemes.map(theme => <img
          key={theme} className="screenshot-image" data-shot-theme={theme}
          src={shotSource(item.id, theme)} width={item.width} height={item.height}
          alt={item.alt} loading="lazy" decoding="async" />)}
        <span className="screenshot-hint" aria-hidden="true">Enlarge</span>
      </button>
      <figcaption>{item.caption}</figcaption>
    </figure>
    <ShotDialog id={item.id} loaded={opened} ref={dialog} onClose={closed} />
  </>;
}

/** The enlarged view of one shot. `loaded` is false until the first time it opens, and then it holds the files of both themes (the style sheet shows the current one). */
export function ShotDialog({ id, loaded, ref, onClose }: { id: ScreenshotSlotId; loaded: boolean; ref?: Ref<HTMLDialogElement>; onClose?: () => void }) {
  const item = screenshotSlots.find(entry => entry.id === id)!;
  // The dialog box is filled edge to edge by its own content, so a click that lands on the dialog itself is a click on the backdrop.
  const backdrop = (event: MouseEvent<HTMLDialogElement>) => { if (event.target === event.currentTarget) event.currentTarget.close(); };
  return <dialog ref={ref} className="screenshot-dialog" data-screenshot-dialog={item.id} aria-label={item.alt} onClose={onClose} onClick={backdrop}>
    <div className="screenshot-dialog-bar">
      <p className="screenshot-dialog-caption">{item.caption}</p>
      <form method="dialog"><button type="submit" className="screenshot-close">Close</button></form>
    </div>
    <div className="screenshot-scroll" tabIndex={0} role="group" aria-label="Screenshot, scrolls">
      {loaded ? shotThemes.map(theme => <img
        key={theme} className="screenshot-full" data-shot-theme={theme}
        src={shotSource(item.id, theme)} width={item.width} height={item.height}
        alt="" loading="lazy" decoding="async" />) : null}
    </div>
  </dialog>;
}
