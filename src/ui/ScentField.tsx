import { useCallback, useEffect, useRef } from 'react';

import type { Wind } from '@/game/field';
import {
  EMPTY_RADIUS,
  fitViewport,
  groundRadius,
  markRadius,
  MOTES,
  motePosition,
  odourColor,
  tickOffset,
  toScreen,
  toWorld,
  type Mark,
  type Viewport,
} from '@/game/render/visual';
import type { Vec2, World } from '@/game/world';

type Props = {
  world: World;
  wind: Wind;
  pos: Vec2;
  heading: number;
  marks: Mark[];
  path: Vec2[];
  interactive: boolean;
  turning: boolean;
  onSniff: (heading: number) => void;
  onTurn: (heading: number) => void;
};

/**
 * The field you hunt on. Nothing of the world is drawn — no walls, no sources, no plume.
 * What is drawn is the wind, where you are, where you have walked, and every sample you
 * have taken, at the spot you took it from.
 *
 * The camera is fixed to the world rather than to the player, which is the opposite of
 * what a game about echoes wants. A bat is handed bearings and delays and has to build
 * the room behind its eyes, so the honest presentation there is egocentric. Here the
 * marks *are* the map — a dozen point samples that only mean anything in relation to one
 * another — and a camera that slid around under them would destroy the one thing the
 * player is assembling.
 */
export function ScentField({
  world,
  wind,
  pos,
  heading,
  marks,
  path,
  interactive,
  turning,
  onSniff,
  onTurn,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<Vec2 | null>(null);

  /**
   * Everything the draw loop reads, kept in a ref. The loop runs on every frame for the
   * motes; making it a dependency of the effect would tear it down and rebuild it on
   * every step and every sniff.
   */
  const scene = useRef({ world, wind, pos, heading, marks, path, interactive, turning });
  scene.current = { world, wind, pos, heading, marks, path, interactive, turning };

  /**
   * Worked out fresh every time it is wanted, never cached.
   *
   * The obvious version of this caches the viewport and recomputes it in a resize
   * handler, and it is wrong in a way that is invisible until the second level. The fit
   * depends on the *world's* size as well as the canvas's, and moving to the next field
   * changes the world while the canvas stays exactly the size it was — so no resize
   * fires, the cached fit belongs to the previous field, and the whole scene is drawn at
   * the wrong scale while every click inverts to the wrong world point and sets a
   * heading nobody asked for.
   */
  const viewport = useCallback((): Viewport => {
    const canvas = canvasRef.current;
    if (!canvas) return { scale: 1, ox: 0, oy: 0 };
    const rect = canvas.getBoundingClientRect();
    return fitViewport(scene.current.world, rect.width, rect.height);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    const started = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      const s = scene.current;
      const rect = canvas.getBoundingClientRect();
      const v = fitViewport(s.world, rect.width, rect.height);
      const t = (performance.now() - started) / 1000;

      ctx.clearRect(0, 0, rect.width, rect.height);

      drawMotes(ctx, v, s.world, s.wind, t);
      drawPath(ctx, v, s.path);
      for (const mark of s.marks) drawMark(ctx, v, mark);
      if (s.interactive && cursor.current) drawAim(ctx, v, s.pos, cursor.current, s.turning);
      drawBody(ctx, v, s.pos, s.heading);

      frame = requestAnimationFrame(draw);
    };

    resize();
    draw();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const headingTo = useCallback((e: { clientX: number; clientY: number }): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const world = toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, viewport());
    const dx = world.x - scene.current.pos.x;
    const dy = world.y - scene.current.pos.y;
    // A press right on top of yourself names no direction at all.
    if (Math.hypot(dx, dy) < 0.4) return null;
    return Math.atan2(dy, dx);
  }, [viewport]);

  return (
    <canvas
      ref={canvasRef}
      className="scent-field"
      onPointerMove={(e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        cursor.current = toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, viewport());
      }}
      onPointerLeave={() => {
        cursor.current = null;
      }}
      onPointerDown={(e) => {
        if (!interactive) return;
        const to = headingTo(e);
        if (to === null) return;
        // Shift is the same one-shot the TURN button arms: face without sampling.
        if (e.shiftKey || turning) onTurn(to);
        else onSniff(to);
      }}
    />
  );
}

