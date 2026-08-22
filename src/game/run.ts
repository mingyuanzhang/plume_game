/**
 * A single hunt. Pure state transitions, no React and no rendering, so the rules can be
 * read and tested on their own.
 *
 * Note what this module does *not* hold: readings. Sniffing produces a sample of the
 * air, and what is in the air is the field's business and the renderer's; the run only
 * records that a sniff happened, where you stood, and what it cost.
 */

import { castRay, pointToSegment } from './geometry';
import type { Wind } from './field';
import { quarryOf, type Level } from './levels';
import type { Vec2 } from './world';

export type RunStatus = 'hunting' | 'found' | 'quit';

export type Sample = { at: Vec2; facing: number; epoch: number };

export type RunState = {
  level: Level;
  pos: Vec2;
  /**
   * The direction a step would take, and the axis a sniff reads left and right of. Set
   * by sniffing — you go where you last put your nose — or by turning, which is free and
   * tells you nothing.
   */
  heading: number;
  sniffs: number;
  moves: number;
  /** Every position occupied, start included. Drawn as the line in the debrief. */
  path: Vec2[];
  /** Where every sniff was taken from. The renderer keeps what each one returned. */
  samples: Sample[];
  /** Which wind is blowing. Bumped by a shift, and the reason a field gets rebuilt. */
  epoch: number;
  /** True when the last step was stopped short by something solid. */
  blocked: boolean;
  status: RunStatus;
};

export type RunAction =
  | { type: 'SNIFF'; heading: number }
  | { type: 'TURN'; heading: number }
  | { type: 'STEP' }
  | { type: 'GIVE_UP' }
  | { type: 'RESTART' }
  | { type: 'LOAD'; level: Level };

/** How far one step carries you. */
export const STEP = 3;

/** Stop this far short of a wall rather than ending up flush against it. */
const CLEARANCE = 0.35;

/**
 * Close enough to have it. Tested against the whole stride rather than where it lands —
 * a three-unit step can otherwise pass clean over a two-unit reach and register nothing.
 */
export const CAPTURE = 2.2;

/**
 * Turns spent so far. Sniffing and stepping both take time; turning your head does not,
 * which is the same reason it is free everywhere else. This is the clock a wind shift
 * runs on, because the wind does not care how far you have walked, only how long you
 * have been out here.
 */
export function turnsSpent(state: Pick<RunState, 'sniffs' | 'moves'>): number {
  return state.sniffs + state.moves;
}

/** Which wind is blowing after a given number of turns, and the epoch that names it. */
export function windAfter(level: Level, turns: number): { wind: Wind; epoch: number } {
  let wind = level.wind;
  let epoch = 0;
  for (const shift of level.shifts ?? []) {
    if (turns >= shift.after) {
      wind = shift.wind;
      epoch++;
    }
  }
  return { wind, epoch };
}

export function initialRun(level: Level): RunState {
  return {
    level,
    pos: level.start,
    heading: level.startHeading,
    sniffs: 0,
    moves: 0,
    path: [level.start],
    samples: [],
    epoch: 0,
    blocked: false,
    status: 'hunting',
  };
}

/**
 * Advance along a heading, stopping short of whatever is in the way. Movement uses the
 * same cast the field does, so a hedge you can smell straight through still stops you
 * dead — which is the whole point of there being hedges.
 */
function advance(state: RunState, heading: number): { pos: Vec2; blocked: boolean } {
  const dir = { x: Math.cos(heading), y: Math.sin(heading) };
  const hit = castRay(state.level.world.walls, state.pos, dir);
  const limit = hit ? Math.max(0, hit.t - CLEARANCE) : STEP;
  const travelled = Math.min(STEP, limit);

  return {
    pos: { x: state.pos.x + dir.x * travelled, y: state.pos.y + dir.y * travelled },
    blocked: travelled < STEP - 1e-6,
  };
}

/** Re-derive the epoch from the clock, so a shift lands the instant it is due. */
function reWind(state: RunState): RunState {
  const { epoch } = windAfter(state.level, turnsSpent(state));
  return epoch === state.epoch ? state : { ...state, epoch };
}

export function runReducer(state: RunState, action: RunAction): RunState {
  // Both start a fresh hunt, so they apply whatever the current status is.
  if (action.type === 'RESTART') return initialRun(state.level);
  if (action.type === 'LOAD') return initialRun(action.level);
  if (state.status !== 'hunting') return state;

  switch (action.type) {
    case 'SNIFF':
      return reWind({
        ...state,
        heading: action.heading,
        sniffs: state.sniffs + 1,
        samples: [...state.samples, { at: state.pos, facing: action.heading, epoch: state.epoch }],
        blocked: false,
      });

    /**
     * Turning on the spot. A head swings round for nothing, so this costs nothing and is
     * recorded nowhere. What it does not do is tell you anything: you are now facing
     * somewhere you have not sampled, which is exactly the trade being offered. It is
     * what makes one sniff worth several steps.
     *
     * Clears `blocked` for the same reason sniffing does — that flag means "the last step
     * hit something ahead", and ahead has just moved.
     */
    case 'TURN':
      return { ...state, heading: action.heading, blocked: false };

    case 'STEP': {
      const { pos, blocked } = advance(state, state.heading);
      const found = pointToSegment(quarryOf(state.level).at, state.pos, pos) <= CAPTURE;

      return reWind({
        ...state,
        pos,
        blocked,
        moves: state.moves + 1,
        path: [...state.path, pos],
        status: found ? 'found' : 'hunting',
      });
    }

    case 'GIVE_UP':
      return { ...state, status: 'quit' };
  }
}

/**
 * What each wasted sniff and each wasted step costs against a perfect hunt.
 *
 * Note the ratio, which is the reverse of what a game about echolocation wants. There,
 * a call lights up a whole room and walking blind is the frightening part. Here one
 * sniff is a single point sample of an enormous field, and the only way to learn the
 * shape of anything is to *move* — a cast is five or six steps on one heading with a
 * sniff at the end of it. Making steps cheap and samples dear is what pushes you into
 * casting instead of shuffling forward sniffing at every pace.
 */
const SNIFF_PENALTY = 45;
const MOVE_PENALTY = 14;

/** The least a catch can be worth, so it never ties with walking away. */
const FOUND_FLOOR = 60;

/**
 * A catch starts from 1000 and pays for every sniff and step beyond the optimum, so the
 * score is strictly decreasing in both — using the sense less always scores better, and
 * a full 1000 needs the perfect line off a single read. Giving up scores nothing at all.
 */
export function scoreRun(state: RunState): number {
  if (state.status !== 'found') return 0;

  const { best } = state.level;
  const wastedSniffs = Math.max(0, state.sniffs - best.sniffs);
  const wastedMoves = Math.max(0, state.moves - best.moves);
  const earned = 1000 - wastedSniffs * SNIFF_PENALTY - wastedMoves * MOVE_PENALTY;

  // Floored rather than allowed to reach zero: however badly you blundered about, having
  // the thing has to be worth more than giving up, or the two outcomes read the same.
  return Math.max(FOUND_FLOOR, Math.round(earned));
}

/** Coarse grade for the debrief, so a number has some meaning attached to it. */
export function grade(score: number): string {
  if (score === 0) return '—';
  if (score >= 950) return 'UNERRING';
  if (score >= 820) return 'KEEN';
  if (score >= 650) return 'STEADY';
  if (score >= 450) return 'BLUNDERING';
  return 'LOST';
}
