import { useEffect, useRef, useState } from "react";
import { cinematicJourney as journey } from "./cinematic-config";
import { hero } from "./content";
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
  const preview = new URLSearchParams(window.location.search).get("motion") === "preview";
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
  const motion = preview && hasClips && !reducedMotion && !mobile && !staticView;
  const stillInterest = !motion && !reducedMotion && !staticView;
  const scene = journey.scenes[index];
  const poster = scene.posterReady ? scene.poster : journey.openingPoster;
  const clipUrl = clip?.id === scene.id ? clip.url : null;
  const frameVisible = presented && Boolean(clipUrl);
  const beyondOpening = motion && index > 0;

  useEffect(() => { setPosterFailed(false); }, [poster]);
  useEffect(() => {
    if (staticView) sectionRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [staticView]);

  // Decorative still interest only: essential copy never depends on scroll or opacity.
  // No idle loop, transforms, or media requests; reduced motion skips this effect.
  useEffect(() => {
    const section = sectionRef.current;
    if (!stillInterest || !section) return;
    let frame: number | null = null;
    let inView = true;
    const update = () => {
      frame = null;
      const progress = Math.max(0, Math.min(1, -section.getBoundingClientRect().top / section.offsetHeight));
      section.style.setProperty("--still-opacity", String(1 - progress * 0.08));
    };
    const schedule = () => {
      if (frame === null && inView && !document.hidden) frame = requestAnimationFrame(update);
    };
    const visibility = () => {
      if (document.hidden || !inView) {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
      } else schedule();
    };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; visibility(); });
    observer.observe(section);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", visibility);
    schedule();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", visibility);
      section.style.removeProperty("--still-opacity");
    };
  }, [stillInterest]);

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
      section.style.setProperty("--seam-opacity", String(next > 0 ? Math.max(0, 1 - localProgress.current / .06) : 0));
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
    ? reducedMotion ? "Still view follows your reduced-motion preference." : staticView ? "Still view. Motion is off." : null
    : mediaState === "error" ? "Animation unavailable. The workshop image remains visible."
      : mediaState === "loading" || mediaState === "decoded" ? "Loading the animation. The workshop image remains visible."
        : mediaState === "ready" ? "Scroll to move through the workshop." : null;

  return (
    <section ref={sectionRef} data-scene={scene.id} data-media-state={mediaState} className={`cinematic-world ${motion ? "cinematic-scroll" : "cinematic-static"}${stillInterest ? " cinematic-still-interest" : ""}`} style={motion ? { minHeight: `${(journey.scenes.length * journey.scrollPerScene + 1) * 100}svh` } : undefined} aria-labelledby="hero-title">
      <div className="cinematic-stage">
        <div className="cinematic-media" aria-hidden="true">
          {!posterFailed && <img src={poster} alt="" onError={() => setPosterFailed(true)} className={frameVisible ? "cinematic-poster presented" : "cinematic-poster"} />}
          {clipUrl && motion && <video key={clipUrl} ref={videoRef} src={clipUrl} muted playsInline preload="auto" tabIndex={-1} className={frameVisible ? "cinematic-video presented" : "cinematic-video"} />}
        {motion && index > 0 && <img className="cinematic-seam" src={`/scroll-world/${journey.scenes[index - 1].id}-end.webp`} alt="" />}
        </div>
        <div className="cinematic-scrim" />
        <div className={`cinematic-copy${beyondOpening ? " cinematic-copy-chapter" : ""}`}>
          <p className="eyebrow">{hero.Eyebrow}</p>
          <h1 id="hero-title">Grow your abilities with <em>Bowerloom</em></h1>
          <p className="cinematic-description">{hero.Body}</p>
          <a className="button primary" href="#build">Build with your agent</a>
          <a className="hero-secondary" href="#recipe">See what our first seed grew</a>
          {motion && index > 0 && <div className="cinematic-chapter"><h2>{scene.title}</h2><p>{scene.body}</p></div>}
        </div>
        <div className="cinematic-bottom">
          <div><p className="cinematic-label">{motion ? "Animation study · art direction under review" : "Workshop illustration"}</p><p className="cinematic-image-caption">{posterFailed ? "Workshop image unavailable. Continue to the seed." : hero["Illustration caption"]}</p>{status && <p className="cinematic-media-status">{status}</p>}</div>
          <div className="cinematic-actions">
            {preview && hasClips && !mobile && !reducedMotion && <button className="motion-toggle" aria-pressed={staticView} onClick={() => setStaticView(!staticView)}>{staticView ? "Use motion view" : "Use still view"}</button>}
            <a href="#recipe">Go to the seed</a>
          </div>
        </div>
      </div>
    </section>
  );
}
