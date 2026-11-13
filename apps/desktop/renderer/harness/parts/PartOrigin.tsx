/** "Where it comes from", in the details of a Library part: the label, the folder the reader found it in, the program, the version, the file name and any equal text elsewhere. Never a full path. */
import type { ReactElement } from 'react';
import type { HarnessState, Part } from '../../../shared/harness/types.js';
import { originLines, originOf } from '../../../shared/harness/harness-dive.js';
import { DIVE } from '../words-dive.js';

export function PartOrigin({ state, part }: { state: HarnessState; part: Part }): ReactElement {
  const origin = originOf(state, part);
  return (
    <section className="hx-block" aria-labelledby="hx-lib-from" data-origin={origin.how}>
      <h3 className="hx-h3" id="hx-lib-from">{DIVE.label.comesFrom}</h3>
      {originLines(origin).map((line, i) => <p key={i} className="hx-text hx-muted">{line}</p>)}
    </section>
  );
}
