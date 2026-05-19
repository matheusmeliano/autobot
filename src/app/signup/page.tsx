import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/SignupForm";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
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

  if (user) {
    redirect("/app");
  }

  return <SignupForm />;
}
