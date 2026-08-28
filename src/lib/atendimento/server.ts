import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ATENDIMENTO_DAILY_SUMMARY_PHONE, ATENDIMENTO_EMAIL, ATENDIMENTO_PUBLIC_LINK_SLUG, ATENDIMENTO_STAGE_ORDER, ATENDIMENTO_STATUS_ORDER, BOT_DEDICATED_EXCLUSIVE_PHONE_SUFFIXES_10, isDedicatedExclusiveBotPhone, isOwnerPersonalPrivatePhone } from "@/lib/atendimento/constants";
import {
  ATENDIMENTO_FILES_BUCKET,
  ATENDIMENTO_ALLOWED_UPLOAD_MIME_TYPES,
  buildAtendimentoStoragePath,
  getAtendimentoMediaTypeFromMimeType,
} from "@/lib/atendimento/files";
import { initialBotMessages } from "@/lib/atendimento/bot";
import {
  buildContractData,
  buildContractHtml,
  buildContractPdfBytes,
  buildContractFileName,
  formatLocalizedDateSigned,
} from "@/lib/atendimento/contract";
import {
  buildExperimentalClassAttendantStartReminderWhatsAppMessage,
  buildExperimentalClassRegisteredAttendantStartReminderWhatsAppMessage,
  buildExperimentalClassRegisteredAttendantWhatsAppMessage,
  buildExperimentalClassStudentLessonReadyWhatsAppMessage,
  buildRecurringClassAttendantStartReminderWhatsAppMessage,
  buildRecurringClassRegisteredAttendantStartReminderWhatsAppMessage,
  buildRecurringClassPostEnrollmentRegisteredAttendantNotification,
  buildRecurringClassStudentLessonReadyWhatsAppMessage,
  buildRecurringPaymentConfirmedStudentWelcomeMessage,
  buildRecurringPaymentPendingConfirmationAttendantNotification,
  calculateNextRecurringOccurrence,
  EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
  EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
  EXPERIMENTAL_CLASS_ATTENDANT_START_REMINDER_MINUTES,
  EXPERIMENTAL_CLASS_DEFAULT_STUDENT_DASHBOARD_LINK,
  getExperimentalClassInternalStaffPhoneNumbers,
  RECURRING_CLASS_ATTENDANT_START_REMINDER_MINUTES,
  RECURRING_WEEKDAY_LABELS_PT_BR,
  resolveExperimentalClassAssignedProfessorPhone,
  resolveRecurringClassAssignedProfessorPhone,
  type RecurringWeekdayKey,
} from "@/lib/atendimento/experimentalClass";
import { buildAtendimentoPublicUrl, isAtendimentoEmail, makeConversationSessionSlug, summarizePreview } from "@/lib/atendimento/utils";
import { isAtendimentoOnlyAccessScope, normalizeAccessScope } from "@/lib/auth/access";
import { zonedDateTimeToUtcIso } from "@/lib/timezone";

const ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE = "America/Cuiaba";
const ATENDIMENTO_DAILY_SUMMARY_LINK = "https://www.autobot.business/app/atendimento";
const ATENDIMENTO_DAILY_SUMMARY_TRIGGER_HOUR = 20;
export const ATENDIMENTO_PRESENCE_SESSION_TTL_MS = 45_000;

function buildDeterministicInitialBotMessageId(conversationId: string, contentText: string) {
  const hash = crypto
    .createHash("sha256")
    .update(`initial-bot:${String(conversationId).trim()}:${String(contentText).trim()}`)
    .digest("hex")
    .slice(0, 32)
    .split("");

  hash[12] = "5";
  hash[16] = ["8", "9", "a", "b"][parseInt(hash[16] ?? "0", 16) % 4] ?? "8";
  return `${hash.slice(0, 8).join("")}-${hash.slice(8, 12).join("")}-${hash.slice(12, 16).join("")}-${hash.slice(16, 20).join("")}-${hash.slice(20, 32).join("")}`;
}

function normalizePhone(phone: string) {
  const raw = String(phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return digits;
  if (digits.startsWith("55")) return digits;
  if (digits.startsWith("1") && digits.length === 11) return digits;
  if (digits.length === 11) return `55${digits}`;
  return digits;
}

function isValidWhatsAppUserPhone(digitsOnly: string): boolean {
  const d = String(digitsOnly ?? "").replace(/\D/g, "");
  if (!d) return false;
  if (!/^\d+$/.test(d)) return false;
  if (/^0+$/.test(d)) return false;
  if (d.length < 10) return false;
  // ======= GUARD ISOLADO NUMERO ESTRANHO 246342211350770 =======
  // MAXIMO MUNDIAL WHATSAPP: 14 digitos (ISO E.164 max 15, porem nosso pais BR=13, US=11,
  // paises grandes como IN=13, ID=14. Nunca aceitamos 15 que vira ID SUSPEITO / Message ID / Group ID).
  if (d.length > 14) return false;
  if (d.startsWith("0")) return false;
  if (d.startsWith("550")) return false;
  if (/^(\d)\1{9,}$/.test(d)) return false;
  if (/^123456789/.test(d)) return false;
  if (/^987654321/.test(d)) return false;
  // FIM GUARD ISOLADO ====================================================

  if (d.startsWith("55")) {
    if (d.length !== 12 && d.length !== 13) return false;
    const rest = d.slice(2);
    if (/^0+/.test(rest)) return false;
    const ddd = Number(rest.slice(0, 2));
    if (!Number.isFinite(ddd) || ddd < 11 || ddd > 99) return false;
    return true;
  }
  if (d.startsWith("1")) {
    if (d.length !== 11) return false;
    const npa = d.slice(1, 4);
    if (!/^[2-9]\d{2}$/.test(npa)) return false;
    return true;
  }
  // Internacional (nao BR, nao US):
  // Maximo 12 digitos (ex: UK=12, ES=11, DE=12, FR=11, IT=11, AR=12, etc)
  if (d.length > 12) return false;
  const firstDigit = Number(d[0]);
  if (!Number.isFinite(firstDigit) || firstDigit < 2) return false;
  // Lista country calling codes validos (primeiros 1 a 3 digitos)
  // https://en.wikipedia.org/wiki/List_of_country_calling_codes
  const validCountryCallingCodes = new Set([
    "2", "3", "4", "5", "6", "7", "8", "9", // fallback (qualquer 1 digito 2-9)
  ]);
  if (!validCountryCallingCodes.has(d[0])) return false;
  // Rejeita explicitamente codigos suspeitos (geralmente +246 Diego Garcia / BIOT nao tem WhatsApp comercial)
  // e qualquer outro que sabemos que nao fazem parte do fluxo do SaaS.
  if (d.startsWith("246")) return false;
  if (d.startsWith("247")) return false;
  if (d.startsWith("248")) return false;
  if (d.startsWith("269")) return false;
  if (d.startsWith("268")) return false;
  if (d.startsWith("264")) return false;
  if (d.startsWith("500")) return false;
  if (d.startsWith("599")) return false;
  if (d.startsWith("672")) return false;
  if (d.startsWith("683")) return false;
  if (d.startsWith("690")) return false;
  if (d.startsWith("881")) return false;
  if (d.startsWith("882")) return false;
  if (d.startsWith("883")) return false;
  return true;
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
  const cacheKey = "__autobot_whatsapp_instance_blocklist_cache";
  const globalAny = globalThis as any;
  const now = Date.now();
  if (globalAny[cacheKey] && globalAny[cacheKey].value && (now - globalAny[cacheKey].updatedAtMs) < 30_000) {
    return globalAny[cacheKey].value as Set<string>;
  }
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
      "556581175345",
    ];
    for (const p of envPhones) {
      const norm = normalizePhoneDigitsOnly(p);
      if (norm) set.add(norm);
    }
    globalAny[cacheKey] = { value: set, updatedAtMs: now };
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

function phoneMatches(stored: string | null | undefined, search: string): boolean {
  const s = normalizePhoneDigitsOnly(stored);
  if (!s) return false;
  return s === search;
}

function getLeadFirstName(name: string | null | undefined) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[0] ?? "Aluno";
}

function getLeadFullName(name: string | null | undefined) {
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  return clean || getLeadFirstName(name);
}

function localDateInTimeZone(value: Date | string | number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysToLocalDate(localDate: string, days: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function localTimePartsInTimeZone(value: Date | string | number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    hour: Number(map.hour ?? 0),
    minute: Number(map.minute ?? 0),
  };
}

function buildAtendimentoDailySummaryMessage(leadsCount: number) {
  return `Resumo diário de interessados – AutoBot

Hoje entraram ${leadsCount} novos interessados na fila de atendimento.`;
}

function isExperimentalClassBookingsTableUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .*atendimento_experimental_class_bookings.*does not exist/i.test(message) ||
    /could not find the table .*atendimento_experimental_class_bookings.* in the schema cache/i.test(message)
  );
}

function isExperimentalClassBookingsLessonLinkColumnUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /column .*lesson_link.* does not exist/i.test(message) ||
    /could not find the 'lesson_link' column of 'atendimento_experimental_class_bookings' in the schema cache/i.test(
      message,
    )
  );
}

export function detectLenientYesNo(rawText: string | null | undefined): {
  result: "yes" | "no" | "ambiguous";
  yesScore: number;
  noScore: number;
} {
  const text = String(rawText ?? "").trim();
  if (!text) return { result: "ambiguous", yesScore: 0, noScore: 0 };
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  let yesScore = 0;
  let noScore = 0;

  const stripEmojisPunctuation = normalized
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = stripEmojisPunctuation.split(/\s+/).filter(Boolean);

  for (const tok of tokens) {
    if (tok === "sim" || tok === "s") yesScore += 100;
    else if (/^ss+$/.test(tok)) yesScore += 90;
    else if (/^claro$|^claramente$|^certamente$|^exato$|^exatamente$|^comcerteza$|^isso$|^isto$/.test(tok))
      yesScore += 55;
    else if (/^concordo$|^concordar$|^confirmo$|^confirmar$|^confirmada$|^confirmado$|^confirmou$/.test(tok))
      yesScore += 55;
    else if (/^ok$|^okay$|^oke$|^okey$|^beleza$|^blz$|^show$|^perfeito$|^top$|^boa$|^bom$|^positivo$/.test(tok))
      yesScore += 40;
    // NOTE: "pode", "quero", "continuar", "seguir", "avancar", "desejo" NAO sao
    // tokens SIM isolados (evita enviesar "pode cancelar" como SIM).
    // Eles so contam em frases compostas (ver regexes abaixo, ex: "sim quero continuar").

    if (tok === "nao" || tok === "n") noScore += 100;
    else if (/^no+$/.test(tok) && tok.length <= 5) noScore += 95;
    else if (/^nah+$/.test(tok)) noScore += 80;
    else if (/^negativo$|^naoquero$|^nao_quero$|^cancelar$|^cancela$|^cancelado$|^cancelada$/.test(tok))
      noScore += 90;
    else if (
      /^recuso$|^recusar$|^recusa$|^rejeito$|^rejeitar$|^rejeita$|^desistir$|^desisto$|^parar$|^parou$/.test(tok)
    )
      noScore += 90;
    else if (/^acho$|^talvez$|^provavelmentenao$|^provavelmente_nao$/.test(tok))
      noScore += 45;
    // Obrigado/a sozinho nao eh NÃO (evita enviesar "sim, obrigado").
    // Mas NÃO pesa em NÃO se aparecer JUNTO (ver regexes de frase).
  }

  if (/claro que sim|com certeza sim|pode sim|sim pode|sim quero|sim quero continuar|sim continuar|sim confirmo|confirmo sim|quero sim|desejo sim|concordo sim|ok sim|beleza sim|vamos sim|claro sim/.test(stripEmojisPunctuation)) {
    yesScore += 180;
  }
  if (/sim.{0,8}(quero|pode|seguir|avancar|continuar|confirmar|concordo|beleza|perfeito)/.test(stripEmojisPunctuation)) {
    yesScore += 100;
  }
  if (/(quero|vamos|desejo|prefiro|queria).{0,10}sim/.test(stripEmojisPunctuation)) yesScore += 90;

  if (/acho que nao|talvez nao|melhor nao|pode cancelar|cancela por favor|cancelar por favor|nao quero|nao desejo|nao obrigado|nao obrigada|nao quero continuar|nao continuar|nao confirmo|nao concordo|nao pode|nao,.{0,10}nao/.test(stripEmojisPunctuation)) {
    noScore += 180;
  }
  if (/nao.{0,10}(quero|desejo|gosto|pode|queremos|desejamos|confirmo|concordo|continuar|avancar|seguir|matricular|matricula)/.test(stripEmojisPunctuation)) {
    noScore += 100;
  }
  if (/(cancelar|cancela|cancelado|cancelada|parar|desisto|recuso|rejeito).{0,25}(por favor|pf|obrigado|obrigada|valeu|tchau|ate logo|abraço|abracos)?$/.test(stripEmojisPunctuation)) {
    noScore += 110;
  }
  if (/(obrigado|obrigada|valeu|agradecido).{0,25}$/.test(stripEmojisPunctuation)) {
    // Frase curta termina com obrigado e nao possui token SIM → peso leve NÃO (tipo "nao, obrigado" ou so "obrigado" apos nao perguntado)
    if (yesScore < 100) {
      noScore += 25;
    }
  }

  if (/^nao\b/.test(normalized) && /\bsim\b/.test(normalized) && noScore > 0 && yesScore > 0) {
    noScore += 20;
  } else if (/\bsim\b/.test(normalized) && /\bnao\b/.test(normalized) && yesScore > 0 && noScore > 0) {
    yesScore += 20;
  }

  // THRESHOLDS MENOS RIGIDOS (ajuste isolated):
  // Antes: min 60 pts + diferenca >= 40
  // Agora: min 50 pts + diferenca >= 25 (aceita frases mais naturais sem ambiguous)
  if (yesScore >= 50 && yesScore - noScore >= 25) return { result: "yes", yesScore, noScore };
  if (noScore >= 50 && noScore - yesScore >= 25) return { result: "no", yesScore, noScore };

  const simpleYes = /(^|[^a-z])sim([^a-z]|$)/.test(stripEmojisPunctuation);
  const simpleNo = /(^|[^a-z])nao([^a-z]|$)/.test(stripEmojisPunctuation);
  if (simpleYes && !simpleNo) return { result: "yes", yesScore: yesScore + 100, noScore };
  if (simpleNo && !simpleYes) return { result: "no", yesScore, noScore: noScore + 100 };

  return { result: "ambiguous", yesScore, noScore };
}

function isExperimentalClassBookingsNotificationSentColumnsUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42P01" ||
    /column .*(student_start_notification_sent_at|attendant_start_notification_sent_at|attendance_status|attendance_checked_at).* does not exist/i.test(
      message,
    ) ||
    /could not find the '(student_start_notification_sent_at|attendant_start_notification_sent_at|attendance_status|attendance_checked_at)' column of 'atendimento_experimental_class_bookings' in the schema cache/i.test(
      message,
    )
  );
}

