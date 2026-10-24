/**
 * The versions and export screen (spec 6.6 and 6.7; journeys 3 and 4). Two tabs: History, and Share.
 * History lists the versions newest first, compares any two, and restores one (a restore makes a NEW version and keeps the history).
 * Share builds an export bundle from the applied harness, "saves" it as a simulated file, and imports that file into a second, separate
 * in-memory Bowerloom that this screen holds. Nothing on this screen changes the first store except `restore`, and nothing is written anywhere.
 * With no provider (the shell test) the screen shows the same title and count line as the stub did.
 */
import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { buildBundle } from '../../shared/proto/bundle.js';
import { EXPORT_PROMISE, bundleText, clashWords, describeExport, installBundle, openExportedFile, secretWords } from '../../shared/proto/export-flow.js';
import { globalScope } from '../../shared/proto/common.js';
import { createStore, isDirty } from '../../shared/proto/store.js';
import type { Store } from '../../shared/proto/store.js';
import type { ImportPreview, Version, World } from '../../shared/proto/types.js';
import { diffCount, diffVersions } from '../../shared/proto/versions-diff.js';
import type { DiffEntry, VersionDiff } from '../../shared/proto/versions-diff.js';
import { plural } from '../../shared/words.js';
import { newColleagueStore } from './export-colleague.js';
import { useOptionalSession } from './setup-session.js';
import type { ProtoSession } from './session.js';
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';
import './versions-screen.css';

export type TabId = 'history' | 'share';
const TABS: readonly { id: TabId; label: string }[] = [{ id: 'history', label: 'History' }, { id: 'share', label: 'Share' }];

export function VersionsScreen({ world }: ScreenProps): ReactElement {
  const session = useOptionalSession();
  if (session === null) {
    return (
      <div className="page">
        <h1 tabIndex={-1}>{ROUTE_LABELS.versions}</h1>
        <p className="muted">{countLine('versions', world)}</p>
      </div>
    );
  }
  return <VersionsView session={session} />;
}

