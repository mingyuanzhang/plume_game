# Plume

**Play it: <https://mingyuanzhang.github.io/plume_game/>**

A hunt by scent, for the browser. Sibling to
[echo](https://github.com/mingyuanzhang/echo_game) and
[field](https://github.com/mingyuanzhang/field_game), and built on the same bones: one
sense, modelled honestly, and a game made out of what that sense cannot tell you.

The thing this one is about is that **odour does not form a gradient you can climb.** A
source in wind does not sit inside tidy concentric rings of smell. The wind carries its
output downwind as a thin ribbon and turbulence drags that ribbon sideways as it goes, so
what is actually out there is a long, narrow, wandering filament with clean air either
side of it. A metre off it there is nothing at all. This is why a moth does not walk up a
gradient — there isn't one — and instead *casts*: hold upwind while you are touching the
filament, and when you lose it, sweep across the wind until you touch it again.

Twenty fields, from one ribbon in open country to hedgerows that let the smell through
and not you, plumes that are the wrong animal, smoke that makes clean air and a masked
contact feel identical, cold trails on the ground that record which way something walked,
and a wind that turns halfway and makes everything you have learned a description of air
that is no longer there.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static files in dist/, deployable anywhere
```

No server component and no external requests — `dist/` can be dropped onto any static
host, in any subdirectory.

## Playing

| | |
|---|---|
| click / tap | put your nose that way and sample |
| shift-click, or `TURN` then click | face that way, taking nothing |
| `space` | step |
| `R` | restart (once to see your walk, again to go back out) |
| `esc` | the record |

A sniff returns four things, and the design of the game is that **each one answers
exactly one question and lies about the others.**

**Strength** says *am I on the ribbon.* It is a terrible rangefinder. A ribbon dilutes
sideways and its puffs overlap along it, so concentration falls roughly as the square
root of distance — across a whole field, a far contact is perhaps a third of a near one,
not a hundredth. Reading range off strength will walk you into the next county.

**Age** says *how far along the ribbon am I*, and it never lies. A puff's age is exactly
its travel time from the source, so it rises down the plume no matter how the ribbon
wanders, what it has been dragged through, or how faint it has got. A weak *young* whiff
means a near source. A strong *old* one means you are standing in the wide, tired end of
something a long way off. This is the channel the game is built on, which is why it gets
a numeral on every mark rather than only a shade.

**Which side** says *where the middle of it is*, and only once you are properly inside.
One sniff samples two points a head's sweep apart, the way a tracking dog reads a trail;
near the middle of a ribbon there is a real gradient across that span, and out at the
ragged edge it is a coin toss. Learning when to believe it is most of the skill.

**What it is** says whether this is even your animal. Some fields have two things
smelling at once, and where the plumes overlap neither answer is safe.

The wind is a fifth, free, and always on. It is the only fixed frame of reference out
there, which is why a level that turns it is doing the worst thing it can to you.

Sniffing is the expensive move and walking is the cheap one. This is the reverse of the
echolocation game and for a good reason: one call lights up a whole room, and one sniff is
a single point sample of an enormous field. The only way to learn the shape of anything is
to move — a cast is five or six steps on one heading with one sample at the end, not a
sample at every pace. Scoring starts at 1000 and pays for every sniff and step beyond the
field's optimum, so using the sense less always scores better.

Marks never fade. In a game about echoes the sound dies and you hold the room in your
head; here the marks *are* the map, a dozen point samples that only mean anything against
one another, and rubbing them out as you go would leave nothing to play with.

Progress lives in `localStorage` under `plume.progress.v1`.

## Layout

```
src/game/      the game, with no idea it is on a web page
  world.ts       ground truth: walls, and what each one does to air
  geometry.ts    ray casting and barrier crossing, shared by the air and by bodies
  field.ts       the plume, grown forward in time from a seed
  olfaction.ts   smell as a pure projection of that field
  levels.ts      20 fields, their winds, and the verified cost of each
  run.ts         one hunt, as pure state transitions
  render/        how a sniff becomes something you can look at
  progress.ts    what survives between visits
src/ui/        React components, canvas, and CSS
scripts/       the solver, the followability probe, and a headless smoke test
```

`src/game/` is dependency-free TypeScript that knows nothing about React, the DOM or the
canvas. `sniff()` returns physical facts about what is at a nose, and a renderer decides
whether those become marks on a screen or something else.

## The model

Lagrangian, after the filament models used in moth-tracking work. Run the air forward from
twenty-seven seconds ago to now; on every tick each live puff is advected one step by the
wind plus a crosswind eddy velocity, and the source emits a new puff. Every puff alive at
an instant feels the *same* eddy velocity, and they were born at different instants, so a
puff's lateral offset is the running integral of that velocity over its own lifetime —
which is a smooth wave in downwind distance. The ribbon comes out coherent and meandering,
and neither property had to be drawn by hand.

Two things fall out of it that the game then rests on, and they are the reason for the
split between strength and age described above.

A puff that meets something solid is finished. The plume does not pass through a wall, so
downwind of one is a genuine hole in the world, and what survives is whatever threaded a
gap — which is why a doorway downwind of a source becomes a narrow jet of scent, and why
following your nose is often how you find the door. A **hedge** is different: it takes
about half of what crosses it and hands back something wider and vaguer, so you can smell
straight through one and not walk through it. A **fence** barely touches the air at all,
which makes it the cruellest thing in the set — a strong, young, unambiguous contact and
no way to walk toward it. Every wall stops a body completely; only some stop the air, and
that gap between what you can smell and where you can go is the whole game.

Ground scent works the other way round: it does not advect, barely spreads, and lasts. A
walked trail is a record of where something *was*, and because the odour ages along it, of
which way it was going. Two samples a few paces apart is all it takes, which is roughly
what it takes a real dog.

## Verifying it

```bash
npm run solve    # exhaustive search for every field's optimum
npm run field    # every plume is still followable from the start
npm run smoke    # every screen renders, and a nose still works
npm run build    # typecheck and bundle
```

The first two are both acceptance tests and they check different things. Neither is
sufficient alone.

`npm run solve` searches headings and step counts for the cheapest route to each quarry,
then replays what it finds through the actual game reducer and checks the result scores
exactly 1000. A clean run proves the movement model, the field geometry, the capture test
and the scoring all still agree with the numbers in `levels.ts`. It searches in *legs* —
one sniff plus every step taken on that heading — and ignores silent turns on purpose: a
searcher allowed to turn for free already knows where everything is and would win every
field on no sniffs at all, which would set par at zero and make every sniff you ever took
a penalty.

That solver never smells anything, which is exactly why the second script exists. A room
either has a doorway or it does not, and you can see which by looking at it. A plume is
grown by the physics from a seed, and it can perfectly well grow somewhere useless —
pinned against a wall, threading a gap the level never meant it to, missing the player's
whole corner of the field. From the inside a broken level and a hard one feel identical.
`npm run field` checks the thing the game actually asks of a player: that there is a chain
of detectable contacts running from where you start to what you are hunting, each younger
than the last and each a short *walk* — not a short straight line — from the one before.

Which is why every level carries a `seed`. It is not decoration. It is the specific plume
that level was designed around, and changing it authors a different level.

Two categories of level are told about themselves in the file, because otherwise the probe
would report the design as the bug. A level with `detour` set is built around a barrier the
air crosses and a body cannot, so the chain of falling age is *meant* to break there and
going the long way round is the puzzle. And `foul-air` opens on a strong, confident reading
of the wrong animal, so the probe's complaint that the quarry is seventeen units away is
correct and is the point.

## Hosting

Pushing to `main` builds and publishes to GitHub Pages via `.github/workflows/deploy.yml`,
which also runs all three checks. This needs enabling once, by hand: **Settings → Pages →
Build and deployment → Source → GitHub Actions**, not "Deploy from a branch" — see the
comments at the top of the workflow for why the branch option fails in the worst possible
way.
