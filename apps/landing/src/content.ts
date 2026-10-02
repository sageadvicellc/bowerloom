export const repository = "https://github.com/sageadvicellc/trellis";
const branch = `${repository}/blob/feature/trellis-v1`;
export const docs = `${branch}/docs/recipes/labs-to-blog.md`;
export const destinations = {
  trial: `${branch}/docs/recipes/live-acceptance.md`,
  mcp: `${branch}/apps/mcp/README.md`,
  evidence: `${branch}/docs/alpha/acceptance-status.md`,
  releasePlan: `${branch}/docs/transition/release-plan.md`,
  license: `${branch}/package.json`,
};
export const hero = {
  "Eyebrow": "Portable tools and teams",
  "H1": "Grow your sprouts on Trellis",
  "Body": "Trellis is an open-source framework for building agent teams in files you can read and change. Start with your personal agent and a small local task you can review.",
  "Primary CTA": "Build with your agent",
  "Secondary link": "See what our first seed grew",
  "Alpha note": "Local alpha, built first for Codex. The public installer and release are not published.",
  "Illustration caption": "A maker and a robot helper at the workshop."
} as const;

export const stages = [
  {
    "name": "Experiment",
    "tag": "The bench",
    "title": "Bring the completed work.",
    "description": "Select a completed experiment record and its committed evidence. This seed starts with that record. It does not run a new experiment.",
    "artifact": "Completed experiment record",
    "color": "#C9F53A"
  },
  {
    "name": "Evidence",
    "tag": "The archive",
    "title": "Keep the sources attached.",
    "description": "Use evidence files from a fixed Git revision. Trellis checks the supplied bytes and declared links. You still judge whether the draft accurately describes the evidence.",
    "artifact": "Evidence files and source links",
    "color": "#83DDD0"
  },
  {
    "name": "Draft",
    "tag": "The table",
    "title": "Write in your voice.",
    "description": "Your personal agent prepares an evidence-linked blog draft. Trellis saves the draft, destination, and proposed change in a plan for review.",
    "artifact": "Blog draft and proposed change",
    "color": "#F2BE75"
  },
  {
    "name": "Approval",
    "tag": "The gate",
    "title": "Approve the exact change.",
    "description": "The designated local operator approves the saved plan. Trellis then creates the draft pull request. Publication and merging remain separate decisions.",
    "artifact": "GitHub draft pull request",
    "color": "#C9F53A"
  }
] as const;

export const questions = [
  {
    question: "What should I try first?",
    answer: "Use the tutorial to give your personal agent a small local task: turn a short project brief into a one-page illustrated HTML report. You choose the question, hypothesis, and palette before the agent writes the report. This is a guided personal-agent exercise, not proof that an autonomous Trellis team has executed."
  },
  {
    question: "Do I need to connect GitHub for the tutorial?",
    answer: "No. The one-page report stays in your chosen local workspace. The Labs-to-blog seed is a separate, recorded integration proof that uses PostgreSQL and a repository-scoped GitHub App. Its setup and exact approval requirements apply when you choose that seed."
  },
  {
    question: "What is a seed?",
    answer: "A seed is a small starting example you can adapt with your personal agent. The local report tutorial introduces the approach. The existing Labs-to-blog seed shows a bounded path from committed experiment evidence to a GitHub draft, with a saved plan and approval before the external write."
  },
  {
    question: "Who approves external changes?",
    answer: "In the tested GitHub seed, the designated local operator records exact approval through the command-line interface. MCP does not expose approval. The alpha trusts local operator authority; it does not independently establish that a human issued it. The local tutorial grants no authority to publish, merge, or change connected applications."
  },
  {
    question: "What stays in my files?",
    answer: "Portable team definitions describe roles, skills, and permissions. Keep credentials and private installation details outside them. The tutorial report stays local. In the separate GitHub seed, saved progress lives in PostgreSQL and the draft result lives in GitHub."
  },
  {
    question: "How do the modules fit together?",
    answer: "Sprouts defines teams and skills. Relay connects agents. Roots holds knowledge with controlled access. Vines records logs. Workbench holds repeatable experiments and tests. Readiness differs across these tools; the alpha evidence records their current limits."
  },
  {
    question: "Can I take my team to another agent app?",
    answer: "Definitions live outside an individual agent app. Codex is the tested alpha path. Cross-harness execution, including Claude Code, and shared company installations are beta plans. Portable files do not yet mean every harness can execute the team."
  },
  {
    question: "What does it cost to try?",
    answer: "Trellis is intended to remain free and open source. Your agent account, hosting, and connected services can have separate costs. This alpha has no published installer or public release, and source access is currently limited. The tutorial lists the setup requirements and tells your agent not to spend money."
  }
] as const;