async function countAtendimentoDailyExperimentalClassBookings(params: {
  rangeStartIso: string;
  rangeEndIso: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("atendimento_leads")
    .select("id")
    .gte("created_at", params.rangeStartIso)
    .lt("created_at", params.rangeEndIso);

  if (error) {
    const code = String((error as any)?.code ?? "").trim();
    const message = String((error as any)?.message ?? "");
    if (
      code === "42P01" ||
      /relation .*atendimento_leads.* does not exist/i.test(message)
    ) {
      return 0;
    }
    throw new Error(error.message || "Falha ao contar novos interessados do dia para o resumo diario.");
  }

  const uniqueIds = new Set<string>();
  for (const row of (data ?? []) as any[]) {
    const id = String(row?.id ?? "").trim();
    if (id) uniqueIds.add(id);
  }
  return uniqueIds.size;
}

/** @deprecated Notificacao offline de nova mensagem DESATIVADA por pedido do usuario (nao enviar mais). Funcao mantida apenas para compilacao, retorna string vazia. */
export function buildAtendimentoConversationPublicUrl(_publicSlug: string) {
  return ``;
}

/** @deprecated Notificacao offline de nova mensagem DESATIVADA por pedido do usuario (nao enviar mais). Funcao mantida apenas para compilacao, retorna string vazia. */
export function buildOfflineAttendantNotificationMessage(_params: {
  leadName?: string | null;
  publicSlug: string;
}) {
  return ``;
}

function buildAuthorizedZapiWebhookUrl(baseUrl: string) {
  const webhookUrl = new URL(`${baseUrl}/api/webhooks/zapi`);
  const secret = String(process.env.ZAPI_WEBHOOK_SECRET ?? "").trim();
  if (secret) {
    webhookUrl.searchParams.set("secret", secret);
  }
  return webhookUrl.toString();
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

  const internalNotificationPhones = new Set(
    getExperimentalClassInternalStaffPhoneNumbers().map((value) =>
      normalizePhoneDigitsOnly(value),
    ),
  );
  const destDigits = normalizePhoneDigitsOnly(normalizedPhone);
  const isInternalNotificationPhone = destDigits && internalNotificationPhones.has(destDigits);

  let bypassAllowedPhoneDigitsSet: Set<string> | null = null;
  try {
    const admin = createSupabaseAdminClient();
    const bypassRaw = await admin
      .from("atendimento_leads")
      .select("phone")
      .not("phone", "is", null)
      .limit(5000);
    if (!bypassRaw.error && Array.isArray(bypassRaw.data)) {
      bypassAllowedPhoneDigitsSet = new Set<string>();
      for (const r of bypassRaw.data as any[]) {
        const d = normalizePhoneDigitsOnly(String((r as any)?.phone ?? ""));
        if (d) bypassAllowedPhoneDigitsSet.add(d);
      }
    }
  } catch (_e) {
    bypassAllowedPhoneDigitsSet = null;
  }
  const destIsRegisteredLead =
    destDigits && Boolean(bypassAllowedPhoneDigitsSet) && bypassAllowedPhoneDigitsSet!.has(destDigits);

  const { self_instance_phone_digits_only: selfPhoneOpt } = params;
  if (!isInternalNotificationPhone && !destIsRegisteredLead && destinationIsInstancePhone(normalizedPhone, null, selfPhoneOpt ?? null)) {
    return {
      ok: false,
      skipped: true,
      reason: "self_instance_phone_refused_to_prevent_infinite_loop_at_low_level_sendZapiText",
      phone: normalizePhoneDigitsOnly(normalizedPhone),
    } as any;
  }

  if (!isInternalNotificationPhone && !destIsRegisteredLead) {
    const runtimeBlocklist = await loadAllInstancePhoneBlocklist();
    if (destinationIsInstancePhone(normalizedPhone, runtimeBlocklist, selfPhoneOpt ?? null)) {
      return {
        ok: false,
        skipped: true,
        reason: "self_instance_phone_refused_blocklist_matched_whatsapp_instances",
        phone: normalizePhoneDigitsOnly(normalizedPhone),
      } as any;
    }
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

export async function getZapiInstanceMeta(params: {
  instance_id: string;
  token: string;
  client_token?: string | null;
}): Promise<{
  ok: boolean;
  httpStatus: number;
  data: any;
}> {
  let response: Response | null = null;
  try {
    response = await fetch(
      `https://api.z-api.io/instances/${encodeURIComponent(params.instance_id)}/token/${encodeURIComponent(params.token)}/me`,
      {
        method: "GET",
        headers: {
          ...(params.client_token ? { "Client-Token": params.client_token } : {}),
        },
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, httpStatus: response.status, data };
    }
    return { ok: true, httpStatus: response.status, data };
  } catch (err) {
    const httpStatus = response?.status ?? 0;
    const data = response ? await response.json().catch(() => null) : null;
    return { ok: false, httpStatus, data: data ?? String((err as any)?.message ?? "") };
  }
}

export function isZapiResponseActuallyConnected(meData: unknown): {
  connected: boolean;
  explicitDisconnect: boolean;
} {
  if (!meData || typeof meData !== "object") {
    return { connected: false, explicitDisconnect: false };
  }
  const d = meData as Record<string, unknown>;
  const scanKeys = [
    d,
    (d as any).whatsapp ?? null,
    (d as any).me ?? null,
    (d as any).data ?? null,
    (d as any).body ?? null,
    (d as any).response ?? null,
  ];
  const allChunks: string[] = [];
  for (const node of scanKeys) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    const vals = [
      String(n.status ?? ""),
      String(n.state ?? ""),
      String(n.connectionStatus ?? ""),
      String(n.connected ?? ""),
      String(n.authenticated ?? ""),
      String(n.online ?? ""),
      String(n.disconnected ?? ""),
    ];
    for (const v of vals) allChunks.push(String(v ?? "").toLowerCase());
    const objStr = String(JSON.stringify(node ?? {})).toLowerCase();
    allChunks.push(objStr);
  }
  const union = allChunks.join(" ");
  const explicitDisconnect =
    /\bdisconnected\b|\bdesconectado\b|\boffline\b|\bclosed\b|\bsession.*closed\b|\bsession.*expired\b|\bsession.*invalid\b|\binvalid.*session\b|\bexpired\b|\bsession_disconnected\b|\bsession.*logout\b|\blogout\b|\bnot.?connected\b|\bsem.?conexao\b|\bsem.?conexão\b/.test(
      union,
    );
  if (explicitDisconnect) return { connected: false, explicitDisconnect: true };
  const explicitConnect =
    /\bconnected\b|\bconectado\b|\bonline\b|\bopen\b|\bactive\b|\bconnected_number\b|\bauthenticated\b|\bsession.*ok\b|\bsuccess\b|\btrue\b/.test(
      union,
    );
  const phonePieces = [
    d.phone,
    d.telephone,
    d.id,
    (d as any).whatsapp?.phone,
    (d as any).whatsapp?.id,
    (d as any).me?.phone,
    (d as any).me?.id,
    (d as any).connectedNumber,
    (d as any).connected_number,
    (d as any).idInstance,
    (d as any).id_instance,
    (d as any).data?.phone,
    (d as any).data?.telephone,
    (d as any).data?.id,
    (d as any).response?.phone,
    (d as any).response?.telephone,
    (d as any).remoteJid,
    (d as any).wid,
  ];
  let hasAnyPhone = false;
  for (const raw of phonePieces) {
    if (!raw) continue;
    const s = typeof raw === "number" ? String(raw) : String(raw ?? "");
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) {
      hasAnyPhone = true;
      break;
    }
  }
  return {
    connected: explicitConnect || hasAnyPhone,
    explicitDisconnect: false,
  };
}

export async function refreshOneWhatsAppInstanceStatusLive(params: {
  supabase: any;
  row: {
    user_id?: string | null;
    instance_id?: string | null;
    token?: string | null;
    client_token?: string | null;
    status?: string | null;
  };
  filterMode?: "by_instance_id" | "by_user_id";
  stickyConnected?: boolean;
}): Promise<"connected" | "disconnected" | null> {
  const mode = params.filterMode ?? (params.row.instance_id ? "by_instance_id" : "by_user_id");
  const instanceId = String(params.row.instance_id ?? "").trim();
  const token = String(params.row.token ?? "").trim();
  const userId = String(params.row.user_id ?? "").trim();
  const prevStatus = (String(params.row.status ?? "").trim() as any) || null;
  if ((!instanceId || !token)) {
    return prevStatus;
  }
  let result: { connected: boolean; explicitDisconnect: boolean } | null = null;
  let fetchOk = false;
  let httpStatus: number | null = null;
  let explicitDisconnectSignal = false;
  try {
    const meta = await getZapiInstanceMeta({
      instance_id: instanceId,
      token,
      client_token: params.row.client_token ?? undefined,
    });
    httpStatus = meta.httpStatus;
    fetchOk = meta.ok;
    if (meta.ok) {
      result = isZapiResponseActuallyConnected(meta.data);
      explicitDisconnectSignal = result.explicitDisconnect;
    } else {
      explicitDisconnectSignal = true;
      result = { connected: false, explicitDisconnect: true };
    }
  } catch (_err) {
    fetchOk = false;
    result = { connected: false, explicitDisconnect: false };
  }

  const sticky = Boolean(params.stickyConnected);
  let nextStatus: "connected" | "disconnected" | null = prevStatus;

  if (fetchOk && result) {
    if (result.connected) {
      nextStatus = "connected";
    } else if (explicitDisconnectSignal || result.explicitDisconnect) {
      nextStatus = "disconnected";
    } else {
      if (sticky && prevStatus === "connected") {
        nextStatus = "connected";
      } else {
        nextStatus = prevStatus === "connected" ? "connected" : "disconnected";
      }
    }
  } else {
    const httpStatusSafe: number = httpStatus ?? 0;
    if (explicitDisconnectSignal && (httpStatusSafe === 0 || httpStatusSafe >= 400)) {
      nextStatus = "disconnected";
    } else if (result?.explicitDisconnect) {
      nextStatus = "disconnected";
    } else if (sticky && prevStatus === "connected" && !explicitDisconnectSignal && httpStatusSafe < 400) {
      nextStatus = "connected";
    } else if (!sticky) {
      nextStatus = prevStatus ?? "disconnected";
    } else if (prevStatus === "connected") {
      if (httpStatusSafe === 0 || httpStatusSafe >= 500 || httpStatusSafe === 404 || httpStatusSafe === 401 || httpStatusSafe === 403) {
        nextStatus = "disconnected";
      } else {
        nextStatus = "connected";
      }
    } else {
      nextStatus = prevStatus ?? "disconnected";
    }
  }

  try {
    const q = params.supabase
      .from("whatsapp_instances")
      .update({ status: nextStatus });
    if (mode === "by_instance_id") {
      await q.eq("instance_id", instanceId);
    } else if (userId) {
      await q.eq("user_id", userId);
    } else {
      await q.eq("instance_id", instanceId);
    }
  } catch {}
  return nextStatus;
}

async function updateZapiWebhook(params: {
  instance_id: string;
  token: string;
  client_token?: string | null;
  endpoint: string;
  value: string;
  extraBody?: Record<string, unknown>;
}) {
  const response = await fetch(
    `https://api.z-api.io/instances/${encodeURIComponent(params.instance_id)}/token/${encodeURIComponent(params.token)}/${params.endpoint}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(params.client_token ? { "Client-Token": params.client_token } : {}),
      },
      body: JSON.stringify({
        value: params.value,
        ...(params.extraBody ?? {}),
      }),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Falha ao configurar webhook ${params.endpoint}: ${response.status} ${JSON.stringify(data) ?? ""}`.trim(),
    );
  }
  return data;
}

async function getAtendimentoWhatsAppConfig() {
  const cacheKey = "__autobot_atendimento_wa_config_cache";
  const globalAny = globalThis as any;
  const now = Date.now();
  if (globalAny[cacheKey] && globalAny[cacheKey].value && (now - globalAny[cacheKey].updatedAtMs) < 60_000) {
    return globalAny[cacheKey].value as Awaited<ReturnType<typeof getAtendimentoWhatsAppConfig>>;
  }
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, email")
    .ilike("email", ATENDIMENTO_EMAIL)
    .maybeSingle();

  const userId = String((profile as any)?.user_id ?? "").trim();
  if (!userId) {
    return null;
  }

  const { data: wa } = await admin
    .from("whatsapp_instances")
    .select("instance_id, token, client_token, status, phone")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const canSend =
    Boolean((wa as any)?.instance_id) &&
    Boolean((wa as any)?.token);

  if (!canSend) {
    return null;
  }

  const config = {
    instance_id: String((wa as any).instance_id),
    token: String((wa as any).token),
    client_token: String((wa as any)?.client_token ?? "").trim() || null,
    instance_phone_digits_only: normalizePhoneDigitsOnly(String((wa as any)?.phone ?? "")),
  };
  globalAny[cacheKey] = { value: config, updatedAtMs: now };
  return config;
}

const __autobotWebhookRefreshCache: { lastUrl: string | null; lastAtMs: number } = {
  lastUrl: null,
  lastAtMs: 0,
};

