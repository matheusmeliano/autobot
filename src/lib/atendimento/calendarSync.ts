// ====================================================================
// LIB SINCRONIZADORA BADGES ↔ MODAL (PROGRAMAÇÃO DO DIA).
// 100% da lógica de "contar aulas no dia" / "quais professores aparecem"
// MORA AQUI. Os dois endpoints (/badges e /programacao-diaria) usam
// EXATAMENTE esses helpers. NÃO DUPLIQUE lógica em nenhum dos dois.
//
// Objetivo: "se o calendário diz que tem 3 aulas no dia 23, o modal do
// dia 23 também terá 3 aulas (e vice-versa) com EXATAMENTE as mesmas
// regras, sempre."
// ====================================================================
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "./constants";
import { EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST } from "./experimentalClass";

// ====================================================================
// A. STATUS VÁLIDOS — UNIFICADOS (usados pelos 2 endpoints).
// ====================================================================
export const VALID_EXPERIMENTAL_COMPOSITE_STATUS: ReadonlySet<string> = new Set(
  [
    "scheduled", "confirmed", "marcada", "marcado", "confirmada", "confirmado",
    "concluido", "concluído", "completed", "done", "finished", "realizada", "realizado",
    "agendada", "agendado", "presente", "attended",
    "time_selected", "lead_selected", "professor_selected", "professor_confirmed",
    "lead_confirmed", "aula_marcada", "aula_agendada", "reagendada", "reagendado",
    "pending", "proposta_enviada", "follow_up", "follow_up_scheduled",
    "aguardando_pagamento", "pagamento_pendente_confirmacao",
    "revisao_contrato", "contrato_pronto",
  ].map((s) => s.toLowerCase()),
);

// Flat experimentais em atendimento_leads = experimentais composite +
// podemos incluir funnel_stage aqui (ex: "aula_experimental_agendada").
export const VALID_EXPERIMENTAL_FLAT_STATUS: ReadonlySet<string> = new Set(
  [
    ...VALID_EXPERIMENTAL_COMPOSITE_STATUS,
    "aula_experimental_agendada",
  ].map((s) => s.toLowerCase()),
);

// Recorrentes: recurring_class_status ACEITOS.
export const VALID_RECURRING_CLASS_STATUS: ReadonlySet<string> = new Set(
  [
    "confirmado", "confirmada", "cadastro_plataforma_pendente", "cadastro_pendente",
    "ativo", "ativa",
    "matriculado", "matriculada", "matricula_concluida", "matrícula_concluída",
    "renovacao", "renovação",
    "pagamento_pendente", "aguardando_pagamento",
    "reagendado", "reagendada", "em_andamento",
    // Funnel stage fallback (se recurring_class_status vazio mas funnel_stage é aluno)
    "aluno", "aluno_recorrente_cadastrado", "aluno_ativo",
    "contrato_assinado", "contrato_confirmado",
    "pagamento_pendente_confirmacao", "pagamento_confirmado",
    "pagamento_aprovado",
  ].map((s) => s.toLowerCase()),
);

// Para recorrentes: se recurring_class_status for vazio, usamos
// recurring_class_funnel_stage (fallback). Esses são os valores aceitos.
export const VALID_RECURRING_FUNNEL_STAGE_FALLBACK: ReadonlySet<string> = new Set(
  ["aluno", "matriculado", "matricula_confirmada", "aluno_recorrente_cadastrado"].map((s) => s.toLowerCase()),
);

// Recorrentes: tem horário? (obrigatório para aparecer tanto em badges
// quanto no modal — "uma aula sem horário não existe" para UI).
export function recurringHasTime(pTimeRaw: string | null | undefined): boolean {
  return /\d{1,2}:\d{2}/.test(String(pTimeRaw ?? "").trim());
}

// Experimentais (composite E flat): tem horário?
// ANTES: badges marcava aula com status válido mas professor_time nulo →
//        modal não encontrava slot → "3 badges, modal mostra 2".
// AGORA:  os dois validam, sempre sincronizado.
export function experimentalHasTime(
  professorTimeRaw: string | null | undefined,
  leadTimeRaw?: string | null | undefined,
): boolean {
  const p = String(professorTimeRaw ?? "").trim();
  const l = String(leadTimeRaw ?? "").trim();
  return /\d{1,2}:\d{2}/.test(p) || /\d{1,2}:\d{2}/.test(l);
}

