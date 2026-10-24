/**
 * The setup and scan screen (spec 6.1, 6.2 and 6.12; journey 1). Six states, one heading each: welcome, places, contents, review,
 * bring in, done. The state of the flow is a pure reducer (shared/proto/setup-flow.ts); what is found comes from shared/proto/scan-places.ts
 * and shared/proto/scan-review.ts. Nothing is read from or written to a disk: bringing in only sends the store an `apply`, and only when
 * the draft has a change in it. With no provider (the shell test) the screen shows the same title and count line as the stub did.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { isDirty, reduceStore, snapshotOf } from '../../shared/proto/store.js';
import type { StoreAction } from '../../shared/proto/store.js';
import { PLACE_GROUPS, buildScan } from '../../shared/proto/scan-places.js';
import type { ScanPlace } from '../../shared/proto/scan-places.js';
import { keepBothProblem } from '../../shared/proto/conflicts.js';
import { INTERFACE_WORDS, buildReview } from '../../shared/proto/scan-review.js';
import type { Review, ReviewConflict } from '../../shared/proto/scan-review.js';
import { BRING_BLOCKED_WORDS, FLOW_STEPS, STEP_COUNT, STEP_TITLES, bringInWords, folderChoices, initialSetup, nestingOf, reduceSetup, settledList, stepNumber, unrelatedEdits } from '../../shared/proto/setup-flow.js';
import type { DraftBaseline, SetupState } from '../../shared/proto/setup-flow.js';
import type { Version, World } from '../../shared/proto/types.js';
import { plural } from '../../shared/words.js';
import { HarnessIcon } from './icons.js';
import { useNavigate } from './nav.js';
import { useOptionalProtoStore } from './harness-session.js';
import type { ProtoSession } from './session.js';
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';
import './setup-screen.css';

/** The label of the version that bringing in makes. */
export const BROUGHT_IN_LABEL = 'Brought in from this computer';

const SHORT_STEPS: Readonly<Record<string, string>> = { welcome: 'Welcome', places: 'Places', contents: 'Contents', review: 'Review', 'bring-in': 'Bring in', done: 'Done' };

// The flow of one session is kept while the person visits another screen. It is keyed by the session's own dispatch function,
// which is the same function for as long as the session lasts, so a new session (a restart) starts at the welcome step.
const kept = new WeakMap<object, SetupState>();
// How many versions there were when the current run began (on the welcome step). Done names only a version made after that, so a second
// run never claims the version of the first.
const startedWith = new WeakMap<object, number>();
// What the draft was when the run began, and after the run's own last edit (a settled conflict). Edits made elsewhere show up as a difference.
const baselines = new WeakMap<object, DraftBaseline>();

/** What Start again does and does not do, in one sentence. It resets this screen only. */
export const START_AGAIN_WORDS = 'Start again resets these steps only; it does not undo changes already made to the harness, which you can drop with Discard on the Harness screen.';
export const START_AGAIN_DONE_WORDS = 'Start again resets these steps only; it does not undo the version or any change already made to the harness, so use Versions to go back and Discard on the Harness screen for changes that wait.';

export function SetupScreen({ world }: ScreenProps): ReactElement {
  const session = useOptionalProtoStore();
  if (session === null) {
    return (
      <div className="page">
        <h1 tabIndex={-1}>{ROUTE_LABELS.setup}</h1>
        <p className="muted">{countLine('setup', world)}</p>
      </div>
    );
  }
  return <SetupFlow session={session} />;
}

const counts = (p: { skills: number; agents: number; tools: number }): string => `${plural(p.skills, 'skill')}, ${plural(p.agents, 'agent')}, ${plural(p.tools, 'tool')}`;

