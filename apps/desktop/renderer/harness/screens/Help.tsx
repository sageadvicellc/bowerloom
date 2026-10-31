/**
 * Help: four short lines about what a harness is and what is safe, and "Show me around", which opens the edit of a folder's agents and runs the guided tour
 * there. It is a screen of the navigation, so it has a title and a stage and no details column.
 */
import type { ReactElement } from 'react';
import { HButton } from '../parts/controls.js';
import { Screen } from '../Screen.js';
import { useUi } from '../ui.js';
import { useHarnessState } from '../session.js';
import { WORDS, helpLines } from '../words.js';
import { NOTES } from '../words-notes.js';

export function Help(): ReactElement {
  const ui = useUi(), lines = helpLines(useHarnessState().real !== undefined);
  return (
    <Screen title={WORDS.label.help} slot="help">
      <div className="hx-help">
        {lines.map(line => <p key={line} className="hx-help-line" data-budget="paragraph">{line}</p>)}
        <div><HButton icon="help" data-show-around="" onClick={() => ui.openSave({ tour: true })}>{NOTES.label.showAround}</HButton></div>
      </div>
    </Screen>
  );
}
