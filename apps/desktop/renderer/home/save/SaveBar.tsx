/**
 * The Save bar at the foot of the window. It says what waits ("Nothing to save yet", "1 change", "3 changes"), offers Save, and after a save says
 * "Saved in this preview. Your files are untouched." with the programs a real save would update ("Would update: Claude Code, Codex, OpenCode") as quiet chips
 * with no tick, and a "Go back" button that undoes the save. The prototype writes nothing, so the bar never claims that a file changed. While changes wait it
 * also offers "Discard changes". The words sit in a polite live region, so a screen reader hears each change of state. The look of it is in save.css.
 */
import { useEffect, useId, useRef } from 'react';
import type { ReactElement } from 'react';
import { CARD_WORDS } from '../../../shared/home/cards.js';
import type { SaveBarModel } from '../../../shared/home/savebar.js';
import { Button } from '../kit/Button.js';
import { WORDS, changesCount } from '../words.js';
import './save.css';

export interface SaveBarProps {
  model: SaveBarModel;
  /** The programs a real save would update, as a person names them. */
  ticks: readonly string[];
  onSave(): void;
  onGoBack(): void;
  onDiscard(): void;
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

export function SaveBar({ model, ticks, onSave, onGoBack, onDiscard }: SaveBarProps): ReactElement {
  const goBack = useRef<HTMLButtonElement>(null);
  const leadId = useId();
  // Save turns itself off and Discard goes away, so the focus would fall to the page: a save puts it on "Go back", where the person can undo it at once.
  useEffect(() => { if (model.mode === 'saved') goBack.current?.focus(); }, [model.mode]);
  return (
    <section className="hm-savebar" data-tour="save" data-mode={model.mode} aria-label={WORDS.label.saveBar}>
      <div className="hm-savebar-state" role="status">
        <p>{barText(model)}</p>
        {model.mode === 'saved' && ticks.length > 0 ? (
          <div className="hm-would">
            <span className="hm-would-lead" id={leadId}>{WORDS.label.wouldUpdate}:</span>
            <ul className="hm-ticks" aria-labelledby={leadId}>
              {ticks.map(name => <li key={name} className="hm-tick">{name}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="hm-savebar-actions">
        {model.canDiscard ? <Button onClick={onDiscard}>{WORDS.label.discard}</Button> : null}
        {model.canGoBack ? <Button icon="clock" ref={goBack} onClick={onGoBack}>{WORDS.label.goBack}</Button> : null}
        <Button variant="primary" disabled={!model.canSave} onClick={onSave}>{WORDS.label.save}</Button>
      </div>
    </section>
  );
}
