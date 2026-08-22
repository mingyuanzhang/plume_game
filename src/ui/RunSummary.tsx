import { FieldPlan } from '@/ui/FieldPlan';
import { RunPath } from '@/ui/RunPath';
import { grade, scoreRun, type RunState } from '@/game/run';

type Props = {
  state: RunState;
  onRestart: () => void;
  onNext: () => void;
  nextLabel: string;
};

/**
 * The debrief. This is the only screen that shows the field as it actually was — the
 * walls, the quarry, the decoys, the trail it walked — and it is what finding the thing
 * buys you. Walking away buys nothing, which is the difference between giving up and
 * skipping: one shows you what you failed to read, the other does not.
 */
export function RunSummary({ state, onRestart, onNext, nextLabel }: Props) {
  const score = scoreRun(state);
  const { best } = state.level;
  const caught = state.status === 'found';

  return (
    <div className="sheet">
      <div className="sheet__inner">
        <p className="sheet__eyebrow">{caught ? 'CAUGHT' : 'WALKED AWAY'}</p>
        <h2 className="sheet__title">{grade(score)}</h2>

        <div className="tally">
          <Stat label="SCORE" value={score} />
          <Stat label="SNIFFS" value={state.sniffs} par={best.sniffs} />
          <Stat label="MOVES" value={state.moves} par={best.moves} />
        </div>

        <div className="sheet__plan">
          <FieldPlan level={state.level} reveal>
            <RunPath state={state} />
          </FieldPlan>
        </div>

        <div className="buttons">
          <button type="button" className="btn btn--dim" onClick={onRestart}>
            AGAIN
          </button>
          <button type="button" className="btn btn--accent" onClick={onNext}>
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, par }: { label: string; value: number; par?: number }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {par !== undefined && <div className="stat__par">par {par}</div>}
    </div>
  );
}
