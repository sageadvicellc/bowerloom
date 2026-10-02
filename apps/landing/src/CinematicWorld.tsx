import { useEffect, useRef, useState } from "react";
import { cinematicJourney as journey } from "./cinematic-config";
import { createVideoScrubber } from "./cinematic-scrub";

type MediaState = "awaiting" | "loading" | "decoded" | "ready" | "error";

function useMobileStill() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 860px), (pointer: coarse)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px), (pointer: coarse)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

/** Load one bounded, seekable clip. A blob avoids relying on a host's range support. */
async function loadClip(path: string, signal: AbortSignal) {
  const response = await fetch(path, { signal });
  if (!response.ok || !response.headers.get("content-type")?.includes("video/mp4")) throw new Error("Clip unavailable");
  if (Number(response.headers.get("content-length")) > journey.maxClipBytes) throw new Error("Clip exceeds the media budget");
  if (!response.body) throw new Error("Clip cannot be loaded");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > journey.maxClipBytes) throw new Error("Clip exceeds the media budget");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return new Blob(chunks, { type: "video/mp4" });
}

export default function CinematicWorld({ reducedMotion }: { reducedMotion: boolean }) {
  const mobile = useMobileStill();
  const [staticView, setStaticView] = useState(false);
  const [index, setIndex] = useState(0);
  const [mediaState, setMediaState] = useState<MediaState>("awaiting");
  const [clip, setClip] = useState<{ id: string; url: string } | null>(null);
  const [presented, setPresented] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const localProgress = useRef(0);
  const scrubRef = useRef<ReturnType<typeof createVideoScrubber> | null>(null);
  const activeRef = useRef(true);
  const scrubSceneRef = useRef<string | null>(null);
  const hasClips = journey.scenes.some((item) => item.clipReady);
  const motion = hasClips && !reducedMotion && !mobile && !staticView;
  const scene = journey.scenes[index];
  const poster = scene.posterReady ? scene.poster : journey.openingPoster;
  const clipUrl = clip?.id === scene.id ? clip.url : null;
  const frameVisible = presented && Boolean(clipUrl);

  useEffect(() => { setPosterFailed(false); }, [poster]);

  useEffect(() => {
    if (!motion) { setIndex(0); localProgress.current = 0; return; }
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const distance = Math.max(1, section.offsetHeight - window.innerHeight);
      const progress = Math.max(0, Math.min(1, -rect.top / distance));
      const position = progress * journey.scenes.length;
      const next = Math.min(journey.scenes.length - 1, Math.floor(position));
      localProgress.current = Math.min(1, position - next);
      setIndex(next);
      if (scrubSceneRef.current === journey.scenes[next].id) scrubRef.current?.setProgress(localProgress.current);
    };
    const schedule = () => { if (frame === null && activeRef.current) frame = requestAnimationFrame(update); };
    let inView = true;
    const visibility = () => {
      activeRef.current = inView && !document.hidden;
      scrubRef.current?.setEnabled(activeRef.current);
      if (activeRef.current) schedule();
      else if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; visibility(); });
    if (sectionRef.current) observer.observe(sectionRef.current);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [motion]);

  useEffect(() => {
    setClip(null);
    setPresented(false);
    if (!motion || !scene.clipReady) { setMediaState("awaiting"); return; }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setMediaState("loading");
    loadClip(scene.clip, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setClip({ id: scene.id, url: objectUrl });
    }).catch(() => { if (!controller.signal.aborted) setMediaState("error"); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [motion, scene.clip, scene.clipReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clipUrl || !motion) return;
    const scrub = createVideoScrubber(video, { request: (callback) => requestAnimationFrame(callback), cancel: (id) => cancelAnimationFrame(id) });
    scrubRef.current = scrub;
    scrubSceneRef.current = scene.id;
    scrub.setEnabled(activeRef.current);
    let valid = false;
    let framePresented = false;
    let callback: number | null = null;
    let revealFrame: number | null = null;
    const fail = () => {
      valid = false;
      scrub.setEnabled(false);
      if (scrubRef.current === scrub) { scrubRef.current = null; scrubSceneRef.current = null; }
      setPresented(false);
      setMediaState("error");
    };
    const metadata = () => {
      valid = Number.isFinite(video.duration) && video.duration > 0 && video.duration <= journey.maxClipSeconds;
      if (!valid) { fail(); return; }
      scrub.setProgress(localProgress.current);
    };
    const decoded = () => {
      if (!valid) return;
      if (!framePresented) setMediaState("decoded");
      scrub.setProgress(localProgress.current);
      scrub.decoded();
    };
    const reveal = () => {
      // RVFC/seeked already confirmed a real frame. A subsequent seek may lower readyState again.
      if (valid && video.videoWidth > 0) { framePresented = true; setPresented(true); setMediaState("ready"); }
    };
    const seekComplete = () => {
      // Paused/occluded video can defer RVFC even after a frame has decoded.
      // A completed seek plus ready video data is the bounded fallback; loading alone never reveals it.
      if (valid && video.readyState >= 2 && !framePresented && revealFrame === null) revealFrame = requestAnimationFrame(() => { revealFrame = null; reveal(); });
      decoded();
    };
    // Prefer presentation confirmation. Never call play() to prime a decoder.
    if (typeof video.requestVideoFrameCallback === "function") callback = video.requestVideoFrameCallback(reveal);
    video.addEventListener("loadedmetadata", metadata);
    video.addEventListener("loadeddata", decoded);
    video.addEventListener("seeked", seekComplete);
    video.addEventListener("error", fail);
    if (video.readyState >= 1) metadata();
    if (video.readyState >= 2) decoded();
    return () => {
      scrub.dispose();
      if (scrubRef.current === scrub) { scrubRef.current = null; scrubSceneRef.current = null; }
      if (callback !== null) video.cancelVideoFrameCallback(callback);
      if (revealFrame !== null) cancelAnimationFrame(revealFrame);
      video.removeEventListener("loadedmetadata", metadata);
      video.removeEventListener("loadeddata", decoded);
      video.removeEventListener("seeked", seekComplete);
      video.removeEventListener("error", fail);
    };
  }, [clipUrl, motion, scene.id]);

  const status = !motion
    ? reducedMotion ? "Still view follows your reduced-motion preference." : mobile ? "Still view on mobile. Desktop scroll animation is in development." : !hasClips ? "Selected workshop still. Matching animation is being prepared." : "Still view. Scroll animation is paused."
    : mediaState === "error" ? "Animation unavailable. The workshop still remains visible."
      : mediaState === "loading" ? "Loading this scene. The still remains until a video frame is ready."
        : mediaState === "decoded" ? "Scroll to reveal the animation. The opening frame remains visible."
        : mediaState === "ready" ? "Scroll to move through the workshop."
          : `Scene ${index + 1} animation awaits media. ${scene.posterReady ? "Showing its workshop still." : "Showing the opening workshop still."}`;

  return (
    <section ref={sectionRef} className={`cinematic-world ${motion ? "cinematic-scroll" : "cinematic-static"}`} style={motion ? { minHeight: `${(journey.scenes.length * journey.scrollPerScene + 1) * 100}svh` } : undefined} aria-labelledby="hero-title">
      <div className="cinematic-stage">
        <div className="cinematic-media" aria-hidden="true">
          {!posterFailed && <img src={poster} alt="" onError={() => setPosterFailed(true)} className={frameVisible ? "cinematic-poster presented" : "cinematic-poster"} />}
          {clipUrl && motion && <video key={clipUrl} ref={videoRef} src={clipUrl} muted playsInline preload="auto" tabIndex={-1} className={frameVisible ? "cinematic-video presented" : "cinematic-video"} />}
        </div>
        <div className="cinematic-scrim" />
        <div className="cinematic-copy">
          <p className="eyebrow">OPEN TOOLS. PERSONAL AGENTS.</p>
          <h1 id="hero-title">Grow your agent crew on <em>Trellis</em></h1>
          <p className="cinematic-description">A free, open-source toolkit for your personal agent to turn everyday routines into connected workflows.</p>
          <a className="button primary" href="#build">Build with your agent <span aria-hidden="true">↗</span></a>
          <p className="hero-note">Your agent. Your workspace. Your call.</p>
          <div className="cinematic-chapter">
            <p className="eyebrow">WORKSHOP JOURNEY / {String(index + 1).padStart(2, "0")} OF 06</p>
            <h2>{index === 0 ? "A place to grow useful work." : scene.title}</h2>
            <p>{index === 0 ? "Bring your agent, a routine, and a clear next step." : scene.body}</p>
          </div>
          <details className="cinematic-transcript">
            <summary>Read the journey</summary>
            <ol>{journey.scenes.map((item) => <li key={item.id}><strong>{item.title}</strong><p>{item.body}</p></li>)}</ol>
          </details>
        </div>
        <div className="cinematic-bottom">
          <div><p className="cinematic-label">ILLUSTRATIVE VISUAL / CINEMATIC PILOT</p><p role="status">{posterFailed ? "Workshop still unavailable. Read the journey above." : status}</p></div>
          <div className="cinematic-actions">
            {hasClips && !mobile && !reducedMotion && <button className="motion-toggle" aria-pressed={staticView} onClick={() => setStaticView(!staticView)}>{staticView ? "Use scroll motion" : "Use still view"}</button>}
            <a href="#recipe">Explore the real recipe ↓</a>
          </div>
        </div>
      </div>
    </section>
  );
}
