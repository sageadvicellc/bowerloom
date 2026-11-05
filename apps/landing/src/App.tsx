import { readerRelease, docsPath, releasesUrl } from './release';
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { destinations, hero, repository } from "./content";
import SiteNavigation, { NavCta } from "./SiteNavigation";
import BrandIdentity from "./BrandIdentity";
import ThemeControl from "./ThemeControl";
import ThemeSplash from "./ThemeSplash";
import { rememberThemeSplash, shouldShowThemeSplash, splashMediaFor, type SplashMedia } from "./theme-splash";
import "./hero-parallax.css";
import "./page.css";
import "./review.css";
import "./reveal.css";
import { initReveal } from "./reveal";
import Hero from "./Hero";
import SectionCompanion from "./SectionCompanion";
import FooterCompanion from "./FooterCompanion";
import { AppSection, CommandLineSection, EnginesSection, ExternalLink, FaqSection, HowItWorks, InstallSection, WhatItDoes } from "./Sections";
import { compactDistance, watchHeaderProgress } from "./header-progress";
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
  // Runs before the first paint, so what is on screen is marked as shown before the hiding class goes on.
  useLayoutEffect(() => initReveal(), []);
  const reduced = useReducedMotion();
  // The header follows the scroll position: --header-p goes from 0 at the top to 1 at the compact distance, and the style sheet draws every part of the change from it.
  // It starts in a layout effect, before the first paint, and writes on the shell so a scroll frame restyles only the header.
  const shell = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = shell.current;
    if (!element) return undefined;
    const root = document.documentElement;
    return watchHeaderProgress({ win: window, distance: () => compactDistance(root, element), write: progress => element.style.setProperty("--header-p", String(progress)) });
  }, []);

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
      <div className="site-header-shell" ref={shell}>
        <header className="site-header">
          <a className="brand" href="#" aria-label="Bowerloom home">
            <BrandIdentity />
          </a>
          <SiteNavigation />
          <ThemeControl />
          <NavCta />
        </header>
      </div>
      <main id="main" tabIndex={-1}>
        <Hero />
        <SectionCompanion unit="s4" side="right"><WhatItDoes /></SectionCompanion>
        <SectionCompanion unit="h4n" side="left"><HowItWorks /></SectionCompanion>
        <AppSection />
        <EnginesSection />
        <CommandLineSection />
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
