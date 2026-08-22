/**
 * Headless smoke test: does every screen render, and does a nose still work?
 *
 *   npm run smoke
 *
 * No substitute for looking at the thing, but it catches a crash in any screen — the
 * debrief and the end card are otherwise twenty fields away from being seen.
 */

import { renderToStaticMarkup } from 'react-dom/server';

import { buildField, upwind } from '../src/game/field';
import { LEVELS, quarryOf } from '../src/game/levels';
import { isEmpty, sniff, THRESHOLD } from '../src/game/olfaction';
import { grade, initialRun, runReducer, scoreRun, turnsSpent, windAfter } from '../src/game/run';
import { AllClear } from '../src/ui/AllClear';
import { App } from '../src/ui/App';
import { FieldPlan } from '../src/ui/FieldPlan';
import { FieldPreview } from '../src/ui/FieldPreview';
import { PathReview } from '../src/ui/PathReview';
import { ProgressPage } from '../src/ui/ProgressPage';
import { RunPath } from '../src/ui/RunPath';
import { RunSummary } from '../src/ui/RunSummary';

// Progress is read synchronously during the first render, so there has to be somewhere
// to read it from before anything mounts.
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
});

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// --- the sense -------------------------------------------------------------

const level = LEVELS[0];
const t0 = Date.now();
const field = buildField(level.world, level.sources, level.wind, level.seed);
const built = Date.now() - t0;

check('a field has puffs in it', field.puffs.length > 0, `${field.puffs.length} puffs`);
check('building one is fast enough to do on a level load', built < 400, `${built}ms`);
check(
  'no puff is older than the model carries',
  field.puffs.every((p) => p.age >= 0 && p.age <= 160),
);
check(
  'every puff has mass',
  field.puffs.every((p) => p.mass > 0 && p.radius > 0),
);

const source = quarryOf(level).at;
const beside = sniff(level.world, field, { x: source.x, y: source.y + 3 }, 0);
check('a nose beside the quarry finds it', !!beside.air, `strength ${beside.air?.strength.toFixed(3)}`);
check('and finds it young', (beside.air?.age ?? 99) < 4, `${beside.air?.age.toFixed(1)}s`);

const faraway = sniff(level.world, field, { x: 3, y: 3 }, 0);
check('a nose in the corner finds nothing', isEmpty(faraway));

// Age has to rise monotonically down the ribbon, because it is the channel the whole
// game asks the player to trust. Sampled at the strongest point of each transect so a
// ragged edge cannot masquerade as a reversal.
const ages: number[] = [];
for (let y = 14; y <= 46; y += 8) {
  let best = 0;
  let age = 0;
  for (let x = 3; x < level.world.size.w - 3; x += 0.5) {
    const s = sniff(level.world, field, { x, y }, 0).air;
    if (s && s.strength > best) {
      best = s.strength;
      age = s.age;
    }
  }
  ages.push(age);
}
check(
  'age rises with distance down the plume',
  ages.every((a, i) => i === 0 || a > ages[i - 1]),
  ages.map((a) => a.toFixed(0) + 's').join(' → '),
);

check('the detection floor is above nothing at all', THRESHOLD > 0 && THRESHOLD < 0.2);
check(
  'upwind is the reverse of the wind',
  Math.abs(Math.abs(upwind(level.wind) - level.wind.heading) - Math.PI) < 1e-9,
);

// --- the rules -------------------------------------------------------------

let run = initialRun(level);
run = runReducer(run, { type: 'SNIFF', heading: upwind(level.wind) });
check('sniffing costs a sniff and sets the heading', run.sniffs === 1 && run.samples.length === 1);

const before = run.pos;
run = runReducer(run, { type: 'STEP' });
check('stepping moves you', run.moves === 1 && (run.pos.x !== before.x || run.pos.y !== before.y));

