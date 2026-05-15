"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJsonCached, getCached, setCached } from "@/lib/app/cache";

export function useCachedJson<T>({
  key,
  url,
  maxAgeMs,
}: {
  key: string;
  url: string;
  maxAgeMs: number;
}) {
  const [data, setData] = useState<T | null>(() => getCached<T>(key, maxAgeMs));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !getCached<T>(key, maxAgeMs));

  const refresh = useCallback(async () => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(url, { cache: "no-store", signal: ac.signal });
      if (!r.ok) throw new Error("Falha ao carregar.");
      const json = (await r.json()) as T;
      setCached(key, json);
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [key, url]);

  useEffect(() => {
    const ac = new AbortController();
    setError(null);

    fetchJsonCached<T>({ key, url, maxAgeMs, signal: ac.signal })
      .then((json) => setData(json))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Falha ao carregar."),
      )
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [key, url, maxAgeMs]);

  return { data, error, loading, refresh, setData };
}
