import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeAuthenticatedPath, normalizeAccessScope } from "@/lib/auth/access";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ confirmed?: string; next?: string }>;
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

  if (user && sp.confirmed !== "1") {
    const requestedNext = String(sp.next ?? "");
    const safeNext = getSafeAuthenticatedPath(accessScope, requestedNext);
    redirect(safeNext);
  }

  return <LoginForm />;
}
