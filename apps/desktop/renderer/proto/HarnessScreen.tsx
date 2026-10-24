/**
 * The harness editor (spec 6.3 to 6.6, 6.13 and section 7, screen 2): the harness as one graph with a scope switch, the inherit, hide and replace
 * controls, an inspector, and a change bar that shows what would be written before anything is. Every change goes through the store and stays in memory.
 *
 * `HarnessScreen` draws a plain line when there is no session above it (the shell test renders every screen with only a world).
 * The editor itself is `HarnessEditor`, which reads and changes the store.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { ACCESS_WORDS, buildHarnessMap, interfaceName, scopeNodeId } from '../../shared/proto/harnessmodel.js';
import type { HarnessMapModel, HarnessView } from '../../shared/proto/harnessmodel.js';
import {
  attachToolOutcome, connectOutcome, copyOutcome, dropOutcome, keepBothOutcome, keepOneOutcome, menuOutcome, overrideOutcome, replacementChoices,
} from '../../shared/proto/editor-actions.js';
import type { EditorContext, EditorOutcome } from '../../shared/proto/editor-actions.js';
import { describeSelection } from '../../shared/proto/editor-describe.js';
import type { SelectionAction } from '../../shared/proto/editor-describe.js';
import { planProjection } from '../../shared/proto/plan.js';
import { isDirty } from '../../shared/proto/store.js';
import type { AccessClass, InterfaceId, Plan } from '../../shared/proto/types.js';
import { prefersReducedMotion } from '../motion-tokens.js';
import { HarnessCanvas } from './HarnessCanvas.js';
import { AccessDialog, ChangeBar, ConflictDialog, Inspector, ResultPanel } from './harness-parts.js';
import { keepPositions, positionsFor } from './harness-positions.js';
import { useOptionalProtoStore } from './harness-session.js';
import type { ProtoSession } from './session.js';
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';

const INTERFACES: readonly InterfaceId[] = ['claude-code', 'codex', 'opencode'];

/** The screen. With a session it is the editor; without one it is the title and the number of items. */
export function HarnessScreen({ world }: ScreenProps): ReactElement {
  const session = useOptionalProtoStore();
  if (session === null) {
    return (
      <div className="page">
        <h1 tabIndex={-1}>{ROUTE_LABELS.harness}</h1>
        <p className="muted">{countLine('harness', world)}</p>
      </div>
    );
  }
  return <HarnessEditor session={session} />;
}

// ------------------------------------------------------------------------------------------------------------- small hooks

