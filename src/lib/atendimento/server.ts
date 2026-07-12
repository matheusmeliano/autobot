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
import { buildAtendimentoPublicUrl, isAtendimentoEmail, makeConversationSessionSlug, summarizePreview } from "@/lib/atendimento/utils";
import { isAtendimentoOnlyAccessScope, normalizeAccessScope } from "@/lib/auth/access";
import { zonedDateTimeToUtcIso } from "@/lib/timezone";

const ATENDIMENTO_DAILY_SUMMARY_PHONE = "+1 321 297 3565";
const ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE = "America/Cuiaba";
const ATENDIMENTO_DAILY_SUMMARY_LINK = "https://www.autobot.business/app/atendimento";
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

function getLeadFirstName(name: string | null | undefined) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[0] ?? "Aluno";
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

function buildAtendimentoDailySummaryMessage(leadsCount: number) {
  return `📊 Resumo diário de interessados – AutoBot

Hoje entraram ${leadsCount} novos interessados na fila de atendimento.

Acesse o painel para visualizar todos os leads e iniciar os atendimentos:

${ATENDIMENTO_DAILY_SUMMARY_LINK}`;
}

async function countAtendimentoDailyInterestedLeads(params: {
  rangeStartIso: string;
  rangeEndIso: string;
}) {
  const admin = createSupabaseAdminClient();
  const [{ data: createdLeads, error: leadsError }, { data: createdConversations, error: conversationsError }] =
    await Promise.all([
      admin
        .from("atendimento_leads")
        .select("id")
        .gte("created_at", params.rangeStartIso)
        .lt("created_at", params.rangeEndIso),
      admin
        .from("atendimento_conversations")
        .select("lead_id")
        .gte("created_at", params.rangeStartIso)
        .lt("created_at", params.rangeEndIso),
    ]);

  if (leadsError) {
    throw new Error(leadsError.message || "Falha ao listar leads do resumo diario do atendimento.");
  }

  if (conversationsError) {
    throw new Error(conversationsError.message || "Falha ao listar conversas do resumo diario do atendimento.");
  }

  const leadIds = new Set<string>();

  for (const row of createdLeads ?? []) {
    const leadId = String((row as any)?.id ?? "").trim();
    if (leadId) leadIds.add(leadId);
  }

  for (const row of createdConversations ?? []) {
    const leadId = String((row as any)?.lead_id ?? "").trim();
    if (leadId) leadIds.add(leadId);
  }

  return leadIds.size;
}

export function buildAtendimentoConversationPublicUrl(publicSlug: string) {
  const safeSlug = String(publicSlug ?? "").trim() || ATENDIMENTO_PUBLIC_LINK_SLUG;
  return `https://www.autobot.business/atendimento?slug=${encodeURIComponent(safeSlug)}`;
}

export function buildOfflineAttendantNotificationMessage(params: {
  leadName?: string | null;
  publicSlug: string;
}) {
  const firstName = getLeadFirstName(params.leadName);
  const conversationUrl = buildAtendimentoConversationPublicUrl(ATENDIMENTO_PUBLIC_LINK_SLUG);
  return `Olá, ${firstName}! 👋

Você recebeu uma nova mensagem no AutoBot.

Acesse a plataforma e responda ao atendente.

${conversationUrl}`;
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
}) {
  const normalizedPhone = normalizePhone(params.phone);
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

async function getZapiInstanceMeta(params: {
  instance_id: string;
  token: string;
  client_token?: string | null;
}) {
  const response = await fetch(
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
    throw new Error(
      `Falha ao consultar instância Z-API: ${response.status} ${JSON.stringify(data) ?? ""}`.trim(),
    );
  }
  return data;
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
    .select("instance_id, token, client_token, status")
    .eq("user_id", userId)
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
  });

  return result;
}

export async function sendAtendimentoDailyLeadSummary(now = new Date()) {
  const admin = createSupabaseAdminClient();
  const summaryDate = localDateInTimeZone(now, ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE);
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

  const { error: leaseError } = await admin.from("atendimento_daily_summary_runs").insert({
    summary_date: summaryDate,
    timezone: ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE,
  });

  if (leaseError) {
    const code = String((leaseError as any)?.code ?? "").trim();
    if (code === "23505") {
      return { ok: true as const, skipped: true as const, summaryDate, leadsCount: null };
    }
    throw new Error(leaseError.message || "Falha ao reservar o resumo diario do atendimento.");
  }

  let leadsCount = 0;
  try {
    leadsCount = await countAtendimentoDailyInterestedLeads({
      rangeStartIso,
      rangeEndIso,
    });
  } catch (error) {
    await admin.from("atendimento_daily_summary_runs").delete().eq("summary_date", summaryDate);
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
      })
      .eq("summary_date", summaryDate);

    return { ok: true as const, skipped: false as const, summaryDate, leadsCount };
  } catch (error) {
    await admin.from("atendimento_daily_summary_runs").delete().eq("summary_date", summaryDate);
    throw error;
  }
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