export async function sendAtendimentoWhatsAppText(params: {
  phone: string;
  message: string;
  baseUrl?: string | null;
}) {
  const config = await getAtendimentoWhatsAppConfig();
  if (!config) {
    throw new Error("WhatsApp do atendimento não configurado.");
  }

  const normalizedDest = normalizePhoneDigitsOnly(params.phone);
  const internalNotificationPhones = new Set(
    getExperimentalClassInternalStaffPhoneNumbers().map((value) =>
      normalizePhoneDigitsOnly(value),
    ),
  );

  if (normalizedDest && !internalNotificationPhones.has(normalizedDest)) {
    const instancePhoneDigits = normalizePhoneDigitsOnly(String(config.instance_phone_digits_only ?? ""));
    if (instancePhoneDigits && areBrazilianPhonesEquivalent(normalizedDest, instancePhoneDigits)) {
      return {
        ok: false,
        skipped: true,
        reason: "self_instance_phone_refused_to_prevent_infinite_loop_equivalent_br",
        phone: normalizedDest,
      };
    }
    const allInstanceBlocklist = await loadAllInstancePhoneBlocklist();
    if (destinationIsInstancePhone(normalizedDest, allInstanceBlocklist, null)) {
      return {
        ok: false,
        skipped: true,
        reason: "self_instance_phone_refused_blocklist_matched_whatsapp_instances",
        phone: normalizedDest,
      };
    }
  }

  let resolvedConversationIdForDedupe: string | null = null;

  if (normalizedDest && !internalNotificationPhones.has(normalizedDest)) {
    const admin = createSupabaseAdminClient();
    const { data: leadRow } = await admin
      .from("atendimento_leads")
      .select("id")
      .ilike("phone", `%${normalizedDest}%`)
      .limit(1)
      .maybeSingle();

    if (leadRow?.id) {
      const { data: conv } = await admin
        .from("atendimento_conversations")
        .select("id")
        .eq("lead_id", String((leadRow as any).id))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const conversationId = String((conv as any)?.id ?? "").trim();

      if (!conversationId) {
        return {
          ok: false,
          skipped: true,
          reason: "no_conversation_found_for_lead",
          phone: normalizedDest,
        };
      }

      resolvedConversationIdForDedupe = conversationId;

      const { count: inboundCount } = await admin
        .from("atendimento_messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversationId)
        .eq("sender_role", "lead");

      if (Number(inboundCount ?? 0) <= 0) {
        return {
          ok: false,
          skipped: true,
          reason: "no_prior_inbound_message_from_lead",
          phone: normalizedDest,
        };
      }

      const messageText = String(params.message ?? "").trim();
      if (messageText) {
        const dedupeWindowStartUtc = new Date(Date.now() - 60 * 60_000).toISOString();
        const dedupeGraceEndUtc = new Date(Date.now() - 15_000).toISOString();
        try {
          const { count: duplicates } = await admin
            .from("atendimento_messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", conversationId)
            .eq("sender_role", "bot")
            .eq("content_text", messageText)
            .gte("sent_at", dedupeWindowStartUtc)
            .lte("sent_at", dedupeGraceEndUtc)
            .limit(1);
          if (Number(duplicates ?? 0) > 0) {
            return {
              ok: false,
              skipped: true,
              reason: "duplicate_bot_message_within_60min_window",
              phone: normalizedDest,
              conversationId,
            };
          }
        } catch (_e) {}
      }
    } else {
      return {
        ok: false,
        skipped: true,
        reason: "unknown_lead_no_prior_inbound",
        phone: normalizedDest,
      };
    }
  }

  const baseUrl = String(params.baseUrl ?? "").trim().replace(/\/$/, "");
  const now = Date.now();
  if (baseUrl) {
    const webhookUrl = buildAuthorizedZapiWebhookUrl(baseUrl);
    if (webhookUrl !== __autobotWebhookRefreshCache.lastUrl || (now - __autobotWebhookRefreshCache.lastAtMs) > 15 * 60_000) {
      __autobotWebhookRefreshCache.lastUrl = webhookUrl;
      __autobotWebhookRefreshCache.lastAtMs = now;
      updateZapiWebhook({
        instance_id: config.instance_id,
        token: config.token,
        client_token: config.client_token,
        endpoint: "update-every-webhooks",
        value: webhookUrl,
        extraBody: { notifySentByMe: true },
      }).catch(() => {});
    }
  }

  const result = await sendZapiText({
    instance_id: config.instance_id,
    token: config.token,
    client_token: config.client_token,
    phone: params.phone,
    message: params.message,
    self_instance_phone_digits_only: String(config.instance_phone_digits_only ?? "").trim() || null,
  });

  return result;
}

export async function sendAtendimentoWhatsAppTextBatch(params: {
  phone: string;
  messages: string[];
  baseUrl?: string | null;
  admin?: any;
  conversationId?: string | null;
  insertIntoConversation?: boolean;
}) {
  const { phone, messages, baseUrl, admin, conversationId, insertIntoConversation = Boolean(admin && conversationId) } = params;
  const safeMessages = (messages ?? []).filter((msg) => typeof msg === "string" && msg.trim().length > 0);
  if (!safeMessages.length) return { results: [], insertedRows: [] };

  const sends = safeMessages.map(async (message) => {
    try {
      const r = await sendAtendimentoWhatsAppText({ phone, message, baseUrl });
      return { ok: true, message, result: r };
    } catch (e) {
      return { ok: false, message, error: String((e as any)?.message ?? "") };
    }
  });

  const insertPromise = (() => {
    if (!insertIntoConversation || !admin || !conversationId) return Promise.resolve([] as any[]);
    return Promise.allSettled(
      safeMessages.map((contentText) =>
        admin
          .from("atendimento_messages")
          .insert({
            conversation_id: conversationId,
            sender_role: "bot",
            content_text: contentText,
            media_type: "text",
            status: "entregue",
            sent_at: new Date().toISOString(),
            delivered_at: new Date().toISOString(),
          })
          .select("*")
          .maybeSingle(),
      ),
    ).then((outs) =>
      outs
        .map((o, idx) => {
          if (o.status !== "fulfilled") return null;
          const v: any = o.value;
          return { index: idx, row: (v?.data ?? null) as Record<string, unknown> | null, error: v?.error ?? null };
        })
        .filter(Boolean) as Array<{ index: number; row: Record<string, unknown> | null; error: any }>,
    );
  })();

  const [results, insertedRows] = await Promise.all([Promise.allSettled(sends).then((out) =>
    out.map((o) => {
      if (o.status !== "fulfilled") return { ok: false, message: "", error: String(o.reason ?? "settled_rejected") };
      return o.value;
    }),
  ), insertPromise]);

  return {
    results,
    insertedRows,
  };
}

export async function sendAtendimentoDailyLeadSummary(now = new Date()) {
  const admin = createSupabaseAdminClient();
  const nowIso = now.toISOString();
  const summaryDate = localDateInTimeZone(now, ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE);
  const localTime = localTimePartsInTimeZone(now, ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE);
  if (localTime.hour < ATENDIMENTO_DAILY_SUMMARY_TRIGGER_HOUR) {
    return {
      ok: true as const,
      skipped: true as const,
      reason: "before_trigger_time",
      summaryDate,
      leadsCount: null,
    };
  }

  const nextSummaryDate = addDaysToLocalDate(summaryDate, 1);
  const rangeStartIso = zonedDateTimeToUtcIso({
    date: summaryDate,
    time: "00:00",
    timeZone: ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE,
  });
  const rangeEndIso = zonedDateTimeToUtcIso({
    date: nextSummaryDate,
    time: "00:00",
    timeZone: ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE,
  });

  const { data: existingRun, error: existingRunError } = await admin
    .from("atendimento_daily_summary_runs")
    .select("summary_date, sent_at, attempt_count, leads_count")
    .eq("summary_date", summaryDate)
    .maybeSingle();

  if (existingRunError) {
    throw new Error(existingRunError.message || "Falha ao consultar o resumo diario do atendimento.");
  }

  const previousLeadsCount = Number((existingRun as any)?.leads_count ?? 0) || 0;
  const previousSentAt = existingRun?.sent_at ? String(existingRun.sent_at).trim() : null;
  const previousSentWithZero = previousSentAt && previousLeadsCount <= 0;

  if (previousSentAt && !previousSentWithZero) {
    return {
      ok: true as const,
      skipped: true as const,
      reason: "already_sent",
      summaryDate,
      leadsCount: previousLeadsCount || null,
    };
  }

  const nextAttemptCount = Number((existingRun as any)?.attempt_count ?? 0) + 1;
  const leasePayload: Record<string, unknown> = {
    summary_date: summaryDate,
    timezone: ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE,
    sent_at: null,
    last_attempt_at: nowIso,
    attempt_count: nextAttemptCount,
    last_error: null,
    leads_count: existingRun && !previousSentWithZero ? (existingRun as any).leads_count ?? null : null,
  };

  if (existingRun?.summary_date) {
    const matchFilter = previousSentWithZero
      ? admin.from("atendimento_daily_summary_runs").update(leasePayload).eq("summary_date", summaryDate).eq("sent_at", previousSentAt as string)
      : admin.from("atendimento_daily_summary_runs").update(leasePayload).eq("summary_date", summaryDate).is("sent_at", null);
    const { error: updateLeaseError } = await matchFilter;
    if (updateLeaseError) {
      throw new Error(updateLeaseError.message || "Falha ao atualizar a tentativa do resumo diario do atendimento.");
    }
  } else {
    const { error: insertLeaseError } = await admin.from("atendimento_daily_summary_runs").insert(leasePayload);
    if (insertLeaseError) {
      const code = String((insertLeaseError as any)?.code ?? "").trim();
      if (code === "23505") {
        return {
          ok: true as const,
          skipped: true as const,
          reason: "already_reserved",
          summaryDate,
          leadsCount: null,
        };
      }
      throw new Error(insertLeaseError.message || "Falha ao reservar o resumo diario do atendimento.");
    }
  }

  let leadsCount = 0;
  try {
    leadsCount = await countAtendimentoDailyExperimentalClassBookings({
      rangeStartIso,
      rangeEndIso,
    });
  } catch (error) {
    await admin
      .from("atendimento_daily_summary_runs")
      .update({
        last_attempt_at: nowIso,
        last_error: error instanceof Error ? error.message : String(error),
      })
      .eq("summary_date", summaryDate);
    throw error;
  }

  if (leadsCount <= 0) {
    try {
      await admin
        .from("atendimento_daily_summary_runs")
        .update({
          last_attempt_at: nowIso,
          last_error: "skip_zero_leads_do_not_notify",
          attempt_count: nextAttemptCount,
        })
        .eq("summary_date", summaryDate);
    } catch {}
    return {
      ok: true as const,
      skipped: true as const,
      reason: "zero_leads_skip_send",
      summaryDate,
      leadsCount: 0,
    };
  }

  try {
    await sendAtendimentoWhatsAppText({
      phone: ATENDIMENTO_DAILY_SUMMARY_PHONE,
      message: buildAtendimentoDailySummaryMessage(leadsCount),
    });

    await admin
      .from("atendimento_daily_summary_runs")
      .update({
        leads_count: leadsCount,
        sent_at: new Date().toISOString(),
        last_attempt_at: nowIso,
        last_error: null,
      })
      .eq("summary_date", summaryDate);

    return { ok: true as const, skipped: false as const, summaryDate, leadsCount };
  } catch (error) {
    await admin
      .from("atendimento_daily_summary_runs")
      .update({
        last_attempt_at: nowIso,
        last_error: error instanceof Error ? error.message : String(error),
      })
      .eq("summary_date", summaryDate);
    throw error;
  }
}

export async function sendExperimentalClassStartNotifications(now = new Date()) {
  const admin = createSupabaseAdminClient();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const lookbackMinutes = 60 * 72; // 3 dias - recupera disparos perdidos em deploy/erros
  const forwardMinutes = 720;
  const candidateWindowStartIso = new Date(nowMs - lookbackMinutes * 60_000).toISOString();
  const candidateWindowEndIso = new Date(nowMs + forwardMinutes * 60_000).toISOString();
  const PROF_TZ = (
    process.env.EXPERIMENTAL_CLASS_PROFESSOR_TIME_ZONE ||
    process.env.ATENDIMENTO_PROFESSOR_TIME_ZONE ||
    "America/Sao_Paulo"
  ).trim();

  const bookingsByLeadId = new Map<string, any>();
  const cancelledLeadBookingIds = new Set<string>();
  const cancelledByHistoryLeadIds = new Set<string>();
  const sentStudentBookingIds = new Set<string>();
  const sentAttendantBookingIds = new Set<string>();
  const sentRegisteredAttendantBookingIds = new Set<string>();
  const latestLessonLinkByLeadId = new Map<string, string | null>();

  // Step 1: Tabela real de bookings
  {
    const bookingsSelectWithLessonLink =
      "id, lead_id, conversation_id, status, lesson_link, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, student_start_notification_sent_at, attendant_start_notification_sent_at, attendance_status, attendance_checked_at, created_at, updated_at";
    const bookingsSelectWithoutLessonLink =
      "id, lead_id, conversation_id, status, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, student_start_notification_sent_at, attendant_start_notification_sent_at, attendance_status, attendance_checked_at, created_at, updated_at";

    let data: any[] | null = null;
    try {
      const r1 = await admin
        .from("atendimento_experimental_class_bookings")
        .select(bookingsSelectWithLessonLink)
        .eq("status", "scheduled")
        .gte("professor_start_at", candidateWindowStartIso)
        .lte("professor_start_at", candidateWindowEndIso)
        .order("professor_start_at", { ascending: true });
      if (r1.error && isExperimentalClassBookingsLessonLinkColumnUnavailable(r1.error)) {
        const r2 = await admin
          .from("atendimento_experimental_class_bookings")
          .select(bookingsSelectWithoutLessonLink)
          .eq("status", "scheduled")
          .gte("professor_start_at", candidateWindowStartIso)
          .lte("professor_start_at", candidateWindowEndIso)
          .order("professor_start_at", { ascending: true });
        if (!r2.error) data = r2.data as any[];
      } else if (!r1.error) {
        data = r1.data as any[];
      }
    } catch (_e) {
      data = null;
    }

    for (const booking of (data ?? []) as any[]) {
      const leadId = String(booking?.lead_id ?? "").trim();
      const status = String(booking?.status ?? "").trim().toLowerCase();
      if (!leadId) continue;
      if (status === "cancelled") {
        cancelledLeadBookingIds.add(leadId);
        continue;
      }
      if (status !== "scheduled") continue;
      if (bookingsByLeadId.has(leadId)) continue;
      bookingsByLeadId.set(leadId, {
        ...booking,
        source: "table",
      });
    }
  }

  // Step 2: Leads com experimental_class_professor_start_at na janela (agendamentos feitos no painel manual sem tabela bookings)
  const extraLeadIds: string[] = [];
  try {
    const leadsQ = await admin
      .from("atendimento_leads")
      .select("id, full_name, phone, status, funnel_stage, experimental_class_professor_date, experimental_class_lead_date, experimental_class_professor_time, experimental_class_lead_time, experimental_class_professor_start_at, experimental_class_lead_start_at, cpf, city, state, country, timezone, origin")
      .gte("experimental_class_professor_start_at", candidateWindowStartIso)
      .lte("experimental_class_professor_start_at", candidateWindowEndIso);
    if (!leadsQ.error && Array.isArray(leadsQ.data)) {
      for (const row of (leadsQ.data as any[])) {
        const id = String(row?.id ?? "").trim();
        if (!id) continue;
        extraLeadIds.push(id);
      }
    }
  } catch (_e) {}

  // Step 3: Todos os leadIds para buscar no history / detalhes completos
  const allLeadIds = Array.from(new Set<string>([...Array.from(bookingsByLeadId.keys()), ...extraLeadIds]));

  let fullLeads: any[] = [];
  if (allLeadIds.length > 0) {
    try {
      const r = await admin
        .from("atendimento_leads")
        .select("id, full_name, phone, status, funnel_stage, experimental_class_professor_date, experimental_class_lead_date, experimental_class_professor_time, experimental_class_lead_time, experimental_class_professor_start_at, experimental_class_lead_start_at, experimental_class_status, cpf, city, state, country, timezone, origin")
        .in("id", allLeadIds);
      if (!r.error) fullLeads = (r.data as any[]) ?? [];
    } catch (_e) {
      fullLeads = [];
    }
  }

  // Step 4: History events (scheduled / cancelled / link / notifications)
  if (allLeadIds.length > 0) {
    let historyEvents: any[] = [];
    try {
      const r = await admin
        .from("atendimento_history_events")
        .select("id, lead_id, event_type, conversation_id, created_at, details")
        .in("lead_id", allLeadIds)
        .in("event_type", [
          "experimental_class_date_selected",
          "experimental_class_time_selected",
          "experimental_class_scheduled",
          "experimental_class_cancelled",
          "experimental_class_link_updated",
          "experimental_class_student_start_notification_sent",
          "experimental_class_attendant_start_notification_sent",
          "experimental_class_registered_attendant_start_notification_sent",
        ])
        .order("created_at", { ascending: false });
      if (!r.error) historyEvents = (r.data as any[]) ?? [];
    } catch (_e) {
      historyEvents = [];
    }

    for (const event of historyEvents) {
      const leadId = String(event?.lead_id ?? "");
      if (!leadId) continue;
      const eventType = String(event?.event_type ?? "").trim().toLowerCase();
      const details = ((event as any)?.details ?? {}) as Record<string, unknown>;
      const eventCreatedAt = String((event as any)?.created_at ?? "").trim();
      const bookingIdFromDetails = String(details.booking_id ?? "").trim();
      const lessonLink = String(details.lesson_link ?? "").trim() || null;

      if (eventType === "experimental_class_cancelled") {
        cancelledByHistoryLeadIds.add(leadId);
        continue;
      }

      if (eventType === "experimental_class_link_updated") {
        if (!latestLessonLinkByLeadId.has(leadId)) {
          latestLessonLinkByLeadId.set(leadId, lessonLink);
        }
        continue;
      }

      if (eventType === "experimental_class_student_start_notification_sent") {
        if (bookingIdFromDetails) sentStudentBookingIds.add(bookingIdFromDetails);
        continue;
      }
      if (eventType === "experimental_class_attendant_start_notification_sent") {
        if (bookingIdFromDetails) sentAttendantBookingIds.add(bookingIdFromDetails);
        continue;
      }
      if (eventType === "experimental_class_registered_attendant_start_notification_sent") {
        if (bookingIdFromDetails) sentRegisteredAttendantBookingIds.add(bookingIdFromDetails);
        continue;
      }

      if (
        !bookingsByLeadId.has(leadId) &&
        eventType === "experimental_class_scheduled" &&
        !cancelledLeadBookingIds.has(leadId) &&
        !cancelledByHistoryLeadIds.has(leadId)
      ) {
        const bookingStatus = String(details.status ?? "").trim().toLowerCase() || "scheduled";
        if (bookingStatus === "cancelled") continue;
        bookingsByLeadId.set(leadId, {
          id: String(event?.id ?? ""),
          lead_id: leadId,
          conversation_id: String(event?.conversation_id ?? ""),
          status: bookingStatus,
          lesson_link: lessonLink,
          student_start_notification_sent_at: null,
          attendant_start_notification_sent_at: null,
          attendance_status: null,
          attendance_checked_at: null,
          professor_timezone: String(details.professor_timezone ?? "").trim() || PROF_TZ,
          lead_timezone: String(details.lead_timezone ?? "").trim(),
          professor_date: String(details.professor_date ?? ""),
          professor_time: String(details.professor_time ?? ""),
          professor_start_at: String(details.professor_start_at ?? ""),
          lead_date: String(details.lead_date ?? ""),
          lead_time: String(details.lead_time ?? ""),
          lead_start_at: String(details.lead_start_at ?? details.professor_start_at ?? ""),
          created_at: eventCreatedAt,
          source: "history",
        });
      }
    }

    // Step 5: Preenche notificações enviadas (sent_at) via history no booking mergeado
    for (const event of historyEvents) {
      const leadId = String(event?.lead_id ?? "");
      if (!leadId) continue;
      const eventType = String(event?.event_type ?? "").trim().toLowerCase();
      const eventCreatedAt = String((event as any)?.created_at ?? "").trim();
      const currentBooking = bookingsByLeadId.get(leadId);
      if (!currentBooking) continue;
      if (
        eventType === "experimental_class_student_start_notification_sent" &&
        !String(currentBooking.student_start_notification_sent_at ?? "").trim()
      ) {
        bookingsByLeadId.set(leadId, { ...currentBooking, student_start_notification_sent_at: eventCreatedAt });
      }
      if (
        eventType === "experimental_class_attendant_start_notification_sent" &&
        !String(currentBooking.attendant_start_notification_sent_at ?? "").trim()
      ) {
        bookingsByLeadId.set(leadId, { ...currentBooking, attendant_start_notification_sent_at: eventCreatedAt });
      }
    }

    // Step 5b: Sobrescreve SEMPRE lesson_link dos bookings com o valor mais novo do history
    // (evita race condition onde link foi adicionado APÓS booking ser mergeado da tabela)
    for (const [leadId, latestLink] of latestLessonLinkByLeadId.entries()) {
      const currentBooking = bookingsByLeadId.get(leadId);
      if (!currentBooking) continue;
      const cleanLatest = String(latestLink ?? "").trim();
      if (!cleanLatest) continue;
      const currentLink = String(currentBooking.lesson_link ?? "").trim();
      if (currentLink !== cleanLatest) {
        bookingsByLeadId.set(leadId, { ...currentBooking, lesson_link: cleanLatest });
      }
    }
  }

  // Step 6: draft via experimental_class_lead/professor fields (agendamento manual no painel sem booking)
  for (const row of fullLeads as any[]) {
    const leadId = String(row?.id ?? "").trim();
    if (!leadId) continue;
    if (cancelledLeadBookingIds.has(leadId) || cancelledByHistoryLeadIds.has(leadId)) continue;
    if (bookingsByLeadId.has(leadId)) continue;

    const professorStart = String(row?.experimental_class_professor_start_at ?? "").trim();
    if (!professorStart) continue;

    bookingsByLeadId.set(leadId, {
      id: `draft-${leadId}`,
      lead_id: leadId,
      conversation_id: null,
      status: "scheduled",
      lesson_link: latestLessonLinkByLeadId.get(leadId) || null,
      student_start_notification_sent_at: null,
      attendant_start_notification_sent_at: null,
      attendance_status: null,
      attendance_checked_at: null,
      professor_timezone: PROF_TZ,
      lead_timezone: String(row?.timezone ?? "").trim() || PROF_TZ,
      professor_date: String(row?.experimental_class_professor_date ?? ""),
      professor_time: String(row?.experimental_class_professor_time ?? ""),
      professor_start_at: professorStart,
      lead_date: String(row?.experimental_class_lead_date ?? ""),
      lead_time: String(row?.experimental_class_lead_time ?? ""),
      lead_start_at: String(row?.experimental_class_lead_start_at ?? professorStart),
      created_at: nowIso,
      source: "draft",
    });
  }

  // Step 7: Filter dentro da janela e preparar bookingRows
  const bookingRows: any[] = [];
  for (const booking of Array.from(bookingsByLeadId.values())) {
    const status = String(booking?.status ?? "").trim().toLowerCase();
    const leadId = String(booking?.lead_id ?? "").trim();
    if (!leadId) continue;
    if (status === "cancelled") continue;
    if (status !== "scheduled" && status !== "in_progress") continue;
    if (cancelledByHistoryLeadIds.has(leadId)) continue;

    const startAt = String(booking?.professor_start_at ?? "");
    if (startAt && startAt >= candidateWindowStartIso && startAt <= candidateWindowEndIso) {
      bookingRows.push(booking);
    }
  }

  const leadsById = new Map(
    (fullLeads ?? []).map((lead) => [String((lead as any)?.id ?? "").trim(), lead]),
  );

  let studentSent = 0;
  let studentFailed = 0;
  let attendantSent = 0;
  let attendantFailed = 0;
  let registeredAttendantSent = 0;
  let registeredAttendantFailed = 0;
  let missingLessonLink = 0;
  let missingProfessor = 0;
  let missingStudentPhone = 0;
  let missingRequiredDestinations = 0;

  async function setBookingNotificationSentAt(params: {
    bookingId: string;
    column:
      | "student_start_notification_sent_at"
      | "attendant_start_notification_sent_at";
    nowIso: string;
  }) {
    try {
      const fullUpdate = await admin
        .from("atendimento_experimental_class_bookings")
        .update({
          [params.column]: params.nowIso,
        } as any)
        .eq("id", params.bookingId);
      if (fullUpdate.error && isExperimentalClassBookingsNotificationSentColumnsUnavailable(fullUpdate.error)) {
        await admin
          .from("atendimento_experimental_class_bookings")
          .update({ updated_at: params.nowIso })
          .eq("id", params.bookingId);
      }
    } catch {
      try {
        await admin
          .from("atendimento_experimental_class_bookings")
          .update({ updated_at: params.nowIso })
          .eq("id", params.bookingId);
      } catch {
        /* noop */
      }
    }
  }

  for (const booking of bookingRows) {
    const bookingId = String((booking as any)?.id ?? "").trim();
    const leadId = String((booking as any)?.lead_id ?? "").trim();
    const conversationId = String((booking as any)?.conversation_id ?? "").trim() || null;
    const lessonLink =
      String((booking as any)?.lesson_link ?? "").trim() ||
      latestLessonLinkByLeadId.get(leadId) ||
      "";
    const professorStartAtRaw = String((booking as any)?.professor_start_at ?? "").trim();
    const leadStartAtRaw = String((booking as any)?.lead_start_at ?? professorStartAtRaw).trim();
    const professorStartAtMs = new Date(professorStartAtRaw).getTime();
    const leadStartAtMs = new Date(leadStartAtRaw).getTime();

    if (
      !bookingId ||
      !leadId ||
      !Number.isFinite(professorStartAtMs) ||
      !Number.isFinite(leadStartAtMs)
    ) continue;

    const lead = leadsById.get(leadId) as any;
    const leadPhone = String(lead?.phone ?? "").trim();
    const leadFirstName = getLeadFirstName(lead?.full_name);
    const leadFullName = getLeadFullName(lead?.full_name);

    if (!lessonLink) {
      missingLessonLink += 1;
      continue;
    }

    const resolvedProfessor = resolveExperimentalClassAssignedProfessorPhone({
      bookingAssignedPhone: String((booking as any)?.assigned_professor_phone ?? "").trim(),
      bookingAssignedName: String((booking as any)?.assigned_professor_name ?? "").trim(),
      flatAssignedPhone: String(lead?.experimental_class_professor_phone ?? "").trim(),
      flatAssignedName: String(lead?.experimental_class_professor_name ?? "").trim(),
    });
    if (!resolvedProfessor) {
      missingProfessor += 1;
      continue;
    }

    const cachedStudentSent =
      sentStudentBookingIds.has(bookingId) ||
      Boolean(String((booking as any)?.student_start_notification_sent_at ?? "").trim());
    const cachedAttendantSent =
      sentAttendantBookingIds.has(bookingId) ||
      Boolean(String((booking as any)?.attendant_start_notification_sent_at ?? "").trim());
    const cachedRegisteredAttendantSent = sentRegisteredAttendantBookingIds.has(bookingId);

    const studentDue = leadStartAtMs <= nowMs;
    const attendantDue =
      professorStartAtMs - EXPERIMENTAL_CLASS_ATTENDANT_START_REMINDER_MINUTES * 60_000 <= nowMs;
    const registeredAttendantDue = attendantDue;

    let thisBookingAttendantOk = cachedAttendantSent;
    let thisBookingRegisteredAttendantOk = cachedRegisteredAttendantSent;
    let thisBookingStudentOk = cachedStudentSent;

    if (attendantDue && !cachedAttendantSent) {
      const assignedCronProfessorPhone = resolvedProfessor.phone;
      try {
        await sendAtendimentoWhatsAppText({
          phone: assignedCronProfessorPhone,
          message: buildExperimentalClassAttendantStartReminderWhatsAppMessage(leadFullName, lessonLink),
        });

        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_class_attendant_start_notification_sent",
          title: "Lembrete de inicio da aula experimental enviado ao atendente",
          details: {
            booking_id: bookingId,
            phone: assignedCronProfessorPhone,
            lesson_link: lessonLink,
            start_at: professorStartAtRaw,
          },
          actorType: "system",
        });
        await setBookingNotificationSentAt({
          bookingId,
          column: "attendant_start_notification_sent_at",
          nowIso,
        });
        sentAttendantBookingIds.add(bookingId);
        attendantSent += 1;
        thisBookingAttendantOk = true;
      } catch (error) {
        attendantFailed += 1;
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_class_attendant_start_notification_failed",
          title: "Falha ao enviar lembrete de inicio da aula experimental ao atendente",
          details: {
            booking_id: bookingId,
            phone: assignedCronProfessorPhone,
            lesson_link: lessonLink,
            start_at: professorStartAtRaw,
            error: error instanceof Error ? error.message : String(error),
          },
          actorType: "system",
        });
      }
    }

    if (registeredAttendantDue && !cachedRegisteredAttendantSent) {
      try {
        await sendAtendimentoWhatsAppText({
          phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
          message: buildExperimentalClassRegisteredAttendantStartReminderWhatsAppMessage(leadFullName, lessonLink),
        });

        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_class_registered_attendant_start_notification_sent",
          title: "Lembrete de inicio da aula experimental enviado ao atendente cadastrado",
          details: {
            booking_id: bookingId,
            phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
            lesson_link: lessonLink,
            start_at: professorStartAtRaw,
          },
          actorType: "system",
        });
        sentRegisteredAttendantBookingIds.add(bookingId);
        registeredAttendantSent += 1;
        thisBookingRegisteredAttendantOk = true;
      } catch (error) {
        registeredAttendantFailed += 1;
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_class_registered_attendant_start_notification_failed",
          title: "Falha ao enviar lembrete de inicio da aula experimental ao atendente cadastrado",
          details: {
            booking_id: bookingId,
            phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
            lesson_link: lessonLink,
            start_at: professorStartAtRaw,
            error: error instanceof Error ? error.message : String(error),
          },
          actorType: "system",
        });
      }
    }

    if (studentDue && !cachedStudentSent) {
      if (!leadPhone) {
        missingStudentPhone += 1;
      } else {
        try {
          await sendAtendimentoWhatsAppText({
            phone: leadPhone,
            message: buildExperimentalClassStudentLessonReadyWhatsAppMessage(leadFirstName, lessonLink),
          });

          await appendHistoryEvent({
            leadId,
            conversationId,
            eventType: "experimental_class_student_start_notification_sent",
            title: "Link da aula experimental enviado ao aluno no inicio da aula",
            details: {
              booking_id: bookingId,
              phone: leadPhone,
              lesson_link: lessonLink,
              start_at: leadStartAtRaw,
            },
            actorType: "system",
          });
          await setBookingNotificationSentAt({
            bookingId,
            column: "student_start_notification_sent_at",
            nowIso,
          });
          sentStudentBookingIds.add(bookingId);
          studentSent += 1;
          thisBookingStudentOk = true;
        } catch (error) {
          studentFailed += 1;
          await appendHistoryEvent({
            leadId,
            conversationId,
            eventType: "experimental_class_student_start_notification_failed",
            title: "Falha ao enviar o link da aula experimental ao aluno no inicio da aula",
            details: {
              booking_id: bookingId,
              phone: leadPhone,
              lesson_link: lessonLink,
              start_at: leadStartAtRaw,
              error: error instanceof Error ? error.message : String(error),
            },
            actorType: "system",
          });
        }
      }
    }

    if (
      (studentDue && !thisBookingStudentOk) ||
      (attendantDue && !thisBookingAttendantOk)
    ) {
      missingRequiredDestinations += 1;
    }
  }

  return {
    ok: true as const,
    skipped: false as const,
    checkedBookings: bookingRows.length,
    studentSent,
    studentFailed,
    attendantSent,
    attendantFailed,
    registeredAttendantSent,
    registeredAttendantFailed,
    missingLessonLink,
    missingProfessor,
    missingStudentPhone,
    missingRequiredDestinations,
  };
}

