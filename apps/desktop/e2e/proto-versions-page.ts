/**
 * A page for the Versions e2e: the real VersionsScreen with a store that already holds three versions, in a shell that looks like the
 * app's. The real prototype cannot make a second version from the Setup screen alone (the Harness screen makes edits), so the
 * spec uses this page, and reaches the store through `window.__store` the way the Harness screen would, to make one more edit.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { applyMotionTokens } from '../renderer/motion-tokens.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { VersionsScreen } from '../renderer/proto/VersionsScreen.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import { createStore } from '../shared/proto/store.js';

const world = generateWorld(1);
const store = createStore(world);
const agent = world.items.find(i => i.kind === 'agent' && i.library === null)!;
const skill = world.items.find(i => i.kind === 'skill' && i.library === null && i.id !== CASE_IDS.tripleSkill && i.id !== CASE_IDS.hiddenSkill && !(agent.kind === 'agent' && agent.definition.skillIds.includes(i.id)))!;

store.dispatch({ type: 'installItem', itemId: CASE_IDS.newerLibraryItem, targetScopeId: 'global' });
store.dispatch({ type: 'apply', label: 'First harness: copied a library agent' });
store.dispatch({ type: 'setOverride', scopeId: 'scope-tallowbrook', itemId: CASE_IDS.hiddenSkill, mode: 'hide' });
store.dispatch({ type: 'apply', label: 'Hid a skill in Tallowbrook' });
store.dispatch({ type: 'attachSkill', agentId: agent.id, skillId: skill.id });
store.dispatch({ type: 'apply', label: 'Gave the first agent another skill' });

(window as unknown as { __store: typeof store; __ids: Record<string, string> }).__store = store;
(window as unknown as { __ids: Record<string, string> }).__ids = { hiddenSkill: CASE_IDS.hiddenSkill, agentId: agent.id, skillId: skill.id };
applyMotionTokens();
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => applyMotionTokens());
createRoot(document.getElementById('main')!).render(createElement(ProtoProvider, { store, children: createElement(VersionsScreen, { world: store.getState().draft }) }));
(window as unknown as { __ready: boolean }).__ready = true;
