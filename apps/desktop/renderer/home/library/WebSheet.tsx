/**
 * "Add from the web": a sheet over the whole window, like Choose notes. The preview has no network, so it says so first, in plain words: only sample sources
 * open and nothing is downloaded. The first view has a field ("Paste a link") and three "Starter sources". Opening a source, or pasting the link of one, shows
 * what it holds grouped by kind: each item with its name, hint, who made it, its release tag, what it can reach, whether it runs code or needs a key, a look at
 * its full text, and a tick box (ticked unless the item runs code). A banner says "From the web. Read it before you add it." and "Add 7 items" stages them in
 * the library, on no agent. A link that is not https://github.com/<owner>/<repo> is not a link to a collection; a well-formed one that is not a sample source
 * cannot be opened here. A link is only compared with the sample addresses: it is never fetched, never made into a link on the page, and never used as markup.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { planAdd } from '../../../shared/home/library-actions.js';
import {
  SAMPLE_SOURCES, abilityOfItem, addressOf, defaultTicked, groupedItems, kindCounts, needsKeyOf, openLink, reachOfItem, runsCodeOf,
} from '../../../shared/home/library-sources.js';
import type { SampleSource, SourceItem } from '../../../shared/home/library-sources.js';
import type { StoreAction } from '../../../shared/proto/store.js';
import { useProtoStore } from '../../proto/session.js';
import { Button } from '../kit/Button.js';
import { Drawer } from '../kit/Drawer.js';
import { Glyph } from '../kit/Glyph.js';
import { HelpPopover } from '../kit/HelpPopover.js';
import { KitIcon } from '../kit/icons.js';
import { ACCESS_WORDS } from '../../../shared/home/plain-details.js';
import { LIBRARY_WORDS, addItems, alreadyHere, groupHeading, madeByLine, openSource, sourceCounts, tickName, willBeCopies } from './library-words.js';
import './library.css';

const L = LIBRARY_WORDS.label, H = LIBRARY_WORDS.hint;

export interface WebSheetProps {
  open: boolean;
  onClose(): void;
  /** Called once with the action that was staged and how many items it adds, before the sheet closes. */
  onAdded(info: { readonly count: number; readonly firstKind: SourceItem['kind'] }): void;
  /** Where the focus goes when the sheet closes and the button that opened it is gone. */
  returnTo?(): HTMLElement | null;
}

type Problem = 'empty' | 'bad' | 'unknown' | null;
const PROBLEM: Readonly<Record<Exclude<Problem, null>, string>> = Object.freeze({ empty: H.emptyLink, bad: H.badLink, unknown: H.unknownLink });

export function WebSheet({ open, onClose, onAdded, returnTo }: WebSheetProps): ReactElement {
  return (
    <div className="lb-layer" data-web-layer="">
      <Drawer open={open} title={L.webTitle} onClose={onClose} dataSlot="web" {...(returnTo === undefined ? {} : { returnTo })}>
        <WebBody onClose={onClose} onAdded={onAdded} />
      </Drawer>
    </div>
  );
}

type View = { readonly kind: 'start' } | { readonly kind: 'source'; readonly source: SampleSource };