export async function sendRecurringClassStartNotifications(now = new Date()) {
  const admin = createSupabaseAdminClient();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const PROF_TZ = (
    process.env.EXPERIMENTAL_CLASS_PROFESSOR_TIME_ZONE ||
    process.env.ATENDIMENTO_PROFESSOR_TIME_ZONE ||
    "America/Sao_Paulo"
  ).trim();

  const allRecurringColumns = [
    "id",
    "user_id",
    "full_name",
    "phone",
    "status",
    "funnel_stage",
    "timezone",
    "recurring_class_weekday",
    "recurring_class_professor_time",
    "recurring_class_lead_time",
    "recurring_class_professor_timezone",
    "recurring_class_lead_timezone",
    "recurring_class_link",
    "recurring_class_professor_date",
    "recurring_class_professor_start_at",
    "recurring_class_lead_date",
    "recurring_class_lead_start_at",
    "recurring_class_student_start_notification_sent_at",
    "recurring_class_attendant_start_notification_sent_at",
  ];

  let rows: any[] = [];
  try {
    const { data, error } = await admin
      .from("atendimento_leads")
      .select(allRecurringColumns.join(", "))
      .in("status", ["aluno", "matriculado", "cadastro_recorrente_pendente_plataforma"])
      .not("recurring_class_weekday", "is", null);
    if (!error && Array.isArray(data)) rows = data as any[];
  } catch (_e) {
    rows = [];
  }

  let studentSent = 0;
  let studentFailed = 0;
  let attendantSent = 0;
  let attendantFailed = 0;
  let registeredAttendantSent = 0;
  let registeredAttendantFailed = 0;
  let missingLessonLink = 0;
  let missingStudentPhone = 0;
  let missingRecurringMeta = 0;
  let missingRequiredDestinations = 0;

  const validWeekdayKeys = new Set<string>(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

  const recurringLeadIds = (rows as any[]).map((r: any) => String(r?.id ?? "")).filter(Boolean);
  const sentOccurrencesByLeadId = new Map<string, Set<string>>();
  if (recurringLeadIds.length > 0) {
    try {
      const { data: hist } = await admin
        .from("atendimento_history_events")
        .select("lead_id, event_type, details")
        .in("lead_id", recurringLeadIds)
        .in("event_type", [
          "recurring_class_attendant_start_notification_sent",
          "recurring_class_student_start_notification_sent",
          "recurring_class_registered_attendant_start_notification_sent",
        ])
        .order("created_at", { ascending: false })
        .limit(2000);
      if (Array.isArray(hist)) {
        for (const ev of hist as any[]) {
          const lid = String(ev?.lead_id ?? "").trim();
          const startIso = String((ev?.details ?? {})?.start_at ?? "").trim();
          const etype = String(ev?.event_type ?? "").trim();
          if (!lid || !startIso) continue;
          const key = `${etype}|${startIso}`;
          const set = sentOccurrencesByLeadId.get(lid) ?? new Set<string>();
          set.add(key);
          sentOccurrencesByLeadId.set(lid, set);
        }
      }
    } catch (_e) {}
  }

  for (const row of rows as any[]) {
    const leadId = String(row?.id ?? "").trim();
    const userId = String(row?.user_id ?? "").trim();
    if (!leadId) continue;

    const weekdayRaw = String(row?.recurring_class_weekday ?? "").trim().toLowerCase();
    const professorTimeHHMM = /^\d{2}:\d{2}$/.test(String(row?.recurring_class_professor_time ?? ""))
      ? String(row?.recurring_class_professor_time ?? "").trim()
      : /^\d{2}:\d{2}$/.test(String(row?.recurring_class_lead_time ?? ""))
        ? String(row?.recurring_class_lead_time ?? "").trim()
        : "";
    const professorTz = String(row?.recurring_class_professor_timezone ?? "").trim() || PROF_TZ;
    const leadTz = String(row?.recurring_class_lead_timezone ?? "").trim() || professorTz;

    if (!validWeekdayKeys.has(weekdayRaw) || !professorTimeHHMM) {
      missingRecurringMeta += 1;
      continue;
    }

    const occurrence = calculateNextRecurringOccurrence({
      weekday: weekdayRaw as RecurringWeekdayKey,
      professorTimeHHMM,
      professorTimeZone: professorTz,
      leadTimeZone: leadTz,
      fromDate: now,
    });

    if (!occurrence) {
      missingRecurringMeta += 1;
      continue;
    }

    const leadPhone = String(row?.phone ?? "").trim();
    const leadFirstName = getLeadFirstName(row?.full_name);
    const leadFullName = getLeadFullName(row?.full_name);
    const lessonLink = String(row?.recurring_class_link ?? "").trim() || "";

    if (!lessonLink) {
      missingLessonLink += 1;
      continue;
    }

    const resolvedRecurringProfessor = resolveRecurringClassAssignedProfessorPhone({
      flatAssignedPhone: String(row?.recurring_class_professor_phone ?? "").trim(),
      flatAssignedName: String(row?.recurring_class_professor_name ?? "").trim(),
    });

    const professorStartAtMs = new Date(occurrence.professorStartAt).getTime();
    const leadStartAtMs = new Date(
      occurrence.leadStartAt || occurrence.professorStartAt,
    ).getTime();

    if (!Number.isFinite(professorStartAtMs) || !Number.isFinite(leadStartAtMs)) continue;

    const existingSentSet = sentOccurrencesByLeadId.get(leadId) ?? new Set<string>();
    const thisProfessorOccurrenceKey = occurrence.professorStartAt;
    const studentOccurrenceAlreadySent = existingSentSet.has(
      `recurring_class_student_start_notification_sent|${thisProfessorOccurrenceKey}`,
    );
    const attendantOccurrenceAlreadySent = existingSentSet.has(
      `recurring_class_attendant_start_notification_sent|${thisProfessorOccurrenceKey}`,
    );
    const registeredAttendantOccurrenceAlreadySent = existingSentSet.has(
      `recurring_class_registered_attendant_start_notification_sent|${thisProfessorOccurrenceKey}`,
    );

    const cachedStudentSent =
      studentOccurrenceAlreadySent ||
      Boolean(String(row?.recurring_class_student_start_notification_sent_at ?? "").trim());
    const cachedAttendantSent =
      attendantOccurrenceAlreadySent ||
      Boolean(String(row?.recurring_class_attendant_start_notification_sent_at ?? "").trim());
    const cachedRegisteredAttendantSent = registeredAttendantOccurrenceAlreadySent;

    const studentDue = leadStartAtMs <= nowMs;
    const attendantDue =
      professorStartAtMs - RECURRING_CLASS_ATTENDANT_START_REMINDER_MINUTES * 60_000 <= nowMs;

    const weekdayLabel =
      (RECURRING_WEEKDAY_LABELS_PT_BR as Record<string, string>)[weekdayRaw] ??
      weekdayRaw.toUpperCase();

    let thisLeadAttendantOk = cachedAttendantSent;
    let thisLeadRegisteredOk = cachedRegisteredAttendantSent;
    let thisLeadStudentOk = cachedStudentSent;

    if (attendantDue && !cachedAttendantSent) {
      const assignedRecurringProfessorPhone = resolvedRecurringProfessor?.phone || EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE;
      try {
        await sendAtendimentoWhatsAppText({
          phone: assignedRecurringProfessorPhone,
          message: buildRecurringClassAttendantStartReminderWhatsAppMessage(
            leadFullName,
            weekdayLabel,
            lessonLink,
          ),
        });
        try {
          await admin
            .from("atendimento_leads")
            .update({
              recurring_class_attendant_start_notification_sent_at: nowIso,
              updated_at: nowIso,
            } as any)
            .eq("id", leadId);
        } catch (_colErr) {}
        void userId;
        await appendHistoryEvent({
          leadId,
          conversationId: null,
          eventType: "recurring_class_attendant_start_notification_sent",
          title: "Lembrete de inicio da aula recorrente enviado ao atendente",
          details: {
            phone: assignedRecurringProfessorPhone,
            lesson_link: lessonLink,
            start_at: occurrence.professorStartAt,
            weekday: weekdayRaw,
            professor_time: professorTimeHHMM,
            source: "cron_recurring_class",
            resolved_recurring_professor: resolvedRecurringProfessor
              ? `${resolvedRecurringProfessor.name} (${resolvedRecurringProfessor.phone})`
              : null,
          },
          actorType: "system",
        });
        attendantSent += 1;
        thisLeadAttendantOk = true;
      } catch (error) {
        attendantFailed += 1;
        await appendHistoryEvent({
          leadId,
          conversationId: null,
          eventType: "recurring_class_attendant_start_notification_failed",
          title: "Falha ao enviar lembrete de inicio da aula recorrente ao atendente",
          details: {
            phone: assignedRecurringProfessorPhone,
            lesson_link: lessonLink,
            start_at: occurrence.professorStartAt,
            error: error instanceof Error ? error.message : String(error),
          },
          actorType: "system",
        });
      }
    }

    if (attendantDue && !cachedRegisteredAttendantSent) {
      try {
        await sendAtendimentoWhatsAppText({
          phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
          message: buildRecurringClassRegisteredAttendantStartReminderWhatsAppMessage(
            leadFullName,
            weekdayLabel,
            lessonLink,
          ),
        });
        await appendHistoryEvent({
          leadId,
          conversationId: null,
          eventType: "recurring_class_registered_attendant_start_notification_sent",
          title: "Lembrete de inicio da aula recorrente enviado ao atendente cadastrado",
          details: {
            phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
            lesson_link: lessonLink,
            start_at: occurrence.professorStartAt,
            weekday: weekdayRaw,
            professor_time: professorTimeHHMM,
            source: "cron_recurring_class",
          },
          actorType: "system",
        });
        registeredAttendantSent += 1;
        thisLeadRegisteredOk = true;
      } catch (error) {
        registeredAttendantFailed += 1;
        await appendHistoryEvent({
          leadId,
          conversationId: null,
          eventType: "recurring_class_registered_attendant_start_notification_failed",
          title: "Falha ao enviar lembrete de inicio da aula recorrente ao atendente cadastrado",
          details: {
            phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
            lesson_link: lessonLink,
            start_at: occurrence.professorStartAt,
            error: error instanceof Error ? error.message : String(error),
          },
          actorType: "system",
        });
      }
    }

    if (studentDue && !cachedStudentSent) {
      if (!leadPhone) {
        missingStudentPhone += 1;
      } else {
        try {
          await sendAtendimentoWhatsAppText({
            phone: leadPhone,
            message: buildRecurringClassStudentLessonReadyWhatsAppMessage(leadFirstName, lessonLink),
          });
          try {
            await admin
              .from("atendimento_leads")
              .update({
                recurring_class_student_start_notification_sent_at: nowIso,
                updated_at: nowIso,
              } as any)
              .eq("id", leadId);
          } catch (_colErr) {}
          await appendHistoryEvent({
            leadId,
            conversationId: null,
            eventType: "recurring_class_student_start_notification_sent",
            title: "Link da aula recorrente enviado ao aluno no inicio da aula",
            details: {
              phone: leadPhone,
              lesson_link: lessonLink,
              start_at: occurrence.leadStartAt || occurrence.professorStartAt,
              weekday: weekdayRaw,
              professor_time: professorTimeHHMM,
              source: "cron_recurring_class",
            },
            actorType: "system",
          });
          studentSent += 1;
          thisLeadStudentOk = true;
        } catch (error) {
          studentFailed += 1;
          await appendHistoryEvent({
            leadId,
            conversationId: null,
            eventType: "recurring_class_student_start_notification_failed",
            title: "Falha ao enviar link da aula recorrente ao aluno",
            details: {
              phone: leadPhone,
              lesson_link: lessonLink,
              start_at: occurrence.leadStartAt || occurrence.professorStartAt,
              error: error instanceof Error ? error.message : String(error),
            },
            actorType: "system",
          });
        }
      }
    }

    if (
      (studentDue && !thisLeadStudentOk) ||
      (attendantDue && !thisLeadAttendantOk)
    ) {
      missingRequiredDestinations += 1;
    }
  }

  return {
    ok: true as const,
    ranAt: nowIso,
    skipped: false as const,
    checkedLeads: rows.length,
    studentSent,
    studentFailed,
    attendantSent,
    attendantFailed,
    registeredAttendantSent,
    registeredAttendantFailed,
    missingLessonLink,
    missingStudentPhone,
    missingRecurringMeta,
    missingRequiredDestinations,
  };
}

export async function requireAtendimentoUser() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id || !isAtendimentoEmail(user.email)) {
    return { ok: false as const, supabase, user: null };
  }
  return { ok: true as const, supabase, user };
}

