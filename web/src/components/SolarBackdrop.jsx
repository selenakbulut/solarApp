import React, { useEffect, useRef } from 'react';

const TOKEN_NAMES = [
  'sky-top', 'sky-mid', 'sky-horizon', 'ground-top', 'ground-mid', 'ground-bottom',
  'panel', 'reflection', 'frame', 'cell', 'shadow', 'glint', 'haze', 'veil',
];

function channels(value) {
  const text = value.trim();
  const hex = text.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const full = hex[1].length === 3 ? [...hex[1]].map(char => char + char).join('') : hex[1];
    return [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16));
  }
  const parts = text.replace(/^rgba?\(/, '').replace(/\)$/, '').split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
}

const ink = (color, alpha = 1) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;

// Adapted from the user's ScadaWatt field assistant: a south-facing solar field.
// This canvas is presentation only; it never reads or calculates production data.
export function SolarBackdrop({ paused = false }) {
  const canvasRef = useRef(null);
  const pausedRef = useRef(paused);
  const controlsRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let context;
    try { context = canvas.getContext('2d'); } catch { return undefined; }
    if (!context) return undefined;

    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = preference.matches;
    let width = 0, height = 0, palette = null, frameId = 0, resizeFrameId = 0;
    let lastFrameAt = 0, sceneTime = 52000, contextLost = false, disposed = false;
    const frameInterval = 1000 / 14;

    function paint(time) {
      if (!palette || !width || !height || contextLost || disposed) return;
      const cx = context, p = palette;
      const horizon = height * 0.27, focal = height * 1.15, camera = 7.5;
      const project = (x, y, z) => [width / 2 + focal * x / z, horizon + focal * (camera - y) / z];
      const polygon = points => {
        cx.beginPath(); points.forEach(([x, y], index) => index ? cx.lineTo(x, y) : cx.moveTo(x, y)); cx.closePath();
      };

      let gradient = cx.createLinearGradient(0, 0, 0, horizon);
      gradient.addColorStop(0, ink(p['sky-top']));
      gradient.addColorStop(0.7, ink(p['sky-mid']));
      gradient.addColorStop(1, ink(p['sky-horizon']));
      cx.fillStyle = gradient; cx.fillRect(0, 0, width, horizon + 1);
      gradient = cx.createLinearGradient(0, horizon, 0, height);
      gradient.addColorStop(0, ink(p['ground-top']));
      gradient.addColorStop(0.35, ink(p['ground-mid']));
      gradient.addColorStop(1, ink(p['ground-bottom']));
      cx.fillStyle = gradient; cx.fillRect(0, horizon, width, height - horizon);

      const sunlightPhase = (time / 240000) % 1;
      const sunlight = 0.35 + 0.65 * Math.sin(Math.PI * sunlightPhase);
      const reflectionX = width * (0.9 - 0.8 * sunlightPhase);
      gradient = cx.createRadialGradient(reflectionX, 0, 0, reflectionX, 0, height * 0.9);
      gradient.addColorStop(0, ink(p.glint, 0.24 * sunlight));
      gradient.addColorStop(1, ink(p.glint, 0));
      cx.fillStyle = gradient; cx.fillRect(0, 0, width, horizon);

      const spacing = 6, depth = 2.3, lowEdge = 0.7, highEdge = 2.35;
      const tableWidth = 11.4, gap = 1, moduleWidth = 1.14;
      const travel = (time * 0.00014) % spacing;
      for (let row = 44; row >= 0; row -= 1) {
        const frontZ = 7.5 + row * spacing - travel, backZ = frontZ + depth;
        if (frontZ < 6.5) continue;
        const fog = Math.min(1, Math.max(0, (frontZ - 6) / 150));
        const near = frontZ < 24, closest = frontZ < 13;
        const left = -((width / 2) * frontZ / focal) - tableWidth;
        const right = (width / 2) * frontZ / focal + tableWidth;
        const offset = 3.3 + (row % 2) * 0.35;
        const first = Math.floor((left - offset) / (tableWidth + gap)) - 1;
        const last = Math.ceil((right - offset) / (tableWidth + gap)) + 1;

        for (let column = first; column <= last; column += 1) {
          const x0 = column * (tableWidth + gap) + offset, x1 = x0 + tableWidth;
          const a = project(x0, lowEdge, frontZ), b = project(x1, lowEdge, frontZ);
          const c = project(x1, highEdge, backZ), d = project(x0, highEdge, backZ);
          if (Math.max(a[0], b[0]) < -40 || Math.min(a[0], b[0]) > width + 40) continue;

          polygon([
            project(x0, 0, backZ + 0.2), project(x1, 0, backZ + 0.2),
            project(x1 + 0.4, 0, backZ + 2.6), project(x0 + 0.4, 0, backZ + 2.6),
          ]);
          cx.fillStyle = ink(p.shadow, 0.28 * (1 - fog)); cx.fill();
          if (near) {
            cx.strokeStyle = ink(p.frame, 0.35 * (1 - fog)); cx.lineWidth = Math.max(0.6, 8.8 / frontZ);
            cx.beginPath();
            for (const x of [x0 + 0.8, x0 + tableWidth / 2, x1 - 0.8]) {
              for (const [top, bottom] of [
                [project(x, lowEdge, frontZ + 0.1), project(x, 0, frontZ + 0.1)],
                [project(x, highEdge, backZ - 0.1), project(x, 0, backZ - 0.1)],
              ]) { cx.moveTo(...top); cx.lineTo(...bottom); }
            }
            cx.stroke();
          }

          const centreX = (a[0] + b[0]) / 2;
          const glint = Math.exp(-Math.pow((centreX - reflectionX) / (width * 0.16), 2)) * sunlight * (1 - fog * 0.7);
          const panelReflection = p.panel.map((channel, index) => Math.min(255, Math.round(channel + p.reflection[index] * 0.9)));
          gradient = cx.createLinearGradient(0, a[1], 0, d[1]);
          gradient.addColorStop(0, ink(p.panel)); gradient.addColorStop(1, ink(panelReflection));
          polygon([a, b, c, d]);
          cx.globalAlpha = 1 - fog * 0.85; cx.fillStyle = gradient; cx.fill();
          if (glint > 0.02) { cx.fillStyle = ink(p.glint, 0.32 * glint); cx.fill(); }
          cx.globalAlpha = 1;

          const interpolate = (u, v) => project(x0 + tableWidth * u, lowEdge + (highEdge - lowEdge) * v, frontZ + depth * v);
          const cellPixels = focal * (moduleWidth / 6) / frontZ;
          if (cellPixels > 2.5) {
            cx.strokeStyle = ink(p.cell, Math.min(0.35, cellPixels / 30) * (1 - fog)); cx.lineWidth = 0.5;
            cx.beginPath();
            const cells = Math.round(tableWidth / moduleWidth) * 6;
            for (let k = 1; k < cells; k += 1) {
              if (k % 6 === 0) continue;
              cx.moveTo(...interpolate(k / cells, 0)); cx.lineTo(...interpolate(k / cells, 1));
            }
            for (let k = 1; k < 20; k += 1) {
              if (k === 10) continue;
              cx.moveTo(...interpolate(0, k / 20)); cx.lineTo(...interpolate(1, k / 20));
            }
            cx.stroke();
          }
          cx.strokeStyle = ink(p.frame, (closest ? 0.75 : near ? 0.55 : 0.32) * (1 - fog));
          cx.lineWidth = Math.max(0.5, Math.min(1.6, 9 / frontZ)); cx.beginPath();
          const modules = Math.round(tableWidth / moduleWidth);
          if (focal * moduleWidth / frontZ > 4) {
            for (let k = 1; k < modules; k += 1) { cx.moveTo(...interpolate(k / modules, 0)); cx.lineTo(...interpolate(k / modules, 1)); }
          }
          cx.moveTo(...interpolate(0, 0.5)); cx.lineTo(...interpolate(1, 0.5));
          cx.moveTo(...a); cx.lineTo(...b); cx.lineTo(...c); cx.lineTo(...d); cx.closePath(); cx.stroke();
        }
      }

      gradient = cx.createLinearGradient(0, horizon - height * 0.04, 0, horizon + height * 0.08);
      gradient.addColorStop(0, ink(p.haze, 0)); gradient.addColorStop(0.35, ink(p.haze, 0.85)); gradient.addColorStop(1, ink(p.haze, 0));
      cx.fillStyle = gradient; cx.fillRect(0, horizon - height * 0.04, width, height * 0.12);
      gradient = cx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, ink(p.veil, 0.25)); gradient.addColorStop(0.45, ink(p.veil, 0)); gradient.addColorStop(1, ink(p.veil, 0.35));
      cx.fillStyle = gradient; cx.fillRect(0, 0, width, height);
    }

    function canAnimate() { return !disposed && !contextLost && palette && !document.hidden && !reduced && !pausedRef.current; }
    function tick(timestamp) {
      frameId = 0;
      if (!canAnimate()) return;
      if (!lastFrameAt) lastFrameAt = timestamp;
      if (timestamp - lastFrameAt >= frameInterval) {
        sceneTime += Math.min(timestamp - lastFrameAt, 120);
        lastFrameAt = timestamp; paint(sceneTime);
      }
      frameId = requestAnimationFrame(tick);
    }
    function syncPlayback() {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0; lastFrameAt = 0;
      if (canAnimate()) frameId = requestAnimationFrame(tick);
    }
    function sizeAndPaint() {
      resizeFrameId = 0;
      if (disposed || contextLost) return;
      width = window.innerWidth; height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const style = getComputedStyle(canvas);
      const entries = TOKEN_NAMES.map(name => [name, channels(style.getPropertyValue(`--solar-${name}`))]);
      palette = entries.every(([, value]) => value) ? Object.fromEntries(entries) : null;
      if (palette) paint(sceneTime);
      syncPlayback();
    }
    function requestResize() { if (!resizeFrameId && !disposed) resizeFrameId = requestAnimationFrame(sizeAndPaint); }
    function preferenceChanged(event) { reduced = event.matches; syncPlayback(); }
    function lost(event) { event.preventDefault(); contextLost = true; syncPlayback(); }
    function restored() {
      try { context = canvas.getContext('2d'); } catch { return; }
      contextLost = !context;
      if (!contextLost) requestResize();
    }

    controlsRef.current = { syncPlayback };
    window.addEventListener('resize', requestResize, { passive: true });
    document.addEventListener('visibilitychange', syncPlayback);
    preference.addEventListener('change', preferenceChanged);
    canvas.addEventListener('contextlost', lost); canvas.addEventListener('contextrestored', restored);
    sizeAndPaint();
    return () => {
      disposed = true; controlsRef.current = null;
      if (frameId) cancelAnimationFrame(frameId);
      if (resizeFrameId) cancelAnimationFrame(resizeFrameId);
      window.removeEventListener('resize', requestResize);
      document.removeEventListener('visibilitychange', syncPlayback);
      preference.removeEventListener('change', preferenceChanged);
      canvas.removeEventListener('contextlost', lost); canvas.removeEventListener('contextrestored', restored);
    };
  }, []);

  useEffect(() => { pausedRef.current = paused; controlsRef.current?.syncPlayback(); }, [paused]);
  return <canvas ref={canvasRef} className="solar-backdrop" aria-hidden="true" />;
}
