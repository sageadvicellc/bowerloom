/** Robot walk-on splash. The page never waits for it, and nothing in it can take focus. */
export type SplashTheme = 'light' | 'dark';
export type SplashMedia = { video: string; poster: string };
export type SplashDelivery = { status: 'awaiting-media' | 'ready'; light: SplashMedia; dark: SplashMedia };

/** Set status to 'ready' only after all four files are in public/splash. Until then no splash renders. */
export const splashDelivery: SplashDelivery = {
  status: 'awaiting-media',
  light: { video: '/splash/splash-light.mp4', poster: '/splash/splash-light-poster.jpg' },
  dark: { video: '/splash/splash-dark.mp4', poster: '/splash/splash-dark-poster.jpg' },
};

export const SPLASH_SEEN_KEY = 'bowerloom.splash.seen.v1';

/** startMs: first frame deadline. capMs: hard stop for a stalled clip. fadeMs: normal dissolve. quickFadeMs: failure or input. */
export const splashTiming = { startMs: 1500, capMs: 7000, fadeMs: 600, quickFadeMs: 200 } as const;

export function splashMediaFor(theme: SplashTheme, delivery: SplashDelivery = splashDelivery): SplashMedia | null {
  return delivery.status === 'ready' ? delivery[theme] : null;
}

export function shouldShowThemeSplash(options: {
  hash: string; reducedMotion: boolean; storage: Pick<Storage, 'getItem'> | null; delivery?: SplashDelivery;
}): boolean {
  if (options.reducedMotion || options.hash.length > 1) return false;
  if ((options.delivery ?? splashDelivery).status !== 'ready') return false;
  try { return options.storage?.getItem(SPLASH_SEEN_KEY) !== 'seen'; }
  catch { return true; }
}

export function rememberThemeSplash(storage: Pick<Storage, 'setItem'> | null) {
  try { storage?.setItem(SPLASH_SEEN_KEY, 'seen'); } catch { /* A blocked storage area shows the splash again. That is the safe failure. */ }
}

export type SplashExit = 'ended' | 'cap' | 'stalled' | 'error' | 'blocked' | 'input' | 'key';
type SplashVideo = Pick<HTMLVideoElement, 'play' | 'addEventListener' | 'removeEventListener'>;
type SplashClock = { after: (callback: () => void, milliseconds: number) => number; clear: (id: number) => void };

/** The clip ending or the hard cap use the full dissolve. Failures and taps fade at once. A key press cuts with no fade. */
export function splashFadeFor(reason: SplashExit, timing = splashTiming) {
  if (reason === 'key') return 0;
  return reason === 'ended' || reason === 'cap' ? timing.fadeMs : timing.quickFadeMs;
}

export function createSplashRun(video: SplashVideo, clock: SplashClock, events: {
  started: () => void; finish: (reason: SplashExit) => void;
}, timing = splashTiming) {
  let done = false, started = false;
  const timers: number[] = [];
  const finish = (reason: SplashExit) => {
    if (done) return;
    done = true; cleanup();
    events.finish(reason);
  };
  const playing = () => {
    if (done || started) return;
    started = true;
    events.started();
  };
  const ended = () => finish('ended');
  const error = () => finish('error');
  function cleanup() {
    timers.forEach(clock.clear);
    video.removeEventListener('playing', playing);
    video.removeEventListener('ended', ended);
    video.removeEventListener('error', error);
  }
  video.addEventListener('playing', playing);
  video.addEventListener('ended', ended);
  video.addEventListener('error', error);
  timers.push(clock.after(() => { if (!started) finish('stalled'); }, timing.startMs));
  timers.push(clock.after(() => finish('cap'), timing.capMs));
  void Promise.resolve().then(() => done ? undefined : video.play()).catch(() => finish('blocked'));
  return {
    skip: (keyboard = false) => finish(keyboard ? 'key' : 'input'),
    dispose: () => { done = true; cleanup(); },
  };
}
