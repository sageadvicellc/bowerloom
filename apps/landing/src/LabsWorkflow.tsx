import { useState } from 'react';
import { Propernoun } from './ProductText';
import './labs.css';

const roles = [
  { id: 'knowledge-officer', name: 'Knowledge officer', file: 'knowledge-officer.yaml', job: 'Keeps the wiki and the source record readable.', skill: 'source-review', reads: 'sources', writes: 'wiki', modelClass: 'standard' },
  { id: 'brand-review', name: 'Brand review', file: 'brand-review.yaml', job: 'Reviews language and visuals against the brand guidelines.', skill: 'brand-guidelines', reads: 'drafts', writes: 'reviews/brand', modelClass: 'economy' },
  { id: 'tech-lead', name: 'Tech lead', file: 'tech-lead.yaml', job: 'Coordinates scoped work, peer review, and founder decisions.', skill: 'technical-review', reads: 'project', writes: 'plans', modelClass: 'standard' },
  { id: 'project-team', name: '{Project} team', file: 'project-team.yaml', job: 'Scales the makers and reviewers within an agreed worker limit.', skill: 'project-delivery', reads: 'briefs', writes: 'output', modelClass: 'standard' },
] as const;

function roleYaml(role: typeof roles[number]) {
  return `${role.id === 'project-team' ? 'id: v0.7-workbench\nbudget:\n  maxActiveWorkers: 2\n  reservePercent: 25\n  paidFallback: false\n\n' : ''}owners:
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

function YamlPreview({ source }: { source: string }) {
  return <pre className="labs-yaml" tabIndex={0} aria-label="YAML configuration excerpt"><code>{source.split('\n').map((line, index) => {
    const parts = line.match(/^(\s*(?:- )?)([a-zA-Z]+):(.*)$/);
    return <span className="yaml-line" key={index}>{parts ? <>{parts[1]}<span className="yaml-key">{parts[2]}</span>:<span className="yaml-value">{parts[3]}</span></> : line}{'\n'}</span>;
  })}</code></pre>;
}

function FileIcon({ folder = false }: { folder?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">{folder ? <path d="M3 6h6l2 2h10v12H3V6Zm0 4h18" /> : <><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h4M9 12h6M9 16h5" /></>}</svg>;
}

export default function LabsWorkflow() {
  const [selected, setSelected] = useState(2);
  const role = roles[selected];
  return <section id="recipe" className="recipe-section labs-section" aria-labelledby="recipe-title">
    <div className="labs-intro">
      <h2 id="recipe-title">The Labs workflow</h2>
      <p>Our first assignment was Bowerloom itself. A connected team worked on <code>v0.7-alpha</code> and the page you are reading, with knowledge, brand, and technical review around the project.</p>
    </div>
    <div className="labs-graph" role="group" aria-label="Explore the Labs agent graph">
      {roles.map((item, index) => <button type="button" key={item.id} aria-pressed={index === selected} aria-controls="labs-role" onClick={() => setSelected(index)}><span className="graph-node" aria-hidden="true" /><Propernoun>{item.name}</Propernoun><span className="graph-job">{['Knowledge & sources', 'Voice & claims', 'Scope & decisions', 'Makers & reviewers'][index]}</span></button>)}
    </div>
    <div className="labs-workspace">
      <div className="labs-files" aria-label="Illustrative Labs file structure">
        <div className="finder-title"><FileIcon folder /><span>Bowerloom Labs</span><span className="finder-view" aria-hidden="true"><i /><i /><i /></span></div>
        <div className="finder-path">Labs / <code>v0.7-workbench</code></div>
        <ul className="file-list">
          <li><details open><summary><FileIcon folder /><span>teams</span></summary><ul>{roles.map((item, index) => <li key={item.id}><button className={selected === index ? 'file-row selected' : 'file-row'} type="button" onClick={() => setSelected(index)} aria-pressed={selected === index} aria-controls="labs-role"><FileIcon /><span>{item.file}</span></button></li>)}</ul></details></li>
        </ul>
        <p className="finder-caption">Select a file to read its YAML. These excerpts use the alpha’s owner and budget fields. A full team also defines assets, tasks, and scope.</p>
      </div>
      <div className="labs-role" id="labs-role" aria-live="polite" aria-atomic="true">
        <span className="role-file"><FileIcon /><code>{role.file}</code></span>
        <h3><Propernoun>{role.name}</Propernoun></h3>
        <p className="role-job">{role.job}</p>
        <YamlPreview source={roleYaml(role)} />
        <p className="yaml-caption">Configuration excerpt. Prompt and skill names refer to shared assets in the full team definition.</p>
      </div>
    </div>
    <div className="labs-loop">
      <div><h3>The project becomes the next example.</h3><p>We called the first project team <code>v0.7-workbench</code>. Its assignment: build <code>v0.7-alpha</code> and this landing page. Review of the product informs the page; feedback on the page returns to the team.</p></div>
      <ol aria-label="The Labs feedback loop"><li>Project team</li><li>Alpha + landing page</li><li>Founder review</li><li>Next scoped change</li></ol>
    </div>
    <p className="labs-boundary"><code>workbench</code> versions belong to Labs, not the end-user release sequence. This is the development team’s workflow, not a claim that the alpha runtime independently executed the whole graph.</p>
    <a className="hero-secondary" href="#build">Plan your own team</a>
  </section>;
}
