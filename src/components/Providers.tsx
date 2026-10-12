"use client";

import { useEffect } from "react";
import { ModalToastProvider } from "@/components/app/ModalToastProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const removeTraeBadges = () => {
      if (typeof document === "undefined") return;
      const nodes = document.querySelectorAll(
        [
          "#trae-badge-plugin",
          "#trae-badge-styles",
          "#trae-badge-plugin-styles",
          ".trae-badge",
          '[id^="trae-badge-"]',
        ].join(", "),
      );
      nodes.forEach((node) => node.remove());
    };

    removeTraeBadges();

    const observer = new MutationObserver(() => {
      removeTraeBadges();
    });

    if (typeof document !== "undefined") {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    return () => observer.disconnect();
  }, []);

  return (
    <>
      {children}
      <ModalToastProvider />
    </>
  );
}
