/**
 * S8, the Start sheet. It picks the project, the interfaces (a tick for each: the person can change them), and the instruction; it says "Compare is on" when two or more are ticked.
 * "Review and start N runs" starts one run for each ticked interface and opens Runs. An interface that is out of date, in conflict or not installed for the chosen project does not start silently:
 * the button opens the install review first (`useUi().openInstall`, with the ticked interfaces, so the review lists their files), and the Start sheet stays under it, so the person comes back to it
 * with the status updated. While the button is off, a line beside it says why. A start that does nothing says why in a note.
 * An interface that is switched off on the Interfaces screen, or not found, is shown but cannot be ticked. The preview opens no window. The app never reads the chat, and the sheet says so.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { SAMPLE_IDS, SAMPLE_INSTRUCTION } from '../../../shared/harness/sample.js';
import { compareNotice, harnessById, installOf, offeredInterfaces, startButtonWords, startInterfaceLine, startNeeds } from '../../../shared/harness/status.js';
import { startProblem } from '../../../shared/harness/store.js';
import type { HarnessState, Interface, InterfaceId } from '../../../shared/harness/types.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton, StateDot } from '../parts/controls.js';
import { HIcon } from '../icons.js';
import { go } from '../router.js';
import { useHarnessState, useHarnessStore } from '../session.js';
import { useUi } from '../ui.js';
import { RUN_WORDS } from '../runs-words.js';
import { WORDS } from '../words.js';
import { nothingChanged } from '../words-flow.js';
import './start.css';

export interface StartSheetProps {
  open: boolean;
  harnessId: string | null;
  projectId: string | null;
  onClose(): void;
}

/** The project the sheet opens on: the one asked for, else the first that already holds the harness, else the first. */
function firstProject(state: HarnessState, harnessId: string | null, asked: string | null): string {
  if (asked !== null && state.projects.some(p => p.id === asked)) return asked;
  const holding = state.projects.find(p => harnessId !== null && Object.keys(installOf(state, p.id, harnessId)?.states ?? {}).length > 0);
  return (holding ?? state.projects[0])?.id ?? '';
}

/** The interfaces ticked at the start: the ones the harness is already in for this project, or the first one offered. */
function firstTicks(state: HarnessState, projectId: string, harnessId: string | null): InterfaceId[] {
  const offered = offeredInterfaces(state);
  const install = harnessId === null ? undefined : installOf(state, projectId, harnessId);
  const have = offered.filter(i => { const s = install?.states[i.id]; return s !== undefined && s !== 'not-installed'; });
  return (have.length > 0 ? have : offered.slice(0, 1)).map(i => i.id);
}

function InterfaceRow({ state, iface, projectId, harnessId, ticked, onTick }: { state: HarnessState; iface: Interface; projectId: string; harnessId: string; ticked: boolean; onTick(): void }): ReactElement {
  const offered = offeredInterfaces(state).some(i => i.id === iface.id);
  if (!offered) {
    const line = iface.health === 'not-found' ? startInterfaceLine(state, projectId, harnessId, iface).words : RUN_WORDS.hint.switchedOff;
    return (
      <li className="hs-iface" data-off="" data-iface={iface.id}>
        <span className="hs-box" aria-hidden="true" />
        <span className="hs-iface-text"><span className="hs-iface-name">{iface.name}</span><StateDot tone="quiet">{line}</StateDot></span>
      </li>
    );
  }
  const line = startInterfaceLine(state, projectId, harnessId, iface);
  return (
    <li className="hs-iface-item" data-iface={iface.id}>
      <label className="hs-iface" data-checked={ticked ? '' : undefined}>
        <input type="checkbox" className="hs-check" checked={ticked} onChange={onTick} />
        <span className="hs-iface-text"><span className="hs-iface-name">{iface.name}</span><StateDot tone={line.tone}>{line.words}</StateDot></span>
      </label>
    </li>
  );
}

