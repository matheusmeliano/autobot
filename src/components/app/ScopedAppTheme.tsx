"use client";

import { useEffect } from "react";
import type { AppTheme } from "@/components/app/AppThemeProvider";
import { getThemeStorageKey, normalizeStoredTheme } from "@/lib/theme";

export function ScopedAppTheme({
  scopeId,
  userId,
  initialTheme,
}: {
  scopeId: string;
  userId: string;
  initialTheme: AppTheme;
}) {
  useEffect(() => {
    const el = document.documentElement;
    let theme = normalizeStoredTheme(el.getAttribute("data-theme"));

    if (!theme) {
      try {
        theme = normalizeStoredTheme(localStorage.getItem(getThemeStorageKey(userId))) ?? initialTheme;
      } catch {
        theme = initialTheme;
      }
    }

    el.classList.add("app-theme");
    el.setAttribute("data-app-theme-scope", scopeId);
    el.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(getThemeStorageKey(userId), theme);
    } catch {}

    const raf = window.requestAnimationFrame(() => el.classList.add("theme-ready"));

    return () => {
      window.cancelAnimationFrame(raf);
      if (el.getAttribute("data-app-theme-scope") === scopeId) {
        el.classList.remove("theme-ready");
        el.classList.remove("app-theme");
        el.removeAttribute("data-theme");
        el.removeAttribute("data-app-theme-scope");
      }
    };
  }, [initialTheme, scopeId, userId]);

  return null;
}
