import { useEffect, useRef, useState } from 'react';
import { setupCommands } from './tutorial';
import ProductText, { Propernoun } from './ProductText';
import { destinations } from './content';
import { release, docsPath, setupRequirements, readerRelease } from './release';

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
    <summary>Beta guide: integrate a workflow with your project</summary>
    <div className="beta-guide-body">
      <p>{readerRelease.label} · {readerRelease.version}</p>
      <p>Use the setup builder to describe the work you already do and the decisions you retain. Your personal agent helps map that process into roles and handoffs, then compares it with a fixed Engineer, Founder, or Research specification. The page prepares text locally. It does not connect your account or start workers.</p>
      <h3>Review before installation</h3>
      <p>{readerRelease.capabilities.setup}</p>
      <p>{readerRelease.capabilities.execution} A portable assistant profile and team blueprint in <code>.bowerloom</code> are the complete result of this exercise.</p>
      <p>Roles, skills, handoffs, and review expectations stay in files that follow you. You can version those definitions with your project and inspect them in another agent application. Credentials and installation receipts stay private. Moving definitions does not transfer permissions or prove that another application can execute them.</p>
      <h3>Install the beta CLI</h3>
      <p><ProductText>{`Requirements: ${setupRequirements}`}</ProductText> Read the <a href={docsPath}>documentation</a> and <a href={destinations.readme} target="_blank" rel="noopener noreferrer">README <span className="sr-only">(opens in a new tab)</span></a> before installing anything.</p>
      <pre><code>{setupCommands}</code></pre>
      <p>{readerRelease.installNote} {readerRelease.platforms}</p>
      <h3>Choose your startup path</h3>
      <p>Open a terminal in your project folder and run <code>bowerloom up --team &lt;name&gt; --goal &lt;goal&gt;</code> with the team name and goal you choose. It adds only <code>.bowerloom</code>, keeps your project files as they are, and does not import <code>.codex</code> or <code>.claude</code> configuration. If <code>.bowerloom</code> already exists, use <a href={`${docsPath}revision/`}>revision</a> for its next change.</p>
      <p><code>up</code> uses the Engineer profile. For <code>--profile founder</code> or <code>--profile research</code>, use the <code>init</code> forms that <code>bowerloom help advanced</code> lists. Each template defines a lead, maker, and reviewer. The research profile prepares a protocol. It does not run experiments.</p>
      <pre><code>{`bowerloom up --team "First team" --goal "Map my existing project workflow from planning through review."
# Review the plan. Run it again with --approve only after approving its exact revision.
bowerloom up --team "First team" --goal "Map my existing project workflow from planning through review." --approve REPLACE_WITH_EXACT_PLAN_REVISION
bowerloom status`}</code></pre>
      <p>Each run shows one step and its plan, then exits 3. Repeat with each new revision until <code>up</code> prints <code>prepared, workers held</code>. Add <code>--json</code> to see a plan as one JSON object. Keep inputs unchanged between plan and approval.</p>
      <p>After installation, ask your agent to read <code>.bowerloom/startup-review.md</code> and <code>.bowerloom/START-HERE.md</code> with you. Compare <code>team.yaml</code>, the role prompts, the working agreement, and the handoff map with your workflow. Report gaps before any separately approved project work. {readerRelease.capabilities.revision}</p>
      <h3 id="local-backend">Backend operations need separate setup</h3>
      <p>The prompt builder and local startup files do not need a backend. Backend operations require {release.requirements.backend}. {readerRelease.capabilities.connections}</p>
      <p><Propernoun>Vines</Propernoun> records logs. <Propernoun>Workbench</Propernoun> holds repeatable experiments and tests. Their database-backed paths use upstream PostgreSQL. Supabase supplies local database services, and the controller uses the MIT DBOS library. These dependencies do not make a team ready to run.</p>
      <p>Use the <a href={`${docsPath}backend/`}>backend guide</a> to review the supported setup and its exact approval boundaries. Keep credentials separate from portable files, and never reuse an unrelated database or reset existing data.</p>
      <h3 id="beta-evidence">Supported tasks and limits</h3>
      <p>{readerRelease.capabilities.execution} {readerRelease.capabilities.harnesses} {readerRelease.capabilities.skills} {readerRelease.capabilities.connections}</p>
      <h3 id="release-plan">Beyond local setup</h3>
      <p>{readerRelease.beyondSetup}</p>
      <p>{readerRelease.unattended}</p>
      <p>Bowerloom is free and open source. Agent accounts, hosting, and connected services can have separate costs.</p>
      <h3>Get help and share feedback</h3>
      <p>Report reproducible bugs in <a href={destinations.bugs}>GitHub Issues</a>. Ask questions in <a href={destinations.questions}>Q&amp;A</a>, share general feedback in <a href={destinations.feedback}>General</a>, and discuss features in <a href={destinations.ideas}>Ideas</a>.</p>
      <p><a href={`${docsPath}feedback/`}>Bug reports and feedback</a></p>
    </div>
  </details>;
}
