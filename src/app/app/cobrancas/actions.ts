"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  debtor_id: z.string().uuid(),
  mensagem: z.string().min(1),
  status: z.string().optional(),
});

export async function createChargeAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("charges").insert({
    debtor_id: parsed.data.debtor_id,
    mensagem: parsed.data.mensagem,
    status: parsed.data.status ?? "pendente",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateChargeStatusAction(id: string, status: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("charges").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteChargeAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("charges").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