function WebBody({ onClose, onAdded }: { onClose(): void; onAdded: WebSheetProps['onAdded'] }): ReactElement {
  const { state, dispatch } = useProtoStore();
  const [view, setView] = useState<View>({ kind: 'start' });
  const [link, setLink] = useState('');
  const [problem, setProblem] = useState<Problem>(null);
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const field = useRef<HTMLInputElement>(null), sourceHeading = useRef<HTMLHeadingElement>(null), startHeading = useRef<HTMLHeadingElement>(null), moved = useRef(false);
  const fieldId = useId(), problemId = useId(), startId = useId();

  const source = view.kind === 'source' ? view.source : null;
  const plan = useMemo(() => (source === null ? null : planAdd(state.draft, source, ticked)), [state.draft, source, ticked]);

  // After the view changes the focus goes to the new heading, so a keyboard user is not left on a button that has gone.
  useEffect(() => {
    if (!moved.current) return;
    if (view.kind === 'source') sourceHeading.current?.focus(); else field.current?.focus();
  }, [view]);

  const show = (next: SampleSource): void => { moved.current = true; setProblem(null); setTicked(defaultTicked(next)); setView({ kind: 'source', source: next }); };
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const found = openLink(link);
    if (found.kind === 'source') { show(found.source); return; }
    setProblem(found.kind);
  };
  const toggle = (slug: string): void => setTicked(current => (current.includes(slug) ? current.filter(s => s !== slug) : [...current, slug]));
  const add = (): void => {
    if (plan === null || plan.action === null) return;
    const action: StoreAction = plan.action;
    dispatch(action);
    onAdded({ count: plan.adds.length, firstKind: plan.adds[0]!.kind });
    onClose();
  };

  return (
    <div className="lb-web">
      <p className="lb-honest" data-honest=""><KitIcon name="info" size={20} /><span>{H.honest}</span><HelpPopover label={L.aboutSample} text={LIBRARY_WORDS.popover.sample} /></p>
      <div className="lb-web-body">
        {view.kind === 'start' ? (
          <>
            <form className="lb-section" onSubmit={submit} noValidate>
              <label className="kit-heading" htmlFor={fieldId}>{L.pasteLink}</label>
              <div className="lb-field-row">
                <input id={fieldId} ref={field} className="lb-search" type="text" inputMode="url" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  value={link} aria-invalid={problem === 'bad' || problem === 'empty' ? true : undefined} aria-describedby={problem === null ? undefined : problemId}
                  onChange={e => { setLink(e.target.value); setProblem(null); }} />
                <Button type="submit" variant="primary">{L.openLink}</Button>
              </div>
              <p className="kit-hint">{H.linkExample}</p>
              <p className="lb-problem" id={problemId} role="alert" data-problem={problem ?? undefined}>{problem === null ? '' : PROBLEM[problem]}</p>
            </form>
            <section className="lb-section" aria-labelledby={startId} data-starter="">
              <h3 className="kit-heading" id={startId} tabIndex={-1} ref={startHeading}>{L.starterSources}</h3>
              <ul className="lb-sources">
                {SAMPLE_SOURCES.map(src => <SourceRow key={src.id} source={src} onOpen={() => show(src)} />)}
              </ul>
            </section>
          </>
        ) : (
          <SourceView source={view.source} ticked={ticked} onToggle={toggle} headingRef={sourceHeading} onBack={() => { moved.current = true; setView({ kind: 'start' }); }} />
        )}
      </div>
      {view.kind === 'source' && plan !== null ? (
        <div className="lb-web-foot">
          <div className="lb-summary" role="status">
            <p className="kit-hint">{ticked.length === 0 ? H.pickOne : plan.adds.length === 0 ? H.nothingToAdd : H.tickTip}</p>
            {plan.same.length > 0 && plan.adds.length > 0 ? <p className="kit-hint">{alreadyHere(plan.same.length)}</p> : null}
            {plan.copies.length > 0 ? <p className="kit-hint">{willBeCopies(plan.copies.length)}</p> : null}
          </div>
          <Button onClick={onClose}>{L.cancel}</Button>
          <Button variant="primary" disabled={plan.adds.length === 0} onClick={add}>{addItems(plan.adds.length)}</Button>
        </div>
      ) : <div />}
    </div>
  );
}

function SourceRow({ source, onOpen }: { source: SampleSource; onOpen(): void }): ReactElement {
  const nameId = useId();
  return (
    <li className="lb-source" data-source={source.id}>
      <Glyph name="leaf" />
      <div className="lb-source-text">
        <p className="lb-source-name" id={nameId}>{source.name}</p>
        <p className="kit-hint">{source.blurb}</p>
        <p className="kit-hint">{sourceCounts(kindCounts(source))}</p>
      </div>
      <Button aria-label={openSource(source.name)} onClick={onOpen}>{L.open}</Button>
    </li>
  );
}

