"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseErrorToPt } from "@/lib/supabase/errors";
import { resolveBaseUrlFromHeaders } from "@/lib/site-url";
import {
  getSafeAuthenticatedPath,
  isAtendimentoOnlyAccessScope,
  normalizeAccessScope,
} from "@/lib/auth/access";
import { ensureAtendimentoLeadForAuthenticatedUser } from "@/lib/atendimento/server";

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
  const baseUrl = resolveBaseUrlFromHeaders(hdrs);

  if (!baseUrl) {
    return { ok: false, error: "Não foi possível finalizar o cadastro." };
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const accessScope = normalizeAccessScope(formData.get("access_scope"));
  const isAtendimentoOnlyUser = isAtendimentoOnlyAccessScope(accessScope);
  const nextValue = String(formData.get("next") ?? "").trim();
  const safeNext = getSafeAuthenticatedPath(accessScope, nextValue);

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? null;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    process.env.SUPABASE_SERVICE ??
    null;

  const admin =
    url && serviceKey
      ? createClient(url, serviceKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        })
      : null;

  if (admin) {
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("user_id")
      .ilike("email", normalizedEmail)
      .limit(1)
      .maybeSingle();

    if (existingProfile?.user_id) {
      return { ok: false, error: "Este e-mail já possui cadastro. Faça login." };
    }
  }

  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  let data:
    | {
        user: { id?: string | null } | null;
        session: unknown;
      }
    | undefined;
  let error: { message?: string | null } | null = null;

  if (isAtendimentoOnlyUser) {
    if (!admin) {
      return { ok: false, error: "Não foi possível finalizar o cadastro do Atendimento." };
    }

    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: parsed.data.name ? { name: parsed.data.name } : undefined,
    });

    if (createUserError) {
      return { ok: false, error: supabaseErrorToPt(createUserError.message) };
    }

    const { data: signedInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: parsed.data.password,
    });

    data = {
      user: signedInData.user ?? createdUser.user ?? null,
      session: signedInData.session,
    };
    error = signInError ? { message: signInError.message } : null;
  } else {
    const signUpResult = await supabase.auth.signUp({
      email: normalizedEmail,
      password: parsed.data.password,
      options: {
        data: parsed.data.name ? { name: parsed.data.name } : undefined,
        emailRedirectTo: `${baseUrl}/auth/callback?next=${encodeURIComponent(
          `/login?confirmed=1&next=${encodeURIComponent(safeNext)}`,
        )}`,
      },
    });
    data = signUpResult.data;
    error = signUpResult.error;
  }

  if (error) {
    return { ok: false, error: supabaseErrorToPt(error.message ?? "Falha ao criar conta.") };
  }

  const createdUserIdentities = (data?.user as { identities?: unknown[] | null } | null)?.identities;
  if (!isAtendimentoOnlyUser && (createdUserIdentities?.length ?? 0) === 0) {
    return { ok: false, error: "Este e-mail já possui cadastro. Faça login." };
  }

  const userId = data.user?.id ?? null;
  if (userId && admin) {
    const vencimento = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    await admin.from("profiles").upsert(
      {
        user_id: userId,
        email: normalizedEmail,
        nome: parsed.data.name ?? "",
        plano: isAtendimentoOnlyUser ? "vitalicio" : "teste",
        access_scope: accessScope,
      },
      { onConflict: "user_id" },
    );

    const { data: existingSub } = await admin
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (existingSub?.id) {
      await admin
        .from("subscriptions")
        .update({
          plano: isAtendimentoOnlyUser ? "vitalicio" : "teste",
          status: "ativo",
          vencimento: isAtendimentoOnlyUser ? null : vencimento,
        })
        .eq("id", existingSub.id);
    } else {
      await admin.from("subscriptions").insert({
        user_id: userId,
        plano: isAtendimentoOnlyUser ? "vitalicio" : "teste",
        status: "ativo",
        vencimento: isAtendimentoOnlyUser ? null : vencimento,
      });
    }

    if (isAtendimentoOnlyUser) {
      await ensureAtendimentoLeadForAuthenticatedUser({
        userId,
        email: normalizedEmail,
        name: parsed.data.name ?? "",
      });
    }
  }

  const hasSession = Boolean(data.session);
  return { ok: true, needsEmailConfirmation: !hasSession, next: safeNext };
}
