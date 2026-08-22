/**
 * Measuring whether a level can actually be followed in. No output and no side effects —
 * `npm run field` reports this over the whole set, and the seed sweep uses the same
 * numbers to pick a plume worth shipping.
 *
 * A room either has a doorway or it does not, and you can see which by looking at it.
 * A plume is different in kind: it is grown by the physics from a seed, and it can
 * perfectly well grow somewhere useless — pinned flat against a wall, threading a gap
 * the level never meant it to, or missing the player's whole corner of the field. None
 * of that is visible in the level file, and from the inside a broken level and a hard
 * one feel exactly alike. The solver cannot catch it either: the solver knows where
 * everything is and walks straight there without smelling anything.
 *
 * So this checks the thing the game actually asks a player to do, which is to work
 * upwind along falling age:
 *
 *   REACH     can a body walk to the quarry at all?
 *   ACQUIRE   is there a contact near where you start, and how strong and how old?
 *   FOLLOW    from that contact, is there a chain of contacts running all the way in,
 *             each younger than the last and each a short walk from the one before?
 *   COVER     what share of the field could pick that chain up from a standing start?
 *
 * "A short walk" is measured by walking, not by ruler. An earlier version of this used
 * straight-line gaps and duly declared every level with a hedge across it broken — the
 * chain has to detour to the gap in the hedge, and a straight line between two contacts
 * either side goes through it. Going round is ordinary play, so the graph is built on
 * distance through open ground.
 *
 * A level that fails is not difficult, it is broken, and the fix is usually one number:
 * the `seed`, which is what decides where the ribbon goes.
 */

import { buildField } from '../src/game/field';
import { pointToSegment, segmentsCross } from '../src/game/geometry';
import { quarryOf, type Level } from '../src/game/levels';
import { sniff, THRESHOLD } from '../src/game/olfaction';
import { windAfter } from '../src/game/run';
import type { Segment, Vec2 } from '../src/game/world';

/** Grid pitch for the sweep, in world units. */
const CELL = 1;

/** Must match `run.ts`: how close a body may stand to a wall. */
const CLEARANCE = 0.35;

/**
 * Furthest a player is assumed to walk on faith between one contact and the next, in
 * world units — four or five steps. Measured along open ground, so a detour round a
 * hedge spends its length like any other walking.
 */
const WALK = 13;


/** Contacts nearer the start than this count as the level handing you the plume. */
const ACQUIRE = 7;

/** Below this share of the field able to pick the plume up, a shifted wind strands you. */
const THIN = 0.22;

const NEIGHBOURS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
] as const;

type Grid = {
  cols: number;
  rows: number;
  at: Vec2[];
  open: boolean[];
  age: number[];
  strength: number[];
};

function openAt(walls: Segment[], p: Vec2): boolean {
  for (const seg of walls) if (pointToSegment(p, seg.a, seg.b) <= CLEARANCE) return false;
  return true;
}

function clear(walls: Segment[], a: Vec2, b: Vec2): boolean {
  for (const seg of walls) if (segmentsCross(a, b, seg.a, seg.b)) return false;
  return true;
}

