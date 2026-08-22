import { FieldPlan } from '@/ui/FieldPlan';
import type { Level } from '@/game/levels';

/**
 * Easy mode, before the hunt starts: the ground you are about to walk, and the wind
 * across it. Never where the quarry is and never where you are — those are the questions
 * a nose is for, and answering them would leave nothing to play.
 */
export function FieldPreview({ level, onBegin }: { level: Level; onBegin: () => void }) {
  return (
    <div className="sheet">
      <div className="sheet__inner">
        <p className="sheet__eyebrow">THE GROUND</p>
        <h2 className="sheet__title">{level.name}</h2>
        <div className="sheet__plan">
          <FieldPlan level={level} />
        </div>
        <p className="sheet__note">
          Dashed walls let the air through. Solid ones do not.
        </p>
        <button type="button" className="btn btn--accent" onClick={onBegin}>
          GO OUT
        </button>
      </div>
    </div>
  );
}
