import type { Viewport } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeAuthenticatedPath, normalizeAccessScope } from "@/lib/auth/access";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/SignupForm";

export const dynamic = "force-dynamic";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  let user: unknown = null;
  let accessScope = "app";
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: supabaseUser },
    } = await supabase.auth.getUser();
    user = supabaseUser;
    if ((supabaseUser as any)?.id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("access_scope")
        .eq("user_id", String((supabaseUser as any).id))
        .maybeSingle();
      accessScope = normalizeAccessScope((profile as any)?.access_scope);
    }
  } catch {
    user = null;
  }

  if (user) {
    const requestedNext = String(sp.next ?? "");
    const safeNext = getSafeAuthenticatedPath(accessScope, requestedNext);
    redirect(safeNext);
  }

  return (
    <>
      <style>{`
        html,
        body {
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
        }

        @supports (-webkit-touch-callout: none) {
          input,
          textarea,
          select {
            font-size: 16px !important;
          }
        }
      `}</style>
      <SignupForm />
    </>
  );
}
