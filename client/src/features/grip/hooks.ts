import { useCallback, useEffect, useState } from "react";
import { gripApi } from "./api";

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

type GripStatus = { open: boolean; free: boolean };
let statusRequest: Promise<GripStatus> | null = null;

/**
 * Public facts about Finding Grip: whether anyone can sign up, and whether it
 * is free for every account. Fetched once and shared by the public pages.
 */
export function useGripStatus() {
  const state = useLoad<GripStatus>(() => {
    statusRequest ??= gripApi.status().catch(() => {
      statusRequest = null;
      return { open: false, free: true };
    });
    return statusRequest;
  });
  return {
    loading: state.loading,
    open: !!state.data?.open,
    free: state.data?.free ?? true,
  };
}
