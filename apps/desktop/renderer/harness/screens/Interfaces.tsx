/**
 * S10, Interfaces. The three interfaces with their health and a switch. The switch changes whether the interface is offered in the install and start sheets (`store.setInterfaceOn`, which adds a history entry
 * the person can undo). An interface that was not found cannot be switched on. Picking a row fills the details column: what Bowerloom writes for it, what it cannot use, and "Look again".
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { interfaceStatus } from '../../../shared/harness/status.js';
import type { Interface } from '../../../shared/harness/types.js';
import { Screen } from '../Screen.js';
import { go } from '../router.js';
import { useHarnessState, useHarnessStore } from '../session.js';
import { HButton, StateDot } from '../parts/controls.js';
import { Tile } from '../icons.js';
import { WORDS } from '../words.js';
import { FLOW, interfaceSwitch, interfacesHint } from '../words-flow.js';
import './interfaces.css';

function Row({ iface, tone, selected, onPick, onSwitch }: { iface: Interface; tone: ReturnType<typeof interfaceStatus>['tone']; selected: boolean; onPick(): void; onSwitch(on: boolean): void }): ReactElement {
  const gone = iface.health === 'not-found';
  const nameId = `hxn-name-${iface.id}`;
  return (
    <li className="hx-row hxn-row" data-selected={selected ? '' : undefined} data-gone={gone ? '' : undefined} data-interface={iface.id}>
      <Tile name="monitor" size="large" />
      <div className="hx-row-text">
        <button type="button" className="hx-row-main" id={nameId} aria-pressed={selected} onClick={onPick}>{iface.name}</button>
        <span className="hx-row-meta">{iface.foundAt}</span>
        <StateDot tone={tone} className="hxn-health">{iface.healthWords}</StateDot>
      </div>
      <span className="hxn-switch-wrap">
        <button type="button" role="switch" className="hxn-switch" aria-checked={iface.on} aria-label={interfaceSwitch(iface.name)} disabled={gone} onClick={() => onSwitch(!iface.on)}>
          <span className="hxn-track" aria-hidden="true"><span className="hxn-thumb" /></span>
          <span aria-hidden="true">{FLOW.label.useInterface}</span>
        </button>
      </span>
    </li>
  );
}

function Details({ iface, tone, looked, onLook }: { iface: Interface; tone: ReturnType<typeof interfaceStatus>['tone']; looked: boolean; onLook(): void }): ReactElement {
  return (
    <>
      <div className="hx-dhead">
        <Tile name="monitor" size="large" />
        <div className="hx-dhead-text">
          <h2 className="kit-heading hx-dtitle" id="hm-panel-title" tabIndex={-1}>{iface.name}</h2>
          <StateDot tone={tone} className="hxn-head-sub">{iface.healthWords}</StateDot>
        </div>
      </div>
      <section className="hx-block" aria-labelledby="hxn-writes">
        <h3 className="hx-h3" id="hxn-writes">{FLOW.label.whatWrites}</h3>
        <ul className="hx-box-list">{iface.writes.map(path => <li key={path} className="hx-box"><span className="hxn-path">{path}</span></li>)}</ul>
      </section>
      <section className="hx-block" aria-labelledby="hxn-cannot">
        <h3 className="hx-h3" id="hxn-cannot">{FLOW.label.cannotUse}</h3>
        <p className="hx-text">{iface.cannotUseNote}</p>
      </section>
      <div className="hxn-wide"><HButton icon="search" onClick={onLook}>{FLOW.label.lookAgain}</HButton></div>
      <p className="hx-text hx-muted" role="status">{looked ? FLOW.hint.lookedAgain : ''}</p>
    </>
  );
}

export function Interfaces({ id }: { id: string | null }): ReactElement {
  const state = useHarnessState(), store = useHarnessStore();
  const [looked, setLooked] = useState<string | null>(null);
  const selected = state.interfaces.find(i => i.id === id) ?? state.interfaces[0];
  return (
    <Screen slot="interfaces" title={WORDS.label.interfaces} details={selected === undefined ? undefined : <Details iface={selected} tone={interfaceStatus(state, selected.id).tone} looked={looked === selected.id} onLook={() => setLooked(selected.id)} />}>
      <p className="kit-hint hx-hint">{interfacesHint(state.interfaces.length)}</p>
      <ul className="hx-rows hxn-rows" aria-label={WORDS.label.interfaces}>
        {state.interfaces.map(i => <Row key={i.id} iface={i} tone={interfaceStatus(state, i.id).tone} selected={selected?.id === i.id} onPick={() => go({ name: 'interfaces', id: i.id })} onSwitch={on => store.setInterfaceOn(i.id, on)} />)}
      </ul>
    </Screen>
  );
}