export async function requireAuthenticatedAtendimentoParticipant() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return { ok: false as const, supabase, user: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, email, created_at, access_scope")
    .eq("user_id", user.id)
    .maybeSingle();

  const accessScope = normalizeAccessScope((profile as any)?.access_scope);
  if (!isAtendimentoOnlyAccessScope(accessScope)) {
    return { ok: false as const, supabase, user: null, profile: null };
  }

  return {
    ok: true as const,
    supabase,
    user,
    profile: {
      nome: String((profile as any)?.nome ?? "").trim() || null,
      email: String((profile as any)?.email ?? user.email ?? "").trim().toLowerCase() || null,
      created_at: String((profile as any)?.created_at ?? "").trim() || null,
      access_scope: accessScope,
    },
  };
}

export async function ensureAtendimentoPublicLink(origin?: string) {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("atendimento_public_links")
    .select("id, slug, label, active, assigned_user_email")
    .eq("slug", ATENDIMENTO_PUBLIC_LINK_SLUG)
    .maybeSingle();

  if (existing?.id) {
    return {
      ...(existing as any),
      public_url: origin ? buildAtendimentoPublicUrl(origin) : null,
    };
  }

  const { data } = await admin
    .from("atendimento_public_links")
    .insert({
      slug: ATENDIMENTO_PUBLIC_LINK_SLUG,
      label: "Link principal de atendimento",
      active: true,
      assigned_user_email: ATENDIMENTO_EMAIL,
    })
    .select("id, slug, label, active, assigned_user_email")
    .maybeSingle();

  return {
    ...(data as any),
    public_url: origin ? buildAtendimentoPublicUrl(origin) : null,
  };
}

export async function createPublicLeadSession(params: { origin?: string | null; slug?: string | null }) {
  const admin = createSupabaseAdminClient();
  const publicLink = await ensureAtendimentoPublicLink(params.origin || undefined);
  const publicSlug = String(params.slug ?? "").trim() || String(publicLink.slug ?? "");
  if (!publicSlug || publicSlug !== ATENDIMENTO_PUBLIC_LINK_SLUG) {
    throw new Error("Link de atendimento inválido.");
  }

  const { data: lead } = await admin
    .from("atendimento_leads")
    .insert({
      origin: "link_publico_atendimento",
      status: "novo_lead",
      funnel_stage: "novo_lead",
      assigned_user_email: ATENDIMENTO_EMAIL,
      unread_count: 0,
      is_new_for_attendant: true,
    })
    .select("*")
    .maybeSingle();

  if (!lead?.id) {
    throw new Error("Não foi possível criar o lead.");
  }

  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .insert({
      lead_id: String(lead.id),
      public_link_id: String(publicLink.id ?? ""),
      channel: "web",
      public_slug: makeConversationSessionSlug(),
      bot_enabled: true,
    })
    .select("*")
    .maybeSingle();

  if (!conversation?.id) {
    throw new Error("Não foi possível criar a conversa.");
  }

  return {
    lead,
    conversation,
    publicLink: {
      slug: String(publicLink.slug ?? ATENDIMENTO_PUBLIC_LINK_SLUG),
      public_url: publicLink.public_url,
    },
  };
}

