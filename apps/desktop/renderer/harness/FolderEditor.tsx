/**
 * The editor of one folder's harness (0.8.0-beta.1, option C). One component for two places: the Builder draws it in the window, and the save sheet draws it
 * in its edit step. Both read the same draft of the folder (folder-draft.tsx), and `save-draft.ts` stays the only reducer.
 * - `EditStep` draws the draft: the graph, the skills each agent uses, the notes each agent reads, the skills of the harness, the skills from another folder,
 *   the interfaces, and the save points with Go back. The Builder leaves the save points out and keeps them in a drawer.
 * - `useFolderEditor` holds what the editor reads from main besides the draft: the Notes panel's reads of each notes folder, the Notes keeper added from the
 *   kit (a plan of `add-from-kit` alone, which writes nothing), and the skills of another folder. It resets when the folder changes.
 * - Every gesture of the editor goes through `act`, which is `builderAction` on the folder's draft: a gesture the draft refuses says why, in words, to whoever
 *   draws the editor (`onRefused`), and the draft stays as it was. A tick, a link, a copy and a removal are one path.
 * Nothing here writes. The draft becomes a closed list of ids at Save; the window never sends a path or file text.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { ENGINE_IDS, isPreviewEngine } from '../../shared/engine/engines.js';
import { ENGINE_NAMES } from '../../shared/engine/types.js';
import type { Answer, DefinitionView, EngineBridge, FolderInfo, NotesView, Refusal, SetAsideView, VersionView } from '../../shared/engine/types.js';
import type { SaveDraft, SkillCopy } from '../../shared/harness/save-draft.js';
import {
  KEEPER_AGENT, KEEPER_KIT, agentPartId, canCopy, definitionWorld, draftCount, draftStart, draftView, keeperOf, keeperSkills, linkRest, notesPartId, skillPartId, stoppedSources,
} from '../../shared/harness/save-draft.js';
import { BUILDER_REFUSALS, builderAction } from '../../shared/harness/builder-draft.js';
import type { BuilderAction, BuilderOpens } from '../../shared/harness/builder-draft.js';
import type { Point } from '../../shared/harness/types.js';
import { HButton, StateDot } from './parts/controls.js';
import { Graph } from './screens/builder/Graph.js';
import { ENGINE_WORDS, SAVE_REFUSAL_WORDS, copyAddName, copyTakeOutName, draftWords, fromWords, goBackWords, savePointLine } from './words-engine.js';
import { RefusalNote, Section } from './sheets/engine-parts.js';
import { callRefusal, chooseFolderCall, useCall } from './sheets/use-call.js';
import type { Call } from './sheets/use-call.js';
import { KeeperBuild } from './notes/KeeperBuild.js';
import { NotesPanel } from './notes/NotesPanel.js';
import { NotesStep } from './notes/NotesStep.js';
import { addThenNext, buildProgress, notesCards, notesToRead, readReplaces } from './notes/notes-logic.js';
import type { NotesCard } from './notes/notes-logic.js';
import { useNotesSession } from './notes/notes-session.js';
import { NOTES } from './words-notes.js';
import { WORDS } from './words.js';

const W = ENGINE_WORDS;

export interface FolderEditorInput {
  readonly engine: EngineBridge | null;
  readonly call: Call;
  /** The folder the editor edits, or undefined before one is picked. */
  readonly folder: FolderInfo | undefined;
  /** Every folder main knows, for "Skills from another folder". */
  readonly folders: readonly FolderInfo[];
  onFolders(list: readonly FolderInfo[]): void;
  /** The harness as main read it, or null before the read. */
  readonly base: DefinitionView | null;
  readonly draft: SaveDraft;
  readonly positions: Readonly<Record<string, Point>>;
  /** A draft a gesture made, recorded on the folder's undo stack. */
  onPush(draft: SaveDraft): void;
  /** A gesture the draft refused, or dropped while a call ran: its words, and the sheet it opens. */
  onRefused(refusal: { readonly words: string; readonly opens: BuilderOpens }): void;
  onHelp(): void;
}

/** A refusal of a read the editor made on its own (the Notes keeper from the kit, the skills of another folder), with the number that moves the focus to it. */
export interface EditorRefusal { readonly key: string; readonly refusal: Refusal; readonly id: number }

