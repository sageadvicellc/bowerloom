import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { agentPrompt, checkoutCommands, destinations, docs, hero, questions, repository, stages } from "./content";

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
        "Select the prompt text and copy it manually. Clipboard access is unavailable.",
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
          <a href="#build">Build with your agent</a>
          <a href={docs}>
            Alpha guide <span aria-hidden="true">↗</span>
          </a>
          <a href={repository}>
            GitHub <span aria-hidden="true">↗</span>
          </a>
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
              Grow your sprouts on <em>Trellis</em>
            </h1>
            <p className="hero-description">
              {hero.Body}
            </p>
            <a className="button primary" href="#build">
              Build with your agent <span aria-hidden="true">↗</span>
            </a>
            <a className="hero-secondary" href="#recipe">See the first recipe</a>
            <p className="hero-note">{hero["Alpha note"]}</p>
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
            <a href="#recipe" aria-label="Go to the recipe">
              Go to the recipe <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>
        )}
        <section className="product-section" aria-labelledby="product-title">
          <h2 id="product-title">Keep the work in your hands.</h2>
          <div>
            <p>A workflow is a reusable set of steps for a task. Trellis keeps Sprouts definitions, including roles, skills, and permissions, outside any one agent app.</p>
            <p>Your personal agent prepares the prose for the alpha recipe. Trellis saves the proposed change, waits for exact approval, and records the GitHub result. Keep credentials and private installation details separate from portable definitions.</p>
          </div>
        </section>
        <section id="recipe" className="recipe-section" aria-labelledby="recipe-title">
          <div className="section-heading">
            <p className="eyebrow">First recipe: Labs to blog</p>
            <h2 id="recipe-title">Turn a completed experiment into a draft you can review.</h2>
            <p>Choose an experiment with evidence already committed to GitHub. Your agent writes the blog draft. Trellis prepares the proposed GitHub change for review before the designated local operator approves it.</p>
          </div>
          <div className="stage-controls" role="group" aria-label="Explore the recipe steps">
            {stages.map((item, index) => (
              <button key={item.name} className={index === selected ? "stage active" : "stage"} aria-pressed={index === selected} onClick={() => setSelected(index)}>
                <span className="stage-number">0{index + 1}</span>
                <span>{item.name}</span>
                <span className="stage-arrow" aria-hidden="true">{index === selected ? "↗" : "→"}</span>
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
              <span className="artifact-icon" aria-hidden="true">{["⌁", "◈", "▤", "◎"][selected]}</span>
              <span className="eyebrow">What this step produces</span>
              <strong>{stage.artifact}</strong>
            </div>
          </div>
          <div className="recipe-proof">
            <h3>A recorded run, with a result to inspect.</h3>
            <p>The October 2 trial created draft pull request #41. When the test deliberately dropped GitHub’s successful response, Trellis paused the job. A fresh process inspected the remote result and recovered the saved record. Two later runs returned the same pull request without new HTTP requests.</p>
            <p>This result covers one prepared recipe and installation. It does not establish arbitrary Sprouts team execution or measured time savings. Founder acceptance remains pending.</p>
            <div className="resource-links">
              <a href={destinations.pullRequest}>Inspect draft pull request #41</a>
              <a href={destinations.trial}>Read the trial and its limits</a>
              <a href={docs}>Prepare the recipe</a>
            </div>
            <p className="access-note">These GitHub links currently require repository access.</p>
          </div>
        </section>
        <section id="build" className="build-section" aria-labelledby="build-title">
          <div className="build-intro">
            <p className="eyebrow">Start with one recipe</p>
            <h2 id="build-title">Build with your agent</h2>
            <p>Copy this prompt into your personal agent. Start by reviewing the source and prerequisites. Prepare the recipe only after you understand its requirements and proposed external action.</p>
            <div className="prerequisites">
              <h3>What the local trial needs</h3>
              <p>Use Node 24.11 or later within Node 24, npm 11, and Git for the development checkout. Recipe execution also needs a prepared PostgreSQL database and a repository-scoped GitHub App installation. Account access and provider costs remain your responsibility.</p>
            </div>
            <div className="resource-links">
              <a href={docs}>Recipe setup guide</a>
              <a href={destinations.mcp}>MCP setup guide</a>
              <a href={destinations.evidence}>Current alpha evidence</a>
            </div>
          </div>
          <div className="prompt-panel">
            <div className="prompt-heading">
              <label className="eyebrow" htmlFor="agent-prompt">Starting prompt for your personal agent</label>
              <button onClick={copyPrompt} className="copy-button">{copyStatus.startsWith("Prompt copied") ? "Copied" : "Copy prompt"}<span aria-hidden="true">⧉</span></button>
            </div>
            <textarea id="agent-prompt" ref={promptRef} readOnly value={agentPrompt} spellCheck={false} />
            <p className="copy-status" role="status">{copyStatus || "Adapt the prompt to your experiment before you use it."}</p>
          </div>
          <details className="checkout-disclosure">
            <summary>Local checkout commands</summary>
            <p>Use the prerequisites listed here. In a new workspace directory, run the following commands to build the development checkout. These commands do not prepare the database or authorize a GitHub write.</p>
            <pre><code>{checkoutCommands}</code></pre>
            <p>From the cloned repository directory, read the included Sprouts definition:</p>
            <pre><code>node dist/apps/cli/src/main.js validate examples/endor/crew.yaml</code></pre>
            <p>This example reports <code>runtimeReady: false</code>. Validation reads the definition. It does not start workers or grant execution authority.</p>
            <p>Follow the recipe guide before execution. From this development checkout, replace <code>trellis</code> in recipe commands with <code>node dist/apps/cli/src/main.js</code>.</p>
          </details>
        </section>
        <section className="faq-section" aria-labelledby="faq-title">
          <h2 id="faq-title">Before you build</h2>
          <div className="faq-list">
            {questions.map((item, index) => <details key={item.question} open={index === 0 ? true : undefined}><summary>{item.question}</summary><p>{item.answer}</p></details>)}
          </div>
          <div className="resource-links">
            <a href={destinations.evidence}>Read the alpha boundaries</a>
            <a href={destinations.releasePlan}>Explore the release plan</a>
            <a href={destinations.license}>Read the license declaration</a>
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
        <p>An open-source framework for agent workflows.</p>
        <div>
          <a href={repository}>GitHub</a>
          <a href={docs}>Recipe guide</a>
          <a href={destinations.evidence}>Alpha evidence</a>
          <a href={destinations.license}>License declaration</a>
        </div>
        <p className="footer-access">Source and guide links currently require repository access.</p>
        <span className="footer-note">Made by Sage Advice.</span>
        <p className="footer-release">Local alpha. Founder acceptance and public release remain pending.</p>
      </footer>
    </>
  );
}