const turned = runReducer(run, { type: 'TURN', heading: 0 });
check(
  'turning is free and tells you nothing',
  turned.sniffs === run.sniffs && turned.moves === run.moves && turned.samples.length === run.samples.length,
);

check('giving up scores nothing', scoreRun(runReducer(run, { type: 'GIVE_UP' })) === 0);
check('a grade comes back for every score', [0, 100, 500, 700, 900, 1000].every((s) => !!grade(s)));

// Wind shifts have to land on the turn they say they do, or every level that uses one
// is showing the player a field that does not match the marks they are reading.
const shifting = LEVELS.find((l) => l.shifts?.length);
if (shifting) {
  const after = shifting.shifts![0].after;
  check(
    'a wind shift lands on its turn',
    windAfter(shifting, after - 1).epoch === 0 && windAfter(shifting, after).epoch === 1,
    `${shifting.id} at turn ${after}`,
  );
  let walk = initialRun(shifting);
  while (turnsSpent(walk) < after && walk.status === 'hunting') {
    walk = runReducer(walk, { type: 'STEP' });
  }
  check('and the run notices', walk.status !== 'hunting' || walk.epoch === 1);
}

// --- every level is playable ------------------------------------------------

check(
  'every level names something to hunt',
  LEVELS.every((l) => {
    try {
      return !!quarryOf(l);
    } catch {
      return false;
    }
  }),
);
check(
  'every level has a par worth beating',
  LEVELS.every((l) => l.best.sniffs >= 1 && l.best.moves >= 1),
  'a par of zero sniffs would make the sense itself a penalty',
);
check('level ids are unique', new Set(LEVELS.map((l) => l.id)).size === LEVELS.length);

// --- every screen renders ---------------------------------------------------

const render = (name: string, node: React.ReactElement) => {
  try {
    check(name, renderToStaticMarkup(node).length > 0);
  } catch (e) {
    check(name, false, String(e));
  }
};

const won = { ...run, status: 'found' as const };
const progress = { level: 3, easy: false, results: { [level.id]: { score: 880, sniffs: 2, moves: 15 } } };

render('the game mounts', <App />);
render('the ground plan draws', <FieldPlan level={level} reveal />);
render('a walk draws over it', <FieldPlan level={level} reveal><RunPath state={won} /></FieldPlan>);
render('easy mode draws', <FieldPreview level={level} onBegin={() => {}} />);
render('the restart review draws', <PathReview state={won} onRestart={() => {}} />);
render('the debrief draws', <RunSummary state={won} onRestart={() => {}} onNext={() => {}} nextLabel="NEXT" />);
render(
  'the record draws',
  <ProgressPage progress={progress} current={3} onEasyChange={() => {}} onSelect={() => {}} onClose={() => {}} />,
);
render('the end card draws', <AllClear levels={LEVELS.length} onProgress={() => {}} onAgain={() => {}} />);

// A trail level, because the ground half of the sense has its own drawing path.
const trailLevel = LEVELS.find((l) => l.sources.some((s) => s.trail));
if (trailLevel) {
  const tf = buildField(trailLevel.world, trailLevel.sources, trailLevel.wind, trailLevel.seed);
  const ground = tf.puffs.filter((p) => p.borne === 'ground');
  check('a walked trail lands on the ground', ground.length > 10, `${ground.length} deposits`);
  const path = trailLevel.sources.find((s) => s.trail)!.trail!;
  const oldEnd = sniff(trailLevel.world, tf, path[0], 0).ground;
  const freshEnd = sniff(trailLevel.world, tf, path[path.length - 1], 0).ground;
  check('both ends of it can be smelled', !!oldEnd && !!freshEnd);
  check(
    'and the far end is older, which is how you read the way it went',
    (oldEnd?.age ?? 0) > (freshEnd?.age ?? 0),
    `${oldEnd?.age.toFixed(0)}s vs ${freshEnd?.age.toFixed(0)}s`,
  );
  render('a trail level draws its plan', <FieldPlan level={trailLevel} reveal />);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
