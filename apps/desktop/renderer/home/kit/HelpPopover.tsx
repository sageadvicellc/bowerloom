/**
 * A button that opens a small popover with one sentence. This is where a technical term may be explained (the text is marked `data-budget="popover"`).
 * Escape or a click elsewhere closes it, and the focus stays on the button. An optional action sits under the sentence, such as "Show me around".
 * The button is a round "?" by default. With `word` it is a button with that word on it ("Help"), so a person never has to guess what a bare "?" means. With `pill` it is plain words with a small dot (the "Preview" mark of the top bar), so one control
 * both says what it is and explains itself, and a window never carries two question marks for the same thing. It has no fill and no border, but it keeps a
 * 32 px hit area and shows an underline when it is open.
 * The popover fades in with a 4 px rise and fades out faster than it came (the overlay tokens); under reduce motion it comes and goes at once.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from './Button.js';
import { KitIcon } from './icons.js';
import type { KitIconName } from './icons.js';
import { usePresence } from './presence.js';
import { Tooltip } from './Tooltip.js';
import type { TipSide } from './Tooltip.js';

export interface HelpPopoverProps {
  /** What the button is called, for a screen reader. At most 5 words. */
  label: string;
  /** The one sentence. */
  text: string;
  /** An action under the sentence. It is the one primary button by default; `quiet` makes it a link (words with an underline), for an action that is only more to read. */
  action?: { label: string; onAction(): void; quiet?: boolean };
  defaultOpen?: boolean;
  /** The tour finds the button by this id. */
  dataTour?: string;
  /** Which way the popover opens from the button. */
  align?: 'start' | 'end';
  size?: 'normal' | 'small';
  /** The words of a pill button (at most 5). Without them the button is a round "?". */
  pill?: string;
  /** The word on a plain button ("Help"). It takes the place of the round "?". */
  word?: string;
  /** Draws the word button as an item of the left navigation: an icon, the word, and a Tab stop of the navigation's own (`tabIndex`), found by the arrow keys through `data-nav-item`. */
  item?: { readonly icon: KitIconName; readonly navKey: string; readonly tabIndex: number };
  /** Which way the popover opens: under the button (default) or over it, for a button at the foot of the window. */
  place?: 'below' | 'above';
  /** A tooltip for the button, for when its words are hidden (the icon rail). `off` leaves it out without moving the button. */
  tip?: { readonly text: string; readonly side: TipSide; readonly off: boolean };
}

export function HelpPopover({ label, text, action, defaultOpen = false, dataTour, align = 'start', size = 'normal', pill, word, item, place = 'below', tip }: HelpPopoverProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null), trigger = useRef<HTMLButtonElement>(null);
  // The popover stays in the page for the length of its exit, so it can fade out.
  const shown = usePresence(open);
  useEffect(() => {
    if (!open) return undefined;
    // Escape closes the popover and nothing under it: it is heard first (capture phase) and marked handled, so a drawer under it stays open.
    // A key that a layer above already handled is left alone.
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault(); setOpen(false); trigger.current?.focus();
    };
    const away = (e: PointerEvent): void => { if (wrap.current !== null && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', away);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', away); };
  }, [open]);
  const toggle = (): void => setOpen(o => !o);
  const trigger_ = (aria: { readonly 'aria-describedby'?: string }): ReactElement => (pill === undefined
    ? word === undefined
      ? <Button ref={trigger} round size={size} aria-label={label} aria-expanded={open} aria-controls={id} data-tour={dataTour} onClick={toggle} {...aria}>?</Button>
      : item === undefined
        ? <Button ref={trigger} size={size} aria-expanded={open} aria-controls={id} data-tour={dataTour} onClick={toggle} {...aria}>{word}</Button>
        : <button ref={trigger} type="button" className="hm-nav-item" data-nav-item="" data-nav-key={item.navKey} tabIndex={item.tabIndex} aria-expanded={open} aria-controls={id} data-tour={dataTour} onClick={toggle} {...aria}><KitIcon name={item.icon} size={20} /><span className="hm-nav-label">{word}</span></button>
    : <button ref={trigger} type="button" className="kit-status kit-help-text" data-tone="info" data-no-drag="" aria-label={label} aria-expanded={open} aria-controls={id} data-tour={dataTour} onClick={toggle} {...aria}><span className="kit-dot" aria-hidden="true" /><span>{pill}</span></button>);
  return (
    <span className="kit-help" ref={wrap} data-align={align} data-place={place === 'above' ? 'above' : undefined}>
      {tip === undefined ? trigger_({}) : <Tooltip text={tip.text} side={tip.side} off={tip.off}>{aria => trigger_(aria)}</Tooltip>}
      {shown.mounted ? (
        <div className="kit-popover" id={id} role="group" aria-label={label} data-budget="popover" data-leaving={shown.leaving ? '' : undefined}>
          <p>{text}</p>
          {action === undefined ? null : <Button variant={action.quiet === true ? 'text' : 'primary'} onClick={() => { setOpen(false); trigger.current?.focus(); action.onAction(); }}>{action.label}</Button>}
        </div>
      ) : null}
    </span>
  );
}
