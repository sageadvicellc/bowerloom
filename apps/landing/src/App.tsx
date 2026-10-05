import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { destinations, hero, questions, repository } from "./content";
import ProductText from "./ProductText";
import LabsWorkflow from "./LabsWorkflow";
import SiteNavigation from "./SiteNavigation";
import BrandIdentity from "./BrandIdentity";
import ThemeControl from "./ThemeControl";

import StaticWorkshop from "./StaticWorkshop";
import TutorialBuilder from "./TutorialBuilder";
import CinematicIntro from "./CinematicIntro";
import { selectIntroMedia } from "./intro-media";
import type { IntroExit } from "./intro-controller";
import "./splash.css";
import { rememberSplash, shouldShowSplash, SPLASH_FIXTURE_SESSION_KEY, SPLASH_SESSION_KEY } from "./splash-playback";
import HomepageBanner from "./HomepageBanner";
import SectionCompanion from "./SectionCompanion";
import { INITIAL_ANCHOR_EVENT, scheduleInitialAnchor } from "./fullpage-anchor";
import { renderingBudget, type RenderSample } from "./diagnostics";

const Workshop = lazy(() => import("./Workshop"));

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>;
}

const offers = [
  { title: "A toolkit that works together.", body: "The Teams module describes roles and skills. Relay carries messages, Roots holds knowledge, and Vines records logs. Workbench supplies repeatable tests. Each tool has a clear job; check the alpha evidence for what is ready today." },
  { title: "Your agent manages the project.", body: "Start with the personal agent you already use. It helps describe the task, prepare the team, and bring proposed changes back to you. Bowerloom supplies explicit controls and records around the tested actions; your agent remains your interface." },
  { title: "Take your team with you.", body: "Keep team definitions, skills, and permissions in versioned files outside one agent app. Keep credentials separate. Codex is the tested alpha path; execution across other harnesses is a beta plan, not a current guarantee." },
];

function CoreOffers() {
  const [active, setActive] = useState(0);
  const offer = offers[active];
  return <SectionCompanion unit="s4" side="right"><section className="product-section" aria-labelledby="product-title" aria-roledescription="carousel">
    <div><p className="eyebrow">Portable tools and teams</p><h2 id="product-title">Keep the work in your hands.</h2></div>
    <div className="offer-content">
      <div className="offer-slide" role="group" aria-roledescription="slide" aria-label={`${active + 1} of ${offers.length}`} aria-live="polite" aria-atomic="true">
        <h3>{offer.title}</h3><p><ProductText>{offer.body}</ProductText></p>
      </div>
      <div className="offer-controls" role="group" aria-label="Explore Bowerloom">
        <div className="offer-tabs" style={{ '--active-offer': active } as React.CSSProperties}>
          <span className="offer-indicator" aria-hidden="true" />
          {offers.map((item, index) => <button type="button" key={item.title} aria-pressed={index === active} onClick={() => setActive(index)}>{["The tools", "Your agent", "Portability"][index]}</button>)}
        </div>
        <div className="offer-arrows">
          <button type="button" onClick={() => setActive((active + offers.length - 1) % offers.length)} aria-label="Previous offer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12" /></svg></button>
          <button type="button" onClick={() => setActive((active + 1) % offers.length)} aria-label="Next offer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6M4 12h12" /></svg></button>
        </div>
      </div>
    </div>
  </section></SectionCompanion>;
}

class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

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

