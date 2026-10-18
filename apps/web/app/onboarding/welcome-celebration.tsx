"use client";

import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";

export function WelcomeCelebration() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const celebrate = confetti.create(canvas.current, { resize: true, disableForReducedMotion: true });
    const colors = ["#46705a", "#a3bfae", "#e4bb68", "#d99786", "#c3b7df"];
    let bursts = 0;
    const timer = window.setInterval(() => {
      celebrate({ particleCount: 12, angle: 270, spread: 70, startVelocity: 6, gravity: .7, ticks: 320, scalar: .9, colors, origin: { x: Math.random(), y: -.03 } });
      if (++bursts >= 24) window.clearInterval(timer);
    }, 100);
    return () => { window.clearInterval(timer); celebrate.reset(); };
  }, []);
  return <canvas ref={canvas} aria-hidden="true" style={{ position:"fixed", inset:0, width:"100%", height:"100%", pointerEvents:"none", zIndex:50 }} />;
}
