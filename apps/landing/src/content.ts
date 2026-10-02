export const repository = "https://github.com/sageadvicellc/trellis";
const branch = `${repository}/blob/feature/trellis-v1`;
export const docs = `${branch}/docs/recipes/labs-to-blog.md`;
export const destinations = {
  trial: `${branch}/docs/recipes/live-acceptance.md`,
  pullRequest: `${repository}/pull/41`,
  mcp: `${branch}/apps/mcp/README.md`,
  evidence: `${branch}/docs/alpha/acceptance-status.md`,
  releasePlan: `${branch}/docs/transition/release-plan.md`,
  license: `${branch}/package.json`,
};
export const hero = {
  "Eyebrow": "Open tools. Personal agents.",
  "H1": "Grow your agent crew on Trellis",
  "Body": "Trellis is an open-source framework for building agent workflows in files you can read and change. Start with a completed experiment and a blog draft you can review.",
  "Primary CTA": "Build with your agent",
  "Secondary link": "See the first recipe",
  "Alpha note": "Local alpha, built first for Codex. The public installer and release are not published.",
  "Illustration caption": "A maker and a robot helper at the workshop."
} as const;

export const stages = [
  {
    "name": "Experiment",
    "tag": "01 / THE BENCH",
    "title": "Bring the completed work.",
    "description": "Select a completed experiment record and its committed evidence. This recipe starts with that record. It does not run a new experiment.",
    "artifact": "Completed experiment record",
    "color": "#C9F53A"
  },
  {
    "name": "Evidence",
    "tag": "02 / THE ARCHIVE",
    "title": "Keep the sources attached.",
    "description": "Use evidence files from a fixed Git revision. Trellis checks the supplied bytes and declared links. You still judge whether the draft accurately describes the evidence.",
    "artifact": "Evidence files and source links",
    "color": "#83DDD0"
  },
  {
    "name": "Draft",
    "tag": "03 / THE TABLE",
    "title": "Write in your voice.",
    "description": "Your personal agent prepares an evidence-linked blog draft. Trellis saves the draft, destination, and proposed change in a plan for review.",
    "artifact": "Blog draft and proposed change",
    "color": "#F2BE75"
  },
  {
    "name": "Approval",
    "tag": "04 / THE GATE",
    "title": "Approve the exact change.",
    "description": "The designated local operator approves the saved plan. Trellis then creates the draft pull request. Publication and merging remain separate decisions.",
    "artifact": "GitHub draft pull request",
    "color": "#C9F53A"
  }
] as const;

export const questions = [
  {
    "question": "What can I try today?",
    "answer": "The local, Codex-first alpha supports the prepared Labs-to-blog recipe. Your personal agent supplies the draft. Trellis records the plan, approval, and GitHub operations. General installation packaging and arbitrary crew execution remain outside this proof."
  },
  {
    "question": "Does Trellis publish the blog for me?",
    "answer": "The recipe creates or updates a draft pull request for the experiment. It never publishes or merges. You or your designated reviewer decide those later steps."
  },
  {
    "question": "Who can approve a change?",
    "answer": "The designated local operator records approval through the command-line interface. MCP, a connection interface for agent tools, does not expose approval. The alpha trusts local operator authority. It does not independently establish that a human issued approval."
  },
  {
    "question": "What happens if the GitHub response is lost?",
    "answer": "Trellis holds an uncertain write for inspection. The operator can request reconciliation, which uses reads to inspect the remote result. An unresolved result needs investigation. Trellis does not blindly resend the write. Reserve the recipe branch for one writer and avoid concurrent edits during dispatch."
  },
  {
    "question": "What stays in my files?",
    "answer": "Portable definitions contain the roles, skills, and permissions that describe the crew. Keep credentials and private installation details outside them. Recipe progress lives in PostgreSQL, and the draft result lives in GitHub."
  },
  {
    "question": "What are Crew, Relay, Roots, Vines, and Workbench?",
    "answer": "Crew defines roles, skills, and permissions. Relay connects agents. Roots holds knowledge with controlled access. Vines records logs. Workbench holds repeatable experiments and tests. Readiness differs across these pieces. The alpha evidence describes their current limits."
  },
  {
    "question": "Can I use another agent app or a shared team?",
    "answer": "Definitions live outside an individual agent app, but the tested alpha starts with Codex. Beta plans include Claude Code, shared company use, retrieval, and access and deletion tests. Those plans are not current alpha capabilities."
  },
  {
    "question": "Is the trial free to run?",
    "answer": "Trellis is intended to remain free and open source. Your agent account, hosting, and connected services can carry separate costs. This alpha has no published installer or release, and source access is currently limited."
  }
] as const;

export const agentPrompt = `Help me assess the Trellis v0.7 alpha in an isolated local workspace.
Read https://github.com/sageadvicellc/trellis on the feature/trellis-v1 branch.
If repository access is unavailable, stop and explain the access requirement.
Read README.md, docs/recipes/labs-to-blog.md, and docs/alpha/acceptance-status.md.
Explain the prerequisites and known limits before installing or running anything.

Start with the Labs-to-blog recipe and a completed experiment record.
Explain how the evidence must be committed to the chosen GitHub repository.
Help me prepare an evidence-linked blog draft in my voice.
Keep credentials and private installation details outside portable definitions.
Do not read or print credential files in this initial assessment.
Show me the exact proposed change and destination before any external write.
Ask me before connecting accounts or changing GitHub content.
Explain how the designated local operator records exact approval.
Keep publication and merging under my control.
Do not publish, merge, or spend money.

Report the draft, evidence links, and capabilities that remain unproved.
If setup is incomplete, explain what is missing and stop before execution.`;
export const checkoutCommands = `git clone --branch feature/trellis-v1 https://github.com/sageadvicellc/trellis.git
cd trellis
npm ci --ignore-scripts
npm run build
node dist/apps/cli/src/main.js --help`;
