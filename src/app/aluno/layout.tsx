import {
  getDefaultAuthenticatedPath,
  isAlunoOnlyAccessScope,
  normalizeAccessScope,
} from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Viewport } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function AlunoPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    const hdrs = await headers();
    const candidates = [
      hdrs.get("x-invoke-path"),
      hdrs.get("x-matched-path"),
      hdrs.get("next-url"),
      hdrs.get("x-next-url"),
      hdrs.get("x-original-uri"),
      hdrs.get("x-forwarded-uri"),
    ];
    let nextPath = candidates.find((value) => typeof value === "string" && value.startsWith("/")) ?? "";
    if (!nextPath) {
      const referer = hdrs.get("referer");
      if (referer) {
        try {
          const refUrl = new URL(referer);
          if (refUrl.pathname.startsWith("/aluno")) {
            nextPath = `${refUrl.pathname}${refUrl.search}`;
          }
        } catch {}
      }
    }
    if (nextPath) {
      redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    }
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("theme, access_scope")
    .eq("user_id", session.user.id)
    .maybeSingle();

  const accessScope = normalizeAccessScope((profile as any)?.access_scope);
  if (!isAlunoOnlyAccessScope(accessScope)) {
    redirect(getDefaultAuthenticatedPath(accessScope));
  }

  return (
    <>
      <style>{`
        html,
        body {
          background: #ffffff;
          overscroll-behavior-y: none;
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
          color: #0f172a;
        }

        @supports (-webkit-touch-callout: none) {
          input,
          textarea,
          select {
            font-size: 16px !important;
          }
        }
      `}</style>
      <div className="min-h-[100dvh] w-full bg-gradient-to-b from-indigo-50/60 via-white to-white">
        {children}
      </div>
    </>
  );
}
