/**
 * The panels of the Knowledge screen: the preview, the two ways to pick (on the graph, and a rule builder), the page list, and the slice actions.
 * Every panel gets plain data and sends plain actions; the screen owns the state. The rule is always shown in plain words.
 */
import { useEffect, useId, useMemo, useRef } from 'react';
import type { ReactElement, RefObject } from 'react';
import { explainInference, inferRule } from '../../shared/proto/slice-infer.js';
import type { Handle, Inference } from '../../shared/proto/slice-infer.js';
import { badgeFor, frozenSentence, tokenGloss, tokenSentence } from '../../shared/proto/slice-preview.js';
import type { Preview } from '../../shared/proto/slice-preview.js';
import { buildFolderTree, facetCounts, folderState, pagesInFolder, pagesWithTag } from '../../shared/proto/slice-tree.js';
import type { FolderNode } from '../../shared/proto/slice-tree.js';
import type { KnowledgeAction, KnowledgeState } from '../../shared/proto/knowledge-state.js';
import { describeRule } from '../../shared/proto/slicerule.js';
import type { AgentItem, InterfaceInfo, Slice, WikiPage } from '../../shared/proto/types.js';
import { plural } from '../../shared/words.js';
import { DomainMark } from './knowledge-mark.js';

export type Send = (action: KnowledgeAction) => void;

/** The rule in plain words, with the folders' page counts. */
export function RuleWords({ state, pages }: { state: KnowledgeState; pages: readonly WikiPage[] }): ReactElement {
  return <p className="kn-rule">{describeRule(state.rule, pages)}</p>;
}

// ---------------------------------------------------------------------------------------------------- preview

export interface PreviewPanelProps {
  readonly state: KnowledgeState;
  readonly pages: readonly WikiPage[];
  readonly preview: Preview;
  readonly interfaces: readonly InterfaceInfo[];
  readonly saved: Slice | null;
  /** The pages the rule picks today, for a frozen slice to compare with. */
  readonly liveCount: number;
}

