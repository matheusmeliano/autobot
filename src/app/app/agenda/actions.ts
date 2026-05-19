"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BRAZIL_TIMEZONES, zonedDateTimeToUtcIso } from "@/lib/timezone";

const createSchema = z.object({
  debtor_id: z.string().uuid(),
  template_id: z.string().uuid().optional(),
  data_envio_date: z.string().min(10),
  data_envio_time: z.string().min(4),
  status: z.string().optional(),
});

const updateSchema = createSchema.extend({
  id: z.string().uuid(),
});

export async function createScheduleAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const { data: profile } = await supabase.from("profiles").select("timezone").maybeSingle();
  const tzRaw = (profile as any)?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? tzRaw : "America/Sao_Paulo";

  let dataEnvioIso: string;
  try {
    dataEnvioIso = zonedDateTimeToUtcIso({
      date: parsed.data.data_envio_date,
      time: parsed.data.data_envio_time,
      timeZone,
    });
  } catch {
    return { ok: false, error: "Data/hora inválida." };
  }

  if (new Date(dataEnvioIso).getTime() < Date.now()) {
    return { ok: false, error: "Escolha um horário igual ou superior ao horário atual." };
  }

  const { error } = await supabase.from("schedules").insert({
    debtor_id: parsed.data.debtor_id,
    template_id: parsed.data.template_id ?? null,
    data_envio: dataEnvioIso,
    status: parsed.data.status ?? "agendado",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateScheduleAction(input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { id, ...data } = parsed.data;
  const { data: profile } = await supabase.from("profiles").select("timezone").maybeSingle();
  const tzRaw = (profile as any)?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? tzRaw : "America/Sao_Paulo";

  let dataEnvioIso: string;
  try {
    dataEnvioIso = zonedDateTimeToUtcIso({
      date: data.data_envio_date,
      time: data.data_envio_time,
      timeZone,
    });
  } catch {
    return { ok: false, error: "Data/hora inválida." };
  }

  const { error } = await supabase
    .from("schedules")
    .update({
      debtor_id: data.debtor_id,
      template_id: data.template_id ?? null,
      data_envio: dataEnvioIso,
      status: data.status ?? "agendado",
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteScheduleAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("schedules").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
