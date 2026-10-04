import test from "node:test";
import assert from "node:assert/strict";
import { createVideoScrubber } from "../src/cinematic-scrub.ts";

function fixture() {
  let callback, seeks = [];
  const video = { duration: 10, seeking: false, readyState: 2,
    get currentTime() { return seeks.at(-1) ?? 0; },
    set currentTime(value) { seeks.push(value); }
  };
  const frames = { request(fn) { callback = fn; return 1; }, cancel() { callback = undefined; } };
  return { video, seeks, scrub: createVideoScrubber(video, frames), flush() { const next = callback; callback = undefined; next?.(); } };
}

test("coalesces rapid input to one latest-target seek", () => {
  const f = fixture();
  f.scrub.setProgress(.1); f.scrub.setProgress(.5); f.scrub.setProgress(.9);
  f.flush();
  assert.equal(f.seeks.length, 1);
  assert.ok(Math.abs(f.seeks[0] - .9 * (10 - 1/30)) < .00001);
});
test("waits for an in-flight decoder and seeks to the newest target afterward", () => {
  const f = fixture(); f.video.seeking = true;
  f.scrub.setProgress(.2); f.flush(); f.scrub.setProgress(.8); f.flush();
  assert.equal(f.seeks.length, 0);
  f.video.seeking = false; f.scrub.decoded(); f.flush();
  assert.ok(f.seeks[0] > 7.9);
});
test("suspension cancels work, resume uses the latest target, disposal stops writes", () => {
  const f = fixture(); f.scrub.setProgress(.2); f.scrub.setEnabled(false); f.flush();
  f.scrub.setProgress(.7); f.flush(); assert.equal(f.seeks.length, 0);
  f.scrub.setEnabled(true); f.flush(); assert.equal(f.seeks.length, 1);
  f.scrub.setProgress(.9); f.scrub.dispose(); f.flush(); assert.equal(f.seeks.length, 1);
});
test("metadata must be finite and ready, endpoint is bounded below duration", () => {
  const f = fixture(); f.video.duration = Infinity; f.scrub.setProgress(1); f.flush();
  assert.equal(f.seeks.length, 0); f.video.duration = 10; f.video.readyState = 1; f.scrub.decoded(); f.flush();
  assert.equal(f.seeks.length, 0); f.video.readyState = 2; f.scrub.decoded(); f.flush();
  assert.ok(f.seeks[0] < 10 && f.seeks[0] > 9.9);
});

test("backscroll during decoding replaces the forward target", () => {
  const f = fixture();
  f.scrub.setProgress(.85); f.flush();
  f.video.seeking = true;
  f.scrub.setProgress(.65); f.scrub.setProgress(.2); f.flush();
  assert.equal(f.seeks.length, 1);
  f.video.seeking = false; f.scrub.decoded(); f.flush();
  assert.equal(f.seeks.length, 2);
  assert.ok(f.seeks[1] < f.seeks[0]);
  assert.ok(Math.abs(f.seeks[1] - .2 * (10 - 1 / 30)) < .00001);
});


test("active preview contains only the exact approved eight-second lab scene", async () => {
  const { cinematicJourney: journey, historicalCinematicJourney } = await import("../src/cinematic-config.ts");
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  assert.equal(journey.scenes.length, 1);
  assert.equal(journey.scenes[0].id, "lab-robots-03");
  assert.equal(journey.scenes[0].durationSeconds, 8.04);
  assert.equal(journey.maxClipSeconds, 8.1);
  assert.equal(historicalCinematicJourney.scenes.length, 6);
  assert.ok(journey.scenes.every(scene => !scene.clip.startsWith("/scroll-world/")));
  const clip = await readFile(new URL("../public" + journey.scenes[0].clip, import.meta.url));
  const poster = await readFile(new URL("../public" + journey.openingPoster, import.meta.url));
  assert.equal(createHash("sha256").update(clip).digest("hex"), "b7e80159d0d1a38bcf66c67ee82a5a3f1fcea34e24e166325e43d7db2215798b");
  assert.equal(createHash("sha256").update(poster).digest("hex"), "d2cafbb6dac90981244f0f1f893cb21fac52af98a52bbf392dfeb566c8465505");
  assert.equal(journey.illustrationNote, "This illustrated preview represents an intended workflow. It does not establish software behavior, benchmark results, or a winning model.");
  assert.equal(journey.approvalNote, "Review the exact plan. Approve only the actions you choose.");
});

test("scrolling the approved clip does not loop or stretch its playback range", () => {
  const f = fixture(); f.video.duration = 8.04;
  f.scrub.setProgress(0.5); f.flush(); assert.ok(f.seeks[0] > 3.9 && f.seeks[0] < 4.1);
  f.scrub.setProgress(1); f.flush(); assert.ok(f.seeks[1] > 8 && f.seeks[1] < 8.04);
  f.scrub.setProgress(20); f.flush(); assert.equal(f.seeks.length, 2);
  f.scrub.setProgress(0); f.flush(); assert.equal(f.seeks.at(-1), 0);
});
