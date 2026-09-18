"use client";

import { createContext, useContext } from "react";

export type AppTheme = "light" | "dark";

type AppThemeContextValue = {
  theme: AppTheme;
  themePreference: AppTheme | null;
  themeLoaded: boolean;
  saveTheme: (theme: AppTheme) => Promise<{ ok: boolean; error?: string }>;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({
  value,
  children,
}: {
  value: AppThemeContextValue;
  children: React.ReactNode;
}) {
  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return ctx;
}

