import { release } from './release.ts';
export const repository = release.urls.repository;
const branch = `${repository}/blob/main`;
export const destinations = {
  readme: `${branch}/README.md`,
  license: `${branch}/package.json`,
  bugs: `${repository}/issues`,
  questions: `${repository}/discussions/categories/q-a`,
  feedback: `${repository}/discussions/categories/general`,
  ideas: `${repository}/discussions/categories/ideas`,
};
export const hero = {
  "Eyebrow": "Governance for agent workflows",
  "H1": "Bring governance to your agent workflows.",
  "Body": "Turn the work you already do into defined roles, handoffs, and review points. Bowerloom binds setup files to an exact approved plan and records their installed state, while your team definitions stay in files that follow you. Start with an existing project and your personal agent, then review the team specification before approving its installation.",
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
    question: "How do I bring my workflow into Bowerloom?",
    answer: "Describe the process you already perform, including its inputs, outputs, handoffs, and human decisions. Your personal agent helps compare that workflow with a fixed team profile and its specification. Review the proposed files, permissions, and working agreement before approving installation in your existing project. Setup does not import project contents or run the team."
  },
  { question: "What does the beta govern?", answer: "The installer binds a file write to an exact approved plan. Status identifies drift, and revision uses recorded transactions with supported recovery choices. Team definitions declare roles, proposed access, handoffs, and review expectations. Those declarations do not enforce every future tool action or grant runtime permissions." },
  {
    question: "Do I need to connect GitHub for the tutorial?",
    answer: "No. The page prepares a prompt locally. After CLI installation and your exact approval, your agent creates setup files. Setup does not connect GitHub. Connected workflows need separate permissions and exact action approval."
  },
  {
    question: "What does the Labs workflow show?",
    answer: "The Labs workflow describes the development team behind this framework and landing page: Knowledge officer, Brand review, Tech lead, and a scalable project team. It explains how their work connects. It is not proof that Bowerloom independently ran the whole team. The Beta Guide separates that story from recorded runtime tests."
  },
  {
    question: "Who approves external changes?",
    answer: "Each external change needs approval for its exact action and scope. The local tutorial grants no authority to publish, merge, or change connected applications. MCP planning does not expose an approval action."
  },
  {
    question: "What stays in my files?",
    answer: "Portable team definitions describe roles, skills, and permissions. Keep credentials and private installation details outside them. The tutorial artifacts stay local. In the separate GitHub workflow, saved progress lives in PostgreSQL and the draft result lives in GitHub."
  },
  {
    question: "How do the modules fit together?",
    answer: "The Teams module defines roles, skills, and permissions. Relay connects agents. Roots holds knowledge with controlled access. Vines records logs. Workbench holds repeatable experiments and tests. Readiness differs across these tools. The Beta Guide records the current limits and upstream dependencies."
  },
  {
    question: "Can I take my team to another agent app?",
    answer: "Roles, skills, handoffs, and review expectations stay in files that follow you. You can version those definitions with your project and inspect them in another agent application. Credentials and installation receipts stay private. Moving definitions does not transfer permissions or prove that another application can execute them."
  },
  {
    question: "What does it cost to try?",
    answer: "Bowerloom is free and open source. Your agent account, hosting, and connected services can have separate costs. The tutorial does not authorize spending."
  },
  { question: "Where can I get help or share an idea?", answer: "Use GitHub Issues for reproducible bugs. Use Discussions Q&A for questions, General for feedback, and Ideas for feature proposals. The feedback guide explains what to include and how to protect private data." }
] as const;
