/**
 * The Library test page, at the address #prototype-v2/library. It exists so that every flow of the Library can be tried and tested without the shell: the
 * demo world (the home app's sample world plus the Library's sample pieces), a top bar with the Preview mark and the "Version history" button, the page itself
 * (the list, the details panel, the web sheet and the dialogs), and the real Save bar (it counts the changes, saves, goes back and discards). It keeps its own
 * store, so it needs no provider from the shell. Nothing is written anywhere.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { barSaid } from '../../../shared/home/change-undo.js';
import { libraryChangeCount, libraryChangeList } from '../../../shared/home/library-changes.js';
import { withLibrarySamples } from '../../../shared/home/library-sample.js';
import { plainNameOfSaved } from '../../../shared/home/plain-names.js';
import { savePointRows } from '../../../shared/home/points.js';
import { saveBar, withStartPoint } from '../../../shared/home/savebar.js';
import type { BarPhase } from '../../../shared/home/savebar.js';
import { withSampleCopies } from '../../../shared/home/sample-copies.js';
import { withStarterAgents } from '../../../shared/home/starters.js';
import { createStore, reduceStore } from '../../../shared/world/store.js';
import { WorldProvider, useWorldStore } from '../../common/session.js';
import { loadWorld } from '../../common/world.js';
import { Button } from '../kit/Button.js';
import { Drawer } from '../kit/Drawer.js';
import { HelpPopover } from '../kit/HelpPopover.js';
import { KitIcon } from '../kit/icons.js';
import { Tooltip } from '../kit/Tooltip.js';
import { SavePoints } from '../points/SavePoints.js';
import { SaveBar } from '../save/SaveBar.js';
import { useChangeList } from '../save/useChangeList.js';
import { discardAction, goBackAction, saveAction } from '../store-actions.js';
import { WORDS, changesCount } from '../words.js';
import { LibraryPage } from './LibraryPage.js';
import '../home-tokens.css';
import '../kit/kit.css';
import '../home.css';
import './library.css';

function Page(): ReactElement {
  const { state, dispatch } = useWorldStore();
  const [phase, setPhase] = useState<BarPhase | null>(null);
  const [history, setHistory] = useState(false);
  const clock = useRef<HTMLButtonElement>(null);
  const changes = libraryChangeCount(state.committed, state.draft);
  const said = useMemo(() => barSaid(libraryChangeList(state.committed, state.draft), changes), [state.committed, state.draft, changes]);
  const bar = saveBar(changes, state.committed.versions.length, phase, said);
  const changeList = useChangeList(state, changes >= 2 && said === null, dispatch);
  const rows = useMemo(() => (history ? savePointRows(state.committed, plainNameOfSaved(state.committed)) : []), [history, state.committed]);

  useEffect(() => { document.title = WORDS.label.appName; }, []);
  // A new change ends what the bar said about the last save or Go back.
  useEffect(() => { if (changes > 0 && phase !== null) setPhase(null); }, [changes, phase]);

  const save = (): void => {
    const points = state.committed.versions.length;
    dispatch(saveAction(said ?? changesCount(changes)));
    setPhase({ kind: 'saved', at: points + 1, backTo: state.headVersionId });
  };
  const goBackTo = (versionId: string): void => {
    const action = goBackAction(versionId);
    if (reduceStore(state, action) === state) return;
    dispatch(action);
    setPhase({ kind: 'back', at: state.committed.versions.length + 1, backTo: null });
  };

  return (
    <div className="hm-root hm-flat lb-page" data-home="">
      <header className="hm-bar">
        <div className="hm-brand"><KitIcon name="leaf" size={28} /><span>{WORDS.label.appName}</span></div>
        <div className="hm-preview" data-preview="">
          <HelpPopover pill={WORDS.label.preview} label={WORDS.label.aboutPreview} text={WORDS.popover.preview} />
        </div>
        <span className="hm-spacer" />
        <Tooltip text={WORDS.label.versionHistory}>
          {aria => <Button round icon="clock" aria-label={WORDS.label.versionHistory} aria-expanded={history} ref={clock} onClick={() => setHistory(h => !h)} {...aria} />}
        </Tooltip>
      </header>
      <LibraryPage />
      <Drawer open={history} title={WORDS.label.versionHistory} onClose={() => setHistory(false)} dataSlot="points" returnTo={() => clock.current}>
        <SavePoints rows={rows} unsaved={changes > 0} onGoBack={goBackTo} onShare={() => undefined} onOpenFile={() => undefined} />
      </Drawer>
      <SaveBar model={bar} ticks={[]} onSave={save} onGoBack={() => { if (phase !== null && phase.backTo !== null) goBackTo(phase.backTo); }} onDiscard={() => { setPhase(null); dispatch(discardAction()); }} list={changeList} />
    </div>
  );
}

export function LibraryHarness(): ReactElement {
  // The first save point is the world as it was found, so "Go back" always has somewhere to go.
  const [store] = useState(() => createStore(withStartPoint(withLibrarySamples(withStarterAgents(withSampleCopies(loadWorld()))))));
  return <WorldProvider store={store}><Page /></WorldProvider>;
}

