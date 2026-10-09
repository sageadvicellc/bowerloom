type BannerImage = Pick<HTMLImageElement, 'complete' | 'naturalWidth' | 'decode' | 'addEventListener' | 'removeEventListener'>;
/** Observe both cached and newly loaded images. A broken complete image is not a success. */
export function watchBannerImage(image: BannerImage, ready: () => void, failed: () => void): () => void {
  let disposed = false, settled = false, decoding = false;
  const finish = (success: boolean) => {
    if (disposed || settled) return;
    settled = true;
    (success ? ready : failed)();
  };
  const loaded = () => {
    if (disposed || settled || decoding) return;
    if (!image.naturalWidth) { finish(false); return; }
    decoding = true;
    void Promise.resolve().then(() => image.decode()).then(
      () => finish(image.naturalWidth > 0),
      () => finish(false),
    );
  };
  const error = () => finish(false);
  image.addEventListener('load', loaded); image.addEventListener('error', error);
  // Defer cached completion so the caller always receives its disposal function first.
  if (image.complete) queueMicrotask(loaded);
  return () => { disposed = true; image.removeEventListener('load', loaded); image.removeEventListener('error', error); };
}
