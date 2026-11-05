import { useId, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type Ref } from 'react';
import { closesOnBackdrop, tabTarget } from './lightbox';
import { screenshotSlots, shotSource, shotThemes, type ScreenshotSlotId } from './screenshots';

/**
 * One screenshot with its caption. Both the light and the dark file are in the page, and the style sheet shows the one that matches the theme
 * (the site's own theme control sets `data-theme`; with no script the system setting decides). Every image is below the first screen, so it loads late,
 * and an image that is not shown never loads. The files come from `apps/desktop/e2e/landing-shots.spec.ts`.
 *
 * The shot is a button. It opens the same file at full size in a native modal dialog (`showModal`). The dialog has an X at the top right, a blurred backdrop,
 * and closes on Escape, on the X, and on a click on the backdrop. Tab cycles inside it, and the focus goes back to the shot when it closes.
 * The dialog holds no image until the first time it opens, so a visit that never enlarges a shot loads
 * nothing extra. The dialog names itself with the alt text, so the image inside it carries an empty alt and a screen reader does not say the text twice.
 */
export default function ScreenshotSlot({ slot }: { slot: ScreenshotSlotId }) {
  const item = screenshotSlots.find(entry => entry.id === slot)!;
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);
  const caption = useId();
  const open = () => { setOpened(true); dialog.current?.showModal(); };
  // The browser gives the focus back by itself. This line covers a browser that does not.
  const closed = () => { opener.current?.focus(); };
  return <>
    <figure className="screenshot-slot" data-screenshot-slot={item.id}>
      <button ref={opener} type="button" className="screenshot-open" aria-haspopup="dialog" aria-label="Enlarge the screenshot" aria-describedby={caption} onClick={open}>
        {shotThemes.map(theme => <img
          key={theme} className="screenshot-image" data-shot-theme={theme}
          src={shotSource(item.id, theme)} width={item.width} height={item.height}
          alt={item.alt} loading="lazy" decoding="async" />)}
        <span className="screenshot-hint" aria-hidden="true">Enlarge</span>
      </button>
      <figcaption id={caption}>{item.caption}</figcaption>
    </figure>
    <ShotDialog id={item.id} loaded={opened} ref={dialog} onClose={closed} />
  </>;
}

/** The enlarged view of one shot. `loaded` is false until the first time it opens, and then it holds the files of both themes (the style sheet shows the current one). */
export function ShotDialog({ id, loaded, ref, onClose }: { id: ScreenshotSlotId; loaded: boolean; ref?: Ref<HTMLDialogElement>; onClose?: () => void }) {
  const item = screenshotSlots.find(entry => entry.id === id)!;
  // The dialog box is filled edge to edge by its own content, so a click on the dialog itself is a click on the backdrop. It counts only when the press began there too:
  // a drag that starts inside (a text selection, a scrollbar) and ends on the backdrop must not close the dialog.
  const pressedOnBackdrop = useRef(false);
  const press = (event: PointerEvent<HTMLDialogElement>) => { pressedOnBackdrop.current = event.target === event.currentTarget; };
  const backdrop = (event: MouseEvent<HTMLDialogElement>) => {
    const close = closesOnBackdrop(pressedOnBackdrop.current, event.target, event.currentTarget);
    pressedOnBackdrop.current = false;
    if (close) event.currentTarget.close();
  };
  // Escape closes the dialog in every browser, and Tab wraps between the X and the scroll area.
  const trap = (event: KeyboardEvent<HTMLDialogElement>) => {
    const dialog = event.currentTarget;
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
    if (event.key !== 'Tab') return;
    const focusables = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')];
    const target = tabTarget(focusables, document.activeElement as HTMLElement | null, event.shiftKey);
    if (target) { event.preventDefault(); target.focus(); }
  };
  return <dialog ref={ref} className="screenshot-dialog" data-screenshot-dialog={item.id} aria-label={item.alt} onClose={onClose} onPointerDown={press} onClick={backdrop} onKeyDown={trap}>
    <div className="screenshot-dialog-bar">
      <p className="screenshot-dialog-caption">{item.caption}</p>
      <form method="dialog"><button type="submit" className="screenshot-close" aria-label="Close"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button></form>
    </div>
    <div className="screenshot-scroll" tabIndex={0} role="group" aria-label="Screenshot, scrolls">
      {loaded ? shotThemes.map(theme => <img
        key={theme} className="screenshot-full" data-shot-theme={theme}
        src={shotSource(item.id, theme)} width={item.width} height={item.height}
        alt="" loading="lazy" decoding="async" />) : null}
    </div>
  </dialog>;
}
