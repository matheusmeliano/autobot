"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseErrorToPt } from "@/lib/supabase/errors";

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

  const hdrs = await headers();
  const origin = hdrs.get("origin");
  const forwardedProto = hdrs.get("x-forwarded-proto");
  const host =
    hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? hdrs.get("x-forwarded-server");

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
    return { ok: false, error: "Não foi possível gerar o link de retorno." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${baseUrl}/redefinir-senha`,
  });

  if (error) {
    return { ok: false, error: supabaseErrorToPt(error.message) };
  }

  return { ok: true };
}
