"use client";

import { useEffect } from "react";
import { ModalToastProvider } from "@/components/app/ModalToastProvider";

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
      <ModalToastProvider />
    </>
  );
}
