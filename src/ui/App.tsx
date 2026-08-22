import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { buildField, upwind } from '@/game/field';
import { LEVELS, MERCY_LEVELS } from '@/game/levels';
import { sniff, type Sniff } from '@/game/olfaction';
import { loadProgress, saveProgress, type Progress } from '@/game/progress';
import { odourColor, type Mark } from '@/game/render/visual';
import { initialRun, runReducer, scoreRun, turnsSpent, windAfter } from '@/game/run';
import { AllClear } from '@/ui/AllClear';
import { FieldPreview } from '@/ui/FieldPreview';
import { PathReview } from '@/ui/PathReview';
import { ProgressPage } from '@/ui/ProgressPage';
import { RunSummary } from '@/ui/RunSummary';
import { ScentField } from '@/ui/ScentField';

/** A sample, kept with the wind it was taken under. */
type Taken = { sniff: Sniff; epoch: number };

/**
 * The game. You never see the field while hunting — only what a nose brings back, one
 * point at a time. Sniffing is the expensive move and walking is the cheap one, which is
 * the reverse of a game about echoes and for a good reason: one call lights a whole room,
 * and one sniff is a single sample of an enormous field. The only way to learn the shape
 * of anything out here is to move.
 */
export function App() {
  // Read from storage once, on the first render. It is a synchronous read, so the right
  // field is up before the first frame and there is no flicker of level one on the way
  // to wherever the player actually left off.
  const [progress, setProgress] = useState<Progress>(() => loadProgress(LEVELS.length));
  const [state, dispatch] = useReducer(runReducer, progress.level, (level) =>
    initialRun(LEVELS[level]),
  );

  const [taken, setTaken] = useState<Taken[]>([]);
  const [finished, setFinished] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [studying, setStudying] = useState(progress.easy);
  const [reviewing, setReviewing] = useState(false);
  /**
   * Armed for a silent turn: the next press on the field points you instead of sampling.
   * A one-shot rather than a mode, so there is never a state you can be stuck in without
   * noticing — the field looks the same either way, and a sniff you meant to take coming
   * out as a pivot would read as the game ignoring you.
   */
  const [turning, setTurning] = useState(false);

  const saved = useRef(progress);

  const update = useCallback((patch: Partial<Progress>) => {
    const next = { ...saved.current, ...patch };
    saved.current = next;
    setProgress(next);
    saveProgress(next);
  }, []);

  const { wind } = windAfter(state.level, turnsSpent(state));

  /**
   * The plume, as it stands. Rebuilt only when the level or the wind changes — it is a
   * few hundred puffs run forward through a few hundred ticks, which is far too much to
   * redo on every render and completely static in between.
   */
  const field = useMemo(
    () => buildField(state.level.world, state.level.sources, wind, state.level.seed, state.epoch),
    [state.level, state.epoch, wind],
  );

  useEffect(() => {
    if (state.status !== 'found') return;
    const score = scoreRun(state);
    const previous = saved.current.results[state.level.id];
    if (previous && previous.score >= score) return;
    update({
      results: {
        ...saved.current.results,
        [state.level.id]: { score, sniffs: state.sniffs, moves: state.moves },
      },
    });
  }, [state, update]);

  const playing = state.status === 'hunting';
  const levelIndex = LEVELS.findIndex((l) => l.id === state.level.id);
  const lastLevel = levelIndex === LEVELS.length - 1;
  const fieldLive = playing && !studying && !showProgress && !finished && !reviewing;

  /**
   * Marks never fade. In a game about echoes the sound dies and you have to hold the room
   * in your head; here what you have is a dozen point samples that only mean anything
   * against one another, so the record of them *is* the map and rubbing it out as you go
   * would leave nothing to play with.
   */
  const marks: Mark[] = useMemo(
    () =>
      taken.map(({ sniff: s, epoch }) => ({
        at: s.at,
        facing: s.facing,
        air: s.air,
        ground: s.ground,
        haze: s.haze,
        stale: epoch !== state.epoch,
      })),
    [taken, state.epoch],
  );

  const latest = taken.length ? taken[taken.length - 1] : null;

  const onSniff = useCallback(
    (heading: number) => {
      if (state.status !== 'hunting') return;
      const reading = sniff(state.level.world, field, state.pos, heading);
      setTaken((prev) => [...prev, { sniff: reading, epoch: state.epoch }]);
      dispatch({ type: 'SNIFF', heading });
      setTurning(false);
    },
    [field, state.epoch, state.level.world, state.pos, state.status],
  );

  /**
   * Turning costs nothing and returns nothing. Samples already taken are left exactly
   * where they are — unlike a step, a pivot does not move the nose they were measured
   * from, so they go on being true while you decide where to walk.
   */
  const onTurn = useCallback((heading: number) => {
    dispatch({ type: 'TURN', heading });
    setTurning(false);
  }, []);

  const onStep = useCallback(() => {
    setTurning(false);
    dispatch({ type: 'STEP' });
  }, []);

  const restartNow = useCallback(() => {
    setTaken([]);
    setReviewing(false);
    setTurning(false);
    setStudying(saved.current.easy);
    dispatch({ type: 'RESTART' });
  }, []);

  const onRestart = useCallback(() => {
    if (state.status !== 'hunting' || (state.sniffs === 0 && state.moves === 0)) {
      restartNow();
      return;
    }
    setReviewing(true);
  }, [restartNow, state.moves, state.sniffs, state.status]);

  const loadLevel = useCallback(
    (index: number) => {
      const level = LEVELS[index];
      if (!level) return;
      setTaken([]);
      setReviewing(false);
      setTurning(false);
      // Written on arrival rather than on completion, so leaving the page halfway through
      // a field puts you back in that field and not the one before it.
      update({ level: index });
      setStudying(saved.current.easy);
      dispatch({ type: 'LOAD', level });
    },
    [update],
  );

  const advance = useCallback(
    () => (lastLevel ? setFinished(true) : loadLevel(levelIndex + 1)),
    [lastLevel, levelIndex, loadLevel],
  );

  const canGiveUp = levelIndex < MERCY_LEVELS;

  const onEasyChange = (easy: boolean) => {
    update({ easy });
    setStudying(easy && playing && state.sniffs === 0 && state.moves === 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        if (showProgress) setShowProgress(false);
        else if (!finished) setShowProgress(true);
        return;
      }

      if (e.key === ' ' || e.key === 'Enter') {
        // A focused control inside the record owns its own keys. Swallowing enter here
        // would make the list unreachable from the keyboard.
        if (e.target instanceof HTMLElement && e.target.closest('.record')) return;

        e.preventDefault();
        if (showProgress) setShowProgress(false);
        else if (reviewing) restartNow();
        else if (finished) return;
        else if (studying && playing) setStudying(false);
        else if (!playing) advance();
        else onStep();
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        if (showProgress || finished || studying) return;
        e.preventDefault();
        // A second press confirms the first: R puts the walk up, R again goes back out.
        if (reviewing) restartNow();
        else onRestart();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    advance,
    finished,
    onRestart,
    onStep,
    playing,
    restartNow,
    reviewing,
    showProgress,
    studying,
  ]);

  return (
    <div className="app">
      <div className="shell">
        <header className="hud">
          <button type="button" className="hud__level" onClick={() => setShowProgress(true)}>
            <span className="hud__count-row">
              <span className="hud__count">
                {levelIndex + 1} / {LEVELS.length}
              </span>
              <span className="hud__link">RECORD</span>
            </span>
            <span className="hud__name">{state.level.name}</span>
          </button>

          <div className="hud__counters">
            <Compass wind={upwind(wind)} />
            <Counter label="SNIFFS" value={state.sniffs} />
            <Counter label="MOVES" value={state.moves} />
          </div>
        </header>

        <main className="field-wrap">
          <ScentField
            world={state.level.world}
            wind={wind}
            pos={state.pos}
            heading={state.heading}
            marks={marks}
            path={state.path}
            interactive={fieldLive}
            turning={turning}
            onSniff={onSniff}
            onTurn={onTurn}
          />
        </main>

        <footer className="footer">
          <Readout taken={latest} stale={latest ? latest.epoch !== state.epoch : false} />

          <p className={`hint ${turning ? 'is-turning' : ''}`}>
            {turning ? (
              <>
                <span className="only-touch">tap a direction to face it — no sample</span>
                <span className="only-pointer">click a direction to face it — no sample</span>
              </>
            ) : state.blocked ? (
              'something solid — you stopped short'
            ) : (
              <>
                <span className="only-touch">tap to put your nose that way</span>
                <span className="only-pointer">click to put your nose that way</span>
              </>
            )}
          </p>

          <div className="buttons">
            <button type="button" className="btn btn--accent" onClick={onStep} disabled={!playing}>
              STEP
            </button>
            {/* Free, and free of information. Lights up while armed, because an armed
                field looks exactly like an unarmed one. */}
            <button
              type="button"
              className={`btn ${turning ? 'btn--armed' : 'btn--dim'}`}
              aria-pressed={turning}
              onClick={() => setTurning((on) => !on)}
              disabled={!playing}>
              TURN
            </button>
            {canGiveUp ? (
              <button
                type="button"
                className="btn btn--dim"
                onClick={() => dispatch({ type: 'GIVE_UP' })}
                disabled={!playing}>
                GIVE UP
              </button>
            ) : (
              <button type="button" className="btn btn--dim" onClick={onRestart} disabled={!playing}>
                RESTART
              </button>
            )}
            {/* Leaves without a debrief, which is the whole difference from giving up:
                the ground stays unseen, so skipping costs you the answer as well. */}
            <button type="button" className="btn btn--dim" onClick={advance}>
              SKIP
            </button>
          </div>

          <p className="keys only-pointer">
            <kbd>space</kbd> step <span className="keys__sep">·</span> <kbd>shift</kbd>+click turn{' '}
            <span className="keys__sep">·</span> <kbd>R</kbd> restart{' '}
            <span className="keys__sep">·</span> <kbd>esc</kbd> record
          </p>
        </footer>
      </div>

      {studying && playing && (
        <FieldPreview level={state.level} onBegin={() => setStudying(false)} />
      )}

      {reviewing && playing && <PathReview state={state} onRestart={restartNow} />}

      {!playing && !finished && (
        <RunSummary
          state={state}
          onRestart={restartNow}
          onNext={advance}
          nextLabel={lastLevel ? 'FINISH' : 'NEXT'}
        />
      )}

      {finished && (
        <AllClear
          levels={LEVELS.length}
          onProgress={() => setShowProgress(true)}
          onAgain={() => {
            setFinished(false);
            loadLevel(0);
          }}
        />
      )}

      {showProgress && (
        <ProgressPage
          progress={progress}
          current={levelIndex}
          onEasyChange={onEasyChange}
          onSelect={(index) => {
            setFinished(false);
            loadLevel(index);
            setShowProgress(false);
          }}
          onClose={() => setShowProgress(false)}
        />
      )}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="counter">
      <div className="counter__label">{label}</div>
      <div className="counter__value">{value}</div>
    </div>
  );
}

