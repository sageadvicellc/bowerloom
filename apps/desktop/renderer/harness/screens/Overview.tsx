/**
 * The Overview (Task 2, journey 1 step 1.5): every place the first read found, in one read-only graph, and the first screen after the read. It is built from the world already in the
 * window (`overviewOf` in shared/harness/overview.ts) and the folders main knows (`engine.folders()`); it asks main for nothing else and writes nothing.
 * - Two views of the same data: the Graph (OverviewGraph.tsx) and the List (OverviewList.tsx), switched by a radio group. A window under OVERVIEW_LIMITS.smallScreen wide starts on the List.
 * - A place opens and closes by its header (the same state in both views). "Expand all" is off above OVERVIEW_LIMITS.expandAllMax parts.
 * - A part selected in either view fills the details column (OverviewDetails.tsx); selecting a shared skill lights every copy.
 * - Each place has one button. "Open in builder" goes to the builder of the folder main knows. "Choose this folder" opens the system chooser; the window then compares the label main
 *   gives back with the place's own, and goes on only when they agree, else says "That is not the folder shown." No path reaches the window.
 * - In the sample launch the world is the made-up one of several places (`createSampleOverviewState`), so the screen has something to show; the other sample screens keep the three sources.
 */
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import type { FolderInfo } from '../../../shared/engine/types.js';
import { createSampleOverviewState } from '../../../shared/harness/sample.js';
import { overviewOf } from '../../../shared/harness/overview.js';
import type { OverviewGroup } from '../../../shared/harness/overview.js';
import { Screen } from '../Screen.js';
import { useWindowWidth } from '../../home/shell/useWindowWidth.js';
import { go } from '../router.js';
import { useEngine } from '../engine.js';
import { useHarnessState } from '../session.js';
import { useUi } from '../ui.js';
import { HButton, HIconButton } from '../parts/controls.js';
import { RefusalNote } from '../sheets/engine-parts.js';
import { chooseFolderCall, foldersCall, useCall } from '../sheets/use-call.js';
import { ENGINE_WORDS } from '../words-engine.js';
import { FLOW } from '../words-flow.js';
import { WORDS } from '../words.js';
import { OVERVIEW, placesWords, selectedWords } from '../words-overview.js';
import { OverviewDetails } from './OverviewDetails.js';
import { OverviewGraph } from './OverviewGraph.js';
import { OverviewList } from './OverviewList.js';
import { allOverrides, canExpandAll, chosenMatches, expandedOf, indexOverview, toggledOverrides, viewFor } from './OverviewModel.js';
import type { OverviewView } from './OverviewModel.js';
import { PlaceAction, PlaceMark } from './OverviewParts.js';
import type { PlaceTools } from './OverviewParts.js';
import '../overview.css';

const VIEWS: readonly OverviewView[] = ['graph', 'list'];

