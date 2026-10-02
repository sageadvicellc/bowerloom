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
