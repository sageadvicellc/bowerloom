/**
 * A page for the Setup e2e that needs more than one conflict. The sample world has one item found twice with different text; this page makes two
 * more, so the review step has three, and mounts the real SetupScreen on it. Nothing else is changed.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { applyMotionTokens } from '../renderer/motion-tokens.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { SetupScreen } from '../renderer/proto/SetupScreen.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import { createStore } from '../shared/proto/store.js';
import type { HarnessItem } from '../shared/proto/types.js';

const base = generateWorld(1);
const more = base.items.filter(i => i.kind === 'skill' && i.library === null && i.id !== CASE_IDS.tripleSkill && i.foundAt.length >= 2).slice(0, 2).map(i => i.id);
const items = base.items.map((i): HarnessItem => (more.includes(i.id)
  ? { ...i, foundAt: i.foundAt.map((f, n) => (n === 0 ? f : { ...f, contentHash: `${f.contentHash}-changed`, text: `${f.text}\nA different line.` })) }
  : i));
const world = { ...base, items };
const store = createStore(world);

(window as unknown as { __conflicts: string[] }).__conflicts = [CASE_IDS.tripleSkill, ...more];
applyMotionTokens();
createRoot(document.getElementById('main')!).render(createElement(ProtoProvider, { store, children: createElement(SetupScreen, { world: store.getState().draft }) }));
(window as unknown as { __ready: boolean }).__ready = true;
