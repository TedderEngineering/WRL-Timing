import { useCallback, useEffect, useState } from "react";

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Load data when the component mounts (and when `deps` change). */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps);

  const reload = useCallback(async () => {
    try {
      const data = await run();
      setState({ data, error: null, loading: false });
    } catch (err) {
      setState({
        data: null,
        error: err instanceof Error ? err.message : "Something went wrong",
        loading: false,
      });
    }
  }, [run]);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    run()
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch(
        (err) =>
          !cancelled &&
          setState({
            data: null,
            error: err instanceof Error ? err.message : "Something went wrong",
            loading: false,
          })
      );
    return () => {
      cancelled = true;
    };
  }, [run]);

  return {
    ...state,
    reload,
    setData: (data: T) => setState({ data, error: null, loading: false }),
  };
}