/** Distance through open ground from one cell to everywhere within `limit`. */
function walkFrom(grid: Grid, walls: Segment[], from: number, limit: number): Map<number, number> {
  const dist = new Map<number, number>([[from, 0]]);
  // Small radius and a coarse grid, so a sorted frontier beats the ceremony of a heap.
  let frontier = [from];

  while (frontier.length) {
    const next: number[] = [];
    for (const here of frontier) {
      const d0 = dist.get(here)!;
      const cx = here % grid.cols;
      const cy = (here - cx) / grid.cols;

      for (const [dx, dy, cost] of NEIGHBOURS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
        const n = ny * grid.cols + nx;
        if (!grid.open[n]) continue;

        const d = d0 + cost * CELL;
        if (d > limit) continue;
        const seen = dist.get(n);
        if (seen !== undefined && seen <= d + 1e-9) continue;
        if (!clear(walls, grid.at[here], grid.at[n])) continue;

        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }

  return dist;
}

export type Assessment = {
  epoch: number;
  /** Strength and age of quarry odour at the exact spot you wake up on, if any. */
  atStart: { strength: number; age: number } | null;
  /** Distance to the closest contact anywhere, and the best one within easy reach. */
  nearest: number;
  bestNear: number;
  /** Longest walk on faith along the chain actually traced from the start. */
  longestHop: number;
  /** Share of the walkable field that could pick the chain up from a standing start. */
  coverage: number;
  contacts: number;
  reachable: boolean;
  followable: boolean;
  faults: string[];
};

/**
 * `walk` is how far the level expects a player to travel between one contact and the
 * next. The default is a cast or so; a level built around a barrier the air crosses and
 * a body cannot has to be given a budget big enough to go round, because the chain
 * breaking at that barrier is the level rather than a fault in it.
 */
export function assess(level: Level, epoch: number, walk = level.detour ?? WALK): Assessment {
  const { world } = level;
  const walls = world.walls;
  const target = quarryOf(level).at;
  const turns = epoch === 0 ? 0 : level.shifts![epoch - 1].after;
  const field = buildField(world, level.sources, windAfter(level, turns).wind, level.seed, epoch);

  const cols = Math.ceil(world.size.w / CELL);
  const rows = Math.ceil(world.size.h / CELL);
  const grid: Grid = { cols, rows, at: [], open: [], age: [], strength: [] };

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const at = { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL };
      grid.at.push(at);
      const open = openAt(walls, at);
      grid.open.push(open);

      if (!open) {
        grid.age.push(Infinity);
        grid.strength.push(0);
        continue;
      }
      // Facing is irrelevant to strength and age; only the stereo channel cares.
      const s = sniff(world, field, at, 0);
      const air = s.air?.odorant === 'quarry' ? s.air : null;
      const ground = s.ground?.odorant === 'quarry' ? s.ground : null;
      const best = !air ? ground : !ground ? air : air.strength >= ground.strength ? air : ground;
      grid.age.push(best ? best.age : Infinity);
      grid.strength.push(best ? best.strength : 0);
    }
  }

  const cellOf = (p: Vec2) =>
    Math.min(rows - 1, Math.max(0, Math.floor(p.y / CELL))) * cols +
    Math.min(cols - 1, Math.max(0, Math.floor(p.x / CELL)));

  // --- REACH ---------------------------------------------------------------
  const walkable = new Set(walkFrom(grid, walls, cellOf(level.start), Infinity).keys());

  // --- ACQUIRE -------------------------------------------------------------
  const contacts = [...walkable].filter((i) => grid.strength[i] >= THRESHOLD);
  const here = cellOf(level.start);

  let nearest = Infinity;
  let nearestCell = -1;
  let bestNear = 0;
  for (const i of contacts) {
    const d = Math.hypot(grid.at[i].x - level.start.x, grid.at[i].y - level.start.y);
    if (d < nearest) {
      nearest = d;
      nearestCell = i;
    }
    if (d <= ACQUIRE * 1.6) bestNear = Math.max(bestNear, grid.strength[i]);
  }

  // --- FOLLOW --------------------------------------------------------------
  //
  // Run backwards from the quarry. Forwards, "find a younger contact within reach" is a
  // search with dead ends in it; backwards, anything reachable from the target by going
  // strictly *older* is by definition something you could have followed inward.
  const sorted = contacts.slice().sort((a, b) => grid.age[a] - grid.age[b]);
  const parent = new Map<number, number>();
  const reach = new Map<number, Map<number, number>>();
  const nearTarget = (i: number) =>
    Math.hypot(grid.at[i].x - target.x, grid.at[i].y - target.y) <= walk;

  for (const i of sorted) {
    if (nearTarget(i)) {
      parent.set(i, -1);
      continue;
    }
    let bestJ = -1;
    let bestD = Infinity;
    for (const [j] of parent) {
      if (grid.age[j] >= grid.age[i]) continue;
      // Cheap rejection before paying for a walk.
      if (Math.hypot(grid.at[i].x - grid.at[j].x, grid.at[i].y - grid.at[j].y) >= bestD) continue;
      let from = reach.get(j);
      if (!from) {
        from = walkFrom(grid, walls, j, walk);
        reach.set(j, from);
      }
      const d = from.get(i);
      if (d === undefined || d >= bestD) continue;
      bestJ = j;
      bestD = d;
    }
    if (bestJ >= 0) parent.set(i, bestJ);
  }

  // The gaps on the route actually taken, rather than the worst anywhere in the field.
  let longestHop = 0;
  for (let i = nearestCell; i >= 0 && parent.has(i); ) {
    const j = parent.get(i)!;
    if (j < 0) break;
    longestHop = Math.max(longestHop, reach.get(j)?.get(i) ?? 0);
    i = j;
  }

  const followable = nearestCell >= 0 && parent.has(nearestCell);

  // --- COVER ---------------------------------------------------------------
  //
  // After a wind shift the player is somewhere unknowable, so "how far is the plume from
  // the start" stops meaning anything and this is the question instead: wherever they
  // are standing, can they pick it up again?
  const chained = new Set(parent.keys());
  let covered = 0;
  for (const i of walkable) {
    if (chained.has(i)) {
      covered++;
      continue;
    }
    for (const j of chained) {
      if (Math.hypot(grid.at[i].x - grid.at[j].x, grid.at[i].y - grid.at[j].y) <= walk) {
        covered++;
        break;
      }
    }
  }
  const coverage = walkable.size ? covered / walkable.size : 0;

  const atStart = grid.strength[here] >= THRESHOLD;
  const faults: string[] = [];

  if (!walkable.has(cellOf(target))) faults.push('UNREACHABLE — no walkable route to the quarry');
  if (nearestCell < 0) faults.push('NO CONTACT ANYWHERE — the plume misses the walkable field');
  else if (epoch === 0 && nearest > ACQUIRE) {
    faults.push(`cold open — nearest contact is ${nearest.toFixed(1)}u away`);
  }
  if (nearestCell >= 0 && !followable) {
    faults.push('NOT FOLLOWABLE — the chain of falling age breaks before the quarry');
  }
  if (epoch > 0 && coverage < THIN) {
    faults.push(`STRANDED — only ${(coverage * 100).toFixed(0)}% of the field can pick it up again`);
  }

  return {
    epoch,
    atStart: atStart ? { strength: grid.strength[here], age: grid.age[here] } : null,
    nearest,
    bestNear,
    longestHop,
    coverage,
    contacts: contacts.length,
    reachable: walkable.has(cellOf(target)),
    followable,
    faults,
  };
}
