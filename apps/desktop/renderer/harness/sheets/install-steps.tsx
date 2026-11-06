/**
 * The first two steps of the install sheet: pick the harness and the folder (S7.1), and pick the interfaces (S7.2). A harness or a folder is a card that is pressed; the pressed one is a highlight.
 * An interface is a tick, because the person can change it; an interface that is off, not found or has a problem is shown with the reason and cannot be ticked.
 */
import { useState } from 'react';
import type { ReactElement, Ref } from 'react';
import { harnessCountsWords, installOf, stateWords } from '../../../shared/harness/status.js';
import { interfaceLine, selectable } from '../../../shared/harness/install-flow.js';
import type { Harness, HarnessState, InterfaceId, Project } from '../../../shared/harness/types.js';
import { HButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { FLOW } from '../words-flow.js';
import './install.css';

export interface PickProps {
  state: HarnessState;
  harnessId: string | null;
  projectId: string | null;
  asksHarness: boolean;
  asksProject: boolean;
  introRef: Ref<HTMLParagraphElement>;
  onHarness(id: string): void;
  onProject(id: string): void;
}

function HarnessCard({ state, harness, on, onPick }: { state: HarnessState; harness: Harness; on: boolean; onPick(): void }): ReactElement {
  return (
    <li>
      <button type="button" className="hxi-card" aria-pressed={on} data-harness={harness.id} onClick={onPick}>
        <Tile name="harness" />
        <span className="hxi-card-text">
          <span className="hxi-card-name">{harness.name}</span>
          <span className="hxi-card-sub">{harnessCountsWords(state, harness)}</span>
        </span>
      </button>
    </li>
  );
}

function ProjectCard({ project, on, onPick }: { project: Project; on: boolean; onPick(): void }): ReactElement {
  return (
    <li>
      <button type="button" className="hxi-card" aria-pressed={on} data-project={project.id} onClick={onPick}>
        <Tile name="folder" />
        <span className="hxi-card-text">
          <span className="hxi-card-name">{project.name}</span>
          <span className="hxi-card-sub">{project.path}</span>
        </span>
      </button>
    </li>
  );
}

/** Step 1. It asks for the harness when none was given (Assign harness on a project), and for the folder when none was given or the harness is known (Assign to project on a harness). */
export function PickStep({ state, harnessId, projectId, asksHarness, asksProject, introRef, onHarness, onProject }: PickProps): ReactElement {
  const [said, setSaid] = useState(false);
  return (
    <>
      {asksHarness ? (
        <>
          <p className="hxi-intro" tabIndex={-1} ref={introRef}>{FLOW.hint.pickHarness}</p>
          <ul className="hxi-list" aria-label={FLOW.label.harnessChoices}>
            {state.harnesses.map(h => <HarnessCard key={h.id} state={state} harness={h} on={h.id === harnessId} onPick={() => onHarness(h.id)} />)}
          </ul>
        </>
      ) : null}
      {asksProject ? (
        <>
          <p className="hxi-intro" tabIndex={asksHarness ? undefined : -1} ref={asksHarness ? undefined : introRef}>{FLOW.hint.pickFolder}</p>
          <ul className="hxi-list" aria-label={FLOW.label.folders}>
            {state.projects.map(p => <ProjectCard key={p.id} project={p} on={p.id === projectId} onPick={() => onProject(p.id)} />)}
          </ul>
          <span className="hxi-add"><HButton icon="plus" onClick={() => setSaid(true)}>{FLOW.label.addFolder}</HButton></span>
          <p className="hxi-said" role="status">{said ? FLOW.hint.notInPreview : ''}</p>
        </>
      ) : null}
    </>
  );
}

export interface InterfacesProps {
  state: HarnessState;
  harness: Harness;
  projectId: string;
  ticked: readonly InterfaceId[];
  introRef: Ref<HTMLParagraphElement>;
  onToggle(id: InterfaceId): void;
}

/** Step 2. One card for each interface: a tick, its name, a dot and what the harness can and cannot use there. */
export function InterfacesStep({ state, harness, projectId, ticked, introRef, onToggle }: InterfacesProps): ReactElement {
  const install = installOf(state, projectId, harness.id);
  const anyOffered = state.interfaces.some(selectable);
  return (
    <>
      <p className="hxi-intro" tabIndex={-1} ref={introRef}>{FLOW.hint.pickInterfaces}</p>
      <ul className="hxi-list" aria-label={FLOW.label.interfaceChoices}>
        {state.interfaces.map(iface => {
          const line = interfaceLine(state, harness, iface), ok = selectable(iface), on = ok && ticked.includes(iface.id);
          const here = install?.states[iface.id];
          return (
            <li key={iface.id}>
              <label className="hxi-card" data-on={on ? '' : undefined} data-off={ok ? undefined : ''} data-interface={iface.id}>
                <input type="checkbox" className="hxi-check" checked={on} disabled={!ok} onChange={() => onToggle(iface.id)} />
                <span className="hxi-card-text">
                  <span className="hxi-card-name">{iface.name}</span>
                  <StateDot tone={line.tone}>{line.words}</StateDot>
                  {here === undefined || here === 'not-installed' ? null : <span className="hm-sr">{stateWords(here)} in this project.</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {anyOffered ? null : <p className="hxi-intro">{FLOW.hint.noneOffered}</p>}
    </>
  );
}
