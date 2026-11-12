/**
 * Modules (route `modules`, the bundled extension): the stock extensions that ship with the app, one row each, and the one the person opens, run inside this view. A module reads only what the person picks: a project,
 * plus folders in the home folder that the person approved once for that module. The view shows what each module can read, lets the person approve a folder (main opens its own chooser: this page never names a folder)
 * and remove one. Everything stays on this computer. All display logic is in shared/modules/view-model.ts. Structure copied from Local models: Screen, a hint line, then rows with a tile, a name and an action.
 */
import type { ReactElement } from 'react';
import { Screen } from '../Screen.js';
import { HButton } from '../parts/controls.js';
import { HIcon } from '../icons.js';
import { go } from '../router.js';
import { MODULE_WORDS, approvedDay, callWords, moduleCount, moduleRows, ownRouteOf } from '../../../shared/modules/view-model.js';
import type { ModuleRow } from '../../../shared/modules/view-model.js';
import type { ExtensionManifest } from '../../../shared/extensions/types.js';
import { PendingBody } from '../local-models/LocalModels.js';
import type { PendingProps } from '../local-models/LocalModels.js';
import { embeddedPageOf } from './embeds.js';
import { useModules } from './modules-context.js';
import { useModulePlaces } from './useModulePlaces.js';
import type { PlacesView } from '../../../shared/modules/places-flow.js';
import './modules.css';

/** One module of the list. The open one is marked, and says so to a screen reader. */
function ModuleItem({ row, onOpen }: { row: ModuleRow; onOpen(id: string): void }): ReactElement {
  const titleId = `hxm-name-${row.id}`;
  return (
    <li className="hx-row hxm-row" data-module={row.id} data-current={row.current ? '' : undefined} aria-labelledby={titleId}>
      <span className="hx-tile" aria-hidden="true"><HIcon name="monitor" size={20} /></span>
      <div className="hx-row-text"><h2 className="hxm-name" id={titleId}>{row.title}</h2></div>
      <span className="hx-row-action">
        <HButton aria-label={`${MODULE_WORDS.open} ${row.title}`} aria-current={row.current ? 'page' : undefined} onClick={() => onOpen(row.id)}>{MODULE_WORDS.open}</HButton>
      </span>
    </li>
  );
}

export interface ReadsProps {
  readonly title: string;
  readonly sample: boolean;
  readonly hasBridge: boolean;
  /** True in the app on the person's own folders when the window gave no modules bridge, or a partial one. That is a failure with a code. */
  readonly missing: boolean;
  readonly places: PlacesView;
  readonly onApprove: () => void;
  readonly onRemove: (placeId: string) => void;
}

/** What the open module can read, and the folders approved for it. The two rules are said in words, then the folders, then the one button that approves. */
export function ReadsPanel({ title, sample, hasBridge, missing, places, onApprove, onRemove }: ReadsProps): ReactElement {
  const head = `reads-${title}`;
  return (
    <section className="hxm-reads" aria-labelledby={head} data-module-reads="">
      <h2 className="hxm-reads-title" id={head}>{MODULE_WORDS.reads}</h2>
      <ul className="hxm-rules">
        <li>{MODULE_WORDS.readsProject}</li>
        <li>{MODULE_WORDS.readsFolders}</li>
        <li>{MODULE_WORDS.readsLocal}</li>
      </ul>
      {sample ? <p className="kit-hint hx-hint" data-module-state="sample">{MODULE_WORDS.sample}</p> : null}
      {missing ? <p className="hx-text" role="alert" data-module-state="bridge-missing" data-module-code="BRIDGE_MISSING">{MODULE_WORDS.bridgeMissing} Code: BRIDGE_MISSING.</p> : null}
      {!hasBridge && !sample && !missing ? <p className="kit-hint hx-hint" role="status" data-module-state="no-bridge">{MODULE_WORDS.noBridge}</p> : null}
      {hasBridge ? (
        <>
          <h3 className="hxm-folders-title">{MODULE_WORDS.folders}</h3>
          {places.status === 'loading' ? <p className="kit-hint hx-hint" role="status" data-module-state="loading">{MODULE_WORDS.loading}</p> : null}
          {places.status === 'failed' ? <p className="hx-text" role="alert" data-module-state="failed" data-module-code={places.code ?? 'FAILED'}>{callWords(places.code)} Code: {places.code ?? 'FAILED'}.</p> : null}
          {places.status === 'ready' && places.places.length === 0 ? <p className="hx-text" data-module-state="empty">{MODULE_WORDS.noFolders}</p> : null}
          {places.places.length === 0 ? null : (
            <ul className="hxm-places" aria-label={MODULE_WORDS.folders}>
              {places.places.map(place => (
                <li key={place.id} className="hxm-place" data-place={place.id}>
                  <span className="hxm-place-label">{place.label}</span>
                  <span className="hx-row-meta">Approved {approvedDay(place)}</span>
                  <HButton aria-label={`${MODULE_WORDS.remove} ${place.label}`} disabled={places.busy} onClick={() => onRemove(place.id)}>{MODULE_WORDS.remove}</HButton>
                </li>
              ))}
            </ul>
          )}
          <div className="hxm-actions"><HButton icon="folder" disabled={places.busy} onClick={onApprove}>{MODULE_WORDS.approve}</HButton></div>
          <p className="hxm-notice" role="status" data-module-notice="">{places.notice ?? ''}</p>
        </>
      ) : null}
    </section>
  );
}

