/**
 * The screens of an extension route that has no owner yet, or has none for a reason the page can name.
 *  - ExtensionPending: the extension list has not answered yet at launch. A plain waiting line, never the not-found state. After a few failed tries it shows the code, and the tries go on.
 *    Only the code HOST_NOT_STARTED says that the extension host has not started. Any other code is shown as it is.
 *  - ExtensionAbsent: the list answered, and it says why the route has no owner: main skipped the folder (with its code), or the manifest loaded and this build has no screen for it.
 */
import type { ReactElement } from 'react';
import { Screen } from '../Screen.js';
import { HOST_WORDS } from '../local-models/LocalModels.js';
import type { ExtensionAbsence } from '../bundled-extensions.js';

/** The lines of the waiting screen, without the screen around them. */
export function ExtensionPendingBody({ problem = null }: { problem?: string | null }): ReactElement {
  return problem === null
    ? <p className="kit-hint hx-hint" role="status" data-extension-pending="">Looking for this extension.</p>
    : <p className="kit-hint hx-hint" role="status" data-extension-pending="" data-extension-problem={problem}>{problem === 'HOST_NOT_STARTED' ? HOST_WORDS.notStarted : 'The list of extensions could not be read. Trying again.'} Code: {problem}.</p>;
}

export function ExtensionPending({ problem = null }: { problem?: string | null }): ReactElement {
  return <Screen slot="extension-pending" title="Extension"><ExtensionPendingBody problem={problem} /></Screen>;
}

/** The lines of the absent screen, without the screen around them. */
export function ExtensionAbsentBody({ absence }: { absence: ExtensionAbsence }): ReactElement {
  if (absence.kind === 'refused') return <p className="kit-hint hx-hint" role="alert" data-extension-absent="refused" data-extension-code={absence.code}>The extension {absence.id} was refused. Code: {absence.code}.</p>;
  return absence.kind === 'skipped'
    ? <p className="kit-hint hx-hint" role="alert" data-extension-absent="skipped" data-extension-code={absence.code}>The extension folder {absence.name} was not loaded. Code: {absence.code}.</p>
    : <p className="kit-hint hx-hint" role="alert" data-extension-absent="no-screen" data-extension-id={absence.id}>The extension {absence.id} loaded, but this build has no screen for it.</p>;
}

export function ExtensionAbsent({ absence }: { absence: ExtensionAbsence }): ReactElement {
  return <Screen slot="extension-absent" title="Extension"><ExtensionAbsentBody absence={absence} /></Screen>;
}
