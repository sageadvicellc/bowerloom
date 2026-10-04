import { useEffect, useRef, useState } from "react";
import { cinematicJourney as journey, fullpageRegions } from "./cinematic-config";
import { hero } from "./content";
import { createVideoScrubber } from "./cinematic-scrub";
import { anchorTimeline, motionAllowed, regionAt, sectionTimeline, timelineAt, type TimelinePoint } from "./fullpage-scroll";
import "./fullpage-coverage.css";
import { loadClip } from "./fullpage-media";
import { INITIAL_ANCHOR_EVENT } from "./fullpage-anchor";

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

export default function CinematicWorld({ reducedMotion }: { reducedMotion: boolean }) {
  const mobile = useMobileStill();
  const preview = new URLSearchParams(window.location.search).get("motion") === "preview";
  const [staticView, setStaticView] = useState(false);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [mediaState, setMediaState] = useState<MediaState>("awaiting");
  const [clip, setClip] = useState<{ id: string; url: string } | null>(null);
  const [presented, setPresented] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const localProgress = useRef(0);
  const scrubRef = useRef<ReturnType<typeof createVideoScrubber> | null>(null);
  const activeRef = useRef(true);
  const scene = journey.scenes[0];
  const hasClips = journey.scenes.some((item) => item.clipReady);
  const motion = hasClips && motionAllowed(preview, reducedMotion, mobile, staticView, failed);
  const poster = fullpageRegions[index].poster;
  const clipUrl = clip?.id === scene.id ? clip.url : null;
  const frameVisible = presented && Boolean(clipUrl);

  useEffect(() => { setPosterFailed(false); }, [poster]);
  useEffect(() => {
    let frame: number | null = null;
    let points: TimelinePoint[] = [];
    let lastTime = 0;
    let measured = false;
    const starts = fullpageRegions.map(region => region.start);
    const elements = fullpageRegions.map(region => document.querySelector<HTMLElement>(region.selector));
    if (elements.some(element => !element)) return;
    const measure = (preserve: boolean) => {
      const scroll = window.scrollY;
      const next = sectionTimeline(elements.map(element => element!.getBoundingClientRect().top + scroll), window.innerHeight, document.documentElement.scrollHeight, starts);
      points = preserve && measured ? anchorTimeline(next, scroll, lastTime) : next;
      measured = true;
    };
    const update = () => {
      frame = null;
      lastTime = timelineAt(points, window.scrollY);
      localProgress.current = lastTime / Math.max(.001, journey.scenes[0].durationSeconds - 1 / 30);
      setIndex(regionAt(lastTime, starts));
      sectionRef.current?.setAttribute("data-timeline-seconds", lastTime.toFixed(4));
      scrubRef.current?.setProgress(localProgress.current);
    };
    const schedule = () => { if (frame === null && !document.hidden) frame = requestAnimationFrame(update); };
    const resize = () => { measure(true); schedule(); };
    // Initial fragment positioning is navigation, not a disclosure resize.
    const initialAnchor = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      measure(false);
      update();
    };
    const visibility = () => {
      activeRef.current = !document.hidden;
      scrubRef.current?.setEnabled(activeRef.current);
      if (activeRef.current) schedule();
      else if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    };
    measure(false);
    update(); // Deep links use current document position before the clip decodes.
    const observer = new ResizeObserver(resize);
    elements.forEach(element => observer.observe(element!));
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", resize);
    window.addEventListener(INITIAL_ANCHOR_EVENT, initialAnchor);
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resize);
      window.removeEventListener(INITIAL_ANCHOR_EVENT, initialAnchor);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    setClip(null);
    setPresented(false);
    if (!motion || !scene.clipReady) { if (!failed) setMediaState("awaiting"); return; }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setMediaState("loading");
    loadClip(scene.clip, controller.signal, journey.maxClipBytes).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setClip({ id: scene.id, url: objectUrl });
    }).catch(() => { if (!controller.signal.aborted) { setMediaState("error"); setFailed(true); } });
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
    scrub.setEnabled(activeRef.current);
    let valid = false;
    let framePresented = false;
    let callback: number | null = null;
    let revealFrame: number | null = null;
    const fail = () => {
      valid = false;
      scrub.setEnabled(false);
      if (scrubRef.current === scrub) { scrubRef.current = null; }
      setPresented(false);
      setMediaState("error");
      setFailed(true);
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
      if (scrubRef.current === scrub) { scrubRef.current = null; }
      if (callback !== null) video.cancelVideoFrameCallback(callback);
      if (revealFrame !== null) cancelAnimationFrame(revealFrame);
      video.removeEventListener("loadedmetadata", metadata);
      video.removeEventListener("loadeddata", decoded);
      video.removeEventListener("seeked", seekComplete);
      video.removeEventListener("error", fail);
    };
  }, [clipUrl, motion, scene.id]);

  const status = failed ? "Animation unavailable. The workshop image remains visible." : !motion
    ? reducedMotion ? "Still view follows your reduced-motion preference." : staticView ? "Still view. Motion is off." : null
    : mediaState === "error" ? "Animation unavailable. The workshop image remains visible."
      : mediaState === "loading" || mediaState === "decoded" ? "Loading the animation. The workshop image remains visible."
        : mediaState === "ready" ? "Scroll to move through the workshop." : null;

  return (
    <section ref={sectionRef} data-scene={scene.id} data-coverage-region={fullpageRegions[index].id} data-media-state={mediaState} className={`cinematic-world ${motion ? "cinematic-scroll" : "cinematic-static"}`} aria-labelledby="hero-title">
      <div className="cinematic-stage">
        <div className="cinematic-media fullpage-media" data-region={fullpageRegions[index].id} aria-hidden="true">
          {!posterFailed && <img key={poster} src={poster} alt="" onError={() => setPosterFailed(true)} className={frameVisible ? "cinematic-poster presented" : "cinematic-poster"} />}
          {clipUrl && motion && <video key={clipUrl} ref={videoRef} src={clipUrl} muted playsInline preload="auto" tabIndex={-1} className={frameVisible ? "cinematic-video presented" : "cinematic-video"} />}
        </div>
        <div className="cinematic-scrim" />
        <div className="cinematic-copy">
          <p className="eyebrow">{hero.Eyebrow}</p>
          <h1 id="hero-title">Grow your capabilities with <em>Bowerloom</em></h1>
          <p className="cinematic-description">{hero.Body}</p>
          <a className="button primary" href="#build">Build with your agent</a>
          <a className="hero-secondary" href="#recipe">Explore the Labs workflow</a>
        </div>
        <div className="cinematic-bottom">
          <div className="cinematic-illustration-note">
            <p className="cinematic-label">{motion ? "Illustrated preview · one 8-second scene across this page" : "Workshop illustration"}</p>
            <p className="cinematic-image-caption">{posterFailed ? "Workshop image unavailable. Continue to the workflow." : scene.label}</p>
            <p className="cinematic-image-caption">{journey.illustrationNote}</p>
            <p className="cinematic-approval-note">{journey.approvalNote}</p>
            {status && <p className="cinematic-media-status">{status}</p>}
          </div>
          <div className="cinematic-actions">
            {preview && hasClips && !mobile && !reducedMotion && !failed && <button className="motion-toggle" aria-pressed={staticView} onClick={() => setStaticView(!staticView)}>{staticView ? "Use motion view" : "Use still view"}</button>}
            <a href="#recipe">Go to the workflow</a>
          </div>
        </div>
      </div>
    </section>
  );
}
