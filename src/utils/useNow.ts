import { useEffect, useState } from 'react';

/**
 * The current time, re-rendering every `everyMs`. For screens that show
 * time-based state ("LIVE", "Up next") that must change on the clock, not
 * only when some store happens to update.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
