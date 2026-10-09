/** Load one bounded, seekable clip. A blob avoids relying on a host's range support. */
export async function loadClip(path: string, signal: AbortSignal, maxBytes: number) {
  const response = await fetch(path, { signal });
  if (!response.ok || !response.headers.get("content-type")?.includes("video/mp4")) throw new Error("Clip unavailable");
  if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Clip exceeds the media budget");
  if (!response.body) throw new Error("Clip cannot be loaded");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("Clip exceeds the media budget");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return new Blob(chunks, { type: "video/mp4" });
}

