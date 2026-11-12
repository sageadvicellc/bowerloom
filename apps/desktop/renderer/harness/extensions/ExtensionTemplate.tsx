/**
 * The template extension (v0.9). It is the smallest screen that follows every rule of the extension API (docs/v0.9/extension-api.md), and a new stock extension is made by copying it
 * (`node tools/extension-kit.mjs new <id>` does the copy).
 *  - It is mounted by the table in extension-mounts.tsx, and only when main loaded the manifest apps/desktop/extensions/extension-template/manifest.json. With no manifest there is no route.
 *  - It reads only through the calls the page hands down (useLocal), which come from the engine API client. It names no bridge, no channel and no transport, and it calls no file, process or network.
 *  - Its one read is `listExtensions`, a read-only call with no argument. A refusal shows as its short code. A window with no bridge says so.
 * The screen is split in two: readInstalled makes the state, and ExtensionTemplateView draws a state. Both are plain, so a test drives them without a window.
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { refusalCode } from '../../../shared/api/calls.js';
import type { LocalBridge } from '../../../shared/local-models/types.js';
import { Screen } from '../Screen.js';
import { useLocal } from '../local-models/local.js';

/** What the screen knows. `waiting` is the state before the first answer. */
export type TemplateState =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'no-bridge' }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'listed'; readonly titles: readonly string[]; readonly skipped: number };

/** Asks the one read of this screen. It never throws: a call that throws at once, or is refused, gives the short code of the refusal. */
export async function readInstalled(bridge: LocalBridge | null): Promise<TemplateState> {
  if (bridge === null) return { kind: 'no-bridge' };
  try {
    // `new Promise` runs the call at once and turns a throw into a rejection.
    const listing = await new Promise<Awaited<ReturnType<LocalBridge['listExtensions']>>>(resolve => resolve(bridge.listExtensions()));
    return { kind: 'listed', titles: listing.extensions.map(x => x.title), skipped: listing.skipped.length };
  } catch (error) {
    return { kind: 'refused', code: refusalCode(error, 'local') };
  }
}

/** Draws one state. It holds no data of its own. */
export function ExtensionTemplateView({ state }: { state: TemplateState }): ReactElement {
  return (
    <section className="hx-text" data-extension="extension-template" data-state={state.kind}>
      <p>This screen shows how an extension reads. It asks the app for the list of installed extensions and shows their titles.</p>
      {state.kind === 'waiting' ? <p className="hx-muted" role="status">Reading the list of extensions.</p> : null}
      {state.kind === 'no-bridge' ? <p className="hx-muted" role="status">This window has no connection to the app, so the list cannot be read.</p> : null}
      {state.kind === 'refused' ? <p className="hx-muted" role="status">The list could not be read. The code is {state.code}.</p> : null}
      {state.kind === 'listed' ? (
        <>
          <ul>{state.titles.map((title, i) => <li key={`${i}-${title}`}>{title}</li>)}</ul>
          {state.skipped > 0 ? <p className="hx-muted">{state.skipped} extension folders could not be loaded.</p> : null}
        </>
      ) : null}
    </section>
  );
}

export function ExtensionTemplate(): ReactElement {
  const { bridge } = useLocal();
  const [state, setState] = useState<TemplateState>({ kind: 'waiting' });
  useEffect(() => {
    let live = true;
    void readInstalled(bridge).then(next => { if (live) setState(next); });
    return () => { live = false; };
  }, [bridge]);
  return <Screen slot="extension-template" title={"Extension template"}><ExtensionTemplateView state={state} /></Screen>;
}
