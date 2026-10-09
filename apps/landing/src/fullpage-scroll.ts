/** A monotone timeline, measured from real document sections rather than page percentages. */
export type TimelinePoint = { scroll: number; time: number };
export function timelineAt(points: readonly TimelinePoint[], scroll: number): number {
  if (!points.length) return 0;
  if (scroll <= points[0]!.scroll) return points[0]!.time;
  for (let i = 1; i < points.length; i++) {
    if (scroll <= points[i]!.scroll) {
      const left = points[i - 1]!, right = points[i]!;
      const fraction = Math.max(0, Math.min(1, (scroll - left.scroll) / Math.max(1, right.scroll - left.scroll)));
      return left.time + fraction * (right.time - left.time);
    }
  }
  return points.at(-1)!.time;
}

export function sectionTimeline(tops: readonly number[], viewport: number, documentHeight: number, starts: readonly number[], end = 8): TimelinePoint[] {
  if (!tops.length || tops.length !== starts.length) throw new Error("Each page section requires a timeline start");
  const maxScroll = Math.max(1, documentHeight - viewport);
  // Reserve reachable space for the short footer, even when it is shorter than the viewport.
  const points = tops.map((top, index) => ({ scroll: index === 0 ? 0 : Math.max(0, top - viewport * .35), time: starts[index]! }));
  for (let index = points.length - 1; index > 0; index--) {
    points[index]!.scroll = Math.min(points[index]!.scroll, maxScroll - (points.length - index));
  }
  for (let index = 1; index < points.length; index++) points[index]!.scroll = Math.max(points[index - 1]!.scroll + 1, points[index]!.scroll);
  return [...points, { scroll: maxScroll, time: end }];
}

/** Keep the current visual frame on layout changes, while retaining monotone endpoints. */
export function anchorTimeline(points: readonly TimelinePoint[], scroll: number, time: number): TimelinePoint[] {
  if (!points.length) return [];
  if (scroll <= points[0]!.scroll || scroll >= points.at(-1)!.scroll) return [...points];
  const left = points.filter(point => point.scroll < scroll && point.time < time);
  const right = points.filter(point => point.scroll > scroll && point.time > time);
  return [...left, { scroll, time }, ...right];
}

export function regionAt(time: number, starts: readonly number[]) {
  let index = 0;
  for (let next = 1; next < starts.length; next++) if (time >= starts[next]!) index = next;
  return index;
}

export function motionAllowed(preview: boolean, reduced: boolean, narrowOrCoarse: boolean, manualStill: boolean, failed: boolean) {
  return preview && !reduced && !narrowOrCoarse && !manualStill && !failed;
}
