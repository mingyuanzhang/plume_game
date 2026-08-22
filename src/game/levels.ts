/**
 * Levels. A level is a field, a wind, whatever is giving off a smell, and the few facts
 * a hunt needs: where you wake up and what a perfect run costs.
 *
 * Every `best` here was computed by exhaustive search over headings and step counts, not
 * estimated — scoring measures deviation from it, so a wrong value either puts a full
 * score out of reach or hands one out for sloppy play. `scripts/solve-levels.ts` is that
 * search; re-run it after touching any geometry.
 *
 * The other script matters just as much and has no equivalent in a game about walls.
 * A room either has a doorway or it does not, but a plume is a thing the physics grows
 * from a seed, and it can perfectly well grow somewhere useless — pinned against a wall,
 * or threading a gap the level did not mean it to, or missing the player's whole corner
 * of the field. `npm run field` checks each level is actually *followable*: that there
 * is a chain of detectable contacts of decreasing age running from where you start to
 * what you are hunting. A level that fails it is not hard, it is broken, and no amount
 * of play will tell the two apart from the inside.
 *
 * Which is why every level carries a `seed`. It is not decoration — it is the specific
 * plume this level was designed around, and changing it authors a different level.
 *
 * The set is ordered as a difficulty curve: the wind and the ribbon, then reading age,
 * then walls that block the air and walls that do not, then other things that smell,
 * then odour on the ground, and finally the wind turning under you.
 */

import type { Source, Wind } from './field';
import { box, wall, type Segment, type Vec2, type World } from './world';

export type Level = {
  id: string;
  name: string;
  world: World;
  start: Vec2;
  startHeading: number;
  wind: Wind;
  /**
   * Wind changes, each taking over once that many turns have been spent. A shift rebuilds
   * the plume from nothing, which makes every contact you have banked so far a record of
   * a field that no longer exists.
   */
  shifts?: { after: number; wind: Wind }[];
  sources: Source[];
  seed: number;
  /**
   * How far this level expects a player to walk between one contact and the next, in
   * world units. Only set where the level is *built* around a barrier the air crosses
   * and a body cannot: there the chain of falling age necessarily breaks at the barrier,
   * and going the long way round is the puzzle rather than a fault. `npm run field`
   * needs telling, or it reports the design as a broken plume.
   */
  detour?: number;
  /** The verified optimum: fewest sniffs, and fewest steps achievable with them. */
  best: { sniffs: number; moves: number };
};

const RAD = Math.PI / 180;

/** Compass bearings, in a world whose y runs down the screen. */
const N = -90 * RAD;
const S = 90 * RAD;
const E = 0;
const WEST = 180 * RAD;

/**
 * You always wake up facing *across* the wind, never along it.
 *
 * This is a scoring constraint before it is a piece of characterisation. The heading you
 * start on is already set, so the steps taken on it are free — and a quarry sits upwind
 * almost by definition, so waking up pointed upwind means walking straight into it for
 * nothing. Par came out at zero sniffs on seven levels before this rule, which would
 * have made the perfect run one where you never use the sense at all and every sniff you
 * took a penalty against it.
 *
 * It is also what an animal quartering a field actually does, and it is the position the
 * game wants you in: side-on to the only free information you have.
 */

/** An enclosing fence, so nothing walks off the edge of the world. */
function bounds(w: number, h: number): Segment[] {
  return box(1, 1, w - 2, h - 2, 'timber');
}

function field(w: number, h: number, ...inner: Segment[][]): World {
  return { size: { w, h }, walls: [...bounds(w, h), ...inner.flat()] };
}

/** Calm, ordinary and gusty air. Churn is what decides how far a ribbon wanders. */
const CALM = (heading: number): Wind => ({ heading, speed: 2.1, churn: 0.34 });
const AIR = (heading: number): Wind => ({ heading, speed: 2.2, churn: 0.75 });
const GUSTY = (heading: number): Wind => ({ heading, speed: 2.4, churn: 1.15 });

/** The thing you are hunting. Everything else that smells is scenery or a lie. */
export function quarryOf(level: Level): Source {
  const found = level.sources.find((s) => s.odorant === 'quarry');
  if (!found) throw new Error(`Level ${level.id} has nothing to hunt.`);
  return found;
}

const at = (x: number, y: number): Vec2 => ({ x, y });

/** A quarry with no history: it has been sitting there giving itself away. */
function quarry(x: number, y: number, strength = 1): Source {
  return { odorant: 'quarry', at: at(x, y), strength };
}

