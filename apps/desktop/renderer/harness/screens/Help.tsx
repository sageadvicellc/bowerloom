/** Help: four short lines about what a harness is and what is safe. It is a screen of the navigation, so it has a title and a stage and no details column. */
import type { ReactElement } from 'react';
import { Screen } from '../Screen.js';
import { WORDS } from '../words.js';

export function Help(): ReactElement {
  const p = WORDS.paragraph;
  return (
    <Screen title={WORDS.label.help} slot="help">
      <div className="hx-help">
        {[p.helpOne, p.helpTwo, p.helpThree, p.helpFour].map(line => <p key={line} className="hx-help-line" data-budget="paragraph">{line}</p>)}
      </div>
    </Screen>
  );
}
