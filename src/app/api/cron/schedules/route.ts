import fs from "node:fs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  hasAutoCloseExpired,
  isPastLocalDay,
  nextRetryUtcIso,
  nextSameDayRetryUtcIso,
  normalizeRetryConfig,
  shiftFirstChargeFromWeekendUtcIso,
} from "@/lib/chargeRetry";
import { getScheduleChargeAmount } from "@/lib/chargeAccumulation";
import { syncDebtorChargeStatus } from "@/lib/debtorChargeStatus";
import { buildPixCopyLink } from "@/lib/pix-links";
import { localDateInTimeZone } from "@/lib/recurrence";

const OFFPEAK_MAX_ZAPI_SENDS_PER_RUN = 5;
const PEAK_MAX_ZAPI_SENDS_PER_RUN = 2;
const OFFPEAK_ZAPI_SEND_INTERVAL_MS = 10_000;
const PEAK_ZAPI_SEND_INTERVAL_MS = 20_000;
const OFFPEAK_BATCH_DEFER_MINUTES = 8;
const PEAK_BATCH_DEFER_MINUTES = 20;
const OFFPEAK_FAILED_RETRY_MINUTES = 10;
const PEAK_FAILED_RETRY_MINUTES = 30;
const PEAK_HOURS_START_MINUTES = 8 * 60;
const PEAK_HOURS_END_MINUTES = 20 * 60;

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
  const raw = String(phone ?? "").trim();
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (raw.startsWith("+")) return d;
  if (d.startsWith("55")) return d;
  if (d.startsWith("1") && d.length === 11) return d;
  if (d.length === 11) return `55${d}`;
  return d;
}

function normalizePhoneDigitsOnly(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function areBrazilianPhonesEquivalent(aRaw: string | null | undefined, bRaw: string | null | undefined): boolean {
  const a = normalizePhoneDigitsOnly(aRaw);
  const b = normalizePhoneDigitsOnly(bRaw);
  if (!a || !b) return false;
  if (a === b) return true;
  function toComparableBr(digits: string): string | null {
    if (!digits) return null;
    if (digits.length <= 11 && digits.length >= 10) {
      return digits.replace(/^9(\d{10})$/, "$1").replace(/^9(\d{9})$/, "$1");
    }
    if (digits.length === 12 && digits.startsWith("55")) {
      const local = digits.slice(2);
      return local.replace(/^9(\d{10})$/, "$1").replace(/^9(\d{9})$/, "$1");
    }
    if (digits.length === 13 && digits.startsWith("55")) {
      const local = digits.slice(2);
      return local.replace(/^9(\d{10})$/, "$1").replace(/^9(\d{9})$/, "$1");
    }
    return digits.replace(/^9/, "");
  }
  const aComp = toComparableBr(a);
  const bComp = toComparableBr(b);
  if (!aComp || !bComp) return false;
  if (aComp === bComp) return true;
  const aStripped55 = aComp.startsWith("55") ? aComp.slice(2) : aComp;
  const bStripped55 = bComp.startsWith("55") ? bComp.slice(2) : bComp;
  if (aStripped55 === bStripped55) return true;
  const aNo9 = aStripped55.length === 11 && aStripped55.startsWith("9") ? aStripped55.slice(1) : aStripped55;
  const bNo9 = bStripped55.length === 11 && bStripped55.startsWith("9") ? bStripped55.slice(1) : bStripped55;
  if (aNo9 === bNo9) return true;
  return false;
}

async function loadAllInstancePhoneBlocklist(): Promise<Set<string>> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("whatsapp_instances").select("phone").limit(50);
    const set = new Set<string>();
    for (const row of data ?? []) {
      const p = normalizePhoneDigitsOnly(String((row as any)?.phone ?? ""));
      if (p) set.add(p);
    }
    const envPhones = [
      process.env.ZAPI_INSTANCE_PHONE,
      process.env.ZAPI_INSTANCE_PHONE_FALLBACK,
      process.env.ATENDIMENTO_WHATSAPP_PHONE,
      process.env.WHATSAPP_INSTANCE_PHONE,
      process.env.TEACHER_NOTIFICATION_PHONE,
      process.env.PROFESSOR_WHATSAPP_PHONE,
      "556581175345",
      "556598079407",
    ];
    for (const p of envPhones) {
      const norm = normalizePhoneDigitsOnly(p);
      if (norm) set.add(norm);
    }
    return set;
  } catch (_e) {
    return new Set();
  }
}