/** The flow with its session. `initial` lets a test draw any step without clicking through the ones before it. */
export function SetupFlow({ session, initial }: { session: ProtoSession; initial?: SetupState }): ReactElement {
  const { state, dispatch } = session;
  const world = state.draft;
  const [flow, send] = useReducer(reduceSetup, undefined, () => initial ?? kept.get(dispatch) ?? initialSetup());
  useEffect(() => { kept.set(dispatch, flow); }, [dispatch, flow]);
  const versionCount = state.committed.versions.length;
  useEffect(() => { if (flow.step === 'welcome') startedWith.set(dispatch, versionCount); }, [dispatch, flow.step, versionCount]);
  const dirtyNow = isDirty(state);
  useEffect(() => { if (flow.step === 'welcome') baselines.set(dispatch, { snapshot: snapshotOf(state.draft), foreign: dirtyNow }); }, [dispatch, flow.step]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocked = unrelatedEdits(baselines.get(dispatch), snapshotOf(state.draft), dirtyNow);

  const places = useMemo(() => buildScan(world), [world]);
  const ids = useMemo(() => new Set(places.map(p => p.id)), [places]);
  const ticked = useMemo(() => flow.ticked.filter(id => ids.has(id)), [flow.ticked, ids]);
  const review = useMemo(() => buildReview(world, ticked), [world, ticked]);

  // A new step moves the keyboard to its heading. The first draw does not: the shell has already put it on the screen's title.
  const heading = useRef<HTMLHeadingElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) heading.current?.focus();
    opened.current = true;
  }, [flow.step]);

  return (
    <div className="page sx-page">
      <div className="sx-top">
        <h1 tabIndex={-1}>{ROUTE_LABELS.setup}</h1>
        {flow.step !== 'welcome' && flow.step !== 'done' && (
          <div className="sx-restart">
            <button type="button" className="btn secondary" aria-describedby="sx-restart-note" onClick={() => send({ type: 'reset' })}>Start again</button>
            <p id="sx-restart-note" className="small muted">{START_AGAIN_WORDS}</p>
          </div>
        )}
      </div>
      <ol className="sx-steps" aria-label="Setup steps">
        {FLOW_STEPS.filter(s => s !== 'done').map(s => {
          const here = stepNumber(flow.step) === stepNumber(s), before = stepNumber(s) < stepNumber(flow.step) || flow.step === 'done';
          return (
            <li key={s} className={here && flow.step !== 'done' ? 'is-here' : before ? 'is-past' : ''} aria-current={here && flow.step !== 'done' ? 'step' : undefined}>
              <span className="sx-num" aria-hidden="true">{stepNumber(s)}</span>
              <span>{SHORT_STEPS[s]}</span>
              {before && <span className="sr">, finished</span>}
            </li>
          );
        })}
      </ol>
      <section className="card sx-card" aria-labelledby="sx-heading">
        <p className="muted small">{flow.step === 'done' ? 'All steps finished' : `Step ${stepNumber(flow.step)} of ${STEP_COUNT}`}</p>
        <h2 id="sx-heading" ref={heading} tabIndex={-1} className="sx-heading">{STEP_TITLES[flow.step]}</h2>
        {flow.step === 'welcome' && <Welcome flow={flow} send={send} choices={folderChoices(world)} />}
        {flow.step === 'places' && <Places flow={flow} send={send} places={places} world={world} />}
        {flow.step === 'contents' && <Contents send={send} places={places} ticked={ticked} />}
        {flow.step === 'review' && <ReviewStep flow={flow} send={send} review={review} session={session} />}
        {flow.step === 'bring-in' && <BringIn flow={flow} send={send} review={review} places={ticked.length} world={world} session={session} blocked={blocked} />}
        {flow.step === 'done' && <Done send={send} review={review} session={session} since={startedWith.get(dispatch) ?? 0} />}
      </section>
    </div>
  );
}

type Send = (action: Parameters<typeof reduceSetup>[1]) => void;

// ---------------------------------------------------------------------------------------------------- 1. welcome

function Welcome({ flow, send, choices }: { flow: SetupState; send: Send; choices: string[] }): ReactElement {
  const both = flow.harnessRoot !== null && flow.knowledgeRoot !== null;
  const nesting = both ? nestingOf(flow.harnessRoot!, flow.knowledgeRoot!) : null;
  const nestingWords = nesting === 'knowledge-inside' ? 'The knowledge root is inside the harness root. That is fine.'
    : nesting === 'harness-inside' ? 'The harness root is inside the knowledge root. That is fine.'
    : nesting === 'same' ? 'Both roots are the same folder. That is fine.'
    : nesting === 'apart' ? 'The two roots are in different places. That is fine.' : '';
  return (
    <>
      <p className="lead">A harness is everything around an AI model that is not the model itself.</p>
      <p>Setup finds the skills, agents, and tools already on this computer, and brings them in as copies. Nothing is read yet.</p>
      {!flow.pickersOpen && <button type="button" className="btn big sx-self" onClick={() => send({ type: 'openPickers' })}>Choose where your harness lives</button>}
      {flow.pickersOpen && (
        <div className="sx-pickers">
          <Picker legend="Harness root" hint="The folder that holds your harness." name="harness-root" choices={choices} value={flow.harnessRoot} onPick={path => send({ type: 'pickHarnessRoot', path })} />
          <Picker legend="Knowledge root" hint="The folder that holds your wiki. It can be inside the harness root." name="knowledge-root" choices={choices} value={flow.knowledgeRoot} onPick={path => send({ type: 'pickKnowledgeRoot', path })} />
        </div>
      )}
      <p className="small muted" role="status">{nestingWords}</p>
      {flow.pickersOpen && (
        <div className="sx-actions">
          <button type="button" className="btn" disabled={!both} aria-describedby="sx-welcome-hint" onClick={() => send({ type: 'next' })}>Continue to the scan</button>
          {!both && <span id="sx-welcome-hint" className="small muted">Pick a folder for each root to go on.</span>}
        </div>
      )}
    </>
  );
}

