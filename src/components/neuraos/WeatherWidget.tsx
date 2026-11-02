'use client';

interface WeatherWidgetProps {
  temp: number;
  desc: string;
  city: string;
  wind: number;
  humidity: number;
  compact?: boolean;
}

/** Reusable weather readout — used on Home (compact) and World Intelligence (full). */
export function WeatherWidget({ temp, desc, city, wind, humidity, compact = false }: WeatherWidgetProps) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <div className={`font-display text-cyan-200 drop-shadow-[0_0_14px_rgba(75,227,255,.5)] ${compact ? 'text-[34px]' : 'text-[44px]'}`}>
            {temp}°
          </div>
          <div className="text-[12px] tracking-wide text-slate-400 uppercase">{desc}</div>
          <div className="text-[11px] text-slate-600 mt-0.5">{city}</div>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <span className="text-[9.5px] font-hud-mono tracking-wide px-2 py-1 rounded-full text-emerald-400 bg-emerald-400/10 border border-emerald-400/30">
          WIND {wind}km/h
        </span>
        <span className="text-[9.5px] font-hud-mono tracking-wide px-2 py-1 rounded-full text-cyan-300 bg-cyan-400/10 border border-cyan-400/30">
          HUM {humidity}%
        </span>
      </div>
    </div>
  );
}
