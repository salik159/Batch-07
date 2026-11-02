'use client';

import { ReactNode, useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

interface PanelProps {
  title?: string;
  subtitle?: string;
  className?: string;
  bodyClassName?: string;
  tilt?: number; // max degrees of 3D tilt on hover
  children: ReactNode;
}

/** Reusable glassmorphic HUD panel with pointer-reactive 3D tilt and corner brackets. */
export function Panel({ title, subtitle, className = '', bodyClassName = '', tilt = 3.5, children }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [tilt, -tilt]), { stiffness: 200, damping: 20 });
  const rotateY = useSpring(useTransform(px, [0, 1], [-tilt, tilt]), { stiffness: 200, damping: 20 });

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
  }
  function handleLeave() {
    px.set(0.5);
    py.set(0.5);
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{ rotateX, rotateY, transformPerspective: 1000 }}
      className={`relative rounded-2xl border border-cyan-400/15 bg-[rgba(9,20,36,0.52)] backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.35)] overflow-hidden ${className}`}
    >
      <span className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />
      <span className="pointer-events-none absolute top-2 left-2 w-3.5 h-3.5 border-t-2 border-l-2 border-cyan-400/60" />
      <span className="pointer-events-none absolute bottom-2 right-2 w-3.5 h-3.5 border-b-2 border-r-2 border-cyan-400/60" />

      {(title || subtitle) && (
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          {title && <span className="font-display text-[11px] tracking-[2px] uppercase text-cyan-200">{title}</span>}
          {subtitle && <span className="text-[10px] tracking-wide text-slate-500">{subtitle}</span>}
        </div>
      )}

      <div className={`px-4 pb-4 ${title || subtitle ? '' : 'pt-4'} h-[calc(100%-8px)] ${bodyClassName}`}>
        {children}
      </div>
    </motion.div>
  );
}
