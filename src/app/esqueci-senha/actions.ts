"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseErrorToPt } from "@/lib/supabase/errors";
import { resolveBaseUrlFromHeaders } from "@/lib/site-url";

const schema = z.object({
  email: z.string().email(),
});

export async function forgotPasswordAction(formData: FormData) {
  const parsed = schema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { ok: false, error: "Email inválido." };
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();

  const hdrs = await headers();
  const baseUrl = resolveBaseUrlFromHeaders(hdrs);

  if (!baseUrl) {
    return { ok: false, error: "Não foi possível gerar o link de retorno." };
  }

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    null;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    process.env.SUPABASE_SERVICE ??
    null;

  if (url && serviceKey) {
    const admin = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data: existingProfile, error: profileErr } = await admin
      .from("profiles")
      .select("user_id")
      .ilike("email", normalizedEmail)
      .limit(1)
      .maybeSingle();

    if (profileErr) {
      return { ok: false, error: profileErr.message };
    }

    if (!existingProfile?.user_id) {
      return { ok: false, error: "Este e-mail não está cadastrado." };
    }
  }

  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
    redirectTo: `${baseUrl}/redefinir-senha`,
  });

  if (error) {
    const msg = String(error.message ?? "").toLowerCase();
    const isUserNotFound =
      msg.includes("user_not_found") ||
      msg.includes("user not found") ||
      (msg.includes("not found") && msg.includes("user")) ||
      (msg.includes("email") && msg.includes("not found")) ||
      (msg.includes("email") && msg.includes("does not exist")) ||
      (msg.includes("email") && msg.includes("doesn't exist")) ||
      (msg.includes("no user") && msg.includes("email"));

    if (isUserNotFound) {
      return { ok: false, error: "Este e-mail não está cadastrado." };
    }
    return { ok: false, error: supabaseErrorToPt(error.message) };
  }

  return { ok: true };
}
