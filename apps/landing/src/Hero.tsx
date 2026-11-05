import { engines, hero } from './content';
import { releasesUrl } from './release';
import HomepageBanner from './HomepageBanner';
import ScreenshotSlot from './ScreenshotSlot';

/** The command line is shown in the install section at all times, so the link always goes there. */
export const commandLineTarget = '#install-cli';

export default function Hero() {
  return <section className="hero normal-hero" aria-labelledby="hero-title">
    <HomepageBanner />
    <div className="hero-copy">
      <p className="release-tag">
        <svg className="release-tag-sparkle" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10z" fill="currentColor" /></svg>
        {hero.Eyebrow}
      </p>
      <h1 id="hero-title">{hero.H1}</h1>
      <p className="hero-description">{hero.Body}</p>
      <a className="button primary" href={releasesUrl} target="_blank" rel="noopener noreferrer">{hero["Primary CTA"]}<span className="sr-only"> (opens in a new tab)</span></a>
      <a className="hero-secondary" href={commandLineTarget}>{hero["Secondary link"]}</a>
      <p className="hero-note">{hero.Note}</p>
      <div className="hero-chips">
        <ul className="hero-engines" aria-label="Supported engines">
          {engines.supported.map(name => <li key={name}>{name}</li>)}
        </ul>
        <div className="hero-results-group">
          <span className="hero-results-lead">{hero["Results lead"]}</span>
          <ul className="hero-results" aria-label="Results the preview gives each part">
            {hero.Results.map(name => <li key={name} data-result={name.toLowerCase()}>{name}</li>)}
          </ul>
        </div>
      </div>
    </div>
    <div className="hero-showcase">
      <ScreenshotSlot slot="builder-graph" priority />
    </div>
  </section>;
}
