import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ confirmed?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  let user: unknown = null;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: supabaseUser },
    } = await supabase.auth.getUser();
    user = supabaseUser;
  } catch {
    user = null;
  }

  if (user && sp.confirmed !== "1") {
    redirect("/app");
  }

  return <LoginForm />;
}
