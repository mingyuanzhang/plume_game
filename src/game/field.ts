/**
 * The plume itself: odour as it actually behaves in moving air.
 *
 * The thing this model exists to get right is that **odour does not form a gradient you
 * can climb.** A source in wind does not surround itself with tidy concentric rings.
 * The wind carries its output downwind as a thin ribbon, and turbulence drags that
 * ribbon sideways as it goes, so what is actually out there is a long, narrow, wandering
 * filament with clean air on either side of it. A metre off the ribbon there is nothing
 * at all. This is why a moth does not walk up a gradient — there isn't one — and instead
 * *casts*: hold upwind while you are touching the filament, and when you lose it, sweep
 * crosswind until you touch it again.
 *
 * The construction is Lagrangian, after the filament models used in moth-tracking work.
 * Run time forward from `MAX_AGE` seconds ago to now. On every tick each live puff is
 * advected one step by the wind plus a crosswind eddy velocity, and the source emits one
 * new puff. Because every puff alive at an instant feels the *same* eddy velocity, and
 * because they were born at different instants, a puff's lateral offset is the running
 * integral of that velocity over its own lifetime — which is a smooth wave in downwind
 * distance. The ribbon is coherent and it meanders, and neither had to be drawn by hand.
 *
 * Two consequences fall out of this that the whole game then rests on.
 *
 * **Concentration is a poor rangefinder.** A ribbon dilutes transversely, and puffs
 * overlap along it, so peak concentration falls roughly as 1/radius — as the *square
 * root* of distance, not its square. A far contact is a bit weaker than a near one, not
 * a hundredth of it. You cannot tell range from strength.
 *
 * **Age is an excellent one.** A puff's age is exactly its travel time from the source,
 * so it is strictly increasing along the ribbon regardless of how the ribbon wanders,
 * what it has passed through, or how faint it has become. A weak young whiff means a
 * near source. A strong old one means you are standing in the wide, tired end of
 * something far away.
 *
 * That split is the sense: strength answers *am I on it*, age answers *how far along*.
 */

import { passage } from './geometry';
import type { Segment, Vec2, World } from './world';

export type Odorant = 'quarry' | 'carrion' | 'bloom' | 'smoke';

/** Air scent, carried on the wind; or ground scent, laid down and left where it fell. */
export type Borne = 'air' | 'ground';

export type Wind = {
  /**
   * The direction the air is *moving toward*, in radians. Upwind — the direction a
   * source must lie in for its plume to reach you — is this plus pi. Stored this way
   * because it is what advects a puff; every other use flips it once and says so.
   */
  heading: number;
  /** World units per second. */
  speed: number;
  /** Eddy strength, as a fraction of `speed`. 0 is a laser; 1 thrashes. */
  churn: number;
};

export type Source = {
  odorant: Odorant;
  /** Where it is now. The airborne plume streams from here. */
  at: Vec2;
  /** Emission rate, relative to 1 for an ordinary quarry. */
  strength: number;
  /**
   * The path it walked to get here, oldest point first and ending at `at`. Odour lands
   * on the ground as it passes and then stays put, so a trail is a record of where the
   * animal *was* — and because the odour ages from one end to the other, it also records
   * which way it was going.
   */
  trail?: Vec2[];
  /** Seconds since the quarry stood at `trail[0]`. Ignored without a trail. */
  trailAge?: number;
};

export type Puff = {
  at: Vec2;
  /** Standard deviation of the gaussian, in world units. */
  radius: number;
  /** What is left after dilution, decay, and whatever it has been dragged through. */
  mass: number;
  /** Seconds since it left the source. The freshness channel, and the honest one. */
  age: number;
  odorant: Odorant;
  borne: Borne;
};

export type Field = {
  puffs: Puff[];
  wind: Wind;
  sources: Source[];
};

/**
 * Emission interval. Along-wind puff spacing is `wind.speed * DT`, which must stay well
 * under the birth radius or the ribbon comes out as a dotted line — a string of separate
 * blobs near the source, which reads as noise rather than as a thing to follow.
 */
const DT = 0.09;

