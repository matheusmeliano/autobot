"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BRAZIL_TIMEZONES, zonedDateTimeToUtcIso } from "@/lib/timezone";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { localDateInTimeZone, nextMonthlyIso, shouldContinueMonthlyRecurrence } from "@/lib/recurrence";

function prereqError(params: {
  missingTimeZone: boolean;
  missingWhatsApp: boolean;
  context: "criar agendamentos" | "editar agendamentos" | "disparar agendamentos";
}) {
  if (params.missingTimeZone && params.missingWhatsApp) {
    return `Selecione e salve seu fuso horário em Configurações e configure seu WhatsApp na página WhatsApp antes de ${params.context}.`;
  }
  if (params.missingTimeZone) {
    return `Selecione e salve seu fuso horário em Configurações antes de ${params.context}.`;
  }
  if (params.missingWhatsApp) {
    return `Configure seu WhatsApp na página WhatsApp antes de ${params.context}.`;
  }
  return null;
}

function normalizePhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55")) return d;
  if (d.length === 11) return `55${d}`;
  return d;
}

function applyTemplate(text: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), text);
}

function formatBRL(value: unknown) {
  if (value === null || value === undefined) return "";
  const n = typeof value === "number" ? value : Number(String(value));
  if (Number.isNaN(n)) return "";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function formatDateBR(value: unknown) {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
}

async function sendZapiText(params: {
  instance_id: string;
  token: string;
  client_token?: string | null;
  phone: string;
  message: string;
}) {
  const body = JSON.stringify({ phone: normalizePhone(params.phone), message: params.message });
  const baseUrl = `https://api.z-api.io/instances/${encodeURIComponent(params.instance_id)}`;
  const urlWithTokenInPath = `${baseUrl}/token/${encodeURIComponent(params.token)}/send-text`;
  const urlWithHeader = `${baseUrl}/send-text`;

  const trySend = async (url: string, includeHeaderToken: boolean) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(includeHeaderToken && params.client_token ? { "Client-Token": params.client_token } : {}),
      },
      body,
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  };

  const first = await trySend(urlWithTokenInPath, Boolean(params.client_token));
  if (first.response.ok) return first.data;

  const errText = JSON.stringify(first.data ?? "");
  const mentionsClientToken = /client-token/i.test(errText);
  const isForbidden = first.response.status === 403;
  const isBadRequest = first.response.status === 400;

  if (mentionsClientToken && !params.client_token) {
    throw new Error("Client-Token não configurado no WhatsApp.");
  }

  if ((isBadRequest || isForbidden) && mentionsClientToken) {
    const second = await trySend(urlWithHeader, Boolean(params.client_token));
    if (second.response.ok) return second.data;
    throw new Error(
      `Falha ao enviar: ${second.response.status} ${JSON.stringify(second.data) ?? ""}`.trim(),
    );
  }

  throw new Error(
    `Falha ao enviar: ${first.response.status} ${JSON.stringify(first.data) ?? ""}`.trim(),
  );
}

const createSchema = z.object({
  debtor_id: z.string().uuid(),
  template_id: z.string().uuid().optional(),
  data_envio_date: z.string().min(10),
  data_envio_time: z.string().min(4),
  recurrence: z.enum(["none", "monthly"]).optional(),
  recurrence_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().optional(),
});

const updateSchema = createSchema.extend({
  id: z.string().uuid(),
});

