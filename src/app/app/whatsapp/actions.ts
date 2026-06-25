"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
        .maybeSingle()
    : null;
  const existing = (secondExisting?.data ?? firstExisting.data) as any;
  const existingError = secondExisting?.error ?? firstExisting.error;
  if (existingError) return { ok: false, error: existingError.message };

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
    const { client_token: _omit, ...retryRow } = baseRow;
    error = (await supabase.from("whatsapp_instances").upsert(retryRow, { onConflict: "user_id" }))
      .error;
  }

  if (error) {
    const msg = error.message ?? "";
    const missingClientTokenOnWrite = /client_token/i.test(msg) && /column/i.test(msg);
    if (missingClientTokenOnWrite) {
      return {
        ok: false,
        error:
          "Rode a migration para adicionar a coluna client_token em whatsapp_instances e tente novamente.",
      };
    }
    return { ok: false, error: msg };
  }
  return { ok: true };
}
