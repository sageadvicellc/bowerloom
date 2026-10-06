import { useEffect, useRef, useState } from 'react';
import { setupCommands } from './tutorial';
import ProductText, { Propernoun } from './ProductText';
import { destinations } from './content';
import { release, docsPath, setupRequirements, installAvailable } from './release';

const guideAnchors = new Set(['#beta-guide', '#beta-evidence', '#release-plan', '#local-backend']);

export default function BetaGuide() {
  const [open, setOpen] = useState(() => guideAnchors.has(window.location.hash));
  const guide = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let frame = 0;
    const followHash = () => {
      if (!guideAnchors.has(window.location.hash)) return;
      setOpen(true);
      frame = requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' }));
    };
    const followSameHash = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (link?.getAttribute('href') === window.location.hash) followHash();
    };
    followHash();
    window.addEventListener('hashchange', followHash);
    document.addEventListener('click', followSameHash);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', followHash); document.removeEventListener('click', followSameHash); };
  }, []);
  return <details className="beta-guide" id="beta-guide" ref={guide} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Beta guide: from a goal to a reviewable setup</summary>
    <div className="beta-guide-body">
      <p><strong>{release.statusLabel}</strong>. {release.npm.availabilityNote}</p>
      <p>Start with the setup builder below. Choose Engineer, Founder, or Research, describe your goal, and take the prompt to your existing personal agent. This page prepares text locally; it does not connect your account or start workers.</p>
      <h3>Review before installation</h3>
      <p>{release.capabilities.setup}</p>
      <p>{release.capabilities.execution} A portable assistant profile and team blueprint in <code>.bowerloom</code> are the complete result of this exercise.</p>
      <h3>{installAvailable ? 'Install the beta CLI' : 'Installation after publication'}</h3>
      <p><ProductText>{`Requirements: ${setupRequirements}`}</ProductText> Read the <a href={docsPath}>documentation</a> and <a href={destinations.readme} target="_blank" rel="noopener noreferrer">README <span className="sr-only">(opens in a new tab)</span></a> before installing anything.</p>
      <pre><code>{setupCommands}</code></pre>
      <p>{release.systems.note} The tested setup environment is {release.systems.tested.map(system => `${system.os} ${system.architecture}, node ${system.node}`).join('; ')}.</p>
      <h3>Choose your startup path</h3>
      <p>Once the CLI is available, choose <code>--mode new</code> with an unused directory, or <code>--mode existing</code> with an existing project. Both paths prepare a personal-agent profile and first team from your goal.</p>
      <p>Choose <code>--profile engineer</code>, <code>--profile founder</code>, or <code>--profile research</code>. Each template defines a lead, maker, and reviewer. The research profile prepares a protocol; it does not run experiments.</p>
      <pre><code>{`bowerloom init plan --mode new --target /absolute/projects/first-team --profile engineer --name "First team" --goal "Prepare a fictional project plan for my review."
bowerloom init apply --mode new --target /absolute/projects/first-team --profile engineer --name "First team" --goal "Prepare a fictional project plan for my review." --approve REPLACE_WITH_EXACT_PLAN_REVISION
bowerloom init status --target /absolute/projects/first-team`}</code></pre>
      <p>Use an existing parent directory. Read the plain review before approval; add <code>--json</code> to <code>init plan</code> to inspect every file and hash. Keep inputs unchanged between plan and apply. Use <code>--brief /absolute/brief.json</code> for a structured brief.</p>
      <p>Existing mode adds a new <code>.bowerloom</code> directory and preserves project files. It rejects an existing Bowerloom installation. It does not import <code>.codex</code> or <code>.claude</code> settings.</p>
      <p>After installation, ask your agent to read <code>.bowerloom/startup-review.md</code> and <code>.bowerloom/START-HERE.md</code> with you. Stop to review the profile, team and working agreement. {release.capabilities.revision}</p>
      <h3 id="local-backend">Backend operations need separate setup</h3>
      <p>The prompt builder and local startup files do not need a backend. Backend operations require {release.requirements.backend}. {release.capabilities.connections}</p>
      <p><Propernoun>Vines</Propernoun> records logs; <Propernoun>Workbench</Propernoun> holds repeatable experiments and tests. Their database-backed paths use upstream PostgreSQL. Supabase supplies local database services, and the controller uses the MIT DBOS library. These dependencies do not make a team ready to run.</p>
      <p>Use the <a href={`${docsPath}backend/`}>backend guide</a> to review the supported setup and its exact approval boundaries. Keep credentials separate from portable files, and never reuse an unrelated database or reset existing data.</p>
      <h3 id="beta-evidence">What the current evidence covers</h3>
      <ul>{release.systems.tested.map(system => <li key={system.os + system.architecture}>{system.os} {system.architecture}: {system.scope}.</li>)}</ul>
      <p>{release.capabilities.harnesses} {release.capabilities.company}</p>
      <p>Earlier Labs-to-blog tests covered one prepared workflow with exact local approval before a GitHub write. Those results do not establish arbitrary team execution, productivity gains or automatic self-improvement. MCP does not expose that approval action.</p>
      <h3 id="release-plan">Current release boundaries</h3>
      <ul>{release.capabilities.limits.map(limit => <li key={limit}>{limit}</li>)}</ul>
      <p>Read the <a href={`${docsPath}status/`}>support status</a> for the evidence and remaining gates. Labs-only <code>workbench</code> labels describe internal experiments. Bowerloom declares an MIT license; agent accounts, hosting and connected services can have separate costs.</p>
    </div>
  </details>;
}