export interface FolderEditor {
  readonly now: DefinitionView | null;
  readonly world: ReturnType<typeof definitionWorld> | null;
  readonly count: number;
  readonly cards: readonly NotesCard[];
  readonly keeper: DefinitionView['agents'][number] | null;
  readonly progress: ReturnType<typeof buildProgress> | null;
  readonly notes: EditNotes;
  readonly copy: CopyParts | undefined;
  /** The tidy-up report main opened last, or null. */
  readonly opened: string | null;
  /** Adds the Notes keeper from the kit as a draft, then runs `then` once it is in the draft. */
  addKeeper(then?: () => void): void;
  /**
   * One gesture, through `builderAction` on the draft as it is now. True when it changed the draft. A refused one says why through `onRefused`, and so does
   * one made while a call runs (the controls are off then, so this is for a key or a drop).
   */
  act(action: BuilderAction): boolean;
  /** The words of the editor's own calls that run now, or null. They never share a lane with the sheet's: one cannot drop another. */
  readonly busy: string | null;
  /** The refusals of those calls. */
  readonly refusals: readonly EditorRefusal[];
  /** Forgets every read of the folder: a new folder, or the sheet opened again, never shows an old read. */
  reset(): void;
}

/** What the editor of one folder reads from main besides the draft, and the parts it hands `EditStep`. */
export function useFolderEditor({ engine, call, folder, folders, onFolders, base, draft, positions, onPush, onRefused, onHelp }: FolderEditorInput): FolderEditor {
  const session = useNotesSession();
  const [summaries, setSummaries] = useState<Readonly<Record<string, Answer<NotesView>>>>({});
  const [notesWay, setNotesWay] = useState<'use' | 'start' | null>(null);
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  const [copyRead, setCopyRead] = useState<Readonly<Record<string, Answer<DefinitionView['skills']>>>>({});
  const [opened, setOpened] = useState<string | null>(null);
  const reading = useRef(new Set<string>());
  // The draft as it is now, for an answer that comes after a render.
  const draftNow = useRef(draft);
  draftNow.current = draft;
  const held = call.writing;
  // The keeper's plan and the plan of another folder's skills each have their own lane: a plan's newest call wins its lane, so on one shared lane the second
  // would drop the first without a word.
  const keeperCall = useCall(), copyCall = useCall();

  const reset = (): void => {
    reading.current = new Set(); setSummaries({}); setNotesWay(null); setCopyFrom(null); setCopyRead({}); setOpened(null); keeperCall.clear(); copyCall.clear();
  };
  const folderId = folder?.id ?? null;
  useEffect(() => { reset(); }, [folderId]);

  const now = useMemo(() => (base === null ? null : draftView(base, draft)), [base, draft]);
  const cards = useMemo(() => (now === null || base === null ? [] : notesCards(now, session.chosen, summaries, stoppedSources(base, draft), base.sources.map(x => x.name))), [now, base, draft, session.chosen, summaries]);
  const world = useMemo(() => {
    if (now === null) return null;
    const w = definitionWorld(now, cards.filter(c => !c.attached).map(c => c.source));
    return { state: w.state, harness: { ...w.harness, positions } };
  }, [now, cards, positions]);
  const count = base === null ? 0 : draftCount(base, draft);
  const offeredIds = base === null ? [] : keeperSkills(base, draft);
  const keeper = now === null ? null : keeperOf(now);
  const progress = now === null ? null : buildProgress(now, offeredIds, cards);

  /** A read of one notes folder: its answer, or, when the call throws, a refusal that keeps the real code. */
  const summaryOf = (bridge: EngineBridge, id: string): Promise<Answer<NotesView>> => bridge.notesSummary(id).catch((error: unknown): Answer<NotesView> => {
    const r = callRefusal(error);
    return { ok: false, refusal: r.code === 'FAILED' ? { ...r, message: NOTES.hint.noSummary } : r };
  });
  // The Notes panel reads each source the harness holds once for each folder: names and counts only. A fresh read of a folder chosen in this window replaces
  // its snapshot. The folder is a dependency: the reset above starts the reads again for it, so a folder opened again never keeps an empty panel.
  useEffect(() => {
    if (engine === null || now === null) return;
    for (const id of notesToRead(now, reading.current)) {
      reading.current.add(id);
      const mine = reading.current;
      void summaryOf(engine, id).then(a => {
        // A read that started before a reset, or before another folder, is dropped.
        if (reading.current !== mine) return;
        setSummaries(m => ({ ...m, [id]: a }));
        const fresh = readReplaces(session.chosen, id, a);
        if (fresh !== null) session.choose(fresh);
      });
    }
  }, [engine, now, session.chosen, folderId]);

  /** Every gesture, applied to the draft as it is now. */
  const apply = (action: BuilderAction): boolean => {
    if (base === null) return false;
    const r = builderAction(base, draftNow.current, action, cards.filter(c => !c.attached).map(c => c.source), folder?.id);
    if (r.ok) { draftNow.current = r.draft; onPush(r.draft); return true; }
    onRefused({ words: r.words, opens: r.opens });
    return false;
  };
  const working = call.writing || call.busy !== null || keeperCall.busy !== null || copyCall.busy !== null;
  const act = (action: BuilderAction): boolean => {
    if (working) { onRefused({ words: WORDS.hint.stillWorking, opens: null }); return false; }
    return apply(action);
  };
  /** A change the draft functions make that has no gesture of its own: nothing changing says so in words. */
  const change = (next: (d: SaveDraft) => SaveDraft): void => {
    if (working) { onRefused({ words: WORDS.hint.stillWorking, opens: null }); return; }
    const after = next(draftNow.current);
    if (after === draftNow.current) { onRefused({ words: BUILDER_REFUSALS['no-change'], opens: null }); return; }
    draftNow.current = after; onPush(after);
  };

  /**
   * Adds the Notes keeper from the kit as a draft: main plans the harness with the kit added (reads only), and the draft keeps that answer to draw the keeper
   * and its skills. Nothing is written until Save. `then` runs only when the plan answered and the keeper is in the draft; a keeper there already runs it at
   * once. Otherwise the refusal keeps the focus.
   */
  const addKeeper = (then?: () => void): void => {
    if (keeper !== null) { then?.(); return; }
    if (engine === null || folder === undefined || base === null) return;
    const id = folder.id;
    void addThenNext(
      onValue => keeperCall.plan(W.label.planning, () => engine.planSave(id, [{ kind: 'add-from-kit', kit: KEEPER_KIT }]), v => onValue(v.definition)),
      view => apply({ kind: 'add-keeper', view }),
      () => then?.(),
    );
  };
  /**
   * Opens the newest tidy-up report of a notes folder through main, which finds the file, checks it, and asks in its own dialog. The folder is read again
   * after it, so the panel names the report main would open next.
   */
  const openReport = (notesId: string): void => {
    if (engine === null) return;
    setOpened(null);
    void call.write(NOTES.label.opening, () => engine.openNotesReport(notesId), r => setOpened(r.path)).finally(() => {
      // A re-read that fails shows as the card's own failure, never as an old count that may be wrong now.
      void summaryOf(engine, notesId).then(a => {
        setSummaries(m => ({ ...m, [notesId]: a }));
        const fresh = readReplaces(session.chosen, notesId, a);
        if (fresh !== null) session.choose(fresh);
      });
    });
  };
  const notes: EditNotes = {
    cards, keeper, offered: offeredIds.map(id => now?.skills.find(s => s.id === id) ?? { id, name: id, description: '' }), fromKit: draft.kit !== null,
    way: notesWay, onWay: setNotesWay, onAddKeeper: () => addKeeper(),
    onLink: (skill, on) => { act({ kind: on ? 'link' : 'unlink', a: agentPartId(KEEPER_AGENT), b: skillPartId(skill) }); },
    onLinkRest: () => { if (base !== null) change(d => linkRest(base, d, KEEPER_AGENT, offeredIds)); },
    onAttach: (agent, card, on) => { act({ kind: on ? 'link' : 'unlink', a: agentPartId(agent), b: notesPartId(card.source.name) }); },
    onRemoveKit: () => { act({ kind: 'remove', part: agentPartId(KEEPER_AGENT) }); },
    onHelp,
    onStop: (card, on) => { act({ kind: on ? 'remove' : 'keep', part: notesPartId(card.source.name) }); },
    onOpenReport: card => openReport(card.key),
  };
  /** Skills from another folder: the folders that hold a harness, a read of one folder's skills, and copies into the draft by id. */
  const copy: CopyParts | undefined = base === null || folder === undefined ? undefined : {
    folders: folders.filter(f => f.id !== folder.id && f.hasDefinition).map(f => ({ id: f.id, label: f.label })), picked: copyFrom,
    skills: copyFrom === null ? null : copyRead[copyFrom] ?? null, draft, base,
    onPick: id => {
      if (engine === null) return;
      setCopyFrom(id);
      // The other folder's harness as main reads it (a plan with no edits, which writes nothing): its skills by id, name and description.
      void copyCall.plan(W.label.planning, () => engine.planSave(id, []), v => setCopyRead(m => ({ ...m, [id]: { ok: true, value: v.definition.skills } })));
    },
    onChoose: () => {
      if (engine === null || held) return;
      void copyCall.plan(W.label.chooseFolder, () => chooseFolderCall(engine), got => { if (got !== null) onFolders(got.list); });
    },
    onCopy: (skill, on) => {
      const from = folders.find(f => f.id === copyFrom);
      if (from === undefined) return;
      const c: SkillCopy = { id: skill.id, from: from.id, fromLabel: from.label, name: skill.name, description: skill.description };
      act(on ? { kind: 'copy-skill', copy: c } : { kind: 'remove', part: skillPartId(skill.id) });
    },
  };
  const refusals: EditorRefusal[] = [];
  if (keeperCall.refusal !== null) refusals.push({ key: 'keeper', refusal: keeperCall.refusal, id: keeperCall.refusalId });
  if (copyCall.refusal !== null) refusals.push({ key: 'copy', refusal: copyCall.refusal, id: copyCall.refusalId });
  const busy = keeperCall.busy ?? copyCall.busy;
  return { now, world, count, cards, keeper, progress, notes, copy, opened, addKeeper, act, busy, refusals, reset };
}

