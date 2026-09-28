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

  // Util: formatação de telefone p/ exibição no modal (sempre com +<codigo pais> (area) 9XXXX-XXXX
  const digitsOnly = (s: string | null | undefined): string => String(s ?? "").replace(/\D+/g, "");
  const formatPhoneDisplay = (rawPhone: string | null | undefined): string => {
    const raw = String(rawPhone ?? "").trim();
    if (!raw) return "";
    const d = digitsOnly(raw);
    if (!d) return raw;
    // USA: +55 BR: 10 ou 11 digitos locais
    if (d.startsWith("55")) {
      const local = d.slice(2);
      const dd = local.slice(0, 2);
      const rest = local.slice(2);
      if (!dd) return "+55";
      if (!rest.length) return `+55 (${dd})`;
      if (rest.length <= 4) return `+55 (${dd}) ${rest}`;
      if (rest.length <= 8) return `+55 (${dd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
      return `+55 (${dd}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
    }
    // USA: 10 ou 11 digitos locais (com 1 na frente)
    if (d.startsWith("1") || d.length === 10 || d.length === 11) {
      const local = d.startsWith("1") ? d.slice(1).slice(0, 10) : d.slice(0, 10);
      const ac = local.slice(0, 3);
      const p1 = local.slice(3, 6);
      const p2 = local.slice(6, 10);
      if (!ac) return "+1";
      if (local.length <= 3) return `+1 (${ac}`;
      if (local.length <= 6) return `+1 (${ac}) ${p1}`;
      return `+1 (${ac}) ${p1}-${p2}`;
    }
    return raw;
  };
  //
  // ================= IMPORTANTE SOBRE COMO BUSCAR LEAD: =================
  // O cliente admin.from("atendimento_leads") do nosso SDK estava SILENCIOSAMENTE falhando
  // em runtime (try/catch) e SEMPRE retornava null → nome não aparecia no modal ("Agendado" sozinho).
  // Solução DEFINITIVA: usar FETCH REST DIRETO ao endpoint do Supabase (service_role key no header),
  // exatamente como a query de debug que rodei manualmente e retornou os nomes REAIS:
  //   José Marcos (08:00) / Rito Pereira (09:00)
  // Isso remove camada de SDK que poderia ter RLS/cache/coluna ambigua engolindo erro.
  const SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "https://wancechxapezliwiwlke.supabase.co").replace(/\/$/, "");
  const SUPABASE_SERVICE_ROLE_KEY =
    String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhbmNlY2h4YXBlemxpd2l3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY2OTY5MCwiZXhwIjoyMDkxMjQ1NjkwfQ.8kQv54DQOQscolOiS5NW_XYXzjPYjut3pCj5uLPbYWw").trim();
  // ================== MUITO IMPORTANTE SOBRE HEADERS ==================
  // Headers permitidos no GET REST do Supabase/PostgREST:
  //   SÓ apikey + Authorization Bearer.
  // NÃO enviar em GET: 'Content-Type: application/json' / 'Accept' / 'Prefer: return=representation'.
  // Esses 3 headers são para POST/PATCH/PUT (mutações), e em GET causam **HTTP 400 Bad Request** silencioso
  // → try/catch engolia → nome nunca aparecia no modal!
  const restHeaders: Record<string, string> = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const leadIds = bookings
    .map((b) => String(b.lead_id ?? "").trim())
    .filter(Boolean);
  const leadCache = new Map<
    string,
    {
      row: Record<string, unknown> | null;
      nameFromHistory: string | null;
    }
  >();
  const fetchLeadById = async (id: string) => {
    id = String(id ?? "").trim();
    if (!id) return { row: null, nameFromHistory: null };
    if (leadCache.has(id)) return leadCache.get(id)!;
    let row: Record<string, unknown> | null = null;

    // ====== PASSO 1: BUSCA LEAD EM REST/V1/ATENDIMENTO_LEADS (sem SDK, puro fetch) ======
    // ATENÇÃO: student_full_name e display_name NÃO SÃO COLUNAS FÍSICAS da tabela atendimento_leads!
    // Eles são gerados em memória no client da rota /api/atendimento/leads (composite build).
    // Se colocar esses nomes no select, PostgREST retorna HTTP 400 (erro 42703: column does not exist).
    // Colunas que EXISTEM DE VERDADE (confirmado via debug SQL direto):
    //   id, full_name, phone, funnel_stage, status, recurring_class_status
    try {
      const sel = "id,full_name,phone,funnel_stage,status,recurring_class_status";
      const res = await fetch(`${SUPABASE_URL}/rest/v1/atendimento_leads?id=eq.${encodeURIComponent(id)}&select=${sel}`, {
        method: "GET",
        headers: restHeaders,
        cache: "no-store",
      });
      if (res.ok) {
        const arr = (await res.json()) as Array<Record<string, unknown>> | null;
        if (Array.isArray(arr) && arr.length > 0 && arr[0] && typeof arr[0] === "object") {
          row = arr[0] as Record<string, unknown>;
        }
      }
    } catch {}

    // ====== PASSO 2: HISTORY EVENTS POR REST (caso full_name ainda vazio) ======
    let historyName: string | null = null;
    try {
      const sel2 = "id,event_type,details,created_at";
      const ord = "created_at.desc";
      const res = await fetch(`${SUPABASE_URL}/rest/v1/atendimento_history_events?lead_id=eq.${encodeURIComponent(id)}&select=${sel2}&order=${ord}&limit=20`, {
        method: "GET",
        headers: restHeaders,
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as Array<Record<string, unknown>> | null;
        if (Array.isArray(data)) {
          for (const ev of data) {
            const details = ((ev.details ?? {}) as Record<string, unknown> | null);
            if (!details || typeof details !== "object") continue;
            const candidates = [
              String((details as any).full_name ?? "").trim(),
              String((details as any).student_full_name ?? "").trim(),
              String((details as any).student_name ?? "").trim(),
              String((details as any).nome ?? "").trim(),
              String((details as any).aluno_name ?? "").trim(),
              String((details as any).aluno_nome ?? "").trim(),
              String((details as any).name ?? "").trim(),
              String((details as any).display_name ?? "").trim(),
            ].filter(Boolean);
            if (candidates[0]) {
              historyName = candidates[0];
              break;
            }
          }
        }
      }
    } catch {}

    const entry = { row, nameFromHistory: historyName };
    leadCache.set(id, entry);
    return entry;
  };
  // 1.5) BUSCAR AULAS RECORRENTES (alunos matriculados, contratados) que caem NO DIA targetDate
  // Diferente de experimental (booking específico por dia), recorrente é armazenado em colunas
  // na tabela atendimento_leads com dia da semana fixo (recurring_class_weekday = mon/tue/.../sat).
  // Regras de validação: status recorrente confirmado OU cadastro_plataforma_pendente E data da 1a aula
  // recurring_class_first_class_at (ou created_at) <= targetDate.
  // Colunas usadas: recurring_class_status, recurring_class_weekday, recurring_class_professor_name,
  // recurring_class_professor_phone, recurring_class_professor_time, recurring_class_professor_timezone,
  // recurring_class_first_class_at, recurring_class_created_at, full_name, phone, id, funnel_stage, status.
  const weekdayTarget = weekdayShort(targetDate);
  const weekdayFromLabel = (wdl: unknown): "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | null => {
    const s = String(wdl ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!s) return null;
    if (s.startsWith("domingo") || s.startsWith("dom ")) return "sun";
    if (s.startsWith("segunda") || s.startsWith("seg ")) return "mon";
    if (s.startsWith("terca") || s.startsWith("ter ")) return "tue";
    if (s.startsWith("quarta") || s.startsWith("qua ")) return "wed";
    if (s.startsWith("quinta") || s.startsWith("qui ")) return "thu";
    if (s.startsWith("sexta") || s.startsWith("sex ")) return "fri";
    if (s.startsWith("sabado") || s.startsWith("sab ")) return "sat";
    return null;
  };
  const recurringBookings: Array<Record<string, unknown>> = [];
  try {
    // Colunas SÓ QUE EXISTEM FISICAMENTE em atendimento_leads, NÃO colunas composite
    // (student_full_name / display_name não existem, confirmado debug SQL!).
    const sel = [
      "id",
      "full_name",
      "phone",
      "funnel_stage",
      "status",
      "recurring_class_status",
      "recurring_class_weekday",
      "recurring_class_weekday_label",
      "recurring_class_professor_name",
      "recurring_class_professor_phone",
      "recurring_class_professor_time",
      "recurring_class_professor_timezone",
      "recurring_class_lead_time",
      "recurring_class_lead_timezone",
      "recurring_class_first_class_at",
      "recurring_class_professor_date",
      "recurring_class_created_at",
      "contract_status",
      "recurring_registration_step",
    ].join(",");
    // BUSCAR TODOS leads QUE TEM ALGUMA recorrência cadastrada (sem filtro de weekday no URL).
    // Motivo: recurring_class_weekday PODE ESTAR NULL na tabela (apenas recurring_class_weekday_label
    // preenchido, como nos prints Gisele/Aline/Marcela). A comparação weekday é feita EM MEMÓRIA ABAIXO
    // (recurring_class_weekday OU weekdayFromLabel(recurring_class_weekday_label)).
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/atendimento_leads?or=(recurring_class_status.not.is.null,recurring_class_weekday.not.is.null,recurring_class_weekday_label.not.is.null,recurring_class_professor_time.not.is.null)&select=${sel}`,
      {
        method: "GET",
        headers: restHeaders,
        cache: "no-store",
      },
    );
    if (res.ok) {
      const arr = (await res.json()) as Array<Record<string, unknown>> | null;
      if (Array.isArray(arr) && arr.length > 0) {
        const targetMsLocalNoon =
          (() => {
            const [y, mo, d] = targetDate.split("-").map((n) => Number(n));
            return Date.UTC(y, mo - 1, d, 12, 0, 0, 0);
          })();
        for (const r of arr) {
          // Filtrar STATUS aceitos de recorrência em memória (evitar inconsistência enum)
          const st = String((r as any).recurring_class_status ?? "").trim();
          if (!st) continue;
          const ok = [
            "confirmado",
            "cadastro_plataforma_pendente",
            "ativo",
            "matriculado",
          ].includes(st.toLowerCase());
          if (!ok) continue;
          // ===== MATCH WEEKDAY (SEMPRE EM MEMÓRIA por causa de NULL) =====
          const colWeekday = String((r as any).recurring_class_weekday ?? "").trim().toLowerCase();
          const colLabel = String((r as any).recurring_class_weekday_label ?? "").trim();
          const effectiveWeekday: string | null = (() => {
            const ALLOWED = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
            if (colWeekday && ALLOWED.includes(colWeekday)) return colWeekday;
            const fromLabel = weekdayFromLabel(colLabel);
            if (fromLabel) return fromLabel;
            return null;
          })();
          if (!effectiveWeekday) continue;
          if (effectiveWeekday !== weekdayTarget) continue;
          // Regra: NÃO MOSTRAR RECORRENTE SE PRIMEIRA AULA AINDA NÃO ACONTECEU
          let firstClassBeforeOrEqual = true;
          const candidatesFirstClass = [
            (r as any).recurring_class_first_class_at,
            (r as any).recurring_class_professor_date,
            (r as any).recurring_class_created_at,
          ]
            .map((s) => String(s ?? "").trim())
            .filter(Boolean);
          if (candidatesFirstClass.length > 0) {
            for (const fc of candidatesFirstClass) {
              const dt = new Date(fc);
              if (!Number.isFinite(dt.getTime())) continue;
              const tz =
                String((r as any).recurring_class_professor_timezone ?? "").trim() ||
                ATENDIMENTO_PROFESSOR_TIME_ZONE;
              const localYYYYMMDD = (() => {
                try {
                  const yyyy = new Intl.DateTimeFormat("en-CA", {
                    timeZone: tz,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  }).format(dt);
                  return yyyy;
                } catch {
                  const yyyy = dt.getUTCFullYear();
                  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
                  const dd = String(dt.getUTCDate()).padStart(2, "0");
                  return `${yyyy}-${mm}-${dd}`;
                }
              })();
              const [y, mo, d] = localYYYYMMDD.split("-").map((n) => Number(n));
              const firstMs = Date.UTC(y, mo - 1, d, 12, 0, 0);
              if (firstMs > targetMsLocalNoon) {
                firstClassBeforeOrEqual = false;
                break;
              }
              break;
            }
          }
          if (!firstClassBeforeOrEqual) continue;
          // Horário obrigatório
          const pTimeRaw =
            String((r as any).recurring_class_professor_time ?? "").trim() ||
            String((r as any).recurring_class_lead_time ?? "").trim();
          const pTime = (() => {
            const m = pTimeRaw.match(/(\d{1,2}):(\d{2})/);
            if (!m) return "";
            const hh = String(Number(m[1])).padStart(2, "0");
            const mm = String(Number(m[2])).padStart(2, "0");
            return `${hh}:${mm}`;
          })();
          if (!pTime) continue;
          // ======== PROFESSOR (NÃO MAIS OBRIGATÓRIO) ========
          // Nos prints do usuário (Gisele, Carlos Peta, Edison Nicodemos, Marcela, Aline Faustino),
          // NÃO EXISTE professor associado ao card da recorrência (campos vazios).
          // Antigo código dava continue aqui! → BUG, nunca aparecia.
          // Solução: se NÃO tem professor (nem name nem phone), atribuímos a um card especial
          // "Professor não atribuído" (criado ao final do unify teachers abaixo). Para identificar
          // esse caso, marcamos __noProfessor=true e assigned_professor_name/phone = null (não vazio).
          const pName = String((r as any).recurring_class_professor_name ?? "").trim();
          const pPhone = String((r as any).recurring_class_professor_phone ?? "").trim();
          const hasProfessor = Boolean(pName || pPhone);
          // Montar objeto com mesma interface do experimental para reaproveitar slot code.
          let startIso = "";
          try {
            startIso = zonedDateTimeToUtcIso({
              date: targetDate,
              time: pTime,
              timeZone:
                String((r as any).recurring_class_professor_timezone ?? "").trim() ||
                ATENDIMENTO_PROFESSOR_TIME_ZONE,
            });
          } catch {}
          const entry: Record<string, unknown> = {
            id: `recurring-${String(r.id ?? "")}`,
            lead_id: String(r.id ?? ""),
            status: "scheduled",
            professor_date: targetDate,
            professor_time: pTime,
            professor_start_at: startIso || null,
            lead_date: targetDate,
            lead_time: String((r as any).recurring_class_lead_time ?? "").trim() || null,
            lead_timezone:
              String((r as any).recurring_class_lead_timezone ?? "").trim() || null,
            professor_timezone:
              String((r as any).recurring_class_professor_timezone ?? "").trim() || null,
            assigned_professor_name: hasProfessor ? (pName || null) : null,
            assigned_professor_phone: hasProfessor ? (pPhone || null) : null,
            __noProfessor: !hasProfessor,
            created_at: String((r as any).recurring_class_created_at ?? "").trim() || null,
            updated_at: String((r as any).recurring_class_created_at ?? "").trim() || null,
            __type: "recurring",
          };
          recurringBookings.push(entry);
        }
      }
    }
  } catch {}
  // Incluir lead IDs recorrentes no warmup (para prefetch de history / nomes iguais experimentais)
  for (const b of recurringBookings) {
    const lid = String(b.lead_id ?? "").trim();
    if (lid && !leadIds.includes(lid)) leadIds.push(lid);
  }
  // JUNTAR AS DUAS LISTAS (experimentais + recorrentes). Mesma estrutura, mesmo código slot abaixo.
  if (recurringBookings.length > 0) {
    for (const rb of recurringBookings) bookings.push(rb);
  }

  // Warmup: prefetch todos os lead ids (evita múltiplas chamadas no loop).
  if (leadIds.length > 0) {
    const uniqIds = Array.from(new Set(leadIds));
    for (const id of uniqIds) await fetchLeadById(id);
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
      classTypeLabel?: "Experimental" | "Recorrente" | null;
      badgeLabel?: string | null;
      badgeBg?: string | null;
      badgeText?: string | null;
      aluno?: {
        id: string;
        displayName: string;
        phone: string;
        status: string;
      } | null;
    }>;
  }> = [];

  // ===== PROFESSORES ADICIONAIS: card "Professor não atribuído" (para recorrentes sem professor) =====
  // Nos prints do usuário (Gisele, Carlos Peta, Edison Nicodemos, Marcela, Aline Faustino), a recorrência
  // existe mas NÃO TEM professor associado (campos vazios). Criamos um card ESPECIAL para exibir esses
  // registros SEM jogá-los no fallback errado do Lucas Brum.
  const PROF_NO_ATRIBUIDO_PHONE = "__no_assigned_professor__";
  const hasAnyNoProfessor = bookings.some(
    (b) =>
      String((b as any).__noProfessor ?? "false").toLowerCase() === "true" ||
      String((b as any).assigned_professor_name ?? "").trim() === "" &&
        String((b as any).assigned_professor_phone ?? "").trim() === "" &&
        String((b as any).__type ?? "").toLowerCase() === "recurring",
  );
  type ProfListItem = { name: string; phone: string; short?: string };
  const teachersList: ProfListItem[] = [
    ...EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST,
  ];
  if (hasAnyNoProfessor) {
    teachersList.push({
      name: "Professor não atribuído",
      phone: PROF_NO_ATRIBUIDO_PHONE,
      short: "S/Prof",
    });
  }

  for (const p of teachersList) {
    const isNoProfessorCard = p.phone === PROF_NO_ATRIBUIDO_PHONE;
    // Filtrar bookings designados para ESTE professor
    const pb = bookings.filter((bk) => {
      const noProf =
        String((bk as any).__noProfessor ?? "false").toLowerCase() === "true";
      // CASO ESPECIAL: Card "não atribuído" = todos bookings marcados __noProfessor=true
      if (isNoProfessorCard) {
        return noProf;
      }
      // Booking SEM professor (recorrente novo estilo) NÃO cai em Lucas/Nathan NUNCA MAIS.
      if (noProf) return false;
      const nm = String(bk.assigned_professor_name ?? "").trim();
      const ph = String(bk.assigned_professor_phone ?? "").trim();
      if (nm || ph) {
        return (nm ? nm === p.name : true) && (ph ? ph === p.phone : true);
      }
      // Sem assigned nenhum (experimental antigo, sem nome nem telefone): fallback 1º professor (Lucas Brum)
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
    const slots: any[] = [];
    for (const s of daySlotsRaw) {
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
      // ===== BADGE DINÂMICO + TIPO AULA (Experimental / Recorrente) =====
      let badgeLabel: string | null = null;
      let badgeBg: string | null = null;
      let badgeText: string | null = null;
      // Tipo da aula: DEFINE baseado no booking __type.
      // Se experimental (default): "Experimental". Se recorrente (busca em atendimento_leads com weekday) → "Recorrente".
      const isRecurringRow = active && String((active as any).__type ?? "").toLowerCase() === "recurring";
      const classTypeLabel: "Experimental" | "Recorrente" = isRecurringRow ? "Recorrente" : "Experimental";
      if (active && !isCancelled) {
        const startIso =
          (active ? String(active.professor_start_at ?? "").trim() : "") ||
          s.professorStartAtIso ||
          "";
        const startMs = startIso
          ? new Date(startIso).getTime()
          : Number.NaN;
        const nowMs = new Date(nowUtc).getTime();
        const endMs = Number.isFinite(startMs) ? startMs + 60 * 60 * 1000 : Number.NaN;
        const isCompleted = Number.isFinite(endMs) && endMs <= nowMs;
        if (isCompleted) {
          badgeLabel = "Concluído";
          badgeBg = "#16a34a"; // green-600 (fundo verde, texto branco - acessível WCAG AA)
          badgeText = "#ffffff";
        } else {
          badgeLabel = "Agendado";
          badgeBg = "#ca8a04"; // amber-600 (fundo amarelo, texto branco - acessível WCAG AA)
          badgeText = "#ffffff";
        }
      }
      if (active && active.lead_id) {
        const { row: lr, nameFromHistory } = await fetchLeadById(
          String(active.lead_id ?? ""),
        );
        if (lr || nameFromHistory) {
          // ATENÇÃO: atendimento_leads NÃO TEM student_full_name / display_name como colunas FÍSICAS
          // (essas são geradas em memória no composite do /api/atendimento/leads/route.ts).
          // Então só pegamos full_name (real), phone real, e nameFromHistory como fallback.
          const names = [
            lr ? String((lr as any).full_name ?? "").trim() : "",
            nameFromHistory ?? "",
          ].filter(Boolean);
          const phoneRaw = lr
            ? String((lr as any).phone ?? "").trim()
            : "";
          const phone = formatPhoneDisplay(phoneRaw);
          const funnel = lr
            ? String(
                (lr as any).funnel_stage ??
                  (lr as any).status ??
                  (lr as any).recurring_class_status ??
                  "",
              ).trim()
            : "";
          aluno = {
            id: String(
              lr
                ? (lr as any).id ?? active.lead_id ?? active.id ?? ""
                : active.lead_id ?? active.id ?? "",
            ),
            displayName: names[0]
              ? `Agendado para ${names[0]}`
              : "Agendado",
            phone,
            status: funnel || "lead",
          };
        } else {
          aluno = {
            id: String(active.lead_id ?? active.id ?? ""),
            displayName: "Agendado",
            phone: "",
            status: "",
          };
        }
      }

      slots.push({
        professorTime: time,
        status: slotStatus,
        bookingId: active
          ? String(active.id ?? "").trim() || null
          : null,
        bookingStatus,
        classTypeLabel,
        badgeLabel,
        badgeBg,
        badgeText,
        aluno,
      });
    }

    teachers.push({
      name: p.name,
      phone: p.phone,
      short: p.short && p.short.length > 0 ? p.short : p.name.slice(0, 2).toUpperCase(),
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
