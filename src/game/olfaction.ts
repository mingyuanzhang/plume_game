/**
 * Smell as a pure projection of the field. No React, no rendering, no colours — `sniff`
 * returns physical facts about what is at a nose, and a renderer decides whether those
 * become marks on a screen or something else entirely.
 *
 * What comes back is four channels, and the design of the game is that **each one
 * answers exactly one question and is useless for the others**:
 *
 *   strength   am I on the ribbon?      (near-binary, and a bad rangefinder)
 *   age        how far along it am I?   (the honest one; see field.ts)
 *   lateral    which way is its middle? (only once you are properly inside it)
 *   odorant    is this even the thing I am after?
 *
 * Wind is a fifth, free, and always on — you feel the air on you without spending
 * anything. It is the only fixed frame of reference in the game, which is why taking it
 * away, by shifting it, is the cruellest thing a level can do.
 */

import { passage } from './geometry';
import type { Borne, Field, Odorant, Puff } from './field';
import type { Segment, Vec2, World } from './world';

export type Reading = {
  /** Concentration, scaled so a firm contact near a source is about 1. */
  strength: number;
  /** Mass-weighted mean seconds since this odour left its source. */
  age: number;
  odorant: Odorant;
  /**
   * How much of the non-masking odour here is the odorant named above, 0.5 to 1. Well
   * under 1 means two plumes are overlapping and neither answer is safe.
   */
  share: number;
  /**
   * Which side of your heading smells stronger, -1 to 1, positive for the left. Real
   * only near the middle of a ribbon, where there is a gradient to read; out at the
   * ragged edge it is a coin toss, and learning when to believe it is most of the skill.
   * Always zero for ground scent, which has no such structure at a nose's scale.
   */
  lateral: number;
};

export type Sniff = {
  at: Vec2;
  facing: number;
  /** Carried on the wind: a direction, and a long reach. */
  air: Reading | null;
  /** Lying where it fell: a place, and a history. */
  ground: Reading | null;
  /**
   * Masking load — smoke and the like. You smell it perfectly well. What it does is
   * raise the bar everything else has to clear, so standing in it makes the world
   * quiet in a way that is indistinguishable from there being nothing there.
   */
  haze: number;
};

/**
 * Separation of the two sampling points, perpendicular to where the nose is pointed.
 * Far wider than an actual pair of nostrils, and deliberately so: a tracking dog does
 * not read a gradient across two centimetres, it sweeps its head across the trail and
 * compares. One sniff here is one such sweep.
 */
const NOSTRIL = 1.4;

/**
 * Concentration that reads as 1. Calibrated against the model rather than chosen — see
 * `npm run field`, which prints the peak a nose actually meets beside a source.
 */
const REFERENCE = 2.6;

/** Below this, a nose has nothing to report. An absence here is the game's other half. */
export const THRESHOLD = 0.055;

/** How hard masking bites: the threshold is multiplied by 1 + MASKING * haze. */
const MASKING = 7;

/** Beyond this many standard deviations a puff contributes nothing worth a ray cast. */
const CUTOFF = 3.6;

type Bucket = { weight: number; aged: number };

function add(into: Map<string, Bucket>, key: string, weight: number, age: number): void {
  const bucket = into.get(key);
  if (bucket) {
    bucket.weight += weight;
    bucket.aged += weight * age;
  } else {
    into.set(key, { weight, aged: weight * age });
  }
}

/**
 * Accumulate what reaches one sampling point, split by odorant and by whether it came
 * through the air or off the ground.
 *
 * The line-of-sight test is what stops odour reading through walls. It is not a claim
 * that scent travels in straight lines — it plainly does not — but the going-around-
 * corners is already handled, and handled properly, by the puffs having been *carried*
 * around that corner in `field.ts`. By the time a puff is in the room with you there is
 * nothing between you and it. What this rejects is the other case: a puff still on the
 * far side of a wall, which has not reached you, whatever the map says about how near
 * it is.
 */
