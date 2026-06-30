"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseErrorToPt } from "@/lib/supabase/errors";
import { getSafeAuthenticatedPath, normalizeAccessScope } from "@/lib/auth/access";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function loginAction(formData: FormData) {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, error: "Credenciais inválidas." };
  }

  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { ok: false, error: supabaseErrorToPt(error.message) };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let accessScope = "app";
  if (user?.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("access_scope")
      .eq("user_id", user.id)
      .maybeSingle();
    accessScope = normalizeAccessScope((profile as any)?.access_scope);
  }

  const requestedNext = String(formData.get("next") ?? "").trim();
  const safeNext = getSafeAuthenticatedPath(accessScope, requestedNext);

  return { ok: true, next: safeNext };
}
