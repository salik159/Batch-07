'use client';

import { useEffect, useRef } from 'react';

const CHARS = 'アイウエオカキクケコサシスセソ01アイウエ{}<>/\\;:*#01ABCDEF'.split('');

/** Cyberpunk digital-rain background — cyan/blue tinted rather than classic green. */
export function MatrixRain({ className = '', opacity = 0.5 }: { className?: string; opacity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let columns: number[] = [];
    let raf = 0;
    const fontSize = 15;

    function resize() {
      const el = canvas!;
      el.width = el.clientWidth;
      el.height = el.clientHeight;
      const colCount = Math.floor(el.width / fontSize);
      columns = Array.from({ length: colCount }, () => Math.random() * -100);
    }

    function draw() {
      const el = canvas!;
      const c = ctx!;
      c.fillStyle = 'rgba(2,5,10,0.16)';
      c.fillRect(0, 0, el.width, el.height);
      c.font = `${fontSize}px "JetBrains Mono", monospace`;

      columns.forEach((y, i) => {
        const char = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * fontSize;
        const isHead = Math.random() > 0.94;
        c.fillStyle = isHead ? 'rgba(200,245,255,0.9)' : 'rgba(75,227,255,0.45)';
        c.fillText(char, x, y * fontSize);
        columns[i] = y * fontSize > el.height && Math.random() > 0.975 ? 0 : y + 1;
      });
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full ${className}`}
      style={{ opacity }}
    />
  );
}
