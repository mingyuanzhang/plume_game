/**
 * Computes the `best` figures in `src/game/levels.ts`: the fewest sniffs a level can be
 * won on, and the fewest steps achievable with that many.
 *
 *   npm run solve
 *
 * Those numbers are what scoring measures against, so guessing them is not an option —
 * too low and a full score is unreachable, too high and one is handed out for sloppy
 * play. Re-run after touching any geometry.
 *
 * It is also the acceptance test. Every route it finds is replayed through the real
 * reducer, so a clean run proves the movement model, the level geometry, the capture
 * test and the scoring all still agree with each other.
 *
 * The search is a breadth-first sweep over *legs*, where a leg is one sniff plus every
 * step taken on that heading. Legs are the expensive resource, so the frontier is
 * expanded a whole leg at a time and the first leg count that reaches the quarry is the
 * answer; steps break ties within it.
 *
 * Note what it never does: smell anything. It has the field in front of it and walks
 * straight to the answer, which is exactly right for measuring a *route* and exactly
 * wrong for measuring whether a route could be found by nose — that is `npm run field`,
 * and the two together are the acceptance test. Neither is sufficient alone: this one
 * would happily certify a level whose plume blows out over open country, and that one
 * would happily certify a level with no route in.
 *
 * Deliberately blind to silent turns, which the game does allow. A searcher that could
 * turn for free would win every level on no sniffs at all — it knows where everything
 * is — and par would collapse to zero, making every sniff you ever take a penalty. Par
 * is the route a player could plan from what one sample can tell them; turning silently
 * is how you *walk* that route, not a cheaper standard to be held to.
 *
 * The one trick worth knowing: a leg needs a single ray cast, not one per step. Every
 * step on a leg travels the same line, so the distance to whatever is ahead simply
 * decreases by the step length and the position after k steps is a closed form.
 */

import { castRay, pointToSegment } from '../src/game/geometry';
import { LEVELS, quarryOf, type Level } from '../src/game/levels';
import { CAPTURE, initialRun, runReducer, scoreRun, STEP } from '../src/game/run';
import type { Vec2 } from '../src/game/world';

/** Must match `run.ts`, or the routes found here are not routes the game allows. */
const CLEARANCE = 0.35;

/** Angular resolution of the search. A tap on a phone is coarser than this. */
const HEADINGS = 720;

/**
 * Positions are merged onto a lattice this coarse before being expanded again, which is
 * what keeps the frontier finite. Merging can only ever hide a route, never invent one —
 * every state carries its true position, so anything found is exactly playable.
 */
const CELL = 0.5;

type State = {
  pos: Vec2;
  steps: number;
  /** How this position was arrived at, for replaying the route afterwards. */
  from: State | null;
  heading: number;
};

type Solution = { sniffs: number; moves: number; legs: { heading: number; steps: number }[] };

