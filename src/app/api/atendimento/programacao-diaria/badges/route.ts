import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import {
  EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST,
} from "@/lib/atendimento/experimentalClass";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
// ====================================================================
// LÓGICA SINCRONIZADA — TUDO que define "quando uma aula existe no dia X"
// está na lib calendarSync. NÃO DUPLIQUE regras aqui.
// ====================================================================
import {
  VALID_EXPERIMENTAL_COMPOSITE_STATUS,
  VALID_EXPERIMENTAL_FLAT_STATUS,
  VALID_RECURRING_CLASS_STATUS,
  VALID_RECURRING_FUNNEL_STAGE_FALLBACK,
  detectTeacherKey,
  experimentalHasTime,
  flatExpDedupId,
  recurringFirstLocalDate,
  recurringHasTime,
  weekdayFromLabel,
  weekdayShortIso,
} from "@/lib/atendimento/calendarSync";
import { addDays, format, isBefore, isSameDay, parseISO } from "date-fns";
import { localDateInTimeZone } from "@/lib/recurrence";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const nowUtc = new Date().toISOString();
  const todayIso = localDateInTimeZone(nowUtc, ATENDIMENTO_PROFESSOR_TIME_ZONE);

  const fromQ = String(url.searchParams.get("from") ?? "").trim().slice(0, 10);
  const toQ = String(url.searchParams.get("to") ?? "").trim().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromQ) ? fromQ : format(addDays(parseISO(todayIso), -30), "yyyy-MM-dd");
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toQ) ? toQ : format(addDays(parseISO(todayIso), 90), "yyyy-MM-dd");

  const fromDt = parseISO(from);
  const toDt = parseISO(to);
  if (!isBefore(fromDt, toDt) && !isSameDay(fromDt, toDt)) {
    return Response.json({ ok: false, error: "bad_range" }, { status: 400 });
  }

  // ===== Construir lista de dias do período =====
  const dayList: string[] = [];
  let cur = fromDt;
  while (isBefore(cur, toDt) || isSameDay(cur, toDt)) {
    dayList.push(format(cur, "yyyy-MM-dd"));
    cur = addDays(cur, 1);
  }

  // badgeMap: date → { LB, NC, PN } (boolean)
  const badgeMap: Record<string, { LB: boolean; NC: boolean; PN: boolean }> = {};
  for (const d of dayList) {
    badgeMap[d] = { LB: false, NC: false, PN: false };
  }

  const isSunday = (localDateYYYYMMDD: string): boolean => weekdayShortIso(localDateYYYYMMDD) === "sun";

  // ================================================================================
  // REST FETCH DIRETO (MESMO MÉTODO DO /programacao-diaria — NÃO USA SDK ADMIN.FROM).
  // SDK admin.from() estava retornando NULL silenciosamente no try/catch, flat e
  // recorrentes não carregavam → badges mostrava 2, modal mostrava 3.
  // ================================================================================
  const SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "https://wancechxapezliwiwlke.supabase.co").replace(/\/$/, "");
  const SUPABASE_SERVICE_ROLE_KEY =
    String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhbmNlY2h4YXBlemxpd2l3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY2OTY5MCwiZXhwIjoyMDkxMjQ1NjkwfQ.8kQv54DQOQscolOiS5NW_XYXzjPYjut3pCj5uLPbYWw").trim();
  const restHeaders: Record<string, string> = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  const admin = createSupabaseAdminClient();

  // =============== 1) EXPERIMENTAIS COMPOSITE (tabela atendimento_experimental_class_bookings) ===============
  // Obs: continuamos SDK aqui (por enquanto, gte/lte date range funciona), mas AGORA select INCLUI
  // professor_time e lead_time — antes faltavam! experimentalHasTime sempre retornava false.
  const compositeBookings: Array<Record<string, unknown>> = [];
  try {
    const baseSelect =
      "id,lead_id,status,professor_date,professor_time,lead_time,assigned_professor_name,assigned_professor_phone";
    const { data, error } = await admin
      .from("atendimento_experimental_class_bookings")
      .select(baseSelect)
      .gte("professor_date", from)
      .lte("professor_date", to);
    if (data && !error) {
      const seenComposite = new Set<string>();
      for (const b of data as Array<Record<string, unknown>>) {
        const d = String(b?.professor_date ?? "").trim().slice(0, 10);
        if (!d || !badgeMap[d]) continue;
        if (isSunday(d)) continue;
        const st = String(b?.status ?? "").toLowerCase();
        if (!VALID_EXPERIMENTAL_COMPOSITE_STATUS.has(st)) continue;
        // ---- HORÁRIO OBRIGATÓRIO COMPOSITE ----
        // AGORA TEMOS professor_time/lead_time no select.
        if (
          !experimentalHasTime(
            String((b as any).professor_time ?? ""),
            String((b as any).lead_time ?? ""),
          )
        )
          continue;
        const id = String((b as any).id ?? "").trim();
        if (id && seenComposite.has(id)) continue;
        if (id) seenComposite.add(id);
        compositeBookings.push(b);
        const pName = String((b as any).assigned_professor_name ?? "");
        const pPhone = String((b as any).assigned_professor_phone ?? "");
        const hasProf = Boolean(pName.trim() || pPhone.trim());
        const key = detectTeacherKey(pName, pPhone, !hasProf);
        (badgeMap[d] as any)[key] = true;
      }
    }
  } catch {}

  // =============== 1.5) EXPERIMENTAIS FLAT (colunas flat EM ATENDIMENTO_LEADS: experimental_class_*) ===============
  // 🔴 TROCADO SDK admin.from() → FETCH REST DIRETO (igual MODAL).
  try {
    const selFlat = [
      "id",
      "experimental_class_status",
      "experimental_class_professor_date",
      "experimental_class_professor_time",
      "experimental_class_professor_name",
      "experimental_class_professor_phone",
      "experimental_class_lead_date",
      "experimental_class_lead_time",
      "experimental_class_booking_id",
      "funnel_stage",
    ].join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/atendimento_leads?or=(experimental_class_professor_date.not.is.null,experimental_class_status.not.is.null,experimental_class_professor_name.not.is.null,experimental_class_lead_date.not.is.null)&select=${selFlat}&limit=5000`,
      { method: "GET", headers: restHeaders, cache: "no-store" },
    );
    if (res.ok) {
      const data = (await res.json()) as Array<Record<string, unknown>> | null;
      if (Array.isArray(data) && data.length > 0) {
        const alreadySeenBookingIdsPeriodo = new Set<string>(
          compositeBookings.map((bk) => String((bk as any).id ?? "").trim()).filter(Boolean),
        );
        for (const r of data) {
          const stExpFlat = String((r as any).experimental_class_status ?? "").trim().toLowerCase();
          const stFunnel = String((r as any).funnel_stage ?? "").trim().toLowerCase();
          let ok = false;
          if (stExpFlat && VALID_EXPERIMENTAL_FLAT_STATUS.has(stExpFlat)) ok = true;
          else if (!stExpFlat && VALID_RECURRING_FUNNEL_STAGE_FALLBACK.has(stFunnel)) ok = true;
          if (!ok) continue;
          const pDate = String((r as any).experimental_class_professor_date ?? "").trim().slice(0, 10);
          const lDate = String((r as any).experimental_class_lead_date ?? "").trim().slice(0, 10);
          const d = pDate || lDate;
          if (!d || !badgeMap[d]) continue;
          if (d < from || d > to) continue;
          if (isSunday(d)) continue;
          // ---- HORÁRIO OBRIGATÓRIO FLAT EXP ----
          if (
            !experimentalHasTime(
              String((r as any).experimental_class_professor_time ?? ""),
              String((r as any).experimental_class_lead_time ?? ""),
            )
          )
            continue;
          const pName = String((r as any).experimental_class_professor_name ?? "").trim();
          const pPhone = String((r as any).experimental_class_professor_phone ?? "").trim();
          const hasProf = Boolean(pName || pPhone);
          const bkId = flatExpDedupId(String(r.id ?? ""), (r as any).experimental_class_booking_id);
          if (bkId && alreadySeenBookingIdsPeriodo.has(bkId)) continue;
          alreadySeenBookingIdsPeriodo.add(bkId);
          const key = detectTeacherKey(pName, pPhone, !hasProf);
          (badgeMap[d] as any)[key] = true;
        }
      }
    }
  } catch {}

  // =============== 2) RECORRENTES (leads flat) ===============
  // 🔴 TROCADO SDK admin.from() → FETCH REST DIRETO (igual MODAL).
  try {
    const sel = [
      "id",
      "recurring_class_status",
      "recurring_class_weekday",
      "recurring_class_weekday_label",
      "recurring_class_professor_name",
      "recurring_class_professor_phone",
      "recurring_class_professor_time",
      "recurring_class_lead_time",
      "recurring_class_created_at",
      "recurring_class_professor_timezone",
      "funnel_stage",
    ].join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/atendimento_leads?or=(recurring_class_status.not.is.null,recurring_class_weekday.not.is.null,recurring_class_weekday_label.not.is.null,recurring_class_professor_time.not.is.null,recurring_class_lead_time.not.is.null,recurring_class_created_at.not.is.null)&select=${sel}&limit=5000`,
      { method: "GET", headers: restHeaders, cache: "no-store" },
    );
    if (res.ok) {
      const data = (await res.json()) as Array<Record<string, unknown>> | null;
      if (Array.isArray(data) && data.length > 0) {
        for (const r of data) {
          const stRec = String((r as any).recurring_class_status ?? "").trim().toLowerCase();
          const stFunnel = String((r as any).funnel_stage ?? "").trim().toLowerCase();
          let recOk = false;
          if (stRec && VALID_RECURRING_CLASS_STATUS.has(stRec)) recOk = true;
          else if (!stRec && VALID_RECURRING_FUNNEL_STAGE_FALLBACK.has(stFunnel)) recOk = true;
          if (!recOk) continue;
          const colWeekday = String((r as any).recurring_class_weekday ?? "").trim().toLowerCase();
          const colLabel = String((r as any).recurring_class_weekday_label ?? "").trim();
          let effective: "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | null = null;
          const ALLOWED_WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
          if (ALLOWED_WD.includes(colWeekday as any)) effective = colWeekday as any;
          else {
            const fromLabel = weekdayFromLabel(colLabel);
            if (fromLabel) effective = fromLabel;
          }
          if (!effective) continue;
          // horário obrigatório (mesma regra do modal)
          const pTimeRaw =
            String((r as any).recurring_class_professor_time ?? "").trim() ||
            String((r as any).recurring_class_lead_time ?? "").trim();
          if (!recurringHasTime(pTimeRaw)) continue;
          if (effective === "sun") continue; // domingo SEM grade (mesma regra do modal)

          // teacher key
          const pName = String((r as any).recurring_class_professor_name ?? "").trim();
          const pPhone = String((r as any).recurring_class_professor_phone ?? "").trim();
          const hasProf = Boolean(pName || pPhone);
          const tKey = detectTeacherKey(pName, pPhone, !hasProf);

          // primeira data (created_at convertido no tz do professor) — MESMA lógica do modal
          const tz =
            String((r as any).recurring_class_professor_timezone ?? "").trim() ||
            ATENDIMENTO_PROFESSOR_TIME_ZONE;
          const firstLocalYYYYMMDD = recurringFirstLocalDate(
            (r as any).recurring_class_created_at,
            tz,
          );

          // Iterar todos os dias do período e marcar se weekday == effective
          for (const d of dayList) {
            if (isSunday(d)) continue;
            if (firstLocalYYYYMMDD && d < firstLocalYYYYMMDD) continue;
            const wd = weekdayShortIso(d);
            if (wd !== effective) continue;
            (badgeMap[d] as any)[tKey] = true;
          }
        }
      }
    }
  } catch {}

  return Response.json({ ok: true, from, to, badgeMap });
}
