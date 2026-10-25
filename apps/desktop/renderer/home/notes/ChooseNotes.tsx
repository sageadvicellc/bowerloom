/**
 * "Choose notes": a full-window sheet, opened from the Notes shelf, where a person picks which notes ONE agent can read. On the left, the topics (toggle
 * cards ordered by size, a "Leave out" row for each one that is on) or, after "Pick by hand", one topic's notes with tick boxes. On the right, a live
 * preview: how many notes, a bar, the choice in plain words, and the first note titles. "Use these notes" stages one change in the draft through the
 * store (`chooseNotes`); "Cancel", Escape and "Close" stage nothing. The sheet is the kit's Drawer, stretched over the whole window.
 * The working choice lives in this component, so it starts afresh each time the layer opens, from what the agent reads now.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { AgentItem } from '../../../shared/proto/types.js';
import { agentCard } from '../../../shared/home/cards.js';
import {
  addsOf, clearHand, isEmpty, makeBasis, previewOf, ruleLines, sameSelection, selectionFromSlice, toChoice, toggleHand, toggleKeep, toggleLeaveOut, toggleTopic,
} from '../../../shared/home/notes-model.js';
import type { Selection } from '../../../shared/home/notes-model.js';
import { chooseNotesAction, notesWouldChange } from '../../../shared/home/notes-actions.js';
import type { Topic } from '../../../shared/home/notes-topics.js';
import { useProtoStore } from '../../proto/session.js';
import { Button } from '../kit/Button.js';
import { Glyph } from '../kit/Glyph.js';
import { Drawer } from '../kit/Drawer.js';
import { HandPicker } from './HandPicker.js';
import { PreviewPanel } from './PreviewPanel.js';
import { TopicGrid } from './TopicGrid.js';
import { NOTES_WORDS, partBackIn, partLeftOut, topicAdded, topicRemoved } from './notes-words.js';
import './notes.css';

const L = NOTES_WORDS.label, H = NOTES_WORDS.hint;

export interface ChooseNotesProps {
  open: boolean;
  /** The agent whose notes are chosen. Nothing is shown for an id that is not an agent the person owns. */
  agentId: string | null;
  /** Called when the layer should close: after "Use these notes", "Cancel", Escape or "Close". */
  onClose(): void;
  /** Called once, after the choice was staged, with the agent's id. */
  onChosen?(agentId: string): void;
}

export function ChooseNotes({ open, agentId, onClose, onChosen }: ChooseNotesProps): ReactElement {
  const { state } = useProtoStore();
  const agent = agentId === null ? undefined : state.draft.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === agentId && i.library === null);
  return (
    <div className="nt-layer" data-notes-layer="">
      <Drawer open={open && agent !== undefined} title={L.title} onClose={onClose} dataSlot="notes">
        {agent === undefined ? null : <ChooseNotesBody key={agent.id} agent={agent} onClose={onClose} {...(onChosen === undefined ? {} : { onChosen })} />}
      </Drawer>
    </div>
  );
}

type Step = 'topics' | 'hand';

