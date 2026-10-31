/**
 * S7, the install sheet: three steps (the project, the interfaces, the review). It is opened from the Harness list (Assign to project), from Projects (Update, Install, Review, Assign harness)
 * and from the start sheet (an interface that is out of date), through `useUi().openInstall({ projectId, harnessId, step })`.
 * The review lists every file, marked New, Update or Conflict. A conflict has three choices and "Install N files" waits until each one is settled. Install changes the install data in memory
 * (`store.install`), adds a history entry, and shows "Installed." with Undo. Nothing is written to a disk. The sheet keeps one height across the three steps, so the foot stays where it is.
 * The Start sheet opens it with the interfaces the person ticked there, so the review lists their files. An install that does nothing says why in a note and the sheet stays open.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Stepper } from '../../home/kit/Stepper.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton } from '../parts/controls.js';
import { useHarnessState, useHarnessStore } from '../session.js';
import { useUi } from '../ui.js';
import type { InstallStep } from '../ui.js';
import { buildInstallPlan, installButtonWords } from '../../../shared/harness/files.js';
import { chosenInterfaces, choicesOf, selectable, settled } from '../../../shared/harness/install-flow.js';
import { harnessById, projectById } from '../../../shared/harness/status.js';
import type { ConflictChoice, HarnessState, InterfaceId } from '../../../shared/harness/types.js';
import { WORDS, installTitle } from '../words.js';
import { FLOW, nothingChanged } from '../words-flow.js';
import { undoNow } from '../undo-note.js';
import { InterfacesStep, PickStep } from './install-steps.js';
import { ReviewStep } from './install-review.js';

export interface InstallSheetProps {
  open: boolean;
  projectId: string | null;
  harnessId: string | null;
  step: InstallStep;
  /** The interfaces to tick when the sheet opens, or null for the default ones. */
  interfaceIds?: readonly InterfaceId[] | null;
  onStep(step: InstallStep): void;
  onClose(): void;
}

/** What the person has chosen in this sheet. It starts again each time the sheet opens. */
interface Session {
  readonly harnessId: string | null;
  readonly projectId: string | null;
  /** The sheet asks for the harness when none was given, and for the folder when none was given or the harness is known. */
  readonly asksHarness: boolean;
  readonly asksProject: boolean;
  /** The ticked interfaces, or null while the person has not touched a tick (the default ones show). */
  readonly ticked: readonly InterfaceId[] | null;
  readonly picked: Readonly<Record<string, ConflictChoice>>;
  readonly confirmed: readonly string[];
}

function startSession(state: HarnessState, projectId: string | null, harnessId: string | null, interfaceIds: readonly InterfaceId[] | null): Session {
  const asksHarness = harnessId === null, asksProject = projectId === null || !asksHarness;
  // The design shows the first folder chosen when the folder is asked for.
  const project = projectId !== null && projectById(state, projectId) !== undefined ? projectId : asksHarness ? null : (state.projects[0]?.id ?? null);
  return { harnessId, projectId: project, asksHarness, asksProject, ticked: interfaceIds, picked: {}, confirmed: [] };
}

const STEPS: readonly InstallStep[] = Object.freeze(['project', 'interfaces', 'review']);