async function findExistingLeadForAuthenticatedUser(params: {
  userId: string;
  email: string | null;
}) {
  const admin = createSupabaseAdminClient();

  const { data: byUser } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("auth_user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byUser?.id) return byUser;

  if (!params.email) return null;

  const { data: byEmail } = await admin
    .from("atendimento_leads")
    .select("*")
    .ilike("email", params.email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!byEmail?.id) return null;

  await admin
    .from("atendimento_leads")
    .update({
      auth_user_id: params.userId,
      email: params.email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(byEmail.id));

  return {
    ...byEmail,
    auth_user_id: params.userId,
    email: params.email,
  };
}

export async function ensureAtendimentoLeadForAuthenticatedUser(params: {
  userId: string;
  email?: string | null;
  name?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const normalizedEmail = String(params.email ?? "").trim().toLowerCase() || null;
  const normalizedName = String(params.name ?? "").trim() || null;
  let lead = await findExistingLeadForAuthenticatedUser({
    userId: params.userId,
    email: normalizedEmail,
  });

  if (!lead?.id) {
    const { data: createdLead } = await admin
      .from("atendimento_leads")
      .insert({
        auth_user_id: params.userId,
        full_name: normalizedName,
        email: normalizedEmail,
        origin: "link_publico_atendimento",
        status: "novo_lead",
        funnel_stage: "novo_lead",
        assigned_user_email: ATENDIMENTO_EMAIL,
        unread_count: 0,
        is_new_for_attendant: true,
      })
      .select("*")
      .maybeSingle();

    lead = createdLead;
  } else {
    const nextLeadPatch: Record<string, unknown> = {
      auth_user_id: params.userId,
      updated_at: new Date().toISOString(),
    };
    if (normalizedEmail && !String((lead as any)?.email ?? "").trim()) nextLeadPatch.email = normalizedEmail;
    if (normalizedName && !String((lead as any)?.full_name ?? "").trim()) nextLeadPatch.full_name = normalizedName;

    const shouldUpdateLead = Object.keys(nextLeadPatch).some((key) => key !== "updated_at");
    if (shouldUpdateLead) {
      const { data: refreshedLead } = await admin
        .from("atendimento_leads")
        .update(nextLeadPatch)
        .eq("id", String((lead as any).id))
        .select("*")
        .maybeSingle();
      if (refreshedLead?.id) lead = refreshedLead;
    }
  }

  if (!lead?.id) {
    throw new Error("Não foi possível preparar o seu atendimento.");
  }

  return lead;
}

export async function createAuthenticatedLeadSession(params: {
  userId: string;
  email?: string | null;
  name?: string | null;
  origin?: string | null;
  slug?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const publicLink = await ensureAtendimentoPublicLink(params.origin || undefined);
  const publicSlug = String(params.slug ?? "").trim() || String(publicLink.slug ?? "");
  if (!publicSlug || publicSlug !== ATENDIMENTO_PUBLIC_LINK_SLUG) {
    throw new Error("Link de atendimento inválido.");
  }

  const lead = await ensureAtendimentoLeadForAuthenticatedUser({
    userId: params.userId,
    email: params.email,
    name: params.name,
  });

  const { data: existingConversation } = await admin
    .from("atendimento_conversations")
    .select("*")
    .eq("lead_id", String(lead.id))
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let conversation = existingConversation;
  if (!conversation?.id) {
    const { data: createdConversation } = await admin
      .from("atendimento_conversations")
      .insert({
        lead_id: String(lead.id),
        public_link_id: String(publicLink.id ?? ""),
        channel: "web",
        public_slug: makeConversationSessionSlug(),
        bot_enabled: true,
      })
      .select("*")
      .maybeSingle();
    conversation = createdConversation;
  }

  if (!conversation?.id) {
    throw new Error("Não foi possível preparar a sua conversa.");
  }

  return {
    lead,
    conversation,
    publicLink: {
      slug: String(publicLink.slug ?? ATENDIMENTO_PUBLIC_LINK_SLUG),
      public_url: publicLink.public_url,
    },
  };
}

export async function ensureInitialBotConversationFlow(params: {
  leadId: string;
  conversationId: string;
}) {
  const INITIAL_BOT_TYPING_DELAY_MS = 1500;
  const admin = createSupabaseAdminClient();
  const { data: lead } = await admin
    .from("atendimento_leads")
    .select("full_name")
    .eq("id", params.leadId)
    .maybeSingle();
  const { count: leadCount, error: leadCountError } = await admin
    .from("atendimento_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "lead");

  if (leadCountError) {
    throw new Error(leadCountError.message || "Falha ao verificar mensagens do lead.");
  }
  if (Number(leadCount ?? 0) > 0) {
    return false;
  }

  const { count: botCount, error: botCountError } = await admin
    .from("atendimento_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "bot");

  if (botCountError) {
    throw new Error(botCountError.message || "Falha ao verificar mensagens iniciais.");
  }

  const initialMessages = initialBotMessages({
    userName: String((lead as any)?.full_name ?? "").trim() || null,
  });
  const botCountNum = Number(botCount ?? 0);
  const normalizedInitialMessages = initialMessages.map((m) => String(m ?? "").trim()).filter(Boolean);
  const { data: existingInitialBotMessages, error: existingInitialBotMessagesError } = await admin
    .from("atendimento_messages")
    .select("id, content_text, created_at")
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "bot")
    .in("content_text", normalizedInitialMessages);

  if (existingInitialBotMessagesError) {
    throw new Error(existingInitialBotMessagesError.message || "Falha ao verificar mensagens iniciais.");
  }

  const sentInitialSet = new Set(
    (existingInitialBotMessages ?? [])
      .map((row: any) => String(row?.content_text ?? "").trim())
      .filter(Boolean),
  );

  const duplicateInitialIdsToDelete: string[] = [];
  const byContent = new Map<string, Array<{ id: string; createdAt: string }>>();
  for (const row of existingInitialBotMessages ?? []) {
    const content = String((row as any)?.content_text ?? "").trim();
    const id = String((row as any)?.id ?? "").trim();
    const createdAt = String((row as any)?.created_at ?? "").trim();
    if (!content || !id) continue;
    const next = byContent.get(content) ?? [];
    next.push({ id, createdAt });
    byContent.set(content, next);
  }
  for (const items of byContent.values()) {
    items.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
      return a.id.localeCompare(b.id);
    });
    for (const extra of items.slice(1)) {
      duplicateInitialIdsToDelete.push(extra.id);
    }
  }

  if (duplicateInitialIdsToDelete.length > 0) {
    await admin.from("atendimento_messages").delete().in("id", duplicateInitialIdsToDelete);
  }
  const nextIndex = normalizedInitialMessages.findIndex((message) => !sentInitialSet.has(message));
  const nextContentRaw = nextIndex >= 0 ? normalizedInitialMessages[nextIndex] : "";
  if (nextIndex < 0) {
    return false;
  }

  await new Promise((resolve) => setTimeout(resolve, INITIAL_BOT_TYPING_DELAY_MS));
  const nowIso = new Date().toISOString();
  const nextContent = String(nextContentRaw ?? "").trim();
  if (!nextContent) return false;

  const { data: existingBotMessage } = await admin
    .from("atendimento_messages")
    .select("id")
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "bot")
    .eq("content_text", nextContent)
    .limit(1)
    .maybeSingle();

  if (existingBotMessage?.id) {
    await syncConversationPreview({
      conversationId: params.conversationId,
      contentText: nextContent,
      createdAt: nowIso,
    });
    return false;
  }

  const { data: inserted, error: insertError } = await admin
    .from("atendimento_messages")
    .insert({
      id: buildDeterministicInitialBotMessageId(params.conversationId, nextContent),
      conversation_id: params.conversationId,
      sender_role: "bot",
      content_text: nextContent,
      media_type: "text",
      status: "lida",
      sent_at: nowIso,
      delivered_at: nowIso,
      read_at: nowIso,
    })
    .select("content_text")
    .maybeSingle();

  if (insertError) {
    const code = String((insertError as any)?.code ?? "").trim();
    if (code !== "23505") {
      throw new Error(insertError.message || "Falha ao iniciar fluxo do bot.");
    }
  }

  const { data: duplicatedCurrentMessageRows } = await admin
    .from("atendimento_messages")
    .select("id, created_at")
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "bot")
    .eq("content_text", nextContent);

  const duplicateCurrentMessageIdsToDelete = (duplicatedCurrentMessageRows ?? [])
    .map((row: any) => ({
      id: String(row?.id ?? "").trim(),
      createdAt: String(row?.created_at ?? "").trim(),
    }))
    .filter((row) => row.id)
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
      return a.id.localeCompare(b.id);
    })
    .slice(1)
    .map((row) => row.id);

  if (duplicateCurrentMessageIdsToDelete.length > 0) {
    await admin.from("atendimento_messages").delete().in("id", duplicateCurrentMessageIdsToDelete);
  }

  if (nextIndex + 1 >= normalizedInitialMessages.length) {
    await admin
      .from("atendimento_leads")
      .update({
        status: "em_atendimento",
        funnel_stage: "aula_experimental_convidada",
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", params.leadId);

    await appendHistoryEvent({
      leadId: params.leadId,
      conversationId: params.conversationId,
      eventType: "stage_changed",
      title: "Fluxo inicial do bot iniciado",
      details: { funnel_stage: "aula_experimental_convidada" },
      actorType: "bot",
    });
  }

  await syncConversationPreview({
    conversationId: params.conversationId,
    contentText: String(inserted?.content_text ?? nextContent),
    createdAt: nowIso,
  });

  return true;
}

export async function syncConversationPreview(params: {
  conversationId: string;
  contentText?: string | null;
  createdAt?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  await admin
    .from("atendimento_conversations")
    .update({
      last_message_preview: summarizePreview(params.contentText ?? ""),
      last_message_at: params.createdAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId);
}

export async function appendHistoryEvent(params: {
  leadId: string;
  conversationId?: string | null;
  eventType: string;
  title: string;
  details?: Record<string, unknown> | null;
  actorType: "bot" | "lead" | "attendant" | "system" | "student";
  actorEmail?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  await admin.from("atendimento_history_events").insert({
    lead_id: params.leadId,
    conversation_id: params.conversationId ?? null,
    event_type: params.eventType,
    title: params.title,
    details: params.details ?? null,
    actor_type: params.actorType,
    actor_email: params.actorEmail ?? null,
  });
}

const REGISTERED_ATTENDANT_EXPERIMENTAL_LEAD_NOTICE_EVENT_TYPE =
  "registered_attendant_experimental_lead_first_pending_daytime_notice_sent";

export async function maybeNotifyRegisteredAttendantAboutNewExperimentalLeadPendingDayTime(params: {
  leadId: string;
  leadName: string | null | undefined;
  conversationId?: string | null;
}) {
  try {
    const admin = createSupabaseAdminClient();
    const { count: already } = await admin
      .from("atendimento_history_events")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", params.leadId)
      .eq("event_type", REGISTERED_ATTENDANT_EXPERIMENTAL_LEAD_NOTICE_EVENT_TYPE);
    if (already && already > 0) return { ok: true, deduped: true };
    const message = buildExperimentalClassRegisteredAttendantWhatsAppMessage(
      String(params.leadName ?? "").trim(),
    );
    await sendAtendimentoWhatsAppText({
      phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
      message,
    });
    await appendHistoryEvent({
      leadId: params.leadId,
      conversationId: params.conversationId ?? null,
      eventType: REGISTERED_ATTENDANT_EXPERIMENTAL_LEAD_NOTICE_EVENT_TYPE,
      title:
        "Atendente cadastrado avisado sobre novo interessado em aula experimental (Falta dia e horário)",
      details: { phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE },
      actorType: "system",
    });
    return { ok: true, sent: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const REGISTERED_ATTENDANT_EXPERIMENTAL_LEAD_SCHEDULED_NOTICE_EVENT_TYPE =
  "registered_attendant_experimental_lead_scheduled_notice_sent";

export async function maybeNotifyRegisteredAttendantAboutExperimentalClassScheduled(params: {
  leadId: string;
  leadName: string | null | undefined;
  conversationId?: string | null;
}) {
  try {
    const admin = createSupabaseAdminClient();
    const { count: already } = await admin
      .from("atendimento_history_events")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", params.leadId)
      .eq("event_type", REGISTERED_ATTENDANT_EXPERIMENTAL_LEAD_SCHEDULED_NOTICE_EVENT_TYPE);
    if (already && already > 0) return { ok: true, deduped: true };

    const { data: leadRow } = await admin
      .from("atendimento_leads")
      .select(
        "id, full_name, funnel_stage, experimental_class_status, experimental_class_lead_date, experimental_class_lead_time, experimental_class_professor_date, experimental_class_professor_time, experimental_class_booking_id",
      )
      .eq("id", params.leadId)
      .limit(1)
      .maybeSingle();
    const fs = String((leadRow as any)?.funnel_stage ?? "").trim().toLowerCase();
    const es = String((leadRow as any)?.experimental_class_status ?? "").trim().toLowerCase();
    const hasLd = Boolean(String((leadRow as any)?.experimental_class_lead_date ?? "").trim());
    const hasLt = Boolean(String((leadRow as any)?.experimental_class_lead_time ?? "").trim());
    const hasPd = Boolean(String((leadRow as any)?.experimental_class_professor_date ?? "").trim());
    const hasPt = Boolean(String((leadRow as any)?.experimental_class_professor_time ?? "").trim());
    const hasBooking = Boolean(String((leadRow as any)?.experimental_class_booking_id ?? "").trim());
    const isFunnelAgendada =
      fs === "aula_experimental_agendada" ||
      fs === "aula_experimental_realizada" ||
      fs === "aula_experimental_cancelada";
    const isStatusScheduledLike =
      es === "scheduled" ||
      es === "booked" ||
      es === "time_selected" ||
      es === "date_selected_link_sent" ||
      es === "completed" ||
      es === "cancelled";
    const hasBothDates = (hasLd && hasLt) || (hasPd && hasPt);
    const isActuallyScheduled = Boolean(isFunnelAgendada || isStatusScheduledLike || (hasBothDates && hasBooking));
    if (!isActuallyScheduled) {
      return { ok: true, skipped: true, reason: "lead ainda falta dia e horario" };
    }

    const firstName =
      String(params.leadName ?? (leadRow as any)?.full_name ?? "").trim().split(/\s+/)[0] ||
      "o interessado";
    const message = buildExperimentalClassRegisteredAttendantWhatsAppMessage(firstName);
    await sendAtendimentoWhatsAppText({
      phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
      message,
    });
    await appendHistoryEvent({
      leadId: params.leadId,
      conversationId: params.conversationId ?? null,
      eventType: REGISTERED_ATTENDANT_EXPERIMENTAL_LEAD_SCHEDULED_NOTICE_EVENT_TYPE,
      title:
        "Atendente cadastrado avisado sobre aula experimental AGENDADA (saiu de Falta dia e horário)",
      details: {
        phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
        funnel_stage: fs || null,
        experimental_class_status: es || null,
        has_lead_date: hasLd,
        has_lead_time: hasLt,
        has_professor_date: hasPd,
        has_professor_time: hasPt,
        has_booking_id: hasBooking,
      },
      actorType: "system",
    });
    return { ok: true, sent: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function upsertAtendimentoPresenceSession(params: {
  sessionId: string;
  conversationId: string;
  leadId: string;
  publicSlug: string;
}) {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  await admin.from("atendimento_presence_sessions").upsert(
    {
      id: params.sessionId,
      conversation_id: params.conversationId,
      lead_id: params.leadId,
      public_slug: params.publicSlug,
      updated_at: nowIso,
    },
    { onConflict: "id" },
  );

  await admin
    .from("atendimento_conversations")
    .update({
      offline_message_notification_sent: false,
      offline_message_notification_sent_at: null,
    })
    .eq("id", params.conversationId);
}

export async function removeAtendimentoPresenceSession(sessionId: string) {
  if (!String(sessionId ?? "").trim()) return;
  const admin = createSupabaseAdminClient();
  await admin.from("atendimento_presence_sessions").delete().eq("id", sessionId);
}

export async function getAtendimentoActivePresenceCount(conversationId: string) {
  const admin = createSupabaseAdminClient();
  const activeSinceIso = new Date(Date.now() - ATENDIMENTO_PRESENCE_SESSION_TTL_MS).toISOString();
  await admin
    .from("atendimento_presence_sessions")
    .delete()
    .eq("conversation_id", conversationId)
    .lt("updated_at", activeSinceIso);
  const { count } = await admin
    .from("atendimento_presence_sessions")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .gte("updated_at", activeSinceIso);
  return Number(count ?? 0);
}

export async function getAuthenticatedAtendimentoConversationAccess(publicSlug: string) {
  const auth = await requireAuthenticatedAtendimentoParticipant();
  if (!auth.ok || !auth.user?.id) {
    return { ok: false as const, status: 401, error: "unauthorized" };
  }

  const admin = createSupabaseAdminClient();
  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .select("id, lead_id, public_slug, bot_enabled")
    .eq("public_slug", publicSlug)
    .maybeSingle();

  if (!conversation?.id) {
    return { ok: false as const, status: 404, error: "not_found" };
  }

  const { data: lead } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("id", String(conversation.lead_id))
    .maybeSingle();

  if (!lead?.id) {
    return { ok: false as const, status: 404, error: "lead_not_found" };
  }

  if (String((lead as any).auth_user_id ?? "") !== auth.user.id) {
    return { ok: false as const, status: 403, error: "forbidden" };
  }

  return { ok: true as const, auth, admin, conversation, lead };
}

export async function getAtendimentoConversationAccessForAttendant(conversationId: string) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok || !auth.user?.email) {
    return { ok: false as const, status: 403, error: "forbidden" };
  }

  const admin = createSupabaseAdminClient();
  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .select("id, lead_id, public_slug, offline_message_notification_sent, offline_message_notification_sent_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation?.id) {
    return { ok: false as const, status: 404, error: "not_found" };
  }

  return { ok: true as const, auth, admin, conversation };
}

export async function getAtendimentoLeadFiles(leadId: string) {
  const admin = createSupabaseAdminClient();
  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .select("id")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!conversation?.id) {
    return [];
  }

  const { data: files } = await admin
    .from("atendimento_messages")
    .select("id, conversation_id, sender_role, content_text, media_type, media_url, mime_type, file_name, file_size_bytes, created_at")
    .eq("conversation_id", String(conversation.id))
    .not("media_url", "is", null)
    .order("created_at", { ascending: false });

  return (files ?? []).map((file) => ({
    ...(file as any),
    lead_id: leadId,
  }));
}

async function ensureAtendimentoFilesBucket() {
  const admin = createSupabaseAdminClient();
  const { data: buckets, error: bucketsError } = await admin.storage.listBuckets();
  if (!bucketsError && buckets?.some((bucket) => String(bucket.name ?? bucket.id ?? "") === ATENDIMENTO_FILES_BUCKET)) {
    return;
  }

  const { error: createError } = await admin.storage.createBucket(ATENDIMENTO_FILES_BUCKET, {
    public: true,
    fileSizeLimit: 262144000,
    allowedMimeTypes: [...ATENDIMENTO_ALLOWED_UPLOAD_MIME_TYPES],
  });

  if (createError) {
    const message = String(createError.message ?? "").toLowerCase();
    if (!message.includes("already exists") && !message.includes("duplicate")) {
      throw createError;
    }
  }
}

export async function uploadAtendimentoFileToStorage(params: {
  conversationId: string;
  senderRole: "lead" | "attendant";
  file: File;
}) {
  const mimeType = String(params.file.type ?? "").trim().toLowerCase();
  const mediaType = getAtendimentoMediaTypeFromMimeType(mimeType);
  if (!mediaType) {
    throw new Error("unsupported_file_type");
  }

  const admin = createSupabaseAdminClient();
  await ensureAtendimentoFilesBucket();
  const storagePath = buildAtendimentoStoragePath({
    conversationId: params.conversationId,
    senderRole: params.senderRole,
    originalFileName: params.file.name,
  });
  const arrayBuffer = await params.file.arrayBuffer();
  let { error } = await admin.storage.from(ATENDIMENTO_FILES_BUCKET).upload(storagePath, arrayBuffer, {
    contentType: mimeType,
    upsert: false,
  });

  if (error && String(error.message ?? "").toLowerCase().includes("bucket not found")) {
    await ensureAtendimentoFilesBucket();
    const retry = await admin.storage.from(ATENDIMENTO_FILES_BUCKET).upload(storagePath, arrayBuffer, {
      contentType: mimeType,
      upsert: false,
    });
    error = retry.error;
  }

  if (error) {
    throw new Error(error.message || "upload_failed");
  }

  const { data } = admin.storage.from(ATENDIMENTO_FILES_BUCKET).getPublicUrl(storagePath);

  return {
    media_url: String(data.publicUrl ?? "").trim(),
    media_type: mediaType,
    mime_type: mimeType || null,
    file_name: String(params.file.name ?? "").trim() || null,
    file_size_bytes: Number(params.file.size ?? 0) || 0,
    storage_path: storagePath,
  };
}

export async function findLeadByPhone(params: { phone: string; userId?: string | null }) {
  const admin = createSupabaseAdminClient();
  const normalizedSearch = normalizePhoneDigitsOnly(params.phone);
  if (!normalizedSearch) return null;

  function phoneCandidates(base: string): string[] {
    const out = new Set<string>();
    out.add(base);
    if (base.startsWith("55") && base.length >= 12) {
      out.add(base.slice(2));
    } else if (base.length >= 10 && !base.startsWith("55")) {
      out.add(`55${base}`);
    }
    if (base.length === 10 && !base.startsWith("55")) {
      const ddd = base.slice(0, 2);
      const rest = base.slice(2);
      out.add(`${ddd}9${rest}`);
      out.add(`55${ddd}9${rest}`);
    } else if (base.length === 11 && !base.startsWith("55") && base[2] === "9") {
      const ddd = base.slice(0, 2);
      const rest = base.slice(3);
      out.add(`${ddd}${rest}`);
      out.add(`55${ddd}${rest}`);
    } else if (base.length === 13 && base.startsWith("55") && base[4] === "9") {
      const ddd = base.slice(2, 4);
      const rest = base.slice(5);
      out.add(`55${ddd}${rest}`);
      out.add(`${ddd}${rest}`);
    } else if (base.length === 12 && base.startsWith("55")) {
      const ddd = base.slice(2, 4);
      const rest = base.slice(4);
      out.add(`55${ddd}9${rest}`);
      out.add(`${ddd}9${rest}`);
    }
    return Array.from(out);
  }

  const candidates = phoneCandidates(normalizedSearch);

  const { data: byDirect } = await admin
    .from("atendimento_leads")
    .select("*")
    .in("phone", candidates)
    .order("created_at", { ascending: false })
    .limit(10)
    .maybeSingle();

  if (byDirect && typeof (byDirect as any).id !== "undefined" && (byDirect as any).id) {
    return byDirect as any;
  }

  const { data: byAll } = await admin
    .from("atendimento_leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  const rowsAll = (byAll ?? []) as any[];
  for (const row of rowsAll) {
    const storedNorm = normalizePhoneDigitsOnly(row?.phone);
    if (!storedNorm) continue;
    const rowCandidates = phoneCandidates(storedNorm);
    if (rowCandidates.includes(normalizedSearch)) {
      return row as any;
    }
    for (const cand of candidates) {
      if (rowCandidates.includes(cand)) {
        return row as any;
      }
    }
  }

  const { data: byAssigned } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("assigned_user_email", ATENDIMENTO_EMAIL)
    .order("created_at", { ascending: false })
    .limit(300);

  const rows = (byAssigned ?? []) as any[];
  for (const row of rows) {
    if (phoneMatches(row?.phone, normalizedSearch)) {
      return row as any;
    }
  }

  return null;
}

export async function findLeadConversationByChannel(params: {
  leadId: string;
  channel: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("atendimento_conversations")
    .select("*")
    .eq("lead_id", String(params.leadId))
    .eq("channel", String(params.channel))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as any) ?? null;
}

export async function ensureWhatsAppLeadAndConversation(params: {
  phone: string;
  userId: string;
  creationOrigin: "zapi_from_header" | "trusted_explicit_call";
  firstNameFromMessage?: string | null;
  initialState?: string | null;
  initialStateNormalized?: string | null;
  initialTimezone?: string | null;
  initialCountry?: string | null;
}) {
  const admin = createSupabaseAdminClient();

  const allowedOrigins = new Set<unknown>(["zapi_from_header", "trusted_explicit_call"]);
  if (!allowedOrigins.has(params.creationOrigin)) {
    return null;
  }

  const normalizedPhone = normalizePhoneDigitsOnly(params.phone);
  if (!normalizedPhone || !isValidWhatsAppUserPhone(normalizedPhone)) {
    throw new Error(
      `Telefone informado nao corresponde a um usuario WhatsApp valido: ${normalizedPhone ? "len=" + normalizedPhone.length : "empty"}`,
    );
  }

  {
    const { data: instRow } = await admin
      .from("whatsapp_instances")
      .select("phone, instance_id")
      .eq("user_id", String(params.userId ?? ""))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: instRowGlobal } = await admin
      .from("whatsapp_instances")
      .select("phone, instance_id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let allInstancePhones: string[] = [];
    try {
      const { data: allInstRows } = await admin
        .from("whatsapp_instances")
        .select("phone")
        .not("phone", "is", null);
      allInstancePhones = (allInstRows ?? [])
        .map((r: any) => String(r?.phone ?? "").replace(/\D/g, ""))
        .filter((d: string) => d.length >= 10);
    } catch (_e) {}
    const candidateOurPhones: string[] = [];
    const p1 = String((instRow as any)?.phone ?? "").replace(/\D/g, "");
    if (p1.length >= 10) candidateOurPhones.push(p1);
    const p2 = String((instRowGlobal as any)?.phone ?? "").replace(/\D/g, "");
    if (p2.length >= 10) candidateOurPhones.push(p2);
    for (const extra of allInstancePhones) {
      if (!candidateOurPhones.includes(extra)) candidateOurPhones.push(extra);
    }
    for (const ourPhoneDigits of candidateOurPhones) {
      if (ourPhoneDigits.length >= 10 && normalizedPhone.length >= 10) {
        const ourKey = ourPhoneDigits.slice(-10);
        const rowKey = normalizedPhone.slice(-10);
        if (ourKey === rowKey || normalizedPhone.endsWith(ourKey) || ourPhoneDigits.endsWith(rowKey)) {
          return null;
        }
      }
    }
  }

  const hiddenBlocklist = await (async () => {
    try {
      const { loadHiddenWhatsAppPhoneBlocklist } = await import("@/lib/painelHiddenPhones");
      return (await loadHiddenWhatsAppPhoneBlocklist({ supabaseAdmin: admin })) ?? new Set<string>();
    } catch (_e) {
      return new Set<string>();
    }
  })();
  if (hiddenBlocklist.size > 0) {
    const { areBrazilianPhonesEquivalent } = await import("@/lib/painelHiddenPhones");
    let isBlocked = false;
    for (const blocked of hiddenBlocklist) {
      if (areBrazilianPhonesEquivalent(normalizedPhone, blocked)) {
        isBlocked = true;
        break;
      }
    }
    if (isBlocked) {
      return null;
    }
  }

  const publicLink = await ensureAtendimentoPublicLink();

  let lead = await findLeadByPhone({ phone: normalizedPhone, userId: params.userId });

  if (!lead?.id) {
    let anyEquivalentPhoneHasCancelledBooking = false;
    try {
      const norm10 = normalizedPhone.slice(-10);
      const { data: widePhoneRows } = await admin
        .from("atendimento_leads")
        .select("id, phone, latest_experimental_class_cancelled_at")
        .order("created_at", { ascending: false })
        .limit(800);
      const wideRows = (widePhoneRows ?? []) as any[];
      for (const wrow of wideRows) {
        if (!wrow?.phone) continue;
        if (!phoneMatches(String(wrow.phone), normalizedPhone)) continue;
        const cancelledAtRaw = String(wrow?.latest_experimental_class_cancelled_at ?? "").trim();
        if (cancelledAtRaw && cancelledAtRaw !== "null") {
          anyEquivalentPhoneHasCancelledBooking = true;
          break;
        }
        try {
          const { data: bookingMaybe } = await admin
            .from("atendimento_experimental_class_bookings")
            .select("id")
            .eq("lead_id", String(wrow.id))
            .eq("status", "cancelled")
            .limit(1)
            .maybeSingle();
          if ((bookingMaybe as any)?.id) {
            anyEquivalentPhoneHasCancelledBooking = true;
            break;
          }
        } catch (_eIn) {}
      }
    } catch (_e) {}
    if (anyEquivalentPhoneHasCancelledBooking) {
      return null;
    }

    const nameRaw = String(params.firstNameFromMessage ?? "").trim() || null;
    const initialState = params.initialState ? String(params.initialState).trim() : null;
    const initialCountry = params.initialCountry ? String(params.initialCountry).trim() : null;
    const initialTimezone = params.initialTimezone ? String(params.initialTimezone).trim() : null;

    const leadPatch: Record<string, unknown> = {
      phone: normalizedPhone,
      origin: "whatsapp_trafego_pago",
      status: "novo_lead",
      funnel_stage: "novo_lead",
      assigned_user_email: ATENDIMENTO_EMAIL,
      unread_count: 0,
      is_new_for_attendant: true,
      ...(nameRaw ? { full_name: nameRaw } : {}),
      ...(initialState ? { state: initialState } : {}),
      ...(initialCountry ? { country: initialCountry } : {}),
      ...(initialTimezone ? { timezone: initialTimezone } : {}),
    };

    const { data: createdLead } = await admin
      .from("atendimento_leads")
      .insert(leadPatch as any)
      .select("*")
      .maybeSingle();

    lead = createdLead;
  } else {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (!String((lead as any)?.phone ?? "").trim()) {
      updates.phone = normalizedPhone;
    }
    if (params.initialState && !String((lead as any)?.state ?? "").trim()) {
      updates.state = String(params.initialState).trim();
    }
    if (params.initialTimezone && !String((lead as any)?.timezone ?? "").trim()) {
      updates.timezone = String(params.initialTimezone).trim();
    }
    if (params.initialCountry && !String((lead as any)?.country ?? "").trim()) {
      updates.country = String(params.initialCountry).trim();
    }
    if (Object.keys(updates).length > 1) {
      const { data: refreshed } = await admin
        .from("atendimento_leads")
        .update(updates as any)
        .eq("id", String((lead as any).id))
        .select("*")
        .maybeSingle();
      if (refreshed) lead = refreshed;
    }
  }

  if (!(lead as any)?.id) {
    throw new Error("Não foi possível preparar o lead para atendimento via WhatsApp.");
  }

  let conversation = await findLeadConversationByChannel({
    leadId: String((lead as any).id),
    channel: "whatsapp",
  });

  if (!conversation?.id) {
    const { data: createdConversation } = await admin
      .from("atendimento_conversations")
      .insert({
        lead_id: String((lead as any).id),
        public_link_id: String(publicLink.id ?? ""),
        channel: "whatsapp",
        public_slug: makeConversationSessionSlug(),
        bot_enabled: true,
      })
      .select("*")
      .maybeSingle();
    conversation = createdConversation;
  }

  if (!conversation?.id) {
    throw new Error("Não foi possível preparar a conversa para atendimento via WhatsApp.");
  }

  return {
    lead: lead as any,
    conversation: conversation as any,
    publicLink: {
      slug: String(publicLink.slug ?? ATENDIMENTO_PUBLIC_LINK_SLUG),
      public_url: publicLink.public_url,
    },
  };
}

export async function hasAnyBotMessage(params: { conversationId: string }) {
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from("atendimento_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", String(params.conversationId))
    .eq("sender_role", "bot");

  if (error) {
    throw new Error(error.message || "Falha ao verificar mensagens do bot.");
  }
  return Number(count ?? 0) > 0;
}

export async function formalizeAndPersistContract(params: {
  admin?: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId?: string | null;
  enrollmentNumber?: string | null;
}) {
  const admin = params.admin ?? createSupabaseAdminClient();
  const leadId = String(params.leadId ?? "").trim();
  const conversationId = params.conversationId
    ? String(params.conversationId).trim() || null
    : null;
  const preferredEnrollmentNumber = String(params.enrollmentNumber ?? "").trim() || null;

  const { data: lead, error: leadErr } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("id", leadId)
    .limit(1)
    .maybeSingle();
  if (leadErr) return { ok: false, error: leadErr.message };
  if (!lead) return { ok: false, error: "Lead não encontrado." };

  let historyByField: Record<string, string> = {};
  try {
    const { data: hData } = await admin
      .from("atendimento_history_events")
      .select("event_type, details, created_at")
      .eq("lead_id", leadId)
      .eq("event_type", "contract_field_updated")
      .order("created_at", { ascending: false })
      .limit(50);
    const seen = new Set<string>();
    for (const ev of (hData ?? []) as any[]) {
      const details = (ev?.details ?? {}) as Record<string, unknown>;
      const field = String(details?.field ?? "").trim();
      if (!field || seen.has(field)) continue;
      const value = details?.value;
      if (value === null || value === undefined) continue;
      const strVal = typeof value === "string" ? value : String(value ?? "");
      if (strVal) {
        historyByField[field] = strVal;
        seen.add(field);
      }
    }
  } catch {}

  const effectiveLead: any = { ...(lead ?? {}) };

  const contractFull = typeof effectiveLead.contract_full_name === "string" ? String(effectiveLead.contract_full_name).trim() : "";
  const historyFull = String(historyByField["full_name"] ?? "").trim();
  if (contractFull || historyFull) {
    effectiveLead.full_name = contractFull || historyFull;
  }

  const signedAt = new Date().toISOString();
  const contractData = buildContractData({
    lead: effectiveLead as any,
    overrideSignedAtIso: signedAt,
  });
  const htmlSnapshot = buildContractHtml(contractData);
  const pdfBytes = await buildContractPdfBytes(contractData);
  const fileName = buildContractFileName(effectiveLead as any);
  const storagePath = `atendimento/contratos/${String((lead as any).id ?? leadId).slice(0, 12)}_${fileName}`;

  const { data: uploadData, error: uploadErr } = await admin.storage
    .from(ATENDIMENTO_FILES_BUCKET)
    .upload(storagePath, Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadErr) return { ok: false, error: uploadErr.message };

  const { data: publicUrlData } = admin.storage
    .from(ATENDIMENTO_FILES_BUCKET)
    .getPublicUrl(String(uploadData?.path ?? storagePath));
  const publicUrl = String(publicUrlData?.publicUrl ?? "").trim() || null;

  const funnel = String((lead as any).funnel_stage ?? "").trim();
  const status = String((lead as any).status ?? "").trim();
  const existingEnrollment =
    typeof (lead as any).enrollment_number === "string" &&
    String((lead as any).enrollment_number).trim().length > 0;
  const contractDataAny = contractData as any;
  const currentPaymentStatus = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  const paymentExplicitlyConfirmed =
    currentPaymentStatus === "confirmado" ||
    Boolean(contractDataAny?.paymentStatus === "confirmado") ||
    Boolean(contractDataAny?.paymentConfirmed === true);
  const advanceToPaymentPendingConfirmation =
    !paymentExplicitlyConfirmed &&
    (Boolean(
      (lead as any)?.recurring_registration_step &&
        Number((lead as any).recurring_registration_step) >= 10,
    ) ||
      Boolean(contractDataAny?.origin === "contract_finalize_payment"));

  const leadPatch: Record<string, unknown> = {
    contract_status: "assinado",
    contract_signed_at: signedAt,
    contract_pdf_url: publicUrl,
    contract_html_snapshot: htmlSnapshot,
    updated_at: signedAt,
    payment_status:
      currentPaymentStatus === "confirmado" ||
      currentPaymentStatus === "nao_realizado"
        ? (lead as any).payment_status
        : "pendente_confirmacao",
    payment_confirmed_at:
      currentPaymentStatus === "confirmado"
        ? ((lead as any).payment_confirmed_at ?? signedAt)
        : currentPaymentStatus === "nao_realizado"
          ? null
          : null,
    payment_rejected_at:
      currentPaymentStatus === "nao_realizado"
        ? ((lead as any).payment_rejected_at ?? signedAt)
        : null,
  };

  if (paymentExplicitlyConfirmed || existingEnrollment) {
    if (funnel !== "matriculado" && funnel !== "encerrado") {
      leadPatch.funnel_stage = "matriculado";
    }
    if (status !== "matriculado" && status !== "encerrado" && status !== "aluno") {
      leadPatch.status = "matriculado";
    }
  } else if (advanceToPaymentPendingConfirmation) {
    const currentStageIdx = ATENDIMENTO_STAGE_ORDER.indexOf(
      (funnel as (typeof ATENDIMENTO_STAGE_ORDER)[number]) ??
        ("" as (typeof ATENDIMENTO_STAGE_ORDER)[number]),
    );
    const currentStatusIdx = ATENDIMENTO_STATUS_ORDER.indexOf(
      (status as (typeof ATENDIMENTO_STATUS_ORDER)[number]) ??
        ("" as (typeof ATENDIMENTO_STATUS_ORDER)[number]),
    );
    const targetStageIdx = ATENDIMENTO_STAGE_ORDER.indexOf("pagamento_pendente_confirmacao");
    const targetStatusIdx = ATENDIMENTO_STATUS_ORDER.indexOf("pagamento_pendente_confirmacao");
    if (targetStageIdx >= 0 && (currentStageIdx < 0 || currentStageIdx < targetStageIdx)) {
      leadPatch.funnel_stage = "pagamento_pendente_confirmacao";
    }
    if (targetStatusIdx >= 0 && (currentStatusIdx < 0 || currentStatusIdx < targetStatusIdx)) {
      leadPatch.status = "pagamento_pendente_confirmacao";
    }
  } else {
    if (funnel !== "contrato_assinado" && funnel !== "matriculado" && funnel !== "encerrado"
        && funnel !== "pagamento_pendente_confirmacao" && funnel !== "pagamento_nao_realizado"
        && funnel !== "matricula_confirmada") {
      leadPatch.funnel_stage = "contrato_assinado";
    }
    if (
      status !== "contrato_assinado" &&
      status !== "matriculado" &&
      status !== "encerrado" &&
      status !== "aluno" &&
      status !== "pagamento_pendente_confirmacao" &&
      status !== "pagamento_nao_realizado" &&
      status !== "matricula_confirmada"
    ) {
      leadPatch.status = "contrato_assinado";
    }
  }

  let enrollmentNumber =
    preferredEnrollmentNumber ??
    (typeof (lead as any).enrollment_number === "string"
      ? String((lead as any).enrollment_number).trim()
      : "");
  if (!enrollmentNumber) {
    try {
      const { data: histRow } = await admin
        .from("atendimento_history_events")
        .select("id, event_type, details, created_at")
        .eq("lead_id", leadId)
        .eq("event_type", "enrollment_number_generated")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle() as any;
      if (histRow && typeof (histRow as any)?.details === "object" && (histRow as any).details != null) {
        const maybe = String(((histRow as any).details as any)?.enrollment_number ?? "").trim();
        if (maybe) enrollmentNumber = maybe;
      }
    } catch {}
  }
  if (!enrollmentNumber) {
    enrollmentNumber = (() => {
      const year = String(new Date().getUTCFullYear());
      const tail = Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");
      const ts = String(Date.now()).slice(-6);
      return `LB${year}${ts}0${tail}`;
    })();
  }
  if (enrollmentNumber) {
    leadPatch.enrollment_number = enrollmentNumber;
  }

  if (enrollmentNumber && !preferredEnrollmentNumber && !(typeof (lead as any).enrollment_number === "string" && String((lead as any).enrollment_number).trim().length > 0)) {
    try {
      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "enrollment_number_generated",
        title: "Número de matrícula gerado",
        details: {
          enrollment_number: enrollmentNumber,
          gerado_em: signedAt,
        },
        actorType: "system",
      });
    } catch (_e) {}
  }

  try {
    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "contrato_assinado",
      title: "Matrícula confirmada e PDF gerado",
      details: {
        contract_pdf_url: publicUrl,
        contract_signed_at: signedAt,
        local_assinatura: formatLocalizedDateSigned(signedAt),
        aluno: contractData.studentFullName,
        dia_aula: contractData.classWeekdayLabel,
        horario_aula: contractData.classTimeLabel,
        storage_path: storagePath,
        enrollment_number: enrollmentNumber || null,
      },
      actorType: "system",
    });
  } catch (_e) {}

  const runPatchFormalize = async (p: Record<string, unknown>): Promise<{ ok: boolean; error?: any }> => {
    const { error } = await admin
      .from("atendimento_leads")
      .update(p)
      .eq("id", leadId);
    if (!error) return { ok: true };
    const code = String((error as any)?.code ?? "").trim();
    if (code === "42703" || extractUndefinedColumnName((error as any)?.message) !== null) {
      const stripped = stripUndefinedColumnFromPatch(p, error);
      if (stripped.next) {
        if (Object.keys(stripped.next).length === 0) return { ok: true };
        return runPatchFormalize(stripped.next);
      }
    }
    return { ok: false, error };
  };
  const patchFormalize = await runPatchFormalize(leadPatch);
  if (!patchFormalize.ok) {
    return { ok: false, error: (patchFormalize as any).error?.message ?? "Falha ao formalizar contrato." };
  }

  try {
    const firstName = contractData.studentFullName.trim().split(/\s+/)[0] || contractData.studentFullName || "Aluno";
    await sendAtendimentoWhatsAppText({
      phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
      message: buildRecurringClassPostEnrollmentRegisteredAttendantNotification(
        firstName,
        contractData.classWeekdayLabel || "-",
        contractData.classTimeLabel || "-",
      ),
    });
    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "recurring_class_registered_attendant_post_enrollment_notification_sent",
      title: "Notificação de matrícula recorrente confirmada enviada ao atendente cadastrado",
      details: {
        phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
        aluno: contractData.studentFullName,
        dia_aula: contractData.classWeekdayLabel,
        horario_aula: contractData.classTimeLabel,
      },
      actorType: "system",
    });
  } catch (error) {
    try {
      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "recurring_class_registered_attendant_post_enrollment_notification_failed",
        title: "Falha ao enviar notificação de matrícula recorrente confirmada ao atendente cadastrado",
        details: {
          phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
          aluno: contractData.studentFullName,
          dia_aula: contractData.classWeekdayLabel,
          horario_aula: contractData.classTimeLabel,
          error: error instanceof Error ? error.message : String(error),
        },
        actorType: "system",
      });
    } catch (_e) {}
  }

  try {
    await admin
      .from("atendimento_files")
      .insert({
        lead_id: leadId,
        conversation_id: conversationId,
        sender_role: "system",
        content_text:
          "Confirmação de matrícula – PDF gerado após formalização.",
        media_type: "document",
        media_url: publicUrl,
        mime_type: "application/pdf",
        file_name: fileName,
        file_size_bytes: Number(pdfBytes?.byteLength ?? 0) || null,
      });
  } catch (_e) {}

  return {
    ok: true,
    signed: true,
    contract_signed_at: signedAt,
    contract_pdf_url: publicUrl,
    contract_html_snapshot: htmlSnapshot,
    enrollment_number: enrollmentNumber || null,
  };
}

