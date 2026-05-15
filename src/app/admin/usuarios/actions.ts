"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { supabaseErrorToPt } from "@/lib/supabase/errors";
import { normalizePlan } from "@/lib/plans";

async function assertAdmin() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isGlobalAdminEmail(user?.email)) {
    return { ok: false as const, error: "Acesso negado." };
  }

  return { ok: true as const };
}

const updateSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1).max(120),
  plano: z.enum(["teste", "basico", "pro", "vitalicio"]),
  assinatura_status: z.enum(["ativo", "pausado", "cancelado"]),
  vencimento: z.string().optional(),
});

export async function updateUserAdminAction(input: unknown) {
  const admin = await assertAdmin();
  if (!admin.ok) return admin;

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "Dados inválidos." };
  }

  const supabase = createSupabaseAdminClient();
  const payload = parsed.data;
  const plano = normalizePlan(payload.plano);

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(
      {
        user_id: payload.id,
        nome: payload.nome,
        plano,
      },
      { onConflict: "user_id" },
    );

  if (profileError) {
    return { ok: false as const, error: supabaseErrorToPt(profileError.message) };
  }

  const { data: latestSub } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("user_id", payload.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error: subError } = latestSub?.id
    ? await supabase
        .from("subscriptions")
        .update({
          plano,
          status: payload.assinatura_status,
          vencimento:
            payload.plano === "vitalicio"
              ? null
              : payload.vencimento
                ? payload.vencimento
                : null,
        })
        .eq("id", latestSub.id)
    : await supabase.from("subscriptions").insert({
        user_id: payload.id,
        plano,
        status: payload.assinatura_status,
        vencimento:
          payload.plano === "vitalicio"
            ? null
            : payload.vencimento
              ? payload.vencimento
              : null,
      });

  if (subError) {
    return { ok: false as const, error: supabaseErrorToPt(subError.message) };
  }

  return { ok: true as const };
}

const resetSchema = z.object({
  id: z.string().min(1),
  password: z.string().min(8).max(72),
});

export async function resetPasswordAdminAction(input: unknown) {
  const admin = await assertAdmin();
  if (!admin.ok) return admin;

  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "Senha inválida." };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(parsed.data.id, {
    password: parsed.data.password,
  });

  if (error) {
    return { ok: false as const, error: supabaseErrorToPt(error.message) };
  }

  return { ok: true as const };
}

export async function deleteUserAdminAction(id: string) {
  const admin = await assertAdmin();
  if (!admin.ok) return admin;

  if (!id) return { ok: false as const, error: "ID inválido." };

  const supabase = createSupabaseAdminClient();
  const { data: target } = await supabase.auth.admin.getUserById(id);
  if (isGlobalAdminEmail(target.user?.email)) {
    return { ok: false as const, error: "Não é possível excluir este admin." };
  }
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) {
    return { ok: false as const, error: supabaseErrorToPt(error.message) };
  }

  return { ok: true as const };
}
