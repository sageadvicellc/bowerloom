import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { agentPrompt, docs, repository, stages } from "./content";

import StaticWorkshop from "./StaticWorkshop";
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
  const [copyStatus, setCopyStatus] = useState("");
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
  const promptRef = useRef<HTMLTextAreaElement>(null);
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

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(agentPrompt);
      setCopyStatus("Prompt copied. Paste it into your personal agent.");
    } catch {
      promptRef.current?.focus();
      promptRef.current?.select();
      setCopyStatus(
        "Select and copy the prompt below. Clipboard access is unavailable.",
      );
    }
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="#" aria-label="Trellis home">
          <Mark />
          <span>
            trellis<span className="brand-period">.</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#recipe">The recipe</a>
          <a href={docs}>
            Docs <span aria-hidden="true">↗</span>
          </a>
          <a href={repository}>
            GitHub <span aria-hidden="true">↗</span>
          </a>
        </nav>
        <span className="alpha-label">
          <span /> V0.7 / ALPHA
        </span>
      </header>
      <main id="main">
        {cinematic ? <CinematicWorld reducedMotion={reduced} /> : (
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="tiny-cross">✳</span> OPEN TOOLS. PERSONAL AGENTS.
            </p>
            <h1 id="hero-title">
              Grow your agent crew on <em>Trellis</em>
            </h1>
            <p className="hero-description">
              Build automations that keep growing.
              <br />A free, open-source toolkit for your personal agent to turn
              everyday routines into connected workflows.
            </p>
            <a className="button primary" href="#build">
              Build with your agent <span aria-hidden="true">↗</span>
            </a>
            <p className="hero-note">Your agent. Your workspace. Your call.</p>
          </div>
          <div className="workshop-area" ref={sceneRef}>
            <div className="scene-caption">
              <span className="status-dot" /> THE LABS WORKSHOP{" "}
              <span className="scene-coordinate">40° / 01</span>
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
                  ? "WORKSHOP MAP / STATIC VIEW"
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
                      {paused ? "▷ Resume motion" : "Ⅱ Pause motion"}
                    </button>
                  )}
                  <button
                    className="motion-toggle"
                    onClick={() => setMapView(!mapView)}
                    aria-pressed={mapView}
                  >
                    {mapView ? "Explore in 3D" : "Static map"}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="hero-footer">
            <span>GROW SOMETHING USEFUL</span>
            <a href="#recipe" aria-label="Explore the Labs recipe">
              SCROLL TO EXPLORE <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>
        )}
        <section
          id="recipe"
          className="recipe-section"
          aria-labelledby="recipe-title"
        >
          <div className="section-heading">
            <p className="eyebrow">FIRST RECIPE / LABS</p>
            <h2 id="recipe-title">
              From an experiment
              <br />
              to something you can <em>review.</em>
            </h2>
            <p>
              A completed experiment. A visible evidence trail.
              <br />
              One example of what your agent can build.
            </p>
          </div>
          <div
            className="stage-controls"
            role="group"
            aria-label="Explore recipe stages"
          >
            {stages.map((item, index) => (
              <button
                key={item.name}
                className={index === selected ? "stage active" : "stage"}
                aria-pressed={index === selected}
                onClick={() => setSelected(index)}
              >
                <span className="stage-number">0{index + 1}</span>
                <span>{item.name}</span>
                <span className="stage-arrow" aria-hidden="true">
                  {index === selected ? "↗" : "→"}
                </span>
              </button>
            ))}
          </div>
          <div className="stage-detail" aria-live="polite" aria-atomic="true">
            <div>
              <p className="eyebrow" style={{ color: cinematic ? "var(--ui-muted)" : stage.color }}>
                {stage.tag}
              </p>
              <h3>{stage.title}</h3>
              <p>{stage.description}</p>
            </div>
            <div className="artifact">
              <span className="artifact-icon" aria-hidden="true">
                {["⌁", "◈", "▤", "◎"][selected]}
              </span>
              <span className="eyebrow">WHAT YOU KEEP</span>
              <strong>{stage.artifact}</strong>
              <span className="artifact-note">LOCAL FIRST / HUMAN REVIEW</span>
            </div>
          </div>
        </section>
        <section className="toolkit-section" aria-labelledby="toolkit-title">
          <div>
            <p className="eyebrow">SMALL PARTS. CONNECTED WORK.</p>
            <h2 id="toolkit-title">
              Give your agent
              <br />a place to build.
            </h2>
          </div>
          <div className="toolkit-copy">
            <p>
              Trellis brings skills, roles, templates, and connection helpers
              into a toolkit your agent can work with through a small CLI and
              MCP interface.
            </p>
            <p>
              Describe the routine. Define the boundaries. Keep the workflow and
              its instructions in files you can read, version, and change.
            </p>
            <a className="text-link" href={docs}>
              Meet the toolkit <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="toolkit-line">
            <span>SKILLS</span>
            <i>+</i>
            <span>ROLES</span>
            <i>+</i>
            <span>TEMPLATES</span>
            <i>+</i>
            <span>CONNECTIONS</span>
            <i>→</i>
            <span className="accent">YOUR WORKFLOW</span>
          </div>
        </section>
        <section
          id="build"
          className="build-section"
          aria-labelledby="build-title"
        >
          <div className="build-intro">
            <p className="eyebrow">YOUR NEXT STEP</p>
            <h2 id="build-title">
              Bring your agent.
              <br />
              <em>Start small.</em>
            </h2>
            <p>
              Copy this prompt into your personal agent. It will read the
              project, check the prerequisites, and help you prepare the local
              alpha recipe.
            </p>
            <div className="alpha-boundary">
              <span className="status-dot" />
              <div>
                <strong>A workshop, still in progress.</strong>
                <p>
                  v0.7 alpha is Codex-first and intended for local testing. The
                  Labs example uses a completed experiment. You authorize
                  draft-PR creation; you or your designated reviewer approve
                  publication separately. Account connections need your
                  authorization. No automatic publishing.
                </p>
              </div>
            </div>
            <a
              className="text-link"
              href={`${repository}/blob/feature/trellis-v1/docs/alpha/acceptance-status.md`}
            >
              Read the alpha limits <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="prompt-panel">
            <div className="prompt-heading">
              <span className="eyebrow">A PROMPT FOR YOUR AGENT</span>
              <button onClick={copyPrompt} className="copy-button">
                {copyStatus.startsWith("Prompt copied")
                  ? "✓ Copied"
                  : "Copy prompt"}{" "}
                <span aria-hidden="true">⧉</span>
              </button>
            </div>
            <label className="sr-only" htmlFor="agent-prompt">
              Setup prompt for your personal agent
            </label>
            <textarea
              id="agent-prompt"
              ref={promptRef}
              readOnly
              value={agentPrompt}
              spellCheck={false}
            />
            <p className="copy-status" role="status">
              {copyStatus || "Read it. Change it. Make it yours."}
            </p>
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
        <a className="brand" href="#" aria-label="Trellis home">
          <Mark />
          <span>trellis.</span>
        </a>
        <p>Built to be yours. Free + open source.</p>
        <div>
          <a href={repository}>GitHub ↗</a>
          <a href={`${repository}/blob/feature/trellis-v1/package.json`}>
            License declaration ↗
          </a>
        </div>
        <span className="footer-note">AN OPEN WORKSHOP BY SAGE ADVICE</span>
      </footer>
    </>
  );
}
