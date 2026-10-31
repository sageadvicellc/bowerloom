/**
 * "Add part" opens the Library as a drawer at the right of the builder. It lists the Library parts that the harness does not hold yet, one kind at a time, with a search box.
 * "Add" puts a part in the harness (`store.addPart`) and the row leaves the list; the focus moves to the next "Add". The drawer is not modal; Escape or Close shuts it and the focus goes back to the button that opened it.
 */
import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { PART_KINDS } from '../../../../shared/harness/types.js';
import type { Harness, HarnessState, PartKind } from '../../../../shared/harness/types.js';
import { Drawer } from '../../../home/kit/Drawer.js';
import { HIcon, KIND_ICON, Tile } from '../../icons.js';
import { HButton } from '../../parts/controls.js';
import { KIND_PLURAL, WORDS, addToWords } from '../../words.js';

export interface AddPartDrawerProps { open: boolean; state: HarnessState; harness: Harness; initialKind: PartKind; onAdd(partId: string): void; onClose(): void; returnTo(): HTMLElement | null }

export function AddPartDrawer({ open, state, harness, initialKind, onAdd, onClose, returnTo }: AddPartDrawerProps): ReactElement | null {
  const [kind, setKind] = useState<PartKind>(initialKind);
  const [query, setQuery] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const free = state.parts.filter(p => p.inLibrary && !harness.partIds.includes(p.id));
  const needle = query.trim().toLowerCase();
  const rows = free.filter(p => p.kind === kind && (needle === '' || p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle)));
  const add = (partId: string, at: number): void => {
    onAdd(partId);
    // The row is gone after this pass; the focus goes to the "Add" that takes its place, or to the box above the list.
    requestAnimationFrame(() => { const buttons = list.current?.querySelectorAll<HTMLElement>('[data-add]'); (buttons?.[Math.min(at, Math.max(0, buttons.length - 1))] ?? document.querySelector<HTMLElement>('.kit-drawer input'))?.focus(); });
  };
  return (
    <Drawer open={open} title={WORDS.label.addPartTitle} onClose={onClose} dataSlot="add-part" returnTo={returnTo}>
      <div className="hx-tabs" role="group" aria-label={WORDS.label.library}>
        {PART_KINDS.map(k => (
          <button key={k} type="button" className="hx-tab" aria-pressed={k === kind} onClick={() => setKind(k)}>{KIND_PLURAL[k]} <span className="hx-tab-count">{free.filter(p => p.kind === k).length}</span></button>
        ))}
      </div>
      <label className="hx-search">
        <HIcon name="search" size={18} />
        <input type="search" value={query} placeholder={WORDS.label.search2} aria-label={WORDS.label.search2} onChange={e => setQuery(e.target.value)} />
      </label>
      <ul className="hx-drows" ref={list}>
        {rows.map((p, i) => (
          <li key={p.id} className="hx-drow" data-part={p.id}>
            <Tile name={KIND_ICON[p.kind]} />
            <span className="hx-drow-text"><span className="hx-drow-name">{p.name}</span><span className="hx-drow-sum">{p.summary}</span></span>
            <HButton size="small" data-add="" aria-label={addToWords(p.name, harness.name)} onClick={() => add(p.id, i)}>{WORDS.label.add}</HButton>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p className="hx-text hx-muted">{free.some(p => p.kind === kind) ? WORDS.hint.noMatch : WORDS.hint.nothingToAdd}</p> : null}
    </Drawer>
  );
}
