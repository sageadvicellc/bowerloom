/**
 * The parts of the harness editor around the canvas: the inspector, the dialogs (access class and conflict), the change bar, the list of
 * files that would be written, and the result panel. They hold only what is on the screen right now (an input's text, which box is open);
 * every change to the harness goes up through a callback and into the store.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode, RefObject } from 'react';
import { ACCESS_WORDS } from '../../shared/proto/harnessmodel.js';
import { ACTION_WORDS, applyReason, changeBarText, groupPlan, savedLine, writtenLine } from '../../shared/proto/editor-describe.js';
import type { SelectionAction, SelectionView } from '../../shared/proto/editor-describe.js';
import { conflictCopies, defaultCopyNames, keepBothProblem } from '../../shared/proto/editor-actions.js';
import type { AccessClass, HarnessItem, Plan, World } from '../../shared/proto/types.js';
import { makeOthersInert, watchFocusLoss } from './focus.js';
import { HarnessIcon } from './icons.js';
import './harness.css';

// ------------------------------------------------------------------------------------------------------------- dialog

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], pre[tabindex="0"], [tabindex="0"]';

/**
 * A modal box. Focus moves into it when it opens, Tab stays inside it, Escape closes it, and focus goes back to where it was when it closes.
 * While it is open the rest of the page is inert, so Tab and a screen reader cannot reach it. When the control that has the keyboard is
 * removed from the box (a button that swaps itself for a form), the keyboard goes to the first thing marked `data-autofocus`, or to the heading.
 * `fallbackFocus` finds a place for the focus when the thing that opened the box is gone by then.
 */
