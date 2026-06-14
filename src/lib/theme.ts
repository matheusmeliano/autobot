export type StoredAppTheme = "light" | "dark";

export function normalizeStoredTheme(value: unknown): StoredAppTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function getThemeStorageKey(userId: string) {
  return `app_theme:${userId}`;
}
