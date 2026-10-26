/**
 * "How it will work": a short sheet, opened by the link in the Preview popover. It says, in two lists, what the plan for the full app has decided about a person's files
 * ("What is decided", each statement with its source, "Decided in the plan") and what it has not decided yet ("Not decided yet"). It states only what the specification
 * decided and promises nothing else (see trust/how-words.ts). It is a modal dialog like the Share sheet: the focus starts on its title and stays inside, the rest of the
 * page is out of reach, and Escape (or the scrim, or Close) closes it and gives the focus back to the control that opened it. Render it at the top of the page.
 */
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { Button } from '../kit/Button.js';
import { IconButton } from '../kit/IconButton.js';
import { trapTab } from '../add/dom-helpers.js';
import { useModalLayer } from '../add/modal-layer.js';
import '../add/add.css';
import './how.css';
import { DECIDED, HOW_WORDS, NOT_DECIDED } from './how-words.js';

const L = HOW_WORDS.label, H = HOW_WORDS.hint;

export interface HowItWorksProps {
  /** True while the sheet fades out: it ignores the pointer and a key, and Escape goes on to the next layer. */
  leaving?: boolean;
  onClose(): void;
}

export function HowItWorks({ leaving = false, onClose }: HowItWorksProps): ReactElement {
  const titleId = useId(), decidedId = useId(), openId = useId();
  const dialog = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const latest = useRef(onClose), going = useRef(leaving);
  latest.current = onClose; going.current = leaving;

  useModalLayer(dialog, heading, leaving);

  // Escape closes this sheet and nothing under it, wherever the focus is: a window listener in the capture phase hears it first.
  useEffect(() => {
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || going.current) return;
      e.preventDefault(); e.stopImmediatePropagation();
      latest.current();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, []);

  const key = (e: ReactKeyboardEvent<HTMLDivElement>): void => { if (dialog.current !== null) trapTab(e, dialog.current); };

  return (
    <div className="add-scrim" data-leaving={leaving ? '' : undefined} onPointerDown={e => { if (e.target === e.currentTarget && !leaving) onClose(); }}>
      <div className="hw-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} data-how="" ref={dialog} onKeyDown={key}>
        <header className="hw-head">
          <div className="hw-title">
            <h2 className="kit-heading" id={titleId} tabIndex={-1} ref={heading}>{L.title}</h2>
            <p className="kit-hint">{H.intro}</p>
          </div>
          <IconButton icon="close" label={L.close} onClick={onClose} />
        </header>
        <div className="hw-body">
          <section className="hw-section" aria-labelledby={decidedId} data-decided="">
            <h3 className="kit-heading" id={decidedId}>{L.decided}</h3>
            <ul className="hw-list">
              {DECIDED.map(item => (
                <li key={item.id} className="hw-item" data-statement={item.id}>
                  {item.paragraphs.map((text, i) => <p key={i} className="hw-text" data-budget="paragraph">{text}</p>)}
                  <p className="kit-hint hw-source" data-source=""><span className="kit-dot" aria-hidden="true" /><span>{L.source}</span></p>
                </li>
              ))}
            </ul>
          </section>
          <section className="hw-section" aria-labelledby={openId} data-not-decided="">
            <div className="hw-section-head">
              <h3 className="kit-heading" id={openId}>{L.notDecided}</h3>
              <p className="kit-hint">{H.notDecidedTip}</p>
            </div>
            <ul className="hw-list">
              {NOT_DECIDED.map(item => <li key={item.id} className="hw-item" data-open-question={item.id}><p className="hw-text" data-budget="paragraph">{item.text}</p></li>)}
            </ul>
          </section>
        </div>
        <footer className="hw-foot"><Button variant="primary" onClick={onClose}>{L.done}</Button></footer>
      </div>
    </div>
  );
}
