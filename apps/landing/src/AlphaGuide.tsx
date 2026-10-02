import { useEffect, useRef, useState } from 'react';
import { setupCommands } from './tutorial';
import ProductText, { Propernoun } from './ProductText';
import { destinations, repository } from './content';

const guideAnchors = new Set(['#alpha-guide', '#alpha-evidence', '#release-plan', '#local-backend']);

export default function AlphaGuide() {
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
  return <details className="alpha-guide" id="alpha-guide" ref={guide} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Alpha guide: from a goal to a working agreement</summary>
    <div className="alpha-guide-body">
      <p>Start with the tutorial maker below. Describe a result, choose your review cadence, and take the generated prompt to your existing personal agent. The page prepares text locally; it does not connect your account or start workers.</p>
      <h3>Agree before the team begins</h3>
      <p>Your agent inspects its available tools and proposes roles, file ownership, permissions, and milestones. You approve the working agreement before it starts workers. A proposed team, a validated definition, and a running team are different states.</p>
      <p>Codex is the tested alpha path. If a project requires the personal agent’s native subagents, the agreement must say so. Native subagent work is not Bowerloom runtime evidence.</p>
      <h3>Try the source checkout</h3>
      <p>Ask your agent to inspect the public repository and the <a href={destinations.readme} target="_blank" rel="noopener noreferrer">README <span className="sr-only">(opens in a new tab)</span></a> first. It must review dependency installation with you and use a new project folder.</p>
      <p><ProductText>Source setup requires git, node 24.11 or later within version 24, and npm 11. These commands build the CLI and validate one example. They do not launch a team.</ProductText></p>
      <pre><code>{setupCommands}</code></pre>
      <p>The portable installer copies selected skill and team files after approval of the exact file plan. It stays offline and grants no authority to execute those files.</p>
      <h3 id="local-backend">A local backend, built on Supabase</h3>
      <p>Bowerloom builds on upstream tools. Supabase provides PostgreSQL and Studio, its database interface. Docker runs the local services. The tested controller uses the MIT DBOS library for durable work; the recorded blog-draft recipe uses LangGraph checkpoints in PostgreSQL.</p>
      <p><Propernoun>Vines</Propernoun> is the logging tool. This alpha validates logging maps; it does not ship a standalone Vines collection service. <Propernoun>Workbench</Propernoun> runs tests through an installed controller backed by PostgreSQL. Neither module replaces the upstream database.</p>
      <p>The prompt builder and portable file installer do not need Docker. For backend-dependent work, the source CLI can plan a separate local Supabase installation. The first adapter supports macOS with Docker Desktop on Apple silicon. Cloud configuration belongs to later versions.</p>
      <p>The backend plan identifies five pinned images, its ports, private files, and owned volumes. It requires 16 GiB free: a 12 GiB reserve plus a 4 GiB growth allowance. That allowance is an estimate, not a storage quota. Installation requires the exact plan revision as approval.</p>
      <pre><code>{`node dist/apps/cli/src/main.js backend doctor
node dist/apps/cli/src/main.js backend plan --root /absolute/private-parent/bowerloom-local
node dist/apps/cli/src/main.js backend install --root /absolute/private-parent/bowerloom-local --approve REPLACE_WITH_EXACT_PLAN_REVISION
node dist/apps/cli/src/main.js backend status --root /absolute/private-parent/bowerloom-local`}</code></pre>
      <p>Create the private parent first and use an unused installation path. Review the plan before copying its revision into the install command. Docker host installation remains a separate prerequisite. Your agent must not reuse an unrelated database or reset existing data.</p>
      <p>The local profile includes PostgreSQL, Studio, postgres-meta, PostgREST, and Kong. It creates no agent runtime, workers, recipe credentials, or company access rules. Authentication, Storage, Realtime, and other Supabase services are outside this profile. Failed installations preserve their files and data for inspection.</p>
      <h3 id="alpha-evidence">What the recorded evidence covers</h3>
      <p>The separate Labs-to-blog test produced a GitHub draft pull request from committed experiment evidence. It required an exact plan and local approval before the external write.</p>
      <p>A test deliberately dropped GitHub’s successful response. Bowerloom paused the uncertain write, then a fresh process recovered the saved result. Two later runs returned that result without new HTTP requests or duplicate drafts.</p>
      <p>That result covers one prepared workflow and installation. It does not prove arbitrary team execution, productivity gains, or automatic self-improvement. The alpha trusts the designated local operator; it does not independently prove that a human issued approval. MCP does not expose that approval action.</p>
      <p>For that integration, the operator supplies a repository-scoped GitHub App and PostgreSQL installation. Keep credentials outside portable definitions. Setup, model admission, external writes, and publication retain their separate controls.</p>
      <h3 id="release-plan">What comes next</h3>
      <p><code>v0.7-alpha</code> is the Codex-first testing release. <code>v0.7-beta</code> adds the planned tests for a second harness, personal installations, and a shared company server. Semantic retrieval, access, offboarding, and deletion remain explicit beta test requirements.</p>
      <p><code>v1-beta</code> and <code>v1-rc</code> follow those gates. Labs-only <code>workbench</code> versions are internal experiment labels, not releases for end users. Founder acceptance and publication remain separate from passing tests.</p>
      <p>Source changes and reviews live in <a href={`${repository}/pull/7`} target="_blank" rel="noopener noreferrer">the alpha pull request <span className="sr-only">(opens in a new tab)</span></a>. Bowerloom declares an MIT license. Agent accounts, hosting, and connected services can have separate costs.</p>
    </div>
  </details>;
}
