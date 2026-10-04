export type IntroMedia = {
  kind: 'production' | 'fixture';
  src: string; poster: string; sha256: string; bytes: number;
  width: number; height: number; duration: number; logoAt: number; revealAt: number;
  audio: 'embedded' | 'silent';
};
/** Brand must supply revision-bound desktop and portrait exports before this gate opens. */
export const introDelivery: { status: 'awaiting-media' | 'ready'; desktop: IntroMedia | null; portrait: IntroMedia | null } = {
  status: 'awaiting-media', desktop: null, portrait: null,
};
/** Technical patterns and test tone, admitted only by ?intro=fixture. Never final media. */
export const introFixtures: Record<'desktop' | 'portrait', IntroMedia> = {
  "desktop": {
    "kind": "fixture",
    "src": "/_diagnostics/intro/landscape.mp4",
    "poster": "/_diagnostics/intro/poster.svg",
    "sha256": "94dcb08bb683ec13ba01b1e959e82518466676e68b6ff2de028749dd7f934362",
    "bytes": 475662,
    "width": 1280,
    "height": 720,
    "duration": 23,
    "logoAt": 20,
    "revealAt": 22.2,
    "audio": "embedded"
  },
  "portrait": {
    "kind": "fixture",
    "src": "/_diagnostics/intro/portrait.mp4",
    "poster": "/_diagnostics/intro/poster.svg",
    "sha256": "875e6beeb02f780edaf243808f9318d3dd661434635bce9c37feb2728426fc48",
    "bytes": 423397,
    "width": 720,
    "height": 1280,
    "duration": 23,
    "logoAt": 20,
    "revealAt": 22.2,
    "audio": "embedded"
  }
};
export function selectIntroMedia(fixture: boolean, portrait: boolean): IntroMedia | null {
  if (fixture) return introFixtures[portrait ? 'portrait' : 'desktop'];
  if (introDelivery.status !== 'ready') return null;
  if (!validProductionMedia(introDelivery.desktop, false) || !validProductionMedia(introDelivery.portrait, true)) return null;
  return portrait ? introDelivery.portrait : introDelivery.desktop;
}

export function validProductionMedia(media: IntroMedia | null, portrait: boolean): media is IntroMedia {
  return Boolean(media && media.kind === 'production' && media.src.startsWith('/intro/') && media.poster.startsWith('/intro/')
    && /^[a-f0-9]{64}$/.test(media.sha256) && media.bytes > 0 && media.bytes <= 16 * 1024 * 1024
    && media.width === (portrait ? 1080 : 1920) && media.height === (portrait ? 1920 : 1080)
    && media.duration === 23 && media.logoAt === 20 && media.revealAt === 22.2 && media.audio === 'embedded');
}
