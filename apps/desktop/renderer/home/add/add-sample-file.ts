/**
 * A small shared file, as text, for the Add test page and its tests. It holds new skills, a new agent, a tool that needs a key, a set of notes, a skill
 * that is already there with the same text, and a skill that is there with other text. Opening it in the Add test page's world shows all three
 * answers: what will be added, what is already here, and what has two different copies. Every path in it is invented and never shown.
 */
import { bundleText } from '../../../shared/proto/export-flow.js';
import { hashText } from '../../../shared/proto/sample.js';
import { HOME_SCOPE_ID } from './add-demo-world.js';
import type { AgentItem, Bundle, FoundAt, SkillItem } from '../../../shared/proto/types.js';

const at = (text: string): FoundAt => ({ interface: 'claude-code', path: 'skills/shared/SKILL.md', contentHash: hashText(text), text });
const skill = (id: string, name: string, description: string, text: string): SkillItem => ({ id, kind: 'skill', name, scopeId: HOME_SCOPE_ID, library: null, description, foundAt: [at(text)] });

/** The text of the file: a bundle written the way a person's Share would write it. */
export function sharedFileSample(): string {
  const prepare = skill('file-prepare', 'Prepare for a call', 'Get ready for a call with a short brief.', 'Read the last three messages.\nWrite the goal of the call.\nList two questions to ask.');
  const thanks = skill('file-thanks', 'Thank a client', 'Write a warm thank-you note to a client.', 'Name one thing the client did.\nSay what it made possible.\nKeep it to four lines.');
  const sameReply = skill('skill-reply', 'Write a reply', 'Write a kind, clear reply to a message.', 'Read the message twice.\nAnswer every question.\nKeep it short.');
  const otherInbox = skill('skill-inbox', 'Sort my inbox', 'Group new mail by what needs an answer first.', 'List the new mail.\nPut mail from people first.\nLeave newsletters for Friday.');
  const caller: AgentItem = {
    id: 'file-caller', kind: 'agent', name: 'Call preparer', scopeId: HOME_SCOPE_ID, library: null, foundAt: [],
    definition: { name: 'Call preparer', role: 'preparer', instructions: 'Get ready for each call. Ask before you guess.', skillIds: ['file-prepare', 'file-thanks'], toolAttachments: [{ toolId: 'file-notes-app', access: 'read-only' }] },
    extras: [],
  };
  const bundle: Bundle = {
    scopeIds: [HOME_SCOPE_ID],
    items: [prepare, thanks, sameReply, otherInbox, caller],
    toolRefs: [{ toolId: 'file-notes-app', name: 'Notes app', toolKind: 'mcp', secret: { kind: 'env', name: 'NOTES_APP_KEY' } }],
    sliceRules: [{ sliceId: 'file-calls', name: 'Call notes', rule: { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null } }],
  };
  return bundleText(bundle);
}
