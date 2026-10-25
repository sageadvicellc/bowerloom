/**
 * The topics, as the kit's own toggle cards ordered by size, each with a thin bar that shows its size next to the biggest. A topic that is on shows a
 * "Leave out" row under its card: one button for each of its parts, pressed when that part is left out. "Kept from before" is one more card, shown only
 * when the agent already reads notes that were chosen another way.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { keptCount, topicCount } from '../../../shared/home/notes-model.js';
import type { Basis, Selection } from '../../../shared/home/notes-model.js';
import type { Topic } from '../../../shared/home/notes-topics.js';
import { KitIcon } from '../kit/icons.js';
import { ItemCard } from '../kit/ItemCard.js';
import { NOTES_WORDS, keptHint, leaveOutGroup, leaveOutOf, notesCount, partOfTopic } from './notes-words.js';

const L = NOTES_WORDS.label;

export interface TopicGridProps {
  basis: Basis;
  selection: Selection;
  onTopic(topic: Topic): void;
  onPart(topic: Topic, folder: string): void;
  onKeep(): void;
}

/**
 * The "Leave out" button under a topic that is on. It opens a small panel over the cards below it, with one button for each part of the topic, pressed when
 * that part is left out. The panel is not part of the page flow, so the cards never jump. Escape or a press elsewhere closes it, and the focus stays on the button.
 */
function LeaveOut({ topic, selection, onPart }: { topic: Topic; selection: Selection; onPart(topic: Topic, folder: string): void }): ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const out = topic.parts.filter(p => selection.leftOut.includes(p.folder)).length;
  useEffect(() => {
    if (!open) return undefined;
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    const away = (e: PointerEvent): void => { if (wrap.current !== null && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', away);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', away); };
  }, [open]);
  return (
    <div className="nt-leave" ref={wrap} data-open={open ? '' : undefined}>
      <button type="button" ref={trigger} className="nt-leave-button" aria-expanded={open} aria-controls={id} aria-label={leaveOutGroup(topic.name)} onClick={() => setOpen(o => !o)}>
        <span>{L.leaveOut}</span>
        {out > 0 ? <span className="nt-leave-n">{out}</span> : null}
        <KitIcon name="chevron" size={16} />
      </button>
      {open ? (
        <div className="nt-leave-panel" id={id} role="group" aria-label={leaveOutGroup(topic.name)}>
          <div className="nt-chips">
            {topic.parts.map(part => {
              const gone = selection.leftOut.includes(part.folder);
              return (
                <button key={part.folder} type="button" className="nt-chip" aria-pressed={gone} aria-label={leaveOutOf(part.name)} data-part={part.folder} onClick={() => onPart(topic, part.folder)}>
                  {gone ? <KitIcon name="close" size={16} /> : null}
                  <span className="nt-chip-name">{part.name}</span>
                  <span className="nt-chip-count">{part.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TopicGrid({ basis, selection, onTopic, onPart, onKeep }: TopicGridProps): ReactElement {
  const biggest = Math.max(1, ...basis.topics.map(t => t.count));
  const kept = keptCount(selection, basis);
  const hasKept = basis.other.types.length + basis.other.tags.length > 0 || basis.other.hops !== null;
  return (
    <ul className="nt-topics" aria-label={L.topics}>
      {hasKept ? (
        <li className="nt-topic" data-topic="kept">
          <ItemCard kind="note" name={L.keptBefore} hint={keptHint(kept)} selected={selection.keepOther} onSelect={onKeep} />
        </li>
      ) : null}
      {basis.topics.map(topic => {
        const on = selection.on.includes(topic.id), shown = topicCount(selection, topic);
        return (
          <li key={topic.id} className="nt-topic" data-topic={topic.id} data-on={on ? '' : undefined}>
            <ItemCard kind="note" name={topic.name} hint={shown === topic.count ? notesCount(topic.count) : partOfTopic(shown, topic.count)} selected={on} onSelect={() => onTopic(topic)} />
            <meter className="nt-size" aria-hidden="true" min={0} max={biggest} value={topic.count} />
            {topic.parts.length > 1 ? (on ? <LeaveOut topic={topic} selection={selection} onPart={onPart} /> : <div className="nt-leave nt-leave-reserved" aria-hidden="true" />) : null}
          </li>
        );
      })}
    </ul>
  );
}
