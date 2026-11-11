/**
 * "Add a run": the form for a run that was not recorded from Start. The person picks a project (a folder main knows, by its id), an engine, writes the instruction they gave, and says when it started.
 * Nothing starts: main saves the record in its own state folder and never writes into the project. The form checks the same shape main checks (shared/api/runs.ts), so it never sends what main would refuse.
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { ENGINE_NAMES } from '../../../shared/engine/types.js';
import type { EngineId, FolderInfo } from '../../../shared/engine/types.js';
import { ENGINE_IDS } from '../../../shared/engine/engines.js';
import { RUN_INSTRUCTION_LIMIT } from '../../../shared/api/runs.js';
import { parseRecordInput } from '../../../shared/api/runs-shape.js';
import type { RunView } from '../../../shared/api/runs.js';
import { isoToLocalInput, localInputToIso, runsRefusalWords } from '../../../shared/harness/runs-real.js';
import { Sheet } from '../parts/Sheet.js';
import { HButton } from '../parts/controls.js';
import { useEngine } from '../engine.js';
import { runsCodeOf } from '../../api/client.js';
import { START } from '../words-start.js';
import { RUNS_REAL } from '../runs-real-words.js';
import { useRuns } from './runs-session.js';
import './runs-real.css';

export interface AddRunSheetProps { open: boolean; onClose(): void; onRecorded(run: RunView): void }

export function AddRunSheet({ open, onClose, onRecorded }: AddRunSheetProps): ReactElement | null {
  const runs = useRuns(), engine = useEngine();
  const [folders, setFolders] = useState<readonly FolderInfo[] | null>(null);
  /** True when the list of projects could not be read: the form then says so and offers a retry, and never the words for an empty list. */
  const [foldersFailed, setFoldersFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [folder, setFolder] = useState(''), [which, setWhich] = useState<EngineId>('claude-code'), [instruction, setInstruction] = useState(''), [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState<string | null>(null);

  // Each time the form opens it starts again: the folder list is read, and the time is now.
  useEffect(() => {
    if (!open) return;
    setFolder(''); setWhich('claude-code'); setInstruction(''); setWhen(isoToLocalInput(Date.now())); setBusy(false); setFailed(null); setFolders(null); setFoldersFailed(false);
    if (engine === null) return;
    let live = true;
    engine.folders().then(list => { if (live) setFolders(list); }, () => { if (live) setFoldersFailed(true); });
    return () => { live = false; };
  }, [open, engine, attempt]);

  const startedAt = localInputToIso(when);
  const checked = parseRecordInput({ folderId: folder, engine: which, instruction, startedAt }, Date.now());
  const why = folder === '' ? RUNS_REAL.hint.needProject : instruction.trim() === '' ? RUNS_REAL.hint.needInstruction : startedAt === null || checked === null ? RUNS_REAL.hint.needTime : null;
  const save = (): void => {
    if (runs === null || checked === null || busy) return;
    setBusy(true); setFailed(null);
    runs.recordRun(checked).then(run => { setBusy(false); onRecorded(run); }, error => { setBusy(false); setFailed(runsCodeOf(error)); });
  };
  return (
    <Sheet open={open} title={RUNS_REAL.label.addRun} onClose={onClose} width={600} dataSlot="add-run" note={RUNS_REAL.paragraph.addNote}
      actions={<><HButton onClick={onClose}>{RUNS_REAL.label.cancel}</HButton><HButton variant="primary" data-save-run="" disabled={why !== null || busy || runs === null} aria-describedby={why === null ? undefined : 'har-why'} onClick={save}>{RUNS_REAL.label.saveRun}</HButton></>}>
      {runs === null ? <p className="hxe-text hxe-muted">{RUNS_REAL.hint.noBridge}</p> : (
        <>
          <div className="hrr-field">
            <label className="hrr-label" htmlFor="har-project">{RUNS_REAL.label.project}</label>
            <select id="har-project" className="hrr-control" value={folder} disabled={busy || folders === null || foldersFailed} onChange={e => setFolder(e.target.value)}>
              <option value="">{foldersFailed ? RUNS_REAL.hint.foldersFailed : folders !== null && folders.length === 0 ? RUNS_REAL.hint.noFolders : RUNS_REAL.hint.chooseProject}</option>
              {(folders ?? []).map(f => <option key={f.id} value={f.id}>{`${f.name} (${f.label})`}</option>)}
            </select>
            {foldersFailed ? <p className="hxe-text" role="alert" data-folders-failed="">{RUNS_REAL.hint.foldersFailed} <HButton size="small" data-folders-retry="" onClick={() => setAttempt(n => n + 1)}>{RUNS_REAL.label.tryAgain}</HButton></p> : null}
          </div>
          <div className="hrr-field">
            <label className="hrr-label" htmlFor="har-engine">{RUNS_REAL.label.engine}</label>
            <select id="har-engine" className="hrr-control" value={which} disabled={busy} onChange={e => setWhich(e.target.value as EngineId)}>
              {ENGINE_IDS.map(id => <option key={id} value={id}>{ENGINE_NAMES[id]}</option>)}
            </select>
          </div>
          <div className="hrr-field">
            <label className="hrr-label" htmlFor="har-instruction">{RUNS_REAL.label.instruction}</label>
            <textarea id="har-instruction" className="hrr-control" rows={4} value={instruction} disabled={busy} maxLength={RUN_INSTRUCTION_LIMIT} placeholder={START.hint.placeholder} onChange={e => setInstruction(e.target.value)} />
          </div>
          <div className="hrr-field">
            <label className="hrr-label" htmlFor="har-when">{RUNS_REAL.label.whenStarted}</label>
            <input id="har-when" className="hrr-control" type="datetime-local" value={when} disabled={busy} onChange={e => setWhen(e.target.value)} />
          </div>
          {why === null ? null : <p className="hxe-text hxe-muted" id="har-why" role="status" data-add-why="">{why}</p>}
          {failed === null ? null : <p className="hxe-text" role="alert" data-add-failed="">{runsRefusalWords(failed)}</p>}
        </>
      )}
    </Sheet>
  );
}