// ====================================================================
// B. DETECÇÃO DE PROFESSOR KEY (LB / NC / PN) — UNIFICADA.
// ====================================================================
export type TeacherKey = "LB" | "NC" | "PN";
const LB_LAST4 = "9407";
const NC_LAST4 = "0166";

export function detectTeacherKey(
  nameRaw: string | null | undefined,
  phoneRaw: string | null | undefined,
  noProfessor?: boolean | null | undefined,
): TeacherKey {
  if (noProfessor === true) return "PN";
  const name = String(nameRaw ?? "").trim().toUpperCase();
  const phone = String(phoneRaw ?? "").trim();
  const pDigits = phone.replace(/\D+/g, "");
  const last4Phone = pDigits.length >= 4 ? pDigits.slice(-4) : "";

  // 1. Allowlist MATCH exato (nome / telefone completo)
  for (const t of EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST ?? []) {
    const tName = String(t?.name ?? "").trim().toUpperCase();
    if (tName && name && tName === name) {
      if (tName.includes("LUCAS BRUM")) return "LB";
      if (tName.includes("NATHAN")) return "NC";
    }
    const tPhone = String(t?.phone ?? "").replace(/\D+/g, "");
    if (tPhone && pDigits && tPhone === pDigits) {
      if (String(t?.name ?? "").toUpperCase().includes("LUCAS BRUM")) return "LB";
      if (String(t?.name ?? "").toUpperCase().includes("NATHAN")) return "NC";
    }
  }

  // 2. Fortaleza (parciais — nome substring / últimos 4 dígitos)
  const isLBPhone = last4Phone === LB_LAST4;
  const isNCPhone = last4Phone === NC_LAST4;
  const isLBName = name.includes("LUCAS") && name.includes("BRUM");
  const isNCName = name.includes("NATHAN") || name.includes("NATAN") || name.includes("NATHAM") || name.includes("CAMARGO");
  if (isLBPhone || isLBName) return "LB";
  if (isNCPhone || isNCName) return "NC";
  if (!name && !phone) return "PN";
  // Tem nome/phone mas não reconhece (professor novo não cadastrado?) →
  // cai em "Professor não atribuído" (para não desaparecer da UI).
  return "PN";
}

// ====================================================================
// C. WEEKDAY HELPERS (inglês curto: sun / mon / tue / wed / thu / fri / sat)
// ====================================================================
export function weekdayFromLabel(label: string | null | undefined): "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | null {
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

export function weekdayShortIso(localDateYYYYMMDD: string): "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" {
  const [y, mo, d] = localDateYYYYMMDD.split("-").map((n) => Number(n));
  if (!y || !mo || !d) return "sun";
  const utc = Date.UTC(y, mo - 1, d, 12, 0, 0);
  const res = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(utc).toLowerCase();
  return (res as any) ?? "sun";
}

// ====================================================================
// D. TIME NORMALIZE (HH:MM:SS → HH:MM) — mesma regra em pbByTime e
//    slots extras no modal, e em badges quando precisar.
// ====================================================================
export function normalizeSlotHHMM(rawTime: string | null | undefined): string {
  const s = String(rawTime ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s.slice(0, 5);
  return `${String(Number(m[1])).padStart(2, "0")}:${String(Number(m[2])).padStart(2, "0")}`;
}

// ====================================================================
// E. RECORRENTE: converter created_at ISO → data local professor (yyyy-mm-dd)
// ====================================================================
export function recurringFirstLocalDate(
  createdAtIso: string | null | undefined,
  tzRaw: string | null | undefined,
): string | null {
  if (!createdAtIso) return null;
  const dt = new Date(createdAtIso);
  if (!Number.isFinite(dt.getTime())) return null;
  const tz = String(tzRaw ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dt);
  } catch {
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
}

// ====================================================================
// F. FLAT EXP → dedupId: usado nos dois endpoints.
//    Regra: SEMPRE use experimental_class_booking_id se presente, senão
//    fallback flat-exp-{lead_id}.
// ====================================================================
export function flatExpDedupId(
  leadId: string | null | undefined,
  bookingIdRaw: string | null | undefined,
): string {
  const bkId = String(bookingIdRaw ?? "").trim();
  if (bkId) return bkId;
  return `flat-exp-${String(leadId ?? "x").trim() || "x"}`;
}
