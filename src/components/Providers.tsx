"use client";

import { ModalToastProvider } from "@/components/app/ModalToastProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ModalToastProvider />
    </>
  );
}
