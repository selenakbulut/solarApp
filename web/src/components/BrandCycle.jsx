import React, { useEffect, useRef } from 'react';
import { Moon, Sun } from 'lucide-react';

const DURATION = 32000;

export function BrandCycle({ paused = false }) {
  const containerRef = useRef(null);
  const bodyRef = useRef(null);
  const sunRef = useRef(null);
  const sunsetRef = useRef(null);
  const moonRef = useRef(null);
  const pausedRef = useRef(paused);
  const playbackRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const elements = [bodyRef.current, sunRef.current, sunsetRef.current, moonRef.current];
    if (!container || elements.some(element => !element?.animate)) return undefined;

    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = preference.matches, phase = 0, disposed = false;
    const intersectsViewport = () => {
      const box = container.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
    };
    let visible = intersectsViewport();
    const options = { duration: DURATION, iterations: Infinity, easing: 'linear', fill: 'both' };
    const orbit = Array.from({ length: 65 }, (_, index) => {
      const t = index / 64, angle = 2 * Math.PI * t;
      return { offset: t, transform: `translate(${100 - 84 * Math.cos(angle)}px, ${50 - 34 * Math.sin(angle)}px)` };
    });
    const animations = [
      elements[0].animate(orbit, options),
      elements[1].animate([
        { offset: 0, opacity: 1 }, { offset: 0.46, opacity: 1 },
        { offset: 0.52, opacity: 0 }, { offset: 0.94, opacity: 0 }, { offset: 1, opacity: 1 },
      ], options),
      elements[2].animate([
        { offset: 0, opacity: 0 }, { offset: 0.34, opacity: 0 }, { offset: 0.45, opacity: 1 },
        { offset: 0.49, opacity: 1 }, { offset: 0.52, opacity: 0 }, { offset: 1, opacity: 0 },
      ], options),
      elements[3].animate([
        { offset: 0, opacity: 0 }, { offset: 0.48, opacity: 0 },
        { offset: 0.52, opacity: 1 }, { offset: 0.93, opacity: 1 }, { offset: 1, opacity: 0 },
      ], options),
    ];
    animations.forEach(animation => { animation.pause(); animation.currentTime = 0; });

    function syncPlayback() {
      if (disposed) return;
      phase = reduced ? 0 : Number(animations[0].currentTime ?? phase);
      animations.forEach(animation => { animation.pause(); animation.currentTime = phase; });
      if (pausedRef.current || reduced || document.hidden || !visible) return;
      const timeline = document.timeline.currentTime;
      animations.forEach(animation => {
        animation.play();
        animation.currentTime = phase;
        if (timeline != null) animation.startTime = Number(timeline) - phase;
      });
    }
    function preferenceChanged(event) { reduced = event.matches; syncPlayback(); }
    function resized() { visible = intersectsViewport(); syncPlayback(); }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      syncPlayback();
    }, { threshold: 0.01 }) : null;

    playbackRef.current = syncPlayback;
    observer?.observe(container);
    document.addEventListener('visibilitychange', syncPlayback);
    preference.addEventListener('change', preferenceChanged);
    window.addEventListener('resize', resized, { passive: true });
    syncPlayback();
    return () => {
      disposed = true; playbackRef.current = null;
      observer?.disconnect(); animations.forEach(animation => animation.cancel());
      document.removeEventListener('visibilitychange', syncPlayback);
      preference.removeEventListener('change', preferenceChanged);
      window.removeEventListener('resize', resized);
    };
  }, []);

  useEffect(() => { pausedRef.current = paused; playbackRef.current?.(); }, [paused]);

  return <span ref={containerRef} className="brand-cycle">
    <svg className="brand-orbit" viewBox="0 0 200 100" aria-hidden="true" focusable="false" style={{ pointerEvents: 'none' }}>
      <g ref={bodyRef} className="brand-orbit-body" transform="translate(16 50)">
        <Sun ref={sunRef} className="brand-cycle-sun" size={24} x={-12} y={-12} strokeWidth={1.7} />
        <Sun ref={sunsetRef} className="brand-cycle-sunset" size={24} x={-12} y={-12} strokeWidth={1.7} opacity={0} />
        <Moon ref={moonRef} className="brand-cycle-moon" size={22} x={-11} y={-11} strokeWidth={1.7} opacity={0} />
      </g>
    </svg>
    <span className="brand-wordmark"><strong>GES<span className="brand-suffix"> enerji</span></strong></span>
  </span>;
}
