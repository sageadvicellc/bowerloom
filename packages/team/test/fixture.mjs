// Synthetic team folders for the team tests. No private paths, no real people, no real models, no real secrets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FORMAT = 'bowerloom/team/v1beta1';
export const RELAY_FORMAT = 'trellis/relay-map/v0.7-alpha';

const roots = [];
/** A fresh folder under the system temporary folder, by its real path. */
export function tempDir(prefix = 'bowerloom-team-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}
export function cleanup() {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export const json = value => JSON.stringify(value, null, 2) + '\n';

export function member(id, extra = {}) {
  return {
    id, purpose: `The ${id} member does its part of the work.`, engine: 'claude-code', model: 'model-a', folder: '.',
    start: 'headless', inbox: 'accept', reports_to: 'human', ...extra,
  };
}

/** A valid team file: a lead on Claude Code in the project folder and a maker on Codex in its own worktree. */
export function teamFile(extra = {}) {
  return {
    format: FORMAT,
    id: 'demo-team',
    description: 'A demo team that plans and builds a small change.',
    harness: 'demo',
    members: [member('lead'), member('maker', { engine: 'codex', model: 'model-b', folder: 'wt/maker', reports_to: 'lead' })],
    limits: { activeMembers: 2 },
    ...extra,
  };
}

export function route(from, to, extra = {}) {
  return { fromOwner: from, fromTask: 'plan', toOwner: to, toTask: 'build', delivery: 'accepted-output', bindings: [{ output: 'doc', input: 'doc' }], ...extra };
}
export function relayMap(participants = ['lead', 'maker'], routes = [route('lead', 'maker')]) {
  return { format: RELAY_FORMAT, participants, routes };
}

/** A team with a relay map: `team.json` points at `maps/relay.json`. */
export function withRelay(team = teamFile({ routes: 'maps/relay.json' }), map = relayMap()) {
  return { 'team.json': json(team), 'maps/relay.json': json(map) };
}

/**
 * Writes a project with `.bowerloom/teams/<id>/` holding `files` (path to text or bytes). Returns the project folder
 * and the team folder. `folders` are created under the project, for member worktrees.
 */
export function makeTeam(files, { id = 'demo-team', folders = [] } = {}) {
  const project = tempDir();
  const folder = path.join(project, '.bowerloom', 'teams', id);
  fs.mkdirSync(folder, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(folder, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  for (const f of folders) fs.mkdirSync(path.join(project, f), { recursive: true });
  return { project, folder };
}

export const codes = r => (r.ok ? [] : r.problems.map(p => p.code));

/** A neutral guardrail rule, as the loader returns it (with no private blocks). */
export function rule(id, extra = {}) {
  return { id, action: 'shell', pattern: 'git push *', effect: 'deny', strength: 'enforced', ...extra };
}
export const loaded = r => ({ ...r, privateBlocks: {} });

/** A recorded approval of one weakened or absent line. `entryHash` comes from the contract. */
export function approval(entryHash, entry, extra = {}) {
  return {
    part: 'guardrails', entry, engine: 'pi', result: 'absent', entryHash,
    who: 'Avery Example', when: '2026-10-28T12:00:00Z', reason: 'The synthetic Pi member runs read-only work.', ...extra,
  };
}
export const NOW = new Date('2026-10-28T13:00:00Z');

/** A 0.7 crew file, `trellis/crew/v0.7-alpha`, with two owners and two tasks. */
export const CREW_YAML = `format: trellis/crew/v0.7-alpha
id: demo-crew
description: A demo crew that plans and builds a small change.
requiredCapabilities:
  - workspace.write
  - approval.exact-revision
budget:
  maxActiveWorkers: 2
  reservePercent: 25
  paidFallback: false
scope:
  - operation: workspace.write
    path: output/plan.md
  - operation: workspace.write
    path: output/build.md
assets:
  lead-prompt:
    path: prompts/lead.md
    mediaType: text/markdown
  maker-prompt:
    path: prompts/maker.md
    mediaType: text/markdown
owners:
  - id: lead
    role: Plans the change
    prompt: lead-prompt
    skills: []
    modelClass: reasoning
    permissions:
      - operation: workspace.write
        path: output/plan.md
  - id: maker
    role: Builds the change
    prompt: maker-prompt
    skills: []
    modelClass: economy
    permissions:
      - operation: workspace.write
        path: output/build.md
tasks:
  - id: plan
    owner: lead
    description: Write a short plan.
    dependsOn: []
    requires:
      - workspace.write
      - approval.exact-revision
    inputs: {}
    outputs:
      doc:
        kind: artifact
        mediaType: text/markdown
    effects:
      - operation: workspace.write
        path: output/plan.md
    approval: required
    policy:
      maxAttempts: 1
      timeoutSeconds: 300
      deadlineSeconds: 1800
      backoffSeconds: 0
      onFailure: escalate
    acceptance:
      - The plan names every file it changes.
  - id: build
    owner: maker
    description: Build what the plan says.
    dependsOn:
      - plan
    requires:
      - workspace.write
      - approval.exact-revision
    inputs:
      doc:
        type:
          kind: artifact
          mediaType: text/markdown
        source:
          task: plan
          output: doc
    outputs:
      doc:
        kind: artifact
        mediaType: text/markdown
    effects:
      - operation: workspace.write
        path: output/build.md
    approval: required
    policy:
      maxAttempts: 1
      timeoutSeconds: 300
      deadlineSeconds: 1800
      backoffSeconds: 0
      onFailure: escalate
    acceptance:
      - The build matches the plan.
`;
export const CREW_RELAY = json(relayMap(['lead', 'maker'], [route('lead', 'maker')]));

/** A 0.7 team folder in a project's `.bowerloom/teams/<id>/`. */
export function makeCrew({ id = 'demo-crew', yaml = CREW_YAML, relay = CREW_RELAY } = {}) {
  const files = { 'team.yaml': yaml, 'prompts/lead.md': 'Plan it.\n', 'prompts/maker.md': 'Build it.\n' };
  if (relay !== null) files['maps/relay.json'] = relay;
  return makeTeam(files, { id });
}

/** Every file below a folder, relative, with its bytes, in byte order of path. */
export function snapshot(dir) {
  const out = {};
  const walk = rel => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r); else out[r] = fs.readFileSync(path.join(dir, r)).toString('base64');
    }
  };
  walk('');
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
}
