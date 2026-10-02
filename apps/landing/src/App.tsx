import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { destinations, docs, hero, questions, repository, stages } from "./content";

import StaticWorkshop from "./StaticWorkshop";
import TutorialBuilder from "./TutorialBuilder";
import CinematicWorld from "./CinematicWorld";
import { renderingBudget, type RenderSample } from "./diagnostics";

const Workshop = lazy(() => import("./Workshop"));

function Mark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <path d="M8 29V7m10 22V7m10 22V7M5 12h26M5 24h26m-23 0 10-12 10 12" />
    </svg>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>;
}

function SeedIcon({ index }: { index: number }) {
  const paths = [
    "M7 3h10M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M7 15h10",
    "M5 3h10l4 4v14H5V3Zm10 0v5h4M8 12h8M8 16h6",
    "m4 16 11-11 4 4L8 20H4v-4Zm9-9 4 4M13 20h7",
    "M20 11v1a8 8 0 1 1-5-7M8 11l4 4 8-9",
  ];
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[index]} /></svg>;
}

function ProductText({ children }: { children: string }) {
  return <>{children.split(/(Sprouts|Relay|Roots|Vines|Workbench|@sagetrellis\/[a-z-]+)/g).map((part, index) => /^(Sprouts|Relay|Roots|Vines|Workbench|@sagetrellis\/[a-z-]+)$/.test(part) ? <code key={index}>{part}</code> : part)}</>;
}

const offers = [
  { title: "A toolkit that works together.", body: "Sprouts describes the team and its skills. Relay carries messages, Roots holds knowledge, and Vines records logs. Workbench supplies repeatable tests. Each tool has a clear job; check the alpha evidence for what is ready today." },
  { title: "Your agent manages the project.", body: "Start with the personal agent you already use. It helps describe the task, prepare the team, and bring proposed changes back to you. Bowerloom supplies explicit controls and records around the tested actions; your agent remains your interface." },
  { title: "Take your team with you.", body: "Keep team definitions, skills, and permissions in versioned files outside one agent app. Keep credentials separate. Codex is the tested alpha path; execution across other harnesses is a beta plan, not a current guarantee." },
];

function CoreOffers() {
  const [active, setActive] = useState(0);
  const offer = offers[active];
  return <section className="product-section" aria-labelledby="product-title" aria-roledescription="carousel">
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
  </section>;
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
  const stage = stages[selected];

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
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="#" aria-label="Bowerloom home">
          <Mark />
          <span>
            bowerloom<span className="brand-period">.</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#recipe">The seed</a>
          <a href="#build">Build with your agent</a>
          <ExternalLink href={docs}>Alpha guide</ExternalLink>
          <ExternalLink href={repository}>GitHub</ExternalLink>
        </nav>
        <span className="alpha-label">
          <span /> v0.7 alpha
        </span>
      </header>
      <main id="main">
        {cinematic ? <CinematicWorld reducedMotion={reduced} /> : (
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="tiny-cross">✳</span> {hero.Eyebrow}
            </p>
            <h1 id="hero-title">
              Grow your abilities with <em>Bowerloom</em>
            </h1>
            <p className="hero-description">
              {hero.Body}
            </p>
            <a className="button primary" href="#build">
              Build with your agent
            </a>
            <a className="hero-secondary" href="#recipe">See what our first seed grew</a>
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
            <a href="#recipe" aria-label="Go to the seed">
              Go to the seed
            </a>
          </div>
        </section>
        )}
        <CoreOffers />
        <section id="recipe" className="recipe-section" aria-labelledby="recipe-title">
          <div className="section-heading">
            <p className="eyebrow">First seed: Labs to blog</p>
            <h2 id="recipe-title">Turn a completed experiment into a draft you can review.</h2>
            <p>Choose an experiment with evidence already committed to GitHub. Your agent writes the blog draft. Bowerloom prepares the proposed GitHub change for review before the designated local operator approves it.</p>
          </div>
          <div className="stage-controls" role="group" aria-label="Explore the seed steps">
            {stages.map((item, index) => (
              <button key={item.name} className={index === selected ? "stage active" : "stage"} aria-pressed={index === selected} onClick={() => setSelected(index)}>
                <span className="stage-icon" aria-hidden="true">{<SeedIcon index={index} />}</span>
                <span>{item.name}</span>
              </button>
            ))}
          </div>
          <div className="stage-detail" aria-live="polite" aria-atomic="true">
            <div>
              <p className="eyebrow" style={{ color: cinematic ? "var(--ui-muted)" : stage.color }}>{stage.tag}</p>
              <h3>{stage.title}</h3>
              <p>{stage.description}</p>
            </div>
            <div className="artifact">
              <span className="eyebrow">What this step produces</span>
              <strong>{stage.artifact}</strong>
            </div>
          </div>
          <div className="recipe-proof">
            <h3>A recorded run, with a result to inspect.</h3>
            <p>The recorded GitHub seed produced a reviewable blog draft with its evidence attached. When the test deliberately dropped GitHub’s successful response, Bowerloom paused the uncertain write. A fresh process recovered the saved result. Two later runs returned that same result without new HTTP requests or duplicate drafts.</p>
            <p>This result covers one prepared seed and installation. It does not establish arbitrary team execution or measured time savings. Alpha release acceptance remains separate.</p>
            <div className="resource-links">
              <ExternalLink href={destinations.trial}>Read the trial and its limits</ExternalLink>
              <ExternalLink href={docs}>Explore the GitHub seed</ExternalLink>
            </div>
            <p className="access-note">The source and guides are available on GitHub.</p>
          </div>
        </section>
        <TutorialBuilder />
        <section className="faq-section" aria-labelledby="faq-title">
          <h2 id="faq-title">Before you build</h2>
          <div className="faq-list">
            {questions.map((item, index) => <details key={item.question} open={index === 0 ? true : undefined}><summary>{item.question}</summary><p><ProductText>{item.answer}</ProductText></p></details>)}
          </div>
          <div className="resource-links">
            <ExternalLink href={destinations.evidence}>Read the alpha boundaries</ExternalLink>
            <ExternalLink href={destinations.releasePlan}>Explore the release plan</ExternalLink>
            <ExternalLink href={destinations.license}>Read the license declaration</ExternalLink>
          </div>
        </section>
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
      <footer className="site-footer">
        <a className="brand" href="#" aria-label="Bowerloom home">
          <Mark />
          <span>bowerloom.</span>
        </a>
        <p>An open-source framework for agent teams.</p>
        <div>
          <ExternalLink href={repository}>GitHub</ExternalLink>
          <ExternalLink href={docs}>GitHub seed guide</ExternalLink>
          <ExternalLink href={destinations.evidence}>Alpha evidence</ExternalLink>
          <ExternalLink href={destinations.license}>License declaration</ExternalLink>
        </div>
        <p className="footer-access">Read the source and guides on GitHub.</p>
        <span className="footer-note">bowerloom.ai · Made by Sage Advice.</span>
        <p className="footer-release">Local alpha. Founder acceptance and public release remain pending.</p>
      </footer>
    </>
  );
}