function buildSyntheticStudentEmail(phoneDigits: string) {
  const clean = String(phoneDigits ?? "").replace(/\D/g, "").trim();
  const tail = clean.slice(-10) || clean;
  if (!tail) return null;
  return `tel.${tail}@aluno.autobot.business`;
}

function extractStudentPasswordFromLead(lead: any) {
  const candidates = [
    (lead as any)?.recurring_registration_password,
    (lead as any)?.signup_password_raw_temp,
    (lead as any)?.password,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length >= 4) return c.trim();
  }
  return null;
}

async function isStudentLoginPhoneMatch(admin: ReturnType<typeof createSupabaseAdminClient>, phone: string, studentPhone?: string | null) {
  const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
  const refDig = dig(studentPhone ?? "");
  if (!refDig) return false;
  const cmp = dig(phone);
  if (!cmp) return false;
  return cmp.includes(refDig) || refDig.includes(cmp);
}

export function isLeadRecurringRegistrationConcluded(lead: unknown): boolean {
  const obj = (lead ?? {}) as Record<string, unknown>;
  const payStatusRaw = String(obj?.payment_status ?? "").trim().toLowerCase();
  const payConfirmedAtRaw = String(obj?.payment_confirmed_at ?? "").trim();
  const leadStatusRaw = String(obj?.status ?? "").trim().toLowerCase();
  const funnelRaw = String(obj?.funnel_stage ?? "").trim().toLowerCase();
  return (
    payStatusRaw === "confirmado" ||
    payStatusRaw === "matriculado" ||
    Boolean(payConfirmedAtRaw && payConfirmedAtRaw !== "null") ||
    leadStatusRaw === "matriculado" ||
    leadStatusRaw === "matricula_confirmada" ||
    funnelRaw === "matriculado" ||
    funnelRaw === "matricula_confirmada"
  );
}

export async function ensureStudentAuthUserCreatedForLead(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  lead: any;
  dashboardLink?: string | null;
}) {
  const { admin, leadId, lead } = params;
  if (!lead?.id) return { ok: false, created: false, userId: null, email: null };
  const rawPhone = String(lead.phone ?? (lead as any)?.telefone ?? "").trim();
  const phoneDigits = rawPhone.replace(/\D/g, "");
  const studentEmailFromLead =
    typeof (lead as any)?.student_email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String((lead as any).student_email).trim())
      ? String((lead as any).student_email).trim()
      : typeof (lead as any)?.email === "string" &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String((lead as any).email).trim())
        ? String((lead as any).email).trim()
        : null;
  const studentPassword = extractStudentPasswordFromLead(lead);
  if (!studentPassword) return { ok: false, created: false, userId: null, email: studentEmailFromLead };

  let email = studentEmailFromLead || buildSyntheticStudentEmail(phoneDigits);
  if (!email) return { ok: false, created: false, userId: null, email: null };
  const fullName =
    typeof lead.full_name === "string" && lead.full_name.trim()
      ? lead.full_name.trim()
      : "Aluno(a) Lucas Brum Online Music USA";

  let userId: string | null = null;
  let created = false;
  try {
    const { data: existing } = await admin.auth.admin.listUsers({
      perPage: 50,
    });
    let match: any = null;
    let mustDeleteBeforeRecreate = false;
    if (Array.isArray((existing as any)?.users)) {
      for (const u of (existing as any).users) {
        const uEmail = String(u.email ?? "").toLowerCase();
        const uPhone = String(u.phone ?? u.phone_number ?? "").trim();
        let isMatch = false;
        if (uEmail && uEmail === email.toLowerCase()) {
          isMatch = true;
        } else if (phoneDigits && (await isStudentLoginPhoneMatch(admin, uPhone, phoneDigits))) {
          isMatch = true;
        }
        if (!isMatch) continue;
        const leadIdFromMeta =
          typeof u === "object" &&
          u !== null &&
          typeof (u as any).user_metadata === "object" &&
          (u as any).user_metadata !== null &&
          typeof (u as any).user_metadata.lead_id === "string"
            ? String((u as any).user_metadata.lead_id).trim()
            : "";
        let boundLeadExists = false;
        if (leadIdFromMeta) {
          try {
            const { data, error } = await admin
              .from("atendimento_leads")
              .select("id, auth_user_id")
              .eq("id", leadIdFromMeta)
              .maybeSingle();
            if (!error && data && (data as any).id) {
              const boundAuthUserId = String((data as any).auth_user_id ?? "").trim();
              if (boundAuthUserId === String(u.id ?? "").trim()) {
                boundLeadExists = true;
              }
            }
          } catch {}
        }
        if (!boundLeadExists && leadIdFromMeta) {
          try {
            const { data, error } = await admin
              .from("atendimento_leads")
              .select("id")
              .eq("auth_user_id", String(u.id ?? "").trim())
              .maybeSingle();
            if (!error && data && (data as any).id) boundLeadExists = true;
          } catch {}
        }
        if (!boundLeadExists) {
          try {
            const { data, error } = await admin
              .from("atendimento_leads")
              .select("id")
              .eq("auth_user_id", String(u.id ?? "").trim())
              .maybeSingle();
            if (!error && data && (data as any).id) boundLeadExists = true;
          } catch {}
        }
        if (!boundLeadExists) {
          try {
            await admin.from("profiles").delete().eq("user_id", String(u.id ?? "").trim());
          } catch {}
          try {
            await admin.auth.admin.deleteUser(String(u.id ?? "").trim());
          } catch {}
          continue;
        }
        if (leadIdFromMeta === leadId || !leadIdFromMeta) {
          match = u;
          break;
        } else {
          mustDeleteBeforeRecreate = true;
          try {
            await admin.from("profiles").delete().eq("user_id", String(u.id ?? "").trim());
          } catch {}
          try {
            await admin.auth.admin.deleteUser(String(u.id ?? "").trim());
          } catch {}
        }
      }
    }
    if (mustDeleteBeforeRecreate) {
      match = null;
    }
    if (match && typeof match === "object" && "id" in match) {
      userId = String((match as any).id);
      try {
        await admin.auth.admin.updateUserById(userId, {
          password: studentPassword,
          app_metadata: {
            ...(match && typeof match === "object" && "app_metadata" in match && (match as any).app_metadata && typeof (match as any).app_metadata === "object"
              ? (match as any).app_metadata
              : {}),
            access_scope: "aluno",
          },
          user_metadata: {
            lead_id: leadId,
            student_phone_digits: phoneDigits || null,
            full_name: fullName,
            origin: "aluno_matricula_recorrente",
          },
        });
      } catch {}
    } else {
      const { data } = await admin.auth.admin.createUser({
        email,
        password: studentPassword,
        email_confirm: true,
        phone: phoneDigits ? `+${phoneDigits}` : undefined,
        phone_confirm: true,
        user_metadata: {
          lead_id: leadId,
          student_phone_digits: phoneDigits || null,
          full_name: fullName,
          origin: "aluno_matricula_recorrente",
        },
        app_metadata: {
          access_scope: "aluno",
        },
      });
      userId = (data as any)?.user?.id ? String((data as any).user.id) : null;
      created = !!userId;
    }
  } catch (e) {
    try {
      await appendHistoryEvent({
        leadId,
        eventType: "student_auth_user_creation_failed",
        title: "Falha ao criar usuário Painel do Aluno",
        details: {
          error: e instanceof Error ? e.message : String(e),
          email,
        },
        actorType: "system",
      });
    } catch {}
    return { ok: false, created: false, userId: null, email };
  }

  if (userId) {
    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("user_id, access_scope, email, phone")
        .eq("user_id", String(userId))
        .maybeSingle();
      if ((profile as any)?.user_id) {
        await admin
          .from("profiles")
          .update({
            access_scope: "aluno",
            email: email,
            phone: phoneDigits ? phoneDigits : (profile as any).phone,
            full_name: fullName,
          })
          .eq("user_id", String(userId));
      } else {
        try {
          await admin.from("profiles").insert({
            user_id: userId,
            access_scope: "aluno",
            email,
            phone: phoneDigits ? phoneDigits : null,
            full_name: fullName,
          });
        } catch (insErr) {
          const code = String((insErr as any)?.code ?? "").trim();
          const msg = String((insErr as any)?.message ?? "").toLowerCase();
          const ignore = code === "42703" || msg.includes("column") && msg.includes("does not exist");
          if (!ignore) {
            try {
              await appendHistoryEvent({
                leadId,
                eventType: "student_auth_profile_insert_failed",
                title: "Falha ao gravar perfil do Painel do Aluno (colunas incompatíveis, ignorar)",
                details: {
                  error: insErr instanceof Error ? insErr.message : String(insErr),
                  user_id: userId,
                },
                actorType: "system",
              });
            } catch {}
          }
        }
      }
      try {
        await appendHistoryEvent({
          leadId,
          eventType: "student_auth_user_created",
          title: "Usuário Painel do Aluno criado",
          details: {
            user_id: userId,
            email,
            phone_digits: phoneDigits || null,
            created,
          },
          actorType: "system",
        });
      } catch {}
    } catch {}
  }
  return { ok: !!userId, created, userId, email };
}

