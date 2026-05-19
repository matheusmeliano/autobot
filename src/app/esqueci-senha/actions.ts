"use server";

import { headers } from "next/headers";
import { z } from "zod";
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

  const hdrs = await headers();
  const baseUrl = resolveBaseUrlFromHeaders(hdrs);

  if (!baseUrl) {
    return { ok: false, error: "Não foi possível gerar o link de retorno." };
  }

  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${baseUrl}/auth/callback?next=${encodeURIComponent(
      "/redefinir-senha"
    )}`,
  });

  if (error) {
    return { ok: false, error: supabaseErrorToPt(error.message) };
  }

  return { ok: true };
}
