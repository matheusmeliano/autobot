import type { Viewport } from "next";
import { redirect } from "next/navigation";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function AtendimentoPublicPage() {
  redirect("/login");
}
