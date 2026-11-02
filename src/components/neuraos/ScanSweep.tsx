'use client';

import { motion } from 'framer-motion';

/** A glowing horizontal beam that sweeps top-to-bottom, for a "document/target scanning" feel. */
export function ScanSweep({ className = '', duration = 2.6 }: { className?: string; duration?: number }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <motion.div
        className="absolute left-0 right-0 h-24"
        style={{
          background: 'linear-gradient(to bottom, transparent, rgba(75,227,255,.22), rgba(200,245,255,.5), rgba(75,227,255,.22), transparent)',
        }}
        initial={{ top: '-10%' }}
        animate={{ top: '110%' }}
        transition={{ repeat: Infinity, duration, ease: 'linear' }}
      />
    </div>
  );
}
