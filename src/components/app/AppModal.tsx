"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { Portal } from "@/components/ui/Portal";

type ModalPosition = "center" | "bottom";
type ModalSize = "md" | "lg" | "xl";

const SIZE_CLASS: Record<ModalSize, string> = {
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-2xl",
};

const FULLSCREEN_MOBILE_DESKTOP_SIZE_CLASS: Record<ModalSize, string> = {
  md: "lg:max-w-md",
  lg: "lg:max-w-xl",
  xl: "lg:max-w-2xl",
};

export function AppModal({
  open,
  onClose,
  children,
  position = "center",
  size = "lg",
  zIndexClass = "z-[100]",
  panelClassName = "",
  fullScreenOnMobile = false,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  position?: ModalPosition;
  size?: ModalSize;
  zIndexClass?: string;
  panelClassName?: string;
  fullScreenOnMobile?: boolean;
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
    fullScreenOnMobile
      ? `flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col overflow-y-auto rounded-none border-0 p-3 ${FULLSCREEN_MOBILE_DESKTOP_SIZE_CLASS[size]} lg:h-auto lg:max-h-[calc(100vh-8rem)] lg:rounded-2xl lg:border lg:p-5`
      : `${SIZE_CLASS[size]} max-h-[calc(100vh-13rem)] overflow-y-auto overscroll-contain p-4 sm:max-h-[calc(100vh-8rem)] sm:p-5`,
    "transition-all duration-200 ease-out",
    visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
    panelClassName,
  ].join(" ");

  const bottomPanel = [
    panelBase,
    "mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col overflow-hidden rounded-none border-0 p-3 sm:p-4",
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
          <div
            className={[
              "relative z-10 flex min-h-full",
              fullScreenOnMobile ? "items-stretch justify-stretch px-0 py-0 lg:items-center lg:justify-center lg:px-4 lg:py-8" : "items-center justify-center px-3 py-6 sm:px-4 sm:py-8",
            ].join(" ")}
          >
            <div className={centerPanel}>{children}</div>
          </div>
        ) : (
          <div className="absolute inset-0 z-10">
            <div className={bottomPanel}>{children}</div>
          </div>
        )}
      </div>
    </Portal>
  );
}
