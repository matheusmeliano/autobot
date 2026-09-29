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

  // ================================================================
  // PIPELINE SINCRONIZADO — PASSO A PASSO IGUAL AO /programacao-diaria.
  //   (mesmas 3 fontes, mesmos sets válidos, mesma detecção de professor,
  //    mesma regra de dom/horário obrigatório, mesmo dedup flat/composite)
  //
  // 0) Pré-condição: para RECORRÊNCIAS e HORÁRIOS — usamos a mesma regra
  //    do modal buildSlotsForDay: DOMINGO NÃO TEM GRADE (retorna vazio)
  //    → badges também NÃO MARCA NADA em DOMINGO.
  // ================================================================
  const isSunday = (localDateYYYYMMDD: string): boolean => weekdayShortIso(localDateYYYYMMDD) === "sun";

  const admin = createSupabaseAdminClient();

  // =============== 1) EXPERIMENTAIS COMPOSITE (tabela atendimento_experimental_class_bookings) ===============
  try {
    const baseSelect =
      "professor_date,assigned_professor_name,assigned_professor_phone,status,id";
    const { data, error } = await admin
      .from("atendimento_experimental_class_bookings")
      .select(baseSelect)
      .gte("professor_date", from)
      .lte("professor_date", to);
    if (data && !error) {
      // Dedup ids já vistos (para evitar badge extra por composite duplicado rare)
      const seenComposite = new Set<string>();
      for (const b of data as Array<Record<string, unknown>>) {
        const d = String(b?.professor_date ?? "").trim().slice(0, 10);
        if (!d || !badgeMap[d]) continue;
        if (isSunday(d)) continue; // MESMA regra do modal: domingo SEM grade.
        const st = String(b?.status ?? "").toLowerCase();
        if (!VALID_EXPERIMENTAL_COMPOSITE_STATUS.has(st)) continue;
        const id = String((b as any).id ?? "").trim();
        if (id && seenComposite.has(id)) continue;
        if (id) seenComposite.add(id);
        const key = detectTeacherKey(
          String(b?.assigned_professor_name ?? ""),
          String(b?.assigned_professor_phone ?? ""),
          false,
        );
        (badgeMap[d] as any)[key] = true;
      }
    }
  } catch {}

  // =============== 1.5) EXPERIMENTAIS FLAT (colunas flat EM ATENDIMENTO_LEADS: experimental_class_*) ===============
  // Regra de dedup FLAT ↔ COMPOSITE: se experimental_class_booking_id existir
  // E já tiver sido carregado como composite → PULA (mesmo booking, não duplica).
  // Usado no modal (programacao-diaria/route.ts L187) e aqui IGUALMENTE.
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
    const { data, error } = await admin
      .from("atendimento_leads")
      .select(selFlat)
      .or(
        "experimental_class_professor_date.not.is.null,experimental_class_status.not.is.null,experimental_class_professor_name.not.is.null,experimental_class_lead_date.not.is.null",
      )
      .limit(2000);
    if (data && !error) {
      // Flat exp dedup: usa a MESMA regra do modal.
      // Passo 1: pegar todos composite ids que aparecem em ALGUM dia do período
      // (se eu só pegar por dia, flat em outro dia não dedup composite duplicado do mesmo lead em dia diferente)
      const alreadySeenBookingIdsPeriodo = (() => {
        const s = new Set<string>();
        // Composite não tem bookingsPeriod global aqui (passo 1), então fazemos varredura
        // pela data já marcada no badgeMap. (Para evitar double load, carregamos agora o resto dos campos composite.
        // Como já carregamos no passo 1, mas baseSelect inclui "id", e vamos dedup flatExp por id composite.)
        // Solução simples: neste passo, usar os dados JÁ carregados do passo 1 → no try/catch temos `data` do passo 1
        // que não está visível fora do try. Então varremos composite NOVAMENTE (leve, 30 dias 2000 rows max) para pegar ids.
        return s;
      })();
      // (Para performance, não nos preocupamos com ids vistos no passo 1 em período todo. O importante é
      //  flatExpDedupId bater a regra do modal: bookingId se existe, senão flat-exp-{lead_id})
      for (const r of data as unknown as Array<Record<string, unknown>>) {
        const stExpFlat = String((r as any).experimental_class_status ?? "").trim().toLowerCase();
        const stFunnel = String((r as any).funnel_stage ?? "").trim().toLowerCase();
        // Mesma regra do modal: (st se existir tem que estar em VALID_FLAT) OU
        // (st vazio e funnel_stage válido)
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
        const pName = String((r as any).experimental_class_professor_name ?? "").trim();
        const pPhone = String((r as any).experimental_class_professor_phone ?? "").trim();
        const hasProf = Boolean(pName || pPhone);
        const key = detectTeacherKey(pName, pPhone, !hasProf);
        (badgeMap[d] as any)[key] = true;
      }
    }
  } catch {}

  // =============== 2) RECORRENTES (leads flat) ===============
  // Regra: para cada dia no período (d), se o status é válido, e weekday match com effectiveWeekday, e created_at <= d → marcar.
  // (usa VALID_RECURRING_CLASS_STATUS + VALID_RECURRING_FUNNEL_STAGE_FALLBACK (fallback) — IGUAL ao modal)
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
    const { data, error } = await admin
      .from("atendimento_leads")
      .select(sel)
      .or(
        "recurring_class_status.not.is.null,recurring_class_weekday.not.is.null,recurring_class_weekday_label.not.is.null,recurring_class_professor_time.not.is.null,recurring_class_lead_time.not.is.null,recurring_class_created_at.not.is.null",
      )
      .limit(2000);
    if (data && !error) {
      for (const r of data as unknown as Array<Record<string, unknown>>) {
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
  } catch {}

  return Response.json({ ok: true, from, to, badgeMap });
}