const updateRecurrenceUntilSchema = z.object({
  id: z.string().uuid(),
  recurrence_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

function validateRecurrenceUntil(params: {
  recurrence: "none" | "monthly";
  recurrenceUntil?: string;
  currentDate: string;
}) {
  if (params.recurrence !== "monthly") return null;
  if (!params.recurrenceUntil) return null;
  if (params.recurrenceUntil < params.currentDate) {
    return "A data final da cobrança mensal deve ser igual ou posterior à primeira cobrança.";
  }
  return null;
}

export async function createScheduleAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const [profileRes, waRes] = await Promise.all([
    supabase.from("profiles").select("timezone").maybeSingle(),
    supabase.from("whatsapp_instances").select("instance_id, token, status").maybeSingle(),
  ]);
  const tzRaw = (profileRes as any)?.data?.timezone ?? (profileRes as any)?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? tzRaw : null;
  const wa = (waRes as any)?.data ?? null;
  const waStatus = String(wa?.status ?? "").toLowerCase();
  const whatsappConfigured = Boolean(
    wa?.instance_id && wa?.token && (waStatus === "configured" || waStatus === "connected"),
  );
  const msg = prereqError({
    missingTimeZone: !timeZone,
    missingWhatsApp: !whatsappConfigured,
    context: "criar agendamentos",
  });
  if (msg) return { ok: false, error: msg };

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

  if (new Date(dataEnvioIso).getTime() < Date.now() + 3 * 60 * 1000) {
    return { ok: false, error: "Escolha um horário futuro válido (mínimo +3 minutos)." };
  }

  const recurrence = parsed.data.recurrence ?? "none";
  const recurrenceUntil = parsed.data.recurrence_until;
  const recurrenceValidation = validateRecurrenceUntil({
    recurrence,
    recurrenceUntil,
    currentDate: parsed.data.data_envio_date,
  });
  if (recurrenceValidation) return { ok: false, error: recurrenceValidation };
  const recurrenceDay = Number(parsed.data.data_envio_date.split("-")[2] ?? "");
  const recurrenceTime = parsed.data.data_envio_time;

  const { error } = await supabase.from("schedules").insert({
    debtor_id: parsed.data.debtor_id,
    template_id: parsed.data.template_id ?? null,
    data_envio: dataEnvioIso,
    recurrence,
    schedule_timezone: recurrence === "monthly" ? timeZone : null,
    recurrence_day: recurrence === "monthly" ? (Number.isFinite(recurrenceDay) ? recurrenceDay : null) : null,
    recurrence_time: recurrence === "monthly" ? recurrenceTime : null,
    recurrence_until: recurrence === "monthly" ? recurrenceUntil ?? null : null,
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
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const [profileRes, waRes] = await Promise.all([
    supabase.from("profiles").select("timezone").maybeSingle(),
    supabase.from("whatsapp_instances").select("instance_id, token, status").maybeSingle(),
  ]);
  const tzRaw = (profileRes as any)?.data?.timezone ?? (profileRes as any)?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? tzRaw : null;
  const wa = (waRes as any)?.data ?? null;
  const waStatus = String(wa?.status ?? "").toLowerCase();
  const whatsappConfigured = Boolean(
    wa?.instance_id && wa?.token && (waStatus === "configured" || waStatus === "connected"),
  );
  const msg = prereqError({
    missingTimeZone: !timeZone,
    missingWhatsApp: !whatsappConfigured,
    context: "editar agendamentos",
  });
  if (msg) return { ok: false, error: msg };

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

  if (new Date(dataEnvioIso).getTime() < Date.now() + 3 * 60 * 1000) {
    return { ok: false, error: "Escolha um horário futuro válido (mínimo +3 minutos)." };
  }

  const recurrence = (data as any).recurrence ?? "none";
  const recurrenceUntil = data.recurrence_until;
  const recurrenceValidation = validateRecurrenceUntil({
    recurrence,
    recurrenceUntil,
    currentDate: data.data_envio_date,
  });
  if (recurrenceValidation) return { ok: false, error: recurrenceValidation };
  const recurrenceDay = Number(String(data.data_envio_date ?? "").split("-")[2] ?? "");
  const recurrenceTime = String(data.data_envio_time ?? "");

  const { error } = await supabase
    .from("schedules")
    .update({
      debtor_id: data.debtor_id,
      template_id: data.template_id ?? null,
      data_envio: dataEnvioIso,
      recurrence,
      schedule_timezone: recurrence === "monthly" ? timeZone : null,
      recurrence_day: recurrence === "monthly" ? (Number.isFinite(recurrenceDay) ? recurrenceDay : null) : null,
      recurrence_time: recurrence === "monthly" ? recurrenceTime : null,
      recurrence_until: recurrence === "monthly" ? recurrenceUntil ?? null : null,
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

export async function updateScheduleRecurrenceUntilAction(input: unknown) {
  const parsed = updateRecurrenceUntilSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const admin = createSupabaseAdminClient();
  const { data: schedule, error } = await admin
    .from("schedules")
    .select("id, user_id, data_envio, recurrence, schedule_timezone")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!schedule?.id) return { ok: false, error: "Agendamento não encontrado." };
  if (String((schedule as any).user_id) !== userId) return { ok: false, error: "Sem permissão." };
  if (String((schedule as any).recurrence ?? "none") !== "monthly") {
    return { ok: false, error: "Essa opção está disponível apenas para agendamentos mensais." };
  }

  const currentDate = localDateInTimeZone(
    String((schedule as any).data_envio),
    String((schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo",
  );
  if (parsed.data.recurrence_until && parsed.data.recurrence_until < currentDate) {
    return { ok: false, error: "A data final deve ser igual ou posterior à cobrança atual." };
  }

  const { error: updateError } = await admin
    .from("schedules")
    .update({ recurrence_until: parsed.data.recurrence_until ?? null })
    .eq("id", parsed.data.id);
  if (updateError) return { ok: false, error: updateError.message };

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "agenda_recorrencia_final",
    descricao: parsed.data.recurrence_until
      ? `Data final da cobrança mensal definida para ${parsed.data.recurrence_until} no agendamento ${parsed.data.id}`
      : `Data final da cobrança mensal removida do agendamento ${parsed.data.id}`,
  });

  return { ok: true };
}

export async function triggerScheduleNowAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const [profileRes, waRes] = await Promise.all([
    supabase.from("profiles").select("timezone").maybeSingle(),
    supabase.from("whatsapp_instances").select("instance_id, token, status").maybeSingle(),
  ]);
  const tzRaw = (profileRes as any)?.data?.timezone ?? (profileRes as any)?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? tzRaw : null;
  const wa = (waRes as any)?.data ?? null;
  const waStatus = String(wa?.status ?? "").toLowerCase();
  const whatsappConfigured = Boolean(
    wa?.instance_id && wa?.token && (waStatus === "configured" || waStatus === "connected"),
  );
  const msg = prereqError({
    missingTimeZone: !timeZone,
    missingWhatsApp: !whatsappConfigured,
    context: "disparar agendamentos",
  });
  if (msg) return { ok: false, error: msg };

  const admin = createSupabaseAdminClient();
  const { data: schedule, error } = await admin
    .from("schedules")
    .select(
      "id, user_id, debtor_id, template_id, data_envio, status, recurrence, schedule_timezone, recurrence_day, recurrence_time, recurrence_until, debtors(nome, telefone, pix_key, valor, vencimento), message_templates(conteudo)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!schedule?.id) return { ok: false, error: "Agendamento não encontrado." };
  if (String((schedule as any).user_id) !== userId) return { ok: false, error: "Sem permissão." };

  const currentStatus = String((schedule as any).status ?? "");
  if (currentStatus === "executado") {
    return { ok: false, error: "Esse agendamento já foi executado." };
  }

  const { data: locked, error: lockErr } = await admin
    .from("schedules")
    .update({ status: "executando" })
    .eq("id", String((schedule as any).id))
    .select("id")
    .maybeSingle();

  if (lockErr) return { ok: false, error: lockErr.message };
  if (!locked?.id) return { ok: false, error: "Não foi possível iniciar o disparo." };

  try {
    const debtor = (schedule as any).debtors ?? null;
    const template = (schedule as any).message_templates ?? null;

    const debtorPhone = String(debtor?.telefone ?? "");
    const templateText = String(template?.conteudo ?? "");
    if (!debtorPhone) throw new Error("Cliente sem telefone");
    if (!templateText) throw new Error("Template sem conteúdo");

    const { data: wa, error: waErr } = await admin
      .from("whatsapp_instances")
      .select("instance_id, token, client_token, status")
      .eq("user_id", userId)
      .maybeSingle();

    if (waErr) throw new Error(waErr.message);
    if (!wa?.instance_id || !wa?.token) throw new Error("WhatsApp não configurado");
    if ((wa.status ?? "").toLowerCase() !== "configured" && (wa.status ?? "").toLowerCase() !== "connected") {
      throw new Error("WhatsApp desconectado");
    }

    const message = applyTemplate(templateText, {
      nome: String(debtor?.nome ?? ""),
      pix: String(debtor?.pix_key ?? ""),
      valor: formatBRL(debtor?.valor),
      vencimento: formatDateBR(debtor?.vencimento),
    });

    await sendZapiText({
      instance_id: wa.instance_id,
      token: wa.token,
      client_token: wa.client_token,
      phone: debtorPhone,
      message,
    });

    await admin.from("logs").insert({
      user_id: userId,
      tipo: "agenda_executada",
      descricao: `Agendamento executado: ${String((schedule as any).id)}`,
    });

    const recurrence = String((schedule as any).recurrence ?? "none");
    if (recurrence === "monthly") {
      const tz = String((schedule as any).schedule_timezone ?? "");
      const day = Number((schedule as any).recurrence_day ?? 1);
      const time = String((schedule as any).recurrence_time ?? "");
      const nextIso = nextMonthlyIso({
        fromUtcIso: String((schedule as any).data_envio),
        timeZone: tz || "America/Sao_Paulo",
        day,
        time: time || "00:00",
      });
      const shouldContinue = shouldContinueMonthlyRecurrence({
        nextUtcIso: nextIso,
        recurrenceUntil: String((schedule as any).recurrence_until ?? "") || null,
        timeZone: tz || "America/Sao_Paulo",
      });

      await admin.from("schedule_runs").insert({
        user_id: userId,
        schedule_id: String((schedule as any).id),
        scheduled_for: String((schedule as any).data_envio),
        executed_at: new Date().toISOString(),
        status: "executado",
      });

      await admin
        .from("schedules")
        .update(shouldContinue ? { status: "agendado", data_envio: nextIso } : { status: "executado" })
        .eq("id", String((schedule as any).id));
    } else {
      await admin.from("schedules").update({ status: "executado" }).eq("id", String((schedule as any).id));
    }
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message ?? "Erro desconhecido");
    const recurrence = String((schedule as any)?.recurrence ?? "none");
    if (recurrence === "monthly") {
      await admin.from("schedule_runs").insert({
        user_id: userId,
        schedule_id: String((schedule as any)?.id ?? ""),
        scheduled_for: String((schedule as any)?.data_envio ?? new Date().toISOString()),
        executed_at: new Date().toISOString(),
        status: "falha",
        error: msg,
      });
    }
    await admin.from("logs").insert({
      user_id: userId,
      tipo: "agenda_falha",
      descricao: `Falha ao executar agendamento ${String((schedule as any).id)}: ${msg}`,
    });
    await admin.from("schedules").update({ status: "agendado" }).eq("id", String((schedule as any).id));
    return { ok: false, error: msg };
  }
}

export async function markSchedulePaidAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const admin = createSupabaseAdminClient();
  const { data: schedule, error } = await admin
    .from("schedules")
    .select("id, user_id, data_envio, status, recurrence, schedule_timezone, recurrence_day, recurrence_time, recurrence_until")
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!schedule?.id) return { ok: false, error: "Agendamento não encontrado." };
  if (String((schedule as any).user_id) !== userId) return { ok: false, error: "Sem permissão." };

  const recurrence = String((schedule as any).recurrence ?? "none");
  if (recurrence !== "monthly") {
    return { ok: false, error: "Essa opção está disponível apenas para agendamentos mensais." };
  }

  const currentStatus = String((schedule as any).status ?? "");
  if (currentStatus === "executando") {
    return { ok: false, error: "Esse agendamento está sendo processado no momento." };
  }

  const nextIso = nextMonthlyIso({
    fromUtcIso: String((schedule as any).data_envio),
    timeZone: String((schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo",
    day: Number((schedule as any).recurrence_day ?? 1),
    time: String((schedule as any).recurrence_time ?? "") || "00:00",
  });

  const { error: runError } = await admin.from("schedule_runs").insert({
    user_id: userId,
    schedule_id: String((schedule as any).id),
    scheduled_for: String((schedule as any).data_envio),
    executed_at: new Date().toISOString(),
    status: "executado",
  });
  if (runError) return { ok: false, error: runError.message };

  const shouldContinue = shouldContinueMonthlyRecurrence({
    nextUtcIso: nextIso,
    recurrenceUntil: String((schedule as any).recurrence_until ?? "") || null,
    timeZone: String((schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo",
  });

  const { error: updateError } = await admin
    .from("schedules")
    .update(shouldContinue ? { status: "agendado", data_envio: nextIso } : { status: "executado" })
    .eq("id", String((schedule as any).id));
  if (updateError) return { ok: false, error: updateError.message };

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "agenda_pagamento_manual",
    descricao: `Pagamento marcado manualmente como realizado para o agendamento ${String((schedule as any).id)}`,
  });

  return { ok: true };
}
