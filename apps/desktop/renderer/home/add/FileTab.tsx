/**
 * The "From a shared file" tab. A drop area and a "Choose a file" button read the file, say in plain words what opening it would add, what is already
 * here, and which things have two different copies, and wait for "Add these". Nothing is added before that press. No file path is ever drawn. The
 * reading, the preview and the commit are `readSharedFile` (shared/home/add-file.ts), which uses the 0.7 bundle logic; this file only draws its result.
 */
import { useEffect, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, ReactElement } from 'react';
import { FILE_IDLE, FILE_KIND_ORDER, FILE_MAX_BYTES, addsNothing, capList, countOf, readSharedFile, stepAfterAdd, stepFromResult } from '../../../shared/home/add-file.js';
import type { FileStep, FileThing, FileThingKind, SharedFilePreview } from '../../../shared/home/add-file.js';
import type { NameOf } from '../../../shared/home/add-model.js';
import type { Bundle, World } from '../../../shared/proto/types.js';
import { Button } from '../kit/Button.js';
import { KitIcon } from '../kit/icons.js';
import type { KitIconName } from '../kit/icons.js';
import { ADD_WORDS, fileAdded, keysNeeded, kindCount, kindWord, moreCount } from './add-words.js';

const L = ADD_WORDS.label, H = ADD_WORDS.hint;
const ICON: Readonly<Record<FileThingKind, KitIconName>> = { skill: 'skill', agent: 'agent', tool: 'tool', note: 'note' };
/** How many names a list shows before "and N more". */
const SHOWN = 6;

export interface FileTabProps {
  world: World;
  nameOf: NameOf;
  /** Adds what the file holds to the draft. */
  stageFile(bundle: Bundle): void;
  /** The text of a small file to offer under "Try a sample file". The Add test page passes one; the shell does not. */
  sampleFile?: string;
}

function Names({ names }: { names: readonly string[] }): ReactElement {
  const { shown, more } = capList(names, SHOWN);
  return (
    <ul className="add-names">
      {shown.map(n => <li key={n}>{n}</li>)}
      {more > 0 ? <li className="kit-hint">{moreCount(more)}</li> : null}
    </ul>
  );
}

function Preview({ preview, onAdd, onAnother }: { preview: SharedFilePreview; onAdd(): void; onAnother(): void }): ReactElement {
  const nothing = addsNothing(preview);
  const { shown, more } = capList(preview.added, SHOWN);
  return (
    <div className="add-preview" data-step="preview">
      {nothing ? <p className="add-lead" role="status">{H.fileNothing}</p> : (
        <section className="add-section" aria-labelledby="add-will-add">
          <h3 className="kit-heading" id="add-will-add">{L.willAdd}</h3>
          <p className="kit-hint">{FILE_KIND_ORDER.filter(k => countOf(preview, k) > 0).map(k => kindCount(k, countOf(preview, k))).join(', ')}</p>
          <ul className="add-things">
            {shown.map((t: FileThing, i) => (
              <li key={`${t.kind}-${t.name}-${i}`}><KitIcon name={ICON[t.kind]} size={20} /><span className="hm-sr">{kindWord(t.kind)}: </span><span>{t.name}</span></li>
            ))}
            {more > 0 ? <li className="kit-hint">{moreCount(more)}</li> : null}
          </ul>
          {preview.keysNeeded > 0 ? <p className="kit-hint">{keysNeeded(preview.keysNeeded)}</p> : null}
        </section>
      )}
      {preview.differentCopies.length > 0 ? (
        <section className="add-section" aria-labelledby="add-two-copies">
          <h3 className="kit-heading" id="add-two-copies">{L.differentCopies}</h3>
          <p className="kit-hint">{H.bothKept}</p>
          <Names names={preview.differentCopies} />
        </section>
      ) : null}
      {preview.alreadyHere.length > 0 ? (
        <section className="add-section" aria-labelledby="add-already">
          <h3 className="kit-heading" id="add-already">{L.alreadyHere}</h3>
          <p className="kit-hint">{H.notAgain}</p>
          <Names names={preview.alreadyHere} />
        </section>
      ) : null}
      <div className="add-actions">
        {nothing ? null : <Button variant="primary" icon="plus" onClick={onAdd}>{L.addThese}</Button>}
        <Button onClick={onAnother}>{L.chooseAnother}</Button>
      </div>
    </div>
  );
}