function destinationIsInstancePhone(destination: string | null | undefined, blocklistDigitsOnly: Iterable<string> | null, selfPhoneDigitsOnly: string | null | undefined): boolean {
  const dest = normalizePhoneDigitsOnly(destination);
  if (!dest) return false;
  if (selfPhoneDigitsOnly && areBrazilianPhonesEquivalent(dest, selfPhoneDigitsOnly)) return true;
  if (blocklistDigitsOnly) {
    for (const instancePhone of blocklistDigitsOnly) {
      if (!instancePhone) continue;
      if (areBrazilianPhonesEquivalent(dest, instancePhone)) return true;
    }
  }
  return false;
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

function diffDaysLocalDate(fromDate: string, toDate: string) {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd, 12, 0, 0);
  const to = Date.UTC(ty, tm - 1, td, 12, 0, 0);
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function weekdayFromLocalDate(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = base.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function localMinutesInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const hours = Number(map.hour ?? 0);
  const minutes = Number(map.minute ?? 0);
  return hours * 60 + minutes;
}

function isPeakHourInTimeZone(value: string, timeZone: string) {
  const minutes = localMinutesInTimeZone(value, timeZone);
  return minutes >= PEAK_HOURS_START_MINUTES && minutes < PEAK_HOURS_END_MINUTES;
}

function buildDeferredBatchUtcIso(nowIso: string, index: number, isPeakHour: boolean) {
  const stepMinutes = isPeakHour ? PEAK_BATCH_DEFER_MINUTES : OFFPEAK_BATCH_DEFER_MINUTES;
  return new Date(Date.parse(nowIso) + Math.max(1, index + 1) * stepMinutes * 60_000).toISOString();
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function countExecutedRunsOnLocalDate(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  scheduleId: string;
  timeZone: string;
  localDate: string;
}) {
  const { data } = await params.supabase
    .from("schedule_runs")
    .select("executed_at")
    .eq("schedule_id", params.scheduleId)
    .eq("status", "executado")
    .order("executed_at", { ascending: false })
    .limit(50);

  return (data ?? []).filter((run: any) => {
    const executedAt = String(run?.executed_at ?? "");
    return executedAt && localDateInTimeZone(executedAt, params.timeZone) === params.localDate;
  }).length;
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
  self_instance_phone_digits_only?: string | null;
}) {
  const normalizedPhone = normalizePhone(params.phone);

  const selfPhoneOpt = params.self_instance_phone_digits_only ?? null;
  if (destinationIsInstancePhone(normalizedPhone, null, selfPhoneOpt)) {
    return {
      ok: false,
      skipped: true,
      reason: "self_instance_phone_refused_to_prevent_infinite_loop_at_low_level_cron_sendZapiText",
      phone: normalizePhoneDigitsOnly(normalizedPhone),
    } as any;
  }
  const runtimeBlocklist = await loadAllInstancePhoneBlocklist();
  if (destinationIsInstancePhone(normalizedPhone, runtimeBlocklist, selfPhoneOpt)) {
    return {
      ok: false,
      skipped: true,
      reason: "self_instance_phone_refused_blocklist_matched_whatsapp_instances_cron",
      phone: normalizePhoneDigitsOnly(normalizedPhone),
    } as any;
  }

  const body = JSON.stringify({ phone: normalizedPhone, message: params.message });
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
      "id, user_id, debtor_id, data_envio, charge_due_at, last_sent_at, first_sent_at, retry_attempts, status, schedule_timezone, debtors(skip_weekends_on_first_charge, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days)",
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
    if (!referenceUtcIso) continue;
    if (!isPastLocalDay({ referenceUtcIso, nowUtcIso: nowIso, timeZone })) continue;

    const debtor = (item as any).debtors ?? {};
    const retryConfig = normalizeRetryConfig(debtor);
    const effectiveRetryWeekdays = Boolean(debtor?.skip_weekends_on_first_charge)
      ? retryConfig.weekdays.filter((weekday) => weekday >= 1 && weekday <= 5)
      : retryConfig.weekdays;
    const shouldClose =
      hasAutoCloseExpired({
        firstSentAt: String((item as any).first_sent_at ?? "") || referenceUtcIso,
        nowUtcIso: nowIso,
        timeZone,
        autoCloseDays: retryConfig.autoCloseDays,
      });
    const nextRetryAt = effectiveRetryWeekdays.length
      ? nextRetryUtcIso({
          fromUtcIso: referenceUtcIso,
          timeZone,
          weekdays: effectiveRetryWeekdays,
          time: retryConfig.time,
          intervalDays: retryConfig.intervalDays,
        })
      : null;

    const updatePayload = shouldClose
      ? { status: "atrasado", closed_at: nowIso }
      : nextRetryAt
        ? {
            status: "atrasado",
            data_envio: nextRetryAt,
          }
        : {
            status: "atrasado",
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
      "id, user_id, debtor_id, charge_id, template_id, template_pending_id, template_overdue_id, data_envio, charge_due_at, status, recurrence, schedule_timezone, recurrence_day, recurrence_time, recurrence_until, first_sent_at, last_sent_at, retry_attempts, debtors(nome, telefone, pix_key, valor, vencimento, accumulate_open_monthly_charges, skip_weekends_on_first_charge, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days), charge:debtor_charges!schedules_charge_id_fkey(amount, due_day), pending_template:message_templates!schedules_template_pending_id_fkey(conteudo), overdue_template:message_templates!schedules_template_overdue_id_fkey(conteudo)",
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
  let zapiSendAttempts = 0;
  let deferredBatchCount = 0;

  for (const s of schedules ?? []) {
    const scheduleId = String((s as any).id);
    const userId = String((s as any).user_id);
    const scheduledFor = String((s as any).data_envio ?? nowIso);
    let attemptedZapiSend = false;
    let sendIntervalMs = OFFPEAK_ZAPI_SEND_INTERVAL_MS;

    try {
      const debtor = (s as any).debtors ?? null;
      const pendingTemplate = (s as any).pending_template ?? null;
      const overdueTemplate = (s as any).overdue_template ?? null;
      const sourceStatus = String((s as any).status ?? "") === "atrasado" ? "atrasado" : "pendente";
      const timeZone = String((s as any).schedule_timezone ?? "") || "America/Sao_Paulo";
      const isPeakHour = isPeakHourInTimeZone(nowIso, timeZone);
      const maxSendsThisRun = isPeakHour ? PEAK_MAX_ZAPI_SENDS_PER_RUN : OFFPEAK_MAX_ZAPI_SENDS_PER_RUN;
      const retryConfig = normalizeRetryConfig(debtor ?? {});
      const effectiveRetryWeekdays = Boolean(debtor?.skip_weekends_on_first_charge)
        ? retryConfig.weekdays.filter((weekday) => weekday >= 1 && weekday <= 5)
        : retryConfig.weekdays;
      if (sourceStatus === "atrasado" && effectiveRetryWeekdays.length === 0) {
        results.push({ id: scheduleId, ok: true });
        continue;
      }
      if (sourceStatus === "atrasado") {
        const nowLocalDate = localDateInTimeZone(nowIso, timeZone);
        const nowLocalWeekday = weekdayFromLocalDate(nowLocalDate);
        if (!effectiveRetryWeekdays.includes(nowLocalWeekday)) {
          const nextRetryAt = nextRetryUtcIso({
            fromUtcIso: nowIso,
            timeZone,
            weekdays: effectiveRetryWeekdays,
            time: retryConfig.time,
            intervalDays: retryConfig.intervalDays,
          });
          await supabase
            .from("schedules")
            .update(nextRetryAt ? { status: "atrasado", data_envio: nextRetryAt } : { status: "atrasado" })
            .eq("id", scheduleId);
          await syncDebtorChargeStatus(supabase, userId, String((s as any).debtor_id ?? ""));
          results.push({ id: scheduleId, ok: true });
          continue;
        }
      }
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
        baseAmount: (s as any).charge?.amount ?? debtor?.valor,
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
      if (!templateText.trim()) {
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
        .eq("data_envio", scheduledFor)
        .in("status", ["agendado", "atrasado", "pausado"])
        .is("closed_at", null)
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
        .select("instance_id, token, client_token, status, phone")
        .eq("user_id", userId)
        .maybeSingle();

      if (waErr) throw new Error(waErr.message);
      if (!wa?.instance_id || !wa?.token) throw new Error("WhatsApp não configurado");
      if ((wa.status ?? "").toLowerCase() !== "configured" && (wa.status ?? "").toLowerCase() !== "connected") {
        throw new Error("WhatsApp desconectado");
      }

      const debtorPhoneDigitsOnly = String(debtorPhone ?? "").replace(/\D/g, "");
      const instancePhoneDigitsOnly = String((wa as any)?.phone ?? "").replace(/\D/g, "");
      if (instancePhoneDigitsOnly && debtorPhoneDigitsOnly && debtorPhoneDigitsOnly === instancePhoneDigitsOnly) {
        throw new Error("Auto-envio para próprio chip conectado bloqueado.");
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

      if (zapiSendAttempts >= maxSendsThisRun) {
        const deferredTo = buildDeferredBatchUtcIso(nowIso, deferredBatchCount, isPeakHour);
        deferredBatchCount += 1;
        await supabase
          .from("schedules")
          .update({
            status: String((s as any).status ?? "") === "atrasado" ? "atrasado" : "agendado",
            data_envio: deferredTo,
          })
          .eq("id", scheduleId);
        results.push({ id: scheduleId, ok: true, error: "deferred_to_next_batch" });
        continue;
      }

      const pixLink = await buildPixCopyLink({
        pixKey: String(debtor?.pix_key ?? ""),
        debtorName: String(debtor?.nome ?? ""),
        amount: formatBRL(chargeAmount ?? (s as any).charge?.amount ?? debtor?.valor),
        userId,
        debtorId: String((s as any).debtor_id ?? ""),
        scheduleId,
      });

      const message = applyTemplate(templateText, {
        nome: String(debtor?.nome ?? ""),
        pix: String(debtor?.pix_key ?? ""),
        pix_link: pixLink,
        valor: formatBRL(chargeAmount ?? (s as any).charge?.amount ?? debtor?.valor),
        vencimento: formatDateBR(
          localDateInTimeZone(
            String((s as any).charge_due_at ?? (s as any).data_envio ?? nowIso),
            timeZone,
          ),
        ),
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
      attemptedZapiSend = true;
      sendIntervalMs = isPeakHour ? PEAK_ZAPI_SEND_INTERVAL_MS : OFFPEAK_ZAPI_SEND_INTERVAL_MS;
      zapiSendAttempts += 1;
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

      const nowLocalDate = localDateInTimeZone(nowIso, timeZone);
      const sentToday =
        sourceStatus === "atrasado"
          ? await countExecutedRunsOnLocalDate({
              supabase,
              scheduleId,
              timeZone,
              localDate: nowLocalDate,
            })
          : 0;
      const nextSameDayRetryAt =
        sourceStatus === "atrasado"
          ? nextSameDayRetryUtcIso({
              nowUtcIso: nowIso,
              localDate: nowLocalDate,
              timeZone,
              time: retryConfig.time,
              dailySendLimit: isPeakHour ? Math.min(retryConfig.maxAttempts, 1) : retryConfig.maxAttempts,
              sentToday,
            })
          : null;

      const { error: updateError } = await supabase
        .from("schedules")
        .update({
          status: nextSameDayRetryAt ? "atrasado" : "pendente",
          first_sent_at: String((s as any).first_sent_at ?? "") || nowIso,
          last_sent_at: nowIso,
          retry_attempts: Number((s as any).retry_attempts ?? 0) + 1,
          ...(nextSameDayRetryAt ? { data_envio: nextSameDayRetryAt } : {}),
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
        const retryDelayMinutes = isPeakHourInTimeZone(nowIso, String((s as any)?.schedule_timezone ?? "") || "America/Sao_Paulo")
          ? PEAK_FAILED_RETRY_MINUTES
          : OFFPEAK_FAILED_RETRY_MINUTES;
        const retryAt = new Date(Date.now() + retryDelayMinutes * 60_000).toISOString();
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
    } finally {
      if (attemptedZapiSend) {
        await sleep(sendIntervalMs);
      }
    }
  }

  return Response.json({
    ok: true,
    now: nowIso,
    found: schedules?.length ?? 0,
    throttled_attempts: zapiSendAttempts,
    results,
    deployment,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
