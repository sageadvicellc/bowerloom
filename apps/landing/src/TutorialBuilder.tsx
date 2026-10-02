import { useRef, useState, type CSSProperties } from 'react';
import { buildTutorialPrompt, projects, initialSelection, palettes, reviewModes } from './tutorial';
import './tutorial.css';
import AlphaGuide from './AlphaGuide';
import ProductText from './ProductText';

export default function TutorialBuilder() {
  const [selection, setSelection] = useState(initialSelection);
  const [prompt, setPrompt] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [error, setError] = useState('');
  const output = useRef<HTMLTextAreaElement>(null);
  const palette = palettes.find(item => item.id === selection.paletteId)!;
  const project = projects.find(item => item.id === selection.projectId)!;
  const reviewMode = reviewModes.find(item => item.id === selection.reviewModeId)!;
  const theme = { '--tutorial-bg': palette.colors[0], '--tutorial-accent': palette.colors[1], '--tutorial-soft': palette.colors[2], '--tutorial-ink': palette.ink, '--tutorial-surface': palette.surface } as CSSProperties;
  function change(next: typeof selection) { setSelection(next); setPrompt(''); setCopyStatus(''); setError(''); }
  async function copyPrompt() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(prompt);
      setCopyStatus('Prompt copied. Paste it into your personal agent.');
    } catch {
      output.current?.focus(); output.current?.select();
      setCopyStatus('Automatic copy is unavailable. The prompt is selected. Use your device’s Copy command.');
    }
  }
  return <section className="tutorial-builder" id="build" data-theme={palette.id} style={theme} aria-labelledby="tutorial-heading">
    <div className="tutorial-intro">
      <h2 id="tutorial-heading">What will your first team take on?</h2>
      <p>Give your agent a goal worth sharing. It will help you define the roles, agree on the boundaries, and plan the moments when you check in.</p>
    </div>
    <AlphaGuide />
    <form onSubmit={event => {
      event.preventDefault();
      try { setPrompt(buildTutorialPrompt(selection)); setError(''); setCopyStatus('Your tutorial-maker prompt is ready below.'); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Describe your goal before continuing.'); }
    }}>
      <div className="tutorial-layout">
        <div className="tutorial-fields">
          <fieldset className="tutorial-choice-group">
            <legend>Start with a useful project</legend>
            <div className="tutorial-projects">{projects.map(item => <label key={item.id} className={`tutorial-option ${selection.projectId === item.id ? 'is-selected' : ''}`}>
              <input type="radio" name="tutorial-project" value={item.id} checked={selection.projectId === item.id} onChange={() => change({ ...selection, projectId: item.id, goal: item.goal })} />
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
            </label>)}</div>
          </fieldset>
          <label className="tutorial-goal-label" htmlFor="tutorial-goal">Make the goal yours</label>
          <p className="tutorial-hint" id="goal-help">Describe the result you want to review. Keep private details out of this first brief. Choosing another example replaces this text.</p>
          <textarea id="tutorial-goal" value={selection.goal} onChange={event => change({ ...selection, goal: event.target.value })} rows={5} maxLength={1200} required aria-describedby={`goal-help${error ? ' tutorial-error' : ''}`} aria-invalid={!!error} />
          <fieldset className="tutorial-choice-group tutorial-review-style">
            <legend>How closely do you want to check in?</legend>
            {reviewModes.map(item => <label key={item.id} className={`tutorial-option ${selection.reviewModeId === item.id ? 'is-selected' : ''}`}>
              <input type="radio" name="tutorial-review" value={item.id} checked={selection.reviewModeId === item.id} onChange={() => change({ ...selection, reviewModeId: item.id })} />
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
            </label>)}
          </fieldset>
        </div>
        <aside className="tutorial-preview" aria-label="Your project preview">
          <fieldset className="tutorial-choice-group">
            <legend>Choose the look</legend>
            <div className="tutorial-palettes">{palettes.map(item => <label key={item.id} className={`tutorial-palette ${selection.paletteId === item.id ? 'is-selected' : ''}`}>
              <input type="radio" name="tutorial-palette" value={item.id} checked={selection.paletteId === item.id} onChange={() => change({ ...selection, paletteId: item.id })} />
              <span className="tutorial-swatches" aria-hidden="true">{item.colors.map(color => <i key={color} style={{ backgroundColor: color }} />)}</span>
              <span>{item.label}</span>
            </label>)}</div>
          </fieldset>
          <div className="tutorial-preview-sheet">
            <p className="tutorial-preview-label">Your team brief</p>
            <h3>{project.label}</h3>
            <p className="tutorial-preview-goal">{selection.goal.trim() || 'Describe the goal your team will work toward.'}</p>
            <div className="tutorial-team"><span>Personal agent <small>Project lead</small></span><span>Maker <small>Owns the draft</small></span><span>Reviewer <small>Tests the result</small></span></div>
            <ol className="tutorial-milestones"><li><strong>Agree on the work</strong><span>Roles, permissions, and a definition of done.</span></li><li><strong>Review a first draft</strong><span>See the artifact and the evidence so far.</span></li><li><strong>Bring it home</strong><span>Resolve findings and hand over the result.</span></li></ol>
            <p className="tutorial-preview-cadence">{reviewMode.label} · {palette.label}</p>
          </div>
        </aside>
      </div>
      <div className="tutorial-action">
        <button className="tutorial-primary" type="submit">Get my tutorial-maker prompt</button>
        <p className="tutorial-hint">Take it to your existing agent. It confirms the available tools and asks you to approve the working agreement before work starts.</p>
      </div>
      {error && <p id="tutorial-error" role="alert">{error}</p>}
    </form>
    <p className="tutorial-copy-status" role="status">{copyStatus}</p>
    {prompt && <div className="tutorial-result">
      <h3>Your agent takes it from here.</h3>
      <p>The prompt includes your goal, team roles, milestones, theme, and approval rules. Paste it into your agent to begin with a working agreement.</p>
      <label htmlFor="tutorial-prompt">Your tutorial-maker prompt</label>
      <textarea id="tutorial-prompt" ref={output} value={prompt} readOnly spellCheck={false} rows={10} />
      <button className="tutorial-primary" type="button" onClick={copyPrompt}>Copy my prompt</button>
      <details className="tutorial-setup"><summary>What runs, and where?</summary><p>This page builds the prompt locally. Your personal agent uses its existing account to tailor the tutorial. It checks whether this alpha supports your project or whether native subagents need a separately agreed path.</p><p>General team execution is not established by this alpha. The prompt requires actual tool evidence and reports a blocker when a supported path is unavailable. A proposed team is not a running team.</p><p><ProductText>Optional checkout setup requires git, node 24.11 within version 24, and npm 11. The Alpha Guide above explains setup and backend dependencies.</ProductText></p></details>
    </div>}
  </section>;
}
