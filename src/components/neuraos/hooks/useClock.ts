'use client';

import { useEffect, useState } from 'react';

export function useClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    // Avoids hydration mismatch — renders empty on first server pass.
    return { time: '--:--:--', date: '—' };
  }

  return {
    time: now.toLocaleTimeString('en-GB'),
    date: now
      .toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' })
      .toUpperCase(),
  };
}
