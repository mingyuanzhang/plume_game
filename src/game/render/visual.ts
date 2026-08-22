/**
 * One presentation of a sniff: marks on a screen. Everything here is a choice about how
 * to *show* smell, which is exactly why it lives apart from `olfaction.ts` — a different
 * renderer would consume the same `Sniff` values and make entirely different ones.
 *
 * The problem this file exists to solve is bandwidth. A call in a game about echoes
 * returns three hundred arrivals and paints a picture of a room in one go. A sniff
 * returns *one sample at one point*, and a whole level is a dozen of them. There is no
 * picture to paint. So the marks are not a view of the field — they are a record of what
 * you have found out, they never fade, and the map is the one you built.
 *
 * Four channels have to survive on a single mark, so each gets a perceptual dimension of
 * its own and they are kept from colliding:
 *
 *   odorant    hue family     — what this is
 *   age        lightness      — how far along the plume, and the honest channel, so it
 *                               also gets a numeral: this is the one you do arithmetic on
 *   strength   size           — how firmly you are in it
 *   lateral    a tick, offset — which way its middle lies
 *
 * A sniff that found nothing gets a mark too, and that is deliberate. An absence is a
 * fact about where you were standing and usually the most useful one going; drawing
 * nothing would lose it, and leave the map unable to tell "clean air here" from "never
 * looked here".
 */

import type { Odorant, Wind } from '../field';
import type { Reading, Sniff } from '../olfaction';
import type { Material, Vec2, World } from '../world';

/**
 * Hue and saturation per odorant. A narrow palette on purpose — smell should read as one
 * sense with things to tell apart in it, not as a colour-coded map.
 */
const ODOUR_HUE: Record<Odorant, [number, number]> = {
  quarry: [34, 92],
  carrion: [86, 44],
  bloom: [278, 62],
  smoke: [220, 8],
};

/** Walls, for the plans that are allowed to show them. */
export const MATERIAL_COLOR: Record<Material, string> = {
  stone: '#6E7A82',
  timber: '#8A6F52',
  hedge: '#4C7A4E',
  rail: '#5C6470',
};

/** Dashed on a plan, because these are the ones odour walks straight through. */
export function isPorous(material: Material): boolean {
  return material === 'hedge' || material === 'rail';
}

/**
 * Oldest air and oldest ground odour the lightness ramp covers, in seconds. Air is bounded
 * by how long a puff is carried before the model drops it; ground scent long outlives it,
 * so the two carriers get their own scales or every trail would read as uniformly ancient.
 */
const OLDEST = { air: 28, ground: 150 };

/** 0 for the freshest thing you can smell, 1 for the oldest. */
export function staleness(reading: Reading, borne: 'air' | 'ground'): number {
  return Math.min(1, Math.max(0, reading.age / OLDEST[borne]));
}

/**
 * Colour for a reading. Young odour is bright and saturated; old odour sinks toward the
 * background without ever quite reaching it. The ramp is on lightness rather than alpha
 * so that a faint-but-fresh contact and a strong-but-stale one stay told apart — those
 * two being confusable is precisely the mistake the game is about.
 */
export function odourColor(reading: Reading, borne: 'air' | 'ground', alpha = 1): string {
  const [h, s] = ODOUR_HUE[reading.odorant];
  const old = staleness(reading, borne);
  const light = 74 - old * 44;
  const sat = s * (1 - old * 0.45);
  // A muddled reading is drained of colour, which is the honest way to show that the
  // odorant it names is only just the majority of what is there.
  const mixed = reading.share < 0.72 ? 0.55 : 1;
  return `hsla(${h}, ${sat * mixed}%, ${light}%, ${alpha})`;
}

/**
 * Radius of an air mark, in world units. Strength is compressed hard: it spans a decade
 * across a level and the low end is where all the interesting reading happens, so a
 * linear map would draw every distant contact as the same invisible speck.
 */
export function markRadius(strength: number): number {
  return 0.7 + Math.pow(Math.min(1, strength), 0.55) * 2.1;
}

/** Half-width of a ground mark's diamond, in world units. */
export function groundRadius(strength: number): number {
  return 0.6 + Math.pow(Math.min(1, strength), 0.55) * 1.4;
}

/**
 * How far off centre the stereo tick sits, in world units, and which way. Positive
 * `lateral` means the left of your heading answered louder.
 */
export function tickOffset(reading: Reading): number {
  return reading.lateral * 2.6;
}

/** A sniff that found nothing still gets drawn. This is how big that nothing is. */
export const EMPTY_RADIUS = 0.55;

export type Viewport = {
  /** Screen pixels per world unit. */
  scale: number;
  /** Screen offset of the world origin. */
  ox: number;
  oy: number;
};

/** Fit an entire field inside a screen rect, centered. */
export function fitViewport(world: World, width: number, height: number): Viewport {
  const scale = Math.min(width / world.size.w, height / world.size.h);
  return {
    scale,
    ox: (width - world.size.w * scale) / 2,
    oy: (height - world.size.h * scale) / 2,
  };
}

export function toScreen(p: Vec2, v: Viewport): { x: number; y: number } {
  return { x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale };
}

export function toWorld(p: { x: number; y: number }, v: Viewport): Vec2 {
  return { x: (p.x - v.ox) / v.scale, y: (p.y - v.oy) / v.scale };
}

/**
 * Drifting motes, so the wind is visible without being spelled out. Free information,
 * always on, and the only fixed frame of reference in the game — which is what makes
 * taking it away, by turning it, the worst thing a level can do to you.
 *
 * Positions are generated from an index rather than stored, so the field can be resized
 * or the level restarted without a swarm of particles having to be kept anywhere.
 */
export const MOTES = 90;

export function motePosition(
  i: number,
  t: number,
  wind: Wind,
  world: World,
): { x: number; y: number; alpha: number } {
  // Two irrationals, so the lanes never line up into a visible grid.
  const lane = ((i * 0.6180339887) % 1) * 1.4 - 0.2;
  const phase = (i * 0.7548776662) % 1;
  const span = Math.hypot(world.size.w, world.size.h) * 1.2;

  // Distance travelled along the wind, wrapped, and offset per mote so they are strung
  // out rather than marching in rank.
  const travel = ((t * wind.speed * 0.55) / span + phase) % 1;

  const cx = world.size.w / 2;
  const cy = world.size.h / 2;
  const dx = Math.cos(wind.heading);
  const dy = Math.sin(wind.heading);

  const along = (travel - 0.5) * span;
  const across = (lane - 0.5) * span;

  return {
    x: cx + dx * along - dy * across,
    y: cy + dy * along + dx * across,
    // Fade in and out at the ends of the run so motes do not pop into being.
    alpha: Math.sin(travel * Math.PI) * 0.5,
  };
}

/** Everything one mark needs to be drawn, worked out from a sniff. */
export type Mark = {
  at: Vec2;
  facing: number;
  air: Reading | null;
  ground: Reading | null;
  haze: number;
  /** Dimmed heavily: this was sampled under a wind that is no longer blowing. */
  stale: boolean;
};

export function markOf(sniff: Sniff, epoch: number, currentEpoch: number): Mark {
  return {
    at: sniff.at,
    facing: sniff.facing,
    air: sniff.air,
    ground: sniff.ground,
    haze: sniff.haze,
    stale: epoch !== currentEpoch,
  };
}