const SUSPECT_MISSING_COLUMNS_BL = [
  "payment_confirmed_at",
  "payment_rejected_at",
  "contract_signed_at",
  "contract_pdf_url",
  "recurring_registration_step",
  "contract_status",
  "payment_status",
  "enrollment_number",
  "recurring_class_professor_date",
  "recurring_class_first_class_at",
] as const;

function extractUndefinedColumnName(raw: unknown): string | null {
  if (!raw) return null;
  const msg = String(raw).toLowerCase();
  const m1 = /column "([^"]+)" does not exist/.exec(msg);
  if (m1 && m1[1]) return m1[1];
  const m2 = /could not find the '([^']+)' column/.exec(msg);
  if (m2 && m2[1]) return m2[1];
  return null;
}

function stripUndefinedColumnFromPatch(patchObj: Record<string, unknown>, error: unknown): {
  next: Record<string, unknown> | null;
  stripped: string | null;
} {
  const col = extractUndefinedColumnName((error as any)?.message || String(error ?? ""));
  if (col && patchObj[col] !== undefined) {
    const next = { ...patchObj };
    delete next[col];
    return { next, stripped: col };
  }
  for (const sus of SUSPECT_MISSING_COLUMNS_BL) {
    if (patchObj[sus] !== undefined) {
      const next = { ...patchObj };
      delete next[sus];
      return { next, stripped: sus };
    }
  }
  return { next: null, stripped: null };
}

export async function confirmLeadRecurringPayment(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  actorType?: "system" | "attendant" | "student";
  attendantEmail?: string | null;
}) {
  const { admin, leadId, actorType = "attendant", attendantEmail = null } = params;
  const { data: lead, error: leadErr } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("id", String(leadId))
    .maybeSingle();
  if (leadErr || !lead) return { ok: false, error: leadErr?.message ?? "Lead não encontrado." };

  const payStatusNow = String((lead as any).payment_status ?? "").trim().toLowerCase();
  const payConfirmedAtRaw = String((lead as any).payment_confirmed_at ?? "").trim();
  const alreadyConfirmed =
    payStatusNow === "confirmado" ||
    payStatusNow === "matriculado" ||
    Boolean(payConfirmedAtRaw && payConfirmedAtRaw !== "null") ||
    String((lead as any).status ?? "").trim() === "matriculado" ||
    String((lead as any).status ?? "").trim() === "matricula_confirmada" ||
    String((lead as any).funnel_stage ?? "").trim() === "matriculado" ||
    String((lead as any).funnel_stage ?? "").trim() === "matricula_confirmada";

  const now = new Date().toISOString();
  const patch: any = {
    payment_status: "confirmado",
    payment_confirmed_at: now,
    updated_at: now,
  };
  const currentStage = String((lead as any).funnel_stage ?? "");
  const currentStatus = String((lead as any).status ?? "");
  const stageIdx = ATENDIMENTO_STAGE_ORDER.indexOf(
    currentStage as (typeof ATENDIMENTO_STAGE_ORDER)[number],
  );
  const statusIdx = ATENDIMENTO_STATUS_ORDER.indexOf(
    currentStatus as (typeof ATENDIMENTO_STATUS_ORDER)[number],
  );
  const targetStageIdx = ATENDIMENTO_STAGE_ORDER.indexOf("matriculado");
  const targetStatusIdx = ATENDIMENTO_STATUS_ORDER.indexOf("matriculado");
  if (targetStageIdx >= 0 && (stageIdx < 0 || stageIdx < targetStageIdx)) {
    patch.funnel_stage = "matriculado";
  }
  if (targetStatusIdx >= 0 && (statusIdx < 0 || statusIdx < targetStatusIdx)) {
    patch.status = "matriculado";
  }

  try {
    if (!alreadyConfirmed) {
      await appendHistoryEvent({
        leadId,
        eventType: "recurring_payment_confirmed",
        title: "Pagamento marcado como Sim (confirmado)",
        details: {
          enrollment_number: (lead as any).enrollment_number || null,
          confirmed_at: now,
          confirmed_by: attendantEmail || (actorType === "attendant" ? "Atendente painel" : actorType),
          idempotent: false,
        },
        actorType,
      });
    }
  } catch {}

  if (alreadyConfirmed) {
    try {
      await ensureStudentAuthUserCreatedForLead({ admin, leadId, lead });
    } catch {}
    return {
      ok: true,
      confirmed_at: payConfirmedAtRaw || now,
      idempotent: true,
    };
  }

  let applied = false;
  const runPatch = async (p: any) => {
    const { error } = await admin
      .from("atendimento_leads")
      .update(p)
      .eq("id", String(leadId));
    if (!error) {
      applied = true;
      return { ok: true };
    }
    const code = String((error as any)?.code ?? "").trim();
    if (code === "42703" || extractUndefinedColumnName((error as any)?.message) !== null) {
      const stripped = stripUndefinedColumnFromPatch(p, error);
      if (stripped.next) {
        if (Object.keys(stripped.next).length === 0) {
          applied = true;
          return { ok: true };
        }
        return runPatch(stripped.next);
      }
    }
    return { ok: false, error };
  };
  const patchRes = await runPatch(patch);
  if (!patchRes.ok && !applied) {
    return { ok: false, error: (patchRes as any).error?.message ?? "Falha ao atualizar lead." };
  }

  try {
    await ensureStudentAuthUserCreatedForLead({
      admin,
      leadId,
      lead,
    });
  } catch {}

  try {
    const fullName = String((lead as any).full_name ?? "").trim();
    const firstName = fullName.split(/\s+/)[0] || fullName || null;
    const studentPhone = String((lead as any).phone ?? (lead as any)?.telefone ?? "").trim();
    const phoneDigits = studentPhone.replace(/\D/g, "").trim();
    let dashboardLink = EXPERIMENTAL_CLASS_DEFAULT_STUDENT_DASHBOARD_LINK;
    if (phoneDigits.length >= 10) {
      try {
        const sp = new URLSearchParams();
        sp.set("telefone", phoneDigits);
        if (typeof leadId === "string" && leadId) sp.set("id", leadId);
        dashboardLink = `${EXPERIMENTAL_CLASS_DEFAULT_STUDENT_DASHBOARD_LINK.replace(/\/$/, "")}?${sp.toString()}`;
      } catch {}
    }
    const studentMsg = buildRecurringPaymentConfirmedStudentWelcomeMessage(firstName, dashboardLink);
    if (studentPhone && phoneDigits.length >= 10) {
      try {
        await sendAtendimentoWhatsAppText({
          phone: studentPhone,
          message: studentMsg,
          baseUrl: undefined as any,
        });
        try {
          await appendHistoryEvent({
            leadId,
            eventType: "recurring_payment_confirmed_welcome_whatsapp_sent",
            title: "Notificação de boas-vindas enviada (pagamento confirmado)",
            details: {
              enrollment_number: (lead as any).enrollment_number || null,
              student_phone: studentPhone,
              dashboard_link: dashboardLink,
            },
            actorType: "system",
          });
        } catch {}
      } catch (e) {
        try {
          await appendHistoryEvent({
            leadId,
            eventType: "recurring_payment_confirmed_welcome_whatsapp_failed",
            title: "Falha ao enviar notificação de boas-vindas",
            details: {
              error: e instanceof Error ? e.message : String(e),
              student_phone: studentPhone,
              dashboard_link: dashboardLink,
            },
            actorType: "system",
          });
        } catch {}
      }
    }
  } catch (outerE) {
    try {
      const studentPhone = String((lead as any).phone ?? (lead as any)?.telefone ?? "").trim();
      await appendHistoryEvent({
        leadId,
        eventType: "recurring_payment_confirmed_welcome_whatsapp_failed",
        title: "Falha ao enviar notificação de boas-vindas",
        details: {
          error: outerE instanceof Error ? outerE.message : String(outerE),
          student_phone: studentPhone || null,
        },
        actorType: "system",
      });
    } catch {}
  }

  return { ok: true, confirmed_at: now };
}

export async function rejectLeadRecurringPayment(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  reason?: string | null;
  actorType?: "system" | "attendant";
  attendantEmail?: string | null;
}) {
  const { admin, leadId, reason = null, actorType = "attendant", attendantEmail = null } = params;
  const { data: lead, error: leadErr } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("id", String(leadId))
    .maybeSingle();
  if (leadErr || !lead) return { ok: false, error: leadErr?.message ?? "Lead não encontrado." };

  const payStatusNow = String((lead as any).payment_status ?? "").trim().toLowerCase();
  const payConfirmedAtRaw = String((lead as any).payment_confirmed_at ?? "").trim();
  const payRejectedAtRaw = String((lead as any).payment_rejected_at ?? "").trim();
  const alreadyConfirmed =
    payStatusNow === "confirmado" ||
    payStatusNow === "matriculado" ||
    Boolean(payConfirmedAtRaw && payConfirmedAtRaw !== "null") ||
    String((lead as any).status ?? "").trim() === "matriculado" ||
    String((lead as any).status ?? "").trim() === "matricula_confirmada" ||
    String((lead as any).funnel_stage ?? "").trim() === "matriculado" ||
    String((lead as any).funnel_stage ?? "").trim() === "matricula_confirmada";
  const alreadyRejected =
    !alreadyConfirmed &&
    (payStatusNow === "nao_realizado" ||
      Boolean(payRejectedAtRaw && payRejectedAtRaw !== "null") ||
      String((lead as any).status ?? "").trim() === "pagamento_nao_realizado" ||
      String((lead as any).funnel_stage ?? "").trim() === "pagamento_nao_realizado");

  if (alreadyConfirmed) {
    return {
      ok: false,
      blocked: true,
      error: "Pagamento já foi confirmado anteriormente e não pode ser alterado.",
    };
  }

  if (alreadyRejected) {
    return {
      ok: true,
      idempotent: true,
      rejected_at: payRejectedAtRaw || new Date().toISOString(),
    };
  }

  const now = new Date().toISOString();
  const patch: any = {
    payment_status: "nao_realizado",
    payment_rejected_at: now,
    updated_at: now,
  };
  const currentStage = String((lead as any).funnel_stage ?? "");
  const currentStatus = String((lead as any).status ?? "");
  const stageIdx = ATENDIMENTO_STAGE_ORDER.indexOf(
    currentStage as (typeof ATENDIMENTO_STAGE_ORDER)[number],
  );
  const statusIdx = ATENDIMENTO_STATUS_ORDER.indexOf(
    currentStatus as (typeof ATENDIMENTO_STATUS_ORDER)[number],
  );
  const targetStageIdx = ATENDIMENTO_STAGE_ORDER.indexOf("pagamento_nao_realizado");
  const targetStatusIdx = ATENDIMENTO_STATUS_ORDER.indexOf("pagamento_nao_realizado");
  if (targetStageIdx >= 0 && (stageIdx < 0 || stageIdx < targetStageIdx)) {
    patch.funnel_stage = "pagamento_nao_realizado";
  }
  if (targetStatusIdx >= 0 && (statusIdx < 0 || statusIdx < targetStatusIdx)) {
    patch.status = "pagamento_nao_realizado";
  }

  try {
    await appendHistoryEvent({
      leadId,
      eventType: "recurring_payment_rejected",
      title: "Pagamento marcado como Não (não realizado)",
      details: {
        enrollment_number: (lead as any).enrollment_number || null,
        rejected_at: now,
        rejected_by: attendantEmail || (actorType === "attendant" ? "Atendente painel" : actorType),
        reason: reason ? String(reason).trim() : null,
      },
      actorType,
    });
  } catch {}

  const runPatch = async (p: any): Promise<{ ok: boolean; error?: any }> => {
    const { error } = await admin
      .from("atendimento_leads")
      .update(p)
      .eq("id", String(leadId));
    if (!error) return { ok: true };
    const code = String((error as any)?.code ?? "").trim();
    if (code === "42703" || extractUndefinedColumnName((error as any)?.message) !== null) {
      const stripped = stripUndefinedColumnFromPatch(p, error);
      if (stripped.next) {
        if (Object.keys(stripped.next).length === 0) return { ok: true };
        return runPatch(stripped.next);
      }
    }
    return { ok: false, error };
  };
  const patchRes = await runPatch(patch);
  if (!patchRes.ok) {
    return { ok: false, error: (patchRes as any).error?.message ?? "Falha ao atualizar lead." };
  }
  return { ok: true, rejected_at: now };
}

export async function triggerRecurringPaymentIntentIfNeeded(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  triggeredFrom:
    | "contract_finalize_step6_entry"
    | "contract_finalize_finalizar_matricula"
    | "draft_step6_entry"
    | "whatsapp_bot_contract_signed";
  enrollmentNumber?: string | null;
}) {
  const { admin, leadId, triggeredFrom } = params;
  let enrollmentNumber = String(params.enrollmentNumber ?? "").trim() || null;

  const { data: lead, error: leadErr } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("id", String(leadId))
    .maybeSingle();
  if (leadErr || !lead) return { ok: false, error: leadErr?.message ?? "Lead não encontrado." };

  const paymentStatusRaw = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  const paymentAlreadyResolved =
    paymentStatusRaw === "pendente_confirmacao" ||
    paymentStatusRaw === "nao_realizado" ||
    paymentStatusRaw === "confirmado";

  if (!enrollmentNumber) {
    enrollmentNumber = String((lead as any)?.enrollment_number ?? "").trim() || null;
  }
  if (!enrollmentNumber) {
    try {
      const { data: histRows } = await admin
        .from("atendimento_history_events")
        .select("id, event_type, details, created_at")
        .eq("lead_id", String(leadId))
        .eq("event_type", "enrollment_number_generated")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle() as any;
      if (histRows && histRows != null && typeof (histRows as any)?.details === "object" && (histRows as any).details != null) {
        const maybeEnroll = String(((histRows as any).details as any)?.enrollment_number ?? "").trim();
        if (maybeEnroll) enrollmentNumber = maybeEnroll;
      }
    } catch {}
  }

  if (paymentAlreadyResolved) {
    return {
      ok: true,
      skipped: true,
      reason: "pagamento_ja_resolvido",
      current_payment_status: paymentStatusRaw,
    };
  }

  const now = new Date().toISOString();
  const currentStage = String((lead as any)?.funnel_stage ?? "");
  const currentStatus = String((lead as any)?.status ?? "");
  const stageIdx = ATENDIMENTO_STAGE_ORDER.indexOf(
    currentStage as (typeof ATENDIMENTO_STAGE_ORDER)[number],
  );
  const statusIdx = ATENDIMENTO_STATUS_ORDER.indexOf(
    currentStatus as (typeof ATENDIMENTO_STATUS_ORDER)[number],
  );
  const targetStage = "pagamento_pendente_confirmacao" as const;
  const targetStatus = "pagamento_pendente_confirmacao" as const;
  const targetStageIdx = ATENDIMENTO_STAGE_ORDER.indexOf(targetStage);
  const targetStatusIdx = ATENDIMENTO_STATUS_ORDER.indexOf(targetStatus);

  const patch: any = {
    payment_status: "pendente_confirmacao",
    payment_confirmed_at: null,
    payment_rejected_at: null,
    updated_at: now,
  };
  if (targetStageIdx >= 0 && (stageIdx < 0 || stageIdx < targetStageIdx)) {
    patch.funnel_stage = targetStage;
  }
  if (targetStatusIdx >= 0 && (statusIdx < 0 || statusIdx < targetStatusIdx)) {
    patch.status = targetStatus;
  }
  if (enrollmentNumber) {
    patch.enrollment_number = enrollmentNumber;
  }

  try {
    await appendHistoryEvent({
      leadId,
      eventType: "recurring_payment_intent_registered",
      title: "Intenção de pagamento registrada (pagamento pendente)",
      details: {
        enrollment_number: enrollmentNumber || null,
        triggered_from: triggeredFrom,
        pending_since: now,
      },
      actorType: "system",
    });
  } catch {}

  const runPatch = async (p: any): Promise<{ ok: boolean; error?: any }> => {
    const { error } = await admin
      .from("atendimento_leads")
      .update(p)
      .eq("id", String(leadId));
    if (!error) return { ok: true };
    const code = String((error as any)?.code ?? "").trim();
    if (code === "42703" || extractUndefinedColumnName((error as any)?.message) !== null) {
      const stripped = stripUndefinedColumnFromPatch(p, error);
      if (stripped.next) {
        if (Object.keys(stripped.next).length === 0) return { ok: true };
        return runPatch(stripped.next);
      }
    }
    return { ok: false, error };
  };
  const patchRes = await runPatch(patch);
  if (!patchRes.ok) {
    return { ok: false, error: (patchRes as any).error?.message ?? "Falha ao atualizar lead." };
  }

  try {
    const { count: alreadySent } = await admin
      .from("atendimento_history_events")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("event_type", "attendant_payment_pending_confirmation_sent");
    if (!alreadySent || alreadySent <= 0) {
      const attendantMsg = buildRecurringPaymentPendingConfirmationAttendantNotification(
        String((lead as any)?.full_name ?? null),
        enrollmentNumber || null,
      );
      await sendAtendimentoWhatsAppText({
        phone: ATENDIMENTO_DAILY_SUMMARY_PHONE,
        message: attendantMsg,
      });
      try {
        await appendHistoryEvent({
          leadId,
          eventType: "attendant_payment_pending_confirmation_sent",
          title: "Notificação atendente: Pagamento pendente enviada",
          details: {
            enrollment_number: enrollmentNumber || null,
            attendant_phone: ATENDIMENTO_DAILY_SUMMARY_PHONE,
            triggered_from: triggeredFrom,
          },
          actorType: "system",
        });
      } catch {}
    }
  } catch {}

  try {
    const { data: conversations } = await admin
      .from("atendimento_conversations")
      .select("id")
      .eq("lead_id", String(leadId))
      .eq("channel", "whatsapp")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if ((conversations as any)?.id) {
      try {
        await syncConversationPreview({
          conversationId: String((conversations as any).id),
        });
      } catch {}
    }
  } catch {}

  return {
    ok: true,
    triggered: true,
    enrollment_number: enrollmentNumber,
    pending_since: now,
  };
}