function ChooseNotesBody({ agent, onClose, onChosen }: { agent: AgentItem; onClose(): void; onChosen?(agentId: string): void }): ReactElement {
  const { state, dispatch } = useProtoStore();
  const world = state.draft;
  const slice = agent.definition.sliceId === undefined ? undefined : world.slices.find(s => s.id === agent.definition.sliceId);
  // The basis is made once per opening: the layer works from what the agent reads when it opens, and a change made meanwhile is not mixed in.
  const [basis] = useState(() => makeBasis(world.wikiPages, slice));
  const [start] = useState(() => selectionFromSlice(slice, basis));
  const [sel, setSel] = useState<Selection>(start);
  const [step, setStep] = useState<Step>('topics');
  const [handTopic, setHandTopic] = useState(() => basis.topics[0]?.id ?? '');
  const [say, setSay] = useState('');
  const handButton = useRef<HTMLButtonElement>(null), handHeading = useRef<HTMLHeadingElement>(null), topicsHeading = useRef<HTMLHeadingElement>(null), moved = useRef(false);
  const name = agentCard(agent).name;

  const preview = useMemo(() => previewOf(sel, basis), [sel, basis]);
  const lines = useMemo(() => ruleLines(sel, basis), [sel, basis]);
  const changed = !sameSelection(sel, start), choice = useMemo(() => toChoice(sel, basis), [sel, basis]);
  // The button waits for a choice that would really change what the agent reads: leaving out every part of a topic picks nothing, and the store would refuse it.
  const empty = isEmpty(sel, basis) || preview.count === 0, effective = useMemo(() => notesWouldChange(world, agent.id, name, choice), [world, agent.id, name, choice]);
  const ready = changed && !empty && effective;

  // After the step changes the focus goes to the new heading, so a keyboard user is not left on a button that has gone.
  useEffect(() => {
    if (!moved.current) return;
    if (step === 'hand') handHeading.current?.focus(); else handButton.current?.focus();
  }, [step]);

  const topic = (t: Topic): void => {
    const turningOn = !sel.on.includes(t.id);
    const next = toggleTopic(sel, t);
    setSel(next);
    setSay(turningOn ? topicAdded(t.name, addsOf(next, t, basis)) : topicRemoved(t.name));
  };
  const part = (t: Topic, folder: string): void => {
    const p = t.parts.find(x => x.folder === folder);
    setSel(toggleLeaveOut(sel, folder));
    if (p !== undefined) setSay(sel.leftOut.includes(folder) ? partBackIn(p.name) : partLeftOut(p.name));
  };
  const go = (next: Step): void => { moved.current = true; setStep(next); };
  const use = (): void => {
    if (!ready) return;
    dispatch(chooseNotesAction(agent.id, name, choice));
    onChosen?.(agent.id);
    onClose();
  };

  return (
    <div className="nt-root">
      <div className="nt-intro">
        <Glyph name="agent" size="small" />
        <p className="nt-agent">{name}</p>
        <p className="kit-hint nt-sentence">{H.intro}</p>
      </div>
      <div className="nt-cols">
        <div className="nt-left" data-step={step}>
          {step === 'topics' ? (
            <>
              <div className="nt-left-head">
                <div className="nt-left-title">
                  <h3 className="kit-heading" tabIndex={-1} ref={topicsHeading}>{L.topics}</h3>
                  <p className="kit-hint">{H.topics}</p>
                </div>
                <Button ref={handButton} onClick={() => go('hand')}>{L.pickByHand}</Button>
              </div>
              <TopicGrid basis={basis} selection={sel} onTopic={topic} onPart={part} onKeep={() => setSel(toggleKeep(sel))} />
            </>
          ) : (
            <>
              <div className="nt-left-head">
                <div className="nt-left-title">
                  <h3 className="kit-heading" tabIndex={-1} ref={handHeading}>{L.pickByHand}</h3>
                  <p className="kit-hint">{H.byHand}</p>
                </div>
                <span className="nt-back"><Button icon="chevron" onClick={() => go('topics')}>{L.allTopics}</Button></span>
              </div>
              <HandPicker basis={basis} selection={sel} topicId={handTopic} onTopic={setHandTopic} onTick={id => setSel(toggleHand(sel, id))} />
              <div className="nt-hand-foot">
                <Button variant="primary" onClick={() => go('topics')}>{L.donePicking}</Button>
                {sel.hand.length > 0 ? <Button onClick={() => setSel(clearHand(sel))}>{L.clearTicks}</Button> : null}
              </div>
            </>
          )}
        </div>
        <div className="nt-right">
          <PreviewPanel preview={preview} lines={lines} />
        </div>
      </div>
      <p className="nt-say" role="status">{say}</p>
      <div className="nt-foot">
        <p className="kit-hint nt-why">{ready ? H.ready : empty ? H.needOne : H.unchanged}</p>
        <Button onClick={onClose}>{L.cancel}</Button>
        <Button variant="primary" disabled={!ready} onClick={use}>{L.use}</Button>
      </div>
    </div>
  );
}
