import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import {
  EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST,
  EXPERIMENTAL_CLASS_SLOT_TIMES,
} from "@/lib/atendimento/experimentalClass";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { isAfter, parseISO } from "date-fns";
import { localDateInTimeZone } from "@/lib/recurrence";
import { zonedDateTimeToUtcIso, PROFESSOR_TIME_ZONE } from "@/lib/timezone";

const EXPERIMENTAL_CLASS_BOOKINGS_MISSING =
  /relation .*atendimento_experimental_class_bookings.*does not exist|could not find the table .*atendimento_experimental_class_bookings.* in the schema cache/i;
const LEADS_MISSING =
  /relation .*atendimento_leads.*does not exist|could not find the table .*atendimento_leads.* in the schema cache/i;

function isBookingsMissing(err: unknown) {
  return EXPERIMENTAL_CLASS_BOOKINGS_MISSING.test(
    String((err as any)?.message ?? "").toLowerCase(),
  );
}

function isLeadsMissing(err: unknown) {
  return LEADS_MISSING.test(String((err as any)?.message ?? "").toLowerCase());
}

function weekdayShort(localDateYYYYMMDD: string): string {
  const [y, mo, d] = localDateYYYYMMDD.split("-").map((n) => Number(n));
  if (!y || !mo || !d) return "sun";
  const utc = Date.UTC(y, mo - 1, d, 12, 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  })
    .format(utc)
    .toLowerCase();
}

function buildSlotsForDay(localDate: string, nowUtcIso: string): Array<{
  professorTime: string;
  professorStartAtIso: string;
  isPast: boolean;
}> {
  // Domingo não tem aula experimental (seguindo regra de availability)
  const wd = weekdayShort(localDate);
  if (wd === "sun") return [];

  const nowMs = new Date(nowUtcIso).getTime();
  const out: Array<{
    professorTime: string;
    professorStartAtIso: string;
    isPast: boolean;
  }> = [];

  for (const professorTime of EXPERIMENTAL_CLASS_SLOT_TIMES) {
    let iso = "";
    try {
      iso = zonedDateTimeToUtcIso({
        date: localDate,
        time: professorTime,
        timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      });
    } catch {
      continue;
    }
    const ms = new Date(iso).getTime();
    out.push({
      professorTime,
      professorStartAtIso: iso,
      isPast: Number.isFinite(ms) && ms <= nowMs,
    });
  }
  void nowMs;
  return out;
}