function drawMotes(
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  world: World,
  wind: Wind,
  t: number,
): void {
  ctx.save();
  ctx.fillStyle = '#9FD8C8';
  for (let i = 0; i < MOTES; i++) {
    const m = motePosition(i, t, wind, world);
    if (m.x < -2 || m.y < -2 || m.x > world.size.w + 2 || m.y > world.size.h + 2) continue;
    const p = toScreen(m, v);
    ctx.globalAlpha = m.alpha * 0.34;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 1.5, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPath(ctx: CanvasRenderingContext2D, v: Viewport, path: Vec2[]): void {
  if (path.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(150, 180, 172, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const first = toScreen(path[0], v);
  ctx.moveTo(first.x, first.y);
  for (const point of path.slice(1)) {
    const p = toScreen(point, v);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * One sample, drawn where it was taken. Air is a soft blob, ground is a hard diamond —
 * two different glyphs because they are two genuinely different things to know, one a
 * direction with a long reach and the other a place with a history, and a level can put
 * both under your nose at once.
 */
function drawMark(ctx: CanvasRenderingContext2D, v: Viewport, mark: Mark): void {
  const p = toScreen(mark.at, v);
  const dim = mark.stale ? 0.28 : 1;

  ctx.save();

  if (mark.haze > 0.02) {
    ctx.strokeStyle = `rgba(150, 156, 168, ${Math.min(0.5, mark.haze * 0.5) * dim})`;
    ctx.lineWidth = 1 + Math.min(4, mark.haze * 3);
    ctx.beginPath();
    ctx.arc(p.x, p.y, (2.4 + Math.min(3, mark.haze * 2)) * v.scale * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (mark.air) {
    const r = markRadius(mark.air.strength) * v.scale;
    const fill = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    fill.addColorStop(0, odourColor(mark.air, 'air', 0.95 * dim));
    fill.addColorStop(0.55, odourColor(mark.air, 'air', 0.45 * dim));
    fill.addColorStop(1, odourColor(mark.air, 'air', 0));
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Which side answered louder. Drawn perpendicular to where the nose was pointed,
    // because that is the axis the two sampling points were spread across.
    const off = tickOffset(mark.air);
    if (Math.abs(off) > 0.25) {
      const nx = -Math.sin(mark.facing);
      const ny = Math.cos(mark.facing);
      const tip = toScreen(
        { x: mark.at.x + nx * off, y: mark.at.y + ny * off },
        v,
      );
      ctx.strokeStyle = odourColor(mark.air, 'air', 0.8 * dim);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = odourColor(mark.air, 'air', 0.9 * dim);
      ctx.fill();
    }
  }

  if (mark.ground) {
    const r = groundRadius(mark.ground.strength) * v.scale;
    ctx.fillStyle = odourColor(mark.ground, 'ground', 0.9 * dim);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x + r, p.y);
    ctx.lineTo(p.x, p.y + r);
    ctx.lineTo(p.x - r, p.y);
    ctx.closePath();
    ctx.fill();
  }

  if (!mark.air && !mark.ground) {
    ctx.strokeStyle = `rgba(140, 158, 152, ${0.5 * dim})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, EMPTY_RADIUS * v.scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Age gets a numeral as well as a lightness, because it is the channel you are meant
  // to do arithmetic on. Two contacts of the same strength and different ages is the
  // question the whole game turns on, and eyeballing two shades of amber will not
  // answer it.
  const reading = mark.air ?? mark.ground;
  if (reading && !mark.stale) {
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = odourColor(reading, mark.air ? 'air' : 'ground', 0.95);
    const lift = (mark.air ? markRadius(mark.air.strength) : 1.6) * v.scale + 9;
    ctx.fillText(`${Math.round(reading.age)}s`, p.x, p.y - lift);
  }

  ctx.restore();
}

function drawAim(
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  pos: Vec2,
  cursor: Vec2,
  turning: boolean,
): void {
  const a = toScreen(pos, v);
  const b = toScreen(cursor, v);
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = turning ? 'rgba(120, 200, 255, 0.5)' : 'rgba(255, 200, 130, 0.32)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, v: Viewport, pos: Vec2, heading: number): void {
  const p = toScreen(pos, v);
  const nose = toScreen(
    { x: pos.x + Math.cos(heading) * 2.6, y: pos.y + Math.sin(heading) * 2.6 },
    v,
  );

  ctx.save();
  ctx.strokeStyle = 'rgba(226, 240, 235, 0.85)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(nose.x, nose.y);
  ctx.stroke();

  ctx.fillStyle = '#E6F2EC';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
