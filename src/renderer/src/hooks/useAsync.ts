import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Runs `task` whenever `deps` change, discarding results from superseded runs so a
 * slow earlier request can never overwrite a newer one.
 */
export function useAsync<T>(task: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const runId = useRef(0);

  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    const id = ++runId.current;
    setLoading(true);
    setError(null);

    taskRef
      .current()
      .then((result) => {
        if (id !== runId.current) return;
        setData(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (id !== runId.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, loading, error, reload };
}

/** Value that only updates after `delay` ms of quiet — used for search-as-you-type. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