/** Oldest air puff carried, in seconds. Sets how far downwind the ribbon reaches. */
const MAX_AGE = 27;

/** Radius a puff is born with. */
const BIRTH_RADIUS = 0.55;

/** Turbulent diffusion of an airborne puff: r = sqrt(r0^2 + 2*D*age). */
const AIR_DIFFUSIVITY = 0.13;

/**
 * The same for odour on the ground — nearly nil, and that is the point. Ground scent
 * lasts because it is stuck to the substrate rather than floating in air, so it barely
 * spreads. Given a realistic air-like value the old end of a trail dilutes below the
 * detection floor within a minute, the age gradient along it becomes unreadable, and
 * the one thing a trail is *for* stops working.
 */
const GROUND_DIFFUSIVITY = 0.004;

/** Odour does not last forever. Gentle — dilution does most of the work. */
const AIR_LIFETIME = 110;

/** Ground scent goes off faster than air scent, which is what makes a trail readable. */
const GROUND_LIFETIME = 150;

/** Distance between deposits along a walked trail. */
const TRAIL_SPACING = 1.1;

/** A ground deposit starts wider than an air puff — a footfall is not a point. */
const GROUND_RADIUS = 0.8;

/**
 * Ground deposits are laid down much more concentrated than a puff of air: an animal
 * presses its scent into the ground at every step and it stays where it was put. Without
 * this a trail sits right on the detection floor and reads as intermittent noise.
 */
const GROUND_GAIN = 2.2;

/**
 * The eddy cascade, as periods in seconds and relative amplitudes. Big slow eddies carry
 * the ribbon a long way sideways; small fast ones ruffle its edge. The slowest period is
 * deliberately longer than the transit time to the far end of a level, so a plume curves
 * once or twice across the field rather than braiding into something unreadable.
 */
const OCTAVES = [
  { period: 41, amp: 1.0 },
  { period: 19, amp: 0.55 },
  { period: 8.5, amp: 0.3 },
  { period: 3.7, amp: 0.16 },
  { period: 1.6, amp: 0.09 },
];

const AMP_TOTAL = OCTAVES.reduce((n, o) => n + o.amp, 0);

/** Deterministic PRNG. Nothing here may reach for `Math.random`: a level has to be the
 *  same level every time it is played, and the solver has to be measuring the same one. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Crosswind velocity of the air at an instant, shared by every puff alive at that
 * instant. Sharing it is the point: it is what makes the ribbon one coherent object
 * instead of a cloud of independently jittering specks.
 */
function eddy(t: number, phases: number[], wind: Wind): number {
  let v = 0;
  for (let k = 0; k < OCTAVES.length; k++) {
    v += OCTAVES[k].amp * Math.sin((2 * Math.PI * t) / OCTAVES[k].period + phases[k]);
  }
  return (v / AMP_TOTAL) * wind.speed * wind.churn;
}

function airRadius(age: number): number {
  return Math.sqrt(BIRTH_RADIUS * BIRTH_RADIUS + 2 * AIR_DIFFUSIVITY * age);
}

/**
 * Stream one source's airborne plume, by running the air forward and letting the ribbon
 * build itself.
 *
 * A puff that meets something solid is finished — the plume does not pass through a wall,
 * it piles against it, and downwind of that wall is a genuine hole in the world. What
 * survives is whatever threaded a gap, which is why a doorway downwind of a source
 * becomes a narrow jet of scent and why following the smell is often how you find the
 * door. A porous barrier takes its share and hands back something wider and vaguer.
 */
