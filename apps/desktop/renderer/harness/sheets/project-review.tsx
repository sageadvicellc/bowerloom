/**
 * The review of "Install a folder's harness": the lines a person approves first, then the plan. The plan shows, for each interface and each part, the result word and
 * its reason; the plan's notice; the drift report of AGENTS.md and CLAUDE.md with the actions the plan offers and Accept AGENTS.md as the default; what waits
 * for the person's trust, and the skills that wait for it; skills that reach an interface their filter leaves out; every command and every file of code
 * Bowerloom will write, in full; the files that changed since Bowerloom wrote them; the approved weaker rules, ticked now or recorded earlier; every file it
 * changes; and the choices that did not count. The removal and recovery plans are drawn here too. Each plan ends with one tick box that approves its revision.
 *
 * Fields of the plan left out on purpose (U6): file hashes and modes (`before`, `after`, `original` of a change) and the folders a run creates: they are
 * bookkeeping of the packages and the file list already says what changes; `deferred`: every deferred part also has an `absent` loss line with its reason;
 * `sources` and `previousReceipt`: records of where items came from, with no choice for the person here; `kept originals` of a recovery: the notice says
 * where kept copies stay.
 */
import { useRef } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { ENGINE_NAMES } from '../../../shared/engine/types.js';
import type { ApproveLineView, ChangeView, ProjectView, Reconcile, RecoveryView, RemovalView } from '../../../shared/engine/types.js';
import { shortRevision } from '../../../shared/engine/gates.js';
import { StateDot } from '../parts/controls.js';
import {
  CHANGE_TONE, CHANGE_WORDS, DRIFT_WORDS, ENGINE_WORDS, RECOVERY_ACTION_WORDS, RECOVERY_DECISION_WORDS, RECOVERY_NOW_WORDS, RESULT_WORDS, TRUST_WORDS, approvePlanWords,
  changesLine, countsWords, engineHeading, engineList, hiddenWords, ignoredWords, partName, recoveryKindWords, tickedWords,
} from '../words-engine.js';
import { CodeText, ResultDot, Section, TickRow } from './engine-parts.js';

const W = ENGINE_WORDS;
const names = (ids: readonly (keyof typeof ENGINE_NAMES)[]): string => engineList(ids.map(e => ENGINE_NAMES[e]));
const entryName = (entry: string, field: string | null): string => (field === null ? entry : `${entry} (${field})`);

/** The lines a person approves before the plan can be made: each with its interface, its part, its result and its whole reason. */
export function ApproveLines({ lines, ticked, held, onTick }: { lines: readonly ApproveLineView[]; ticked: readonly string[]; held: boolean; onTick(key: string, on: boolean): void }): ReactElement {
  const approvable = lines.filter(l => l.approvable);
  return (
    <Section title={W.label.approveLines} count={tickedWords(approvable.filter(l => ticked.includes(l.key)).length, approvable.length)} slot="approve-lines">
      <p className="hxe-text hxe-muted">{W.paragraph.approveIntro}</p>
      <ul className="hxe-ticks">
        {lines.map(l => {
          const item = (
            <>
              <p className="hxe-row-title"><span className="hxe-sub">{ENGINE_NAMES[l.engine]} · {partName(l.part)}</span><span className="hxe-name">{entryName(l.entry, l.field)}</span><ResultDot result={l.result} /></p>
              <p className="hxe-text">{l.reason}</p>
              {l.text === '' ? null : <CodeText text={l.text} label={`${partName(l.part)} ${entryName(l.entry, l.field)}`} />}
            </>
          );
          // A line whose entry the harness does not hold is shown, and offers no tick (SL3).
          if (!l.approvable) return <li key={l.key} className="hxe-row" data-line-off="">{item}<p className="hxe-text"><StateDot tone="bad">{W.hint.cannotApprove}</StateDot></p></li>;
          return (
            <TickRow key={l.key} slot={l.key} checked={ticked.includes(l.key)} disabled={held} label={W.hint.tickToApprove} name={`${partName(l.part)} ${entryName(l.entry, l.field)} in ${ENGINE_NAMES[l.engine]}`} onChange={on => onTick(l.key, on)}>
              {item}
            </TickRow>
          );
        })}
      </ul>
    </Section>
  );
}

