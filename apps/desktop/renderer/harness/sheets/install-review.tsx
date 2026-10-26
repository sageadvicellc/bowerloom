/**
 * The third step of the install sheet (S7.3): every file that would be written, the manifest first and then one list for each interface, each marked New, Update or Conflict.
 * A conflict gets its own panel with three choices and a line that says what each does. "Keep mine" starts highlighted; "Install" waits until the person has pressed a choice for every conflict.
 * Nothing is written in this preview: the list says what the full app would write.
 */
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement, Ref } from 'react';
import { planSummary } from '../../../shared/harness/files.js';
import { CHOICE_WORDS, choiceFor, choiceHint } from '../../../shared/harness/install-flow.js';
import { partsOf, interfaceById } from '../../../shared/harness/status.js';
import { slugOf } from '../../../shared/harness/sample.js';
import { CONFLICT_CHOICES } from '../../../shared/harness/types.js';
import type { ConflictChoice, Harness, HarnessState, InstallPlan, PlannedFile, Project } from '../../../shared/harness/types.js';
import { HButton, StateDot } from '../parts/controls.js';
import { HIcon } from '../icons.js';
import { FILE_TONE, FILE_WORDS, FLOW, conflictTitle, reviewLine, settledWords } from '../words-flow.js';
import './install.css';

function FileRow({ file }: { file: PlannedFile }): ReactElement {
  return (
    <li className="hxi-file" data-file={file.path} data-state={file.state}>
      <span className="hxi-file-path">{file.path}</span>
      <StateDot tone={FILE_TONE[file.state]}>{FILE_WORDS[file.state]}</StateDot>
    </li>
  );
}

/** The text of the harness copy for a conflicting agent file, found by the file name, or undefined. Plain text only. */
function harnessCopy(state: HarnessState, harness: Harness, path: string): string | undefined {
  const slug = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
  return partsOf(state, harness).find(p => p.kind === 'agent' && slugOf(p.name) === slug)?.fileText;
}

interface ConflictProps { state: HarnessState; harness: Harness; file: PlannedFile; choice: ConflictChoice; confirmed: boolean; onChoose(choice: ConflictChoice): void }

function Conflict({ state, harness, file, choice, confirmed, onChoose }: ConflictProps): ReactElement {
  const id = useId();
  const [diff, setDiff] = useState(false);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const copy = harnessCopy(state, harness, file.path);
  const move = (e: KeyboardEvent<HTMLButtonElement>, at: number): void => {
    const last = CONFLICT_CHOICES.length - 1;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % (last + 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at + last) % (last + 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    onChoose(CONFLICT_CHOICES[next]!);
    radios.current[next]?.focus();
  };
  return (
    <section className="hxi-conflict" aria-labelledby={`${id}-title`} data-conflict={file.path} data-settled={confirmed ? '' : undefined}>
      <div className="hxi-conflict-head">
        <h3 className="hxi-conflict-title" id={`${id}-title`}>{conflictTitle(file.path)}</h3>
        <HButton icon="eye" aria-expanded={diff} onClick={() => setDiff(d => !d)}>{diff ? FLOW.label.hideDifference : FLOW.label.showDifference}</HButton>
      </div>
      <div className="hxi-choices" role="radiogroup" aria-label={FLOW.label.conflictChoice}>
        {CONFLICT_CHOICES.map((c, i) => (
          <button key={c} ref={el => { radios.current[i] = el; }} type="button" role="radio" className="hxi-choice" aria-checked={c === choice} tabIndex={c === choice ? 0 : -1} data-choice={c}
            onClick={() => onChoose(c)} onKeyDown={e => move(e, i)}>
            <span className="hxi-choice-name">{CHOICE_WORDS[c]}</span>
            <span className="hxi-choice-text">{choiceHint(c, file.path)}</span>
          </button>
        ))}
      </div>
      {diff ? (
        <div className="hxi-diff">
          <div className="hxi-diff-col"><h4 className="hxi-diff-title">{FLOW.label.yourFile}</h4><p className="hxi-diff-text">{FLOW.hint.yourFileNone}</p></div>
          <div className="hxi-diff-col"><h4 className="hxi-diff-title">{FLOW.label.harnessCopy}</h4><pre className="hxi-diff-text">{copy ?? FLOW.hint.notInPreview}</pre></div>
        </div>
      ) : null}
      <StateDot tone={confirmed ? 'good' : 'warn'}>{confirmed ? settledWords(CHOICE_WORDS[choice]) : FLOW.hint.pickToContinue}</StateDot>
    </section>
  );
}

export interface ReviewProps {
  state: HarnessState;
  harness: Harness;
  project: Project;
  plan: InstallPlan;
  picked: Readonly<Record<string, ConflictChoice>>;
  confirmed: readonly string[];
  introRef: Ref<HTMLParagraphElement>;
  onChoose(path: string, choice: ConflictChoice): void;
}

export function ReviewStep({ state, harness, project, plan, picked, confirmed, introRef, onChoose }: ReviewProps): ReactElement {
  return (
    <>
      <p className="hxi-sum" tabIndex={-1} ref={introRef}>{reviewLine(planSummary(plan), project.path)}</p>
      <div>
        <h3 className="hxi-head"><HIcon name="monitor" size={18} /><span>{FLOW.hint.manifestNote}</span></h3>
        <ul className="hxi-files" aria-label={FLOW.label.manifestKind}><FileRow file={plan.manifest} /></ul>
      </div>
      <div className="hxi-groups">
        {plan.groups.map(group => (
          <div key={group.interfaceId} data-group={group.interfaceId}>
            <h3 className="hxi-head"><HIcon name="monitor" size={18} /><span>{interfaceById(state, group.interfaceId)?.name ?? group.interfaceId}</span></h3>
            <ul className="hxi-files" aria-label={interfaceById(state, group.interfaceId)?.name ?? group.interfaceId}>{group.files.map(f => <FileRow key={f.path} file={f} />)}</ul>
          </div>
        ))}
      </div>
      {plan.conflicts.map(file => (
        <Conflict key={file.path} state={state} harness={harness} file={file} choice={choiceFor(picked, file.path)} confirmed={confirmed.includes(file.path)} onChoose={c => onChoose(file.path, c)} />
      ))}
    </>
  );
}