function SourceView({ source, ticked, onToggle, headingRef, onBack }: { source: SampleSource; ticked: readonly string[]; onToggle(slug: string): void; headingRef: React.RefObject<HTMLHeadingElement | null>; onBack(): void }): ReactElement {
  return (
    <>
      <p className="lb-banner" data-banner=""><KitIcon name="warning" size={20} /><span>{H.fromWeb}</span></p>
      <div className="lb-source-head">
        <div className="lb-source-title">
          <h3 className="kit-heading" tabIndex={-1} ref={headingRef}>{source.name}</h3>
          <p className="kit-hint">{source.blurb}</p>
          <p className="kit-hint" data-address=""><span data-budget="content">{addressOf(source)}</span></p>
        </div>
        <Button icon="back" onClick={onBack}>{L.backToSources}</Button>
      </div>
      {groupedItems(source).map(group => (
        <section key={group.kind} className="lb-group" aria-labelledby={`lb-group-${group.kind}`} data-group={group.kind}>
          <h4 className="kit-heading" id={`lb-group-${group.kind}`}>{groupHeading(group.kind)}</h4>
          <ul className="lb-items">
            {group.items.map(item => <ItemRow key={item.slug} item={item} on={ticked.includes(item.slug)} onToggle={() => onToggle(item.slug)} />)}
          </ul>
        </section>
      ))}
    </>
  );
}

/** One fact about an item that needs care: an amber dot, its name (bold when `strong`), and one plain sentence. The words always say it, so the colour is never the only signal. */
function FlagLine({ id, strong, name, says }: { id: string; strong: boolean; name: string; says: string }): ReactElement {
  return (
    <p className="lb-flag" data-flag={id} data-strong={strong ? '' : undefined}>
      <span className="kit-dot lb-flag-dot" aria-hidden="true" />
      <span><span className="lb-flag-name">{name}</span>: {says}</span>
    </p>
  );
}

function ItemRow({ item, on, onToggle }: { item: SourceItem; on: boolean; onToggle(): void }): ReactElement {
  const [open, setOpen] = useState(false);
  const boxId = useId(), hintId = useId(), textId = useId();
  const reach = reachOfItem(item), ability = abilityOfItem(item);
  return (
    <li className="lb-item" data-item={item.slug} data-ticked={on ? '' : undefined}>
      <div className="lb-item-main">
        <input id={boxId} type="checkbox" checked={on} aria-describedby={hintId} onChange={onToggle} />
        <Glyph name={item.kind === 'tool' ? 'tool' : item.kind === 'agent' ? 'agent' : 'skill'} size="small" />
        <div className="lb-item-text">
          <label className="lb-item-name" htmlFor={boxId}>{tickName(item.name)}</label>
          <p className="kit-hint" id={hintId}>{item.hint}</p>
          <div className="lb-item-meta">
            <p className="kit-hint"><span data-budget="content" data-field="author">{madeByLine(item.author)}</span></p>
            <p className="kit-hint">{L.release} <span data-budget="content" data-field="release">{item.release}</span></p>
            {reach === null ? null : <p className="kit-hint" data-reach="">{reach}</p>}
            {ability === null || ability === ACCESS_WORDS['read-write'] ? null : <p className="kit-hint" data-ability="">{ability}</p>}
          </div>
          {/* A fact that needs care has weight: a bold name and an amber dot for what runs code and what can change things, the same dot and the normal weight for a key,
              and under each one plain sentence that says what it means. */}
          {runsCodeOf(item) || ability === ACCESS_WORDS['read-write'] || needsKeyOf(item) ? (
            <div className="lb-flags-list" data-flag-list="">
              {runsCodeOf(item) ? <FlagLine id="runs" strong name={L.runsCode} says={H.saysRunsCode} /> : null}
              {ability === ACCESS_WORDS['read-write'] ? <FlagLine id="changes" strong name={L.canChange} says={H.saysChanges} /> : null}
              {needsKeyOf(item) ? <FlagLine id="key" strong={false} name={L.needsKey} says={H.saysNeedsKey} /> : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="dt-full">
        <Button size="small" aria-expanded={open} aria-controls={textId} onClick={() => setOpen(o => !o)}>{open ? L.hideFullText : L.showFullText}</Button>
        {open ? <div className="dt-text" id={textId} role="region" aria-label={L.fullText} tabIndex={0} data-budget="content">{item.lines.map((line, i) => <p key={i}>{line}</p>)}</div> : null}
      </div>
    </li>
  );
}

