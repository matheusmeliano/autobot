"use client";

import { useEffect } from "react";

export function ScopedAppTheme({ scopeId }: { scopeId: string }) {
  useEffect(() => {
    const el = document.documentElement;
    let theme = el.getAttribute("data-theme");

    if (theme !== "light" && theme !== "dark") {
      try {
        const stored = localStorage.getItem("app_theme");
        theme = stored === "light" || stored === "dark" ? stored : "dark";
      } catch {
        theme = "dark";
      }
    }

    el.classList.add("app-theme");
    el.setAttribute("data-app-theme-scope", scopeId);
    el.setAttribute("data-theme", theme);

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
  }, [scopeId]);

  return null;
}

