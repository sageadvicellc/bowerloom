import type { ReactNode } from 'react';
import { app, arrivalNote, commandLine, engines, howItWorks, install, installView, questions, whatItDoes } from './content';
import { releasesUrl } from './release';
import ProductText from './ProductText';
import ScreenshotSlot from './ScreenshotSlot';

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>;
}

export function WhatItDoes() {
  return <section id="what-it-does" className="product-section" aria-labelledby="what-it-does-title">
    <div><h2 id="what-it-does-title">{whatItDoes.heading}</h2></div>
    <div className="section-body">
      <p><ProductText>{whatItDoes.intro}</ProductText></p>
      <ul className="feature-list">
        {whatItDoes.features.map(item => <li key={item.title}><h3>{item.title}</h3><p><ProductText>{item.body}</ProductText></p></li>)}
      </ul>
      <ScreenshotSlot slot="fidelity-preview" />
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
          <ScreenshotSlot slot="builder-graph" />
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
  const view = installView();
  return <section id="command-line" className="band" aria-labelledby="command-line-title">
    <div className="band-inner split">
      <div>
        <h2 id="command-line-title">{commandLine.heading}</h2>
        <p className="band-lede"><ProductText>{commandLine.body}</ProductText></p>
        <pre className="command-block" tabIndex={0} aria-label="Bowerloom commands"><code>{commandLine.commands.join('\n')}</code></pre>
        <p>{commandLine.note}</p>
        {view.command === null && <p className="availability-note">{arrivalNote}</p>}
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
      <ul className="engine-list" aria-label="Engines">
        {engines.supported.map(name => <li key={name} data-support="supported"><span className="engine-name">{name}</span><span className="engine-status">Supported</span></li>)}
        {engines.preview.map(name => <li key={name} data-support="preview"><span className="engine-name">{name}</span><span className="engine-status">Preview</span></li>)}
      </ul>
    </div>
  </section>;
}

export function InstallSection() {
  const view = installView();
  return <section id="install" className="band" aria-labelledby="install-title">
    <div className="band-inner">
      <h2 id="install-title">{install.heading}</h2>
      <div className="install-grid">
        <div id="install-cli" className="install-card">
          <h3>{install.commandLineTitle}</h3>
          {view.command && <pre className="command-block" tabIndex={0} aria-label="Install command"><code>{view.command}</code></pre>}
          <p><ProductText>{view.text}</ProductText></p>
        </div>
        <div id="install-app" className="install-card">
          <h3>{install.appTitle}</h3>
          <p>{install.appIntro}</p>
          <ol className="install-steps">
            {install.appSteps.map(step => <li key={step}><ProductText>{step}</ProductText></li>)}
          </ol>
          <p>{install.appUpdate}</p>
          <a className="button primary" href={releasesUrl} target="_blank" rel="noopener noreferrer">Get the app (beta)<span className="sr-only"> (opens in a new tab)</span></a>
        </div>
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
