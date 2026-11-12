/**
 * The parts of one harness, in the details of the Harnesses screen: skills and agents first, then tools and context. A part the Library lists opens in the Library, on the tab of its kind.
 * A part the Library does not list has no way in. A part the harness names and does not hold says so. It reads the state only (shared/harness/harness-dive.ts).
 */
import type { ReactElement } from 'react';
import type { Harness, HarnessState } from '../../../shared/harness/types.js';
import { diveGroups } from '../../../shared/harness/harness-dive.js';
import { go } from '../router.js';
import { Tile, KIND_ICON } from '../icons.js';
import { KIND_PLURAL } from '../words.js';
import { DIVE } from '../words-dive.js';

export function PartsOfHarness({ state, harness }: { state: HarnessState; harness: Harness }): ReactElement {
  const groups = diveGroups(state, harness);
  return (
    <section className="hx-block" aria-labelledby="hx-dive" data-dive="">
      <h3 className="hx-h3" id="hx-dive">{DIVE.label.parts}</h3>
      {groups.length === 0 ? <p className="hx-text hx-muted" data-dive-empty="">{DIVE.hint.empty}</p> : groups.map(g => (
        <section key={g.kind} data-dive-kind={g.kind} aria-label={KIND_PLURAL[g.kind]}>
          <h4 className="hx-text hx-muted">{KIND_PLURAL[g.kind]} {g.parts.length + g.missing.length}</h4>
          <ul className="hx-box-list">
            {g.parts.map(p => p.inLibrary
              ? (
                <li key={p.id} className="hx-box hx-box-press" data-dive-part={p.id}>
                  <Tile name={KIND_ICON[p.kind]} size="small" />
                  <button type="button" className="hx-box-main" data-dive-open={`${p.kind}/${p.id}`} aria-label={DIVE.openPart(p.name)} onClick={() => go({ name: 'library', kind: p.kind, partId: p.id })}>{p.name}</button>
                </li>
              )
              : (
                <li key={p.id} className="hx-box" data-dive-part={p.id} data-no-link="">
                  <Tile name={KIND_ICON[p.kind]} size="small" />
                  <span className="hx-box-main">{p.name}</span>
                  <span className="hx-muted">{DIVE.hint.notListed}</span>
                </li>
              ))}
            {g.missing.map(m => (
              <li key={m.id} className="hx-box" data-dive-missing={m.id}>
                <Tile name={KIND_ICON[m.kind]} size="small" />
                <span className="hx-box-main">{m.name}</span>
                <span className="hx-muted">{DIVE.hint.missing}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
