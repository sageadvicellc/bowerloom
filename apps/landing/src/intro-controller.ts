import type { IntroMedia } from './intro-media.ts';
export type IntroStatus = 'loading' | 'playing' | 'paused' | 'blocked' | 'complete' | 'failure' | 'timeout' | 'reduced-motion' | 'entering';
export type IntroFrame = { time: number; phase: 'film' | 'logo' | 'hold'; logo: number };
export type IntroExit = 'enter' | 'skip';
export type IntroHold = 'complete' | 'failure' | 'timeout' | 'reduced-motion';
export type IntroEntryFrame = { phase: 'cover' | 'uncover'; opacity: number };
type Media = Pick<HTMLVideoElement, 'currentTime' | 'playbackRate' | 'duration' | 'videoWidth' | 'videoHeight' | 'readyState' | 'paused' | 'ended' | 'muted' | 'volume' | 'play' | 'pause' | 'addEventListener' | 'removeEventListener'>;
type Visibility = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
export type IntroClock = { now: () => number; request: (callback: () => void) => number; cancel: (id: number) => void; after: (callback: () => void, ms: number) => number; clear: (id: number) => void };
const owners = new WeakMap<object, symbol>();
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
export function introPlaybackRate(time: number, media: Pick<IntroMedia, 'audio' | 'ending'>): number {
  const ending = media.ending;
  if (!ending || media.audio !== 'silent' || !Number.isFinite(time)) return 1;
  return 1 - (1 - ending.rate) * ease((time - ending.slowAt) / (ending.settleAt - ending.slowAt));
}
/** revealAt is the historical cue name. It now starts a logo hold, never site entry. */
export function introFrame(time: number, media: Pick<IntroMedia, 'duration' | 'logoAt' | 'revealAt' | 'ending'>): IntroFrame {
  const bounded = Math.max(0, Math.min(media.duration, Number.isFinite(time) ? time : 0));
  return { time: bounded, phase: bounded >= media.revealAt ? 'hold' : bounded >= media.logoAt ? 'logo' : 'film', logo: ease((bounded - media.logoAt) / (media.ending?.logoSeconds ?? .8)) };
}
export function createIntroController(video: Media, visibility: Visibility, media: IntroMedia, clock: IntroClock, callbacks: {
  frame: (frame: IntroFrame) => void; status: (status: IntroStatus) => void; entry: (frame: IntroEntryFrame) => void; exit: (reason: IntroExit) => void;
}) {
  const owner = Symbol('intro'); owners.set(video, owner);
  let closed = false, held = false, entering = false, desired = false, resume = false, request = 0, sound = false;
  let raf: number | null = null, timer: number | null = null;
  let lastTime = video.currentTime, deadline = clock.now() + 8000, remaining = 8000;
  const isOwner = () => owners.get(video) === owner;
  const stopScheduling = () => {
    if (raf !== null) clock.cancel(raf); raf = null;
    if (timer !== null) clock.clear(timer); timer = null;
  };
  const silence = () => { if (isOwner()) { video.pause(); video.muted = true; video.volume = 0; } };
  const remove = (keepVisibility = false) => {
    video.removeEventListener('ended', ended); video.removeEventListener('error', failed);
    video.removeEventListener('loadedmetadata', metadata); video.removeEventListener('pause', unexpectedPause);
    if (!keepVisibility) visibility.removeEventListener('visibilitychange', changed);
  };
  const hold = (reason: IntroHold) => {
    if (closed || entering || !isOwner()) return;
    held = true; desired = false; resume = false; request++;
    stopScheduling(); silence(); remove();
    callbacks.frame(reason === 'complete' ? introFrame(media.duration, media) : { time: 0, phase: 'hold', logo: 1 });
    callbacks.status(reason);
  };
  const validate = () => video.readyState < 1 || (Number.isFinite(video.duration) && Math.abs(video.duration - media.duration) < .15 && video.videoWidth === media.width && video.videoHeight === media.height);
  const tick = () => {
    raf = null;
    if (closed || held || entering || !desired || visibility.hidden || !isOwner()) return;
    if (!validate()) { hold('failure'); return; }
    if (video.currentTime > lastTime + .001) { lastTime = video.currentTime; deadline = clock.now() + 8000; }
    video.playbackRate = introPlaybackRate(video.currentTime, media);
    callbacks.frame(introFrame(video.currentTime, media));
    // Missing ended can settle on a near-final decoded frame; it never enters the site.
    if (video.ended || (video.currentTime >= media.duration - .06 && clock.now() - (deadline - 8000) >= 250)) { hold('complete'); return; }
    raf = clock.request(tick);
  };
  const watchdog = () => {
    timer = null;
    if (closed || held || entering || !desired || visibility.hidden) return;
    if (clock.now() >= deadline) { hold('timeout'); return; }
    timer = clock.after(watchdog, Math.min(250, deadline - clock.now()));
  };
  const schedule = () => {
    if (raf === null) raf = clock.request(tick);
    if (timer === null) timer = clock.after(watchdog, 250);
  };
  const play = async () => {
    if (closed || held || entering || !isOwner()) return;
    desired = true;
    if (visibility.hidden) { resume = true; return; }
    const current = ++request;
    deadline = clock.now() + remaining;
    video.playbackRate = introPlaybackRate(video.currentTime, media);
    video.muted = !sound; video.volume = sound ? 1 : 0;
    callbacks.status('loading'); schedule();
    try {
      await video.play();
      if (!isOwner()) return;
      if (closed || held || entering || visibility.hidden || !desired) { silence(); return; }
      if (current === request) callbacks.status('playing');
    } catch {
      if (!closed && !held && !entering && isOwner() && current === request) {
        desired = false; resume = false; stopScheduling(); silence(); callbacks.status('blocked');
      }
    }
  };
  const pause = () => {
    if (closed || held || entering || !isOwner()) return;
    request++; desired = false; resume = false; remaining = Math.max(1, deadline - clock.now());
    stopScheduling(); video.pause(); callbacks.status('paused');
  };
  const changed = () => {
    if (closed || !isOwner()) return;
    // RAF can stop in a hidden tab. Silence entry immediately rather than waiting for its white frame.
    if (entering) { if (visibility.hidden) silence(); return; }
    if (held) return;
    if (visibility.hidden) {
      resume = desired; remaining = Math.max(1, deadline - clock.now()); request++;
      stopScheduling(); video.pause();
    } else if (resume) { resume = false; void play(); }
  };
  const unexpectedPause = () => {
    if (closed || held || entering || !desired || visibility.hidden || video.ended || !video.paused || !isOwner()) return;
    request++; desired = false; resume = false; remaining = 8000;
    stopScheduling(); callbacks.status('blocked');
  };
  const ended = () => hold(validate() && video.currentTime >= media.duration - .15 ? 'complete' : 'failure');
  const failed = () => hold('failure');
  const metadata = () => { if (!validate()) hold('failure'); };
  const enter = (reason: IntroExit = 'enter', reducedMotion = false) => {
    if (closed || entering || !isOwner()) return;
    entering = true; desired = false; resume = false; request++;
    stopScheduling(); remove(true); callbacks.status('entering');
    const complete = () => { closed = true; stopScheduling(); silence(); remove(); callbacks.exit(reason); };
    if (reducedMotion) { callbacks.entry({ phase: 'uncover', opacity: 0 }); complete(); return; }
    let phase: 'cover' | 'uncover' = 'cover', started = clock.now();
    const initialVolume = video.muted ? 0 : video.volume;
    callbacks.entry({ phase, opacity: 0 });
    const fade = () => {
      raf = null;
      if (closed || !isOwner()) return;
      const progress = clamp((clock.now() - started) / (phase === 'cover' ? 350 : 450));
      if (phase === 'cover') {
        video.volume = initialVolume * (1 - progress);
        callbacks.entry({ phase, opacity: progress });
        if (progress === 1) {
          silence(); phase = 'uncover'; started = clock.now();
          // Swap to the site only while fully white. The next frame starts the fade out.
          callbacks.entry({ phase, opacity: 1 });
        }
      } else {
        callbacks.entry({ phase, opacity: 1 - progress });
        if (progress === 1) { complete(); return; }
      }
      raf = clock.request(fade);
    };
    raf = clock.request(fade);
  };
  video.playbackRate = 1; video.muted = true; video.volume = 0;
  video.addEventListener('ended', ended); video.addEventListener('error', failed);
  video.addEventListener('loadedmetadata', metadata); video.addEventListener('pause', unexpectedPause); visibility.addEventListener('visibilitychange', changed);
  return { play, pause, hold, enter, setSound(enabled: boolean) {
    if (closed || held || entering || !isOwner()) return;
    sound = enabled; video.muted = !enabled; video.volume = enabled ? 1 : 0;
  }, dispose() {
    if (!closed) { closed = true; desired = false; resume = false; request++; stopScheduling(); silence(); remove(); }
    if (isOwner()) video.playbackRate = 1;
    // Late play promises retain ownership until replaced, so they cannot restart disposed media.
  } };
}
