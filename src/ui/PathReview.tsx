import { FieldPlan } from '@/ui/FieldPlan';
import { RunPath } from '@/ui/RunPath';
import type { RunState } from '@/game/run';

/**
 * Starting over, but shown the walk first: your line and the points you sampled from,
 * drawn over a blank sheet. It is feedback that cannot spoil the field — enough to see
 * that you quartered the same corner three times, and not enough to say where the corner
 * was — so unlike the debrief it can be given away for free.
 */
export function PathReview({ state, onRestart }: { state: RunState; onRestart: () => void }) {
  return (
    <div className="sheet">
      <div className="sheet__inner">
        <p className="sheet__eyebrow">YOUR WALK</p>
        <h2 className="sheet__title">
          {state.sniffs} sniff{state.sniffs === 1 ? '' : 's'} · {state.moves} move
          {state.moves === 1 ? '' : 's'}
        </h2>
        <div className="sheet__plan">
          {/* The plan is passed in only for its size and its wind; nothing of the
              ground is revealed, so what shows is the walk on an empty sheet. */}
          <FieldPlan level={{ ...state.level, world: { ...state.level.world, walls: [] } }}>
            <RunPath state={state} />
          </FieldPlan>
        </div>
        <button type="button" className="btn btn--accent" onClick={onRestart}>
          GO BACK OUT
        </button>
      </div>
    </div>
  );
}
