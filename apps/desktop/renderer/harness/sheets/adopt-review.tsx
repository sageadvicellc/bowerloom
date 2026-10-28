/**
 * The two review steps of "New harness from a folder" (adoption). Review shows every item with the places it was found, the copies that differ (the person picks one),
 * the rules that differ by interface, every entry that is not carried over with its reason and what it asks, the secrets replaced, and the files it writes.
 * Confirm shows the full words of every approval and every acknowledgement, each with its own tick box. Nothing is ticked for the person.
 */
import { useRef } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { ENGINE_NAMES } from '../../../shared/engine/types.js';
import type { AdoptConflictView, AdoptView, PlaceView } from '../../../shared/engine/types.js';
import { adoptWaits } from '../../../shared/engine/gates.js';
import { StateDot } from '../parts/controls.js';
import { ENGINE_WORDS, GATE_TONE, GATE_WORDS, conflictWords, engineList, partName, readLine, tickedWords, usingWords, waitingWords } from '../words-engine.js';
import { Section, TickRow } from './engine-parts.js';

const W = ENGINE_WORDS;
const where = (p: PlaceView): string => (p.pointer === null ? p.path : `${p.path}#${p.pointer}`);
const engines = (list: readonly (keyof typeof ENGINE_NAMES)[] | null): string => engineList(list === null ? null : list.map(e => ENGINE_NAMES[e]));

function Places({ places }: { places: readonly PlaceView[] }): ReactElement {
  return (
    <ul className="hxe-places" aria-label={W.label.foundIn}>
      {places.map(p => <li key={where(p)}><span className="hxe-mono">{where(p)}</span> <span className="hxe-muted">{engines(p.engines)}</span></li>)}
    </ul>
  );
}

function Conflict({ conflict, onPick }: { conflict: AdoptConflictView; onPick(variant: string): void }): ReactElement {
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const picked = conflict.picked ?? conflict.variants[0]?.key;
  const move = (e: KeyboardEvent<HTMLButtonElement>, at: number): void => {
    const last = conflict.variants.length - 1;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % (last + 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at + last) % (last + 1) : -1;
    if (next < 0) return;
    e.preventDefault();
    onPick(conflict.variants[next]!.key);
    radios.current[next]?.focus();
  };
  return (
    <div className="hxi-conflict" data-conflict={conflict.key} data-settled={conflict.picked === null ? undefined : ''}>
      <p className="hxi-conflict-title">{conflictWords(conflict.id, conflict.variants.length)} {partName(conflict.part)}.</p>
      <div className="hxe-variants" role="radiogroup" aria-label={conflictWords(conflict.id, conflict.variants.length)}>
        {conflict.variants.map((v, i) => (
          <button key={v.key} ref={el => { radios.current[i] = el; }} type="button" role="radio" className="hxi-choice" aria-checked={conflict.picked === v.key} tabIndex={v.key === picked ? 0 : -1}
            data-variant={v.key} onClick={() => onPick(v.key)} onKeyDown={e => move(e, i)}>
            <span className="hxi-choice-name">{v.places.map(p => p.path).join(', ')}</span>
            <span className="hxi-choice-text">{engines([...new Set(v.places.flatMap(p => p.engines))])}</span>
          </button>
        ))}
      </div>
      <StateDot tone={conflict.picked === null ? 'warn' : 'good'}>{conflict.picked === null ? W.hint.pickOne : usingWords(conflict.picked)}</StateDot>
    </div>
  );
}

