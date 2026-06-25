"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseErrorToPt } from "@/lib/supabase/errors";

const createSchema = z.object({
  nome: z.string().trim().min(2, "Informe um nome com pelo menos 2 caracteres."),
  conteudo: z.string().trim().min(1, "Informe o conteúdo do template."),
});

const updateSchema = createSchema.extend({
  id: z.string().uuid(),
});

function templateErrorToPt(message: string, action: "save" | "delete") {
  const translated = supabaseErrorToPt(message);
  if (translated && translated !== message) return translated;

  const raw = String(message ?? "");
  const lower = raw.toLowerCase();

  if (
    action === "delete" &&
    ((lower.includes("foreign key") && lower.includes("template")) ||
      (lower.includes("violates foreign key") && lower.includes("schedules")))
  ) {
    return "Este template está em uso em agendamentos e não pode ser excluído.";
  }

  return action === "delete"
    ? "Não foi possível excluir o template."
    : "Não foi possível salvar o template.";
}

export async function createTemplateAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("message_templates").insert(parsed.data);
  if (error) return { ok: false, error: templateErrorToPt(error.message ?? "", "save") };
  return { ok: true };
}

export async function updateTemplateAction(input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createSupabaseServerClient();
  const { id, ...data } = parsed.data;
  const { error } = await supabase.from("message_templates").update(data).eq("id", id);
  if (error) return { ok: false, error: templateErrorToPt(error.message ?? "", "save") };
  return { ok: true };
}

export async function deleteTemplateAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("message_templates").delete().eq("id", id);
  if (error) return { ok: false, error: templateErrorToPt(error.message ?? "", "delete") };
  return { ok: true };
}
