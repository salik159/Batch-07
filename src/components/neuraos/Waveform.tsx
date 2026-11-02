'use client';

import { useEffect, useRef } from 'react';

/** Animated voice-activity waveform, rendered on canvas. Purely decorative unless wired to real audio. */
export function Waveform({ className = '', active = true }: { className?: string; active?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    function draw() {
      const el = canvas!;
      const c = ctx!;
      const w = el.width, h = el.height;
      c.clearRect(0, 0, w, h);
      const bars = 64;
      const gap = w / bars;
      const t = tRef.current;
      const activeAmp = active ? 1 : 0.15;
      for (let i = 0; i < bars; i++) {
        const n = Math.sin(i * 0.35 + t) * Math.cos(i * 0.12 - t * 0.6);
        const amp = (Math.sin(t * 1.3 + i * 0.2) * 0.5 + 0.5) * activeAmp;
        const barH = Math.max(3, Math.abs(n) * amp * (h * 0.42));
        const x = i * gap + gap * 0.25;
        const y = h / 2 - barH / 2;
        const grad = c.createLinearGradient(0, y, 0, y + barH);
        grad.addColorStop(0, 'rgba(75,227,255,.95)');
        grad.addColorStop(1, 'rgba(62,143,255,.25)');
        c.fillStyle = grad;
        c.fillRect(x, y, gap * 0.5, barH);
      }
      tRef.current += 0.06;
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return <canvas ref={canvasRef} width={500} height={70} className={`w-full h-[70px] ${className}`} />;
}
