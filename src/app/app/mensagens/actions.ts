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

const deleteSchema = z.string().uuid();

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
  const { data: updated, error } = await supabase
    .from("message_templates")
    .update(data)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: templateErrorToPt(error.message ?? "", "save") };
  if (!updated?.id) return { ok: false, error: "Template não encontrado." };
  return { ok: true };
}

export async function deleteTemplateAction(id: string) {
  const parsedId = deleteSchema.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, error: "Template inválido." };
  }

  const supabase = await createSupabaseServerClient();
  const { count, error: usageError } = await supabase
    .from("schedules")
    .select("id", { count: "exact", head: true })
    .is("closed_at", null)
    .or(
      `template_id.eq.${parsedId.data},template_pending_id.eq.${parsedId.data},template_overdue_id.eq.${parsedId.data}`,
    );

  if (usageError) {
    return { ok: false, error: templateErrorToPt(usageError.message ?? "", "delete") };
  }

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: "Este template está em uso em agendamentos e não pode ser excluído.",
    };
  }

  const { data: deleted, error } = await supabase
    .from("message_templates")
    .delete()
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: templateErrorToPt(error.message ?? "", "delete") };
  if (!deleted?.id) return { ok: false, error: "Template não encontrado." };
  return { ok: true };
}
