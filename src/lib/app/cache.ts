type CacheEntry<T> = { value: T; ts: number };

const mem = new Map<string, CacheEntry<unknown>>();

function now() {
  return Date.now();
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getCached<T>(key: string, maxAgeMs: number): T | null {
  const inMem = mem.get(key) as CacheEntry<T> | undefined;
  if (inMem && now() - inMem.ts <= maxAgeMs) return inMem.value;

  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const parsed = safeParseJson<CacheEntry<T>>(raw);
  if (!parsed) return null;
  if (now() - parsed.ts > maxAgeMs) return null;
  mem.set(key, parsed);
  return parsed.value;
}

export function setCached<T>(key: string, value: T) {
  const entry: CacheEntry<T> = { value, ts: now() };
  mem.set(key, entry);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    return;
  }
}

export async function fetchJsonCached<T>({
  key,
  url,
  maxAgeMs,
  signal,
}: {
  key: string;
  url: string;
  maxAgeMs: number;
  signal?: AbortSignal;
}): Promise<T> {
  const cached = getCached<T>(key, maxAgeMs);
  if (cached) return cached;
  const r = await fetch(url, { cache: "no-store", signal });
  if (!r.ok) throw new Error("Falha ao carregar.");
  const json = (await r.json()) as T;
  setCached(key, json);
  return json;
}

export async function prefetchJson<T>(key: string, url: string) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return;
    const json = (await r.json()) as T;
    setCached(key, json);
  } catch {
    return;
  }
}
