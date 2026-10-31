/**
 * The Share sheet: a small modal sheet, opened by the Share button of the top bar (and from the Share section of the Version history drawer). It says what a share
 * file holds as counts ("29 skills, 10 agents, 8 tools, 3 sets of notes"), what it leaves out ("Left out: 3 passwords and keys"), lets the person untick agents to leave them
 * out, and "Create share file" makes the file with the 0.7 bundle logic (shared/home/share-model.ts). "Look inside" lists every skill, agent, tool and set of notes that goes in,
 * by name, each with the text that travels with it behind "Show text". That text is checked for anything shaped like a key or a password (shared/home/share-look.ts); an
 * item that looks like it holds one says so, and starts unticked, so it is left out until the person looks and ticks it on purpose. The prototype writes nothing: the file is kept in
 * memory, the sheet says so, and the Add drawer's "From a shared file" tab can open it again. Secrets never travel: a tool that needs a key arrives asking for one.
 * It is a modal dialog like the "two different copies" dialog: the focus starts on its title and stays inside, the rest of the page is out of reach,
 * Escape (or the scrim) closes it and gives the focus back to the button that opened it. Render it at the top of the page. It shows the saved agents:
 * changes that wait for Save are not in the file, and the sheet says so. No file path is drawn.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import type { World } from '../../../shared/world/types.js';
import { agentCard, shelvesOf } from '../../../shared/home/cards.js';
import { plainNameOf } from '../../../shared/home/plain-names.js';
import { LOOK_KIND_WORDS, flaggedIds, lookItems } from '../../../shared/home/share-look.js';
import type { LookItem } from '../../../shared/home/share-look.js';
import { buildShare, canSave, planShare, shareableAgents, toggleLeftOut } from '../../../shared/home/share-model.js';
import { Button } from '../kit/Button.js';
import { IconButton } from '../kit/IconButton.js';
import { KitIcon } from '../kit/icons.js';
import { trapTab } from '../add/dom-helpers.js';
import { useModalLayer } from '../add/modal-layer.js';
import '../add/add.css';
import './share.css';
import { SHARE_WORDS, bringsLine, countsLine, flaggedLine, leftOutLine, sizeLine } from './share-words.js';

const L = SHARE_WORDS.label, H = SHARE_WORDS.hint;

export interface ShareSheetProps {
  /** The saved world: a share file holds what is saved. */
  world: World;
  /** The ids of agents that are off the map (their place was skipped in Find). They are not offered. */
  hidden: readonly string[];
  /** True when changes wait for Save. They are not in the file, and the sheet says so. */
  unsaved: boolean;
  /** True while the sheet fades out: it ignores the pointer and a key, and Escape goes on to the next layer. */
  leaving?: boolean;
  onClose(): void;
  /** Called with the text of the file when "Create share file" is pressed. */
  onCopy(text: string): void;
  /** Called when the person asks to open a shared file (the sheet closes first). */
  onOpenFile(): void;
}

/** One thing that goes in: a tick box, its name and kind, a plain warning when its text looks like it holds a key, and the text behind "Show text". */
function LookRow({ item, ticked, open, onTick, onToggle }: { item: LookItem; ticked: boolean; open: boolean; onTick(): void; onToggle(): void }): ReactElement {
  const nameId = useId(), textId = useId();
  return (
    <li className="sh-look-item" data-look={item.id} data-kind={item.kind} data-flagged={item.flagged ? '' : undefined}>
      <div className="sh-look-line">
        <label className="sh-look-row">
          <input type="checkbox" checked={ticked} onChange={onTick} aria-describedby={item.flagged ? `${nameId}-warn` : undefined} />
          <span className="sh-row-text"><span className="sh-row-name" id={nameId}>{item.name}</span><span className="kit-hint">{LOOK_KIND_WORDS[item.kind]}</span></span>
        </label>
        <Button size="small" aria-expanded={open} aria-controls={textId} aria-describedby={nameId} onClick={onToggle}>{open ? L.hideText : L.showText}</Button>
      </div>
      {item.flagged ? <p className="kit-status sh-warn" data-tone="warn" id={`${nameId}-warn`}><span className="kit-dot" aria-hidden="true" /><span>{H.looksLikeKey}</span></p> : null}
      {open ? (
        <div className="sh-text" id={textId} role="region" aria-label={L.textTravels} tabIndex={0} data-budget="content">
          {item.text === '' ? <p>{H.noText}</p> : item.text.split('\n').map((line, i) => (line === '' ? <br key={i} /> : <p key={i}>{line}</p>))}
        </div>
      ) : null}
    </li>
  );
}

