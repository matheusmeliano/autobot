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
  // NÃO FAZ JOIN inline com atendimento_leads na mesma query.
  // Erros frequentes: "more than one relationship" e "could not find a relationship in the schema cache"
  // (pois existem 2+ FKs e/ou PostgREST cache não reconhece a relação).
  // Fazer 2 selects separados SEMPRE (bookings + leads WHERE lead_id IN (...) — método que sempre funcionou.
  const bookings: Array<Record<string, unknown>> = [];
  const baseSelect =
    "id, lead_id, conversation_id, status, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_timezone, professor_timezone, assigned_professor_name, assigned_professor_phone, created_at, updated_at";
  {
    const { data, error } = await admin
      .from("atendimento_experimental_class_bookings")
      .select(baseSelect)
      .eq("professor_date", targetDate);
    if (error && !isBookingsMissing(error)) {
      return Response.json(
        { ok: false, error: error.message ?? String(error) },
        { status: 500 },
      );
    }
    if (data && !isBookingsMissing(error)) {
      for (const b of data as Array<Record<string, unknown>>) bookings.push(b);
    }
  }

  // 2) Buscar leads vinculados (nome, telefone, status)
  const leadIds = bookings
    .map((b) => String(b.lead_id ?? "").trim())
    .filter(Boolean);
  const leadMap = new Map<string, Record<string, unknown>>();
  if (leadIds.length > 0) {
    const uniqIds = Array.from(new Set(leadIds));
    const { data: leadsRows, error: lError } = await admin
      .from("atendimento_leads")
      .select(
        "id, full_name, student_full_name, display_name, phone, status, funnel_stage, recurring_class_status",
      )
      .in("id", uniqIds);
    if (lError && isLeadsMissing(lError) === false) {
      // Erro diferente de tabela não existe, tenta buscar INDIVIDUALMENTE (as vezes .in tem limite/cache ruim).
      try {
        const rows: Array<Record<string, unknown>> = [];
        for (const id of uniqIds) {
          const { data: one, error: oneErr } = await admin
            .from("atendimento_leads")
            .select(
              "id, full_name, student_full_name, display_name, phone, status, funnel_stage, recurring_class_status",
            )
            .eq("id", id)
            .maybeSingle();
          if (!oneErr && one) rows.push(one as Record<string, unknown>);
        }
        for (const r of rows) leadMap.set(String(r.id ?? ""), r);
      } catch {}
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
      return (
        p.phone === EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST[0]?.phone
      );
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
    const slots = await Promise.all(
      daySlotsRaw.map(async (s) => {
        const time = s.professorTime;
        const bkList = pbByTime.get(time) ?? [];
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
        const bookingStatus =
          String(active?.status ?? "").trim().toLowerCase() || null;
        const isCancelled = bookingStatus === "cancelled";

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
          let lr: Record<string, unknown> | null =
            leadMap.get(String(active.lead_id ?? "")) ?? null;
          if (!lr) {
            try {
              const { data: one, error: oneErr } = await admin
                .from("atendimento_leads")
                .select(
                  "id, full_name, student_full_name, display_name, phone, status, funnel_stage, recurring_class_status",
                )
                .eq("id", String(active.lead_id ?? ""))
                .maybeSingle();
              if (!oneErr && one) {
                lr = one as Record<string, unknown>;
                leadMap.set(String(active.lead_id ?? ""), lr);
              }
            } catch {}
          }
          if (lr) {
            const names = [
              String((lr as any).student_full_name ?? "").trim(),
              String((lr as any).full_name ?? "").trim(),
              String((lr as any).display_name ?? "").trim(),
            ].filter(Boolean);
            const phone = String((lr as any).phone ?? "").trim();
            const funnel = String(
              (lr as any).funnel_stage ??
                (lr as any).status ??
                (lr as any).recurring_class_status ??
                "",
            ).trim();
            aluno = {
              id: String(
                (lr as any).id ?? active.lead_id ?? active.id ?? "",
              ),
              displayName:
                names[0] ??
                (active.id
                  ? `Agendamento ${String(active.id ?? "").slice(0, 6).toUpperCase()}`
                  : "Agendamento"),
              phone,
              status: funnel || "lead",
            };
          } else {
            const idShort = String(active.id ?? active.lead_id ?? "")
              .slice(0, 6)
              .toUpperCase();
            aluno = {
              id: String(active.lead_id ?? active.id ?? ""),
              displayName: idShort ? `Agendamento ${idShort}` : "Agendamento",
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
      }),
    );

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