/** The point of the screen: what the slice holds, how big it is, what leaves it, and what each interface does with it. */
export function PreviewPanel({ state, pages, preview, interfaces, saved, liveCount }: PreviewPanelProps): ReactElement {
  const id = useId();
  const frozen = saved !== null && saved.pinned && saved.pinnedPageIds !== undefined;
  const joined = frozen ? 0 : preview.joined;
  return (
    <section className="kn-preview" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Preview</h2>
      <p className="kn-count" aria-live="polite" aria-atomic="true">
        <span className="kn-count-number" data-testid="slice-count">{preview.count}</span>{' '}
        <span>{preview.count === 1 ? 'page is' : 'pages are'} in this slice</span>
      </p>
      {frozen ? <p className="kn-frozen">{frozenSentence(preview.count, liveCount)}</p> : null}
      {preview.count === 0 ? <p className="muted">No pages are in this slice yet. Pick pages on the graph, or build a rule.</p> : null}
      <h3>The rule in plain words</h3>
      <p className="kn-rule" data-testid="rule-words">{describeRule(state.rule, pages)}</p>
      <h3>How big it is</h3>
      <p>The pages add up to {tokenGloss(preview.tokens)}</p>
      <p>The agent gets a map of {plural(preview.count, 'page')}: a title and one line for each. The map alone is {tokenSentence(preview.mapTokens)}</p>
      <p>{joined === 1 ? '1 page' : `${joined} pages`} joined since your last visit.</p>
      <h3>Links that leave this slice</h3>
      <p>{preview.cutCount === 1 ? '1 link leaves' : `${preview.cutCount} links leave`} this slice. They are drawn as dashed lines on the graph.</p>
      {preview.topOutside.length > 0 ? (
        <>
          <p className="small muted">The outside pages that most links point to:</p>
          <ul className="kn-outside">
            {preview.topOutside.map(o => <li key={o.id}>{o.title} <span className="muted">({plural(o.links, 'link')})</span></li>)}
          </ul>
        </>
      ) : null}
      <h3>What each interface does</h3>
      <ul className="kn-badges">
        {interfaces.map(i => {
          const b = badgeFor(i);
          return (
            <li key={i.id}>
              <span className={`kn-badge ${b.enforcement === 'blocks reads' ? 'kn-blocks' : 'kn-advisory'}`}>{b.label}</span>
              <span className="small">{b.meaning}{b.installed ? '' : ' It is not installed on this computer.'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------- way A

/** The three choices for following links. A hop is one link followed from a page. */
export function HopsChoice({ hops, onChange }: { hops: 0 | 1 | 2; onChange: (h: 0 | 1 | 2) => void }): ReactElement {
  const name = useId();
  const options: { value: 0 | 1 | 2; label: string }[] = [
    { value: 0, label: 'No links' },
    { value: 1, label: '1 hop: add the pages that your picked pages have links to' },
    { value: 2, label: '2 hops: also add the pages those pages have links to' },
  ];
  return (
    <fieldset className="kn-fieldset">
      <legend>Links from your picked pages</legend>
      <p className="small muted">A hop is one link followed from a page.</p>
      {options.map(o => (
        <label key={o.value} className="kn-choice">
          <input type="radio" name={name} checked={hops === o.value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

const handleWords = (h: Handle): string => `${h.kind === 'tag' ? 'the tag' : 'the page type'} ${h.value}`;

export interface GraphWayProps {
  readonly state: KnowledgeState;
  readonly pages: readonly WikiPage[];
  readonly send: Send;
}

/** Gives each reason a key that is its place in the list plus its words. Two reasons can read the same (folders in different domains with the same last name), so the words alone are not a key. */
export function keyedLines(lines: readonly string[]): { key: string; text: string }[] {
  return lines.map((text, i) => ({ key: `${i}:${text}`, text }));
}

/** "Pick on the graph": the lasso, the picks, the rule the app inferred from them, and the offers. */
export function GraphWay({ state, pages, send }: GraphWayProps): ReactElement {
  const hops = state.rule.linksFromSeeds === null ? 0 : state.rule.linksFromSeeds.hops;
  const inferred: Inference | null = useMemo(() => (state.picks.length === 0 ? null : inferRule(state.picks, pages, { hops, accept: state.accepted })), [state.picks, state.accepted, hops, pages]);
  return (
    <div className="kn-way" id="kn-way-graph">
      <p>Turn the lasso on, then drag a loop around pages on the graph. The app writes a rule from the pages you pick. Hold Shift to add pages to your picks. Hold Alt to take pages out.</p>
      <p className="small muted">The lasso needs a pointer. Without one, use the page list below, or the Build a rule way. Both do the same job from the keyboard.</p>
      <p className="kn-picked" aria-live="polite">
        {state.picks.length === 0 ? 'No pages are picked yet. The rule below is the saved rule.' : `${plural(state.picks.length, 'page')} picked.`}{' '}
        {state.picks.length > 0 ? <button type="button" className="btn secondary kn-small" onClick={() => send({ type: 'clearPicks' })}>Clear picks</button> : null}
      </p>
      <h4>The rule the app wrote</h4>
      <RuleWords state={state} pages={pages} />
      {inferred !== null ? (
        <ul className="kn-why small">
          {keyedLines(explainInference(inferred)).map(l => <li key={l.key}>{l.text}</li>)}
        </ul>
      ) : null}
      {inferred !== null && state.accepted.map(h => (
        <p key={`${h.kind}:${h.value}`} className="small">
          Using all pages with {handleWords(h)}.{' '}
          <button type="button" className="btn secondary kn-small" onClick={() => send({ type: 'dropOffer', handle: h })}>Stop using {handleWords(h)}</button>
        </p>
      ))}
      {inferred !== null ? inferred.offers.map(o => (
        <p key={`${o.kind}:${o.value}`} className="small kn-offer">
          Most of your picked pages have {handleWords(o)} ({o.picked} of your picks; {plural(o.total, 'page')} in all). Use all {plural(o.total, 'page')} with it?{' '}
          <button type="button" className="btn secondary kn-small" onClick={() => send({ type: 'acceptOffer', handle: { kind: o.kind, value: o.value } })}>Use {handleWords(o)}</button>
        </p>
      )) : null}
      <HopsChoice hops={hops} onChange={h => send({ type: 'hops', hops: h })} />
      <p>
        <button type="button" className="btn secondary" onClick={() => send({ type: 'way', way: 'rule' })}>Change this rule by hand</button>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------- way B

function Check({ checked, indeterminate, disabled, label, onChange, folder }: { checked: boolean; indeterminate?: boolean; disabled?: boolean; label: ReactElement | string; onChange: () => void; folder?: string }): ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current !== null) ref.current.indeterminate = indeterminate === true; });
  return (
    <label className="kn-check">
      <input ref={ref} type="checkbox" checked={checked} disabled={disabled === true} onChange={onChange} {...(folder === undefined ? {} : { 'data-folder': folder })} />
      <span>{label}</span>
    </label>
  );
}

const count = (n: number): string => `(${plural(n, 'page')})`;

function DomainRow({ node, index, state, open, onOpen, send }: { node: FolderNode; index: number; state: KnowledgeState; open: boolean; onOpen: () => void; send: Send }): ReactElement {
  const st = folderState(state.rule, node.folder), id = useId();
  return (
    <li className="kn-domain">
      <div className="kn-domain-row">
        <Check checked={st === 'on'} indeterminate={st === 'partial'} folder={node.folder} onChange={() => send({ type: 'toggleFolder', folder: node.folder })}
          label={<><DomainMark index={index} />{node.name} <span className="muted">{count(node.count)}</span></>} />
        <button type="button" className="kn-disclose" aria-expanded={open} aria-controls={id} onClick={onOpen}>
          {open ? 'Hide' : 'Show'} the {plural(node.children.length, 'folder')} inside {node.name}
        </button>
      </div>
      {open ? (
        <ul className="kn-subfolders" id={id} role="group" aria-label={`Folders inside ${node.name}`}>
          {node.children.map(c => {
            const cs = folderState(state.rule, c.folder);
            return (
              <li key={c.folder}>
                <Check checked={cs === 'on' || cs === 'under'} disabled={cs === 'under'} folder={c.folder} onChange={() => send({ type: 'toggleFolder', folder: c.folder })}
                  label={<>{c.name} <span className="muted">{count(c.count)}</span>{cs === 'under' ? <span className="small muted"> (included by {node.name})</span> : null}</>} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export interface RuleBuilderProps {
  readonly state: KnowledgeState;
  readonly pages: readonly WikiPage[];
  readonly send: Send;
  readonly open: ReadonlySet<string>;
  readonly onOpen: (folder: string) => void;
}

/** "Build a rule": the three handles of spec 6.9 as a form. Every change reaches the count and the preview at once. */
export function RuleBuilder({ state, pages, send, open, onOpen }: RuleBuilderProps): ReactElement {
  const tree = useMemo(() => buildFolderTree(pages), [pages]);
  const facets = useMemo(() => facetCounts(pages), [pages]);
  const hops = state.rule.linksFromSeeds === null ? 0 : state.rule.linksFromSeeds.hops;
  const byId = useMemo(() => new Map(pages.map(p => [p.id, p] as const)), [pages]);
  const SHOWN = 30;
  return (
    <div className="kn-way" id="kn-way-rule">
      <p>A page joins the slice when any one of the three choices below picks it.</p>
      <RuleWords state={state} pages={pages} />
      <fieldset className="kn-fieldset">
        <legend>Folders</legend>
        <p className="small muted">Tick a folder to take every page in it, and in the folders inside it.</p>
        <ul className="kn-tree">
          {tree.map((n, i) => <DomainRow key={n.folder} node={n} index={i} state={state} open={open.has(n.folder) || folderState(state.rule, n.folder) === 'partial'} onOpen={() => onOpen(n.folder)} send={send} />)}
        </ul>
      </fieldset>
      <fieldset className="kn-fieldset">
        <legend>Page types</legend>
        <div className="kn-checks">
          {facets.types.map(t => <Check key={t.value} checked={state.rule.pageTypesAndTags.types.includes(t.value)} onChange={() => send({ type: 'toggleType', value: t.value })} label={<>{t.value} <span className="muted">{count(t.count)}</span></>} />)}
        </div>
      </fieldset>
      <fieldset className="kn-fieldset">
        <legend>Tags</legend>
        <div className="kn-checks">
          {facets.tags.map(t => <Check key={t.value} checked={state.rule.pageTypesAndTags.tags.includes(t.value)} onChange={() => send({ type: 'toggleTag', tag: t.value })} label={<>{t.value} <span className="muted">{count(t.count)}</span></>} />)}
        </div>
      </fieldset>
      <HopsChoice hops={hops} onChange={h => send({ type: 'hops', hops: h })} />
      <fieldset className="kn-fieldset">
        <legend>Picked pages</legend>
        <p className="small muted">Links are followed from these pages. They are always in the slice.</p>
        {state.seeds.length === 0 ? <p className="small">No pages are picked. Pick pages on the graph or in the page list.</p> : (
          <>
            <ul className="kn-seeds">
              {state.seeds.slice(0, SHOWN).map(id => {
                const p = byId.get(id);
                return p === undefined ? null : (
                  <li key={id}>{p.title}{' '}
                    <button type="button" className="btn secondary kn-small" aria-label={`Remove ${p.title} from the picked pages`} onClick={() => send({ type: 'removeSeed', id })}>Remove</button>
                  </li>
                );
              })}
            </ul>
            {state.seeds.length > SHOWN ? <p className="small muted">and {state.seeds.length - SHOWN} more.</p> : null}
            <button type="button" className="btn secondary kn-small" onClick={() => send({ type: 'clearSeeds' })}>Remove all picked pages</button>
          </>
        )}
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------- page list

/** The most rows the list draws. */
export const LIST_LIMIT = 200;

export interface PageListProps {
  readonly state: KnowledgeState;
  readonly pages: readonly WikiPage[];
  readonly lit: ReadonlySet<string>;
  readonly send: Send;
}

/** The list view: the same pages as the graph, for the keyboard and for a screen reader. Each row can be picked. */
export function PageList({ state, pages, lit, send }: PageListProps): ReactElement {
  const id = useId();
  const rows = useMemo(() => {
    const q = state.query.trim().toLowerCase();
    return pages.filter(p => (state.list === 'all' || lit.has(p.id)) && (q === '' || p.title.toLowerCase().includes(q) || p.id.includes(q) || p.tags.some(t => t.includes(q)) || p.folder.includes(q)));
  }, [pages, lit, state.list, state.query]);
  const picked = useMemo(() => new Set(state.way === 'rule' ? state.seeds : state.picks), [state.way, state.seeds, state.picks]);
  const focus = state.focusPage === null ? null : pages.find(p => p.id === state.focusPage) ?? null;
  return (
    <section className="kn-list" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Page list</h2>
      <p className="small muted">The same pages as the graph, as a list. Tick a page to pick it. The lasso is not needed.</p>
      <div className="kn-list-tools">
        <fieldset className="kn-fieldset kn-inline">
          <legend>Show</legend>
          <label className="kn-choice"><input type="radio" name={`${id}-show`} checked={state.list === 'slice'} onChange={() => send({ type: 'list', list: 'slice' })} /><span>Pages in this slice</span></label>
          <label className="kn-choice"><input type="radio" name={`${id}-show`} checked={state.list === 'all'} onChange={() => send({ type: 'list', list: 'all' })} /><span>All {pages.length} pages</span></label>
        </fieldset>
        <label className="kn-field">
          <span>Search the list</span>
          <input type="search" value={state.query} onChange={e => send({ type: 'query', query: e.target.value })} placeholder="A title, a tag, or a folder" />
        </label>
      </div>
      <p className="small" aria-live="polite">{rows.length === 0 ? 'No pages match.' : `${plural(rows.length, 'page')} in the list.`}</p>
      <ul className="kn-rows">
        {rows.slice(0, LIST_LIMIT).map(p => (
          <li key={p.id} className={lit.has(p.id) ? 'kn-row kn-row-lit' : 'kn-row'}>
            <label>
              <input type="checkbox" checked={picked.has(p.id)} aria-label={`Pick ${p.title}`} onChange={() => send({ type: 'togglePick', id: p.id })} onFocus={() => send({ type: 'focusPage', id: p.id })} />
              <span className="kn-row-title">{p.title}</span>
            </label>
            <span className="small muted">{p.folder}, {p.type}{p.tags.length > 0 ? `, ${p.tags.join(', ')}` : ''}{lit.has(p.id) ? ', in the slice' : ''}</span>
          </li>
        ))}
      </ul>
      {rows.length > LIST_LIMIT ? <p className="small muted">and {rows.length - LIST_LIMIT} more. Search to narrow the list.</p> : null}
      <div className="kn-page-actions">
        <h3>Pick more from one page</h3>
        {focus === null ? <p className="small muted">Choose a page in the list, or click one on the graph, to pick the pages in its folder or with its tags.</p> : (
          <>
            <p className="small">For <strong>{focus.title}</strong>:</p>
            <div className="kn-action-row">
              <button type="button" className="btn secondary" onClick={() => send({ type: 'pickFolder', folder: focus.folder })}>
                Select the pages in this folder ({pagesInFolder(pages, focus.folder).length})
              </button>
              {focus.tags.map(t => (
                <button key={t} type="button" className="btn secondary" onClick={() => send({ type: 'pickTag', tag: t })}>
                  Select pages with the tag {t} ({pagesWithTag(pages, t).length})
                </button>
              ))}
            </div>
            <p className="small muted">The folder is {focus.folder}.{focus.tags.length === 0 ? ' This page has no tags.' : ''} These buttons add to your picks in the Pick on the graph way.</p>
          </>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------- actions

export interface ActionsPanelProps {
  readonly state: KnowledgeState;
  readonly saved: Slice | null;
  readonly dirty: boolean;
  readonly seedsChanged: boolean;
  readonly agents: readonly AgentItem[];
  readonly slices: readonly Slice[];
  readonly livePages: number;
  readonly send: Send;
  readonly onSave: () => void;
  readonly onPin: () => void;
  readonly onUnpin: () => void;
  readonly onGive: (agentId: string) => void;
  readonly onTake: (agentId: string) => void;
  readonly agentChoice: string;
  readonly onAgentChoice: (id: string) => void;
  readonly saveRef: RefObject<HTMLButtonElement | null>;
}

/** Save, freeze, and give to an agent. A button that cannot act says why, in words, and the reason is read out. */
export function ActionsPanel(p: ActionsPanelProps): ReactElement {
  const id = useId();
  const { saved, state, dirty } = p;
  const pinned = saved !== null && saved.pinned;
  const holders = saved === null ? [] : p.agents.filter(a => a.definition.sliceId === saved.id);
  const nameNeeded = saved === null || p.seedsChanged;
  const nameMissing = nameNeeded && state.name.trim() === '';
  const nothing = saved === null && !dirty;
  const saveLabel = saved === null ? 'Save as a new slice' : p.seedsChanged ? 'Save as a new slice' : 'Save changes';
  const canSave = dirty && !nameMissing && !pinned;
  const otherName = (a: AgentItem): string => {
    const sid = a.definition.sliceId;
    const other = sid === undefined || sid === saved?.id ? undefined : p.slices.find(s => s.id === sid);
    return other === undefined ? a.name : `${a.name} (has ${other.name} now)`;
  };
  const giveOk = saved !== null && !dirty && p.agentChoice !== '';
  return (
    <section className="kn-actions" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Save, freeze, and give to an agent</h2>
      <p className="small muted">Changes you save here wait in the draft. Apply them on the Harness screen.</p>
      <h3>Save</h3>
      {nameNeeded ? (
        <label className="kn-field">
          <span>{saved === null ? 'Name of the new slice' : 'Name of the copy'}</span>
          <input type="text" value={state.name} onChange={e => p.send({ type: 'rename', name: e.target.value })} placeholder="For example, Reading pile" />
        </label>
      ) : null}
      {p.seedsChanged && saved !== null ? <p className="small muted">The picked pages of a saved slice cannot change in place. Save the new choice as a new slice.</p> : null}
      <div className="kn-action-row">
        <button ref={p.saveRef} type="button" className="btn" disabled={!canSave} onClick={p.onSave}>{saveLabel}</button>
        {saved !== null && dirty ? <button type="button" className="btn secondary" onClick={() => p.send({ type: 'reset', slice: saved })}>Undo my changes</button> : null}
      </div>
      <p className="small" role="status" aria-live="polite">
        {pinned && dirty ? 'This slice is frozen. Unfreeze it to change the rule.'
          : nothing ? 'Nothing to save yet.'
          : nameMissing ? 'Give the slice a name first.'
          : dirty ? 'There are changes to save.'
          : 'Everything is saved to the draft.'}
      </p>
      <h3>Freeze</h3>
      {saved === null ? <p className="small muted">Save the slice first. A frozen slice keeps the pages that were saved.</p> : pinned ? (
        <>
          <p className="kn-frozen">{frozenSentence(saved.pinnedPageIds?.length ?? 0, p.livePages)}</p>
          <button type="button" className="btn secondary" onClick={p.onUnpin}>Unfreeze, and follow the rule again</button>
        </>
      ) : (
        <>
          <p className="small muted">A frozen slice keeps its pages as they are now, even when new pages match the rule.</p>
          <button type="button" className="btn secondary" disabled={dirty} onClick={p.onPin}>Freeze at {plural(p.livePages, 'page')}</button>
          {dirty ? <p className="small" role="status">Save your changes first. Freezing keeps the saved pages.</p> : null}
        </>
      )}
      <h3>Give to an agent</h3>
      {saved === null ? <p className="small muted">Save the slice first. Then you can give it to an agent.</p> : (
        <>
          <label className="kn-field">
            <span>Agent</span>
            <select value={p.agentChoice} onChange={e => p.onAgentChoice(e.target.value)}>
              <option value="">Choose an agent</option>
              {p.agents.map(a => <option key={a.id} value={a.id}>{otherName(a)}</option>)}
            </select>
          </label>
          <button type="button" className="btn secondary" disabled={!giveOk} onClick={() => p.onGive(p.agentChoice)}>Give this slice to the agent</button>
          {dirty ? <p className="small" role="status">Save your changes first. An agent gets the saved slice.</p> : null}
          <p className="small" aria-live="polite" data-testid="holders">
            {holders.length === 0 ? 'No agent has this slice yet.' : `Agents that have this slice: ${holders.map(h => h.name).join(', ')}.`}
          </p>
          {holders.length > 0 ? (
            <ul className="kn-holders">
              {holders.map(h => <li key={h.id}>{h.name} <button type="button" className="btn secondary kn-small" aria-label={`Take this slice away from ${h.name}`} onClick={() => p.onTake(h.id)}>Take it away</button></li>)}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
