import { readerRelease, docsPath, betaGuidePath } from './release';
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
import ThemeSplash from "./ThemeSplash";
import { rememberThemeSplash, shouldShowThemeSplash, splashMediaFor, type SplashMedia } from "./theme-splash";
import "./splash.css";
import "./hero-parallax.css";
import HomepageBanner from "./HomepageBanner";
import SectionCompanion from "./SectionCompanion";
import FooterCompanion from "./FooterCompanion";
import { INITIAL_ANCHOR_EVENT, scheduleInitialAnchor } from "./fullpage-anchor";
import { renderingBudget, type RenderSample } from "./diagnostics";

const Workshop = lazy(() => import("./Workshop"));

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>;
}

const offers = [
  {
    "title": "Agree on the work before it changes.",
    "body": "Define each role, its inputs, its outputs, and the handoff to the next role. The beta requires an exact plan revision before writing setup files, detects drift, and records revision recovery. Team files declare proposed permissions and review points. They do not grant runtime authority or start workers."
  },
  {
    "title": "Build around your existing workflow.",
    "body": "Start with a manual process or the work you already share with one agent. Your personal agent helps separate decisions, drafting, and review into a team graph. Choose a fixed Engineer, Founder, or Research profile, then compare its specification with your process. Existing-project setup adds .bowerloom without importing project contents or live agent configuration."
  },
  {
    "title": "Keep the definitions with the project.",
    "body": "Roles, skills, handoffs, and review expectations stay in files that follow you. You can version those definitions with your project and inspect them in another agent application. Credentials and installation receipts stay private. Moving definitions does not transfer permissions or prove that another application can execute them."
  }
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
          {offers.map((item, index) => <button type="button" key={item.title} aria-pressed={index === active} onClick={() => setActive(index)}>{["Governance", "Your workflow", "Portability"][index]}</button>)}
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
        {cinematic ? <section className="hero normal-hero" aria-labelledby="hero-title">
          <HomepageBanner />
          <div className="hero-copy">
            <p className="eyebrow">{hero.Eyebrow}</p>
            <h1 id="hero-title">{hero.H1}</h1>
            <p className="hero-description">{hero.Body}</p>
            <a className="button primary" href="#build">Build with your agent</a>
            <a className="hero-secondary" href="#recipe">Explore the Labs workflow</a>
          </div>
        </section> : (
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="tiny-cross">✳</span> {hero.Eyebrow}
            </p>
            <h1 id="hero-title">
              {hero.H1}
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
        <SectionCompanion unit="s4-slate" side="right"><section className="faq-section" aria-labelledby="faq-title">
          <h2 id="faq-title">Before you build</h2>
          <div className="faq-list">
            {questions.map((item, index) => <details key={item.question} open={index === 0 ? true : undefined}><summary>{item.question}</summary><p><ProductText>{item.answer}</ProductText></p></details>)}
          </div>
          <div className="resource-links">
            <a href={betaGuidePath}>Read the beta boundaries</a>
            <a href={`${betaGuidePath}#release-plan`}>Explore the release plan</a>
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
      <FooterCompanion><footer className="site-footer" data-theme="dark">
        <a className="brand" href="#" aria-label="Bowerloom home">
          <BrandIdentity />
        </a>
        <p>An open-source framework for agent teams.</p>
        <div>
          <a href={docsPath}>Documentation</a>
          <a href={`${docsPath}roadmap/`}>Roadmap</a>
          <a href={`${docsPath}feedback/`}>Bug reports and feedback</a>
          <ExternalLink href={repository}>GitHub</ExternalLink>
          <ExternalLink href={destinations.readme}>README</ExternalLink>
          <a href={betaGuidePath}>Beta guide</a>
          <ExternalLink href={destinations.license}>License declaration</ExternalLink>
        </div>
        <p className="footer-access">Read the README on GitHub. Explore the guide here.</p>
        <span className="footer-note">bowerloom.ai · Made by Sage Advice.</span>
        <p className="footer-release">{readerRelease.label} · {readerRelease.version}. Setup prepares files for review.</p>
      </footer></FooterCompanion>
    </div>
  );
}
