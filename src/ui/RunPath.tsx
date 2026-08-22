import type { RunState } from '@/game/run';

/**
 * Where you went and where you stopped to sample, as an overlay for whichever plan is
 * underneath. Kept apart from the plan itself because the two are shown in different
 * combinations: the walk over a blank sheet on a restart, and the walk over the real
 * ground plan once the hunt is over.
 */
export function RunPath({ state }: { state: RunState }) {
  return (
    <>
      <polyline
        points={state.path.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke="#E6F2EC"
        strokeOpacity="0.55"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
      {state.samples.map((s, i) => (
        <circle key={i} cx={s.at.x} cy={s.at.y} r="0.9" fill="#7FD8FF" fillOpacity="0.75" />
      ))}
      <circle cx={state.path[0].x} cy={state.path[0].y} r="1.1" fill="#E6F2EC" />
      <circle
        cx={state.pos.x}
        cy={state.pos.y}
        r="1.3"
        fill="none"
        stroke="#E6F2EC"
        strokeWidth="0.45"
      />
    </>
  );
}
