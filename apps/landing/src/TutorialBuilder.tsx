import { useRef, useState } from 'react';
import { buildTutorialPrompt, experiments, initialSelection, palettes, resolveSelection, setupCommands } from './tutorial';
import './tutorial.css';

export default function TutorialBuilder() {
  const [selection, setSelection] = useState(initialSelection);
  const [prompt, setPrompt] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const output = useRef<HTMLTextAreaElement>(null);
  const { palette, experiment, hypothesis } = resolveSelection(selection);

  function change(next: typeof selection) {
    setSelection(next);
    setPrompt('');
    setCopyStatus('');
  }

  async function copyPrompt() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(prompt);
      setCopyStatus('Prompt copied. Paste it into your personal agent.');
    } catch {
      output.current?.focus();
      output.current?.select();
      setCopyStatus('Automatic copy is unavailable. The prompt is selected. Use your device’s Copy command.');
    }
  }

  return (
    <section className="tutorial-builder" id="build" aria-labelledby="tutorial-heading">
      <div className="tutorial-intro">
        <h2 id="tutorial-heading">Build your tutorial</h2>
        <p>Choose a question, take a guess, and give your personal agent a seed. Your destination: a thoughtful one-page report, made from a tiny fictional dataset.</p>
        <p className="tutorial-scope">Your agent creates the report. A separate local step validates a Trellis definition. This tutorial does not run a Trellis team.</p>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); setPrompt(buildTutorialPrompt(selection)); setCopyStatus('Your prompt and setup instructions are ready below.'); }}>
        <fieldset className="tutorial-choice-group">
          <legend>Give it a palette</legend>
          <div className="tutorial-palettes">
            {palettes.map((item) => (
              <label key={item.id} className={`tutorial-option ${selection.paletteId === item.id ? 'is-selected' : ''}`}>
                <input type="radio" name="tutorial-palette" value={item.id} checked={selection.paletteId === item.id} onChange={() => change({ ...selection, paletteId: item.id })} />
                <span><span className="tutorial-swatches" aria-hidden="true">{item.colors.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span><strong>{item.label}</strong><small>{item.description}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="tutorial-choice-group">
          <legend>Pick a question</legend>
          <div className="tutorial-questions">
            {experiments.map((item) => (
              <label key={item.id} className={`tutorial-option ${selection.experimentId === item.id ? 'is-selected' : ''}`}>
                <input type="radio" name="tutorial-question" value={item.id} checked={selection.experimentId === item.id} onChange={() => change({ ...selection, experimentId: item.id, hypothesisId: item.hypotheses[0].id })} />
                <span><strong>{item.label}</strong><small>{item.question}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="tutorial-choice-group">
          <legend>Make a prediction</legend>
          <p className="tutorial-hint">A hypothesis is a claim to test. It does not have to be right.</p>
          <div className="tutorial-hypotheses">
            {experiment.hypotheses.map((item) => (
              <label key={item.id} className={`tutorial-option ${selection.hypothesisId === item.id ? 'is-selected' : ''}`}>
                <input type="radio" name="tutorial-hypothesis" value={item.id} checked={selection.hypothesisId === item.id} onChange={() => change({ ...selection, hypothesisId: item.id })} />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="tutorial-seed-summary" aria-label="Your selected tutorial">
          <span className="tutorial-kicker">Your seed</span>
          <p>Make a <strong>{palette.label.toLowerCase()}</strong> report that asks: <strong>{experiment.question}</strong> My prediction: <strong>{hypothesis.label}</strong></p>
        </div>
        <button className="tutorial-primary" type="submit">Create my prompt</button>
        <p className="tutorial-hint">Nothing runs here. You review the prompt before you give it to your agent.</p>
      </form>

      <p className="tutorial-copy-status" role="status">{copyStatus}</p>
      {prompt && (
        <div className="tutorial-result">
          <h3>Your tutorial is ready to take with you</h3>
          <p>Paste this prompt into your existing personal agent. It includes the data, report design, setup instructions, and limits.</p>
          <label htmlFor="tutorial-prompt">Your personal-agent prompt</label>
          <textarea id="tutorial-prompt" ref={output} value={prompt} readOnly spellCheck={false} rows={12} />
          <button className="tutorial-primary" type="button" onClick={copyPrompt}>Copy my prompt</button>
          <div className="tutorial-setup">
            <h3>The current alpha setup</h3>
            <p>You need access to the private repository, Git, Node 24.11 or later within Node 24, and npm 11. There is no published npm package for this alpha.</p>
            <p>For a new checkout, use a folder without an existing <code>trellis</code> directory. Then run:</p>
            <pre><code>{setupCommands}</code></pre>
            <p>If you already have a checkout, ask your agent to inspect its branch and local changes first. Do not overwrite it.</p>
            <p>The example returns <code>runtimeReady: false</code>. That is expected: validation reads a definition and does not start workers.</p>
            <p>The report becomes <code>tutorial-output/report.html</code>, with calculations and limits in <code>tutorial-output/evidence.md</code>. Both stay local for your review.</p>
          </div>
        </div>
      )}
    </section>
  );
}