/** Which way is upwind. Free, always on, and the only fixed thing out here. */
function Compass({ wind }: { wind: number }) {
  return (
    <div className="counter counter--compass">
      <div className="counter__label">UPWIND</div>
      <svg viewBox="-10 -10 20 20" className="compass" aria-hidden="true">
        <circle r="9" fill="none" stroke="rgba(159,216,200,0.25)" strokeWidth="1" />
        {/* An arrow, not a bare line. A line through the middle points both ways at
            once, and which of the two is upwind is the one thing this exists to say. */}
        <g transform={`rotate(${(wind * 180) / Math.PI})`}>
          <line x1={-6} y1={0} x2={4} y2={0} stroke="#9FD8C8" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M 8 0 L 2.5 -3.4 L 2.5 3.4 Z" fill="#9FD8C8" />
        </g>
      </svg>
    </div>
  );
}

/**
 * The last sample, spelled out. The marks on the field carry the same four channels in
 * colour and size and are what you read the *shape* of the plume from; this is for the
 * one number you are actually doing arithmetic with.
 */
function Readout({ taken, stale }: { taken: Taken | null; stale: boolean }) {
  if (!taken) {
    return <p className="readout readout--idle">nothing sampled yet</p>;
  }

  const { air, ground, haze } = taken.sniff;
  if (!air && !ground) {
    return (
      <p className="readout readout--empty">
        clean air{haze > 0.05 ? ' — thick with smoke' : ''}
        {stale ? ' · the wind has changed since' : ''}
      </p>
    );
  }

  const lead = air ?? ground!;
  const borne = air ? 'air' : 'ground';

  return (
    <p className="readout" style={{ color: odourColor(lead, borne) }}>
      <span className="readout__odour">{lead.odorant}</span>
      <span className="readout__sep">·</span>
      {borne === 'air' ? 'on the wind' : 'on the ground'}
      <span className="readout__sep">·</span>
      <span className="readout__age">{Math.round(lead.age)}s old</span>
      <span className="readout__sep">·</span>
      {strengthWord(lead.strength)}
      {lead.share < 0.72 && <span className="readout__warn"> · mixed</span>}
      {haze > 0.05 && <span className="readout__warn"> · smoke</span>}
      {stale && <span className="readout__warn"> · the wind has changed since</span>}
    </p>
  );
}

function strengthWord(strength: number): string {
  if (strength > 0.45) return 'strong';
  if (strength > 0.22) return 'clear';
  if (strength > 0.1) return 'faint';
  return 'a trace';
}
