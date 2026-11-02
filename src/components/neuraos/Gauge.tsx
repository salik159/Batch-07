'use client';

import { Doughnut } from 'react-chartjs-2';
import { Chart, ArcElement, Tooltip } from 'chart.js';

Chart.register(ArcElement, Tooltip);

interface GaugeProps {
  value: number;
  max: number;
  color: string;
  label: string;
  valueLabel: string;
}

/** Compact half-radial gauge (Chart.js doughnut) used for temp / network / load readouts. */
export function Gauge({ value, max, color, label, valueLabel }: GaugeProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className="flex-1 text-center">
      <div className="relative w-full max-w-[110px] mx-auto">
        <Doughnut
          data={{ datasets: [{ data: [pct, 100 - pct], backgroundColor: [color, 'rgba(255,255,255,.06)'], borderWidth: 0 }] }}
          options={{
            cutout: '75%',
            rotation: -90,
            circumference: 180,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            animation: { duration: 400 },
          }}
        />
        <div className="absolute inset-x-0 top-[58%] text-center font-display text-[15px] text-cyan-200">
          {valueLabel}
        </div>
      </div>
      <div className="text-[10px] tracking-[1.5px] text-slate-500 mt-1 uppercase">{label}</div>
    </div>
  );
}