/** What the edit needs to draw notes and the keeper, and to change them. Left out (a markup test of the skills alone), the edit draws neither. */
export interface EditNotes {
  readonly cards: readonly NotesCard[];
  readonly keeper: DefinitionView['agents'][number] | null;
  readonly offered: DefinitionView['skills'];
  readonly fromKit: boolean;
  /** The notes step open in the Notes panel, by the way the person chose, or null. */
  readonly way: 'use' | 'start' | null;
  onWay(way: 'use' | 'start' | null): void;
  onAddKeeper(): void;
  onLink(skill: string, on: boolean): void;
  onLinkRest(): void;
  onAttach(agent: string, card: NotesCard, on: boolean): void;
  /** Takes the keeper the draft adds from the kit back out. */
  onRemoveKit(): void;
  onHelp(): void;
  /** Stops using a saved source when the person saves (`on`), or keeps using it. */
  onStop?(card: NotesCard, on: boolean): void;
  /** Opens a card's newest tidy-up report through main. */
  onOpenReport?(card: NotesCard): void;
}

/**
 * "Skills from another folder" (`add-skill`): the other folders that hold a harness, by id and label, the one picked, its skills as main read them (null
 * before a read), and the draft they copy into. The window sends the skill id and the folder id only; main reads the skill there again when it plans.
 */
