import { useState } from 'react';
import { Propernoun } from './ProductText';
import './labs.css';

const roles = [
  { id: 'knowledge', name: 'Knowledge officer', file: 'knowledge-officer.yaml', job: 'The wiki librarian and author.', description: 'Keeps the project’s knowledge organized, traces decisions to their sources, and turns completed work into useful documentation.', output: 'A source-linked wiki and a record of decisions.', files: ['sources/', 'wiki/', 'decisions.md'], connection: 'Shares context with the Tech lead and sources with Brand review.' },
  { id: 'brand', name: 'Brand review', file: 'brand-review.yaml', job: 'A clear voice, even as the work grows.', description: 'Reviews words and visuals against the brand guidelines. Flags unclear language and claims that the evidence does not support.', output: 'Review findings tied to the brand standard.', files: ['voice-standard.md', 'review-rubric.md', 'reviews/'], connection: 'Returns findings to the project team before the founder reviews the work.' },
  { id: 'lead', name: 'Tech lead', file: 'tech-lead.yaml', job: 'A technical lead for this project.', description: 'Turns the goal into scoped work, assigns ownership, coordinates peer review, and brings decisions and completed changes to the founder.', output: 'A working agreement, a plan, and reviewed changes.', files: ['working-agreement.md', 'milestones.md', 'reviews/'], connection: 'Coordinates the project team with Knowledge officer and Brand review.' },
  { id: 'team', name: '{Project} team', file: 'project-team.yaml', job: 'A team that can scale with the assignment.', description: 'Brings together makers and reviewers for the project. The working agreement sets their roles, permissions, and maximum active worker count.', output: 'Project artifacts with test and review evidence.', files: ['brief.md', 'skills/', 'evidence/'], connection: 'Reports progress and blockers to the Tech lead. Scaling stays within the agreed capacity.' },
] as const;

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
          {['README.md', 'AGENTS.md', 'SPEC.md'].map(file => <li className="file-row" key={file}><FileIcon /><span>{file}</span></li>)}
          <li><details open><summary><FileIcon folder /><span>teams</span></summary><ul>{roles.map((item, index) => <li key={item.id}><button className={selected === index ? 'file-row selected' : 'file-row'} type="button" onClick={() => setSelected(index)} aria-pressed={selected === index} aria-controls="labs-role"><FileIcon /><span>{item.file}</span></button></li>)}</ul></details></li>
          <li><details><summary><FileIcon folder /><span>briefs</span></summary><ul><li className="file-row"><FileIcon /><span>alpha-and-landing.md</span></li></ul></details></li>
          <li><details><summary><FileIcon folder /><span>evidence</span></summary><ul>{['test-results/', 'peer-reviews/', 'decisions.md'].map(file => <li className="file-row" key={file}><FileIcon folder={file.endsWith('/')} /><span>{file}</span></li>)}</ul></details></li>
          <li className="file-row file-muted"><FileIcon folder /><span>.bowerloom</span></li>
        </ul>
        <p className="finder-caption">Illustrative layout. These filenames explain the roles; they are not a downloadable team definition.</p>
      </div>
      <div className="labs-role" id="labs-role" aria-live="polite" aria-atomic="true">
        <span className="role-file"><FileIcon /><code>{role.file}</code></span>
        <h3><Propernoun>{role.name}</Propernoun></h3>
        <p className="role-job">{role.job}</p>
        <p>{role.description}</p>
        <dl><dt>Leaves behind</dt><dd>{role.output}</dd><dt>Connects with</dt><dd>{role.connection}</dd></dl>
        <div className="role-files" aria-label="Example artifacts">{role.files.map(file => <span key={file}><FileIcon folder={file.endsWith('/')} /><code>{file}</code></span>)}</div>
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