/** The screen with its session. `initialTab` lets a test draw the Share tab without a click. */
export function VersionsView({ session, initialTab = 'history' }: { session: ProtoSession; initialTab?: TabId }): ReactElement {
  const [tab, setTab] = useState<TabId>(initialTab);
  const uid = useId();
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ history: null, share: null });
  const move = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const at = TABS.findIndex(t => t.id === tab);
    const next = e.key === 'ArrowRight' ? TABS[(at + 1) % TABS.length]! : e.key === 'ArrowLeft' ? TABS[(at + TABS.length - 1) % TABS.length]! : e.key === 'Home' ? TABS[0]! : e.key === 'End' ? TABS[TABS.length - 1]! : null;
    if (next === null) return;
    e.preventDefault();
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  };
  return (
    <div className="page vx-page">
      <h1 tabIndex={-1}>{ROUTE_LABELS.versions}</h1>
      <div className="tabs" role="tablist" aria-label="Versions and sharing">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" id={`${uid}-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`${uid}-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            ref={el => { tabRefs.current[t.id] = el; }} onClick={() => setTab(t.id)} onKeyDown={move}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`${uid}-panel-${tab}`} aria-labelledby={`${uid}-tab-${tab}`} className="vx-panel">
        {tab === 'history' ? <History session={session} /> : <Share session={session} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------- A. history

const diffWords = (d: VersionDiff): string => {
  if (d.unreadable) return 'This version could not be read.';
  const n = diffCount(d);
  return n === 0 ? 'Nothing changed' : `${plural(n, 'item')} changed`;
};

const CHANGE_WORDS: Readonly<Record<DiffEntry['change'], string>> = { added: 'Added', removed: 'Removed', changed: 'Changed' };
const KIND_WORDS: Readonly<Record<DiffEntry['kind'], string>> = { skill: 'skill', agent: 'agent', tool: 'tool', slice: 'slice', override: 'project choice' };
const CHANGE_TONE: Readonly<Record<DiffEntry['change'], string>> = { added: 'good', removed: 'bad', changed: 'warn' };

function History({ session }: { session: ProtoSession }): ReactElement {
  const { state, dispatch } = session;
  const versions = state.committed.versions;
  const dirty = isDirty(state);
  const newest = useMemo(() => [...versions].sort((a, b) => b.counter - a.counter), [versions]);
  const counterOf = useMemo(() => new Map(versions.map(v => [v.id, v.counter])), [versions]);
  const sinceParent = useMemo(() => {
    const byId = new Map(versions.map(v => [v.id, v]));
    return new Map(versions.map(v => [v.id, v.parentId === null ? null : (() => { const p = byId.get(v.parentId); return p === undefined ? null : diffVersions(p, v); })()]));
  }, [versions]);
  const [restored, setRestored] = useState<{ from: number; before: number } | null>(null);

  const restore = (v: Version): void => {
    setRestored({ from: v.counter, before: versions.length });
    dispatch({ type: 'restore', versionId: v.id });
  };
  const head = newest[0];
  return (
    <section aria-labelledby="vx-history-h" className="vx-section">
      <h2 id="vx-history-h">History</h2>
      {dirty && (
        <p className="warning" role="status"><span className="chip warn">Unsaved changes</span> Your harness has changes that are not in any version yet. Applying them makes a new version. Restoring a version replaces them.</p>
      )}
      {newest.length === 0 ? (
        <div className="vx-empty">
          <p><strong>No versions yet.</strong></p>
          <p className="muted">Every time you apply your changes, Bowerloom saves a version. Applying makes the first one. Until then there is nothing to compare or restore.</p>
        </div>
      ) : (
        <ol className="vx-versions" aria-label="Versions, newest first">
          {newest.map(v => {
            const diff = sinceParent.get(v.id) ?? null, parent = v.parentId === null ? undefined : counterOf.get(v.parentId);
            const current = head !== undefined && v.id === head.id;
            return (
              <li key={v.id} className="vx-version vx-in">
                <div className="vx-version-head">
                  <h3>Version {v.counter}</h3>
                  {current && <span className="chip good">Current</span>}
                </div>
                <p className="vx-label">{v.label}</p>
                <p className="small muted">{parent === undefined ? 'First version. Nothing came before it.' : `Based on version ${parent}. ${diff === null ? '' : diffWords(diff)}.`}</p>
                {current && !dirty ? <p className="small muted">This is the version you have now.</p> : (
                  <button type="button" className="btn secondary vx-self" aria-label={`Restore this version: version ${v.counter}, ${v.label}`} onClick={() => restore(v)}>Restore this version</button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div aria-live="polite" className="vx-live">
        {restored !== null && (versions.length > restored.before && head !== undefined
          ? <p className="vx-notice vx-in" key={head.id}><span className="chip good">Restored</span> Version {restored.from} was restored as a new version, version {head.counter}. History was kept: all {plural(restored.before, 'earlier version')} are still in the list.</p>
          : <p className="vx-notice"><span className="chip bad">Not restored</span> That version could not be restored. Nothing was changed.</p>)}
      </div>
      <Compare versions={newest} />
    </section>
  );
}

function Compare({ versions }: { versions: readonly Version[] }): ReactElement {
  const [a, setA] = useState<string>(() => versions[1]?.id ?? '');
  const [b, setB] = useState<string>(() => versions[0]?.id ?? '');
  const [shown, setShown] = useState<{ a: Version; b: Version } | null>(null);
  const idA = useId(), idB = useId();
  const enough = versions.length >= 2;
  // The pickers hold ids; a version list that changed since they were set falls back to the two newest.
  const pick = (id: string, fallback: number): string => (versions.some(v => v.id === id) ? id : versions[fallback]?.id ?? '');
  const aId = pick(a, 1), bId = pick(b, 0);
  const result = useMemo(() => (shown === null ? null : { diff: diffVersions(shown.a, shown.b) }), [shown]);
  const compare = (): void => {
    const x = versions.find(v => v.id === aId), y = versions.find(v => v.id === bId);
    if (x !== undefined && y !== undefined) setShown({ a: x, b: y });
  };
  const options = versions.map(v => <option key={v.id} value={v.id}>Version {v.counter}: {v.label}</option>);
  return (
    <section aria-labelledby="vx-compare-h" className="vx-compare">
      <h3 id="vx-compare-h">Compare two versions</h3>
      {!enough ? <p className="muted">Comparing needs two versions. {versions.length === 0 ? 'There are none yet.' : 'There is one so far.'}</p> : (
        <div className="vx-pickers">
          <label htmlFor={idA} className="vx-pick"><span>Compare this version</span>
            <select id={idA} value={aId} onChange={e => setA(e.target.value)}>{options}</select></label>
          <label htmlFor={idB} className="vx-pick"><span>with this version</span>
            <select id={idB} value={bId} onChange={e => setB(e.target.value)}>{options}</select></label>
          <button type="button" className="btn vx-self" onClick={compare}>Compare</button>
        </div>
      )}
      <div aria-live="polite" className="vx-live">
        {shown !== null && result !== null && (
          <div className="vx-result vx-in" key={`${shown.a.id}-${shown.b.id}`}>
            <h4>From version {shown.a.counter} to version {shown.b.counter}</h4>
            {result.diff.unreadable ? <p>One of these versions could not be read.</p>
              : shown.a.id === shown.b.id ? <p>These are the same version.</p>
              : result.diff.entries.length === 0 ? <p>These two versions are the same. Nothing was added, removed, or changed.</p> : (
                <>
                  <p>{plural(result.diff.entries.length, 'item')} differ: {result.diff.added.length} added, {result.diff.removed.length} removed, {result.diff.changed.length} changed.</p>
                  <ul className="vx-diff">
                    {result.diff.entries.map(e => (
                      <li key={`${e.change}${e.kind}${e.name}`}><span className={`chip ${CHANGE_TONE[e.change]}`}>{CHANGE_WORDS[e.change]}</span> <span className="muted">{KIND_WORDS[e.kind]}</span> {e.name}</li>
                    ))}
                  </ul>
                </>
              )}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------- B. share

const countsOf = (w: World): { skills: number; agents: number; tools: number; slices: number } => ({
  skills: w.items.filter(i => i.kind === 'skill' && i.library === null).length,
  agents: w.items.filter(i => i.kind === 'agent' && i.library === null).length,
  tools: w.items.filter(i => i.kind === 'tool').length,
  slices: w.slices.length,
});

/** The last exported file, as text. It is plain JSON, so opening it proves that the bundle travels. */
interface SavedFile { readonly text: string; readonly scopes: string }

function Share({ session }: { session: ProtoSession }): ReactElement {
  const { state } = session;
  const world = state.committed;
  const dirty = isDirty(state);
  const [selected, setSelected] = useState<readonly string[]>(() => { const g = globalScope(world); return g === undefined ? [] : [g.id]; });
  const chosen = selected.filter(id => world.scopes.some(s => s.id === id));
  const chosenKey = chosen.join('\u0000');
  const bundle = useMemo(() => buildBundle(world, chosen), [world, chosenKey]);
  const summary = useMemo(() => describeExport(bundle, world), [bundle, world]);
  const [saved, setSaved] = useState<SavedFile | null>(null);
  const [savedNow, setSavedNow] = useState(false);

  const toggle = (id: string): void => { setSelected(chosen.includes(id) ? chosen.filter(s => s !== id) : [...chosen, id]); setSavedNow(false); };
  const save = (): void => { setSaved({ text: bundleText(bundle), scopes: chosen.map(id => world.scopes.find(s => s.id === id)?.name ?? id).join(', ') }); setSavedNow(true); };
  const nothing = summary.skills + summary.agents + summary.tools.length + summary.slices.length === 0;

  return (
    <section aria-labelledby="vx-share-h" className="vx-section">
      <h2 id="vx-share-h">Share</h2>
      <section aria-labelledby="vx-export-h" className="card vx-card">
        <h3 id="vx-export-h">Export</h3>
        <p>Pick the harnesses to put in a file. You can send the file to someone else.</p>
        {dirty && <p className="small muted">Only applied work is exported. Your unsaved changes are not in the file.</p>}
        <fieldset className="vx-fieldset">
          <legend>Harnesses to export</legend>
          {world.scopes.map(s => (
            <label key={s.id} className="vx-choice">
              <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />
              <span>{s.name} <span className="muted small">({s.kind === 'global' ? 'global harness' : 'project'})</span></span>
            </label>
          ))}
        </fieldset>
        <div aria-live="polite" className="vx-live">
          <h4>What the file holds</h4>
          {nothing ? <p className="muted">Tick a harness to see what its file would hold.</p> : (
            <>
              <p><strong>{plural(summary.skills, 'skill')}, {plural(summary.agents, 'agent')}, {plural(summary.tools.length, 'tool reference')}, {plural(summary.slices.length, 'slice rule')}.</strong> About {Math.max(1, Math.round(summary.bytes / 1024))} KB. Library items are not in the file.</p>
              {summary.tools.length > 0 && (
                <>
                  <h5>Tool references</h5>
                  <ul className="vx-lines">
                    {summary.tools.map(t => <li key={t.id}>{t.name}, {t.kindWords}.{t.secretWords !== null && <span className="muted"> Needs a secret: {t.secretWords}.</span>}</li>)}
                  </ul>
                </>
              )}
              {summary.slices.length > 0 && (
                <>
                  <h5>Slice rules</h5>
                  <ul className="vx-lines">{summary.slices.map(s => <li key={s.name}><strong>{s.name}.</strong> {s.words}</li>)}</ul>
                </>
              )}
            </>
          )}
          <p className="vx-promise">{EXPORT_PROMISE}</p>
        </div>
        <div className="vx-actions">
          <button type="button" className="btn" disabled={nothing} onClick={save}>Save file</button>
          <span aria-live="polite" className="vx-saved">{savedNow ? 'Saved as a file (simulated)' : ''}</span>
        </div>
      </section>
      <Colleague saved={saved} />
    </section>
  );
}

function Colleague({ saved }: { saved: SavedFile | null }): ReactElement {
  const [store, setStore] = useState<Store>(newColleagueStore);
  const theirs = store.getState().committed;
  const [opened, setOpened] = useState<{ preview: ImportPreview; text: string; installed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installedCounts, setInstalledCounts] = useState<ReturnType<typeof countsOf> | null>(null);

  const open = (text: string): void => {
    // The file travels as plain text: parsed again here, as the other Bowerloom would read it from disk.
    const result = openExportedFile(text, theirs);
    if (result.ok) { setOpened({ preview: result.preview, text, installed: false }); setError(null); setInstalledCounts(null); } else { setOpened(null); setError(result.message); }
  };
  const install = (): void => {
    if (opened === null) return;
    const result = installBundle(opened.text, theirs);
    if (!result.ok) { setError(result.message); return; }
    setStore(createStore(result.world));
    setInstalledCounts(countsOf(result.world));
    setOpened({ ...opened, installed: true });
    setError(null);
  };
  const c = countsOf(theirs);
  return (
    <section aria-labelledby="vx-import-h" className="card vx-card">
      <h3 id="vx-import-h">Colleague&apos;s Bowerloom</h3>
      <p>This is a second Bowerloom, kept in memory, as if on someone else&apos;s computer. Opening a file here changes nothing in your own harness.</p>
      <p className="small muted">Their harness now has {plural(c.skills, 'skill')}, {plural(c.agents, 'agent')}, {plural(c.tools, 'tool')}, and {plural(c.slices, 'slice')}.</p>
      <div className="vx-actions">
        <button type="button" className="btn" disabled={saved === null} aria-describedby="vx-open-hint" onClick={() => saved !== null && open(saved.text)}>Open an exported file</button>
        <button type="button" className="btn secondary" disabled={saved === null} aria-describedby="vx-open-hint" onClick={() => saved !== null && open(saved.text.slice(0, Math.floor(saved.text.length / 2)))}>Open a damaged file (to see the error)</button>
        <span id="vx-open-hint" className="small muted">{saved === null ? 'Save a file under Export first.' : `The last file holds: ${saved.scopes}.`}</span>
      </div>
      <div role="alert" aria-live="assertive" className="vx-error-live">{error !== null && <p className="vx-error"><span className="chip bad">Could not open</span> {error}</p>}</div>
      <div aria-live="polite" className="vx-live">
        {opened !== null && (
          <div className="vx-preview vx-in">
            <h4>{opened.installed ? 'What the install did' : 'What opening this file would do'}</h4>
            <p className="small muted">Nothing has run. Nothing is written until you press Install.</p>
            <h5>Files that would be written ({opened.preview.files.length})</h5>
            <ul className="vx-lines vx-files">
              {opened.preview.files.map(f => <li key={f.path}><span className="chip quiet">{f.action}</span> <span className="tech">{f.path}</span></li>)}
            </ul>
            <h5>Secrets you must add ({opened.preview.secretsToAdd.length})</h5>
            {opened.preview.secretsToAdd.length === 0 ? <p className="small muted">None.</p> : (
              <>
                <p className="small muted">The file never holds a secret value. Add each one where the interface keeps it.</p>
                <ul className="vx-lines">{opened.preview.secretsToAdd.map(s => <li key={`${s.kind}${s.name}`}>{secretWords(s)}</li>)}</ul>
              </>
            )}
            <h5>Clashes ({opened.preview.clashes.length})</h5>
            {opened.preview.clashes.length === 0 ? <p className="small muted">None. Nothing here meets something that is already there.</p>
              : <ul className="vx-lines">{opened.preview.clashes.map(k => <li key={k.itemId}>{clashWords(k)}</li>)}</ul>}
            {!opened.installed && <button type="button" className="btn vx-self" onClick={install}>Install</button>}
          </div>
        )}
        {installedCounts !== null && (
          <p className="vx-notice vx-in"><span className="chip good">Installed</span> Their harness now has {plural(installedCounts.skills, 'skill')}, {plural(installedCounts.agents, 'agent')}, {plural(installedCounts.tools, 'tool')}, and {plural(installedCounts.slices, 'slice')}. Your own harness was not changed.</p>
        )}
      </div>
    </section>
  );
}
