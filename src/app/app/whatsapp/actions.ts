"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase/admin";
import { isGlobalAdminEmail } from "@/lib/auth/admin";

const MASK = "********";

const schema = z.object({
  instance_id: z.string().min(1),
  token: z.string().optional(),
  client_token: z.string().optional(),
});

export async function upsertWhatsAppInstanceAction(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const tokenRaw = String(parsed.data.token ?? "").trim();
  const clientTokenRaw = String(parsed.data.client_token ?? "").trim();
  const token = tokenRaw && tokenRaw !== MASK ? tokenRaw : null;
  const clientToken = clientTokenRaw && clientTokenRaw !== MASK ? clientTokenRaw : null;

  const firstExisting = await supabase
    .from("whatsapp_instances")
    .select("token, client_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const missingClientToken =
    firstExisting.error &&
    /client_token/i.test(firstExisting.error.message) &&
    /column/i.test(firstExisting.error.message);
  const secondExisting = missingClientToken
    ? await supabase
        .from("whatsapp_instances")
        .select("token")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : null;
  const existing = (secondExisting?.data ?? firstExisting.data) as any;
  const existingError = secondExisting?.error ?? firstExisting.error;
  if (existingError && !missingClientToken) {
    return { ok: false, error: existingError.message };
  }

  const nextToken = token ?? existing?.token ?? null;
  if (!nextToken) return { ok: false, error: "Informe o token." };

  const baseRow: any = {
    user_id: userId,
    instance_id: parsed.data.instance_id,
    token: nextToken,
    status: "configured",
  };
  if (!missingClientToken) {
    baseRow.client_token = clientToken ?? existing?.client_token ?? null;
  }

  let error = (await supabase.from("whatsapp_instances").upsert(baseRow, { onConflict: "user_id" }))
    .error;
  if (
    error &&
    !missingClientToken &&
    /client_token/i.test(error.message ?? "") &&
    /column/i.test(error.message ?? "")
  ) {
    const retryRow: any = { ...baseRow };
    const { client_token: _omit, ...withoutClient } = retryRow;
    Object.assign(retryRow, withoutClient);
    error = (await supabase.from("whatsapp_instances").upsert(retryRow, { onConflict: "user_id" })).error;
  }

  if (error) {
    const msg = error.message ?? "";
    const missingClientTokenOnWrite = /client_token/i.test(msg) && /column/i.test(msg);
    if (missingClientTokenOnWrite) {
      return {
        ok: false,
        error:
          "Rode a migration correspondente em whatsapp_instances (client_token) e tente novamente.",
      };
    }
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export async function setWhatsAppInstanceDisplayNameAdminAction(input: unknown) {
  const parsed = z
    .object({
      user_id: z.string().min(1),
      display_name: z.string().trim().max(80).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const adminSupabase = tryCreateSupabaseAdminClient();
  if (!adminSupabase) {
    return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY não configurada." };
  }
  const serverSupabase = await createSupabaseServerClient();
  const { data: userRes } = await serverSupabase.auth.getUser();
  const adminUser = userRes.user;
  if (!adminUser) return { ok: false, error: "Sem sessão." };
  if (!isGlobalAdminEmail(adminUser.email)) {
    return { ok: false, error: "Você não é um administrador." };
  }

  const safeDisplayName = parsed.data.display_name === "" ? null : parsed.data.display_name;
  const selectCols = ["id", "display_name", "phone", "instance_id"];

  const first = await adminSupabase
    .from("whatsapp_instances")
    .select(selectCols.join(", "))
    .eq("user_id", parsed.data.user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const missingDisplayName =
    first.error &&
    /display_name/i.test(first.error.message) &&
    /column/i.test(first.error.message);

  let updatedData: any = first.data;
  let errorObject = first.error;

  if (!missingDisplayName && !errorObject) {
    const { data, error } = await adminSupabase
      .from("whatsapp_instances")
      .update({ display_name: safeDisplayName })
      .eq("user_id", parsed.data.user_id)
      .select(selectCols.join(", "))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    updatedData = data;
    errorObject = error;
  }

  if (errorObject && !missingDisplayName) {
    return { ok: false, error: errorObject.message };
  }

  return {
    ok: true,
    display_name: String((updatedData as any)?.display_name ?? safeDisplayName ?? "").trim() || null,
    phone: String((updatedData as any)?.phone ?? "").trim() || null,
    instance_id: String((updatedData as any)?.instance_id ?? "").trim() || null,
  };
}
