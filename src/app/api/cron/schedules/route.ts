import fs from "node:fs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  hasAutoCloseExpired,
  isPastLocalDay,
  nextRetryUtcIso,
  normalizeRetryConfig,
  shiftFirstChargeFromWeekendUtcIso,
} from "@/lib/chargeRetry";
import { getScheduleChargeAmount } from "@/lib/chargeAccumulation";
import { syncDebtorChargeStatus } from "@/lib/debtorChargeStatus";

// #region debug-point extra-send-cron-bootstrap
const __dbgEnvPath = ".dbg/extra-scheduled-send.env";
const __dbgEnvRaw = fs.existsSync(__dbgEnvPath) ? fs.readFileSync(__dbgEnvPath, "utf8") : "";
const __dbgMap = Object.fromEntries(
  __dbgEnvRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("=");
      return idx >= 0 ? [line.slice(0, idx), line.slice(idx + 1)] : [line, ""];
    }),
);
const __dbgUrl = __dbgMap.DEBUG_SERVER_URL;
const __dbgSession = __dbgMap.DEBUG_SESSION_ID;
const __dbgTraceId = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const __dbg = (hypothesisId: string, msg: string, data: Record<string, unknown>) => {
  if (!__dbgUrl || !__dbgSession) return;
  fetch(__dbgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: __dbgSession,
      runId: "pre",
      hypothesisId,
      traceId: __dbgTraceId,
      location: "api/cron/schedules",
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

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

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  const q = url.searchParams.get("secret");
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  return q === secret || bearer === secret;
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
        ...(includeHeaderToken && params.client_token
          ? { "Client-Token": params.client_token }
          : {}),
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

export async function GET(req: Request) {
  const deployment = {
    env: process.env.VERCEL_ENV ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
  };

  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: "unauthorized", deployment }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  // #region debug-point extra-send-cron-entry
  __dbg("A", "cron-entry", {
    nowIso,
    method: req.method,
    deployment,
    authHeader: req.headers.get("authorization") ? "present" : "absent",
  });
  // #endregion

  const { data: pendingSchedules, error: pendingError } = await supabase
    .from("schedules")
    .select(
      "id, user_id, debtor_id, data_envio, charge_due_at, last_sent_at, first_sent_at, retry_attempts, status, schedule_timezone, debtors(retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days)",
    )
    .eq("status", "pendente")
    .is("closed_at", null)
    .limit(200);

  if (pendingError) {
    return Response.json({ ok: false, error: pendingError.message, deployment }, { status: 500 });
  }

  for (const item of pendingSchedules ?? []) {
    const timeZone = String((item as any).schedule_timezone ?? "") || "America/Sao_Paulo";
    const referenceUtcIso =
      String((item as any).last_sent_at ?? "") ||
      String((item as any).first_sent_at ?? "") ||
      String((item as any).charge_due_at ?? "") ||
      String((item as any).data_envio ?? nowIso);
    if (!referenceUtcIso || !isPastLocalDay({ referenceUtcIso, nowUtcIso: nowIso, timeZone })) continue;

    const retryConfig = normalizeRetryConfig((item as any).debtors ?? {});
    const retryAttempts = Number((item as any).retry_attempts ?? 0);
    const shouldClose =
      retryAttempts >= retryConfig.maxAttempts ||
      hasAutoCloseExpired({
        firstSentAt: String((item as any).first_sent_at ?? "") || referenceUtcIso,
        nowUtcIso: nowIso,
        timeZone,
        autoCloseDays: retryConfig.autoCloseDays,
      });

    const updatePayload = shouldClose
      ? { status: "atrasado", closed_at: nowIso }
      : {
          status: "atrasado",
          data_envio: nextRetryUtcIso({
            fromUtcIso: referenceUtcIso,
            timeZone,
            weekdays: retryConfig.weekdays,
            time: retryConfig.time,
            intervalDays: retryConfig.intervalDays,
          }),
        };

    await supabase.from("schedules").update(updatePayload).eq("id", String((item as any).id));
    await syncDebtorChargeStatus(
      supabase,
      String((item as any).user_id ?? ""),
      String((item as any).debtor_id ?? ""),
    );
  }

  const { data: schedules, error } = await supabase
    .from("schedules")
    .select(
      "id, user_id, debtor_id, template_id, template_pending_id, template_overdue_id, data_envio, charge_due_at, status, recurrence, schedule_timezone, recurrence_day, recurrence_time, recurrence_until, first_sent_at, last_sent_at, retry_attempts, debtors(nome, telefone, pix_key, valor, vencimento, accumulate_open_monthly_charges, skip_weekends_on_first_charge, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days), pending_template:message_templates!schedules_template_pending_id_fkey(conteudo), overdue_template:message_templates!schedules_template_overdue_id_fkey(conteudo)",
    )
    .in("status", ["agendado", "atrasado", "pausado"])
    .is("closed_at", null)
    .lte("data_envio", nowIso)
    .order("data_envio", { ascending: true })
    .limit(100);

  if (error) {
    // #region debug-point extra-send-cron-query-error
    __dbg("E", "cron-query-error", { nowIso, error: error.message });
    // #endregion
    return Response.json({ ok: false, error: error.message, deployment }, { status: 500 });
  }

  // #region debug-point extra-send-cron-query
  __dbg("E", "cron-query-result", {
    nowIso,
    found: schedules?.length ?? 0,
    schedules: (schedules ?? []).map((item: any) => ({
      id: String(item?.id ?? ""),
      user_id: String(item?.user_id ?? ""),
      debtor_id: String(item?.debtor_id ?? ""),
      status: String(item?.status ?? ""),
      recurrence: String(item?.recurrence ?? ""),
      data_envio: String(item?.data_envio ?? ""),
      recurrence_until: String(item?.recurrence_until ?? ""),
    })),
  });
  // #endregion

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const s of schedules ?? []) {
    const scheduleId = String((s as any).id);
    const userId = String((s as any).user_id);
    const scheduledFor = String((s as any).data_envio ?? nowIso);

    try {
      const debtor = (s as any).debtors ?? null;
      const pendingTemplate = (s as any).pending_template ?? null;
      const overdueTemplate = (s as any).overdue_template ?? null;
      const sourceStatus = String((s as any).status ?? "") === "atrasado" ? "atrasado" : "pendente";
      const timeZone = String((s as any).schedule_timezone ?? "") || "America/Sao_Paulo";
      const isFirstCharge = !String((s as any).first_sent_at ?? "");
      const shiftedFirstChargeUtcIso = shiftFirstChargeFromWeekendUtcIso({
        utcIso: scheduledFor,
        timeZone,
        enabled: String((s as any).status ?? "") === "agendado" && isFirstCharge && Boolean(debtor?.skip_weekends_on_first_charge),
      });

      if (shiftedFirstChargeUtcIso !== scheduledFor) {
        await supabase
          .from("schedules")
          .update({
            data_envio: shiftedFirstChargeUtcIso,
            charge_due_at: shiftedFirstChargeUtcIso,
          })
          .eq("id", scheduleId);
        results.push({ id: scheduleId, ok: true });
        continue;
      }

      // #region debug-point extra-send-cron-item
      __dbg("B", "cron-item-processing", {
        scheduleId,
        userId,
        scheduledFor,
        currentStatus: String((s as any).status ?? ""),
        recurrence: String((s as any).recurrence ?? ""),
        debtorId: String((s as any).debtor_id ?? ""),
        debtorPhone: String(debtor?.telefone ?? ""),
      });
      // #endregion

      const debtorPhone = String(debtor?.telefone ?? "");
      const chargeAmount = getScheduleChargeAmount({
        baseAmount: debtor?.valor,
        accumulateOpenMonthlyCharges: Boolean(debtor?.accumulate_open_monthly_charges),
        recurrence: String((s as any).recurrence ?? ""),
        status: String((s as any).status ?? ""),
        chargeDueAt: String((s as any).charge_due_at ?? "") || null,
        dataEnvio: String((s as any).data_envio ?? "") || null,
        nowUtcIso: nowIso,
        timeZone: String((s as any).schedule_timezone ?? "") || "America/Sao_Paulo",
      });
      const templateText = String(
        sourceStatus === "atrasado" ? overdueTemplate?.conteudo ?? "" : pendingTemplate?.conteudo ?? "",
      );

      if (!debtorPhone) throw new Error("Cliente sem telefone");
      if (!templateText) {
        throw new Error(
          sourceStatus === "atrasado"
            ? "Template atrasado sem conteúdo."
            : "Template pendente sem conteúdo.",
        );
      }

      const { data: locked, error: lockErr } = await supabase
        .from("schedules")
        .update({ status: "executando" })
        .eq("id", scheduleId)
        .in("status", ["agendado", "atrasado", "pausado"])
        .select("id")
        .maybeSingle();

      if (lockErr) throw new Error(lockErr.message);
      if (!locked?.id) {
        // #region debug-point extra-send-cron-lock-skip
        __dbg("D", "cron-lock-skip", { scheduleId, scheduledFor });
        // #endregion
        results.push({ id: scheduleId, ok: true });
        continue;
      }

      const { data: wa, error: waErr } = await supabase
        .from("whatsapp_instances")
        .select("instance_id, token, client_token, status")
        .eq("user_id", userId)
        .maybeSingle();

      if (waErr) throw new Error(waErr.message);
      if (!wa?.instance_id || !wa?.token) throw new Error("WhatsApp não configurado");
      if ((wa.status ?? "").toLowerCase() !== "configured" && (wa.status ?? "").toLowerCase() !== "connected") {
        throw new Error("WhatsApp desconectado");
      }

      const { data: existingRun } = await supabase
        .from("schedule_runs")
        .select("id, status")
        .eq("schedule_id", scheduleId)
        .eq("scheduled_for", scheduledFor)
        .eq("status", "executado")
        .maybeSingle();

      if (existingRun?.id) {
        // #region debug-point extra-send-cron-existing-run
        __dbg("D", "cron-existing-run-skip-send", {
          scheduleId,
          scheduledFor,
          existingRunId: String(existingRun.id),
          nextStatus: "pendente",
        });
        // #endregion
        await supabase
          .from("schedules")
          .update({
            status: "pendente",
            first_sent_at: String((s as any).first_sent_at ?? "") || nowIso,
            last_sent_at: nowIso,
          })
          .eq("id", scheduleId);
        await syncDebtorChargeStatus(supabase, userId, String((s as any).debtor_id ?? ""));
        results.push({ id: scheduleId, ok: true });
        continue;
      }

      const message = applyTemplate(templateText, {
        nome: String(debtor?.nome ?? ""),
        pix: String(debtor?.pix_key ?? ""),
        valor: formatBRL(chargeAmount ?? debtor?.valor),
        vencimento: formatDateBR(debtor?.vencimento),
      });

      let messageSent = false;
      // #region debug-point extra-send-cron-before-send
      __dbg("A", "cron-before-send", {
        scheduleId,
        userId,
        scheduledFor,
        debtorPhone,
        normalizedPhone: normalizePhone(debtorPhone),
        messagePreview: message.slice(0, 120),
        nextStatus: "pendente",
        templateSource: sourceStatus,
      });
      // #endregion
      await sendZapiText({
        instance_id: wa.instance_id,
        token: wa.token,
        client_token: wa.client_token,
        phone: debtorPhone,
        message,
      });
      messageSent = true;

      const { error: runError } = await supabase.from("schedule_runs").insert({
        user_id: userId,
        schedule_id: scheduleId,
        scheduled_for: scheduledFor,
        executed_at: nowIso,
        status: "executado",
      });
      if (runError) throw new Error(runError.message);

      const { error: updateError } = await supabase
        .from("schedules")
        .update({
          status: "pendente",
          first_sent_at: String((s as any).first_sent_at ?? "") || nowIso,
          last_sent_at: nowIso,
          retry_attempts: Number((s as any).retry_attempts ?? 0) + 1,
        })
        .eq("id", scheduleId);
      if (updateError) throw new Error(updateError.message);
      await syncDebtorChargeStatus(supabase, userId, String((s as any).debtor_id ?? ""));

      // #region debug-point extra-send-cron-success
      __dbg("C", "cron-send-success", {
        scheduleId,
        scheduledFor,
        nextStatus: "pendente",
        messageSent,
      });
      // #endregion

      await supabase.from("logs").insert({
        user_id: userId,
        tipo: "agenda_executada",
        descricao: `Agendamento executado: ${scheduleId}`,
      });

      results.push({ id: scheduleId, ok: true });
    } catch (e: any) {
      const msg = String(e?.message ?? "Erro desconhecido");
      const scheduledFor = String((s as any)?.data_envio ?? nowIso);
      const wasExecuted = await supabase
        .from("schedule_runs")
        .select("id")
        .eq("schedule_id", scheduleId)
        .eq("scheduled_for", scheduledFor)
        .eq("status", "executado")
        .maybeSingle();
      if (!wasExecuted.data?.id) {
        await supabase.from("schedule_runs").insert({
          user_id: userId,
          schedule_id: scheduleId,
          scheduled_for: scheduledFor,
          executed_at: nowIso,
          status: "falha",
          error: msg,
        });
      }
      await supabase.from("logs").insert({
        user_id: userId,
        tipo: "agenda_falha",
        descricao: `Falha ao executar agendamento ${scheduleId}: ${msg}`,
      });
      if (!wasExecuted.data?.id) {
        const retryAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
        await supabase
          .from("schedules")
          .update({ status: String((s as any)?.status ?? "") === "atrasado" ? "atrasado" : "agendado", data_envio: retryAt })
          .eq("id", scheduleId);
        // #region debug-point extra-send-cron-retry
        __dbg("D", "cron-retry-scheduled", {
          scheduleId,
          scheduledFor,
          retryAt,
          error: msg,
        });
        // #endregion
      }
      // #region debug-point extra-send-cron-error
      __dbg("C", "cron-send-error", {
        scheduleId,
        scheduledFor,
        error: msg,
        currentStatus: String((s as any)?.status ?? ""),
        wasExecuted: Boolean(wasExecuted.data?.id),
      });
      // #endregion
      results.push({ id: scheduleId, ok: false, error: msg });
    }
  }

  return Response.json({
    ok: true,
    now: nowIso,
    found: schedules?.length ?? 0,
    results,
    deployment,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
