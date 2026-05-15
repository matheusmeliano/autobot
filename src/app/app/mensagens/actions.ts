"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  nome: z.string().min(2),
  conteudo: z.string().min(1),
});

const updateSchema = createSchema.extend({
  id: z.string().uuid(),
});

export async function createTemplateAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("message_templates").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateTemplateAction(input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { id, ...data } = parsed.data;
  const { error } = await supabase.from("message_templates").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteTemplateAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("message_templates").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

