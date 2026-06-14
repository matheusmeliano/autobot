"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { Portal } from "@/components/ui/Portal";

type ModalPosition = "center" | "bottom";
type ModalSize = "md" | "lg" | "xl";

const SIZE_CLASS: Record<ModalSize, string> = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
};

export function AppModal({
  open,
  onClose,
  children,
  position = "center",
  size = "lg",
  zIndexClass = "z-[100]",
  panelClassName = "",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  position?: ModalPosition;
  size?: ModalSize;
  zIndexClass?: string;
  panelClassName?: string;
}) {
  const [present, setPresent] = useState(open);
  const [visible, setVisible] = useState(open);

  useLayoutEffect(() => {
    if (!open) return;
    setPresent(true);
    setVisible(true);
  }, [open]);

  useEffect(() => {
    if (open) return;
    if (!present) return;
    setVisible(false);
    const t = window.setTimeout(() => setPresent(false), 220);
    return () => window.clearTimeout(t);
  }, [open, present]);

  useEffect(() => {
    if (!present) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [present]);

  useEffect(() => {
    if (!present) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [present, onClose]);

  if (!present) return null;

  const panelBase =
    "relative w-full rounded-2xl border border-[var(--app-border)] bg-[var(--app-modal-bg)] backdrop-blur-xl";

  const centerPanel = [
    panelBase,
    SIZE_CLASS[size],
    "max-h-[calc(100vh-5rem)] overflow-y-auto overscroll-contain",
    "p-5 sm:p-6",
    "transition-all duration-200 ease-out",
    visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
    panelClassName,
  ].join(" ");

  const bottomPanel = [
    panelBase,
    "mx-auto max-h-[80vh] w-full overflow-y-auto rounded-t-2xl rounded-b-none p-3 sm:p-4",
    "transition-all duration-200 ease-out",
    visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
    panelClassName,
  ].join(" ");

  return (
    <Portal>
      <div className={["fixed inset-0", zIndexClass].join(" ")}>
        <button
          type="button"
          aria-label="Fechar"
          onClick={onClose}
          className={[
            "absolute inset-0 z-0 bg-transparent",
            "transition-opacity duration-200 ease-out",
            visible ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />

        {position === "center" ? (
          <div className="relative z-10 flex min-h-full items-center justify-center px-4 py-10">
            <div className={centerPanel}>{children}</div>
          </div>
        ) : (
          <div className="absolute inset-x-0 bottom-0 z-10 px-2 pb-safe">
            <div className={bottomPanel}>{children}</div>
          </div>
        )}
      </div>
    </Portal>
  );
}