/** A quarry that walked here, laying scent on the ground the whole way. */
function walked(path: Vec2[], trailAge: number, strength = 1): Source {
  return { odorant: 'quarry', at: path[path.length - 1], strength, trail: path, trailAge };
}

export const LEVELS: Level[] = [
  // --- The wind, and the ribbon it drags -----------------------------------
  {
    id: 'first-light',
    name: 'First Light',
    world: field(40, 58),
    start: at(16, 47),
    startHeading: E,
    wind: CALM(S),
    sources: [quarry(20, 10)],
    seed: 3,
    best: { sniffs: 1, moves: 12 },
  },
  {
    id: 'the-bend',
    name: 'The Bend',
    world: field(44, 62),
    start: at(13, 54),
    startHeading: WEST,
    wind: AIR(S),
    sources: [quarry(21, 10)],
    seed: 47,
    best: { sniffs: 1, moves: 15 },
  },
  {
    // Deliberately opens on nothing. Every other early field hands you a contact to
    // start from; this one is where you learn that an empty sniff is a fact too, and
    // that the answer is to sweep across the wind until you hit the ribbon.
    id: 'clean-air',
    name: 'Clean Air',
    world: field(50, 58),
    start: at(9, 50),
    startHeading: E,
    wind: AIR(S),
    sources: [quarry(30, 10)],
    seed: 99,
    best: { sniffs: 1, moves: 15 },
  },
  {
    id: 'the-tired-end',
    name: 'The Tired End',
    world: field(44, 68),
    start: at(26.5, 58),
    startHeading: WEST,
    wind: AIR(S),
    sources: [quarry(22, 12)],
    seed: 11,
    best: { sniffs: 1, moves: 15 },
  },

  // --- Age, which is the channel that does not lie -------------------------
  {
    id: 'both-ways',
    name: 'Both Ways',
    world: field(56, 52),
    start: at(29.5, 41.5),
    startHeading: E,
    wind: AIR(S),
    sources: [quarry(38, 9), { odorant: 'bloom', at: at(15, 9), strength: 1.7 }],
    seed: 47,
    best: { sniffs: 1, moves: 11 },
  },
  {
    id: 'narrowing',
    name: 'Narrowing',
    world: field(46, 60),
    start: at(28.5, 48.5),
    startHeading: WEST,
    wind: CALM(S),
    sources: [quarry(24, 11, 0.7)],
    seed: 61,
    best: { sniffs: 1, moves: 12 },
  },
  {
    id: 'gale',
    name: 'Gale',
    world: field(52, 60),
    start: at(34.5, 54.5),
    startHeading: E,
    wind: GUSTY(S),
    sources: [quarry(26, 11)],
    seed: 17,
    best: { sniffs: 1, moves: 15 },
  },

  // --- Walls that stop the air, and walls that do not ----------------------
  {
    id: 'scent-shadow',
    name: 'Scent Shadow',
    world: field(48, 62, [wall(1, 32, 20, 32, 'stone'), wall(28, 32, 47, 32, 'stone')]),
    start: at(21.5, 50.5),
    startHeading: WEST,
    wind: AIR(S),
    sources: [quarry(24, 10)],
    seed: 89,
    best: { sniffs: 1, moves: 13 },
  },
  {
    id: 'hedgerow',
    name: 'Hedgerow',
    world: field(48, 60, [wall(9, 30, 47, 30, 'hedge')]),
    start: at(26, 52),
    startHeading: E,
    wind: AIR(S),
    sources: [quarry(26, 10, 1.9)],
    seed: 7,
    // The air goes through the hedge and you do not. The way round is at the far left.
    detour: 42,
    best: { sniffs: 2, moves: 19 },
  },
  {
    id: 'the-rail',
    name: 'The Rail',
    world: field(50, 56, [wall(2, 28, 40, 28, 'rail')]),
    start: at(15, 43),
    startHeading: WEST,
    wind: AIR(S),
    sources: [quarry(21, 10)],
    seed: 13,
    // A fence barely touches the air. Strong, young, straight ahead, and unwalkable.
    detour: 38,
    best: { sniffs: 2, moves: 15 },
  },
  {
    id: 'the-yards',
    name: 'The Yards',
    world: field(52, 62, [
      wall(2, 38, 20, 38, 'stone'),
      wall(28, 38, 50, 38, 'stone'),
      wall(30, 18, 30, 38, 'hedge'),
    ]),
    start: at(24, 54),
    startHeading: E,
    wind: AIR(S),
    sources: [quarry(38, 9, 1.5)],
    seed: 75,
    detour: 30,
    best: { sniffs: 2, moves: 16 },
  },

  // --- Other things that smell ---------------------------------------------
  {
    id: 'carrion',
    name: 'Carrion',
    world: field(56, 56),
    start: at(29.5, 45.5),
    startHeading: WEST,
    wind: AIR(S),
    sources: [quarry(36, 10), { odorant: 'carrion', at: at(18, 10), strength: 2.4 }],
    seed: 45,
    best: { sniffs: 1, moves: 12 },
  },
  {
    id: 'mingled',
    name: 'Mingled',
    world: field(50, 58),
    start: at(25, 50),
    startHeading: E,
    wind: AIR(S),
    sources: [quarry(21, 11), { odorant: 'bloom', at: at(29, 11), strength: 1.3 }],
    seed: 43,
    best: { sniffs: 1, moves: 13 },
  },
  {
    id: 'burnt-ground',
    name: 'Burnt Ground',
    world: field(48, 66),
    start: at(29, 54),
    startHeading: WEST,
    wind: AIR(S),
    sources: [quarry(24, 10), { odorant: 'smoke', at: at(24, 30), strength: 2.6 }],
    seed: 11,
    best: { sniffs: 1, moves: 15 },
  },
  {
    // Opens on a strong, confident reading of carrion, which is not what you are after,
    // while the quarry is seventeen units off behind a hedge and a bank of smoke. The
    // followability probe reports the cold open and is right to; being handed the wrong
    // answer first is the level.
    id: 'foul-air',
    name: 'Foul Air',
    world: field(56, 64, [wall(30, 26, 30, 48, 'hedge')]),
    start: at(21, 50.5),
    startHeading: E,
    wind: AIR(S),
    sources: [
      quarry(40, 10),
      { odorant: 'carrion', at: at(16, 10), strength: 2.2 },
      { odorant: 'smoke', at: at(38, 30), strength: 2.0 },
    ],
    seed: 53,
    best: { sniffs: 1, moves: 17 },
  },

  // --- Odour that stays where it fell --------------------------------------
  {
    id: 'the-crossing',
    name: 'The Crossing',
    world: field(56, 56),
    start: at(39, 39),
    startHeading: S,
    wind: AIR(WEST),
    sources: [
      walked([at(46, 46), at(38, 38), at(30, 32), at(22, 24), at(14, 14)], 100),
    ],
    seed: 37,
    best: { sniffs: 1, moves: 12 },
  },
  {
    id: 'cold-start',
    name: 'Cold Start',
    world: field(58, 60),
    start: at(15, 54),
    startHeading: S,
    wind: AIR(E),
    sources: [
      walked([at(10, 48), at(18, 42), at(26, 36), at(33, 26), at(40, 16)], 130),
    ],
    seed: 71,
    best: { sniffs: 1, moves: 15 },
  },
  {
    id: 'doubling-back',
    name: 'Doubling Back',
    world: field(56, 62),
    start: at(10, 54),
    startHeading: N,
    // Across the field rather than down it, so the airborne plume streams off to the
    // right and never reaches you. There is only the ground here.
    wind: AIR(E),
    sources: [
      walked(
        [at(12, 50), at(42, 46), at(44, 18), at(14, 14), at(16, 40), at(46, 36)],
        140,
      ),
    ],
    seed: 89,
    best: { sniffs: 1, moves: 13 },
  },

  // --- The wind turns under you --------------------------------------------
  {
    id: 'veer',
    name: 'Veer',
    world: field(56, 58),
    start: at(37, 50),
    startHeading: E,
    wind: AIR(S),
    shifts: [{ after: 8, wind: AIR(120 * RAD) }],
    sources: [quarry(30, 12)],
    seed: 59,
    best: { sniffs: 1, moves: 13 },
  },
  {
    id: 'the-long-field',
    name: 'The Long Field',
    world: field(60, 68, [
      wall(1, 42, 22, 42, 'stone'),
      wall(30, 42, 44, 42, 'hedge'),
      wall(52, 42, 59, 42, 'stone'),
      ...box(14, 16, 12, 8, 'timber'),
    ]),
    start: at(30, 60),
    startHeading: WEST,
    wind: AIR(S),
    shifts: [{ after: 14, wind: GUSTY(105 * RAD) }],
    sources: [quarry(44, 10), { odorant: 'carrion', at: at(9, 12), strength: 2.1 }],
    seed: 97,
    best: { sniffs: 1, moves: 21 },
  },
];

/**
 * How many opening levels offer a way out. Being shown the field you failed to read is
 * the lesson early on; after that, finding the thing is what buys you the map.
 */
export const MERCY_LEVELS = 5;
