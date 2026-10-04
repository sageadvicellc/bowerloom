import { useEffect, useRef, useState } from 'react';
import { createIntroController, introFrame, type IntroExit, type IntroStatus } from './intro-controller';
import type { IntroMedia } from './intro-media';
import './intro.css';

export default function CinematicIntro({ media, reducedMotion, explicitReplay, onEnter }: {
  media: IntroMedia; reducedMotion: boolean; explicitReplay: boolean; onEnter: (reason: IntroExit) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), video = useRef<HTMLVideoElement>(null);
  const controller = useRef<ReturnType<typeof createIntroController> | null>(null);
  const enter = useRef(onEnter); enter.current = onEnter;
  const [status, setStatus] = useState<IntroStatus>('loading');
  const [frame, setFrame] = useState(() => introFrame(0, media));
  const [sound, setSound] = useState(false);
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    const resized = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);
  const mismatch = (media.height > media.width) !== portrait;
  const reducedRef = useRef(reducedMotion); reducedRef.current = reducedMotion;
  useEffect(() => {
    if (reducedMotion && !explicitReplay) controller.current?.finish('reduced-motion');
  }, [reducedMotion, explicitReplay]);
  useEffect(() => {
    if (reducedRef.current && !explicitReplay) { enter.current('reduced-motion'); return; }
    const element = dialog.current, picture = video.current;
    if (!element || !picture) return;
    element.showModal();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    picture.src = media.src;
    const active = createIntroController(picture, document, media, {
      now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id),
      after: (callback, milliseconds) => window.setTimeout(callback, milliseconds), clear: id => clearTimeout(id),
    }, { frame: setFrame, status: setStatus, exit: reason => enter.current(reason) });
    controller.current = active;
    void active.play();
    return () => {
      active.dispose(); controller.current = null; picture.removeAttribute('src'); picture.load();
      element.close(); document.body.style.overflow = overflow;
    };
  }, [media, explicitReplay]);
  const skip = () => controller.current?.finish('skip');
  const toggleSound = () => { const next = !sound; controller.current?.setSound(next); setSound(next); };
  return <dialog className={`cinematic-intro ${media.kind === 'fixture' ? 'intro-fixture' : ''} ${mismatch ? 'intro-orientation-mismatch' : ''}`} ref={dialog}
    aria-label="Bowerloom introduction" data-phase={frame.phase} data-playback={status} data-time={frame.time.toFixed(3)}
    onCancel={event => { event.preventDefault(); skip(); }}>
    <div className="intro-picture" style={{ transform: reducedMotion ? 'none' : `translateY(${-100 * frame.reveal}%)` }}>
    <video ref={video} poster={media.poster} muted playsInline preload="auto" aria-hidden="true" tabIndex={-1} />
    <img className="intro-logo" src="/brand/rose-conservatory/bowerloom-wordmark-plain-cream.svg" alt="Bowerloom"
      style={{ opacity: frame.logo, transform: `translateY(${(1 - frame.logo) * 14}px) scale(${.96 + .04 * frame.logo})` }} />
    </div>
    {media.kind === 'fixture' && <p className="intro-fixture-label">Engineering fixture · test pattern and tone · final film pending</p>}
    <div className="intro-controls">
      {media.audio === 'embedded' && <button type="button" className="intro-sound" aria-label={sound ? 'Mute sound' : 'Enable sound'} aria-pressed={sound} onClick={toggleSound}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z" />{sound ? <path d="M16 8c3 2 3 6 0 8M19 5c5 4 5 10 0 14" /> : <path d="m17 9 5 6m0-6-5 6" />}</svg>
      </button>}
      {(status === 'blocked' || status === 'paused') && <button type="button" onClick={() => void controller.current?.play()}>Play</button>}
      {status === 'playing' && <button type="button" className="intro-pause" onClick={() => controller.current?.pause()}>Pause</button>}
      <button type="button" autoFocus onClick={skip}>Skip</button>
    </div>
    <span className="sr-only" role="status">{status === 'blocked' ? 'Playback needs your action. Choose Play or Skip.' : 'Skip is available at any time.'}</span>
  </dialog>;
}
