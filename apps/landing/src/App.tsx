import { readerRelease, docsPath, releasesUrl } from './release';
import { useEffect, useState } from "react";
import { destinations, hero, repository } from "./content";
import SiteNavigation from "./SiteNavigation";
import BrandIdentity from "./BrandIdentity";
import ThemeControl from "./ThemeControl";
import ThemeSplash from "./ThemeSplash";
import { rememberThemeSplash, shouldShowThemeSplash, splashMediaFor, type SplashMedia } from "./theme-splash";
import "./hero-parallax.css";
import "./page.css";
import Hero from "./Hero";
import SectionCompanion from "./SectionCompanion";
import FooterCompanion from "./FooterCompanion";
import { AppSection, CommandLineSection, EnginesSection, ExternalLink, FaqSection, HowItWorks, InstallSection, WhatItDoes } from "./Sections";
import { INITIAL_ANCHOR_EVENT, scheduleInitialAnchor } from "./fullpage-anchor";

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Once per browser, never for a deep link or reduced motion, and never before the clips exist. */
function initialSplash(): SplashMedia | null {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!shouldShowThemeSplash({ hash: window.location.hash, reducedMotion, storage: browserStorage() })) return null;
  return splashMediaFor(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
}

export default function App() {
  const [splash, setSplash] = useState<SplashMedia | null>(initialSplash);
  const finishSplash = () => {
    setSplash(null);
    requestAnimationFrame(() => {
      // Give the page focus only if the visitor has not already moved it.
      const active = document.activeElement;
      if (!active || active === document.body) document.getElementById('main')?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    document.documentElement.classList.add("cinematic-theme");
    return () => document.documentElement.classList.remove("cinematic-theme");
  }, []);
  const reduced = useReducedMotion();

  useEffect(() => scheduleInitialAnchor(
    window.location.hash,
    id => document.getElementById(id),
    { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) },
    () => window.dispatchEvent(new Event(INITIAL_ANCHOR_EVENT)),
  ), []);

  return (
    <div className="normal-site">
      {splash && !reduced && <ThemeSplash media={splash} onStart={() => rememberThemeSplash(browserStorage())} onDone={finishSplash} />}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="#" aria-label="Bowerloom home">
          <BrandIdentity />
        </a>
        <SiteNavigation />
        <ThemeControl />
        <span className="release-label">
          <span /> {readerRelease.label}
        </span>
      </header>
      <main id="main" tabIndex={-1}>
        <Hero />
        <SectionCompanion unit="s4" side="right"><WhatItDoes /></SectionCompanion>
        <SectionCompanion unit="h4n" side="left"><HowItWorks /></SectionCompanion>
        <AppSection />
        <CommandLineSection />
        <EnginesSection />
        <InstallSection />
        <SectionCompanion unit="s4-slate" side="right"><FaqSection /></SectionCompanion>
      </main>
      <FooterCompanion><footer className="site-footer" data-theme="dark">
        <a className="brand" href="#" aria-label="Bowerloom home">
          <BrandIdentity />
        </a>
        <p>{hero.H1}.</p>
        <div>
          <a href={docsPath}>Documentation</a>
          <a href={`${docsPath}roadmap/`}>Roadmap</a>
          <a href={`${docsPath}feedback/`}>Bug reports and feedback</a>
          <ExternalLink href={repository}>GitHub</ExternalLink>
          <ExternalLink href={destinations.readme}>README</ExternalLink>
          <ExternalLink href={destinations.license}>License</ExternalLink>
        </div>
        <span className="footer-note">bowerloom.ai · Made by Sage Advice.</span>
        <p className="footer-release">{readerRelease.label}. {hero.Note}</p>
      </footer></FooterCompanion>
    </div>
  );
}
