"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePlan } from "@/lib/plans";

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
  const { data: profile } = await supabase.from("profiles").select("plano").maybeSingle();
  const plan = normalizePlan((profile as any)?.plano);
  const limited = plan !== "pro" && plan !== "vitalicio";

  if (limited) {
    const { count } = await supabase
      .from("debtors")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) >= 15) {
      return {
        ok: false,
        error: "Limite do plano básico: até 15 cadastros de clientes.",
      };
    }
  }

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
