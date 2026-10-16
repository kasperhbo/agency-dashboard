import { useEffect, useState } from 'react';

export function useObservationClock(enabled = true) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const update = () => { if (!document.hidden) setNow(Date.now()); };
    update();
    const timer = window.setInterval(update, 10000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
    };
  }, [enabled]);
  return now;
}
