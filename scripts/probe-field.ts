/**
 * Is each level actually followable?
 *
 *   npm run field
 *
 * A room either has a doorway or it does not, and you can see which by looking at it.
 * A plume is different in kind: it is grown by the physics from a seed, and it can
 * perfectly well grow somewhere useless — pinned flat against a wall, threading a gap
 * the level never meant it to, or missing the player's whole corner of the field. None
 * of that is visible in the level file, and from the inside a broken level and a merely
 * hard one feel exactly alike. `npm run solve` cannot catch it either: the solver knows
 * where everything is and walks straight there without smelling anything.
 *
 * The measurement lives in `assess.ts`, and what it means is documented there. This file
 * runs it over the set and decides what counts as a fault.
 *
 * A level that fails is not difficult, it is broken, and the fix is usually one number:
 * the `seed`, which is what decides where the ribbon goes.
 */

import { assess, type Assessment } from './assess';
import { LEVELS } from '../src/game/levels';

function line(a: Assessment): string {
  return (
    `start ${a.atStart ? a.atStart.strength.toFixed(3) + '/' + a.atStart.age.toFixed(0) + 's' : '  —      '}  ` +
    `nearest ${a.nearest === Infinity ? ' none' : a.nearest.toFixed(1).padStart(5)}u  ` +
    `best-near ${a.bestNear.toFixed(3)}  ` +
    `hop ${a.longestHop.toFixed(1).padStart(4)}u  ` +
    `cover ${(a.coverage * 100).toFixed(0).padStart(3)}%  ` +
    `contacts ${String(a.contacts).padStart(4)}`
  );
}

let bad = 0;
for (const level of LEVELS) {
  const runs: Assessment[] = [];
  for (let e = 0; e <= (level.shifts?.length ?? 0); e++) runs.push(assess(level, e));

  const faults = runs.flatMap((a) =>
    a.faults.map((f) => (a.epoch === 0 ? f : `epoch ${a.epoch}: ${f}`)),
  );
  const broken = faults.some((f) => !f.startsWith('cold open'));
  if (broken) bad++;

  const tag = broken ? 'BROKEN ' : faults.length ? 'warn   ' : 'ok     ';
  console.log(
    `${level.id.padEnd(16)} ${tag}${line(runs[0])}${level.detour ? `  [detour ${level.detour}u]` : ''}`,
  );
  for (const a of runs.slice(1)) console.log(`${''.padEnd(24)}epoch ${a.epoch}: ${line(a)}`);
  for (const f of faults) console.log(`${''.padEnd(24)}${f}`);
}

console.log(bad ? `\n${bad} level(s) are not followable` : '\nevery level can be followed in');