export function InstallSheet({ open, projectId, harnessId, step, interfaceIds = null, onStep, onClose }: InstallSheetProps): ReactElement | null {
  const state = useHarnessState(), store = useHarnessStore(), ui = useUi();
  const [session, setSession] = useState<Session>(() => startSession(state, projectId, harnessId, interfaceIds));
  const [wasOpen, setWasOpen] = useState(open);
  // A sheet that opens starts again from what it was opened with. This is set while drawing, so the first frame is already the new one.
  if (open !== wasOpen) { setWasOpen(open); if (open) setSession(startSession(state, projectId, harnessId, interfaceIds)); }

  const intro = useRef<HTMLParagraphElement>(null), skipFocus = useRef(true);
  const harness = session.harnessId === null ? undefined : harnessById(state, session.harnessId);
  const project = session.projectId === null ? undefined : projectById(state, session.projectId);
  const ready = harness !== undefined && project !== undefined;
  const shown: InstallStep = ready ? step : 'project';
  const ids = chosenInterfaces(state, session.ticked, session.projectId, session.harnessId);
  const plan = ready && ids.length > 0 ? buildInstallPlan(state, project.id, harness.id, ids) : null;
  const canInstall = plan !== null && settled(plan, session.confirmed);

  // A new step puts the focus on its first line, so a screen reader reads it. The first one is the sheet's own focus on its title.
  useEffect(() => {
    if (!open) { skipFocus.current = true; return; }
    if (skipFocus.current) { skipFocus.current = false; return; }
    intro.current?.focus({ preventScroll: true });
  }, [shown, open]);

  const pickHarness = (id: string): void => setSession(s => ({ ...s, harnessId: id, ticked: null, picked: {}, confirmed: [] }));
  const pickProject = (id: string): void => setSession(s => ({ ...s, projectId: id, ticked: null, picked: {}, confirmed: [] }));
  const toggle = (id: InterfaceId): void => setSession(s => {
    const now = new Set(chosenInterfaces(state, s.ticked, s.projectId, s.harnessId));
    if (now.has(id)) now.delete(id); else now.add(id);
    return { ...s, ticked: [...now], picked: {}, confirmed: [] };
  });
  const choose = (path: string, choice: ConflictChoice): void => setSession(s => ({ ...s, picked: { ...s.picked, [path]: choice }, confirmed: s.confirmed.includes(path) ? s.confirmed : [...s.confirmed, path] }));

  const go = (to: InstallStep): void => onStep(to);
  const install = (): void => {
    if (!ready || plan === null || !canInstall) return;
    const before = store.getState().history.length;
    const why = store.install({ projectId: project.id, harnessId: harness.id, interfaceIds: ids, conflictChoices: choicesOf(plan, session.picked) });
    const after = store.getState().history, entry = after[0];
    if (why !== null || after.length === before || entry === undefined) { ui.showToast(nothingChanged(why ?? 'nothing was different')); return; }
    onClose();
    ui.showToast(WORDS.label.installed, { label: WORDS.label.undo, run: () => undoNow(store, ui, entry.id) });
  };

  const firstLabel = session.asksHarness && !session.asksProject ? FLOW.label.stepHarness : FLOW.label.stepProject;
  const head = <div className="hxi-steps"><Stepper steps={[firstLabel, FLOW.label.stepInterfaces, FLOW.label.stepReview]} current={STEPS.indexOf(shown)} label={FLOW.label.installSteps} doneWord={FLOW.label.stepDone} /></div>;

  let actions: ReactElement;
  if (shown === 'project') {
    actions = <><HButton onClick={onClose}>{WORDS.label.cancel}</HButton><HButton variant="primary" disabled={!ready} onClick={() => go('interfaces')}>{FLOW.label.next}</HButton></>;
  } else if (shown === 'interfaces') {
    actions = <><HButton onClick={() => go('project')}>{WORDS.label.back}</HButton><HButton variant="primary" disabled={ids.length === 0} onClick={() => go('review')}>{FLOW.label.next}</HButton></>;
  } else {
    actions = <><HButton onClick={() => go('interfaces')}>{WORDS.label.back}</HButton><HButton variant="primary" disabled={!canInstall} onClick={install}>{plan === null ? FLOW.label.install : installButtonWords(plan)}</HButton></>;
  }

  return (
    <Sheet open={open} title={harness === undefined ? FLOW.label.installAHarness : installTitle(harness.name)} onClose={onClose} width={840} tall dataSlot="install" head={head} note={FLOW.hint.installNote} actions={actions}>
      {shown === 'project' ? <PickStep state={state} harnessId={session.harnessId} projectId={session.projectId} asksHarness={session.asksHarness} asksProject={session.asksProject} introRef={intro} onHarness={pickHarness} onProject={pickProject} /> : null}
      {shown === 'interfaces' && ready ? <InterfacesStep state={state} harness={harness} projectId={project.id} ticked={ids} introRef={intro} onToggle={toggle} /> : null}
      {shown === 'review' && ready && plan === null ? <p className="hxi-sum" tabIndex={-1} ref={intro}>{state.interfaces.some(selectable) ? FLOW.hint.pickInterface : FLOW.hint.noneOffered}</p> : null}
      {shown === 'review' && ready && plan !== null ? <ReviewStep state={state} harness={harness} project={project} plan={plan} picked={session.picked} confirmed={session.confirmed} introRef={intro} onChoose={choose} /> : null}
    </Sheet>
  );
}
