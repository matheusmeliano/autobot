export type StoredAppTheme = "light" | "dark";

export function normalizeStoredTheme(value: unknown): StoredAppTheme | null {
  const raw = typeof value === "string" ? value.trim() : null;
  return raw === "dark" ? "dark" : null;
}

export function getThemeStorageKey(userId: string) {
  return `app_theme:${userId}`;
}
