import { useCallback, useEffect, useRef, useState } from 'react';

export function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRunning(false);
  }, []);

  const start = useCallback(
    (total: number) => {
      stop();
      setSeconds(total);
      setRunning(true);
      intervalRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s <= 1) {
            if (intervalRef.current !== null) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            setRunning(false);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    },
    [stop]
  );

  const reset = useCallback(() => {
    stop();
    setSeconds(0);
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { seconds, running, start, reset };
}
