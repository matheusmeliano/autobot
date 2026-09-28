import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import {
  EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST,
} from "@/lib/atendimento/experimentalClass";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { localDateInTimeZone } from "@/lib/recurrence";
import { addDays, format, isBefore, isSameDay, parseISO } from "date-fns";

function weekdayFromLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const s = label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (s.startsWith("domingo") || s.startsWith("dom ")) return "sun";
  if (s.startsWith("segunda") || s.startsWith("seg ")) return "mon";
  if (s.startsWith("terca") || s.startsWith("ter ")) return "tue";
  if (s.startsWith("quarta") || s.startsWith("qua ")) return "wed";
  if (s.startsWith("quinta") || s.startsWith("qui ")) return "thu";
  if (s.startsWith("sexta") || s.startsWith("sex ")) return "fri";
  if (s.startsWith("sabado") || s.startsWith("sab ")) return "sat";
  return null;
}

function weekdayShortIso(localDateYYYYMMDD: string): string {
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

  // Professor short maps para LB / NC (allowlist)
  const teacherByShort: Record<string, "LB" | "NC"> = {};
  for (const t of EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST ?? []) {
    const s = String(t?.short ?? "").trim().toUpperCase();
    if (!s) continue;
    // Detecta: Lucas Brum → LB, Nathan Camargo → NC
    if (s.includes("LB") || String(t?.name ?? "").toUpperCase().includes("LUCAS BRUM")) teacherByShort[s] = "LB";
    if (s.includes("NC") || String(t?.name ?? "").toUpperCase().includes("NATHAN")) teacherByShort[s] = "NC";
    const n = String(t?.name ?? "").trim();
    if (n) {
      const parts = n.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const ab = ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
        if (!teacherByShort[ab]) {
          if (n.toUpperCase().includes("LUCAS BRUM")) teacherByShort[ab] = "LB";
          else if (n.toUpperCase().includes("NATHAN")) teacherByShort[ab] = "NC";
        }
      }
    }
  }

  function detectTeacherKey(nameRaw: string | null | undefined, phoneRaw: string | null | undefined, noProfessor: boolean): "LB" | "NC" | "PN" | null {
    if (noProfessor) return "PN";
    const name = String(nameRaw ?? "").trim().toUpperCase();
    const phone = String(phoneRaw ?? "").trim();
    // 1) Match por nome completo allowlist
    for (const t of EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST ?? []) {
      const tName = String(t?.name ?? "").trim().toUpperCase();
      if (tName && name && tName === name) {
        if (tName.includes("LUCAS BRUM")) return "LB";
        if (tName.includes("NATHAN")) return "NC";
      }
      const tPhone = String(t?.phone ?? "").replace(/\D+/g, "");
      const pDigits = phone.replace(/\D+/g, "");
      if (tPhone && pDigits && tPhone === pDigits) {
        if (String(t?.name ?? "").toUpperCase().includes("LUCAS BRUM")) return "LB";
        if (String(t?.name ?? "").toUpperCase().includes("NATHAN")) return "NC";
      }
    }
    if (!name && !phone) return "PN";
    if (name.includes("LUCAS BRUM")) return "LB";
    if (name.includes("NATHAN")) return "NC";
    return null;
  }

  const admin = createSupabaseAdminClient();

  // =============== 1) EXPERIMENTAIS (professor_date IN [from..to]) ===============
  try {
    const baseSelect =
      "professor_date,assigned_professor_name,assigned_professor_phone,status";
    const { data, error } = await admin
      .from("atendimento_experimental_class_bookings")
      .select(baseSelect)
      .gte("professor_date", from)
      .lte("professor_date", to);
    if (data && !error) {
      const validExpStatus = new Set([
        "scheduled","confirmed","marcada","marcado","confirmada","confirmado",
        "concluido","concluído","completed","done","finished","realizada","realizado",
        "agendada","agendado","presente","attended",
      ]);
      for (const b of data as Array<Record<string, unknown>>) {
        const d = String(b?.professor_date ?? "").trim().slice(0, 10);
        if (!d || !badgeMap[d]) continue;
        const st = String(b?.status ?? "").toLowerCase();
        if (!validExpStatus.has(st)) continue;
        const key = detectTeacherKey(
          String(b?.assigned_professor_name ?? ""),
          String(b?.assigned_professor_phone ?? ""),
          false,
        );
        if (!key) continue;
        (badgeMap[d] as any)[key] = true;
      }
    }
  } catch {}

  // =============== 2) RECORRENTES (leads flat) ===============
  // Regra: para cada dia no período (d), se o status é válido, e weekday match com effectiveWeekday, e created_at <= d → marcar.
  try {
    const sel = [
      "recurring_class_status",
      "recurring_class_weekday",
      "recurring_class_weekday_label",
      "recurring_class_professor_name",
      "recurring_class_professor_phone",
      "recurring_class_professor_time",
      "recurring_class_lead_time",
      "recurring_class_created_at",
      "recurring_class_professor_timezone",
    ].join(",");
    const { data, error } = await admin
      .from("atendimento_leads")
      .select(sel)
      .or(
        "recurring_class_status.not.is.null,recurring_class_weekday.not.is.null,recurring_class_weekday_label.not.is.null,recurring_class_professor_time.not.is.null,recurring_class_lead_time.not.is.null,recurring_class_created_at.not.is.null",
      )
      .limit(2000);
    if (data && !error) {
      const validRecStatus = new Set([
        "confirmado","confirmada","cadastro_plataforma_pendente","cadastro_pendente","ativo","ativa",
        "matriculado","matriculada","matricula_concluida","matrícula_concluída","renovacao","renovação",
        "pagamento_pendente","aguardando_pagamento","reagendado","reagendada","em_andamento",
      ]);
      for (const r of data as unknown as Array<Record<string, unknown>>) {
        const st = String((r as any).recurring_class_status ?? "").trim().toLowerCase();
        if (!validRecStatus.has(st)) continue;
        const colWeekday = String((r as any).recurring_class_weekday ?? "").trim().toLowerCase();
        const colLabel = String((r as any).recurring_class_weekday_label ?? "").trim();
        let effective: string | null = null;
        const ALLOWED = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
        if (ALLOWED.includes(colWeekday)) effective = colWeekday;
        else {
          const fromLabel = weekdayFromLabel(colLabel);
          if (fromLabel) effective = fromLabel;
        }
        if (!effective) continue;
        // horário existe?
        const pTimeRaw =
          String((r as any).recurring_class_professor_time ?? "").trim() ||
          String((r as any).recurring_class_lead_time ?? "").trim();
        const hasTime = /\d{1,2}:\d{2}/.test(pTimeRaw);
        if (!hasTime) continue;

        // teacher key
        const pName = String((r as any).recurring_class_professor_name ?? "").trim();
        const pPhone = String((r as any).recurring_class_professor_phone ?? "").trim();
        const hasProf = Boolean(pName || pPhone);
        const tKey = detectTeacherKey(pName, pPhone, !hasProf);
        if (!tKey) continue;

        // primeira data (created_at convertido no tz do professor)
        const tz =
          String((r as any).recurring_class_professor_timezone ?? "").trim() ||
          ATENDIMENTO_PROFESSOR_TIME_ZONE;
        let firstLocalYYYYMMDD: string | null = null;
        const created = String((r as any).recurring_class_created_at ?? "").trim();
        if (created) {
          const dt = new Date(created);
          if (Number.isFinite(dt.getTime())) {
            try {
              firstLocalYYYYMMDD = new Intl.DateTimeFormat("en-CA", {
                timeZone: tz,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(dt);
            } catch {
              const y = dt.getUTCFullYear();
              const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
              const dd = String(dt.getUTCDate()).padStart(2, "0");
              firstLocalYYYYMMDD = `${y}-${mm}-${dd}`;
            }
          }
        }

        // Iterar todos os dias do período e marcar se weekday == effective
        for (const d of dayList) {
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
