import { useEffect, useRef, useState } from 'react';
import { createIntroController, introFrame, type IntroEntryFrame, type IntroExit, type IntroStatus } from './intro-controller';
import type { IntroMedia } from './intro-media';
import './intro.css';

export default function CinematicIntro({ media, reducedMotion, onEnter }: {
  media: IntroMedia; reducedMotion: boolean; onEnter: (reason: IntroExit) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), video = useRef<HTMLVideoElement>(null);
  const controller = useRef<ReturnType<typeof createIntroController> | null>(null);
  const enterCallback = useRef(onEnter); enterCallback.current = onEnter;
  const reducedRef = useRef(reducedMotion); reducedRef.current = reducedMotion;
  const [status, setStatus] = useState<IntroStatus>('loading');
  const [frame, setFrame] = useState(() => introFrame(0, media));
  const [entry, setEntry] = useState<IntroEntryFrame | null>(null);
  const [sound, setSound] = useState(false);
  const [still, setStill] = useState(reducedMotion);
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    const resized = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);
  const mismatch = (media.height > media.width) !== portrait;
  useEffect(() => {
    if (reducedMotion) { controller.current?.hold('reduced-motion'); setSound(false); }
  }, [reducedMotion]);
  useEffect(() => {
    const element = dialog.current, picture = video.current;
    if (!element || !picture) return;
    element.showModal();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const active = createIntroController(picture, document, media, {
      now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id),
      after: (callback, milliseconds) => window.setTimeout(callback, milliseconds), clear: id => clearTimeout(id),
    }, { frame: setFrame, status: next => {
      setStatus(next);
      if (next !== 'entering') setStill(['failure', 'timeout', 'reduced-motion', 'blocked'].includes(next));
    }, entry: setEntry, exit: reason => enterCallback.current(reason) });
    controller.current = active;
    if (reducedRef.current) active.hold('reduced-motion');
    else { picture.src = media.src; void active.play(); }
    return () => {
      active.dispose(); controller.current = null; picture.removeAttribute('src'); picture.load();
      element.close(); document.body.style.overflow = overflow;
    };
  }, [media]);
  const enter = (reason: IntroExit = 'enter') => controller.current?.enter(reason, reducedRef.current);
  const toggleSound = () => { const next = !sound; controller.current?.setSound(next); setSound(next); };
  const fallback = still;
  const settled = fallback || status === 'complete';
  const entering = status === 'entering';
  const message = status === 'complete' ? 'The introduction has ended. Choose Enter when you are ready.'
    : status === 'reduced-motion' ? 'A still introduction is shown. Choose Enter when you are ready.'
    : status === 'failure' || status === 'timeout' ? 'The film is unavailable. A still introduction is shown. Choose Enter when you are ready.'
    : status === 'blocked' ? 'Playback needs your action. Choose Play or Enter.'
    : entering ? 'Entering Bowerloom.' : 'Enter is available at any time.';
  return <dialog className={`cinematic-intro ${media.height > media.width ? 'intro-native-portrait' : ''} ${media.kind === 'fixture' ? 'intro-fixture' : ''} ${mismatch ? 'intro-orientation-mismatch' : ''}`} ref={dialog}
    aria-label="Bowerloom introduction" data-phase={frame.phase} data-entry={entry?.phase} data-playback={status} data-time={frame.time.toFixed(3)}
    onCancel={event => { event.preventDefault(); enter('skip'); }}>
    <div className="intro-picture" aria-hidden={entry?.phase === 'uncover' ? 'true' : undefined}>
      <video ref={video} poster={media.poster} muted playsInline preload="none" aria-hidden="true" tabIndex={-1} />
      {fallback && <img className="intro-still" src={media.poster} alt="" />}
      <div className="intro-sky-shade" aria-hidden="true" style={{ opacity: settled ? 1 : frame.logo }} />
    </div>
    <div className="intro-center">
      <img className="intro-logo" src="/brand/rose-conservatory/bowerloom-wordmark-plain-cream.svg" alt="Bowerloom" width="2044" height="374"
        style={{ opacity: settled ? 1 : frame.logo, filter: reducedMotion || settled ? 'none' : `blur(${8 * (1 - frame.logo)}px)`, transform: reducedMotion || settled ? 'none' : `scale(${.97 + .03 * frame.logo})` }} />
      <button type="button" className="intro-glass intro-enter" autoFocus disabled={entering} aria-label="Enter Bowerloom" title="Enter Bowerloom" onClick={() => enter()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h13m-5-5 5 5-5 5M17 4h4v16h-4" /></svg>
      </button>
    </div>
    {media.kind === 'fixture' && <p className="intro-fixture-label">Engineering fixture · test pattern and tone · not the cinematic film</p>}
    <div className="intro-controls">
      {media.audio === 'embedded' && !settled && <button type="button" className="intro-glass intro-sound" disabled={entering} aria-label={sound ? 'Mute sound' : 'Enable sound'} aria-pressed={sound} onClick={toggleSound}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z" />{sound ? <path d="M16 8c3 2 3 6 0 8M19 5c5 4 5 10 0 14" /> : <path d="m17 9 5 6m0-6-5 6" />}</svg>
      </button>}
      {(status === 'blocked' || status === 'paused') && <button type="button" className="intro-glass" disabled={entering} aria-label="Play" title="Play" onClick={() => void controller.current?.play()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" /></svg></button>}
      {status === 'playing' && <button type="button" className="intro-glass intro-pause" disabled={entering} aria-label="Pause" title="Pause" onClick={() => controller.current?.pause()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg></button>}
      <button type="button" className="intro-glass intro-skip" disabled={entering} onClick={() => enter('skip')}>Skip</button>
    </div>
    <div className="intro-entry-white" aria-hidden="true" style={{ opacity: entry?.opacity ?? 0 }} />
    <span className="sr-only" role="status">{message}</span>
  </dialog>;
}