export function ShareSheet({ world, hidden, unsaved, leaving = false, onClose, onCopy, onOpenFile }: ShareSheetProps): ReactElement {
  const titleId = useId(), readyId = useId(), listId = useId(), lookId = useId();
  const dialog = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null), ready = useRef<HTMLHeadingElement>(null);
  const agents = useMemo(() => shareableAgents(world, hidden), [world, hidden]);
  const offered = useMemo(() => agents.map(a => a.id), [agents]);
  // Everything that would go in if nothing were left out, with the check of its text. The sheet starts with the items that look like they hold a key left out.
  const nameOf = useMemo(() => plainNameOf(world), [world]);
  const inside = useMemo(() => lookItems(buildShare(world, offered), nameOf, world.wikiPages), [world, offered, nameOf]);
  const flagged = useMemo(() => flaggedIds(inside), [inside]);
  const [left, setLeft] = useState<readonly string[]>(flagged);
  const [made, setMade] = useState<{ readonly bytes: number } | null>(null);
  const [looking, setLooking] = useState(false);
  const [shown, setShown] = useState<readonly string[]>([]);
  // The agents are listed by the names a person sees, the way the map lists them.
  const rows = useMemo(() => agents.map(a => { const shelves = shelvesOf(world, a); return { id: a.id, name: agentCard(a).name, brings: bringsLine(shelves.skills.length, shelves.tools.length) }; }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), [world, agents]);
  const plan = useMemo(() => planShare(world, offered, left), [world, offered, left]);
  const stillIn = flagged.filter(id => !left.includes(id)).length;
  const latest = useRef(onClose), going = useRef(leaving);
  latest.current = onClose; going.current = leaving;

  // Focus goes to the title and the rest of the page goes inert. When the sheet leaves, the page is reachable again and the focus goes back to the button that opened
  // it, unless a layer that replaces this one ("Open a shared file") has taken the focus already (see add/modal-layer.ts).
  useModalLayer(dialog, heading, leaving);
  // A file that was made stops being "ready" the moment the choice changes, and the focus moves to the line that says it is ready.
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
  const toggleText = (id: string): void => setShown(current => toggleLeftOut(current, id));
  /** "Show what is in it": opens Look inside and takes the focus to its list, so what travels is read before the file is sent. */
  const showInside = (): void => {
    setLooking(true);
    requestAnimationFrame(() => { const list = document.getElementById(lookId); list?.scrollIntoView({ block: 'nearest' }); list?.focus({ preventScroll: true }); });
  };
  const save = (): void => { if (!canSave(plan)) return; onCopy(plan.text); setMade({ bytes: plan.bytes }); };
  const empty = !canSave(plan);

  return (
    <div className="add-scrim" data-leaving={leaving ? '' : undefined} onPointerDown={e => { if (e.target === e.currentTarget && !leaving) onClose(); }}>
      <div className="sh-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} data-share="" data-made={made === null ? undefined : ''} ref={dialog} onKeyDown={key}>
        <header className="sh-head">
          <div className="sh-title">
            <h2 className="kit-heading" id={titleId} tabIndex={-1} ref={heading}>{L.sheetTitle}</h2>
            <p className="kit-hint" data-file-is="">{H.fileIs}</p>
            <p className="kit-hint" data-where-saved="">{H.whereSaved}</p>
          </div>
          <IconButton icon="close" label={L.close} onClick={onClose} />
        </header>

        <section className="sh-summary" aria-labelledby={`${listId}-goes`}>
          <h3 className="kit-heading" id={`${listId}-goes`}>{L.goesIn}</h3>
          <div aria-live="polite" className="sh-live">
            <p className="sh-counts" data-empty={empty ? '' : undefined}>{empty ? H.nothingPicked : countsLine(plan.counts)}</p>
            <p className="sh-left">{leftOutLine(plan.keys, plan.leftOutAgents, plan.readyMade, plan.leftOutItems, plan.keyNames)}</p>
          </div>
          <div className="sh-secrets">
            <p className="kit-hint">{H.secretsOut}</p>
            <p className="kit-hint">{H.textIn}</p>
            <p className="kit-hint">{H.keysAsk}</p>
            {plan.readyMade > 0 ? <p className="kit-hint">{H.readyMadeOut}</p> : null}
          </div>
          {flagged.length > 0 ? <p className="kit-status sh-warn" data-tone="warn" data-flagged-line=""><span className="kit-dot" aria-hidden="true" /><span>{flaggedLine(flagged.length, stillIn)}</span></p> : null}
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
          {inside.length === 0 ? null : (
            <div className="sh-look">
              <div className="sh-look-head">
                <Button aria-expanded={looking} aria-controls={lookId} onClick={() => setLooking(o => !o)}>{L.lookInside}</Button>
                <p className="kit-hint">{H.lookTip}</p>
              </div>
              {looking ? (
                <ul className="sh-look-list" id={lookId} aria-label={L.lookInside} tabIndex={-1}>
                  {inside.map(item => <LookRow key={item.id} item={item} ticked={!left.includes(item.id)} open={shown.includes(item.id)} onTick={() => tick(item.id)} onToggle={() => toggleText(item.id)} />)}
                </ul>
              ) : null}
            </div>
          )}
        </div>

        <footer className="sh-foot">
          {made === null ? (
            <>
              <Button variant="primary" icon="check" disabled={empty} onClick={save}>{L.createFile}</Button>
              <Button onClick={onClose}>{L.cancel}</Button>
            </>
          ) : (
            <>
              <div className="sh-made" role="status" aria-live="polite" id={readyId}>
                <div className="sh-made-line">
                  <h3 className="kit-heading sh-made-title" tabIndex={-1} ref={ready}><KitIcon name="check" size={20} />{L.fileReady}</h3>
                  <p className="sh-size">{sizeLine(made.bytes)}</p>
                </div>
                <p className="kit-hint" data-where-saved="">{H.whereSaved}</p>
                <p className="kit-hint">{H.nothingWritten}</p>
                <span className="sh-show"><Button variant="text" aria-expanded={looking} aria-controls={lookId} onClick={showInside}>{L.showWhatIsIn}</Button></span>
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
