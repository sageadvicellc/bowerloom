/**
 * The home app shell: a top bar (the name with the leaf, "Save points", "Add", and the "?" Help button), a stage, a side panel for the shelves of the
 * agent that is picked, a Save bar at the bottom, and two right-side drawers (Add, Save points) that open over the stage. There is no left rail and no routing.
 * For this first slice the stage is a plain grid of the person's own agents, built from the sample world with the kit's one card; later waves replace
 * the stage and the drawers' content and keep the `data-tour` ids: map, agent, shelves, add, save, help (and `bar` on the top bar).
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { isDirty } from '../../shared/proto/store.js';
import { agentHint, agentTitle, ownedAgents, saveBarModel, shelvesOf } from '../../shared/home/cards.js';
import { useProtoStore } from '../proto/session.js';
import { Button } from './kit/Button.js';
import { Drawer } from './kit/Drawer.js';
import { HelpPopover } from './kit/HelpPopover.js';
import { KitIcon } from './kit/icons.js';
import { ItemCard } from './kit/ItemCard.js';
import { Shelf } from './kit/Shelf.js';
import { saveAction } from './store-actions.js';
import { WORDS, agentsCount } from './words.js';
import './home-tokens.css';
import './kit/kit.css';
import './home.css';

type DrawerId = 'add' | 'points';

export function HomeApp(): ReactElement {
  const { state, dispatch } = useProtoStore();
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedItem, setPickedItem] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerId | null>(null);

  const world = state.draft;
  const agents = useMemo(() => ownedAgents(world), [world]);
  const agent = agents.find(a => a.id === picked) ?? null;
  const shelves = useMemo(() => (agent === null ? null : shelvesOf(world, agent)), [world, agent]);
  const bar = saveBarModel(isDirty(state));

  useEffect(() => { document.title = WORDS.label.appName; }, []);

  const toggle = (id: DrawerId): void => setDrawer(current => (current === id ? null : id));
  const pick = (id: string): void => { setPicked(current => (current === id ? null : id)); setPickedItem(null); };

  return (
    <div className="hm-root" data-home="">
      <header className="hm-bar" data-tour="bar">
        <div className="hm-brand"><KitIcon name="leaf" size={28} /><span>{WORDS.label.appName}</span></div>
        <span className="hm-spacer" />
        <Button icon="clock" aria-expanded={drawer === 'points'} onClick={() => toggle('points')}>{WORDS.label.savePoints}</Button>
        <Button variant="primary" icon="plus" data-tour="add" aria-expanded={drawer === 'add'} onClick={() => toggle('add')}>{WORDS.label.add}</Button>
        <HelpPopover label={WORDS.label.help} text={WORDS.popover.help} align="end" dataTour="help" />
      </header>

      <div className="hm-body">
        <main id="main" className="hm-stage">
          <div className="hm-stage-head">
            <h1 className="kit-heading" tabIndex={-1}>{WORDS.label.yourAgents}</h1>
            <p className="kit-hint">{agentsCount(agents.length)}. {WORDS.hint.stage}</p>
          </div>
          <ul className="hm-grid" data-tour="map" aria-label={WORDS.label.yourAgents}>
            {agents.map((a, i) => (
              <li key={a.id}>
                <ItemCard kind="agent" name={agentTitle(a.name)} hint={agentHint(a)} selected={a.id === picked} onSelect={() => pick(a.id)} {...(i === 0 ? { dataTour: 'agent' } : {})} />
              </li>
            ))}
          </ul>
        </main>

        <aside className="hm-panel" data-tour="shelves" aria-labelledby="hm-panel-title">
          <div className="hm-panel-head">
            <h2 className="kit-heading" id="hm-panel-title">{agent === null ? WORDS.label.pickAnAgent : agentTitle(agent.name)}</h2>
            <p className="kit-hint">{agent === null ? WORDS.hint.panel : agentHint(agent)}</p>
          </div>
          <Shelf title={WORDS.label.skills} entries={shelves?.skills ?? []} selectedId={pickedItem} onSelect={setPickedItem} emptyText={WORDS.hint.emptyShelf} />
          <Shelf title={WORDS.label.tools} entries={shelves?.tools ?? []} selectedId={pickedItem} onSelect={setPickedItem} emptyText={WORDS.hint.emptyShelf} help={{ label: WORDS.label.aboutTools, text: WORDS.popover.connection }} />
          <Shelf title={WORDS.label.notes} entries={shelves?.notes ?? []} selectedId={pickedItem} onSelect={setPickedItem} emptyText={WORDS.hint.emptyShelf} />
        </aside>

        <Drawer open={drawer === 'add'} title={WORDS.label.addDrawer} onClose={() => setDrawer(null)} dataSlot="add">
          <p className="kit-hint">{WORDS.hint.addEmpty}</p>
        </Drawer>
        <Drawer open={drawer === 'points'} title={WORDS.label.savePoints} onClose={() => setDrawer(null)} dataSlot="points">
          <p className="kit-hint">{WORDS.hint.savePointsEmpty}</p>
        </Drawer>
      </div>

      <section className="hm-savebar" data-tour="save" aria-label={WORDS.label.saveBar}>
        <p>{bar.text}</p>
        <Button variant="primary" disabled={!bar.canSave} onClick={() => dispatch(saveAction(WORDS.label.save))}>{WORDS.label.save}</Button>
      </section>
    </div>
  );
}