export interface ModulesBodyProps {
  readonly rows: readonly ModuleRow[];
  readonly selected: ModuleRow | null;
  /** True when the address names a module that is not in the list. */
  readonly missing: boolean;
  readonly reads: ReadsProps | null;
  /** The page of the open module inside the view, or null when it has none. */
  readonly embedded: ReactElement | null;
  readonly onOpen: (id: string) => void;
  readonly onBack: () => void;
  readonly onOpenOwn: (route: string) => void;
}

/** What the stage shows: the hint, the list, and the open module with what it can read and its page. */
export function ModulesBody({ rows, selected, missing, reads, embedded, onOpen, onBack, onOpenOwn }: ModulesBodyProps): ReactElement {
  return (
    <div className="hxm-body">
      <p className="kit-hint hx-hint" data-modules-hint="">{MODULE_WORDS.hint}</p>
      {missing ? <p className="hx-text" role="status" data-modules-state="unknown">{MODULE_WORDS.unknown}</p> : null}
      {rows.length === 0 ? <p className="hx-text" data-modules-state="empty">{MODULE_WORDS.none}</p> : <ul className="hxm-list" aria-label={MODULE_WORDS.list}>{rows.map(row => <ModuleItem key={row.id} row={row} onOpen={onOpen} />)}</ul>}
      {selected === null ? null : (
        <section className="hxm-open" aria-label={selected.title} data-module-open={selected.id}>
          <div className="hxm-open-bar">
            <HButton onClick={onBack}>{MODULE_WORDS.back}</HButton>
            {embedded === null ? <HButton onClick={() => onOpenOwn(selected.route)}>{MODULE_WORDS.openOwn}</HButton> : null}
          </div>
          {reads === null ? null : <ReadsPanel {...reads} />}
          {embedded === null ? <p className="hx-text" data-modules-state="no-embed">{MODULE_WORDS.noEmbed}</p> : embedded}
        </section>
      )}
    </div>
  );
}

/** The page of a module on its own route (shared/modules/view-model.ts: `ownRouteOf`). An installed extension such as the template opens at `#app/extension/<route>`. */
const openOwn = (manifest: ExtensionManifest | undefined): void => { if (manifest !== undefined) go(ownRouteOf(manifest)); };

export function Modules({ id }: { id: string | null }): ReactElement {
  const { bridge, sample, real, listed } = useModules();
  const rows = moduleRows(listed, id);
  const selected = rows.find(r => r.id === id) ?? null;
  const places = useModulePlaces(bridge, selected === null ? null : selected.id);
  const missing = real && bridge === null;
  // The failure is told on the screen. The console line is written once, at launch, by renderer/api/client.ts.
  const Page = selected === null ? undefined : embeddedPageOf(selected.id);
  const reads: ReadsProps | null = selected === null ? null : { title: selected.id, sample, hasBridge: bridge !== null, missing, places: places, onApprove: places.approve, onRemove: places.remove };
  return (
    <Screen slot="modules" title={MODULE_WORDS.title} count={moduleCount(rows)}>
      <ModulesBody rows={rows} selected={selected} missing={id !== null && selected === null} reads={reads} embedded={Page === undefined ? null : <Page />}
        onOpen={next => go({ name: 'modules', id: next })} onBack={() => go({ name: 'modules' })} onOpenOwn={route => openOwn(listed.find(m => m.routes[0] === route))} />
    </Screen>
  );
}

/** The screen while the extension list has not answered yet at launch, or when it answered and this extension is not in it. The same rule as the Local models route. */
export function ModulesPending({ problem = null, skipped = [], loading = true }: PendingProps): ReactElement {
  return (
    <Screen slot="modules" title={MODULE_WORDS.title}>
      {problem === null && !loading ? <p className="kit-hint hx-hint" role="status" data-modules-pending="">{MODULE_WORDS.unavailable}</p> : problem === null ? <p className="kit-hint hx-hint" role="status" data-modules-pending="">{MODULE_WORDS.wait}</p> : null}
      {problem === null ? null : <PendingBody problem={problem} skipped={skipped} loading={false} />}
    </Screen>
  );
}

/** The manifests the view lists, for a caller that holds the whole list. */
export const listedModules = (listed: readonly ExtensionManifest[]): readonly ModuleRow[] => moduleRows(listed, null);
