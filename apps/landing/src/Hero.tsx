import { hero } from './content';
import { installAvailable, releasesUrl } from './release';
import HomepageBanner from './HomepageBanner';

/** Until npm has the package, the command line link goes to the command line section, where the commands are. */
export const commandLineTarget = (available: boolean) => (available ? '#install-cli' : '#command-line');

export default function Hero({ available = installAvailable }: { available?: boolean }) {
  return <section className="hero normal-hero" aria-labelledby="hero-title">
    <HomepageBanner />
    <div className="hero-copy">
      <p className="eyebrow">{hero.Eyebrow}</p>
      <h1 id="hero-title">{hero.H1}</h1>
      <p className="hero-description">{hero.Body}</p>
      <a className="button primary" href={releasesUrl} target="_blank" rel="noopener noreferrer">{hero["Primary CTA"]}<span className="sr-only"> (opens in a new tab)</span></a>
      <a className="hero-secondary" href={commandLineTarget(available)}>{hero["Secondary link"]}</a>
      <p className="hero-note">{hero.Note}</p>
    </div>
  </section>;
}