/** True while the person has asked for less motion. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const change = (): void => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

interface Note { readonly text: string; readonly refused: boolean }
interface Done { readonly plan: Plan; readonly label: string; readonly counter: number | null }
type Pending = { readonly plan: Plan; readonly label: string } | null;

// ------------------------------------------------------------------------------------------------------------- the editor

function HarnessEditor({ session }: { session: ProtoSession }): ReactElement {
  const { state, dispatch } = session;
  const world = state.draft;
  const dirty = isDirty(state);
  const reduceMotion = useReducedMotion();

  const [scopeId, setScopeId] = useState(() => world.scopes.find(s => s.kind === 'global')?.id ?? world.scopes[0]?.id ?? '');
  const [showInherited, setShowInherited] = useState(true);
  const [only, setOnly] = useState<InterfaceId | null>(null);
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [accessFor, setAccessFor] = useState<{ agentId: string; toolId: string; agentName: string; toolName: string; current: AccessClass | null } | null>(null);
  const [replaceFor, setReplaceFor] = useState<{ itemId: string; value: string } | null>(null);
  const [conflictFor, setConflictFor] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const pending = useRef<Pending>(null);
  const inspectorHeading = useRef<HTMLHeadingElement>(null), resultHeading = useRef<HTMLHeadingElement>(null), planToggle = useRef<HTMLButtonElement>(null);

  const view = useMemo<HarnessView>(() => ({ scopeId, showInherited, expandedGroups: expanded, ...(only === null ? {} : { interfaceFilter: only }) }), [scopeId, showInherited, expanded, only]);
  const model = useMemo<HarnessMapModel>(() => buildHarnessMap(world, view), [world, view]);
  const ctx = useMemo<EditorContext>(() => ({ world, model }), [world, model]);
  const scope = world.scopes.find(s => s.id === model.scopeId);
  const selection = useMemo(() => (selectedId === null ? null : describeSelection(world, model, selectedId)), [world, model, selectedId]);
  const plan = useMemo<Plan>(() => (dirty ? planProjection(state.committed, state.draft) : { changes: [] }), [dirty, state.committed, state.draft]);

  // The store clears both stacks on Apply and Restore, so Undo and Redo never walk back past a version. Discard keeps them: it says Undo brings the changes back.
  const canUndo = state.undoStack.length > 0;
  const canRedo = state.redoStack.length > 0;
  // Where the person put the nodes, kept for the session and for each scope (the canvas keeps them only while it is on the screen).
  const [, placesChanged] = useReducer((n: number) => n + 1, 0);

  // After Apply the store has a new version: pick up its number for the result panel.
  useEffect(() => {
    const p = pending.current;
    if (p === null || state.headVersionId === null) return;
    pending.current = null;
    const head = state.committed.versions.find(v => v.id === state.headVersionId);
    setDone({ plan: p.plan, label: head?.label ?? p.label, counter: head?.counter ?? null });
    setPlanOpen(false);
    window.requestAnimationFrame(() => resultHeading.current?.focus());
  }, [state.headVersionId, state.committed.versions]);
  // A new change after Apply closes the result.
  useEffect(() => { if (dirty) setDone(null); }, [dirty]);
  useEffect(() => { if (!dirty) setPlanOpen(false); }, [dirty]);

  const say = useCallback((text: string, refused = false) => setNote({ text, refused }), []);
  const focusSelectedNode = useCallback((): HTMLElement | null => document.querySelector<HTMLElement>(selectedId === null ? '.harness-page h1' : `.react-flow__node[data-id="${CSS.escape(selectedId)}"]`) ?? document.querySelector<HTMLElement>('.harness-page h1'), [selectedId]);

  /** Does what an outcome says: send the action, ask for one more choice, or say why nothing happened. */
  const run = useCallback((o: EditorOutcome): void => {
    switch (o.kind) {
      case 'action': dispatch(o.action); say(o.message); break;
      case 'choose-access': setAccessFor({ agentId: o.agentId, toolId: o.toolId, agentName: o.agentName, toolName: o.toolName, current: o.current }); break;
      case 'choose-replacement': {
        const first = replacementChoices(ctx, o.itemId)[0];
        setSelectedId(o.itemId); setReplaceFor({ itemId: o.itemId, value: first?.id ?? '' });
        say(`Pick the item that takes the place of ${o.itemName}.`);
        break;
      }
      case 'refused': say(o.message, true); break;
    }
  }, [ctx, dispatch, say]);

  /** Where the keyboard goes when the details close: the node that was open, or the scope switch when it is gone. */
  const focusCanvasOrScope = (): HTMLElement | null => {
    const node = selectedId === null ? null : document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(selectedId)}"]`);
    return node ?? document.querySelector<HTMLElement>('.harness-toolbar select');
  };
  const closeInspector = (): void => { focusCanvasOrScope()?.focus(); select(null); };

  const changeScope = (id: string): void => { setScopeId(id); setSelectedId(null); setReplaceFor(null); setNote(null); };
  const select = (id: string | null): void => { setSelectedId(id); setReplaceFor(null); };

  const onNodeMenu = (id: string, action: 'hide' | 'unhide' | 'replace' | 'expand' | 'collapse' | 'open'): void => {
    if (action === 'expand') { setExpanded(prev => (prev.includes(id) ? prev : [...prev, id])); say('The library is open. Its items are read only.'); return; }
    if (action === 'collapse') { setExpanded(prev => prev.filter(x => x !== id)); say('The library is shown as one group.'); return; }
    if (action === 'open') {
      select(id);
      const node = model.nodes.find(n => n.id === id);
      if (node?.conflict === true) setConflictFor(id);
      else window.requestAnimationFrame(() => inspectorHeading.current?.focus());
      return;
    }
    select(id);
    run(menuOutcome(ctx, id, action));
  };

  const onInspectorAction = (a: SelectionAction): void => {
    if (selection === null) return;
    const id = selection.nodeId;
    switch (a.id) {
      case 'keep-from-global': run(overrideOutcome(ctx, id, 'inherit')); break;
      case 'hide-here': run(overrideOutcome(ctx, id, 'hide')); break;
      case 'replace-here': run(overrideOutcome(ctx, id, 'replace')); break;
      case 'copy': run(copyOutcome(ctx, id)); break;
      case 'resolve': setConflictFor(id); break;
      case 'toggle-group': onNodeMenu(id, model.nodes.find(n => n.id === id)?.expanded === true ? 'collapse' : 'expand'); break;
      default: if (a.store !== undefined) { dispatch(a.store); say(a.done ?? 'Done.'); }
    }
  };

  const replaceChoices = replaceFor === null ? [] : replacementChoices(ctx, replaceFor.itemId).map(i => ({
    id: i.id, label: `${i.name}${i.scopeId === model.scopeId ? ' (this project)' : ''}${i.library === null ? '' : ' (library)'}`,
  }));
  const replace = replaceFor !== null && selection !== null && selection.nodeId === replaceFor.itemId
    ? {
      choices: replaceChoices, value: replaceFor.value,
      onChange: (value: string) => setReplaceFor({ itemId: replaceFor.itemId, value }),
      onConfirm: () => { const o = overrideOutcome(ctx, replaceFor.itemId, 'replace', replaceFor.value); setReplaceFor(null); run(o); },
      onCancel: () => setReplaceFor(null),
    }
    : null;

  // The keyboard way to do what a drop on the harness does: only for a skill or an agent that this harness inherits, and not for a library item,
  // which already has its own "Make an editable copy" button.
  const selectedNode = selection === null ? undefined : model.nodes.find(n => n.id === selection.nodeId);
  const selectedItem = selection === null ? undefined : world.items.find(i => i.id === selection.nodeId);
  const copyHere = selection !== null && selectedNode?.inherited === true && selectedItem !== undefined && (selectedItem.kind === 'skill' || selectedItem.kind === 'agent') && !selection.actions.some(a => a.id === 'copy')
    ? () => run(dropOutcome(ctx, selection.nodeId, scopeNodeId(model.scopeId)))
    : null;

  const conflictItem = conflictFor === null ? undefined : world.items.find(i => i.id === conflictFor);

  const apply = (): void => {
    if (!dirty) return;
    pending.current = { plan, label: label.trim() === '' ? 'Applied changes' : label.trim() };
    dispatch({ type: 'apply', label });
    setLabel('');
    say('Applied. The changes are written and saved as a version.');
  };

  return (
    <div className="page map-page harness-page">
      <div className="map-head harness-head">
        <h1 tabIndex={-1}>{ROUTE_LABELS.harness}</h1>
        <p className={`harness-message${note?.refused === true ? ' is-refused' : ''}`} role="status" aria-live="polite">
          {note === null ? '' : <><strong>{note.refused ? 'Nothing changed.' : 'Done.'}</strong> {note.text}</>}
        </p>
      </div>

      <div className="harness-toolbar">
        <label className="harness-field inline"><span>Scope</span>
          <select value={scopeId} onChange={e => changeScope(e.target.value)}>
            {world.scopes.map(s => <option key={s.id} value={s.id}>{s.name} ({s.kind === 'global' ? 'global' : 'project'})</option>)}
          </select>
        </label>
        <label className="toggle small"><input type="checkbox" checked={showInherited} disabled={scope?.kind !== 'project'} onChange={e => setShowInherited(e.target.checked)} /><span>Show inherited</span></label>
        <div className="harness-chips" role="group" aria-label="Show only items found in">
          {INTERFACES.map(id => (
            <button key={id} type="button" className="harness-chip" aria-pressed={only === id} onClick={() => setOnly(prev => (prev === id ? null : id))}>{interfaceName(id)}</button>
          ))}
        </div>
      </div>

      <div className="harness-body">
        <div className="harness-canvas">
          <HarnessCanvas
            model={model} selectedId={selection === null ? null : selection.nodeId} reduceMotion={reduceMotion}
            onSelect={select}
            onConnect={(from, to) => run(connectOutcome(ctx, from, to))}
            onDropOnNode={(dragged, target) => run(dropOutcome(ctx, dragged, target))}
            onNodeMenu={onNodeMenu}
            positions={positionsFor(session.dispatch, model.scopeId)}
            onPositionsChange={places => { keepPositions(session.dispatch, model.scopeId, places); placesChanged(); }}
          />
        </div>
        <Inspector view={selection} onAction={onInspectorAction} onClose={closeInspector} headingRef={inspectorHeading} replace={replace} copyHere={copyHere} />
      </div>

      <div className="harness-foot">
      {done === null ? null : <ResultPanel plan={done.plan} counter={done.counter} label={done.label} onClose={() => setDone(null)} headingRef={resultHeading} />}
      <ChangeBar
        dirty={dirty} plan={plan} open={planOpen} onToggle={() => setPlanOpen(o => !o)} toggleRef={planToggle}
        canUndo={canUndo} canRedo={canRedo} onUndo={() => dispatch({ type: 'undo' })} onRedo={() => dispatch({ type: 'redo' })}
        onDiscard={() => { dispatch({ type: 'discard' }); say('The waiting changes are discarded. Undo brings them back.'); }}
        label={label} onLabel={setLabel} onApply={apply}
      />
      </div>

      {accessFor === null ? null : (
        <AccessDialog
          agentName={accessFor.agentName} toolName={accessFor.toolName} current={accessFor.current} onClose={() => setAccessFor(null)}
          onPick={access => { const f = accessFor; setAccessFor(null); run(attachToolOutcome(f.agentId, f.toolId, access, ACCESS_WORDS, f.agentName, f.toolName)); }}
        />
      )}
      {conflictItem === undefined ? null : (
        <ConflictDialog
          world={world} item={conflictItem} onClose={() => setConflictFor(null)} fallbackFocus={focusSelectedNode}
          onKeepOne={index => { const o = keepOneOutcome(conflictItem, index); setConflictFor(null); run(o); }}
          onKeepBoth={names => { const o = keepBothOutcome(world, conflictItem, names); if (o.kind === 'action') setConflictFor(null); run(o); }}
        />
      )}
    </div>
  );
}
