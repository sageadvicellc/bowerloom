/**
 * The screen of an extension route while the extension list has not answered yet at launch. It is a plain waiting line, never the not-found state: a deep link to an extension is
 * not "not found" until main has said which extensions it loaded. After a few failed tries it says that the extension host has not started, with the code, and the tries go on.
 */
import type { ReactElement } from 'react';
import { Screen } from '../Screen.js';
import { HOST_WORDS } from '../local-models/LocalModels.js';

export function ExtensionPending({ problem = null }: { problem?: string | null }): ReactElement {
  return (
    <Screen slot="extension-pending" title="Extension">
      {problem === null
        ? <p className="kit-hint hx-hint" role="status" data-extension-pending="">Looking for this extension.</p>
        : <p className="kit-hint hx-hint" role="status" data-extension-pending="" data-extension-problem={problem}>{HOST_WORDS.notStarted} Code: {problem}.</p>}
    </Screen>
  );
}
