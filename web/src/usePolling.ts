import { useCallback, useEffect, useRef, useState } from "react";

/** Serial refreshes; writes and route changes invalidate older reads. */
export function usePolling<T>(
  key: string | undefined,
  load: (key: string) => Promise<T>,
  {
    intervalMs = 4000,
    paused = false,
  }: { intervalMs?: number; paused?: boolean } = {},
) {
  const [snapshot, setSnapshot] = useState<{
    key: string | undefined;
    data: T | null;
  }>({ key, data: null });
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  const revision = useRef(0);
  const currentKey = useRef(key);
  currentKey.current = key;
  const setData = useCallback(
    (data: T) => {
      if (currentKey.current !== key) return;
      revision.current++;
      setSnapshot({ key, data });
      setError(null);
    },
    [key],
  );
  const reload = useCallback(() => {
    revision.current++;
    setTick((v) => v + 1);
  }, []);

  useEffect(() => {
    setError(null);
  }, [key]);
  useEffect(() => {
    if (!key || paused) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    const refresh = async () => {
      if (!alive || running) return;
      clearTimeout(timer);
      running = true;
      const started = revision.current;
      try {
        const data = await loader.current(key);
        if (alive && started === revision.current) {
          setSnapshot({ key, data });
          setError(null);
        }
      } catch (cause) {
        if (alive && started === revision.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        running = false;
        if (alive && intervalMs > 0)
          timer = setTimeout(() => {
            if (!document.hidden) void refresh();
          }, intervalMs);
      }
    };
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, paused, tick, intervalMs]);

  return {
    data: snapshot.key === key ? snapshot.data : null,
    error,
    setData,
    setError,
    reload,
  };
}

/** Async completion belongs to the resource that started it, even after navigation. */
export function useAction(key: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const identity = useRef(key);
  const inFlight = useRef(false);
  identity.current = key;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async <T>(
    operation: () => Promise<T>,
    success?: (result: T) => void,
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      if (alive.current && identity.current === key) success?.(result);
      return result;
    } catch (cause) {
      if (alive.current && identity.current === key)
        setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    } finally {
      inFlight.current = false;
      if (alive.current && identity.current === key) setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
