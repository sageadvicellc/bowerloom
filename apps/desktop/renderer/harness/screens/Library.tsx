/**
 * S5, the Library: every agent, skill, tool and piece of context that was found, one kind at a time, with the count of each kind in its tab. A search box and a sort menu narrow and order the list.
 * Picking a row fills the details column: its file, "View file", "Add to a harness" (pick a harness), and the harnesses that use it. "Add to a harness" asks which harness, then adds the part to it.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { PART_KINDS } from '../../../shared/harness/types.js';
import type { HarnessState, Part, PartKind } from '../../../shared/harness/types.js';
import { harnessesHolding, libraryCounts, usedInWords } from '../../../shared/harness/status.js';
import { DetailsHead, Screen } from '../Screen.js';
import { go } from '../router.js';
import { useHarnessState, useHarnessStore } from '../session.js';
import { useUi } from '../ui.js';
import { SortMenu } from '../../home/kit/SortMenu.js';
import { Sheet } from '../parts/Sheet.js';
import { Button } from '../../home/kit/Button.js';
import { HButton, HIconButton, StateDot } from '../parts/controls.js';
import { HIcon, KIND_ICON, Tile } from '../icons.js';
import { KIND_PLURAL, WORDS, addTo, fromWords, notYetWords } from '../words.js';
import { PathDisclosure } from '../parts/PathDisclosure.js';
import { fileNameOf } from '../../../shared/harness/frontmatter.js';
import { nothingChanged } from '../words-flow.js';
import { undoNow } from '../undo-note.js';

type SortMode = 'name' | 'used' | 'source';
const SORTS = [{ mode: 'name', label: 'Name' }, { mode: 'used', label: 'Most used' }, { mode: 'source', label: 'Source' }] as const satisfies readonly { mode: SortMode; label: string }[];

function sorted(state: HarnessState, parts: readonly Part[], mode: SortMode): Part[] {
  const used = (p: Part): number => harnessesHolding(state, p.id).length;
  const byName = (a: Part, b: Part): number => a.name.localeCompare(b.name);
  return [...parts].sort((a, b) => (mode === 'used' ? used(b) - used(a) || byName(a, b) : mode === 'source' ? a.source.localeCompare(b.source) || byName(a, b) : byName(a, b)));
}

function Row({ state, part, selected, onPick }: { state: HarnessState; part: Part; selected: boolean; onPick(): void }): ReactElement {
  const n = harnessesHolding(state, part.id).length;
  return (
    <li className="hx-row hx-row-part" data-selected={selected ? '' : undefined} data-part={part.id}>
      <Tile name={KIND_ICON[part.kind]} />
      <div className="hx-row-text">
        <button type="button" className="hx-row-main" aria-pressed={selected} onClick={onPick}>{part.name}</button>
        <span className="hx-row-meta">{part.description}</span>
      </div>
      <div className="hx-row-side">
        <StateDot tone={n === 0 ? 'quiet' : 'good'}>{usedInWords(n)}</StateDot>
        <span className="hx-row-source">{part.source}</span>
      </div>
    </li>
  );
}

function Details({ state, part, onAdd }: { state: HarnessState; part: Part; onAdd(): void }): ReactElement {
  const held = harnessesHolding(state, part.id);
  return (
    <>
      <DetailsHead tile={<Tile name={KIND_ICON[part.kind]} size="large" />} title={part.name} subtitle={fromWords(part.kind, part.source, part.version)} />
      <p className="hx-text">{part.description}</p>
      <section className="hx-block" aria-labelledby="hx-lib-file">
        <h3 className="hx-h3" id="hx-lib-file">{WORDS.label.file}</h3>
        <p className="hx-text hx-muted">{fileNameOf(part.path)}</p>
        <PathDisclosure path={part.path} subject={part.name} key={part.id} />
      </section>
      <div className="hx-actions">
        <HButton icon="eye" onClick={() => go({ name: 'file', partId: part.id })}>{WORDS.label.viewFile}</HButton>
        <HButton icon="harness" variant="primary" onClick={onAdd}>{WORDS.label.addToHarness}</HButton>
      </div>
      <section className="hx-block" aria-labelledby="hx-lib-used">
        <h3 className="hx-h3" id="hx-lib-used">{WORDS.label.usedIn}</h3>
        {held.length === 0 ? <p className="hx-text hx-muted">{WORDS.hint.noneUsed}</p> : (
          <ul className="hx-box-list">
            {held.map(h => <li key={h.id} className="hx-box hx-box-press"><Tile name="harness" size="small" /><button type="button" className="hx-box-main" onClick={() => go({ name: 'harnesses', id: h.id })}>{h.name}</button></li>)}
          </ul>
        )}
      </section>
    </>
  );
}

/** "Add to a harness": which harness gets the part. A harness that holds it already is not offered. */
function PickHarnessSheet({ open, part, onClose }: { open: boolean; part: Part | null; onClose(): void }): ReactElement | null {
  const state = useHarnessState(), store = useHarnessStore(), ui = useUi();
  const add = (harnessId: string, harnessName: string): void => {
    if (part === null) return;
    const before = store.getState().history.length;
    store.addPart(harnessId, part.id);
    const entry = store.getState().history[0];
    onClose();
    if (store.getState().history.length > before && entry !== undefined) ui.showToast(`Added ${part.name} to ${harnessName}.`, { label: WORDS.label.undo, run: () => undoNow(store, ui, entry.id) });
    else ui.showToast(nothingChanged('it is in that harness already'));
  };
  return (
    <Sheet open={open} title={WORDS.label.pickHarness} onClose={onClose} width={520} dataSlot="pick-harness" note={WORDS.hint.libraryAddHint} actions={<Button onClick={onClose}>{WORDS.label.cancel}</Button>}>
      <ul className="hx-pick">
        {state.harnesses.map(h => {
          const holds = part !== null && h.partIds.includes(part.id);
          return (
            <li key={h.id} className="hx-pick-row">
              <Tile name="harness" />
              <span className="hx-pick-name">{h.name}</span>
              {holds ? <span className="hx-muted">{WORDS.hint.alreadyIn}</span> : <HButton size="small" aria-label={addTo(h.name)} onClick={() => add(h.id, h.name)}>{WORDS.label.add}</HButton>}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

export function Library({ kind, partId }: { kind: PartKind; partId: string | null }): ReactElement {
  const state = useHarnessState(), ui = useUi();
  const notYet = notYetWords(state.real !== undefined);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SortMode>('name');
  const [picking, setPicking] = useState<{ open: boolean; part: Part | null }>({ open: false, part: null });
  const counts = libraryCounts(state);
  const needle = query.trim().toLowerCase();
  const rows = sorted(state, state.parts.filter(p => p.inLibrary && p.kind === kind && (needle === '' || `${p.name} ${p.description}`.toLowerCase().includes(needle))), mode);
  const selected = rows.find(p => p.id === partId) ?? rows[0];
  const open = (next: PartKind): void => go({ name: 'library', kind: next });
  if (partId !== null && !state.parts.some(p => p.id === partId && p.inLibrary)) {
    return (
      <Screen slot="library" title={WORDS.label.library}>
        <p className="kit-hint hx-hint">{WORDS.hint.noPart}</p>
        <div className="hx-actions"><HButton onClick={() => open(kind)}>{WORDS.label.library}</HButton></div>
      </Screen>
    );
  }
  return (
    <Screen slot="library" title={WORDS.label.library}
      tools={<HIconButton icon="plus" label={WORDS.label.add} tip={notYet} side="below-end" aria-disabled="true" onClick={e => { e.preventDefault(); ui.showToast(notYet); }} />}
      details={selected === undefined ? undefined : <Details state={state} part={selected} onAdd={() => setPicking({ open: true, part: selected })} />}>
      <div className="hx-tabs" role="group" aria-label={WORDS.label.libraryPages}>
        {PART_KINDS.map(k => <button key={k} type="button" className="hx-tab" aria-pressed={k === kind} onClick={() => open(k)}>{KIND_PLURAL[k]} <span className="hx-tab-count">{counts[k]}</span></button>)}
      </div>
      <div className="hx-searchrow">
        <label className="hx-search">
          <HIcon name="search" size={18} />
          <input type="search" value={query} placeholder={WORDS.label.search2} aria-label={WORDS.label.search2} onChange={e => setQuery(e.target.value)} />
        </label>
        <SortMenu<SortMode> mode={mode} choices={SORTS} onChange={setMode} label={WORDS.label.sort} menuLabel={WORDS.label.sortGroup} />
      </div>
      <ul className="hx-rows" aria-label={KIND_PLURAL[kind]}>
        {rows.map(p => <Row key={p.id} state={state} part={p} selected={selected?.id === p.id} onPick={() => go({ name: 'library', kind, partId: p.id })} />)}
      </ul>
      {rows.length === 0 ? <p className="kit-hint hx-hint">{WORDS.hint.libraryEmpty}</p> : null}
      <PickHarnessSheet open={picking.open} part={picking.part} onClose={() => setPicking(current => ({ ...current, open: false }))} />
    </Screen>
  );
}
