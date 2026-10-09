import { useEffect, useRef, useState } from 'react';
import { createSplashRun, splashFadeFor, type SplashMedia, type SplashExit } from './theme-splash';
import './theme-splash.css';

/** Decorative only: aria-hidden, no controls, no focus trap. Any key, tap or wheel ends it early. */
export default function ThemeSplash({ media, onStart, onDone }: {
  media: SplashMedia; onStart: () => void; onDone: (reason: SplashExit) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [leaving, setLeaving] = useState<number | null>(null);
  const startRef = useRef(onStart); startRef.current = onStart;
  const doneRef = useRef(onDone); doneRef.current = onDone;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = true;
    let removal = 0;
    const run = createSplashRun(element, {
      after: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
      clear: id => window.clearTimeout(id),
    }, {
      started: () => startRef.current(),
      finish: reason => {
        const fade = splashFadeFor(reason);
        setLeaving(fade);
        removal = window.setTimeout(() => doneRef.current(reason), fade);
      },
    });
    const skip = (event: Event) => run.skip(event.type === 'keydown');
    const options = { passive: true, capture: true } as const;
    for (const name of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const) window.addEventListener(name, skip, options);
    return () => {
      run.dispose(); window.clearTimeout(removal);
      for (const name of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const) window.removeEventListener(name, skip, options);
      element.pause(); element.removeAttribute('src'); element.load();
    };
  }, [media]);
  return <div className="theme-splash" aria-hidden="true" data-leaving={leaving !== null ? 'true' : undefined}
    style={leaving !== null ? { transitionDuration: `${leaving}ms` } : undefined}>
    <video ref={video} src={media.video} poster={media.poster} muted playsInline preload="auto" tabIndex={-1}
      disablePictureInPicture disableRemotePlayback />
  </div>;
}
