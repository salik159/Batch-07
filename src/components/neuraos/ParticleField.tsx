'use client';

import { useEffect, useRef } from 'react';

interface Particle {
  x: number; y: number; vx: number; vy: number; r: number;
}

/** Ambient connected-particle network background, rendered on a full-bleed canvas. */
export function ParticleField({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let particles: Particle[] = [];
    let raf = 0;

    function resize() {
      const el = canvas!;
      el.width = el.clientWidth;
      el.height = el.clientHeight;
      const count = Math.floor((el.width * el.height) / 16000);
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * el.width,
        y: Math.random() * el.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.2 + 0.6,
      }));
    }

    function draw() {
      const el = canvas!;
      const c = ctx!;
      c.clearRect(0, 0, el.width, el.height);

      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = el.width; if (p.x > el.width) p.x = 0;
        if (p.y < 0) p.y = el.height; if (p.y > el.height) p.y = 0;
        c.beginPath();
        c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        c.fillStyle = 'rgba(75,227,255,.55)';
        c.fill();
      });

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 95) {
            c.strokeStyle = `rgba(75,227,255,${0.12 * (1 - dist / 95)})`;
            c.lineWidth = 1;
            c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className={`w-full h-full ${className}`} />;
}