function gather(walls: Segment[], puffs: Puff[], at: Vec2): Map<string, Bucket> {
  const out = new Map<string, Bucket>();

  for (const puff of puffs) {
    const dx = at.x - puff.at.x;
    const dy = at.y - puff.at.y;
    const reach = puff.radius * CUTOFF;
    if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;

    const d2 = dx * dx + dy * dy;
    if (d2 > reach * reach) continue;

    const r2 = puff.radius * puff.radius;
    let weight = (puff.mass / (2 * Math.PI * r2)) * Math.exp(-d2 / (2 * r2));
    if (weight < 1e-5) continue;

    weight *= passage(walls, puff.at, at).through;
    if (weight < 1e-5) continue;

    add(out, `${puff.borne}:${puff.odorant}`, weight, puff.age);
  }

  return out;
}

/** The strongest odorant in a bucket set for one carrier, ignoring what only masks. */
function dominant(
  buckets: Map<string, Bucket>,
  borne: Borne,
): { odorant: Odorant; weight: number; age: number; share: number } | null {
  let total = 0;
  let best: { odorant: Odorant; bucket: Bucket } | null = null;

  for (const [key, bucket] of buckets) {
    const [carrier, odorant] = key.split(':') as [Borne, Odorant];
    if (carrier !== borne || odorant === 'smoke') continue;
    total += bucket.weight;
    if (!best || bucket.weight > best.bucket.weight) best = { odorant, bucket };
  }

  if (!best || total <= 0) return null;
  return {
    odorant: best.odorant,
    weight: best.bucket.weight,
    age: best.bucket.aged / best.bucket.weight,
    share: best.bucket.weight / total,
  };
}

function smokeAt(buckets: Map<string, Bucket>): number {
  return (buckets.get('air:smoke')?.weight ?? 0) / REFERENCE;
}

/**
 * Take one sample of the world through a nose.
 *
 * Two sampling points, a head's sweep apart across the heading, which is where the
 * left/right differential comes from. Everything else is read from their mean, because
 * strength and age are properties of the air you are standing in rather than of which
 * way you happen to be facing.
 */
export function sniff(world: World, field: Field, at: Vec2, facing: number): Sniff {
  const px = -Math.sin(facing) * (NOSTRIL / 2);
  const py = Math.cos(facing) * (NOSTRIL / 2);

  const walls = world.walls;
  const left = gather(walls, field.puffs, { x: at.x + px, y: at.y + py });
  const right = gather(walls, field.puffs, { x: at.x - px, y: at.y - py });

  const haze = (smokeAt(left) + smokeAt(right)) / 2;
  const floor = THRESHOLD * (1 + MASKING * haze);

  const read = (borne: Borne): Reading | null => {
    const l = dominant(left, borne);
    const r = dominant(right, borne);
    if (!l && !r) return null;

    const weight = ((l?.weight ?? 0) + (r?.weight ?? 0)) / 2;
    const strength = weight / REFERENCE;
    if (strength < floor) return null;

    const lw = l?.weight ?? 0;
    const rw = r?.weight ?? 0;
    const both = lw + rw;

    // Whichever side is carrying more decides what this is; on the rare split the
    // shares are near even anyway and `share` says so.
    const lead = lw >= rw ? l! : r!;

    return {
      strength,
      age: both > 0 ? ((l?.age ?? 0) * lw + (r?.age ?? 0) * rw) / both : lead.age,
      odorant: lead.odorant,
      share: lead.share,
      lateral: borne === 'ground' || both <= 0 ? 0 : (lw - rw) / both,
    };
  };

  return { at, facing, air: read('air'), ground: read('ground'), haze };
}

/** True when a sniff came back with nothing at all — which is itself a fact about where
 *  you are standing, and usually the most useful one you will get. */
export function isEmpty(s: Sniff): boolean {
  return !s.air && !s.ground && s.haze < THRESHOLD;
}