export interface CopyParts {
  readonly folders: readonly { readonly id: string; readonly label: string }[];
  readonly picked: string | null;
  readonly skills: Answer<DefinitionView['skills']> | null;
  readonly draft: SaveDraft;
  readonly base: DefinitionView;
  onPick(folderId: string): void;
  onChoose(): void;
  onCopy(skill: DefinitionView['skills'][number], on: boolean): void;
}

export interface EditStepProps {
  base: DefinitionView; now: DefinitionView; draft: SaveDraft; count: number; held: boolean; versions: Answer<readonly VersionView[]> | null;
  world: NonNullable<ReturnType<typeof definitionWorld>>; linkingId: string | null; selectedId: string | null;
  /** One gesture of the editor, through `builderAction` (the hook's `act`). */
  onAction(action: BuilderAction): void; onLinkStart(id: string): void; onLinkTarget(id: string): void; onLinkCancel(): void; onSelect(id: string | null): void;
  onMove(id: string, at: Point): void; onGoBack(version: string): void;
  /** A skill or a notes card dropped on an agent (the Builder): a link to make. Left out, every drag moves the node. */
  onDrop?(dragged: string, agent: string): void;
  /** False in the Builder, which keeps the save points in a drawer. */
  savePoints?: boolean;
  setAside?: SetAsideParts;
  notes?: EditNotes;
  copy?: CopyParts;
}