function solve(level: Level): Solution | null {
  const { walls } = level.world;
  const target = quarryOf(level).at;
  const maxSteps = Math.ceil(Math.hypot(level.world.size.w, level.world.size.h) / STEP) + 2;

  const key = (p: Vec2) => `${Math.round(p.x / CELL)},${Math.round(p.y / CELL)}`;

  function legsTo(end: State): { heading: number; steps: number }[] {
    const legs: { heading: number; steps: number }[] = [];
    for (let s: State = end; s.from; s = s.from) {
      legs.unshift({ heading: s.heading, steps: s.steps - s.from.steps });
    }
    return legs;
  }

  /** Walk one leg from `from` on `heading`, collecting where it reaches. */
  function leg(from: State, heading: number, out: State[]): State | null {
    const dir = { x: Math.cos(heading), y: Math.sin(heading) };
    const hit = castRay(walls, from.pos, dir);
    const free = hit ? Math.max(0, hit.t - CLEARANCE) : Infinity;

    let prev = from.pos;
    for (let k = 1; k <= maxSteps; k++) {
      const d = Math.min(STEP * k, free);
      const pos = { x: from.pos.x + dir.x * d, y: from.pos.y + dir.y * d };
      const here: State = { pos, steps: from.steps + k, from, heading };
      // The whole stride, not where it lands: a three-unit step can pass clean over a
      // two-unit reach and register nothing.
      if (pointToSegment(target, prev, pos) <= CAPTURE) return here;

      // Flush against a wall: further steps cost moves and change nothing.
      const blocked = d >= free - 1e-9;
      out.push(here);
      if (blocked) break;
      prev = pos;
    }
    return null;
  }

  const start: State = { pos: level.start, steps: 0, from: null, heading: level.startHeading };
  const seen = new Map<string, number>([[key(level.start), 0]]);

  // Leg zero: the heading you wake up on is already set, so walking it is free. Its
  // states hang off `start` with no leg of their own, which is what makes them free.
  let frontier: State[] = [start];
  const zeroth: State[] = [];
  const freeWin = leg(start, level.startHeading, zeroth);
  if (freeWin) return { sniffs: 0, moves: freeWin.steps, legs: [] };
  for (const s of zeroth) {
    const k = key(s.pos);
    const prior = seen.get(k);
    if (prior === undefined || s.steps < prior) {
      seen.set(k, s.steps);
      frontier.push({ ...s, from: null });
    }
  }

  for (let sniffs = 1; sniffs <= 12; sniffs++) {
    const reached = new Map<string, State>();
    let best: State | null = null;
    const landed: State[] = [];

    for (const from of frontier) {
      if (best && from.steps >= best.steps) continue;
      for (let i = 0; i < HEADINGS; i++) {
        landed.length = 0;
        const won = leg(from, (i * 2 * Math.PI) / HEADINGS, landed);
        if (won && (!best || won.steps < best.steps)) best = won;

        for (const s of landed) {
          const k = key(s.pos);
          const prior = seen.get(k);
          if (prior !== undefined && s.steps >= prior) continue;
          seen.set(k, s.steps);
          reached.set(k, s);
        }
      }
    }

    if (best) return { sniffs, moves: best.steps, legs: legsTo(best) };
    if (reached.size === 0) return null;
    frontier = [...reached.values()];
  }

  return null;
}

/**
 * Play the route through the actual game and report what the actual game thought of it.
 * A route the reducer does not agree wins means this script's movement model has drifted
 * from `run.ts`, and every number it has ever printed is suspect.
 */
function replay(level: Level, found: Solution): string | null {
  let run = initialRun(level);
  // The free opening leg, if the route used one: its steps precede the first sniff.
  const opening = found.moves - found.legs.reduce((n, l) => n + l.steps, 0);
  for (let i = 0; i < opening; i++) run = runReducer(run, { type: 'STEP' });
  for (const { heading, steps } of found.legs) {
    run = runReducer(run, { type: 'SNIFF', heading });
    for (let i = 0; i < steps; i++) run = runReducer(run, { type: 'STEP' });
  }

  if (run.status !== 'found') return `route does not find the quarry (${run.status})`;
  if (run.sniffs !== found.sniffs || run.moves !== found.moves) {
    return `route costs ${run.sniffs}/${run.moves}, not ${found.sniffs}/${found.moves}`;
  }
  const score = scoreRun({ ...run, level: { ...level, best: found } });
  if (score !== 1000) return `optimal route scores ${score}, not 1000`;
  return null;
}

let bad = 0;
const paste: string[] = [];

for (const level of LEVELS) {
  const t0 = Date.now();
  const found = solve(level);
  const held = level.best;

  if (!found) {
    console.log(`${level.id.padEnd(16)} UNREACHABLE — the quarry cannot be caught`);
    bad++;
    continue;
  }

  const drift = replay(level, found);
  const agrees = found.sniffs === held.sniffs && found.moves === held.moves;
  if (drift || !agrees) bad++;
  paste.push(`  ${level.id.padEnd(16)} best: { sniffs: ${found.sniffs}, moves: ${found.moves} },`);

  console.log(
    `${level.id.padEnd(16)} sniffs: ${found.sniffs}, moves: ${String(found.moves).padEnd(3)} ` +
      `${agrees ? 'ok' : `FILE SAYS ${held.sniffs}/${held.moves}`.padEnd(20)} ` +
      `${drift ? `MODEL DRIFT: ${drift}` : ''}  (${Date.now() - t0}ms)`,
  );
}

if (bad) {
  console.log('\nwhat the file should say:');
  for (const row of paste) console.log(row);
}
console.log(bad ? `\n${bad} level(s) need attention` : '\nall levels agree with the file');