export function FileTab({ world, nameOf, stageFile, sampleFile }: FileTabProps): ReactElement {
  const [step, setStep] = useState<FileStep>(FILE_IDLE);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const counter = useRef(0);

  // A file let go outside the drop area must not make the window open it.
  useEffect(() => {
    const stop = (e: DragEvent): void => { if (e.dataTransfer?.types.includes('Files') === true) e.preventDefault(); };
    window.addEventListener('dragover', stop); window.addEventListener('drop', stop);
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop); };
  }, []);

  const open = async (read: () => Promise<string>, size: number): Promise<void> => {
    counter.current += 1;
    const mine = counter.current;
    if (size > FILE_MAX_BYTES) { setStep({ step: 'failed', reason: 'too-large' }); return; }
    setStep({ step: 'reading' });
    let text: string;
    try { text = await read(); } catch { if (mine === counter.current) setStep({ step: 'failed', reason: 'unreadable' }); return; }
    if (mine === counter.current) setStep(stepFromResult(readSharedFile(text, world, nameOf)));
  };
  const openFile = (file: File | undefined): void => { if (file !== undefined) void open(() => file.text(), file.size); };
  const openSample = (): void => { if (sampleFile !== undefined) void open(() => Promise.resolve(sampleFile), sampleFile.length); };
  const drop = (e: ReactDragEvent<HTMLDivElement>): void => { e.preventDefault(); setOver(false); openFile(e.dataTransfer.files[0]); };
  const hasFile = (e: ReactDragEvent<HTMLDivElement>): boolean => e.dataTransfer.types.includes('Files');
  const again = (): void => { counter.current += 1; setStep(FILE_IDLE); if (input.current !== null) input.current.value = ''; };

  if (step.step === 'preview') return <Preview preview={step.preview} onAdd={() => { stageFile(step.preview.bundle); setStep(stepAfterAdd(step)); }} onAnother={again} />;
  if (step.step === 'done') return (
    <div className="add-preview" data-step="done">
      <p className="add-lead" role="status"><KitIcon name="check" size={20} />{fileAdded(step.count)}</p>
      <div className="add-actions"><Button onClick={again}>{L.chooseAnother}</Button></div>
    </div>
  );
  if (step.step === 'failed') return (
    <div className="add-preview" data-step="failed">
      <p className="add-lead" role="alert">{step.reason === 'too-large' ? H.fileTooLarge : H.fileUnreadable}</p>
      <p className="kit-hint">{H.nothingAdded}</p>
      <div className="add-actions"><Button onClick={again}>{L.chooseAnother}</Button></div>
    </div>
  );
  return (
    <div className="add-file" data-step={step.step}>
      <div className="add-drop" role="group" aria-label={L.dropArea} data-over={over ? '' : undefined}
        onDragEnter={e => { if (hasFile(e)) { e.preventDefault(); setOver(true); } }}
        onDragOver={e => { if (hasFile(e)) { e.preventDefault(); setOver(true); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
        onDrop={drop}>
        <KitIcon name="note" size={28} />
        <p className="kit-hint add-drop-text">{over ? H.fileOver : step.step === 'reading' ? H.fileReading : H.fileTip}</p>
        <div className="add-actions">
          <Button variant="primary" onClick={() => input.current?.click()}>{L.chooseFile}</Button>
          {sampleFile === undefined ? null : <Button onClick={openSample}>{L.tryFile}</Button>}
        </div>
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={e => { openFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      </div>
    </div>
  );
}
