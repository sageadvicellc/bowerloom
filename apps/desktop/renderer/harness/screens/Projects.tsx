/**
 * S6, Projects. One row for each project: its name, the harness it holds, its folder, and a dot and words for each interface (computed from the install data, so the Harness list says the same).
 * The button at the right of a row follows the worst state: "Update" for out of date, "Review" for a conflict, "Install" when nothing is installed yet, "Assign harness" when the project has no harness.
 * Each opens the install sheet at the right step. Picking a row fills the details column: the harness, the state of each interface with its own button, "Assign another harness" and "Remove from project".
 */
import type { ReactElement } from 'react';
import { chipWords, harnessById, installState, installStates, installsOfProject, stateTone, stateWords, worstState } from '../../../shared/harness/status.js';
import { HARNESS_FILE } from '../../../shared/harness/files.js';
import type { HarnessStore } from '../../../shared/harness/store.js';
import type { Harness, HarnessState, Install, InstallState, Project } from '../../../shared/harness/types.js';
import { DetailsHead, Screen } from '../Screen.js';
import { go } from '../router.js';
import { useHarnessState, useHarnessStore } from '../session.js';
import { useUi } from '../ui.js';
import type { Ui } from '../ui.js';
import { HButton, HIconButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { WORDS, notYetWords, projectsHint } from '../words.js';
import { PathDisclosure } from '../parts/PathDisclosure.js';
import { FLOW, actionFor, actionName, rowSubject, installFor, nothingChanged, removedWords, reviewFor, savedAs, updateFor } from '../words-flow.js';
import { undoNow } from '../undo-note.js';
import { ENGINE_WORDS } from '../words-engine.js';
import './projects.css';

/** The install of a project with the worst state, or undefined when the project has none. */
function worstInstall(state: HarnessState, projectId: string): Install | undefined {
  const installs = installsOfProject(state, projectId), worst = worstState(installs.map(installState));
  return installs.find(i => installState(i) === worst);
}

/** Opens the install sheet at the step a state needs: a conflict or an out-of-date copy goes straight to the review, nothing installed goes to the interfaces. */
function openFor(ui: Ui, projectId: string, harnessId: string, state: InstallState): void {
  ui.openInstall({ projectId, harnessId, step: state === 'not-installed' ? 'interfaces' : 'review' });
}

function Row({ state, project, selected, onPick }: { state: HarnessState; project: Project; selected: boolean; onPick(): void }): ReactElement {
  const ui = useUi();
  const installs = installsOfProject(state, project.id), many = installs.length > 1;
  const names = installs.map(i => harnessById(state, i.harnessId)?.name ?? i.harnessId);
  const worst = worstInstall(state, project.id), worstHarness = worst === undefined ? undefined : harnessById(state, worst.harnessId);
  const action = worst === undefined ? FLOW.label.assignHarness : actionFor(installState(worst));
  const press = (): void => { if (worst === undefined || worstHarness === undefined) ui.openInstall({ projectId: project.id, harnessId: null, step: 'project' }); else openFor(ui, project.id, worstHarness.id, installState(worst)); };
  return (
    <li className="hx-row hxp-row" data-selected={selected ? '' : undefined} data-project={project.id}>
      <Tile name="folder" size="large" />
      <div className="hx-row-text">
        <span className="hxp-title">
          <button type="button" className="hx-row-main" aria-pressed={selected} onClick={onPick}>{project.name}</button>
          <span className="hxp-harness">{installs.length === 0 ? FLOW.label.noHarnessYet : names.join(', ')}</span>
        </span>
        <PathDisclosure className="hxp-path" path={project.path} subject={rowSubject(project.name)} key={project.id} />
        {installs.map((install, n) => (
          <ul key={install.harnessId} className="hxp-dots" aria-label={names[n]}>
            {many ? <li className="hxp-dots-name">{names[n]}</li> : null}
            {installStates(state, install).map(r => <li key={r.interfaceId}><StateDot tone={stateTone(r.state)}>{chipWords(r.name, r.state)}</StateDot></li>)}
          </ul>
        ))}
      </div>
      {action === null ? null : (
        <span className="hx-row-action">
          <HButton size="small" aria-label={worstHarness === undefined ? undefined : actionName(action, worstHarness.name, project.name)} onClick={press}>{action}</HButton>
        </span>
      )}
    </li>
  );
}

/** Takes a harness out of a project and offers "Undo" in a note, only when something changed. */
function removeWithNote(store: HarnessStore, ui: Ui, projectId: string, harness: Harness): void {
  const before = store.getState().history.length;
  store.removeInstall(projectId, harness.id);
  const entry = store.getState().history[0];
  if (store.getState().history.length > before && entry !== undefined) ui.showToast(removedWords(harness.name), { label: WORDS.label.undo, run: () => undoNow(store, ui, entry.id) });
  else ui.showToast(nothingChanged('it is not installed there'));
}

function InstallBlock({ state, store, ui, project, install, harness, many }: { state: HarnessState; store: HarnessStore; ui: Ui; project: Project; install: Install; harness: Harness; many: boolean }): ReactElement {
  const remove = (): void => removeWithNote(store, ui, project.id, harness);
  return (
    <div className="hxp-install" data-install={harness.id}>
      <section className="hx-block" aria-label={`${WORDS.label.harness} ${harness.name}`}>
        <h3 className="hx-h3">{WORDS.label.harness}</h3>
        <p className="hxp-hname">{harness.name}</p>
        <p className="hx-text hx-muted">{savedAs(HARNESS_FILE)}</p>
      </section>
      <section className="hx-block" aria-label={`${FLOW.label.interfacesOfInstall} ${harness.name}`}>
        <h3 className="hx-h3">{FLOW.label.interfacesOfInstall}</h3>
        <ul className="hxp-ifaces">
          {installStates(state, install).map(r => {
            const label = r.state === 'out-of-date' ? updateFor(r.name) : r.state === 'conflict' ? reviewFor(r.name) : r.state === 'not-installed' ? installFor(r.name) : null;
            const words = actionFor(r.state);
            return (
              <li key={r.interfaceId} className="hxp-iface" data-interface={r.interfaceId}>
                <span className="hxp-iface-text">
                  <span className="hxp-iface-name">{r.name}</span>
                  <StateDot tone={stateTone(r.state)}>{stateWords(r.state)}</StateDot>
                </span>
                {words === null || label === null ? null : <HButton size="small" aria-label={label} onClick={() => openFor(ui, project.id, harness.id, r.state)}>{words}</HButton>}
              </li>
            );
          })}
        </ul>
      </section>
      {many ? <HButton icon="minus-circle" aria-label={`${FLOW.label.removeFromProject}: ${harness.name}`} onClick={remove}>{FLOW.label.removeFromProject}</HButton> : null}
    </div>
  );
}

function Details({ state, project }: { state: HarnessState; project: Project }): ReactElement {
  const ui = useUi(), store = useHarnessStore();
  const installs = installsOfProject(state, project.id), many = installs.length > 1;
  const only = installs[0], onlyHarness = only === undefined ? undefined : harnessById(state, only.harnessId);
  const removeOnly = (): void => { if (onlyHarness !== undefined) removeWithNote(store, ui, project.id, onlyHarness); };
  return (
    <>
      <DetailsHead tile={<Tile name="folder" size="large" />} title={project.name} subtitle={FLOW.label.project} />
      <PathDisclosure path={project.path} subject={project.name} key={project.id} />
      {installs.length === 0 ? <p className="hx-text hx-muted">{FLOW.label.noHarnessYet}</p> : installs.map(install => {
        const harness = harnessById(state, install.harnessId);
        return harness === undefined ? null : <InstallBlock key={install.harnessId} state={state} store={store} ui={ui} project={project} install={install} harness={harness} many={many} />;
      })}
      <div className="hxp-wide">
        <HButton icon="harness" onClick={() => ui.openInstall({ projectId: project.id, harnessId: null, step: 'project' })}>{installs.length === 0 ? FLOW.label.assignHarness : FLOW.label.assignAnother}</HButton>
        {installs.length === 0 || many ? null : <HButton icon="minus-circle" onClick={removeOnly}>{FLOW.label.removeFromProject}</HButton>}
      </div>
      {installs.length === 0 ? null : <p className="hx-text hx-muted">{FLOW.hint.removeNote}</p>}
    </>
  );
}

export function Projects({ id }: { id: string | null }): ReactElement {
  const state = useHarnessState(), ui = useUi();
  const notYet = notYetWords(state.real !== undefined);
  const selected = state.projects.find(p => p.id === id) ?? (id === null ? state.projects[0] : undefined);
  if (id !== null && selected === undefined) {
    return (
      <Screen slot="projects" title={WORDS.label.projects}>
        <p className="kit-hint hx-hint">{FLOW.hint.noProject}</p>
        <div className="hx-actions"><HButton onClick={() => go({ name: 'projects' })}>{WORDS.label.projects}</HButton></div>
      </Screen>
    );
  }
  return (
    <Screen slot="projects" title={WORDS.label.projects}
      tools={<>
        <HButton icon="folder" data-open-adopt="" onClick={() => ui.openAdopt()}>{ENGINE_WORDS.label.fromFolder}</HButton>
        <HButton icon="harness" data-open-project="" onClick={() => ui.openProject()}>{ENGINE_WORDS.label.installFolder}</HButton>
        <HButton icon="save-clock" data-open-save="" onClick={() => ui.openSave()}>{ENGINE_WORDS.label.editFolder}</HButton>
        <HIconButton icon="plus" label={FLOW.label.addFolder} tip={notYet} side="below-end" aria-disabled="true" onClick={e => { e.preventDefault(); ui.showToast(notYet); }} />
      </>}
      details={selected === undefined ? undefined : <Details state={state} project={selected} />}>
      <p className="kit-hint hx-hint">{projectsHint(state.projects.length)}</p>
      <ul className="hxp-rows" aria-label={FLOW.label.projectRows}>
        {state.projects.map(p => <Row key={p.id} state={state} project={p} selected={selected?.id === p.id} onPick={() => go({ name: 'projects', id: p.id })} />)}
      </ul>
    </Screen>
  );
}
