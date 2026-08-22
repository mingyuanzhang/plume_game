/**
 * Ground truth. This module knows nothing about any sense — it describes what is
 * actually there, and a sense projects its own partial view of it. The same split as
 * the echolocation build it is a sibling to: keeping this layer sense-agnostic is what
 * lets smell read a world it does not own.
 */

export type Vec2 = { x: number; y: number };

export type Material = 'stone' | 'timber' | 'hedge' | 'rail';

export type Segment = { a: Vec2; b: Vec2; material: Material };

export type World = {
  walls: Segment[];
  /** Extent of the ground, used to fit the scene to a viewport. */
  size: { w: number; h: number };
};

/**
 * Fraction of odour that survives crossing a surface. This is the whole reason
 * materials exist here, and it is the one asymmetry the game is built on: **every wall
 * stops a body completely, and only some of them stop the air.** A hedge you cannot
 * walk through is a hedge scent walks through, so what you smell and where you can go
 * are two different maps of the same field.
 *
 * Nothing here is a reflectivity. Sound comes back; odour does not. It arrives having
 * been carried, and what a barrier does is take a share of it on the way past.
 */
export const POROSITY: Record<Material, number> = {
  stone: 0,
  timber: 0,
  // Enough through to be followable, little enough that the far side reads as a
  // different, weaker place — the tell that something is between you and the source.
  hedge: 0.45,
  // A fence. Barely touches the air and stops you dead, which is the cruellest thing
  // in the set: a strong, young contact and no way to walk toward it.
  rail: 0.85,
};

/**
 * How much a porous barrier stirs what passes through it, as extra plume radius in
 * world units. A hedge does not just attenuate — it shreds a coherent filament into a
 * wider, vaguer one, so odour that has crossed something reads as *smeared* as well as
 * faint. Distinguishing "far away" from "just behind a hedge" is the whole use of it.
 */
export const SCATTER: Record<Material, number> = {
  stone: 0,
  timber: 0,
  hedge: 1.5,
  rail: 0.35,
};

export function wall(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  material: Material,
): Segment {
  return { a: { x: ax, y: ay }, b: { x: bx, y: by }, material };
}

/** Four walls, clockwise. Sheds, planters and blocks are all just small closed boxes. */
export function box(
  x: number,
  y: number,
  w: number,
  h: number,
  material: Material,
): Segment[] {
  return [
    wall(x, y, x + w, y, material),
    wall(x + w, y, x + w, y + h, material),
    wall(x + w, y + h, x, y + h, material),
    wall(x, y + h, x, y, material),
  ];
}
