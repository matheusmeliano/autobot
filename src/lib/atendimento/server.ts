import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ATENDIMENTO_EMAIL, ATENDIMENTO_PUBLIC_LINK_SLUG } from "@/lib/atendimento/constants";
import {
  ATENDIMENTO_FILES_BUCKET,
  ATENDIMENTO_ALLOWED_UPLOAD_MIME_TYPES,
  buildAtendimentoStoragePath,
  getAtendimentoMediaTypeFromMimeType,
} from "@/lib/atendimento/files";
import { initialBotMessages } from "@/lib/atendimento/bot";
import {
  buildExperimentalClassAttendantStartReminderWhatsAppMessage,
  buildExperimentalClassStudentLessonReadyWhatsAppMessage,
  EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
  EXPERIMENTAL_CLASS_ATTENDANT_START_REMINDER_MINUTES,
} from "@/lib/atendimento/experimentalClass";
import { buildAtendimentoPublicUrl, isAtendimentoEmail, makeConversationSessionSlug, summarizePreview } from "@/lib/atendimento/utils";
import { isAtendimentoOnlyAccessScope, normalizeAccessScope } from "@/lib/auth/access";
import { zonedDateTimeToUtcIso } from "@/lib/timezone";

const ATENDIMENTO_DAILY_SUMMARY_PHONE = "+55 65 9985-1142";
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
    .from("atendimento_experimental_class_bookings")
    .select("id, lead_id")
    .gte("created_at", params.rangeStartIso)
    .lt("created_at", params.rangeEndIso);

  if (error) {
    const code = String((error as any)?.code ?? "").trim();
    const message = String((error as any)?.message ?? "");
    if (
      code === "42P01" ||
      /relation .*atendimento_experimental_class_bookings.* does not exist/i.test(message)
    ) {
      return 0;
    }
    throw new Error(error.message || "Falha ao contar agendamentos do dia para o resumo diario.");
  }

  const uniqueLeadIds = new Set<string>();
  for (const row of (data ?? []) as any[]) {
    const leadId = String(row?.lead_id ?? "").trim();
    if (leadId) uniqueLeadIds.add(leadId);
  }
  return uniqueLeadIds.size;
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
    [ATENDIMENTO_DAILY_SUMMARY_PHONE, EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE].map((value) =>
      normalizePhoneDigitsOnly(value),
    ),
  );
  const destDigits = normalizePhoneDigitsOnly(normalizedPhone);
  const isInternalNotificationPhone = destDigits && internalNotificationPhones.has(destDigits);

  const { self_instance_phone_digits_only: selfPhoneOpt } = params;
  if (!isInternalNotificationPhone && destinationIsInstancePhone(normalizedPhone, null, selfPhoneOpt ?? null)) {
    return {
      ok: false,
      skipped: true,
      reason: "self_instance_phone_refused_to_prevent_infinite_loop_at_low_level_sendZapiText",
      phone: normalizePhoneDigitsOnly(normalizedPhone),
    } as any;
  }

  if (!isInternalNotificationPhone) {
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
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, email")
    .ilike("email", ATENDIMENTO_EMAIL)
    .maybeSingle();

  const userId = String((profile as any)?.user_id ?? "").trim();
  if (!userId) return null;

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

  return {
    instance_id: String((wa as any).instance_id),
    token: String((wa as any).token),
    client_token: String((wa as any)?.client_token ?? "").trim() || null,
    instance_phone_digits_only: normalizePhoneDigitsOnly(String((wa as any)?.phone ?? "")),
  };
}

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
    [ATENDIMENTO_DAILY_SUMMARY_PHONE, EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE].map((value) =>
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
      const { data: conversationRow } = await admin
        .from("atendimento_conversations")
        .select("id")
        .eq("lead_id", String((leadRow as any).id))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const conversationId = String((conversationRow as any)?.id ?? "").trim();

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
  if (baseUrl) {
    const webhookUrl = buildAuthorizedZapiWebhookUrl(baseUrl);
    await updateZapiWebhook({
      instance_id: config.instance_id,
      token: config.token,
      client_token: config.client_token,
      endpoint: "update-every-webhooks",
      value: webhookUrl,
      extraBody: { notifySentByMe: true },
    });
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
    .select("summary_date, sent_at, attempt_count")
    .eq("summary_date", summaryDate)
    .maybeSingle();

  if (existingRunError) {
    throw new Error(existingRunError.message || "Falha ao consultar o resumo diario do atendimento.");
  }

  if (existingRun?.sent_at) {
    return {
      ok: true as const,
      skipped: true as const,
      reason: "already_sent",
      summaryDate,
      leadsCount: Number((existingRun as any)?.leads_count ?? 0) || null,
    };
  }

  const nextAttemptCount = Number((existingRun as any)?.attempt_count ?? 0) + 1;
  const leasePayload = {
    summary_date: summaryDate,
    timezone: ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE,
    sent_at: null,
    last_attempt_at: nowIso,
    attempt_count: nextAttemptCount,
    last_error: null,
  };

  if (existingRun?.summary_date) {
    const { error: updateLeaseError } = await admin
      .from("atendimento_daily_summary_runs")
      .update(leasePayload)
      .eq("summary_date", summaryDate)
      .is("sent_at", null);

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
      if (eventType === "experimental_class_link_updated" && !String(currentBooking.lesson_link ?? "").trim()) {
        const details = ((event as any)?.details ?? {}) as Record<string, unknown>;
        const link = String(details.lesson_link ?? "").trim() || null;
        if (link) bookingsByLeadId.set(leadId, { ...currentBooking, lesson_link: link });
      }
    }
  }

  // Step 6: draft via experimental_class_lead/professor fields (agendamento manual no painel sem booking)
  for (const row of fullLeads as any[]) {
    const leadId = String(row?.id ?? "").trim();
    if (!leadId) continue;
    if (cancelledLeadBookingIds.has(leadId) || cancelledByHistoryLeadIds.has(leadId)) continue;
    if (bookingsByLeadId.has(leadId)) continue;

    const stage = String(row?.funnel_stage ?? "").trim().toLowerCase();
    const statusLead = String(row?.status ?? "").trim().toLowerCase();
    const professorStart = String(row?.experimental_class_professor_start_at ?? "").trim();
    if (!professorStart) continue;
    if (!stage.startsWith("aula_experimental") && !statusLead.startsWith("aula_experimental")) continue;

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
  let attendantSent = 0;
  let missingLessonLink = 0;
  let missingStudentPhone = 0;

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

    const cachedStudentSent =
      sentStudentBookingIds.has(bookingId) ||
      Boolean(String((booking as any)?.student_start_notification_sent_at ?? "").trim());
    const cachedAttendantSent =
      sentAttendantBookingIds.has(bookingId) ||
      Boolean(String((booking as any)?.attendant_start_notification_sent_at ?? "").trim());

    const studentDue = leadStartAtMs <= nowMs;
    const attendantDue =
      professorStartAtMs - EXPERIMENTAL_CLASS_ATTENDANT_START_REMINDER_MINUTES * 60_000 <= nowMs;

    if (attendantDue && !cachedAttendantSent) {
      try {
        await sendAtendimentoWhatsAppText({
          phone: EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
          message: buildExperimentalClassAttendantStartReminderWhatsAppMessage(leadFullName, lessonLink),
        });

        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_class_attendant_start_notification_sent",
          title: "Lembrete de inicio da aula experimental enviado ao atendente",
          details: {
            booking_id: bookingId,
            phone: EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
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
      } catch (error) {
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_class_attendant_start_notification_failed",
          title: "Falha ao enviar lembrete de inicio da aula experimental ao atendente",
          details: {
            booking_id: bookingId,
            phone: EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
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
        continue;
      }

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
      } catch (error) {
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

  return {
    ok: true as const,
    skipped: false as const,
    checkedBookings: bookingRows.length,
    studentSent,
    attendantSent,
    missingLessonLink,
    missingStudentPhone,
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
  actorType: "bot" | "lead" | "attendant" | "system";
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

  const { data: byAssigned } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("assigned_user_email", ATENDIMENTO_EMAIL)
    .order("created_at", { ascending: false })
    .limit(200);

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
  firstNameFromMessage?: string | null;
  initialState?: string | null;
  initialStateNormalized?: string | null;
  initialTimezone?: string | null;
  initialCountry?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const normalizedPhone = normalizePhoneDigitsOnly(params.phone);
  if (!normalizedPhone || !isValidWhatsAppUserPhone(normalizedPhone)) {
    throw new Error(
      `Telefone informado nao corresponde a um usuario WhatsApp valido: ${normalizedPhone ? "len=" + normalizedPhone.length : "empty"}`,
    );
  }

  const { isZapiInternalBlocklistedPhone } = await import("@/lib/atendimento/constants");
  if (isZapiInternalBlocklistedPhone(normalizedPhone)) {
    return null;
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
    const candidateOurPhones: string[] = [];
    const p1 = String((instRow as any)?.phone ?? "").replace(/\D/g, "");
    if (p1.length >= 10) candidateOurPhones.push(p1);
    const p2 = String((instRowGlobal as any)?.phone ?? "").replace(/\D/g, "");
    if (p2.length >= 10) candidateOurPhones.push(p2);
    for (const ourPhoneDigits of candidateOurPhones) {
      if (ourPhoneDigits.length >= 10 && normalizedPhone.length >= 10) {
        const ourKey = ourPhoneDigits.slice(-10);
        const rowKey = normalizedPhone.slice(-10);
        if (ourKey === rowKey || normalizedPhone.endsWith(ourKey) || ourPhoneDigits.endsWith(rowKey)) {
          return null;
        }
      }
    }
    for (const suffix of ["6599495594", "6581175345"]) {
      if (normalizedPhone.endsWith(suffix) || suffix.endsWith(normalizedPhone.slice(-10))) {
        return null;
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
