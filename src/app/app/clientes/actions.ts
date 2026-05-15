"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  nome: z.string().min(2),
  telefone: z.string().optional(),
  valor: z.coerce.number().optional(),
  vencimento: z.string().optional(),
  pix_key: z.string().optional(),
  observacoes: z.string().optional(),
  status: z.string().optional(),
});

const updateSchema = createSchema.extend({
  id: z.string().uuid(),
});

export async function createDebtorAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("debtors").insert({
    nome: parsed.data.nome,
    telefone: parsed.data.telefone || null,
    valor: typeof parsed.data.valor === "number" ? parsed.data.valor : null,
    vencimento: parsed.data.vencimento || null,
    pix_key: parsed.data.pix_key || null,
    observacoes: parsed.data.observacoes || null,
    status: parsed.data.status || "ativo",
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateDebtorAction(input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createSupabaseServerClient();
  const { id, ...data } = parsed.data;

  const { error } = await supabase
    .from("debtors")
    .update({
      nome: data.nome,
      telefone: data.telefone || null,
      valor: typeof data.valor === "number" ? data.valor : null,
      vencimento: data.vencimento || null,
      pix_key: data.pix_key || null,
      observacoes: data.observacoes || null,
      status: data.status || "ativo",
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteDebtorAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("debtors").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

