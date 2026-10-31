/**
 * The Save bar at the foot of the window. It says what waits ("Nothing to save yet", "1 change", "3 changes"), offers Save, and after a save says
 * "Saved in this preview. Your files are untouched." with the programs a real save would update ("Would update: Claude Code, Codex, OpenCode") as quiet chips
 * with no tick, and a "Go back" button that undoes the save. While changes wait it also offers "Undo all changes". The words sit in a polite live region, so a
 * screen reader hears each change of state.
 * When the bar says "3 changes" (it names one or two in a sentence), the words are a button: it opens a list above the bar with one row for each change and an
 * "Undo" beside it, so one change can be taken back alone. A row that cannot be undone alone says why, in plain words. Escape or a press elsewhere closes the
 * list and the focus stays on the button. The look of it is in save.css.
 */
import { useEffect, useId, useRef } from 'react';
import type { ReactElement } from 'react';
import { CARD_WORDS } from '../../../shared/home/cards.js';
import type { ChangeEntry } from '../../../shared/home/change-undo.js';
import type { SaveBarModel } from '../../../shared/home/savebar.js';
import { Button } from '../kit/Button.js';
import { EditButton, EditIconButton, useReadOnly } from '../read-only.js';
import { KitIcon } from '../kit/icons.js';
import { WORDS, changesCount } from '../words.js';
import './save.css';

/** What the list above the bar needs: whether it is open, its rows, and what the buttons do. */
export interface ChangeListView { readonly open: boolean; setOpen(open: boolean): void; readonly entries: readonly ChangeEntry[]; undo(entry: ChangeEntry): void }

export interface SaveBarProps {
  model: SaveBarModel;
  /** The programs a real save would update, as a person names them. */
  ticks: readonly string[];
  onSave(): void;
  onGoBack(): void;
  onDiscard(): void;
  /** The list of changes. Without it the words are plain text. */
  list?: ChangeListView;
}

/** What the bar says in its current mode: for one or two changes, what they are; for more, how many. */
export function barText(model: SaveBarModel): string {
  switch (model.mode) {
    case 'dirty': return model.said ?? changesCount(model.changes);
    case 'saved': return WORDS.hint.saved;
    case 'back': return WORDS.label.wentBack;
    case 'clean': return CARD_WORDS.saveClean;
  }
}

function Rows({ entries, onUndo }: { entries: readonly ChangeEntry[]; onUndo(entry: ChangeEntry): void }): ReactElement {
  const base = useId();
  return (
    <ul className="hm-changes-rows">
      {entries.map((entry, i) => (
        <li key={entry.key} className="hm-changes-row" data-undoable={entry.undo === null ? undefined : ''}>
          <div className="hm-changes-what">
            <p id={`${base}-${i}`}>{entry.text}</p>
            {entry.reason === null ? null : <p className="kit-hint">{entry.reason}</p>}
          </div>
          <EditIconButton icon="undo" label={WORDS.label.undo} side="left" disabled={entry.undo === null} aria-describedby={`${base}-${i}`} data-undo="" onClick={() => onUndo(entry)} />
        </li>
      ))}
    </ul>
  );
}

export function SaveBar({ model, ticks, onSave, onGoBack, onDiscard, list }: SaveBarProps): ReactElement {
  const goBack = useRef<HTMLButtonElement>(null), toggle = useRef<HTMLButtonElement>(null), save = useRef<HTMLButtonElement>(null), wrap = useRef<HTMLElement>(null);
  const refocus = useRef(false);
  const leadId = useId(), listId = useId();
  // Save turns itself off and Discard goes away, so the focus would fall to the page: a save puts it on "Go back", where the person can undo it at once.
  useEffect(() => { if (model.mode === 'saved') goBack.current?.focus(); }, [model.mode]);
  const listed = list !== undefined && model.mode === 'dirty' && model.said === null && model.changes >= 2;
  const open = listed && list.open;
  // Escape closes the list and nothing under it (it is heard first and marked handled); a press anywhere else closes it too.
  useEffect(() => {
    if (!open || list === undefined) return undefined;
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault(); list.setOpen(false); toggle.current?.focus();
    };
    const away = (e: PointerEvent): void => { if (wrap.current !== null && e.target instanceof Node && !wrap.current.contains(e.target)) list.setOpen(false); };
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', away);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', away); };
  }, [open, list]);
  // After an Undo in the list the row (and maybe the whole list) is gone: the focus goes to the words button, else to Save, so it never falls to the page.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    (toggle.current ?? save.current)?.focus();
  });
  const readOnly = useReadOnly();
  const text = readOnly ? WORDS.hint.readOnlyBar : barText(model);
  return (
    <section className="hm-savebar" data-tour="save" data-mode={model.mode} aria-label={WORDS.label.saveBar} ref={wrap}>
      <div className="hm-savebar-state" role="status">
        <p>
          {listed && list !== undefined ? (
            <button type="button" className="hm-changes-toggle" ref={toggle} aria-expanded={open} aria-controls={listId} onClick={() => list.setOpen(!list.open)}>
              <span>{text}</span><KitIcon name="chevron" size={16} />
            </button>
          ) : text}
        </p>
        {model.mode === 'saved' && ticks.length > 0 ? (
          <div className="hm-would">
            <span className="hm-would-lead" id={leadId}>{WORDS.label.wouldUpdate}:</span>
            <ul className="hm-ticks" aria-labelledby={leadId}>
              {ticks.map(name => <li key={name} className="hm-tick">{name}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
      {open && list !== undefined ? (
        <div className="hm-changes-list" id={listId} role="group" aria-label={WORDS.label.changesWaiting} data-changes-list="">
          <Rows entries={list.entries} onUndo={entry => { refocus.current = true; list.undo(entry); }} />
        </div>
      ) : null}
      <div className="hm-savebar-actions">
        {model.canDiscard ? <EditButton onClick={onDiscard}>{WORDS.label.discard}</EditButton> : null}
        {model.canGoBack ? <EditButton icon="clock" ref={goBack} onClick={onGoBack}>{WORDS.label.goBack}</EditButton> : null}
        <EditButton variant="primary" ref={save} disabled={!model.canSave} side="above-end" onClick={onSave}>{WORDS.label.save}</EditButton>
      </div>
    </section>
  );
}
