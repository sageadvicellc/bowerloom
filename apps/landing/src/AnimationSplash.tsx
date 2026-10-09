import { useEffect, useRef, useState } from 'react';
import { cinematicJourney, splashRestingFrame } from './cinematic-config';
import { createSplashPlayback, splashVideoAllowed, type SplashState } from './splash-playback';
import './splash.css';

export default function AnimationSplash({ reducedMotion, onEnter }: { reducedMotion: boolean; onEnter: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const playback = useRef<ReturnType<typeof createSplashPlayback> | null>(null);
  const [requested, setRequested] = useState(false);
  const [state, setState] = useState<SplashState>('loading');
  const [failed, setFailed] = useState(false);
  const showVideo = splashVideoAllowed(reducedMotion, requested, failed);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element?.close(); document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => {
    if (!video.current || !showVideo) return;
    const media = video.current;
    if (!media.getAttribute('src')) media.src = cinematicJourney.scenes[0].clip;
    const controller = createSplashPlayback(media, document, next => {
      setState(next);
      if (next === 'error') setFailed(true);
    });
    playback.current = controller;
    void controller.play();
    return () => {
      controller.dispose(); playback.current = null;
      media.removeAttribute('src'); media.load();
    };
  }, [showVideo]);
  const play = () => {
    if (state === 'ended' && video.current) { video.current.currentTime = 0; setState('loading'); }
    if (!showVideo) { setRequested(true); setFailed(false); }
    else void playback.current?.play();
  };
  return <dialog className="animation-splash" ref={dialog} aria-labelledby="splash-title" onCancel={event => { event.preventDefault(); onEnter(); }}>
    <div className="splash-heading"><div><img className="splash-wordmark" src="/brand/rose-conservatory/bowerloom-wordmark-plain-cream.svg" alt="Bowerloom" /><p id="splash-title">A moment in the workshop</p></div><button autoFocus type="button" className="splash-play" onClick={onEnter}>Skip animation</button></div>
    <div className="splash-frame">
      {showVideo ? <video ref={video} style={state === 'ended' ? { display: 'none' } : undefined} src={cinematicJourney.scenes[0].clip} poster={cinematicJourney.openingPoster} muted playsInline preload="auto" aria-label="Hanna and robot helpers in a forest workshop" /> : <img src={cinematicJourney.openingPoster} alt="Hanna and a robot helper review a plan in a forest workshop." />}
      {showVideo && state === 'ended' && <img className="splash-resting-poster" src={splashRestingFrame.poster} alt="Hanna, S4-G3, and H4N-N4 together at the forest workshop." />}
    </div>
    <div className="splash-controls">
      <button type="button" className="button primary" onClick={onEnter}>Enter site <span aria-hidden="true">↗</span></button>
      <button type="button" className="splash-play" onClick={state === 'playing' ? () => playback.current?.pause() : play}>{state === 'playing' ? 'Pause animation' : state === 'ended' ? 'Replay animation' : 'Play animation'}</button>
      <p role="status">{failed ? 'Animation unavailable. You can enter the site now.' : reducedMotion && !requested ? 'Still view follows your reduced-motion preference.' : state === 'blocked' ? 'Your browser paused autoplay. Choose Play animation or Enter site.' : state === 'ended' ? 'You can replay this eight-second illustration or enter the site.' : 'You can enter the site at any time.'}</p>
    </div>
    <p className="splash-boundary">An illustrated visit to Bowerloom Labs.</p>
  </dialog>;
}