export async function GET(req: Request) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const dateQ = String(url.searchParams.get("date") ?? "").trim();
  const nowUtc = new Date().toISOString();
  const todayIso = localDateInTimeZone(nowUtc, ATENDIMENTO_PROFESSOR_TIME_ZONE);
  const targetDate = dateQ ? String(dateQ).slice(0, 10) : todayIso;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return Response.json({ ok: false, error: "bad_date" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // 1) Buscar TODOS os bookings desse dia (professor_date === targetDate)
  let bookings: Array<Record<string, unknown>> = [];
  const query = admin
    .from("atendimento_experimental_class_bookings")
    .select(
      "id, lead_id, conversation_id, status, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_timezone, professor_timezone, assigned_professor_name, assigned_professor_phone, created_at, updated_at",
    )
    .eq("professor_date", targetDate);
  const { data: bookingsData, error: bError } = await query;
  if (bError && !isBookingsMissing(bError)) {
    return Response.json({ ok: false, error: bError.message }, { status: 500 });
  }
  if (bookingsData && !isBookingsMissing(bError)) {
    bookings = bookingsData.map((b) => b as Record<string, unknown>);
  }

  // 2) Buscar leads vinculados (nome, telefone, status)
  const leadIds = bookings
    .map((b) => String(b.lead_id ?? "").trim())
    .filter(Boolean);
  const leadMap = new Map<string, Record<string, unknown>>();
  if (leadIds.length > 0) {
    const { data: leadsRows, error: lError } = await admin
      .from("atendimento_leads")
      .select(
        "id, full_name, student_full_name, display_name, phone, status, funnel_stage, recurring_class_status",
      )
      .in("id", Array.from(new Set(leadIds)));
    if (!lError || isLeadsMissing(lError) === false) {
      // ignoramos erro "tabela não existe" só no sentido de não quebrar; se erro diferente, continua sem leads.
    }
    if (leadsRows) {
      for (const r of leadsRows as Array<Record<string, unknown>>) {
        leadMap.set(String(r.id ?? ""), r);
      }
    }
  }

  // 3) Gerar slots da grade para o dia (08:00-22:00)
  const daySlotsRaw = buildSlotsForDay(targetDate, nowUtc);

  // 4) Para cada professor do allowlist: montar grade
  const teachers: Array<{
    name: string;
    phone: string;
    short: string;
    totalSlots: number;
    totalBookings: number;
    totalPast: number;
    totalScheduled: number;
    slots: Array<{
      professorTime: string;
      status: "disponivel" | "ocupado" | "passado" | "cancelado";
      bookingId?: string | null;
      bookingStatus?: string | null;
      aluno?: {
        id: string;
        displayName: string;
        phone: string;
        status: string;
      } | null;
    }>;
  }> = [];

  for (const p of EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST) {
    // Filtrar bookings designados para ESTE professor
    const pb = bookings.filter((bk) => {
      const nm = String(bk.assigned_professor_name ?? "").trim();
      const ph = String(bk.assigned_professor_phone ?? "").trim();
      if (nm || ph) {
        return (nm ? nm === p.name : true) && (ph ? ph === p.phone : true);
      }
      // Sem assigned nenhum: atribui ao 1o professor da allowlist (fallback Lucas Brum)
      return p.phone === EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST[0]?.phone;
    });
    const pbByTime = new Map<string, Array<Record<string, unknown>>>();
    for (const b of pb) {
      const t = String(b.professor_time ?? "").trim();
      const arr = pbByTime.get(t) ?? [];
      arr.push(b);
      pbByTime.set(t, arr);
    }

    let totalBookings = 0;
    let totalPast = 0;
    let totalScheduled = 0;
    const slots = daySlotsRaw.map((s) => {
      const time = s.professorTime;
      const bkList = pbByTime.get(time) ?? [];
      // Pega o booking ativo: prioridade scheduled > confirmed > attended > outros > cancelled
      const order: Record<string, number> = {
        scheduled: 6,
        confirmed: 5,
        attended: 4,
        pending: 3,
        rescheduled: 2,
        missed: 1,
        cancelled: 0,
      };
      const sorted = [...bkList].sort((a, b) => {
        const sa = order[String(a.status ?? "").toLowerCase()] ?? -1;
        const sb = order[String(b.status ?? "").toLowerCase()] ?? -1;
        if (sa !== sb) return sb - sa;
        const ua = String(a.updated_at ?? a.created_at ?? "");
        const ub = String(b.updated_at ?? b.created_at ?? "");
        return ub.localeCompare(ua);
      });
      const active = sorted[0] ?? null;
      const bookingStatus = String(active?.status ?? "").trim().toLowerCase() || null;
      const isCancelled = bookingStatus === "cancelled";

      // Detectar passado: se slot já passou E o status não tá mais scheduled.
      const iso = s.professorStartAtIso;
      const isPastByTime =
        !!iso &&
        isAfter(parseISO(nowUtc), parseISO(iso)) &&
        bookingStatus !== "scheduled";

      let slotStatus: "disponivel" | "ocupado" | "passado" | "cancelado" =
        "disponivel";
      if (isCancelled) slotStatus = "cancelado";
      else if (active) slotStatus = "ocupado";
      else if (s.isPast || isPastByTime) slotStatus = "passado";

      if (active && !isCancelled) {
        totalBookings += 1;
        if (isPastByTime || s.isPast) totalPast += 1;
        else totalScheduled += 1;
      }

      let aluno = null as {
        id: string;
        displayName: string;
        phone: string;
        status: string;
      } | null;
      if (active && active.lead_id) {
        const lr = leadMap.get(String(active.lead_id ?? "")) ?? null;
        if (lr) {
          const names = [
            String(lr.student_full_name ?? "").trim(),
            String(lr.full_name ?? "").trim(),
            String(lr.display_name ?? "").trim(),
          ].filter(Boolean);
          aluno = {
            id: String(lr.id ?? ""),
            displayName: names[0] ?? "Sem nome",
            phone: String(lr.phone ?? "").trim(),
            status:
              String(
                lr.funnel_stage ??
                  lr.status ??
                  lr.recurring_class_status ??
                  "",
              ).trim() || "lead",
          };
        } else {
          aluno = {
            id: String(active.lead_id ?? ""),
            displayName: "Lead",
            phone: "",
            status: "",
          };
        }
      }

      return {
        professorTime: time,
        status: slotStatus,
        bookingId: active
          ? String(active.id ?? "").trim() || null
          : null,
        bookingStatus,
        aluno,
      };
    });

    teachers.push({
      name: p.name,
      phone: p.phone,
      short: p.short,
      totalSlots: daySlotsRaw.length,
      totalBookings,
      totalPast,
      totalScheduled,
      slots,
    });
  }

  // Agregar totais
  const totalSlots = teachers.reduce((a, b) => a + b.totalSlots, 0);
  const totalBookings = teachers.reduce((a, b) => a + b.totalBookings, 0);
  const totalPast = teachers.reduce((a, b) => a + b.totalPast, 0);
  const totalScheduled = teachers.reduce(
    (a, b) => a + b.totalScheduled,
    0,
  );
  const totalAvailable = teachers.reduce(
    (acc, t) => acc + t.slots.filter((s) => s.status === "disponivel").length,
    0,
  );
  const totalCancelled = teachers.reduce(
    (acc, t) => acc + t.slots.filter((s) => s.status === "cancelado").length,
    0,
  );

  return Response.json({
    ok: true,
    date: targetDate,
    timeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
    summary: {
      totalSlots,
      totalBookings,
      totalAvailable,
      totalScheduled,
      totalPast,
      totalCancelled,
      totalTeachers: teachers.length,
    },
    teachers,
  });
}
