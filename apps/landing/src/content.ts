export const repository = "https://github.com/sageadvicellc/bowerloom";
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
  "H1": "Grow your abilities with Bowerloom",
  "Body": "Bowerloom is an open-source framework for building agent teams in files you can read. Start with your personal agent and a small local task you can review.",
  "Primary CTA": "Build with your agent",
  "Secondary link": "See what our first seed grew",
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
    "description": "Use evidence files from a fixed Git revision. Bowerloom checks the supplied bytes and declared links. You still judge whether the draft accurately describes the evidence.",
    "artifact": "Evidence files and source links",
    "color": "#83DDD0"
  },
  {
    "name": "Draft",
    "tag": "The table",
    "title": "Write in your voice.",
    "description": "Your personal agent prepares an evidence-linked blog draft. Bowerloom saves the draft, destination, and proposed change in a plan for review.",
    "artifact": "Blog draft and proposed change",
    "color": "#F2BE75"
  },
  {
    "name": "Approval",
    "tag": "The gate",
    "title": "Approve the exact change.",
    "description": "The designated local operator approves the saved plan. Bowerloom then creates the draft pull request. Publication and merging remain separate decisions.",
    "artifact": "GitHub draft pull request",
    "color": "#C9F53A"
  }
] as const;

export const questions = [
  {
    question: "What should I try first?",
    answer: "Describe a useful goal in the tutorial maker. Your personal agent helps define a team, a working agreement, and review milestones. It confirms the available execution path before you approve work. The page itself prepares a prompt; it does not start a team."
  },
  {
    question: "Do I need to connect GitHub for the tutorial?",
    answer: "No. The default tutorial creates local project artifacts in your chosen workspace. The Labs-to-blog seed is a separate, recorded integration proof that uses PostgreSQL and a repository-scoped GitHub App. Its setup and exact approval requirements apply when you choose that seed."
  },
  {
    question: "What is a seed?",
    answer: "A seed is a small starting example you can adapt with your personal agent. The tutorial maker helps your agent shape that starting point around your goal. The existing Labs-to-blog seed shows a bounded path from committed experiment evidence to a GitHub draft, with a saved plan and approval before the external write."
  },
  {
    question: "Who approves external changes?",
    answer: "In the tested GitHub seed, the designated local operator records exact approval through the command-line interface. MCP does not expose approval. The alpha trusts local operator authority; it does not independently establish that a human issued it. The local tutorial grants no authority to publish, merge, or change connected applications."
  },
  {
    question: "What stays in my files?",
    answer: "Portable team definitions describe roles, skills, and permissions. Keep credentials and private installation details outside them. The tutorial artifacts stay local. In the separate GitHub seed, saved progress lives in PostgreSQL and the draft result lives in GitHub."
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
    answer: "Bowerloom is intended to remain free and open source. Your agent account, hosting, and connected services can have separate costs. This alpha has no published installer or public release, and the source is available on GitHub. The tutorial lists the setup requirements and tells your agent not to spend money."
  }
] as const;
