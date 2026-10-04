export const repository = "https://github.com/sageadvicellc/bowerloom";
const branch = `${repository}/blob/feature/trellis-v1`;
export const destinations = {
  readme: `${branch}/README.md`,
  license: `${branch}/package.json`,
};
export const hero = {
  "Eyebrow": "Portable tools and teams",
  "H1": "Grow your capabilities with Bowerloom",
  "Body": "Bowerloom is an open-source framework for building agent teams in files you can read. Start with your personal agent and a small local task you can review.",
  "Primary CTA": "Build with your agent",
  "Secondary link": "Explore the Labs workflow",
  "Illustration caption": "A maker and a robot helper at the workshop."
} as const;

export const stages = [
  { name: "Knowledge", tag: "Shared context", title: "Give the work a memory.", description: "The Knowledge officer keeps sources, decisions, and documentation connected to the project.", artifact: "Source-linked project knowledge", color: "#C9F53A" },
  { name: "Brand", tag: "Voice and claims", title: "Keep the voice clear.", description: "Brand review checks the words and visuals against the guidelines and the available evidence.", artifact: "Brand review findings", color: "#83DDD0" },
  { name: "Lead", tag: "Scope and decisions", title: "Agree on the work.", description: "The Tech lead coordinates roles, permissions, milestones, and peer review around one goal.", artifact: "Working agreement and reviewed changes", color: "#F2BE75" },
  { name: "Team", tag: "Makers and reviewers", title: "Build, review, and return.", description: "The project team produces artifacts and evidence within the agreed worker limit. The founder reviews the result.", artifact: "Project artifacts and review evidence", color: "#C9F53A" }
] as const;

export const questions = [
  {
    question: "What should I try first?",
    answer: "Describe a useful goal in the tutorial maker. Your personal agent helps define a team, a working agreement, and review milestones. It confirms the available execution path before you approve work. The page itself prepares a prompt; it does not start a team."
  },
  {
    question: "Do I need to connect GitHub for the tutorial?",
    answer: "No. The default tutorial creates local project artifacts in your chosen workspace. The Labs-to-blog workflow is a separate, recorded integration proof that uses PostgreSQL and a repository-scoped GitHub App. Its setup and exact approval requirements apply when you choose that workflow."
  },
  {
    question: "What does the Labs workflow show?",
    answer: "The Labs workflow describes the development team behind this alpha and landing page: Knowledge officer, Brand review, Tech lead, and a scalable project team. It explains how their work connects. It is not proof that Bowerloom independently ran the whole team. The Alpha Guide separates that story from recorded runtime tests."
  },
  {
    question: "Who approves external changes?",
    answer: "In the tested GitHub workflow, the designated local operator records exact approval through the command-line interface. MCP does not expose approval. The alpha trusts local operator authority; it does not independently establish that a human issued it. The local tutorial grants no authority to publish, merge, or change connected applications."
  },
  {
    question: "What stays in my files?",
    answer: "Portable team definitions describe roles, skills, and permissions. Keep credentials and private installation details outside them. The tutorial artifacts stay local. In the separate GitHub workflow, saved progress lives in PostgreSQL and the draft result lives in GitHub."
  },
  {
    question: "How do the modules fit together?",
    answer: "The Teams module defines roles, skills, and permissions. Relay connects agents. Roots holds knowledge with controlled access. Vines records logs. Workbench holds repeatable experiments and tests. Readiness differs across these tools. The Alpha Guide records the current limits and upstream dependencies."
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
