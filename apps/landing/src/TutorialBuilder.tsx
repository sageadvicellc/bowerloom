import { release, setupRequirements } from './release';
import { useRef, useState } from 'react';
import { buildTutorialPrompt, profiles, initialSelection, reviewModes } from './tutorial';
import './tutorial.css';
import BetaGuide from './BetaGuide';
import ProductText from './ProductText';

export default function TutorialBuilder() {
  const [selection, setSelection] = useState(initialSelection);
  const [prompt, setPrompt] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [error, setError] = useState('');
  const output = useRef<HTMLTextAreaElement>(null);
  const profile = profiles.find(item => item.id === selection.profileId)!;
  const reviewMode = reviewModes.find(item => item.id === selection.reviewModeId)!;
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
  return <section className="tutorial-builder" id="build" aria-labelledby="tutorial-heading">
    <div className="tutorial-intro">
      <h2 id="tutorial-heading">Set up a team around your goal.</h2>
      <p>Choose a starting profile and describe your goal. Your existing personal agent will help you review a portable team setup before installing it.</p>
    </div>
    <p className="tutorial-hint">{release.npm.availabilityNote} You can prepare your brief now.</p>
    <BetaGuide />
    <form onSubmit={event => {
      event.preventDefault();
      try { setPrompt(buildTutorialPrompt(selection)); setError(''); setCopyStatus('Your setup prompt is ready below.'); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Describe your goal before continuing.'); }
    }}>
      <div className="tutorial-layout">
        <div className="tutorial-fields">
          <fieldset className="tutorial-choice-group">
            <legend>Choose your starting profile</legend>
            <div className="tutorial-projects">{profiles.map(item => <label key={item.id} className={`tutorial-option ${selection.profileId === item.id ? 'is-selected' : ''}`}>
              <input type="radio" name="tutorial-profile" value={item.id} checked={selection.profileId === item.id} onChange={() => change({ ...selection, profileId: item.id, goal: item.goal })} />
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
            </label>)}</div>
          </fieldset>
          <label className="tutorial-goal-label" htmlFor="tutorial-goal">Make the goal yours</label>
          <p className="tutorial-hint" id="goal-help">Describe the result you want to review. Keep private details out of this first brief. Choosing another profile replaces the example goal.</p>
          <textarea id="tutorial-goal" value={selection.goal} onChange={event => change({ ...selection, goal: event.target.value })} rows={5} maxLength={1200} required aria-describedby={`goal-help${error ? ' tutorial-error' : ''}`} aria-invalid={!!error} />
          <fieldset className="tutorial-choice-group tutorial-review-style">
            <legend>Plan your future review cadence</legend>
            {reviewModes.map(item => <label key={item.id} className={`tutorial-option ${selection.reviewModeId === item.id ? 'is-selected' : ''}`}>
              <input type="radio" name="tutorial-review" value={item.id} checked={selection.reviewModeId === item.id} onChange={() => change({ ...selection, reviewModeId: item.id })} />
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
            </label>)}
          </fieldset>
          <label className="tutorial-option"><input type="checkbox" checked={selection.includeDemo} onChange={event => change({ ...selection, includeDemo: event.target.checked })} /><span><strong>Include a demo idea</strong><small>{profile.demo} No tasks run during setup.</small></span></label>
        </div>
        <aside className="tutorial-preview" aria-label="Your project preview">
          <div className="tutorial-preview-sheet">
            <p className="tutorial-preview-label">Your setup brief</p>
            <h3>{profile.label}</h3>
            <p className="tutorial-preview-goal">{selection.goal.trim() || 'Describe the goal your team blueprint will support.'}</p>
            <div className="tutorial-team">{profile.roles.map((role, index) => <span key={role}>{role}<small>{['Defines the scope', 'Proposes the draft', 'Reviews the evidence'][index]}</small></span>)}</div>
            <ol className="tutorial-milestones"><li><strong>Review the setup</strong><span>Roles, access, limits, and the exact file plan.</span></li><li><strong>Approve installation</strong><span>Create only the reviewed .bowerloom files.</span></li><li><strong>Meet your blueprint</strong><span>Inspect it with your existing personal agent.</span></li></ol>
            <p className="tutorial-preview-cadence">{reviewMode.label}</p>
          </div>
        </aside>
      </div>
      <div className="tutorial-action">
        <button className="tutorial-primary" type="submit">Get my setup prompt</button>
        <p className="tutorial-hint">Take it to your existing agent. It prepares your startup files and asks you to approve the exact plan before installation.</p>
      </div>
      {error && <p id="tutorial-error" role="alert">{error}</p>}
    </form>
    <p className="tutorial-copy-status" role="status">{copyStatus}</p>
    {prompt && <div className="tutorial-result">
      <h3>Your agent takes it from here.</h3>
      <p>Paste this short brief into your agent. It will prepare a readable plan for a new workspace or an existing project, then wait for your approval.</p>
      <label htmlFor="tutorial-prompt">Your setup prompt</label>
      <textarea id="tutorial-prompt" ref={output} value={prompt} readOnly spellCheck={false} rows={10} />
      <button className="tutorial-primary" type="button" onClick={copyPrompt}>Copy my prompt</button>
      <details className="tutorial-setup"><summary>What runs, and where?</summary><p>This page builds the prompt locally. Your personal agent uses its existing account to prepare a startup plan. The CLI installs a portable assistant profile and team blueprint after your approval. That reviewable setup is the finish line for this exercise.</p><p>Nothing runs automatically. Your new blueprint can guide later work after you agree on an execution path and its permissions.</p><p><ProductText>{`Requirements: ${setupRequirements} ${release.npm.availabilityNote} The Beta Guide above explains setup and backend boundaries.`}</ProductText></p></details>
    </div>}
  </section>;
}
