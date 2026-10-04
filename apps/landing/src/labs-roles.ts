/** A readable illustration of the first Sagespec team's responsibilities. */
export const labsRoles = [
  { id: 'knowledge-officer', name: 'Knowledge officer', file: 'knowledge-officer.yaml', summary: 'Wiki, sources & specifications', job: 'Maintains the knowledge wiki, ingests raw material, and turns source documents into specifications the team can use. Keeps the source record attached so later decisions can be checked.', skill: 'source-review', reads: 'sources', writes: 'wiki', modelClass: 'standard' },
  { id: 'brand-review', name: 'Brand review', file: 'brand-review.yaml', summary: 'Identity, products & design', job: 'Establishes the brand identity and its expression across products, presentation decks, and ads. Delegates scoped design work and reviews the result against the shared direction.', skill: 'brand-guidelines', reads: 'briefs', writes: 'brand', modelClass: 'standard' },
  { id: 'tech-lead', name: 'Tech lead', file: 'tech-lead.yaml', summary: 'Research, scope & specialists', job: 'Researches founder requests, defines their technical scope, and delegates bounded work to specialists. Brings evidence, tradeoffs, and decisions back to the founder.', skill: 'technical-review', reads: 'requests', writes: 'plans', modelClass: 'standard' },
] as const;

export function roleYaml(role: typeof labsRoles[number]) {
  return `owners:
  - id: ${role.id}
    role: "${role.name}"
    prompt: ${role.id}-prompt
    skills:
      - ${role.skill}
    modelClass: ${role.modelClass}
    permissions:
      - operation: workspace.read
        path: ${role.reads}
      - operation: workspace.write
        path: ${role.writes}`;
}