export function Modal({ title, onClose, children, fallbackFocus }: { title: string; onClose(): void; children: ReactNode; fallbackFocus?: () => HTMLElement | null }): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = box.current;
    if (el === null) return undefined;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restore = makeOthersInert(el);
    const home = (): HTMLElement | null => el.querySelector<HTMLElement>('[data-autofocus]') ?? heading.current ?? el;
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    const stop = watchFocusLoss(el, home);
    return () => {
      stop();
      restore();
      if (before !== null && before.isConnected) before.focus();
      else fallbackFocus?.()?.focus();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || box.current === null) return;
    const list = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (list.length === 0) { e.preventDefault(); return; }
    const first = list[0]!, last = list[list.length - 1]!, at = document.activeElement;
    if (e.shiftKey && (at === first || at === box.current || at === heading.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="harness-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="harness-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** The small chooser that opens when a tool is wired to an agent: which access class. The words are the placeholder ones. */
export function AccessDialog({ agentName, toolName, current, onPick, onClose }: { agentName: string; toolName: string; current: AccessClass | null; onPick(access: AccessClass): void; onClose(): void }): ReactElement {
  const [choice, setChoice] = useState<AccessClass>(current ?? 'read-only');
  return (
    <Modal title={`Attach ${toolName} to ${agentName}`} onClose={onClose}>
      <form className="harness-form" onSubmit={e => { e.preventDefault(); onPick(choice); }}>
        <fieldset>
          <legend>How much may {agentName} do with {toolName}?</legend>
          {(Object.keys(ACCESS_WORDS) as AccessClass[]).map((access, i) => (
            <label key={access} className="harness-radio">
              <input type="radio" name="access" value={access} checked={choice === access} onChange={() => setChoice(access)} {...(i === 0 ? { 'data-autofocus': true } : {})} />
              <span>{ACCESS_WORDS[access]}</span>
            </label>
          ))}
        </fieldset>
        <div className="harness-actions">
          <button type="submit" className="btn">Attach tool</button>
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/** The dialog for an item found in several interfaces with different text: the copies side by side, then keep one, or keep both under their own names. */
export function ConflictDialog({ world, item, onKeepOne, onKeepBoth, onClose, fallbackFocus }: {
  world: World; item: HarnessItem; onKeepOne(index: number): void; onKeepBoth(names: string[]): void; onClose(): void; fallbackFocus?: () => HTMLElement | null;
}): ReactElement {
  const copies = conflictCopies(item);
  const [names, setNames] = useState<string[]>(() => defaultCopyNames(item));
  const [showNames, setShowNames] = useState(false);
  const problem = showNames ? keepBothProblem(world, item, names) : null;
  // The button that was pressed is replaced by the other half of the dialog, so the keyboard is sent to the first control of that half.
  const firstName = useRef<HTMLInputElement>(null), keepBothButton = useRef<HTMLButtonElement>(null), switched = useRef(false);
  useEffect(() => {
    if (!switched.current) { switched.current = true; return; }
    (showNames ? firstName.current : keepBothButton.current)?.focus();
  }, [showNames]);
  return (
    <Modal title={`${item.name} has different text in different interfaces`} onClose={onClose} {...(fallbackFocus === undefined ? {} : { fallbackFocus })}>
      <p className="muted">Read the copies side by side. Keep one, or keep both under their own names. Nothing is written until you apply.</p>
      <div className="harness-copies">
        {copies.map(copy => (
          <section key={copy.index} className="harness-copy" aria-labelledby={`copy-${copy.index}`}>
            <h3 id={`copy-${copy.index}`}>Copy from {copy.interfaceNames}</h3>
            <p className="tech">{copy.paths.join(', ')}</p>
            <pre className="file" tabIndex={0} aria-label={`Text of the copy from ${copy.interfaceNames}`}>{copy.text}</pre>
            <button type="button" className="btn secondary" onClick={() => onKeepOne(copy.index)} {...(copy.index === copies[0]?.index ? { 'data-autofocus': true } : {})}>Keep the copy from {copy.interfaceNames}</button>
          </section>
        ))}
      </div>
      {showNames ? (
        <form className="harness-form" onSubmit={e => { e.preventDefault(); if (problem === null) onKeepBoth(names); }}>
          <fieldset>
            <legend>Name each copy</legend>
            {copies.map((copy, i) => (
              <label key={copy.index} className="harness-field">
                <span>Name for the copy from {copy.interfaceNames}</span>
                <input ref={i === 0 ? firstName : undefined} type="text" value={names[i] ?? ''} onChange={e => setNames(prev => prev.map((n, k) => (k === i ? e.target.value : n)))} aria-invalid={problem !== null} />
              </label>
            ))}
          </fieldset>
          <p className="small" role="status" aria-live="polite">{problem ?? ''}</p>
          <div className="harness-actions">
            <button type="submit" className="btn" disabled={problem !== null}>Keep both under these names</button>
            <button type="button" className="btn secondary" onClick={() => setShowNames(false)}>Back</button>
          </div>
        </form>
      ) : (
        <div className="harness-actions">
          <button ref={keepBothButton} type="button" className="btn" onClick={() => setShowNames(true)}>Keep both under their own names</button>
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------------------- inspector

const FLAG_TONE = (text: string): string => (/^(Secret missing)/.test(text) ? 'bad' : /^(Runs code|Conflict|Not installed)/.test(text) ? 'warn' : /^New version/.test(text) ? 'good' : 'quiet');

/** What a replacement list offers: the item and a note on where it lives. */
export interface ReplaceChoice { readonly id: string; readonly label: string }

/** The words that told a person to drop an inherited agent on the harness. The drop has no keyboard path, so with the button the note points at the button. */
const DROP_WORDS = /drop it on this harness to make a copy you can change here/;
const BUTTON_WORDS = 'press Copy to this harness to make a copy you can change here';

/** The note under the inspector, in words that match what the screen can do. */
export function noteFor(view: SelectionView, hasCopyButton: boolean): string | null {
  if (view.readOnlyNote === null) return null;
  return hasCopyButton ? view.readOnlyNote.replace(DROP_WORDS, BUTTON_WORDS) : view.readOnlyNote;
}

/** The panel beside the canvas: what the selected node is, where it came from, its states in words, and the buttons that apply. `copyHere` is the keyboard way to do what a drop on the harness does. */
export function Inspector({ view, onAction, onClose, headingRef, replace, copyHere }: {
  view: SelectionView | null; onAction(action: SelectionAction): void; onClose(): void; headingRef: RefObject<HTMLHeadingElement | null>;
  replace: { choices: readonly ReplaceChoice[]; value: string; onChange(id: string): void; onConfirm(): void; onCancel(): void } | null;
  copyHere?: (() => void) | null;
}): ReactElement {
  // A button here can remove itself (Remove the skill, Use this one). The keyboard then goes to the heading, not to the body.
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = panel.current;
    return el === null ? undefined : watchFocusLoss(el, () => headingRef.current ?? el.querySelector<HTMLElement>('button'));
  }, [headingRef]);
  if (view === null) {
    return (
      <aside ref={panel} className="harness-inspector is-empty" aria-label="Details of the selected item">
        <h2>Details</h2>
        <p>Select a skill, agent, tool or slice to read about it.</p>
        <p className="muted">To connect two items, drag from the side of one to the other, or press C on one, move to another and press Enter. To copy an inherited or library skill or agent into a harness, select it and press Copy to this harness, or drop it on the harness.</p>
      </aside>
    );
  }
  const choose = view.actions.filter(a => a.id === 'keep-from-global' || a.id === 'hide-here' || a.id === 'replace-here');
  const others = view.actions.filter(a => !choose.includes(a));
  return (
    <aside ref={panel} className="harness-inspector" aria-label="Details of the selected item">
      <div className="harness-inspector-head">
        <span className="chip quiet">{view.kindWord}</span>
        <button type="button" className="harness-close" onClick={onClose} aria-label="Close the details">Close</button>
      </div>
      <h2 ref={headingRef} tabIndex={-1}>{view.name}</h2>
      <p>{view.sentence}</p>
      {view.flags.length > 0 ? (
        <section aria-label="States">
          <ul className="harness-flags">{view.flags.map(f => <li key={f} className={`chip ${FLAG_TONE(f)}`}>{f}</li>)}</ul>
        </section>
      ) : null}
      {view.facts.length > 0 ? <ul className="harness-facts">{view.facts.map(f => <li key={f}>{f}</li>)}</ul> : null}
      {choose.length > 0 ? (
        <section aria-labelledby="harness-project-choice">
          <h3 id="harness-project-choice">In this project</h3>
          <div className="harness-segment" role="group" aria-label="What this project does with the item">
            {choose.map(a => <button key={a.id} type="button" className="btn secondary" aria-pressed={a.pressed === true} onClick={() => onAction(a)}>{a.label}</button>)}
          </div>
          {replace === null ? null : (
            <div className="harness-replace">
              <label className="harness-field"><span>Replace {view.name} with</span>
                <select value={replace.value} onChange={e => replace.onChange(e.target.value)}>
                  {replace.choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <div className="harness-actions">
                <button type="button" className="btn" onClick={replace.onConfirm} disabled={replace.choices.length === 0}>Use this one</button>
                <button type="button" className="btn secondary" onClick={replace.onCancel}>Cancel</button>
              </div>
              {replace.choices.length === 0 ? <p className="small muted">There is no other item of this kind to use.</p> : null}
            </div>
          )}
        </section>
      ) : null}
      {view.kind === 'scope' || view.kind === 'interface' || view.kind === 'group' ? null : (
        <section aria-labelledby="harness-found">
          <h3 id="harness-found">Where it was found</h3>
          {view.foundAt.length === 0 ? <p className="small muted">{view.foundNote}</p> : (
            <ul className="harness-found">{view.foundAt.map(f => <li key={`${f.interfaceName}${f.path}`}><span>{f.interfaceName}</span><span className="tech">{f.path}</span></li>)}</ul>
          )}
        </section>
      )}
      {others.length > 0 || copyHere != null ? (
        <section aria-labelledby="harness-more-actions">
          <h3 id="harness-more-actions">What you can do</h3>
          <div className="harness-stackbuttons">
            {copyHere == null ? null : <button type="button" className="btn secondary" onClick={copyHere}>Copy to this harness</button>}
            {others.map(a => <button key={`${a.id}-${a.targetId ?? ''}`} type="button" className="btn secondary" onClick={() => onAction(a)}>{a.label}</button>)}
          </div>
        </section>
      ) : null}
      {view.readOnlyNote === null ? null : <p className="small muted harness-note">{noteFor(view, copyHere != null)}</p>}
    </aside>
  );
}

// ------------------------------------------------------------------------------------------------------------- change bar

/** The list of files that would be written, by interface, with what happens to each and the text it will hold. */
export function PlanList({ plan, id, headingId }: { plan: Plan; id: string; headingId: string }): ReactElement {
  const groups = groupPlan(plan);
  return (
    <div id={id} className="harness-plan">
      <h3 id={headingId} className="sr">Files that will be written</h3>
      {groups.length === 0 ? <p className="muted">No file would change.</p> : groups.map(g => (
        <section key={g.interface} aria-label={g.name} className="harness-plan-group">
          <h4>{g.name} <span className="muted small">{g.summary}</span></h4>
          <ul>
            {g.changes.map(c => (
              <li key={`${c.interface}${c.path}`}>
                <details>
                  <summary><span className={`chip ${c.action === 'remove' ? 'bad' : c.action === 'add' ? 'good' : 'warn'}`}>{ACTION_WORDS[c.action]}</span> <span className="tech">{c.path}</span></summary>
                  <pre className="file">{c.preview}</pre>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The bar at the bottom: how many changes wait, the list behind a button, undo, redo, discard, a short label, and Apply with its reason when it is off. */
export function ChangeBar({ dirty, plan, open, onToggle, canUndo, canRedo, onUndo, onRedo, onDiscard, label, onLabel, onApply, toggleRef }: {
  dirty: boolean; plan: Plan; open: boolean; onToggle(): void; canUndo: boolean; canRedo: boolean; onUndo(): void; onRedo(): void; onDiscard(): void;
  label: string; onLabel(text: string): void; onApply(): void; toggleRef: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const reason = applyReason(dirty), reasonId = useId(), planId = useId(), headId = useId(), labelId = useId();
  return (
    <section className={`harness-bar${dirty ? ' is-dirty' : ''}`} aria-label="Changes">
      <h2 className="sr">Changes</h2>
      <div className="harness-bar-row">
        <div className="harness-status">
          <p className="harness-count" aria-live="polite"><strong>{changeBarText(dirty, plan.changes.length)}</strong></p>
          <p id={reasonId} className="small muted harness-reason">{reason ?? 'Apply saves a version of these changes.'}</p>
        </div>
        <button ref={toggleRef} type="button" className="btn secondary" aria-expanded={open} aria-controls={planId} disabled={!dirty} onClick={onToggle}>See what will be written</button>
        <div className="harness-bar-group" role="group" aria-label="Step through the changes">
          <button type="button" className="btn secondary" disabled={!canUndo} onClick={onUndo}>Undo</button>
          <button type="button" className="btn secondary" disabled={!canRedo} onClick={onRedo}>Redo</button>
          <button type="button" className="btn secondary" disabled={!dirty} onClick={onDiscard}>Discard</button>
        </div>
        <label className="harness-label" htmlFor={labelId}><span className="sr">Short label for this version</span>
          <input id={labelId} type="text" value={label} maxLength={80} placeholder="Short label for this version" onChange={e => onLabel(e.target.value)} />
        </label>
        <button type="button" className="btn" disabled={!dirty} aria-describedby={reasonId} onClick={onApply}>Apply</button>
      </div>
      {open && dirty ? <PlanList plan={plan} id={planId} headingId={headId} /> : null}
    </section>
  );
}

/** What happened after Apply: the files written per interface (from the plan computed just before), and the number of the version that was saved. */
export function ResultPanel({ plan, counter, label, onClose, headingRef }: { plan: Plan; counter: number | null; label: string; onClose(): void; headingRef: RefObject<HTMLHeadingElement | null> }): ReactElement {
  const groups = groupPlan(plan);
  return (
    <section className="harness-result" aria-labelledby="harness-result-title">
      <div className="harness-result-head">
        <h2 id="harness-result-title" ref={headingRef} tabIndex={-1}><HarnessIcon name="saved" size={22} />{writtenLine(plan)}</h2>
        <button type="button" className="btn secondary" onClick={onClose}>Done</button>
      </div>
      <p>{counter === null ? 'Saving the version.' : savedLine(counter, label)}. You can restore it later from Versions.</p>
      <div className="harness-result-groups">
        {groups.map(g => (
          <section key={g.interface} aria-label={g.name}>
            <h3>{g.name} <span className="muted small">{g.summary}</span></h3>
            <ul>{g.changes.map(c => <li key={`${c.interface}${c.path}`}><span className="chip quiet">{ACTION_WORDS[c.action]}</span> <span className="tech">{c.path}</span></li>)}</ul>
          </section>
        ))}
      </div>
    </section>
  );
}