export function StartSheet({ open, harnessId, projectId, onClose }: StartSheetProps): ReactElement | null {
  const state = useHarnessState(), store = useHarnessStore(), ui = useUi();
  const harness = harnessId === null ? undefined : harnessById(state, harnessId);
  const [project, setProject] = useState('');
  const [ticks, setTicks] = useState<readonly InterfaceId[]>([]);
  const [instruction, setInstruction] = useState('');
  const latest = useRef(state);
  latest.current = state;

  // Each time the sheet opens it starts again: the project, the ticks and the instruction.
  useEffect(() => {
    if (!open) return;
    const s = latest.current, chosen = firstProject(s, harnessId, projectId);
    setProject(chosen); setTicks(firstTicks(s, chosen, harnessId));
    setInstruction(harnessId === SAMPLE_IDS.weekly ? SAMPLE_INSTRUCTION : '');
  }, [open, harnessId, projectId]);

  const offered = offeredInterfaces(state);
  const chosen = offered.filter(i => ticks.includes(i.id)).map(i => i.id);
  const empty = harness !== undefined && harness.partIds.length === 0;
  // Why the button is off, in words beside it. An empty harness has its own line above the instruction.
  const why = harness === undefined || empty ? null : project === '' ? RUN_WORDS.hint.needProject : chosen.length === 0 ? RUN_WORDS.hint.needInterface : instruction.trim() === '' ? RUN_WORDS.hint.needInstruction : null;
  const blocked = harness === undefined || empty || why !== null;
  const notice = compareNotice(chosen.length);

  const start = (): void => {
    if (harness === undefined || blocked) return;
    // An interface that is not installed and current in this project is reviewed first: the install review opens over this sheet, with these interfaces ticked.
    if (startNeeds(state, project, harness.id, chosen).length > 0) { ui.openInstall({ projectId: project, harnessId: harness.id, step: 'review', interfaceIds: chosen }); return; }
    const request = { harnessId: harness.id, projectId: project, interfaceIds: chosen, instruction };
    const runIds = store.startRuns(request);
    if (runIds.length === 0) { ui.showToast(nothingChanged(startProblem(store.getState(), request) ?? 'no run could start')); return; }
    onClose();
    go({ name: 'runs', id: runIds[0]! });
  };
  const pickProject = (id: string): void => { setProject(id); setTicks(firstTicks(state, id, harnessId)); };
  const tick = (id: InterfaceId): void => setTicks(current => (current.includes(id) ? current.filter(x => x !== id) : [...current, id]));

  return (
    <Sheet open={open} title={`Start ${harness?.name ?? ''}`} onClose={onClose} width={680} dataSlot="start" note={RUN_WORDS.paragraph.startNote}
      actions={<>{why === null ? null : <span className="hs-why" id="hs-why">{why}</span>}<HButton onClick={onClose}>{WORDS.label.cancel}</HButton><HButton icon="play" variant="primary" disabled={blocked} aria-describedby={why === null ? undefined : 'hs-why'} onClick={start}>{startButtonWords(chosen.length)}</HButton></>}>
      <div className="hs-field">
        <label className="hs-label" htmlFor="hs-project">{RUN_WORDS.label.project}</label>
        <div className="hs-select">
          <span className="hs-select-icon" aria-hidden="true"><HIcon name="folder" size={18} /></span>
          <select id="hs-project" value={project} onChange={e => pickProject(e.target.value)}>
            {state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="hs-select-icon" aria-hidden="true"><HIcon name="chevron" size={18} /></span>
        </div>
      </div>
      <div className="hs-field">
        <h3 className="hs-label" id="hs-ifaces">{RUN_WORDS.label.interfaces}</h3>
        <ul className="hs-ifaces" aria-labelledby="hs-ifaces">
          {harness === undefined ? null : state.interfaces.map(i => <InterfaceRow key={i.id} state={state} iface={i} projectId={project} harnessId={harness.id} ticked={chosen.includes(i.id)} onTick={() => tick(i.id)} />)}
        </ul>
      </div>
      {empty ? <p className="hs-compare" role="status" data-tone="warn"><HIcon name="warning" size={20} /><span>{RUN_WORDS.hint.emptyHarness}</span></p> : null}
      {notice === null ? null : <p className="hs-compare" role="status"><HIcon name="columns" size={20} /><span>{notice}</span></p>}
      <div className="hs-field">
        <label className="hs-label" htmlFor="hs-instruction">{RUN_WORDS.label.instruction}</label>
        <textarea id="hs-instruction" className="hs-text" rows={4} value={instruction} placeholder={RUN_WORDS.hint.startPlaceholder} onChange={e => setInstruction(e.target.value)} />
      </div>
    </Sheet>
  );
}