/** The draft of one folder's harness: the graph, the skills of each agent, the skills, the interfaces, and the save points (unless `savePoints` is false). */
export function EditStep({ base, now, draft, count, held, versions, world, linkingId, selectedId, onAction, onLinkStart, onLinkTarget, onLinkCancel, onSelect, onMove, onGoBack, onDrop, savePoints = true, setAside, notes, copy }: EditStepProps): ReactElement {
  const engines = ENGINE_IDS.filter(e => base.engines.includes(e) || !isPreviewEngine(e));
  const sum = <p className="hxi-sum" data-draft={count}><StateDot tone={count === 0 ? 'quiet' : 'warn'}>{draftWords(count)}</StateDot> <span className="hxe-muted">{W.hint.draftNote}</span></p>;
  return (
    <>
      {notes === undefined ? sum : (
        <div className="hxn-top">
          {sum}
          <span data-tour="help"><HButton icon="help" size="small" data-help="" aria-label={NOTES.label.replay} disabled={held} onClick={notes.onHelp}>{NOTES.label.help}</HButton></span>
        </div>
      )}
      <Section title={W.label.agentsAndSkills} slot="graph">
        <p className="hxe-text hxe-muted">{now.agents.length === 0 ? W.hint.noAgentsHere : W.hint.linkHint}</p>
        <div className="hxs-graph" data-tour="map">
          <Graph state={world.state} harness={world.harness} selectedId={selectedId} linkingId={linkingId} matchIds={null} onSelect={onSelect} onMove={onMove}
            onLinkStart={onLinkStart} onLinkTarget={onLinkTarget} onLinkCancel={onLinkCancel} {...(onDrop === undefined ? {} : { onDrop })} />
        </div>
      </Section>
      {notes === undefined || notes.keeper === null ? null : (
        <KeeperBuild keeper={notes.keeper} offered={notes.offered} cards={notes.cards} held={held} fromKit={notes.fromKit}
          onLink={notes.onLink} onLinkRest={notes.onLinkRest} onAttach={(card, on) => notes.onAttach(KEEPER_AGENT, card, on)} onRemoveKit={notes.onRemoveKit} />
      )}
      {notes === undefined ? null : (
        <NotesPanel cards={notes.cards} held={held} hasKeeper={notes.keeper !== null} onUse={() => notes.onWay('use')} onFresh={() => notes.onWay('start')} onAddKeeper={notes.onAddKeeper}
          {...(notes.onStop === undefined ? {} : { onStop: notes.onStop })} {...(notes.onOpenReport === undefined ? {} : { onOpenReport: notes.onOpenReport })}
          step={notes.way === null ? undefined : <NotesStep key={notes.way} start={notes.way} onDone={() => notes.onWay(null)} />} />
      )}
      {now.agents.length === 0 ? null : (
        <Section title={W.label.agentSkills} count={String(now.agents.length)} slot="agent-skills">
          {now.agents.map(a => (
            <fieldset key={a.id} className="hxs-agent" data-agent={a.id}>
              <legend className="hxs-agent-name">{a.name}</legend>
              {now.skills.length === 0 ? <p className="hxe-text hxe-muted">{W.hint.nothingFound}</p> : (
                <ul className="hxs-ticks">
                  {now.skills.map(s => (
                    <li key={s.id}>
                      <label className="hxs-tick" data-skill={s.id}>
                        <input type="checkbox" className="hxi-check" disabled={held} checked={a.skills.includes(s.id)} aria-label={`${s.name}: ${a.name}`}
                          onChange={e => { const on = e.currentTarget.checked; onAction({ kind: on ? 'link' : 'unlink', a: agentPartId(a.id), b: skillPartId(s.id) }); }} />
                        <span>{s.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          ))}
        </Section>
      )}
      {notes === undefined || notes.cards.length === 0 || now.agents.length === 0 ? null : (
        <Section title={NOTES.label.notesEachAgent} count={String(now.agents.length)} slot="agent-notes">
          {now.agents.map(a => (
            <fieldset key={a.id} className="hxs-agent" data-agent-notes={a.id}>
              <legend className="hxs-agent-name">{a.name}</legend>
              <ul className="hxs-ticks">
                {notes.cards.map(c => (
                  <li key={c.key}>
                    <label className="hxs-tick" data-notes={c.key}>
                      <input type="checkbox" className="hxi-check" disabled={held} checked={a.notes.includes(c.source.name)} aria-label={`${c.name}: ${a.name}`}
                        onChange={e => notes.onAttach(a.id, c, e.currentTarget.checked)} />
                      <span>{c.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
        </Section>
      )}
      <Section title={W.label.skillsHere} count={String(draftStart(base, draft).skills.length)} slot="skills">
        <ul className="hxi-files">
          {draftStart(base, draft).skills.map(s => {
            const gone = draft.removed.includes(s.id), copied = draft.copies.find(c => c.id === s.id);
            return (
              <li key={s.id} className="hxi-file" data-skill-row={s.id} data-removed={gone ? '' : undefined} data-copied={copied === undefined ? undefined : ''}>
                <span className="hxi-file-path">{s.name}</span>
                {gone ? <StateDot tone="warn">{W.hint.removedMark}</StateDot> : copied !== undefined ? <StateDot tone="quiet">{fromWords(copied.fromLabel)}</StateDot> : <span className="hxe-muted hxs-desc" title={s.description}>{s.description}</span>}
                {copied !== undefined
                  ? <HButton size="small" disabled={held} aria-label={copyTakeOutName(s.name)} onClick={() => onAction({ kind: 'remove', part: skillPartId(s.id) })}>{W.label.copyTakeOut}</HButton>
                  : <HButton size="small" disabled={held} aria-label={`${gone ? W.label.keepSkill : W.label.removeSkill}: ${s.name}`} onClick={() => onAction({ kind: gone ? 'keep' : 'remove', part: skillPartId(s.id) })}>{gone ? W.label.keepSkill : W.label.removeSkill}</HButton>}
              </li>
            );
          })}
        </ul>
      </Section>
      {copy === undefined ? null : <CopySkills copy={copy} held={held} />}
      <Section title={W.label.interfacesHere} slot="engines">
        <ul className="hxs-ticks">
          {engines.map(e => (
            <li key={e}>
              <label className="hxs-tick" data-engine={e}>
                <input type="checkbox" className="hxi-check" disabled={held} checked={now.engines.includes(e)}
                  onChange={ev => { const on = ev.currentTarget.checked; onAction({ kind: 'set-engines', engines: on ? [...now.engines, e] : now.engines.filter(x => x !== e) }); }} />
                <span>{ENGINE_NAMES[e]}</span>
              </label>
            </li>
          ))}
        </ul>
      </Section>
      {savePoints ? <SavePoints versions={versions} held={held} onGoBack={onGoBack} {...(setAside === undefined ? {} : { setAside })} /> : null}
    </>
  );
}

/**
 * "Skills from another folder": each other folder that holds a harness, as a button that reads its skills, and "Choose a folder" for one not chosen yet.
 * Each skill of the folder picked has Add, or Take out once the draft copies it; one whose id this harness holds already is marked and offers nothing.
 */
export function CopySkills({ copy, held }: { copy: CopyParts; held: boolean }): ReactElement {
  const from = copy.folders.find(f => f.id === copy.picked);
  const list = copy.skills !== null && copy.skills.ok ? copy.skills.value : [];
  return (
    <Section title={W.label.copySkills} slot="copy-skills">
      <p className="hxe-text hxe-muted">{copy.folders.length === 0 ? W.hint.noOtherFolders : W.hint.copyPick}</p>
      <div className="hxn-ways">
        {copy.folders.map(f => (
          <HButton key={f.id} size="small" disabled={held} data-copy-from={f.id} aria-pressed={f.id === copy.picked} onClick={() => copy.onPick(f.id)}>{f.label}</HButton>
        ))}
        <HButton icon="folder" size="small" disabled={held} data-copy-choose="" onClick={copy.onChoose}>{W.label.chooseFolder}</HButton>
      </div>
      {copy.skills !== null && !copy.skills.ok ? <RefusalNote refusal={copy.skills.refusal}>{null}</RefusalNote> : null}
      {from === undefined || copy.skills === null || !copy.skills.ok ? null : list.length === 0 ? <p className="hxe-text hxe-muted">{W.hint.copyNoSkills}</p> : (
        <ul className="hxi-files" aria-label={W.label.copySkills}>
          {list.map(skill => {
            const copied = copy.draft.copies.some(c => c.id === skill.id && c.from === from.id);
            const heldHere = !copied && !canCopy(copy.base, copy.draft, skill.id);
            return (
              <li key={skill.id} className="hxi-file" data-copy-skill={skill.id} data-held={heldHere ? '' : undefined} data-copied={copied ? '' : undefined}>
                <span className="hxi-file-path">{skill.name}</span>
                {heldHere ? <StateDot tone="quiet">{W.hint.heldHere}</StateDot> : <span className="hxe-muted hxs-desc" title={skill.description}>{skill.description}</span>}
                {heldHere ? null : copied
                  ? <HButton size="small" disabled={held} aria-label={copyTakeOutName(skill.name)} onClick={() => copy.onCopy(skill, false)}>{W.label.copyTakeOut}</HButton>
                  : <HButton size="small" disabled={held} aria-label={copyAddName(skill.name, from.label)} onClick={() => copy.onCopy(skill, true)}>{W.label.copyAdd}</HButton>}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** "Set old save points aside": the plan shown (or null), the dated name of the last one done (or null), and the two calls. */
export interface SetAsideParts { readonly view: SetAsideView | null; readonly done: string | null; plan(): void; run(): void }
/**
 * The refusals of a save point record that set-aside can clear: an index that is not whole, and one the state layer will not read (open to others, a second
 * link, or past its bound). The set-aside plan in main checks again and renames the record without opening it.
 */
const SET_ASIDE_CODES: ReadonlySet<string> = new Set(['VERSION_CORRUPT', 'PORTABLE_STATE_UNSAFE']);

/**
 * "Set old save points aside" for a record main refuses to read: the button that plans it (when `refusal` is one set-aside can clear), the plan with the one
 * button that writes it, and the dated name once it is done. The sheet and the Builder both draw it, so a person is never locked out of either.
 */
export function SetAsideBlock({ refusal, held, setAside }: { refusal: Refusal | null; held: boolean; setAside: SetAsideParts }): ReactElement {
  return (
    <>
      {refusal !== null && SET_ASIDE_CODES.has(refusal.code) && setAside.view === null ? <HButton size="small" disabled={held} data-set-aside="" onClick={setAside.plan}>{W.label.planSetAside}</HButton> : null}
      {setAside.view !== null ? (
        <div data-set-aside-plan={setAside.view.revision.slice(0, 8)}>
          <p className="hxe-text">{W.hint.setAsideNote}</p>
          <HButton size="small" variant="primary" disabled={held} data-run-set-aside="" onClick={setAside.run}>{W.label.setAside}</HButton>
        </div>
      ) : null}
      {setAside.done != null ? <p className="hxe-text" data-set-aside-done={setAside.done}><StateDot tone="good">{W.hint.setAsideDone}</StateDot> {setAside.done}</p> : null}
    </>
  );
}

/**
 * The save points, newest first, each with "Go back". A damaged record shows its refusal; it is never drawn as "no save point yet", and it offers to set the
 * old save points aside, planned first and written after main's own dialog, so a person is never locked out.
 */
export function SavePoints({ versions, held, onGoBack, setAside }: { versions: Answer<readonly VersionView[]> | null; held: boolean; onGoBack(version: string): void; setAside?: SetAsideParts }): ReactElement {
  const refusal: Refusal | null = versions !== null && !versions.ok ? versions.refusal : null;
  const list = versions !== null && versions.ok ? versions.value : [];
  return (
    <Section title={W.label.savePoints} {...(versions !== null && versions.ok ? { count: String(list.length) } : {})} slot="save-points">
      {refusal !== null ? <RefusalNote refusal={refusal}>{null}</RefusalNote> : null}
      {refusal !== null && SAVE_REFUSAL_WORDS[refusal.code] !== undefined ? <p className="hxe-text" data-next-step="">{SAVE_REFUSAL_WORDS[refusal.code]}</p> : null}
      {setAside === undefined ? null : <SetAsideBlock refusal={refusal} held={held} setAside={setAside} />}
      {versions !== null && versions.ok && list.length === 0 ? <p className="hxe-text hxe-muted">{W.hint.noSavePoints}</p> : null}
      {list.length === 0 ? null : (
        <ul className="hxi-files" aria-label={W.label.savePoints}>
          {list.map(v => (
            <li key={v.id} className="hxi-file hxs-point" data-version={v.id} data-current={v.current ? '' : undefined}>
              <span className="hxs-point-text">
                <span className="hxi-file-path">{v.id} · {v.label}</span>
                <span className="hxe-muted">{savePointLine(v.created, v.files)}</span>
              </span>
              {v.current ? <StateDot tone="good">{W.label.nowMark}</StateDot> : <HButton size="small" disabled={held} aria-label={goBackWords(v.id)} data-go-back={v.id} onClick={() => onGoBack(v.id)}>{W.label.goBack}</HButton>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