export function AdoptReview({ view, onPick }: { view: AdoptView; onPick(conflict: string, variant: string): void }): ReactElement {
  const byPart = [...new Set(view.items.map(i => i.part))];
  return (
    <>
      <p className="hxi-sum">{readLine(view.read, view.folder)}</p>
      <p className="hxe-muted hxe-text">{view.harness.description} {engines(view.engines.map(e => e.id))}.</p>
      {view.conflicts.length === 0 ? null : (
        <Section title={W.label.pickCopy} count={String(view.conflicts.length)} slot="conflicts">
          {view.conflicts.map(c => <Conflict key={c.key} conflict={c} onPick={v => onPick(c.key, v)} />)}
        </Section>
      )}
      <Section title={W.label.found} count={String(view.items.length)} slot="items">
        {byPart.map(part => (
          <div key={part} className="hxe-group" data-part={part}>
            <h4 className="hxe-sub">{partName(part)}</h4>
            <ul className="hxe-rows">
              {view.items.filter(i => i.part === part).map(i => (
                <li key={i.key} className="hxe-row" data-item={i.key}>
                  <p className="hxe-row-title"><span className="hxe-name">{i.id}</span><span className="hxe-muted">{engines(i.engines)}</span></p>
                  <Places places={i.places} />
                  {i.notes.map(n => <p key={n} className="hxe-text hxe-muted">{n}</p>)}
                  {i.needsApproval.length === 0 ? null : <StateDot tone="warn">{W.label.approveEach}</StateDot>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
      {view.differences.length === 0 ? null : (
        <Section title={W.label.differ} count={String(view.differences.length)} slot="differences">
          <ul className="hxe-rows">
            {view.differences.map(d => (
              <li key={`${d.action} ${d.pattern}`} className="hxe-row">
                <p className="hxe-row-title"><span className="hxe-name">{d.action}</span><span className="hxe-mono">{d.pattern}</span></p>
                <ul className="hxe-places">{d.rules.map(r => <li key={r.id}><span className="hxe-name">{r.effect}</span> <span className="hxe-muted">{engines(r.engines)}</span></li>)}</ul>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {view.unmapped.length === 0 ? null : (
        <Section title={W.label.notCarried} count={String(view.unmapped.length)} slot="unmapped">
          <ul className="hxe-rows">
            {view.unmapped.map(u => (
              <li key={u.id} className="hxe-row" data-unmapped={u.id}>
                <p className="hxe-row-title"><span className="hxe-mono">{u.pointer === null ? u.path : `${u.path}#${u.pointer}`}</span><StateDot tone={GATE_TONE[u.gate]}>{u.gate === 'acknowledge' && u.acknowledged ? W.label.acknowledged : GATE_WORDS[u.gate]}</StateDot></p>
                <p className="hxe-text">{u.reason}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {view.secrets.length === 0 ? null : (
        <Section title={W.label.secrets} count={String(view.secrets.length)} slot="secrets">
          <ul className="hxe-places">{view.secrets.map(s => <li key={`${s.path}#${s.pointer}`}><span className="hxe-mono">{s.path}#{s.pointer}</span> {W.label.becomes} <span className="hxe-mono">{s.reference}</span></li>)}</ul>
        </Section>
      )}
      {view.warnings.length === 0 ? null : <Section title={W.label.notes} slot="warnings">{view.warnings.map(w => <p key={w} className="hxe-text">{w}</p>)}</Section>}
      {view.problems.length === 0 ? null : (
        <Section title={W.label.problems} slot="problems">{view.problems.map(p => <p key={`${p.code}${p.path}`} className="hxe-text"><StateDot tone="bad">{p.code}</StateDot> <span className="hxe-mono">{p.path}</span> {p.message}</p>)}</Section>
      )}
      <Section title={W.label.filesWritten} count={String(view.files.length)} slot="files">
        <ul className="hxi-files">{view.files.map(f => <li key={f.path} className="hxi-file" data-file={f.path}><span className="hxi-file-path">.bowerloom/{f.path}</span><StateDot tone="good">{W.label.newFile}</StateDot></li>)}</ul>
      </Section>
    </>
  );
}

export interface AdoptConfirmProps {
  view: AdoptView;
  ticked: readonly string[];
  onTick(key: string, on: boolean): void;
  onAcknowledge(id: string, on: boolean): void;
}

export function AdoptConfirm({ view, ticked, onTick, onAcknowledge }: AdoptConfirmProps): ReactElement {
  const waits = adoptWaits(view, ticked);
  const count = (kind: (typeof waits)[number]['kind']): number => waits.filter(w => w.kind === kind).length;
  const acks = view.unmapped.filter(u => u.gate === 'acknowledge'), blocks = view.unmapped.filter(u => u.gate === 'block');
  return (
    <>
      <p className="hxi-sum" data-waiting="">
        <StateDot tone={waits.length === 0 ? 'good' : 'warn'}>{`${W.label.waiting}: ${waitingWords({ conflict: count('conflict'), acknowledge: count('acknowledge'), block: count('block'), problem: count('problem'), approval: count('approval') })}`}</StateDot>
      </p>
      {blocks.length === 0 ? null : (
        <Section title={W.label.fixFirst} slot="blocks">
          <ul className="hxe-rows">{blocks.map(b => <li key={b.id} className="hxe-row"><p className="hxe-mono">{b.path}</p><p className="hxe-text">{b.reason}</p></li>)}</ul>
        </Section>
      )}
      {view.approvals.length === 0 ? null : (
        <Section title={W.label.approveEach} count={tickedWords(view.approvals.filter(a => ticked.includes(a.key)).length, view.approvals.length)} slot="approvals">
          <p className="hxe-text hxe-muted">{W.paragraph.approvalsIntro}</p>
          <ul className="hxe-ticks">
            {view.approvals.map(a => (
              <TickRow key={a.key} slot={a.key} checked={ticked.includes(a.key)} name={W.hint.tickToApprove} onChange={on => onTick(a.key, on)}>
                <p className="hxe-row-title"><span className="hxe-sub">{partName(a.part)}</span><span className="hxe-name">{a.id}</span></p>
                {a.reasons.map(r => <p key={r} className="hxe-text">{r}</p>)}
                <Places places={a.places} />
                {a.secrets.map(s => <p key={`${s.path}${s.pointer}`} className="hxe-text"><span className="hxe-mono">{s.path}#{s.pointer}</span> {W.label.becomes} <span className="hxe-mono">{s.reference}</span></p>)}
              </TickRow>
            ))}
          </ul>
        </Section>
      )}
      {acks.length === 0 ? null : (
        <Section title={W.label.acknowledgeEach} count={tickedWords(acks.filter(u => u.acknowledged).length, acks.length)} slot="acknowledgements">
          <p className="hxe-text hxe-muted">{W.paragraph.acksIntro}</p>
          <ul className="hxe-ticks">
            {acks.map(u => (
              <TickRow key={u.id} slot={u.id} checked={u.acknowledged} name={W.hint.tickToAcknowledge} onChange={on => onAcknowledge(u.id, on)}>
                <p className="hxe-mono">{u.pointer === null ? u.path : `${u.path}#${u.pointer}`}</p>
                <p className="hxe-text">{u.reason}</p>
              </TickRow>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
