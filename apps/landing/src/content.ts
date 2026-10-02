export const repository = "https://github.com/sageadvicellc/trellis";
export const docs = `${repository}/blob/feature/trellis-v1/docs/recipes/README.md`;

export const stages = [
  {
    name: "Experiment",
    tag: "01 / THE BENCH",
    title: "Bring a completed experiment.",
    description:
      "Choose a completed Labs experiment record as the input. This recipe builds on work you have already done; it does not run a new experiment.",
    artifact: "Completed experiment record",
    color: "#C9F53A",
  },
  {
    name: "Evidence",
    tag: "02 / THE ARCHIVE",
    title: "Keep the trail.",
    description:
      "Pin the completed record and its evidence links. Your agent checks which claims the evidence supports and flags the gaps before drafting.",
    artifact: "Findings + source links",
    color: "#83DDD0",
  },
  {
    name: "Draft",
    tag: "03 / THE TABLE",
    title: "Make something reviewable.",
    description:
      "Your personal agent turns the completed experiment into a blog draft with evidence links. Read the draft and its proposed changes before creating a pull request.",
    artifact: "Evidence-linked blog draft",
    color: "#F2BE75",
  },
  {
    name: "Review",
    tag: "04 / THE GATE",
    title: "You decide what ships.",
    description:
      "The operator authorizes creation of a draft GitHub pull request. You or your designated reviewer approve publication separately. The recipe never publishes or merges automatically.",
    artifact: "Authorized draft PR",
    color: "#C9F53A",
  },
] as const;

export const agentPrompt = `Help me try the Trellis v0.7 alpha in a local, isolated workspace.

Read https://github.com/sageadvicellc/trellis and docs/recipes/README.md plus skills/recipes/labs-to-blog on the feature/trellis-v1 branch. Read the installation documentation too. Check the current prerequisites and alpha acceptance status before installing anything.

Start with the Labs-to-blog example recipe: a completed experiment record → pinned evidence → an evidence-linked blog draft → an operator-authorized draft GitHub pull request. Use a synthetic completed record; do not execute a new experiment. Explain the workflow, roles, skills, connection requirements, and resource limits before running it.

Keep credentials and private data outside portable definitions. Ask me before connecting accounts or taking external actions. Let me inspect the blog draft and authorize draft-PR creation. I or my designated reviewer will approve publication separately. Do not publish, merge, or spend money. Report the artifacts, source links, and any unsupported or unverified alpha capability.`;
