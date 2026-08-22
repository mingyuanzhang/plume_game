import type { ReactNode } from 'react';

import { isPorous, MATERIAL_COLOR } from '@/game/render/visual';
import type { Level } from '@/game/levels';

type Props = {
  level: Level;
  /** Show what is actually out there: the quarry, the decoys, the source of the smoke. */
  reveal?: boolean;
  children?: ReactNode;
};

/**
 * The ground plan, as SVG. A `viewBox` matching the world means every coordinate in here
 * is a world coordinate and nothing has to be projected by hand.
 *
 * Porous walls are drawn dashed. That is the one distinction the plan has to make, since
 * it is the distinction the whole field is built on: a dashed line is something the air
 * goes straight through and you do not.
 */
export function FieldPlan({ level, reveal = false, children }: Props) {
  const { world, wind } = level;
  const cx = world.size.w / 2;
  const cy = world.size.h / 2;
  const arrow = Math.min(world.size.w, world.size.h) * 0.16;

  return (
    <svg
      className="plan"
      viewBox={`0 0 ${world.size.w} ${world.size.h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true">
      {/* The wind, drawn faintly across the middle so the plan has an up-wind. */}
      <g opacity="0.3">
        <line
          x1={cx - Math.cos(wind.heading) * arrow}
          y1={cy - Math.sin(wind.heading) * arrow}
          x2={cx + Math.cos(wind.heading) * arrow}
          y2={cy + Math.sin(wind.heading) * arrow}
          stroke="#9FD8C8"
          strokeWidth="0.4"
          strokeDasharray="1.4 1.4"
        />
        <circle
          cx={cx + Math.cos(wind.heading) * arrow}
          cy={cy + Math.sin(wind.heading) * arrow}
          r="0.9"
          fill="#9FD8C8"
        />
      </g>

      {world.walls.map((seg, i) => (
        <line
          key={i}
          x1={seg.a.x}
          y1={seg.a.y}
          x2={seg.b.x}
          y2={seg.b.y}
          stroke={MATERIAL_COLOR[seg.material]}
          strokeWidth="0.7"
          strokeLinecap="round"
          strokeDasharray={isPorous(seg.material) ? '1.6 1.2' : undefined}
        />
      ))}

      {reveal &&
        level.sources.map((source, i) => {
          const isQuarry = source.odorant === 'quarry';
          return (
            <g key={i}>
              {source.trail && (
                <polyline
                  points={source.trail.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#FFB454"
                  strokeOpacity="0.4"
                  strokeWidth="0.5"
                  strokeDasharray="0.9 0.9"
                />
              )}
              <circle
                cx={source.at.x}
                cy={source.at.y}
                r={isQuarry ? 1.7 : 1.2}
                fill={isQuarry ? '#FFB454' : source.odorant === 'smoke' ? '#8A8F99' : '#8FBF5A'}
                fillOpacity={isQuarry ? 0.95 : 0.5}
              />
            </g>
          );
        })}

      {children}
    </svg>
  );
}
