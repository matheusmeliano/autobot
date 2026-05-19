"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BRAZIL_TIMEZONES, zonedDateTimeToUtcIso } from "@/lib/timezone";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
      "id, user_id, debtor_id, template_id, data_envio, status, debtors(nome, telefone, pix_key), message_templates(conteudo)",
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

    await admin.from("schedules").update({ status: "executado" }).eq("id", String((schedule as any).id));
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message ?? "Erro desconhecido");
    await admin.from("logs").insert({
      user_id: userId,
      tipo: "agenda_falha",
      descricao: `Falha ao executar agendamento ${String((schedule as any).id)}: ${msg}`,
    });
    await admin.from("schedules").update({ status: "agendado" }).eq("id", String((schedule as any).id));
    return { ok: false, error: msg };
  }
}