function streamAir(walls: Segment[], source: Source, wind: Wind, phases: number[]): Puff[] {
  const steps = Math.round(MAX_AGE / DT);
  const ux = Math.cos(wind.heading) * wind.speed;
  const uy = Math.sin(wind.heading) * wind.speed;
  // Crosswind unit vector, ninety degrees off the wind.
  const px = -Math.sin(wind.heading);
  const py = Math.cos(wind.heading);

  type Live = { x: number; y: number; extra: number; mass: number; born: number };
  const live: Live[] = [];

  for (let step = 0; step <= steps; step++) {
    const t = (step - steps) * DT;
    const v = eddy(t, phases, wind);
    const vx = ux + px * v;
    const vy = uy + py * v;

    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      const nx = p.x + vx * DT;
      const ny = p.y + vy * DT;
      const cross = passage(walls, { x: p.x, y: p.y }, { x: nx, y: ny });

      if (cross.through <= 0) {
        // Into a wall. Everything this filament would have become downwind of here
        // simply does not exist, and that absence is the scent shadow.
        live.splice(i, 1);
        continue;
      }

      p.x = nx;
      p.y = ny;
      p.mass *= cross.through;
      p.extra += cross.scatter;
    }

    live.push({ x: source.at.x, y: source.at.y, extra: 0, mass: source.strength, born: step });
  }

  const puffs: Puff[] = [];
  for (const p of live) {
    const age = (steps - p.born) * DT;
    const mass = p.mass * Math.exp(-age / AIR_LIFETIME);
    if (mass < 1e-4) continue;
    puffs.push({
      at: { x: p.x, y: p.y },
      radius: airRadius(age) + p.extra,
      mass,
      age,
      odorant: source.odorant,
      borne: 'air',
    });
  }
  return puffs;
}

/**
 * Lay a walked trail on the ground. No advection — this is the half of the sense that
 * stays where it was put, which is exactly what makes it worth having: the plume tells
 * you a direction, and the trail tells you a place.
 *
 * Age runs from `trailAge` at the first point down to zero at the last, because the last
 * point is where the animal is standing now. Two samples a few paces apart along a trail
 * therefore tell you which way it was walking, which is a real thing dogs do and takes
 * them about five footprints.
 */
function layTrail(source: Source): Puff[] {
  const path = source.trail;
  if (!path || path.length < 2) return [];
  const total = source.trailAge ?? 60;

  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(
    path[i].x - path[i - 1].x,
    path[i].y - path[i - 1].y,
  );
  if (length < 1e-6) return [];

  const puffs: Puff[] = [];
  let walked = 0;
  let carry = 0;

  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1].x;
    const ay = path[i - 1].y;
    const dx = path[i].x - ax;
    const dy = path[i].y - ay;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-9) continue;

    for (let s = carry; s < segLen; s += TRAIL_SPACING) {
      const f = s / segLen;
      const age = total * (1 - (walked + s) / length);
      const mass = source.strength * GROUND_GAIN * Math.exp(-age / GROUND_LIFETIME);
      if (mass < 1e-4) continue;
      puffs.push({
        at: { x: ax + dx * f, y: ay + dy * f },
        radius: Math.sqrt(GROUND_RADIUS * GROUND_RADIUS + 2 * GROUND_DIFFUSIVITY * age),
        mass,
        age,
        odorant: source.odorant,
        borne: 'ground',
      });
      carry = s + TRAIL_SPACING - segLen;
    }
    walked += segLen;
  }

  return puffs;
}

/**
 * Build the whole field. Deterministic in `seed` and `epoch`, so a level is the same
 * level every time it is played and the solver measures the one the player gets.
 *
 * A wind shift bumps `epoch`, which re-rolls the eddy phases and rebuilds from nothing.
 * That is a lie about the transient — really the old ribbon would hang about, bending
 * and shredding, for a minute or so. It is a deliberate one: the honest version is a
 * field of unreadable debris, and "everything you knew is now wrong" lands better as a
 * clean break than as a slow smear.
 */
export function buildField(
  world: World,
  sources: Source[],
  wind: Wind,
  seed: number,
  epoch = 0,
): Field {
  const rng = mulberry32(seed * 7919 + epoch * 104729 + 1);
  const phases = OCTAVES.map(() => rng() * Math.PI * 2);

  const puffs: Puff[] = [];
  for (const source of sources) {
    puffs.push(...streamAir(world.walls, source, wind, phases));
    puffs.push(...layTrail(source));
  }

  return { puffs, wind, sources };
}

/** Where the wind is coming *from* — the direction to walk to close on a source. */
export function upwind(wind: Wind): number {
  return wind.heading + Math.PI;
}
