/**
 * Memory (the bundled extension `memory-explorer`, v0.9 lane 4): the person's own notes beside the harness context. The left column reads the Obsidian-style markdown of the folders the person approved for this module and
 * shows four layers: notes, links, tags and links to a missing note. The right column shows the harness context the Library already lists: agents, skills, tools and sets of notes.
 * The screen only reads. It has two buttons, Approve a folder (main opens its own chooser: this page never names a folder) and Remove (which deletes no file). It reads files only through the modules bridge, by the list and the read
 * of an approved folder (shared/memory/read-flow.ts). Every number is a count of the files, and the same number is in a `data-value` attribute for the tests. All display logic is in shared/memory/view-model.ts.
 */
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { Screen } from '../Screen.js';
import { HButton } from '../parts/controls.js';
import { useHarnessState } from '../session.js';
import { useModules } from '../modules/modules-context.js';
import { useModulePlaces } from '../modules/useModulePlaces.js';
import { approvedDay, callWords } from '../../../shared/modules/view-model.js';
import type { PlacesView } from '../../../shared/modules/places-flow.js';
import { MEMORY_LIMITS } from '../../../shared/memory/analytics.js';
import { MEMORY_WORDS, cappedWords, contextStatusOf, contextPages, contextPagesPartial, contextSummary, failedWords, memoryRows, notShownWords, skippedEntriesWords, skippedFoldersWords, truncatedWords, unreadableWords } from '../../../shared/memory/view-model.js';
import type { ContextSummary } from '../../../shared/memory/view-model.js';
import { MEMORY_MODULE_ID, layersArePartial, notesArePartial, totalIsPartial, totalNotes } from '../../../shared/memory/read-flow.js';
import type { MemoryState, PlaceMemory } from '../../../shared/memory/read-flow.js';
import { useMemoryRead } from './useMemoryRead.js';
import './memory.css';

/** One count. The number is drawn, and the same number is in `data-value`, so a test reads the screen's count and not its words. A partial count is a lower bound: it is drawn with a plus sign and carries `data-partial`. */
function Count({ name, label, value, place, partial = false }: { name: string; label: string; value: number; place?: string; partial?: boolean }): ReactElement {
  return (
    <div className="hxmem-count">
      <dt>{label}</dt>
      <dd data-count={name} data-value={value} data-place={place} data-partial={partial ? '' : undefined} title={partial ? MEMORY_WORDS.partialTitle : undefined}>{value}{partial ? '+' : ''}</dd>
    </div>
  );
}

function PlaceBlock({ memory, onRemove, busy }: { memory: PlaceMemory; onRemove: (id: string) => void; busy: boolean }): ReactElement {
  const a = memory.analytics, layers = layersArePartial(memory), notes = notesArePartial(memory);
  return (
    <li className="hxmem-place" data-place={memory.placeId}>
      <div className="hxmem-place-head">
        <h3 className="hxmem-place-label">{memory.label}</h3>
        <HButton aria-label={`${MEMORY_WORDS.remove} ${memory.label}`} disabled={busy} onClick={() => onRemove(memory.placeId)}>{MEMORY_WORDS.remove}</HButton>
      </div>
      {memory.status === 'failed' ? (
        <p className="hx-text" role="alert" data-memory-code={memory.code ?? 'FAILED'}>{failedWords(memory.code ?? 'FAILED')}</p>
      ) : (
        <>
          <dl className="hxmem-counts">{memoryRows(a).map(row => <Count key={row.key} name={row.key} label={row.label} value={row.value} place={memory.placeId} partial={row.key === 'notes' ? notes : layers} />)}</dl>
          {memory.unreadable.map(u => <p key={u.code} className="hx-text hx-muted" data-note="unreadable">{unreadableWords(u.count, u.code)}</p>)}
          {memory.skipped.folders > 0 ? <p className="hx-text hx-muted" data-note="skipped-folders">{skippedFoldersWords(memory.skipped.folders)}</p> : null}
          {memory.skipped.entries > 0 ? <p className="hx-text hx-muted" data-note="skipped-entries">{skippedEntriesWords(memory.skipped.entries)}</p> : null}
          {memory.notShown > 0 ? <p className="hx-text hx-muted" data-note="not-shown">{notShownWords(memory.notShown)}</p> : null}
          {a.capped ? <p className="hx-text hx-muted" data-note="capped">{cappedWords(MEMORY_LIMITS.tagsTotal, MEMORY_LIMITS.missingTotal)}</p> : null}
          {memory.truncated ? <p className="hx-text hx-muted" data-note="truncated">{truncatedWords}</p> : null}
          <h4 className="hxmem-sub">{MEMORY_WORDS.topTags}</h4>
          {a.topTags.length === 0 ? <p className="hx-text hx-muted">{MEMORY_WORDS.noTags}</p> : (
            <ul className="hxmem-list">{a.topTags.map(t => <li key={t.tag} data-tag={t.tag} data-notes={t.notes}><span>{t.tag}</span><span className="hx-row-meta">{t.notes}</span></li>)}</ul>
          )}
          <h4 className="hxmem-sub">{MEMORY_WORDS.missingList}</h4>
          {a.missing.length === 0 ? <p className="hx-text hx-muted">{MEMORY_WORDS.noMissing}</p> : (
            <ul className="hxmem-list">{a.missing.map(m => <li key={m.target} data-missing={m.target.toLowerCase()} data-links={m.count}><span><bdi>{m.target}</bdi></span><span className="hx-row-meta">{m.count}</span></li>)}</ul>
          )}
        </>
      )}
    </li>
  );
}

