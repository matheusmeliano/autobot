"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseErrorToPt } from "@/lib/supabase/errors";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).optional(),
});

export async function signupAction(formData: FormData) {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const hdrs = await headers();
  const origin = hdrs.get("origin");
  const forwardedProto = hdrs.get("x-forwarded-proto");
  const host =
    hdrs.get("x-forwarded-host") ??
    hdrs.get("host") ??
    hdrs.get("x-forwarded-server");

  const baseUrl = (() => {
    const envUrl =
      process.env.NEXT_PUBLIC_SITE_URL ??
      process.env.SITE_URL ??
      process.env.NEXT_PUBLIC_APP_URL;

    const raw =
      envUrl ??
      origin ??
      (host ? `${forwardedProto ?? "http"}://${host}` : null) ??
      (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : null);

    if (!raw) return null;
    return raw.replace("0.0.0.0", "localhost");
  })();

  if (!baseUrl) {
    return { ok: false, error: "Não foi possível finalizar o cadastro." };
  }

  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: parsed.data.name ? { name: parsed.data.name } : undefined,
      emailRedirectTo: `${baseUrl}/auth/callback?next=${encodeURIComponent(
        "/login?confirmed=1",
      )}`,
    },
  });

  if (error) {
    return { ok: false, error: supabaseErrorToPt(error.message) };
  }

  const userId = data.user?.id ?? null;
  if (userId) {
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? null;
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

      const vencimento = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      await admin.from("profiles").upsert(
        {
          user_id: userId,
          email: parsed.data.email,
          nome: parsed.data.name ?? "",
          plano: "teste",
        },
        { onConflict: "user_id" },
      );

      const { data: existingSub } = await admin
        .from("subscriptions")
        .select("id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

      if (!existingSub?.id) {
        await admin.from("subscriptions").insert({
          user_id: userId,
          plano: "teste",
          status: "ativo",
          vencimento,
        });
      }
    }
  }

  const hasSession = Boolean(data.session);
  return { ok: true, needsEmailConfirmation: !hasSession };
}
