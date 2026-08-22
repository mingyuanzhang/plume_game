import { LEVELS } from '@/game/levels';
import { grade } from '@/game/run';
import type { Progress } from '@/game/progress';

type Props = {
  progress: Progress;
  current: number;
  onEasyChange: (easy: boolean) => void;
  onSelect: (index: number) => void;
  onClose: () => void;
};

/** The record. Every row is also a door: tap one to start that field from the top. */
export function ProgressPage({ progress, current, onEasyChange, onSelect, onClose }: Props) {
  const done = Object.keys(progress.results).length;
  const total = Object.values(progress.results).reduce((n, r) => n + r.score, 0);

  return (
    <div className="sheet sheet--full">
      <div className="sheet__inner">
        <p className="sheet__eyebrow">THE RECORD</p>
        <h2 className="sheet__title">
          {done} / {LEVELS.length} · {total}
        </h2>

        <label className="toggle">
          <input
            type="checkbox"
            checked={progress.easy}
            onChange={(e) => onEasyChange(e.target.checked)}
          />
          <span>
            Show the ground before each field — the walls and the wind, never the quarry
          </span>
        </label>

        <ol className="record">
          {LEVELS.map((level, i) => {
            const result = progress.results[level.id];
            return (
              <li key={level.id}>
                <button
                  type="button"
                  className={`record__row ${i === current ? 'is-current' : ''}`}
                  onClick={() => onSelect(i)}>
                  <span className="record__n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="record__name">{level.name}</span>
                  <span className="record__grade">{result ? grade(result.score) : '—'}</span>
                  <span className="record__score">{result ? result.score : ''}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <button type="button" className="btn btn--accent" onClick={onClose}>
          BACK
        </button>
      </div>
    </div>
  );
}
