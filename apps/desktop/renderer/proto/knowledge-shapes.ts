/**
 * The mark of each domain folder on the Knowledge graph: a shape, as well as a colour. Eight colours cannot be told apart by everyone,
 * and a dimmed page loses most of its colour, so the shape and the folder name carry the meaning too. The graph draws a page in its
 * domain's shape, a label pill leads with it, and the key under the graph shows it. One list, so the three always agree.
 * Points are on a circle of radius 1, centred on 0, and an empty list is a circle.
 */
export type ShapePoints = readonly (readonly [number, number])[];

const regular = (sides: number, turn: number): ShapePoints => Array.from({ length: sides }, (_, i) => {
  const a = turn + (2 * Math.PI * i) / sides;
  return [Math.cos(a), Math.sin(a)] as const;
});
const star = (tips: number, inner: number): ShapePoints => Array.from({ length: tips * 2 }, (_, i) => {
  const a = -Math.PI / 2 + (Math.PI * i) / tips, r = i % 2 === 0 ? 1.15 : inner;
  return [r * Math.cos(a), r * Math.sin(a)] as const;
});

/** In the order of the domains, which is the order of the eight graph colours. */
export const DOMAIN_SHAPES: readonly { readonly name: string; readonly points: ShapePoints }[] = [
  { name: 'circle', points: [] },
  { name: 'square', points: regular(4, Math.PI / 4).map(([x, y]) => [x * 0.92, y * 0.92] as const) },
  { name: 'triangle', points: regular(3, -Math.PI / 2).map(([x, y]) => [x * 1.15, y * 1.15 + 0.1] as const) },
  { name: 'diamond', points: regular(4, 0).map(([x, y]) => [x * 1.2, y * 1.2] as const) },
  { name: 'hexagon', points: regular(6, 0) },
  { name: 'down triangle', points: regular(3, Math.PI / 2).map(([x, y]) => [x * 1.15, y * 1.15 - 0.1] as const) },
  { name: 'pentagon', points: regular(5, -Math.PI / 2) },
  { name: 'star', points: star(4, 0.5) },
];

export const shapeOf = (domain: number): { readonly name: string; readonly points: ShapePoints } => DOMAIN_SHAPES[((domain % DOMAIN_SHAPES.length) + DOMAIN_SHAPES.length) % DOMAIN_SHAPES.length]!;

/** Adds the shape to a canvas path, centred on (x, y), with radius r. */
export function traceShape(ctx: Pick<CanvasRenderingContext2D, 'beginPath' | 'arc' | 'moveTo' | 'lineTo' | 'closePath'>, domain: number, x: number, y: number, r: number): void {
  const points = shapeOf(domain).points;
  ctx.beginPath();
  if (points.length === 0) { ctx.arc(x, y, r, 0, 2 * Math.PI); return; }
  points.forEach(([px, py], i) => { if (i === 0) ctx.moveTo(x + px * r, y + py * r); else ctx.lineTo(x + px * r, y + py * r); });
  ctx.closePath();
}

/** The same shape as an SVG path in a box from -1.3 to 1.3, for the key under the graph. */
export function shapePath(domain: number): string {
  const points = shapeOf(domain).points;
  if (points.length === 0) return 'M -1 0 A 1 1 0 1 0 1 0 A 1 1 0 1 0 -1 0 Z';
  return `${points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`).join(' ')} Z`;
}
