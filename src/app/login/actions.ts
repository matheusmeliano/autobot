"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseErrorToPt } from "@/lib/supabase/errors";
import { getSafeAuthenticatedPath, normalizeAccessScope } from "@/lib/auth/access";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const schema = z.object({
  login: z
    .string()
    .trim()
    .refine((v) => {
      if (!v) return false;
      if (EMAIL_REGEX.test(v)) return true;
      const digits = v.replace(/\D/g, "");
      return digits.length >= 10;
    }, "Informe um e-mail ou WhatsApp válido."),
  password: z.string().min(6),
});

function onlyDigits(v: string) {
  return String(v ?? "").replace(/\D/g, "");
}

async function resolveEmailFromLogin(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, loginRaw: string): Promise<string | null> {
  const login = String(loginRaw ?? "").trim();
  if (!login) return null;
  if (EMAIL_REGEX.test(login)) return login;

  const loginDigits = onlyDigits(login);
  if (loginDigits.length < 10) return null;

  const { data: rows } = await supabase
    .from("profiles")
    .select("phone, email")
    .limit(200);

  for (const row of rows ?? []) {
    const rowDigits = onlyDigits(String((row as any).phone ?? ""));
    if (!rowDigits) continue;
    const matchesDirect = rowDigits === loginDigits;
    const matchesSuffix =
      rowDigits.length > loginDigits.length ? rowDigits.endsWith(loginDigits) : loginDigits.endsWith(rowDigits);
    if (matchesDirect || matchesSuffix) {
      const email = String((row as any).email ?? "").trim();
      if (EMAIL_REGEX.test(email)) return email;
    }
  }
  return null;
}

export async function loginAction(formData: FormData) {
  const parsed = schema.safeParse({
    login: formData.get("login"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, error: "Credenciais inválidas." };
  }

  const supabase = await createSupabaseServerClient({ canSetCookies: true });

  const resolvedEmail = await resolveEmailFromLogin(supabase, parsed.data.login);
  if (!resolvedEmail) {
    return { ok: false, error: "Credenciais inválidas." };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: resolvedEmail,
    password: parsed.data.password,
  });
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