const RECONCILE_WORDS: Readonly<Record<Reconcile, { name: string; text: string }>> = Object.freeze({
  'accept-agents': { name: W.label.acceptAgents, text: W.hint.acceptAgentsText },
  merge: { name: W.label.merge, text: W.hint.mergeNotBuilt },
  'keep-both': { name: W.label.keepBoth, text: W.hint.keepBothText },
});

/**
 * The drift report: which interface reads which file, whether AGENTS.md is there or the install writes it, and the actions the plan offers, with Accept
 * AGENTS.md as the default. Merge is not built yet and says so.
 */
export function DriftReport({ plan, reconcile, held, onReconcile }: { plan: ProjectView; reconcile: Reconcile; held: boolean; onReconcile(r: Reconcile): void }): ReactElement | null {
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const drift = plan.drift;
  if (drift === null) return null;
  const actions = drift.actions, usable: readonly Reconcile[] = actions.filter(r => r !== 'merge');
  const move = (e: KeyboardEvent<HTMLButtonElement>, r: Reconcile): void => {
    if (held) return;
    const at = usable.indexOf(r), last = usable.length - 1;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % (last + 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at + last) % (last + 1) : -1;
    if (next < 0) return;
    e.preventDefault();
    const to = usable[next]!;
    onReconcile(to);
    radios.current[actions.indexOf(to)]?.focus();
  };
  return (
    <Section title={W.label.drift} slot="drift">
      <p className="hxe-text">{W.paragraph.driftIntro} {drift.agents === 'present' ? W.hint.agentsPresent : W.hint.agentsPlanned}</p>
      <ul className="hxe-rows">
        {drift.engines.map(e => (
          <li key={e.engine} className="hxe-row" data-drift-engine={e.engine}>
            <p className="hxe-row-title"><StateDot tone={e.hidden === null ? 'quiet' : 'warn'}>{hiddenWords(ENGINE_NAMES[e.engine], e.hidden)}</StateDot></p>
            <p className="hxe-text hxe-muted">{e.rule}</p>
          </li>
        ))}
      </ul>
      <div className="hxe-reconcile" role="radiogroup" aria-label={W.label.reconcile}>
        {actions.map((r, i) => {
          const off = r === 'merge' || held, on = r === reconcile;
          return (
            <button key={r} ref={el => { radios.current[i] = el; }} type="button" role="radio" className="hxi-choice" aria-checked={on} aria-disabled={off ? true : undefined} data-off={r === 'merge' ? '' : undefined}
              tabIndex={on ? 0 : -1} data-reconcile={r} onClick={() => { if (!off) onReconcile(r); }} onKeyDown={e => move(e, r)}>
              <span className="hxi-choice-name">{RECONCILE_WORDS[r].name}{r === drift.defaultAction ? <span className="hxe-default"> · {W.hint.defaultChoice}</span> : null}</span>
              <span className="hxi-choice-text">{RECONCILE_WORDS[r].text}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function Changes({ changes, title }: { changes: readonly ChangeView[]; title: string }): ReactElement {
  return (
    <Section title={title} count={String(changes.length)} slot="changes">
      <ul className="hxi-files">
        {changes.map(c => (
          <li key={c.path} className="hxi-file" data-file={c.path} data-action={c.action}>
            <span className="hxi-file-path">{c.path}{c.engines.length === 0 ? null : <span className="hxe-muted"> · {names(c.engines)}</span>}</span>
            <StateDot tone={CHANGE_TONE[c.action]}>{CHANGE_WORDS[c.action]}</StateDot>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export interface PlanReviewProps {
  plan: ProjectView;
  writeClaudeMd: boolean;
  approvedRevision: string | null;
  held: boolean;
  onWriteClaude(on: boolean): void;
  onApprove(revision: string | null): void;
}

/** The plan below the drift report. The sheet draws the drift report itself, so it stays in place, with the focus, while a new plan is made (U4, U9). */
export function PlanReview({ plan, writeClaudeMd, approvedRevision, held, onWriteClaude, onApprove }: PlanReviewProps): ReactElement {
  const changing = plan.changes.filter(c => c.action !== 'unchanged');
  return (
    <>
      <p className="hxi-sum">{plan.noop ? W.hint.sameAsNow : changesLine(changing.length, plan.folder)}</p>
      {plan.notice === null ? null : <p className="hxe-notice" data-partial={plan.partial ? '' : undefined} data-notice=""><StateDot tone={plan.partial ? 'warn' : 'quiet'}>{plan.notice}</StateDot></p>}
      {plan.offers.length === 0 && !writeClaudeMd ? null : (
        <ul className="hxe-ticks">
          <TickRow slot="write-claude" checked={writeClaudeMd} disabled={held} label={W.label.writeClaude} name="CLAUDE.md" onChange={onWriteClaude}>{plan.offers.map(o => <p key={o.action} className="hxe-text">{o.reason}</p>)}</TickRow>
        </ul>
      )}
      <Section title={W.label.lossReport} slot="loss">
        {plan.engines.map(e => (
          <div key={e.engine} className="hxe-engine" data-engine={e.engine}>
            <h4 className="hxe-engine-head"><span>{engineHeading(ENGINE_NAMES[e.engine], e.version)}</span><span className="hxe-muted">{countsWords(e.counts)}</span></h4>
            {e.parts.length === 0 ? <p className="hxe-text hxe-muted">{W.hint.noLines}</p> : null}
            {e.parts.map(p => (
              <div key={p.part} className="hxe-group" data-part={p.part}>
                <h5 className="hxe-sub">{partName(p.part)}</h5>
                <ul className="hxe-rows">
                  {p.lines.map((l, i) => (
                    <li key={`${l.entry}${l.field ?? ''}${i}`} className="hxe-row hxe-line" data-result={l.result} data-entry={l.entry}>
                      <p className="hxe-row-title"><span className="hxe-name">{entryName(l.entry, l.field)}</span><ResultDot result={l.result} /></p>
                      <p className="hxe-text">{l.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </Section>
      {plan.filterLeaks.length === 0 ? null : (
        <Section title={W.label.filterLeaks} count={String(plan.filterLeaks.length)} slot="filter-leaks">
          <ul className="hxe-places">{plan.filterLeaks.map(l => <li key={`${l.skill}${l.path}`}><span className="hxe-name">{l.skill}</span> <span className="hxe-mono">{l.path}</span> <span className="hxe-muted">{names(l.engines)}</span></li>)}</ul>
        </Section>
      )}
      {plan.trust.length === 0 ? null : (
        <Section title={W.label.trust} count={String(plan.trust.length)} slot="trust">
          <ul className="hxe-rows">
            {plan.trust.map(t => (
              <li key={`${t.engine}${t.path}${t.entry ?? ''}`} className="hxe-row" data-trust={t.state}>
                <p className="hxe-row-title"><span className="hxe-mono">{t.path}{t.entry === null ? '' : ` · ${t.entry}`}</span><StateDot tone={t.state === 'trusted' ? 'good' : 'warn'}>{`${TRUST_WORDS[t.state]} · ${ENGINE_NAMES[t.engine]}`}</StateDot></p>
                <p className="hxe-text">{t.reason}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {plan.pendingTrust.length === 0 ? null : (
        <Section title={W.label.pendingTrust} count={String(plan.pendingTrust.length)} slot="pending-trust">
          <ul className="hxe-places">{plan.pendingTrust.map(s => <li key={s} className="hxe-name">{s}</li>)}</ul>
        </Section>
      )}
      {plan.review.length === 0 ? null : (
        <Section title={W.label.review} count={String(plan.review.length)} slot="review">
          <p className="hxe-text hxe-muted">{W.hint.shownInFull}</p>
          <ul className="hxe-rows">
            {plan.review.map((r, i) => (
              <li key={`${r.path}${r.entry ?? ''}${i}`} className="hxe-row" data-review={r.kind} data-path={r.path}>
                <p className="hxe-row-title"><span className="hxe-mono">{r.path}</span><span className="hxe-muted">{ENGINE_NAMES[r.engine]}{r.part === null ? '' : ` · ${partName(r.part)}`}{r.entry === null ? '' : ` ${r.entry}`}</span></p>
                <CodeText text={r.text} label={`${r.path} ${ENGINE_NAMES[r.engine]}`} />
                {r.env.length === 0 ? null : (
                  <dl className="hxe-env" aria-label={W.label.environment}>
                    {r.env.map(v => <div key={v.name}><dt className="hxe-mono">{v.name}</dt><dd className={v.value === null ? 'hxe-muted' : 'hxe-mono'}>{v.value ?? W.hint.fromVariable}</dd></div>)}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {plan.driftLines.length === 0 ? null : (
        <Section title={W.label.driftLines} count={String(plan.driftLines.length)} slot="drift-lines">
          <ul className="hxe-places">{plan.driftLines.map(d => <li key={d.path}><StateDot tone="warn">{DRIFT_WORDS[d.reason]}</StateDot> <span className="hxe-mono">{d.path}</span></li>)}</ul>
        </Section>
      )}
      {plan.approved.length === 0 ? null : (
        <Section title={W.label.approved} count={String(plan.approved.length)} slot="approved">
          <ul className="hxe-rows">
            {plan.approved.map(a => (
              <li key={`${a.part}${a.entry}${a.field ?? ''}${a.engine}`} className="hxe-row" data-earlier={a.earlier ? '' : undefined}>
                <p className="hxe-row-title"><span className="hxe-name">{partName(a.part)} {entryName(a.entry, a.field)}</span><span className="hxe-muted">{ENGINE_NAMES[a.engine]} · {RESULT_WORDS[a.result]} · {a.earlier ? W.hint.approvedEarlier : W.hint.approvedNow} · {a.who} · {a.when}</span></p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Changes changes={plan.changes} title={W.label.changes} />
      {plan.ignored.length === 0 ? null : <Section title={W.label.notApplied} slot="ignored">{plan.ignored.map(x => <p key={x.option} className="hxe-text">{ignoredWords(x.option, x.reason)}</p>)}</Section>}
      {plan.noop ? null : (
        <ul className="hxe-ticks hxe-approve" data-approve-plan="">
          <TickRow slot="revision" checked={approvedRevision === plan.revision} disabled={held} label={approvePlanWords(shortRevision(plan.revision))} name={plan.folder} onChange={on => onApprove(on ? plan.revision : null)} />
        </ul>
      )}
    </>
  );
}

export function RemovalReview({ plan, folder, approved, held, onApprove }: { plan: RemovalView; folder: string; approved: boolean; held: boolean; onApprove(on: boolean): void }): ReactElement {
  if (plan.changes.length === 0) return <p className="hxi-sum">{W.hint.nothingToRemove}</p>;
  return (
    <>
      <p className="hxi-sum">{changesLine(plan.changes.length, folder)}</p>
      <p className="hxe-text hxe-muted">{W.paragraph.removeIntro}</p>
      <Changes changes={plan.changes} title={W.label.changes} />
      {plan.removeDirs.length === 0 ? null : <Section title={W.label.folderGone} count={String(plan.removeDirs.length)} slot="dirs"><ul className="hxe-places">{plan.removeDirs.map(d => <li key={d} className="hxe-mono">{d}</li>)}</ul></Section>}
      <ul className="hxe-ticks hxe-approve" data-approve-plan=""><TickRow slot="revision" checked={approved} disabled={held} label={approvePlanWords(shortRevision(plan.revision))} name={folder} onChange={onApprove} /></ul>
    </>
  );
}

export function RecoveryReview({ plan, folder, approved, held, onApprove }: { plan: RecoveryView; folder: string; approved: boolean; held: boolean; onApprove(on: boolean): void }): ReactElement {
  return (
    <>
      <p className="hxi-sum">{plan.action === 'keep' ? W.paragraph.keepIntro : W.paragraph.recoverIntro}</p>
      <p className="hxe-notice" data-recovery-kind={plan.kind ?? 'none'}><StateDot tone="warn">{`${recoveryKindWords(plan.kind)}: ${RECOVERY_ACTION_WORDS[plan.action]}`}</StateDot></p>
      {plan.steps.length === 0 ? null : (
        <Section title={W.label.changes} count={String(plan.steps.length)} slot="steps">
          <ul className="hxi-files">{plan.steps.map(s => <li key={s.path} className="hxi-file" data-file={s.path}><span className="hxi-file-path">{s.path} <span className="hxe-muted">· {RECOVERY_NOW_WORDS[s.now]}</span></span><StateDot tone={s.decision === 'undo' ? 'warn' : 'quiet'}>{RECOVERY_DECISION_WORDS[s.decision]}</StateDot></li>)}</ul>
        </Section>
      )}
      {plan.keep.length === 0 ? null : <Section title={W.label.keepMine} count={String(plan.keep.length)} slot="keep"><ul className="hxe-places">{plan.keep.map(k => <li key={k} className="hxe-mono">{k}</li>)}</ul></Section>}
      {plan.notice === null ? null : <p className="hxe-text">{plan.notice}</p>}
      <ul className="hxe-ticks hxe-approve" data-approve-plan=""><TickRow slot="revision" checked={approved} disabled={held} label={approvePlanWords(shortRevision(plan.revision))} name={folder} onChange={onApprove} /></ul>
    </>
  );
}
