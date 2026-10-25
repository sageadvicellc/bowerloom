/**
 * The Share sheet: a small modal sheet, opened from the Share section of the Version history drawer. It says what a copy of the person's agents holds as counts
 * ("29 skills, 10 agents, 8 tools, 3 sets of notes"), what it leaves out ("Left out: 4 keys"), lets the person untick agents to leave them out, and "Save a
 * copy" makes the copy with the 0.7 bundle logic (shared/home/share-model.ts). The prototype writes nothing: the copy is kept in memory, the sheet says so,
 * and the Add drawer's "From a shared file" tab can open it again. Secrets never travel: a tool that needs a key arrives asking for one.
 * It is a modal dialog like the "two different copies" dialog: the focus starts on its title and stays inside, the rest of the page is out of reach,
 * Escape (or the scrim) closes it and gives the focus back to the button that opened it. Render it at the top of the page. It shows the saved agents:
 * changes that wait for Save are not in the copy, and the sheet says so. No file path is drawn.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import type { World } from '../../../shared/proto/types.js';
import { agentCard, shelvesOf } from '../../../shared/home/cards.js';
import { canSave, planShare, shareableAgents, toggleLeftOut } from '../../../shared/home/share-model.js';
import { Button } from '../kit/Button.js';
import { KitIcon } from '../kit/icons.js';
import { trapTab } from '../add/dom-helpers.js';
import { useModalLayer } from '../add/modal-layer.js';
import '../add/add.css';
import './share.css';
import { SHARE_WORDS, bringsLine, countsLine, leftOutLine, sizeLine } from './share-words.js';

const L = SHARE_WORDS.label, H = SHARE_WORDS.hint;

export interface ShareSheetProps {
  /** The saved world: a copy holds what is saved. */
  world: World;
  /** The ids of agents that are off the map (their place was skipped in Find). They are not offered. */
  hidden: readonly string[];
  /** True when changes wait for Save. They are not in the copy, and the sheet says so. */
  unsaved: boolean;
  /** True while the sheet fades out: it ignores the pointer and a key, and Escape goes on to the next layer. */
  leaving?: boolean;
  onClose(): void;
  /** Called with the text of the copy when "Save a copy" is pressed. */
  onCopy(text: string): void;
  /** Called when the person asks to open a shared file (the sheet closes first). */
  onOpenFile(): void;
}

export function ShareSheet({ world, hidden, unsaved, leaving = false, onClose, onCopy, onOpenFile }: ShareSheetProps): ReactElement {
  const titleId = useId(), readyId = useId(), listId = useId();
  const dialog = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null), ready = useRef<HTMLHeadingElement>(null);
  const [left, setLeft] = useState<readonly string[]>([]);
  const [made, setMade] = useState<{ readonly bytes: number } | null>(null);
  const agents = useMemo(() => shareableAgents(world, hidden), [world, hidden]);
  // The agents are listed by the names a person sees, the way the map lists them.
  const rows = useMemo(() => agents.map(a => { const shelves = shelvesOf(world, a); return { id: a.id, name: agentCard(a).name, brings: bringsLine(shelves.skills.length, shelves.tools.length) }; }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), [world, agents]);
  const offered = useMemo(() => agents.map(a => a.id), [agents]);
  const plan = useMemo(() => planShare(world, offered, left), [world, offered, left]);
  const latest = useRef(onClose), going = useRef(leaving);
  latest.current = onClose; going.current = leaving;

  // Focus goes to the title and the rest of the page goes inert. When the sheet leaves, the page is reachable again and the focus goes back to the button that opened
  // it, unless a layer that replaces this one ("Open a shared file") has taken the focus already (see add/modal-layer.ts).
  useModalLayer(dialog, heading, leaving);
  // A copy that was made stops being "ready" the moment the choice changes, and the focus moves to the line that says it is ready.
  useEffect(() => { if (made !== null) ready.current?.focus(); }, [made]);

  // Escape closes this sheet and nothing under it, wherever the focus is (see CopiesDialog): a window listener in the capture phase hears it first.
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
  const tick = (id: string): void => { setLeft(current => toggleLeftOut(current, id)); setMade(null); };
  const save = (): void => { if (!canSave(plan)) return; onCopy(plan.text); setMade({ bytes: plan.bytes }); };
  const empty = !canSave(plan);

  return (
    <div className="add-scrim" data-leaving={leaving ? '' : undefined} onPointerDown={e => { if (e.target === e.currentTarget && !leaving) onClose(); }}>
      <div className="sh-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} data-share="" data-made={made === null ? undefined : ''} ref={dialog} onKeyDown={key}>
        <header className="sh-head">
          <div className="sh-title">
            <h2 className="kit-heading" id={titleId} tabIndex={-1} ref={heading}>{L.sheetTitle}</h2>
            <p className="kit-hint">{H.shareTip}</p>
          </div>
          <Button round icon="close" aria-label={L.close} onClick={onClose} />
        </header>

        <section className="sh-summary" aria-labelledby={`${listId}-goes`}>
          <h3 className="kit-heading" id={`${listId}-goes`}>{L.goesIn}</h3>
          <div aria-live="polite" className="sh-live">
            <p className="sh-counts" data-empty={empty ? '' : undefined}>{empty ? H.nothingPicked : countsLine(plan.counts)}</p>
            <p className="sh-left">{leftOutLine(plan.keys, plan.leftOutAgents, plan.readyMade)}</p>
          </div>
          <div className="sh-secrets">
            <p className="kit-hint">{H.secretsOut}</p>
            <p className="kit-hint">{H.textIn}</p>
            <p className="kit-hint">{H.keysAsk}</p>
            {plan.readyMade > 0 ? <p className="kit-hint">{H.readyMadeOut}</p> : null}
          </div>
          {unsaved ? <p className="kit-hint">{H.unsaved}</p> : null}
        </section>

        <div className="sh-pick" role="group" aria-labelledby={listId}>
          <div className="sh-pick-head">
            <h3 className="kit-heading" id={listId}>{L.pickAgents}</h3>
            <p className="kit-hint">{H.pickTip}</p>
          </div>
          {rows.length === 0 ? <p className="kit-hint">{H.noAgents}</p> : (
            <ul className="sh-rows">
              {rows.map(r => (
                <li key={r.id}>
                  <label className="sh-row" data-agent={r.id}>
                    <input type="checkbox" checked={!left.includes(r.id)} onChange={() => tick(r.id)} />
                    <span className="sh-row-text"><span className="sh-row-name">{r.name}</span><span className="kit-hint">{r.brings}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="sh-foot">
          {made === null ? (
            <>
              <Button variant="primary" icon="check" disabled={empty} onClick={save}>{L.saveCopy}</Button>
              <Button onClick={onClose}>{L.cancel}</Button>
            </>
          ) : (
            <>
              <div className="sh-made" role="status" aria-live="polite" id={readyId}>
                <div className="sh-made-line">
                  <h3 className="kit-heading sh-made-title" tabIndex={-1} ref={ready}><KitIcon name="check" size={20} />{L.copyReady}</h3>
                  <p className="sh-size">{sizeLine(made.bytes)}</p>
                </div>
                <p className="kit-hint">{H.nothingWritten}</p>
              </div>
              <div className="sh-foot-actions">
                <Button variant="primary" onClick={onClose}>{L.done}</Button>
                <Button onClick={onOpenFile}>{L.openFile}</Button>
              </div>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