export default function App() {
  const [introMedia, setIntroMedia] = useState(() => selectIntroMedia(new URLSearchParams(window.location.search).get('intro') === 'fixture', window.innerHeight > window.innerWidth));
  const sessionKey = introMedia?.kind === 'fixture' ? SPLASH_FIXTURE_SESSION_KEY : SPLASH_SESSION_KEY;
  const [introExit, setIntroExit] = useState<IntroExit | null>(null);
  const [splashOpen, setSplashOpen] = useState(() => {
    if (!introMedia) return false;
    try { return shouldShowSplash(window.location.hash, window.sessionStorage, sessionKey); }
    catch { return shouldShowSplash(window.location.hash, null, sessionKey); }
  });
  const replayRef = useRef<HTMLButtonElement>(null);
  const replaying = useRef(false);
  const enterSite = (reason: IntroExit) => {
    setIntroExit(reason);
    try { rememberSplash(window.sessionStorage, sessionKey); } catch { /* Entry never depends on storage. */ }
    setSplashOpen(false);
    requestAnimationFrame(() => {
      if (replaying.current) replayRef.current?.focus();
      else document.getElementById('hero-title')?.focus();
    });
  };
  const replaySplash = () => {
    const next = selectIntroMedia(new URLSearchParams(window.location.search).get('intro') === 'fixture', window.innerHeight > window.innerWidth);
    if (!next) return;
    setIntroMedia(next); replaying.current = true; setSplashOpen(true);
  };
  const [selected, setSelected] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [webglFailed, setWebglFailed] = useState(false);
  const [mapView, setMapView] = useState(false);
  const [renderSample, setRenderSample] = useState<RenderSample | null>(null);
  const [renderLoop, setRenderLoop] = useState("loading");
  const cinematic = new URLSearchParams(window.location.search).get("cinematic") !== "0";
  useEffect(() => {
    document.documentElement.classList.toggle("cinematic-theme", cinematic);
    return () => document.documentElement.classList.remove("cinematic-theme");
  }, [cinematic]);
  const diagnostics =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("diagnostics") === "1";
  const reduced = useReducedMotion();
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => scheduleInitialAnchor(
    window.location.hash,
    id => document.getElementById(id),
    { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) },
    () => window.dispatchEvent(new Event(INITIAL_ANCHOR_EVENT)),
  ), []);

  useEffect(() => {
    let onScreen = true;
    const update = () => setVisible(onScreen && !document.hidden);
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        update();
      },
      { rootMargin: "100px" },
    );
    if (sceneRef.current) observer.observe(sceneRef.current);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return (
    <div className="normal-site" data-intro-exit={introExit ?? undefined}>
      {splashOpen && introMedia && <CinematicIntro media={introMedia} reducedMotion={reduced} onEnter={enterSite} />}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="#" aria-label="Bowerloom home">
          <BrandIdentity />
        </a>
        <SiteNavigation />
        <ThemeControl />
        <span className="alpha-label">
          <span /> v0.7 alpha
        </span>
      </header>
      <main id="main">
        {cinematic ? <section className="hero normal-hero" aria-labelledby="hero-title">
          <HomepageBanner />
          <div className="hero-copy">
            <p className="eyebrow">{hero.Eyebrow}</p>
            <h1 id="hero-title" tabIndex={-1}>Grow your capabilities with <em>Bowerloom</em></h1>
            <p className="hero-description">{hero.Body}</p>
            <a className="button primary" href="#build">Build with your agent</a>
            <a className="hero-secondary" href="#recipe">Explore the Labs workflow</a>
            <button ref={replayRef} type="button" className="splash-replay" disabled={!introMedia} onClick={replaySplash}>{introMedia ? "Replay workshop animation" : "Intro preview in preparation"}</button>
          </div>
        </section> : (
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="tiny-cross">✳</span> {hero.Eyebrow}
            </p>
            <h1 id="hero-title" tabIndex={-1}>
              Grow your capabilities with <em>Bowerloom</em>
            </h1>
            <p className="hero-description">
              {hero.Body}
            </p>
            <a className="button primary" href="#build">
              Build with your agent
            </a>
            <a className="hero-secondary" href="#recipe">Explore the Labs workflow</a>
          </div>
          <div className="workshop-area" ref={sceneRef}>
            <div className="scene-caption">
              <span className="status-dot" /> THE LABS WORKSHOP{" "}

            </div>
            <div
              className="scene"
              aria-label="Interactive workshop illustration"
            >
              {reduced || webglFailed || mapView ? (
                <StaticWorkshop selected={selected} />
              ) : (
                <SceneBoundary
                  fallback={<StaticWorkshop selected={selected} />}
                >
                  <Suspense fallback={<StaticWorkshop selected={selected} />}>
                    <Workshop
                      selected={selected}
                      onSelect={setSelected}
                      active={!paused && visible}
                      onFailure={() => setWebglFailed(true)}
                      onSample={diagnostics ? setRenderSample : undefined}
                      onLoopChange={diagnostics ? setRenderLoop : undefined}
                    />
                  </Suspense>
                </SceneBoundary>
              )}
            </div>
            <div className="scene-bottom">
              <span>
                {reduced || webglFailed || mapView
                  ? "WORKSHOP MAP · STATIC VIEW"
                  : "EXPLORE THE STATIONS BELOW"}
              </span>
              {!reduced && !webglFailed && (
                <div className="scene-settings">
                  {!mapView && (
                    <button
                      className="motion-toggle"
                      onClick={() => setPaused(!paused)}
                      aria-pressed={paused}
                    >
                      {paused ? "Resume motion" : "Pause motion"}
                    </button>
                  )}
                  <button
                    className="motion-toggle"
                    onClick={() => setMapView(!mapView)}
                    aria-pressed={mapView}
                  >
                    {mapView ? "Explore in 3D" : "Use static map"}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="hero-footer">
            <span>Workshop illustration</span>
            <a href="#recipe" aria-label="Go to the workflow">
              Go to the workflow
            </a>
          </div>
        </section>
        )}
        <CoreOffers />
        <SectionCompanion unit="h4n" side="left"><LabsWorkflow /></SectionCompanion>
        <TutorialBuilder />
        <SectionCompanion unit="s4" side="right"><section className="faq-section" aria-labelledby="faq-title">
          <h2 id="faq-title">Before you build</h2>
          <div className="faq-list">
            {questions.map((item, index) => <details key={item.question} open={index === 0 ? true : undefined}><summary>{item.question}</summary><p><ProductText>{item.answer}</ProductText></p></details>)}
          </div>
          <div className="resource-links">
            <a href="#alpha-guide">Read the alpha boundaries</a>
            <a href="#release-plan">Explore the release plan</a>
            <ExternalLink href={destinations.license}>Read the license declaration</ExternalLink>
          </div>
        </section></SectionCompanion>
      </main>
      {diagnostics && !cinematic && (
        <aside
          className="render-diagnostics"
          aria-label="Rendering diagnostics"
        >
          <strong>LOCAL RENDERING BUDGET</strong>
          <p>
            Render loop:{" "}
            {reduced || webglFailed || mapView
              ? "static / canvas removed"
              : renderLoop}
          </p>
          <p>
            {renderSample
              ? "Sampling complete / stopped at 120 frames"
              : "Sampling up to 120 frames…"}
          </p>
          {renderSample && (
            <pre>
              {[
                "Draw calls (max): " +
                  renderSample.calls +
                  " / " +
                  renderingBudget.drawCalls,
                "Triangles (max): " +
                  renderSample.triangles +
                  " / " +
                  renderingBudget.triangles,
                "DPR: " + renderSample.dpr + " / " + renderingBudget.dpr,
                "Backing size: " +
                  renderSample.backingWidth +
                  " × " +
                  renderSample.backingHeight,
                "Backing pixels: " +
                  renderSample.backingWidth * renderSample.backingHeight +
                  " / " +
                  renderingBudget.backingPixels,
                "Frame interval mean: " +
                  renderSample.meanFrameMs.toFixed(2) +
                  " ms",
                "Frame interval p95: " +
                  renderSample.p95FrameMs.toFixed(2) +
                  " ms",
              ].join("\n")}
            </pre>
          )}
          <p>
            Scene JS budget: ≤300 KiB gzip (build check).
            <br />
            Timing is local observation, not an FPS guarantee.
          </p>
        </aside>
      )}
      <footer className="site-footer" data-theme="dark">
        <a className="brand" href="#" aria-label="Bowerloom home">
          <BrandIdentity />
        </a>
        <p>An open-source framework for agent teams.</p>
        <div>
          <ExternalLink href={repository}>GitHub</ExternalLink>
          <ExternalLink href={destinations.readme}>README</ExternalLink>
          <a href="#alpha-evidence">Alpha evidence</a>
          <ExternalLink href={destinations.license}>License declaration</ExternalLink>
        </div>
        <p className="footer-access">Read the README on GitHub. Explore the guide here.</p>
        <span className="footer-note">bowerloom.ai · Made by Sage Advice.</span>
        <p className="footer-release">Local alpha. Founder acceptance and public release remain pending.</p>
      </footer>
    </div>
  );
}
