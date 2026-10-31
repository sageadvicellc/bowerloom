/**
 * S3, the Harness builder. Two views of one harness: the Graph and the List. The details column shows the part that is selected, in both. The top row has the view switch, a search, "Add part"
 * (the Library as a drawer), "Assign to project" (the install sheet) and "Start" (the start sheet). A harness with nothing in it shows the empty state.
 * Every change goes through the store, which adds a history entry, so every change can be undone from Version history; the note at the foot of the window also offers "Undo".
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { fixFor } from '../../../shared/harness/store.js';
import { harnessById, partsOf, partsWords } from '../../../shared/harness/status.js';
import type { BuilderView } from '../../../shared/harness/route.js';
import { Screen } from '../Screen.js';
import { go } from '../router.js';
import { useHarnessState, useHarnessStore } from '../session.js';
import { useUi } from '../ui.js';
import { changeWithUndo } from '../undo-note.js';
import { HButton, HIconButton } from '../parts/controls.js';
import { HIcon } from '../icons.js';
import { Graph } from './builder/Graph.js';
import { ListView } from './builder/ListView.js';
import { BuilderDetails } from './builder/BuilderDetails.js';
import { AddPartDrawer } from './builder/AddPartDrawer.js';
import { FixSheet } from './builder/FixSheet.js';
import { WORDS } from '../words.js';

export function Builder({ id, view }: { id: string; view: BuilderView }): ReactElement {
  const state = useHarnessState(), store = useHarnessStore(), ui = useUi();
  const harness = harnessById(state, id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [fix, setFix] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const addButton = useRef<HTMLButtonElement>(null);

  const matchIds = useMemo<ReadonlySet<string> | null>(() => {
    const needle = (query ?? '').trim().toLowerCase();
    if (harness === undefined || needle === '') return null;
    return new Set([...partsOf(state, harness).filter(p => `${p.name} ${p.summary}`.toLowerCase().includes(needle)).map(p => p.id), ...harness.missing.filter(m => m.name.toLowerCase().includes(needle)).map(m => m.id)]);
  }, [state, harness, query]);

  if (harness === undefined) {
    return (
      <Screen slot="builder" title={WORDS.label.harnesses}>
        <p className="kit-hint hx-hint">{WORDS.hint.noHarness}</p>
        <div className="hx-actions"><HButton onClick={() => go({ name: 'harnesses' })}>{WORDS.label.harnesses}</HButton></div>
      </Screen>
    );
  }

  /** Runs a change that adds a history entry, and offers "Undo" for it in a note. A change that did nothing says why in a note. */
  const withUndo = (say: string, change: () => string | null | void): void => changeWithUndo(store, ui, say, WORDS.label.undo, change);
  const empty = harness.partIds.length === 0 && harness.missing.length === 0;
  const openFix = (missingId: string): void => setFix({ open: true, id: missingId });
  const doFix = (missingId: string): void => {
    const target = fixFor(store.getState(), harness.id, missingId);
    withUndo(`Added ${target?.ref.name ?? 'the part'}.`, () => store.fixMissingPart(harness.id, missingId));
    if (target !== undefined) setSelectedId(target.partId);
    setFix(current => ({ ...current, open: false }));
  };
  const onLinkTarget = (partId: string): void => {
    const from = linkingId;
    setLinkingId(null);
    if (from === null) return;
    const names = [state.parts.find(p => p.id === from)?.name ?? '', state.parts.find(p => p.id === partId)?.name ?? harness.missing.find(m => m.id === partId)?.name ?? ''];
    withUndo(`Linked ${names[0]} to ${names[1]}.`, () => store.addLink(harness.id, from, partId));
  };
  const remove = (partId: string): void => {
    const name = state.parts.find(p => p.id === partId)?.name ?? '';
    setSelectedId(null); setLinkingId(null);
    withUndo(`Removed ${name}.`, () => store.removePart(harness.id, partId));
  };
  const select = (next: string | null): void => { setSelectedId(next); if (next === null) setLinkingId(null); };
  /** Starts (or stops) linking from an agent. A press on "Link to..." in the details moves the focus to the first part that can take the link, so the keyboard can pick it. */
  const toggleLink = (agentId: string): void => setLinkingId(current => (current === agentId ? null : agentId));
  const tools = (
    <>
      <div className="hx-seg" role="group" aria-label={WORDS.label.views}>
        <HIconButton icon="harness" label={WORDS.label.graphView} side="below" aria-pressed={view === 'graph'} onClick={() => go({ name: 'builder', id: harness.id, view: 'graph' })} />
        <HIconButton icon="list" label={WORDS.label.listView} side="below" aria-pressed={view === 'list'} onClick={() => go({ name: 'builder', id: harness.id, view: 'list' })} />
      </div>
      <HIconButton icon="search" label={WORDS.label.search} side="below" aria-pressed={query !== null} onClick={() => setQuery(q => (q === null ? '' : null))} />
      <HIconButton ref={addButton} icon="plus" label={WORDS.label.addPart} side="below" aria-expanded={drawer} onClick={() => setDrawer(open => !open)} />
      <HIconButton icon="folder" label={WORDS.label.assignToProject} side="below" onClick={() => ui.openInstall({ harnessId: harness.id, projectId: null, step: 'project' })} />
      <HButton icon="play" variant="primary" disabled={empty} onClick={() => ui.openStart({ harnessId: harness.id })}>{WORDS.label.start}</HButton>
    </>
  );
  return (
    <Screen slot="builder" title={harness.name} count={partsWords(harness)} flush={view === 'graph' && !empty} tools={tools}
      details={<BuilderDetails state={state} harness={harness} selectedId={selectedId} onSelect={setSelectedId} onViewFile={partId => go({ name: 'file', partId })} onRemove={remove} onFix={openFix}
        linkingId={linkingId} onLinkStart={view === 'graph' && !empty ? agentId => { toggleLink(agentId); requestAnimationFrame(() => document.querySelector<HTMLElement>('.hx-node[data-candidate]')?.focus()); } : undefined} />}
      drawer={<>
        <AddPartDrawer open={drawer} state={state} harness={harness} initialKind="skill" onClose={() => setDrawer(false)} returnTo={() => addButton.current}
          onAdd={partId => { const name = state.parts.find(p => p.id === partId)?.name ?? ''; withUndo(`Added ${name}.`, () => store.addPart(harness.id, partId)); }} />
      </>}>
      {query === null ? null : (
        <label className="hx-search hx-findbar" data-control="">
          <HIcon name="search" size={18} />
          <input type="search" value={query} autoFocus placeholder={WORDS.label.search} aria-label={WORDS.label.search} onChange={e => setQuery(e.target.value)} />
        </label>
      )}
      {empty ? (
        <div className="hx-empty">
          <HIcon name="harness" size={20} />
          <h2 className="hx-empty-title">{WORDS.label.emptyTitle}</h2>
          <p className="hx-text hx-muted">{WORDS.hint.emptyBody}</p>
          <div className="hx-empty-actions">
            <HButton icon="plus" variant="primary" onClick={() => setDrawer(true)}>{WORDS.label.addParts}</HButton>
            <HButton icon="search" onClick={() => go({ name: 'choose' })}>{WORDS.label.startFromScan}</HButton>
          </div>
        </div>
      ) : view === 'graph'
        ? <Graph key={harness.id} state={state} harness={harness} selectedId={selectedId} linkingId={linkingId} matchIds={matchIds} onSelect={select}
            onMove={(nodeId, at) => store.setNodePosition(harness.id, nodeId, at)} onLinkStart={toggleLink}
            onLinkTarget={onLinkTarget} onLinkCancel={() => setLinkingId(null)} onFix={openFix} />
        : <ListView state={state} harness={harness} selectedId={selectedId} matchIds={matchIds} onSelect={setSelectedId} onFix={openFix} />}
      <FixSheet open={fix.open} state={state} harness={harness} missingId={fix.id} onClose={() => setFix(current => ({ ...current, open: false }))} onFix={doFix} />
    </Screen>
  );
}
