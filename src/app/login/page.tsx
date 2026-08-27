import type { Viewport } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeAuthenticatedPath, normalizeAccessScope } from "@/lib/auth/access";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

function digitsOnly(v: string | null | undefined): string {
  return String(v ?? "").replace(/\D/g, "");
}

function formatPhoneMasked(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "").slice(0, 13);
  if (!d) return "";
  if (d.length <= 10) {
    let out = "(" + d.slice(0, 2);
    if (d.length > 2) out += ") " + d.slice(2, 6);
    if (d.length > 6) out += "-" + d.slice(6, 10);
    return out;
  }
  if (d.length <= 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  }
  return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9, 13)}`;
}

async function resolveInitialLoginFromParams(
  _supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  sp: { confirmed?: string; next?: string; lead?: string; telefone?: string },
): Promise<string> {
  try {
    const telefoneFromQs = digitsOnly(sp.telefone);
    if (telefoneFromQs.length >= 10) {
      return formatPhoneMasked(telefoneFromQs) || telefoneFromQs;
    }
  } catch {}
  return "";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ confirmed?: string; next?: string; lead?: string; telefone?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  let user: unknown = null;
  let accessScope = "app";
  let initialLogin = "";
  try {
    const supabase = await createSupabaseServerClient();
    initialLogin = await resolveInitialLoginFromParams(supabase, sp);
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
  if (user && sp.confirmed !== "1") {
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
      <LoginForm initialLogin={initialLogin} />
    </>
  );
}