export function Overview(): ReactElement {
  const state = useHarnessState(), engine = useEngine(), ui = useUi(), width = useWindowWidth();
  // The sample launch draws a made-up world of several places; the person's own folders draw what the read found.
  const sample = useMemo(() => createSampleOverviewState(), []);
  const source = state.real === undefined ? sample : state;
  const [folders, setFolders] = useState<readonly FolderInfo[]>([]);
  const list = useCall(), choosing = useCall();
  const sheetOpen = ui.adopt.open || ui.saveSheet.open || ui.projectSheet.open;
  // The folders main knows, read when the screen opens and when a sheet closes. A read that fails shows its refusal and leaves the places without a mark.
  useEffect(() => { if (engine !== null && !sheetOpen) void list.plan(ENGINE_WORDS.label.planning, () => foldersCall(engine), setFolders); }, [engine, sheetOpen]);
  const overview = useMemo(() => overviewOf(source, folders), [source, folders]);
  const index = useMemo(() => indexOverview(overview), [overview]);
  const [chosen, setChosen] = useState<OverviewView | null>(null);
  const view = viewFor(chosen, width);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [fitTick, setFitTick] = useState(0);
  const expanded = useMemo(() => expandedOf(overview, overrides), [overview, overrides]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId === null ? undefined : index.node(selectedId);

  const toggle = (id: string): void => setOverrides(current => toggledOverrides(current, id, expanded.has(id)));
  const allOpen = overview.groups.length > 0 && overview.groups.every(g => expanded.has(g.id));
  const setAll = (open: boolean): void => { setOverrides(allOverrides(overview, open)); setFitTick(t => t + 1); };
  const expandable = canExpandAll(index);

  const tools: PlaceTools = {
    available: engine !== null,
    busy: choosing.busy !== null,
    open: g => { if (g.folderId !== null) go({ name: 'builder', id: g.folderId }); },
    choose: g => {
      if (engine === null) return;
      // A closed chooser is no answer. A folder that is not the one shown is refused in words, and nothing else happens.
      void choosing.plan(ENGINE_WORDS.label.chooseFolder, () => chooseFolderCall(engine), got => {
        if (got === null) return;
        setFolders(got.list);
        if (!chosenMatches(g, got.info.label)) { ui.showToast(OVERVIEW.hint.wrongFolder); return; }
        go({ name: 'builder', id: got.info.id });
      });
    },
  };
  const place = (g: OverviewGroup): ReactElement => <><PlaceMark group={g} /><PlaceAction group={g} tools={tools} /></>;

  const empty = overview.groups.length === 0;
  const keyViews = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = VIEWS[(VIEWS.indexOf(view) + step + VIEWS.length) % VIEWS.length]!;
    setChosen(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-view-choice="${next}"]`)?.focus());
  };
  const viewButton = (which: OverviewView): ReactElement => (
    <HIconButton icon={which === 'graph' ? 'harness' : 'list'} label={which === 'graph' ? WORDS.label.graphView : WORDS.label.listView} side="below" role="radio" aria-checked={view === which}
      tabIndex={view === which ? 0 : -1} data-view-choice={which} onClick={() => setChosen(which)} />
  );
  const bar = (
    <>
      <div className="hx-seg hxo-views" role="radiogroup" aria-label={OVERVIEW.label.graphList} onKeyDown={keyViews}>{viewButton('graph')}{viewButton('list')}</div>
      <HIconButton icon={allOpen ? 'chevron-up' : 'chevron'} label={allOpen ? OVERVIEW.label.collapseAll : OVERVIEW.label.expandAll} side="below" {...(!allOpen && !expandable ? { tip: OVERVIEW.hint.tooManyToExpand, 'aria-disabled': 'true' as const } : {})} data-expand-all=""
        onClick={e => { if (!allOpen && !expandable) { e.preventDefault(); ui.showToast(OVERVIEW.hint.tooManyToExpand); return; } setAll(!allOpen); }} />
    </>
  );

  return (
    <Screen slot="overview" title={WORDS.label.overview} count={placesWords(overview.groups.length)} flush={view === 'graph' && !empty} tools={empty ? undefined : bar}
      details={empty ? undefined : <OverviewDetails overview={overview} index={index} selectedId={selected === undefined ? null : selectedId} onSelect={setSelectedId} place={place} />}>
      {list.refusal === null ? null : <RefusalNote refusal={list.refusal} focusId={list.refusalId}>{null}</RefusalNote>}
      {choosing.refusal === null ? null : <RefusalNote refusal={choosing.refusal} focusId={choosing.refusalId}>{null}</RefusalNote>}
      {empty ? (
        <div className="hx-empty" data-empty="">
          <p className="hx-empty-title">{OVERVIEW.hint.empty}</p>
          <div className="hx-empty-actions"><HButton variant="primary" icon="folder" onClick={() => go({ name: 'choose' })}>{FLOW.label.findMyFiles}</HButton></div>
        </div>
      ) : view === 'graph' ? (
        <OverviewGraph overview={overview} expanded={expanded} index={index} selectedId={selected === undefined ? null : selectedId} fitKey={`${overview.groups.map(g => g.id).join(',')}|${fitTick}`}
          onSelect={setSelectedId} onToggle={toggle} place={place} />
      ) : (
        <OverviewList overview={overview} expanded={expanded} index={index} selectedId={selected === undefined ? null : selectedId} onSelect={setSelectedId} onToggle={toggle} place={place} />
      )}
      <p className="hm-sr" role="status" aria-live="polite" data-live="">{selectedWords(selected?.node.name ?? null)}</p>
    </Screen>
  );
}
