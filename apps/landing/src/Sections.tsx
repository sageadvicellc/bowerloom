import { useEffect, useRef, useState, type ReactNode } from 'react';
import { app, commandLine, engines, howItWorks, install, installView, questions, whatItDoes } from './content';
import { installAvailable, releasesUrl } from './release';
import ProductText from './ProductText';
import ScreenshotSlot from './ScreenshotSlot';
import { copyLabel, createCopyController, type CopyState } from './copy';

/**
 * A command, with each hyphenated word kept whole when the line wraps on a narrow screen.
 * The spans add no characters, so a selection still copies the command exactly as written.
 */
function Command({ text }: { text: string }) {
  return <>{text.split(/(\s+)/).map((part, index) => (part.includes('-') ? <span key={index} className="no-break">{part}</span> : part))}</>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>;
}

export function WhatItDoes() {
  const [engineFeature] = whatItDoes.features;
  return <section id="what-it-does" className="product-section" aria-labelledby="what-it-does-title">
    <div><h2 id="what-it-does-title">{whatItDoes.heading}</h2></div>
    <div className="section-body">
      <p><ProductText>{whatItDoes.intro}</ProductText></p>
      <div className="feature-engine"><h3>{engineFeature.title}</h3><p><ProductText>{engineFeature.body}</ProductText></p></div>
    </div>
  </section>;
}

export function HowItWorks() {
  return <section id="how-it-works" className="recipe-section" aria-labelledby="how-it-works-title">
    <h2 id="how-it-works-title">{howItWorks.heading}</h2>
    <ol className="steps">
      {howItWorks.steps.map((step, index) => <li key={step.title}>
        <span className="step-number" aria-hidden="true">{index + 1}</span>
        <h3>{step.title}</h3><p><ProductText>{step.body}</ProductText></p>
      </li>)}
    </ol>
    <p className="boundary-note">{howItWorks.boundary}</p>
  </section>;
}

export function AppSection() {
  const [builder, savePoints, notesKeeper] = app.features;
  return <section id="app" className="band" aria-labelledby="app-title">
    <div className="band-inner">
      <h2 id="app-title">{app.heading}</h2>
      <p className="band-lede"><ProductText>{app.body}</ProductText></p>
      <div className="app-grid">
        <article>
          <ScreenshotSlot slot="fidelity-preview" />
          <h3>{builder.title}</h3><p><ProductText>{builder.body}</ProductText></p>
        </article>
        <article>
          <ScreenshotSlot slot="save-files" />
          <h3>{savePoints.title}</h3><p><ProductText>{savePoints.body}</ProductText></p>
        </article>
        <article>
          <ScreenshotSlot slot="notes-keeper-tour" />
          <h3>{notesKeeper.title}</h3><p><ProductText>{notesKeeper.body}</ProductText></p>
        </article>
      </div>
    </div>
  </section>;
}

export function CommandLineSection() {
  return <section id="command-line" className="band" aria-labelledby="command-line-title">
    <div className="band-inner split">
      <div>
        <h2 id="command-line-title">{commandLine.heading}</h2>
        <p className="band-lede"><ProductText>{commandLine.body}</ProductText></p>
        <pre className="command-block" tabIndex={0} aria-label="Bowerloom commands"><code><Command text={commandLine.commands.join('\n')} /></code></pre>
        <p>{commandLine.note}</p>
      </div>
      <ScreenshotSlot slot="cli-plan" />
    </div>
  </section>;
}

export function EnginesSection() {
  return <section id="engines" className="band" aria-labelledby="engines-title">
    <div className="band-inner">
      <h2 id="engines-title">{engines.heading}</h2>
      <p className="band-lede"><ProductText>{engines.body}</ProductText></p>
      <p className="engine-nest">{engines.nestLine}</p>
      <ul className="engine-list" aria-label="Engines">
        {engines.supported.map(name => <li key={name} data-support="supported"><span className="engine-name">{name}</span><span className="engine-status">Supported</span></li>)}
        {engines.preview.map(name => <li key={name} data-support="preview"><span className="engine-name">{name}</span><span className="engine-status">Preview</span></li>)}
      </ul>
    </div>
  </section>;
}

/**
 * The install command in a small terminal, with a copy button and one status slot under it. While idle the slot holds the note it is given (the pending-npm note, or nothing).
 * "Copied" or the failure words take the same slot, at the same height, so the page does not move. One timer puts the slot back to idle. A new press clears the old timer,
 * and a copy that finishes after the page left sets no timer (see `createCopyController`).
 */
export function InstallCommand({ command, idleNote = null }: { command: string; idleNote?: string | null }) {
  const [state, setState] = useState<CopyState>('idle');
  const controller = useRef<ReturnType<typeof createCopyController> | null>(null);
  useEffect(() => {
    const run = createCopyController({ text: command, clipboard: () => (typeof navigator === 'undefined' ? null : navigator.clipboard), set: setState });
    controller.current = run;
    return () => { run.dispose(); controller.current = null; };
  }, [command]);
  return <>
    <div className="terminal">
      <div className="terminal-bar" aria-hidden="true"><span /><span /><span /></div>
      <div className="terminal-body">
        <span className="terminal-prompt" aria-hidden="true">$</span>
        <pre className="command-block" tabIndex={0} aria-label="Install command"><code><Command text={command} /></code></pre>
        <button type="button" className="copy-button" data-state={state} onClick={() => { void controller.current?.press(); }}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <span>{state === 'copied' ? 'Copied' : 'Copy'}<span className="sr-only"> the install command</span></span>
        </button>
      </div>
    </div>
    <p className="copy-status" role="status" aria-live="polite" data-note={idleNote ? 'yes' : 'no'}>{state === 'idle' ? idleNote ?? '' : copyLabel(state)}</p>
  </>;
}

/** The app card leads, because the app download is the main path. The command is always shown beside it, with a copy button. */
export function InstallSection({ available = installAvailable }: { available?: boolean }) {
  const view = installView(available);
  const appCard = <div key="app" id="install-app" className="install-card install-card-app">
    <h3>{install.appTitle}</h3>
    <p>{install.appIntro}</p>
    <ol className="install-steps">
      {install.appSteps.map(step => <li key={step}><ProductText>{step}</ProductText></li>)}
    </ol>
    <p>{install.appUpdate}</p>
    <a className="button primary" href={releasesUrl} target="_blank" rel="noopener noreferrer">Get the app (beta)<span className="sr-only"> (opens in a new tab)</span></a>
  </div>;
  const commandCard = <div key="cli" id="install-cli" className="install-card install-card-cli">
    <h3>{install.commandLineTitle}</h3>
    <InstallCommand command={view.command} idleNote={view.pendingNote} />
    <p><ProductText>{view.text}</ProductText></p>
  </div>;
  return <section id="install" className="band" aria-labelledby="install-title">
    <div className="band-inner">
      <h2 id="install-title">{install.heading}</h2>
      <p className="band-lede">{install.intro}</p>
      <div className="install-grid" data-command={view.pending ? 'unpublished' : 'published'}>
        {appCard}{commandCard}
      </div>
    </div>
  </section>;
}

export function FaqSection() {
  return <section id="faq" className="faq-section" aria-labelledby="faq-title">
    <h2 id="faq-title">FAQ</h2>
    <div className="faq-list">
      {questions.map((item, index) => <details key={item.question} open={index === 0 ? true : undefined}><summary>{item.question}</summary><p><ProductText>{item.answer}</ProductText></p></details>)}
    </div>
  </section>;
}
