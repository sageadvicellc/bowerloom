import { useState } from 'react';
import { Propernoun } from './ProductText';
import './labs.css';
import { labsRoles as roles, roleYaml } from './labs-roles';

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
      <p>The first Sagespec team brought together a Knowledge officer, Brand review, and a Tech lead. Their work on Bowerloom connects source knowledge, brand direction, and technical delivery. Explore their responsibilities below.</p>
    </div>
    <div className="labs-graph" role="group" aria-label="Explore the Labs agent graph">
      {roles.map((item, index) => <button type="button" key={item.id} aria-pressed={index === selected} aria-controls="labs-role" onClick={() => setSelected(index)}><span className="graph-node" aria-hidden="true" /><Propernoun>{item.name}</Propernoun><span className="graph-job">{item.summary}</span></button>)}
    </div>
    <div className="labs-workspace">
      <div className="labs-files" aria-label="Illustrative Labs file structure">
        <div className="finder-title"><FileIcon folder /><span>Sagespec Labs</span><span className="finder-view" aria-hidden="true"><i /><i /><i /></span></div>
        <div className="finder-path">Labs / <code>v0.7-workbench</code></div>
        <ul className="file-list">
          <li><details open><summary><FileIcon folder /><span>teams</span></summary><ul>{roles.map((item, index) => <li key={item.id}><button className={selected === index ? 'file-row selected' : 'file-row'} type="button" onClick={() => setSelected(index)} aria-pressed={selected === index} aria-controls="labs-role"><FileIcon /><span>{item.file}</span></button></li>)}</ul></details></li>
        </ul>
        <p className="finder-caption">Select a file to read its YAML. These illustrative excerpts use the team contract’s owner and permission fields. A full team also defines assets, tasks, and scope.</p>
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
      <div><h3>The project becomes the next example.</h3><p>The first Sagespec team used Bowerloom and its landing page as a shared project. The internal <code>v0.7-workbench</code> label marks that Labs experiment. Product review informs the page; feedback on the page returns to the team.</p></div>
      <ol aria-label="The Labs feedback loop">
        <li><details><summary>Shared brief</summary><p>Knowledge officer turns source material into usable context and specifications. Brand review sets the creative direction and delegates design. The Tech lead researches the request, defines scope, and assigns specialists.</p></details></li>
        <li><details><summary>Framework + landing page</summary><p>The team develops the framework and explains its capabilities here. Tests and peer review distinguish working behavior from proposed features.</p></details></li>
        <li><details><summary>Founder review</summary><p>The founder tries the result and returns feedback. Reviewed feature changes stay separate from the founder’s decision to merge into <code>main</code> or publish a release.</p></details></li>
        <li><details><summary>Next scoped change</summary><p>Feedback becomes a specific next task with an owner and acceptance criteria. The team records the result and brings it back for review.</p></details></li>
      </ol>
    </div>
    <p className="labs-boundary"><code>workbench</code> versions belong to Labs, not the end-user release sequence. The diagram and YAML illustrate those responsibilities. They do not claim that the runtime independently executed this Sagespec team.</p>
    <a className="hero-secondary" href="#build">Plan your own team</a>
  </section>;
}
