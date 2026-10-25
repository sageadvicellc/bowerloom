/**
 * A right-side panel that opens over the stage. It is not modal: the stage stays usable (a later wave drags a skill from here onto an agent), so there is
 * no scrim. Opening moves the focus to the title; Escape or "Close" shuts it and gives the focus back to the control that opened it (see kit/focus.ts: only when the
 * focus is still the drawer's, so a layer that replaced it keeps the focus it took; when the opener is gone, `returnTo` names the next place). It slides in and
 * out with the panel motion tokens, and not at all when the person asked for less motion.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { MOTION, ms } from '../../motion-tokens.js';
import { WORDS } from '../words.js';
import { Button } from './Button.js';
import { drawerStep } from './drawer-phase.js';
import { currentControl, giveBackFocus } from './focus.js';
import type { DrawerPhase } from './drawer-phase.js';

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose(): void;
  children?: ReactNode;
  /** The tour and the tests find the drawer by this id. */
  dataSlot?: string;
  /** Draws it in the page flow instead of over the stage, open, with no motion (the kit gallery). */
  inline?: boolean;
  /** The heading level of the title, so a drawer fits under the heading that holds it. */
  level?: 2 | 4;
  /** Where the focus goes when the drawer closes and the control that opened it is gone or cannot take it. The main heading comes after it. */
  returnTo?(): HTMLElement | null;
}

export function Drawer({ open, title, onClose, children, dataSlot, inline = false, level = 2, returnTo }: DrawerProps): ReactElement | null {
  const titleId = useId();
  const [phase, setPhase] = useState<DrawerPhase>(open ? 'open' : 'closed');
  const heading = useRef<HTMLHeadingElement>(null), root = useRef<HTMLElement>(null), before = useRef<HTMLElement | null>(null), wasOpen = useRef(false), asked = useRef(false);
  const close = useRef(onClose), back = useRef(returnTo);
  close.current = onClose;
  back.current = returnTo;

  // The phase follows the prop. Closing waits for the slide-out, and a drawer that is asked to open again meanwhile simply opens.
  useEffect(() => {
    if (inline) return undefined;
    const closeMs = ms(MOTION.panel.close.ms);
    const next = drawerStep(phase, open, closeMs > 0);
    if (next !== phase) setPhase(next);
    if (next !== 'closing') return undefined;
    const timer = window.setTimeout(() => setPhase('closed'), closeMs);
    return () => window.clearTimeout(timer);
  }, [open, phase, inline]);

  // The opener is read before any effect of this pass moves the focus: a drawer that closes in the same pass gives its focus back in an effect, and that must not be
  // taken for the opener of the drawer that opens.
  useLayoutEffect(() => {
    if (inline) return;
    if (open && !asked.current) before.current = currentControl();
    asked.current = open;
  }, [open, inline]);
  // Focus: in on open, back to the opener on close (only if the focus is still this drawer's).
  useEffect(() => {
    if (inline) return;
    if (open && !wasOpen.current) heading.current?.focus();
    if (!open && wasOpen.current) { const opener = before.current; before.current = null; giveBackFocus(root.current, [opener, back.current?.()]); }
    wasOpen.current = open;
  }, [open, phase, inline]);

  useEffect(() => {
    if (!open || inline) return undefined;
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close.current(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, inline]);

  const Heading = level === 4 ? 'h4' : 'h2';
  const shown: DrawerPhase = inline || open ? 'open' : phase;
  if (shown === 'closed') return null;
  return (
    <aside className="kit-drawer" ref={root} role="dialog" aria-modal="false" aria-labelledby={titleId} data-phase={shown} data-inline={inline ? '' : undefined} data-slot={dataSlot}>
      <header className="kit-drawer-head">
        <Heading className="kit-heading" id={titleId} ref={heading} tabIndex={-1}>{title}</Heading>
        <Button round icon="close" aria-label={WORDS.label.close} onClick={onClose} />
      </header>
      <div className="kit-drawer-body">{children}</div>
    </aside>
  );
}
