import { useEffect, useRef, useState } from "react";

type PollingOptions = {
  intervalMs?: number;
  clearOnError?: boolean;
};

export function usePolling<T>(
  key: string | undefined,
  load: (key: string) => Promise<T>,
  { intervalMs = 4000, clearOnError = false }: PollingOptions = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    setData(null);
    setError(null);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const refresh = () =>
      loadRef
        .current(key)
        .then((next) => {
          if (!alive) return;
          setData(next);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (!alive) return;
          if (clearOnError) setData(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        });

    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [clearOnError, intervalMs, key, tick]);

  return {
    data,
    error,
    setData,
    setError,
    reload: () => setTick((value) => value + 1),
  };
}