export interface MemoryViewProps {
  readonly hasBridge: boolean;
  readonly sample: boolean;
  /** True in the app on the person's own folders when the window gave no modules bridge, or a partial one. That is a failure with a code. */
  readonly missing: boolean;
  readonly places: PlacesView;
  readonly memory: MemoryState;
  readonly context: ContextSummary;
  readonly onApprove: () => void;
  readonly onRemove: (placeId: string) => void;
  readonly onRefresh: () => void;
}

/** The whole screen body, drawn from plain data. */
export function MemoryView({ hasBridge, sample, missing, places, memory, context, onApprove, onRemove, onRefresh }: MemoryViewProps): ReactElement {
  const part = context.status === 'partial';
  const noContext = context.agents + context.skills + context.tools + context.sets.length === 0;
  return (
    <div className="hxmem-body" data-memory-explorer="">
      <p className="kit-hint hx-hint">{MEMORY_WORDS.hint}</p>
      <div className="hxmem-columns">
        <section className="hxmem-column" data-column="memory" aria-label={MEMORY_WORDS.memory}>
          <h2 className="hxmem-title">{MEMORY_WORDS.memory}</h2>
          {sample ? <p className="kit-hint hx-hint" data-memory-state="sample">{MEMORY_WORDS.sample}</p> : null}
          {missing ? <p className="hx-text" role="alert" data-memory-code="BRIDGE_MISSING">{MEMORY_WORDS.bridgeMissing} Code: BRIDGE_MISSING.</p> : null}
          {!hasBridge && !sample && !missing ? <p className="kit-hint hx-hint" role="status" data-memory-state="no-bridge">{MEMORY_WORDS.noBridge}</p> : null}
          {hasBridge && !sample ? (
            <>
              {places.status === 'loading' ? <p className="kit-hint hx-hint" role="status">{MEMORY_WORDS.loading}</p> : null}
              {places.status === 'failed' ? <p className="hx-text" role="alert" data-memory-code={places.code ?? 'FAILED'}>{callWords(places.code)} Code: {places.code ?? 'FAILED'}.</p> : null}
              {places.status === 'ready' && places.places.length === 0 ? <p className="hx-text" data-memory-state="empty">{MEMORY_WORDS.noFolders}</p> : null}
              {memory.status === 'failed' ? <p className="hx-text" role="alert" data-memory-code={memory.code ?? 'FAILED'}>{failedWords(memory.code ?? 'FAILED')}</p> : null}
              {memory.status === 'loading' ? <p className="kit-hint hx-hint" role="status" data-memory-state="reading">{MEMORY_WORDS.reading}</p> : null}
              {memory.places.length === 0 ? null : (
                <>
                  <dl className="hxmem-counts"><Count name="total-notes" label={MEMORY_WORDS.totalNotes} value={totalNotes(memory.places)} partial={totalIsPartial(memory.places)} /></dl>
                  <ul className="hxmem-places" aria-label={MEMORY_WORDS.memory}>{memory.places.map(p => <PlaceBlock key={p.placeId} memory={p} onRemove={onRemove} busy={places.busy} />)}</ul>
                </>
              )}
              {places.places.length > 0 && memory.places.length === 0 ? (
                <ul className="hxmem-places">{places.places.map(p => <li key={p.id} className="hxmem-place" data-place={p.id}><span className="hxmem-place-label">{p.label}</span><span className="hx-row-meta">Approved {approvedDay(p)}</span></li>)}</ul>
              ) : null}
              <div className="hxmem-actions">
                <HButton icon="folder" disabled={places.busy} onClick={onApprove}>{MEMORY_WORDS.approve}</HButton>
                {places.places.length > 0 ? <HButton disabled={places.busy || memory.status === 'loading'} onClick={onRefresh}>{MEMORY_WORDS.refresh}</HButton> : null}
              </div>
              <p className="hxm-notice" role="status" data-module-notice="">{places.notice ?? ''}</p>
              <p className="kit-hint hx-hint">{MEMORY_WORDS.linkedNote}</p>
            </>
          ) : null}
        </section>
        <section className="hxmem-column" data-column="context" aria-label={MEMORY_WORDS.context}>
          <h2 className="hxmem-title">{MEMORY_WORDS.context}</h2>
          {context.status === 'not-loaded' ? <p className="hx-text" role="status" data-context-state="not-loaded">{MEMORY_WORDS.contextNotLoaded}</p> : (
            <>
              {context.status === 'partial' ? <p className="hx-text hx-muted" data-context-state="partial">{MEMORY_WORDS.contextPartial}</p> : null}
              <dl className="hxmem-counts">
                <Count name="agents" label={MEMORY_WORDS.agents} value={context.agents} partial={part} />
                <Count name="skills" label={MEMORY_WORDS.skills} value={context.skills} partial={part} />
                <Count name="tools" label={MEMORY_WORDS.tools} value={context.tools} partial={part} />
                <Count name="context-sets" label={MEMORY_WORDS.contextSets} value={context.sets.length} partial={part} />
                <Count name="context-pages" label={MEMORY_WORDS.contextPages} value={contextPages(context)} partial={part || contextPagesPartial(context)} />
              </dl>
              {noContext ? <p className="hx-text hx-muted">{MEMORY_WORDS.noContext}</p> : null}
              {context.sets.length === 0 ? null : (
                <ul className="hxmem-list">{context.sets.map(s => <li key={s.id} data-context-set={s.id}><span>{s.name}</span><span className="hx-row-meta">{s.pages === null ? MEMORY_WORDS.notAvailable : s.pages}</span></li>)}</ul>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** The screen of the route. It holds no data of its own: the folders are main's record, the notes are read through the bridge, and the context is the store's world. */
export function MemoryExplorer(): ReactElement {
  const { bridge, sample, real } = useModules();
  const state = useHarnessState();
  const places = useModulePlaces(bridge, MEMORY_MODULE_ID);
  const memory = useMemoryRead(bridge, places.places, places.status === 'ready');
  // Real launch: until the reader has run, the world holds nothing, and zeros would be false. A read that stopped early or could not read something makes the counts lower bounds.
  const status = contextStatusOf(real, state);
  const context = useMemo(() => contextSummary(state.parts, status), [state.parts, status]);
  return (
    <Screen slot="memory" title={MEMORY_WORDS.title}>
      <MemoryView hasBridge={bridge !== null} sample={sample} missing={real && bridge === null} places={places} memory={memory} context={context} onApprove={places.approve} onRemove={places.remove} onRefresh={memory.refresh} />
    </Screen>
  );
}

