/**
 * Intersection tests against wall segments. Shared, because the air and the body must
 * agree about where the walls are — if the plume model used one test and movement used
 * another, the hedge you can smell through would drift from the hedge you cannot walk
 * through, and that gap is the entire game.
 */

import { POROSITY, SCATTER, type Material, type Segment, type Vec2 } from './world';

export type Hit = {
  /** Distance along the ray, in world units. */
  t: number;
  point: Vec2;
  material: Material;
};

export const EPSILON = 1e-4;

/**
 * Nearest intersection of a ray with the world, or null if it escapes.
 *
 * Deliberately blind to porosity: this is the test a *body* uses, and a body is stopped
 * by a hedge exactly as firmly as by a wall.
 */
export function castRay(walls: Segment[], origin: Vec2, dir: Vec2): Hit | null {
  let best: Hit | null = null;

  for (const seg of walls) {
    const sx = seg.b.x - seg.a.x;
    const sy = seg.b.y - seg.a.y;
    const denom = dir.x * sy - dir.y * sx;
    if (Math.abs(denom) < 1e-9) continue; // parallel

    const ox = seg.a.x - origin.x;
    const oy = seg.a.y - origin.y;
    const t = (ox * sy - oy * sx) / denom;
    const u = (ox * dir.y - oy * dir.x) / denom;

    if (t <= EPSILON || u < 0 || u > 1) continue;
    if (best && t >= best.t) continue;

    best = {
      t,
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t },
      material: seg.material,
    };
  }

  return best;
}

export type Passage = {
  /** Fraction of odour surviving the trip, as the product of every barrier crossed. */
  through: number;
  /** Extra plume radius picked up on the way, summed over porous barriers crossed. */
  scatter: number;
};

const CLEAR: Passage = { through: 1, scatter: 0 };

/**
 * What a straight line from `a` to `b` does to odour travelling along it.
 *
 * Used twice and for two different physical reasons. Advecting a puff, it is transport:
 * the share of a filament that makes it through a hedge and how badly the hedge shreds
 * it. Sampling a puff from a nose, it is line of sight: odour that would have to pass
 * through a wall to reach you has not reached you.
 *
 * That second use is why the plume can round a corner even though this cannot. Odour
 * arrives in your room by being *carried* through the doorway and then sitting there in
 * clear air beside you — never by radiating through the bricks.
 */
export function passage(walls: Segment[], a: Vec2, b: Vec2): Passage {
  let through = 1;
  let scatter = 0;

  for (const seg of walls) {
    if (!segmentsCross(a, b, seg.a, seg.b)) continue;
    const p = POROSITY[seg.material];
    if (p <= 0) return { through: 0, scatter: 0 };
    through *= p;
    scatter += SCATTER[seg.material];
  }

  return through === 1 && scatter === 0 ? CLEAR : { through, scatter };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Closest approach of the segment p1->p2 to the point q.
 *
 * The capture test. Checking where a step *lands* is not enough: a three-unit stride
 * can pass clean over something with a two-unit reach and register nothing, so the
 * whole stride has to be measured, not its endpoint.
 */
export function pointToSegment(q: Vec2, p1: Vec2, p2: Vec2): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(q.x - p1.x, q.y - p1.y);

  const t = Math.min(1, Math.max(0, ((q.x - p1.x) * dx + (q.y - p1.y) * dy) / len2));
  return Math.hypot(q.x - (p1.x + t * dx), q.y - (p1.y + t * dy));
}

/** True when the segment p1->p2 crosses q1->q2. */
export function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;

  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return false; // parallel or degenerate

  const dx = q1.x - p1.x;
  const dy = q1.y - p1.y;
  const t = (dx * sy - dy * sx) / denom;
  const u = (dx * ry - dy * rx) / denom;

  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
