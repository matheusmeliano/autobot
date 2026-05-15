"use client";

import { Toaster } from "sonner";
import { useEffect } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    if (!savedTheme) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    }
  }, []);

  return (
    <>
      {children}
      <Toaster
        richColors
        theme="dark"
        position="top-center"
        toastOptions={{
          className:
            "items-center justify-center gap-2 text-center max-w-[calc(100vw-2rem)] sm:max-w-[420px] [&_[data-title]]:min-w-0 [&_[data-title]]:truncate [&_[data-description]]:min-w-0 [&_[data-description]]:truncate [&_[data-title]]:text-center [&_[data-description]]:text-center",
        }}
      />
    </>
  );
}