function Picker({ legend, hint, name, choices, value, onPick }: { legend: string; hint: string; name: string; choices: string[]; value: string | null; onPick: (path: string) => void }): ReactElement {
  return (
    <fieldset className="sx-fieldset">
      <legend>{legend}</legend>
      <p className="small muted">{hint}</p>
      {choices.map(path => (
        <label key={path} className="sx-choice">
          <input type="radio" name={name} value={path} checked={value === path} onChange={() => onPick(path)} />
          <span className="tech">{path}</span>
        </label>
      ))}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------------- 2. places

/** Sets the index that the stagger delay is counted from. The delay itself is in the style sheet, from the motion tokens. */
const stagger = (n: number) => (el: HTMLElement | null): void => { el?.style.setProperty('--i', String(Math.min(n, 24))); };

function Places({ flow, send, places, world }: { flow: SetupState; send: Send; places: ScanPlace[]; world: World }): ReactElement {
  let row = 0;
  // The scan moves the keyboard to its result line, so the new list is read out and the button that was pressed is not lost.
  const found = useRef<HTMLParagraphElement>(null);
  const wasScanned = useRef(flow.scanned);
  useEffect(() => {
    if (flow.scanned && !wasScanned.current) found.current?.focus();
    wasScanned.current = flow.scanned;
  }, [flow.scanned]);
  const everyId = new Set(places.flatMap(p => p.itemIds));
  const total = { skills: 0, agents: 0, tools: 0 };
  for (const item of world.items) if (everyId.has(item.id)) { if (item.kind === 'skill') total.skills += 1; else if (item.kind === 'agent') total.agents += 1; else if (item.kind === 'tool') total.tools += 1; }
  return (
    <>
      <p>Bowerloom looks for the folders where Claude Code, Codex, and OpenCode keep their settings. This shows places and counts only. It reads no file contents.</p>
      <div className="sx-actions">
        <button type="button" className="btn secondary" onClick={() => send({ type: 'back' })}>Back</button>
        <button type="button" className="btn" disabled={flow.scanned} onClick={() => send({ type: 'scan' })}>Look for settings folders</button>
      </div>
      <div aria-live="polite" className="sx-live">
        {flow.scanned && <p ref={found} tabIndex={-1} className="sx-found">Found {plural(places.length, 'place')} with {counts(total)}. An item found in two places is counted in each place below.</p>}
      </div>
      {flow.scanned && (
        <>
          <div className="sx-groups">
            {PLACE_GROUPS.map(g => {
              const here = places.filter(p => p.group === g.id);
              return (
                <section key={g.id} className="sx-group" aria-labelledby={`sx-group-${g.id}`}>
                  <h3 id={`sx-group-${g.id}`}>{g.label}</h3>
                  {here.length === 0 ? <p className="small muted">{g.id === 'older' ? 'No older Bowerloom layouts found.' : 'Nothing found here.'}</p> : (
                    <ul className="sx-places">
                      {here.map(p => (
                        <li key={p.id} className="sx-place sx-reveal" ref={stagger(row++)}>
                          <span className="sx-place-name">{p.label}{p.library && <span className="chip quiet">from a library</span>}</span>
                          <span className="small">{counts(p)}</span>
                          <span className="tech sx-place-path">{p.path}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
          <div className="sx-actions">
            <button type="button" className="btn" onClick={() => send({ type: 'next' })}>Choose which places to read</button>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------- 3. contents

function Contents({ send, places, ticked }: { send: Send; places: ScanPlace[]; ticked: readonly string[] }): ReactElement {
  const on = new Set(ticked);
  // An item found in two ticked places is one item.
  const items = new Set(places.filter(p => on.has(p.id)).flatMap(p => p.itemIds)).size;
  return (
    <>
      <p>Tick the places Bowerloom may read. Only ticked places are read, and only ticked places are counted in the next step.</p>
      <div className="sx-actions">
        <button type="button" className="btn secondary" onClick={() => send({ type: 'tickAll', ids: places.map(p => p.id) })}>Select all</button>
        <button type="button" className="btn secondary" onClick={() => send({ type: 'tickNone' })}>Select none</button>
        <span className="sx-count" role="status" aria-live="polite">{ticked.length} of {places.length} places ticked{ticked.length > 0 ? `, ${plural(items, 'item')} in them` : ''}</span>
      </div>
      <div className="sx-groups">
        {PLACE_GROUPS.filter(g => places.some(p => p.group === g.id)).map(g => (
          <fieldset key={g.id} className="sx-fieldset">
            <legend>{g.label}</legend>
            {places.filter(p => p.group === g.id).map(p => (
              <label key={p.id} className="sx-tick">
                <input type="checkbox" checked={on.has(p.id)} onChange={() => send({ type: 'tick', id: p.id })} />
                <span className="sx-tick-text">
                  <span className="sx-place-name">{p.label}{p.library && <span className="chip quiet">from a library</span>}</span>
                  <span className="small muted">{counts(p)}</span>
                  <span className="tech sx-place-path">{p.path}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="sx-actions">
        <button type="button" className="btn secondary" onClick={() => send({ type: 'back' })}>Back</button>
        <button type="button" className="btn" disabled={ticked.length === 0} aria-describedby="sx-contents-hint" onClick={() => send({ type: 'next' })}>Read the ticked places</button>
        {ticked.length === 0 && <span id="sx-contents-hint" className="small muted">Tick at least one place to go on.</span>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------- 4. review

function ReviewStep({ flow, send, review, session }: { flow: SetupState; send: Send; review: Review; session: ProtoSession }): ReactElement {
  const left = review.conflicts.length;
  // Derived from the world each time: a conflict that came back (Discard, Undo) is not settled.
  const settled = settledList(flow.resolved, review.conflicts);
  // Settling a conflict removes its card, and the keyboard was on that card. It goes to the next unsettled conflict, or to Continue when none is left.
  const next = useRef<string | null>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const settle = (itemId: string, words: string): void => {
    const at = review.conflicts.findIndex(c => c.itemId === itemId);
    next.current = (review.conflicts[at + 1] ?? review.conflicts[at - 1])?.itemId ?? '';
    send({ type: 'resolved', itemId, summary: words });
  };
  useEffect(() => {
    const target = next.current;
    if (target === null) return;
    next.current = null;
    (target === '' ? continueButton.current : document.getElementById(conflictHeadingId(target)))?.focus();
  }, [review]);
  return (
    <>
      <p>Here is what is in the ticked places. Bowerloom has read them. Nothing has been changed.</p>
      <dl className="kv sx-summary">
        <dt>Skills</dt><dd>{review.skills}</dd>
        <dt>Agents</dt><dd>{review.agents}</dd>
        <dt>Tools</dt><dd>{review.tools} ({plural(review.mcp, 'MCP server')}, {plural(review.prompts, 'saved prompt')}, {plural(review.hooks.length, 'hook')})</dd>
      </dl>
      {review.libraryItems.length > 0 && (
        <section aria-labelledby="sx-lib">
          <h3 id="sx-lib">From a library</h3>
          <ul className="sx-list">
            {review.libraryItems.map(l => (
              <li key={`${l.name}${l.version}`}>
                <strong>{plural(l.total, 'item')}</strong> from {l.name} {l.version}: from a library, kept as a reference. Each one is read-only until you copy it.
              </li>
            ))}
          </ul>
        </section>
      )}
      {review.hooks.length > 0 && (
        <section aria-labelledby="sx-hooks">
          <h3 id="sx-hooks">Hooks</h3>
          <p className="small muted">A hook is a script that an interface runs on its own. Bowerloom keeps each one as it is. You cannot edit a hook here.</p>
          <ul className="sx-list">
            {review.hooks.map(h => <li key={h.id}>{h.name} <span className="chip warn"><HarnessIcon name="runs-code" size={14} />runs code</span></li>)}
          </ul>
        </section>
      )}
      {review.needsSecret.length > 0 && (
        <section aria-labelledby="sx-secrets">
          <h3 id="sx-secrets">Needs a secret</h3>
          <p className="small muted">Bowerloom keeps the name of the secret only. It never reads or stores the value.</p>
          <ul className="sx-list">
            {review.needsSecret.map(s => <li key={s.id}>{s.name} needs {s.secretName}, {s.secretKind === 'env' ? 'an environment variable' : 'a keychain entry'}, and it is not set. <span className="chip bad">missing</span></li>)}
          </ul>
        </section>
      )}
      <section aria-labelledby="sx-conflicts">
        <h3 id="sx-conflicts">Same item, different text</h3>
        {review.conflicts.length === 0 && settled.length === 0 && <p className="small muted">No item was found twice with different text.</p>}
        {settled.length > 0 && (
          <ul className="sx-list">
            {settled.map(([id, words]) => <li key={id}><span className="chip good">Settled</span> {words}</li>)}
          </ul>
        )}
        <div className="sx-conflicts">
          {review.conflicts.map(c => <Conflict key={c.itemId} conflict={c} session={session} onSettled={words => settle(c.itemId, words)} />)}
        </div>
      </section>
      <div className="sx-actions">
        <button type="button" className="btn secondary" onClick={() => send({ type: 'back' })}>Back</button>
        <button ref={continueButton} type="button" className="btn" disabled={left > 0} aria-describedby="sx-review-hint" onClick={() => send({ type: 'next' })}>Continue</button>
        {left > 0 && <span id="sx-review-hint" className="small muted">Settle {plural(left, 'item')} above to go on.</span>}
      </div>
    </>
  );
}

/** Sends the store an edit that belongs to this run, and moves the baseline with it, so Bring in can tell its own edits from the ones made elsewhere. */
function dispatchOwn(session: ProtoSession, action: StoreAction): void {
  const before = baselines.get(session.dispatch);
  baselines.set(session.dispatch, { snapshot: snapshotOf(reduceStore(session.state, action).draft), foreign: before?.foreign === true && isDirty(session.state) });
  session.dispatch(action);
}

const conflictHeadingId = (itemId: string): string => `sx-conflict-h-${itemId}`;

const andList = (words: readonly string[]): string => (words.length < 3 ? words.join(' and ') : `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`);

function Conflict({ conflict, session, onSettled }: { conflict: ReviewConflict; session: ProtoSession; onSettled: (words: string) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[]>(() => [...conflict.defaultNames]);
  const [problem, setProblem] = useState<string | null>(null);
  const finds = conflict.variants.map(v => v.interfaces.map(f => INTERFACE_WORDS[f]).join(' and '));
  const settle = (index: number, label: string): void => {
    dispatchOwn(session, { type: 'resolveConflict', itemId: conflict.itemId, keep: index });
    onSettled(`${conflict.name}: kept the ${label} version.`);
  };
  const keepBoth = (): void => {
    const why = keepBothProblem(session.state.draft, conflict.itemId, names);
    setProblem(why);
    if (why !== null) return;
    dispatchOwn(session, { type: 'resolveConflict', itemId: conflict.itemId, keep: 'keep-both', names: names.map(n => n.trim()) });
    onSettled(`${conflict.name}: kept all ${conflict.variants.length} versions under separate names (${names.map(n => n.trim()).join(', ')}).`);
  };
  const panel = `sx-conflict-${conflict.itemId}`;
  return (
    <article className="sx-conflict" aria-label={`Conflict: ${conflict.name}`}>
      <h4 id={conflictHeadingId(conflict.itemId)} tabIndex={-1}>{conflict.name} <span className="chip warn">{conflict.variants.length} different texts</span></h4>
      <p className="small">Found in {andList(finds)}, with different text in each.</p>
      <button type="button" className="btn secondary sx-self" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>Choose a version of {conflict.name}</button>
      {open && (
        <div id={panel} className="sx-picker">
          <div className="sx-variants">
            {conflict.variants.map((v, n) => (
              <section key={v.hash} className="sx-variant" aria-label={`${finds[n]} version`}>
                <h5>{finds[n]} version</h5>
                <p className="tech small">{v.paths.join(', ')}</p>
                <pre className="file sx-text" tabIndex={0} aria-label={`Text of the ${finds[n]} version`}>{v.text}</pre>
                <button type="button" className="btn secondary" onClick={() => settle(v.index, finds[n]!)}>Keep the {finds[n]} version</button>
              </section>
            ))}
          </div>
          <fieldset className="sx-fieldset">
            <legend>Or keep every version under its own name</legend>
            {!conflict.canKeepBoth && <p className="small muted">Tick every place that holds this item to keep more than one version.</p>}
            {conflict.variants.map((v, n) => (
              <label key={v.hash} className="sx-name">
                <span>Name for the {finds[n]} version</span>
                <input type="text" value={names[n] ?? ''} disabled={!conflict.canKeepBoth} onChange={e => setNames(names.map((x, i) => (i === n ? e.target.value : x)))} />
              </label>
            ))}
            <div aria-live="polite" className="small sx-problem">{problem}</div>
            <button type="button" className="btn secondary sx-self" disabled={!conflict.canKeepBoth} onClick={keepBoth}>Keep all {conflict.variants.length} versions</button>
          </fieldset>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------------------------------- 5. bring in, and done

export function BringIn({ flow, send, review, places, world, session, blocked }: { flow: SetupState; send: Send; review: Review; places: number; world: World; session: ProtoSession; blocked: boolean }): ReactElement {
  const words = bringInWords(review, world);
  const bring = (): void => {
    if (blocked) return;
    if (isDirty(session.state)) session.dispatch({ type: 'apply', label: BROUGHT_IN_LABEL });
    send({ type: 'bringIn' });
  };
  return (
    <>
      <p>Bowerloom copies. Your original files stay as they are. {words.keeps}</p>
      <dl className="kv sx-summary">
        <dt>From</dt><dd>{plural(places, 'ticked place')}</dd>
        <dt>In the ticked places</dt><dd>{counts(review)}, and {plural(review.libraryTotal, 'library item')} as references. {words.count}</dd>
        <dt>Harness root</dt><dd className="tech">{flow.harnessRoot}</dd>
        <dt>Knowledge root</dt><dd className="tech">{flow.knowledgeRoot}</dd>
      </dl>
      <div className="sx-actions">
        <button type="button" className="btn secondary" onClick={() => send({ type: 'back' })}>Back</button>
        <button type="button" className="btn big" disabled={blocked} aria-describedby={blocked ? 'sx-bring-blocked' : undefined} onClick={bring}>Bring these in</button>
      </div>
      {blocked && <p id="sx-bring-blocked" className="warning" role="alert">{BRING_BLOCKED_WORDS}</p>}
    </>
  );
}

/** A fallback for a screen drawn with no shell above it (no `NavContext`): it presses the navigation button with this label. The real shell never needs it. */
function navigateWithoutShell(label: string): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Main"] button'));
  buttons.find(b => (b.textContent ?? '').trim() === label)?.click();
}

/** The version that bringing in made during this run: only versions after the first `since` count, so a second run never names the first run's version. */
export function broughtInVersion(versions: readonly Version[], since: number): Version | undefined {
  return [...versions.slice(since)].reverse().find(v => v.label === BROUGHT_IN_LABEL);
}

function Done({ send, review, session, since }: { send: Send; review: Review; session: ProtoSession; since: number }): ReactElement {
  const navigate = useNavigate();
  const made = broughtInVersion(session.state.committed.versions, since);
  return (
    <>
      <p className="sx-done" role="status">Done. {counts(review)} are now in Bowerloom as copies. Your original files were not touched.</p>
      <p>{made !== undefined ? `Version ${made.counter} was made: ${made.label}. It is in Versions.` : 'Your choices needed no change to the harness, so no version was made. The first change you apply makes version 1.'}</p>
      <div className="sx-actions">
        <button type="button" className="btn big" onClick={() => (navigate !== null ? navigate('harness') : navigateWithoutShell(ROUTE_LABELS.harness))}>Go to the Harness screen</button>
        <button type="button" className="btn secondary" aria-describedby="sx-restart-note" onClick={() => send({ type: 'reset' })}>Start again</button>
      </div>
      <p id="sx-restart-note" className="small muted">{START_AGAIN_DONE_WORDS}</p>
    </>
  );
}
