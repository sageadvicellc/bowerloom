/**
 * "Pick by hand": open one topic, search its notes by name, and tick single notes. A plain list with tick boxes, no graph. A note that its topic already
 * includes shows ticked and cannot be changed here (it says why), so a tick always means one more note for the agent.
 * The list is one stop in the Tab order: the arrow keys, Home and End move between the tick boxes (Space ticks), so a keyboard user does not tab through
 * 140 boxes to leave it.
 */
import { useMemo, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { topicCount } from '../../../shared/home/notes-model.js';
import type { Basis, Selection } from '../../../shared/home/notes-model.js';
import { partOf, topicOf } from '../../../shared/home/notes-topics.js';
import type { Topic } from '../../../shared/home/notes-topics.js';
import { NOTES_WORDS, pickedByHand, topicTab } from './notes-words.js';

const L = NOTES_WORDS.label, H = NOTES_WORDS.hint;

export interface HandPickerProps {
  basis: Basis;
  selection: Selection;
  topicId: string;
  onTopic(id: string): void;
  onTick(id: string): void;
}

const same = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

export function HandPicker({ basis, selection, topicId, onTopic, onTick }: HandPickerProps): ReactElement {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState('');
  const topic = basis.topics.find(t => t.id === topicId) ?? basis.topics[0];
  const on = topic !== undefined && selection.on.includes(topic.id);
  const rows = useMemo(() => {
    if (topic === undefined) return [];
    const words = query.trim().toLowerCase().split(/\s+/).filter(w => w !== '');
    const order = new Map(topic.parts.map((p, i) => [p.folder, i] as const));
    return basis.pages
      .filter(p => topicOf(basis.topics, p) === topic)
      .map(p => { const place = partOf(topic, p); return { id: p.id, title: basis.titles.get(p.id) ?? p.title, place, order: order.get(place?.folder ?? '') ?? 0, locked: place !== undefined && on && !selection.leftOut.includes(place.folder) }; })
      .filter(r => words.every(w => `${r.title} ${r.place?.name ?? ''}`.toLowerCase().includes(w)))
      .sort((a, b) => a.order - b.order || same(a.title, b.title));
  }, [basis, topic, query, on, selection.leftOut]);
  if (topic === undefined) return <p className="kit-hint">{H.nothingPicked}</p>;
  const firstOpen = rows.find(r => !r.locked)?.id;
  const stop = rows.some(r => r.id === cursor && !r.locked) ? cursor : firstOpen;
  const move = (e: KeyboardEvent<HTMLUListElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const boxes = [...e.currentTarget.querySelectorAll<HTMLInputElement>('input:not(:disabled)')], at = boxes.findIndex(b => b === document.activeElement);
    if (at < 0) return;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? boxes.length - 1 : Math.max(0, Math.min(boxes.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
    e.preventDefault();
    boxes[to]?.focus();
  };
  const owner = new Map(basis.pages.map(p => [p.id, topicOf(basis.topics, p)] as const));
  const picks = (t: Topic): number => selection.hand.filter(id => owner.get(id) === t).length;
  return (
    <div className="nt-hand">
      <div className="nt-pills" role="group" aria-label={L.pickTopic}>
        {basis.topics.map(t => (
          <button key={t.id} type="button" className="nt-pill" aria-pressed={t.id === topic.id} data-topic={t.id} onClick={() => { onTopic(t.id); setQuery(''); }}>{topicTab(t.name, picks(t))}</button>
        ))}
      </div>
      <input type="search" className="nt-search" aria-label={L.search} placeholder={L.search} value={query} onChange={e => setQuery(e.target.value)} />
      <p className="kit-hint" role="status">{pickedByHand(selection.hand.length)}</p>
      {rows.length === 0 ? <p className="kit-hint">{H.noMatch}</p> : (
        <ul className="nt-rows" aria-label={topic.name} data-count={topicCount(selection, topic)} onKeyDown={move}>
          {rows.map(r => {
            const locked = r.locked, ticked = locked || selection.hand.includes(r.id);
            return (
              <li key={r.id}>
                <label className="nt-row" data-locked={locked ? '' : undefined}>
                  <input type="checkbox" checked={ticked} disabled={locked} tabIndex={r.id === stop ? 0 : -1} onFocus={() => setCursor(r.id)} onChange={() => onTick(r.id)} />
                  <span className="nt-row-text">
                    <span className="nt-row-title">{r.title}</span>
                    {locked ? <span className="kit-hint">{H.alreadyIn}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
