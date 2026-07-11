import fs from "node:fs";
import {
  botReplyForLead,
  extractLeadDataFromMessage,
  fieldFromBotPrompt,
  filterCapturedDataForLead,
  getNextMissingField,
} from "@/lib/atendimento/bot";
import { NUMERIC_ONLY_FIELDS } from "@/lib/atendimento/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  appendHistoryEvent,
  ensureInitialBotConversationFlow,
  getAuthenticatedAtendimentoConversationAccess,
  sendAtendimentoWhatsAppText,
  syncConversationPreview,
} from "@/lib/atendimento/server";
import { getAtendimentoConversationPreviewText } from "@/lib/atendimento/files";
import { resolveBaseUrlFromHeaders } from "@/lib/site-url";
import type { CapturedFieldName } from "@/lib/atendimento/types";

const POST_LEAD_REPLY_DELAY_MS = 2500;
const MAX_PHONE_FORMAT_ATTEMPTS = 3;
const PHONE_VALIDATION_TIMEOUT_MS = 60_000;
const WHATSAPP_REGISTERED_SUCCESS = "WhatsApp registrado com sucesso.";
const WHATSAPP_PENDING_MESSAGE =
  "Perfeito! Estou validando seu WhatsApp. Aguarde um instante.";
const WHATSAPP_INVALID_MESSAGE =
  "Não foi possível validar esse número de WhatsApp. Por favor, informe um WhatsApp válido com o código do país no início (+55 para Brasil ou +1 para Estados Unidos).";
const WHATSAPP_INVALID_FORMAT_MESSAGE =
  "O número informado é inválido. Informe um WhatsApp válido com o código do país no início (+55 para Brasil ou +1 para Estados Unidos).";
const WHATSAPP_TECHNICAL_TIMEOUT_MESSAGE =
  "Nao foi possivel concluir a validacao do seu WhatsApp neste momento por instabilidade tecnica. Tente novamente em instantes.";
const WHATSAPP_INVALID_FORMAT_FINAL_MESSAGE =
  "Não foi possível validar seu número de WhatsApp após 3 tentativas. Este cadastro foi bloqueado. Para tentar novamente, entre em contato com nosso suporte para desbloquear o e-mail utilizado ou realize um novo cadastro com outro e-mail.\n\nFale com nossa equipe pelo link abaixo:\n\nhttps://wa.me/5565996933336";
const NUMERIC_ONLY_TEXT_MESSAGE =
  "Essa resposta não me parece válida. Responda somente com números.";
const NUMERIC_ONLY_MIXED_MESSAGE =
  "Por favor, responda somente com números.";
const PHONE_CONFIRMATION_PROMPT_MESSAGE =
  'Para continuarmos, confirme se o número informado acima está correto respondendo "sim". Caso contrário, envie apenas o número correto para prosseguirmos.';
const PHONE_CONFIRMATION_SUCCESS_MESSAGE =
  "Perfeito! Enviei uma mensagem de boas-vindas para o WhatsApp informado.";
const PHONE_CONFIRMATION_SEND_FAILED_MESSAGE =
  "Ops! Parece que ocorreu uma falha em nosso sistema.\n\nEntre em contato conosco pelo link abaixo para que nossa equipe possa ajuda-lo:\n\nhttps://wa.me/5565996933336";

// #region debug-point A:bootstrap
const __dbgEnvPath = ".dbg/whatsapp-validation-delay.env";
const __dbgEnvRaw = fs.existsSync(__dbgEnvPath) ? fs.readFileSync(__dbgEnvPath, "utf8") : "";
const __dbgMap = Object.fromEntries(
  __dbgEnvRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("=");
      return idx >= 0 ? [line.slice(0, idx), line.slice(idx + 1)] : [line, ""];
    }),
);
const __dbgUrl = __dbgMap.DEBUG_SERVER_URL;
const __dbgSession = __dbgMap.DEBUG_SESSION_ID;
const __dbg = (traceId: string, hypothesisId: string, msg: string, data: Record<string, unknown>) => {
  if (!__dbgUrl || !__dbgSession) return;
  fetch(__dbgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: __dbgSession,
      runId: "pre-fix",
      hypothesisId,
      traceId,
      location: "src/app/api/atendimento/public/messages/route.ts",
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

function firstNameFromLead(lead: { full_name?: string | null }) {
  const clean = String(lead.full_name ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.split(" ")[0] ?? "";
}

function buildWhatsAppWelcomeMessage(lead: { full_name?: string | null }) {
  const firstName = firstNameFromLead(lead) || "aluno(a)";
  return `Olá, ${firstName}! 👋

Seja muito bem-vindo(a) ao Lucas Brum Online Music USA!

Estamos felizes em ter você conosco.

Conclua as etapas do AutoBot para agendar sua aula experimental. No dia e horário escolhidos, entraremos em contato.

Nos vemos em breve ${firstName}. 🤝`;
}

function extractWhatsAppMessageIds(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return { messageId: null, zaapId: null };
  }
  const data = payload as Record<string, unknown>;
  return {
    messageId: String(data.messageId ?? data.id ?? "").trim() || null,
    zaapId: String(data.zaapId ?? "").trim() || null,
  };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isNumericOnlyField(field: CapturedFieldName | null): field is CapturedFieldName {
  return Boolean(field && (NUMERIC_ONLY_FIELDS as readonly string[]).includes(field));
}

function classifyNumericOnlyResponse(value: string) {
  const raw = String(value ?? "").trim();
  const hasDigits = /\d/.test(raw);
  const hasLetters = /[A-Za-zÀ-ÿ]/.test(raw);

  if (hasLetters && !hasDigits) {
    return {
      ok: false as const,
      reason: "text_only" as const,
      message: NUMERIC_ONLY_TEXT_MESSAGE,
    };
  }

  if (hasLetters && hasDigits) {
    return {
      ok: false as const,
      reason: "mixed" as const,
      message: NUMERIC_ONLY_MIXED_MESSAGE,
    };
  }

  if (!hasDigits) {
    return {
      ok: false as const,
      reason: "text_only" as const,
      message: NUMERIC_ONLY_TEXT_MESSAGE,
    };
  }

  return {
    ok: true as const,
  };
}

function normalizeDecisionText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function interpretPhoneConfirmationDecision(value: string) {
  const normalized = normalizeDecisionText(value);
  if (!normalized) return "unknown" as const;
  if (/\bnao\b/.test(normalized)) return "negative" as const;
  if (/\bsim\b/.test(normalized)) return "positive" as const;
  if (
    /\b(pode|podemos)\s+(seguir|prosseguir|validar|fazer)\b/.test(normalized) ||
    /\b(confirmo|confirmado|afirmativo|claro|perfeito|correto)\b/.test(normalized) ||
    /\b(tenho\s+certeza|esta\s+certo|esta\s+correto|numero\s+certo|numero\s+correto)\b/.test(normalized)
  ) {
    return "positive" as const;
  }
  return "unknown" as const;
}

async function getPendingPhoneConfirmation(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
}) {
  const { data } = await params.admin
    .from("atendimento_history_events")
    .select("id, details")
    .eq("lead_id", params.leadId)
    .eq("conversation_id", params.conversationId)
    .eq("event_type", "phone_confirmation_pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as { id: string; details: Record<string, unknown> | null } | null;
}

function inferExpectedFieldFromBotMessage(promptText: unknown): CapturedFieldName | null {
  const raw = String(promptText ?? "").trim();
  if (!raw) return null;
  const mapped = fieldFromBotPrompt(raw);
  if (mapped) return mapped;
  if (
    raw.startsWith(WHATSAPP_INVALID_MESSAGE) ||
    raw.startsWith(WHATSAPP_INVALID_FORMAT_MESSAGE) ||
    raw === NUMERIC_ONLY_TEXT_MESSAGE ||
    raw === NUMERIC_ONLY_MIXED_MESSAGE ||
    raw.startsWith(WHATSAPP_TECHNICAL_TIMEOUT_MESSAGE) ||
    raw === WHATSAPP_PENDING_MESSAGE
  ) {
    return "phone";
  }
  return null;
}

function hasSupportedWhatsAppCountryCode(value: string) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return false;
  if (raw.startsWith("+55") || raw.startsWith("55")) return true;
  if (raw.startsWith("+1") || raw.startsWith("1")) return true;
  return false;
}

function extractReplacementPhoneFromConfirmationResponse(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/[A-Za-zÀ-ÿ]/.test(raw)) return null;
  if (!/^[+\d()\s-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (!hasSupportedWhatsAppCountryCode(raw)) return null;
  return raw;
}

async function getPhoneFormatFailureCount(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
}) {
  const { count } = await params.admin
    .from("atendimento_history_events")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", params.leadId)
    .eq("conversation_id", params.conversationId)
    .in("event_type", ["phone_validation_format_failed", "phone_validation_failed"]);

  return Number(count ?? 0);
}

function buildPhoneValidationRetryMessage(attempts: number) {
  return `${WHATSAPP_INVALID_MESSAGE}\n\nTentativa ${attempts} de ${MAX_PHONE_FORMAT_ATTEMPTS}.`;
}

function buildPhoneFormatRetryMessage(attempts: number) {
  return `${WHATSAPP_INVALID_FORMAT_MESSAGE}\n\nTentativa ${attempts} de ${MAX_PHONE_FORMAT_ATTEMPTS}.`;
}

function normalizeValidationErrorText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isExplicitInvalidWhatsAppError(error: unknown) {
  const message = normalizeValidationErrorText(error instanceof Error ? error.message : error);
  if (!message) return false;
  return (
    message.includes("phone number does not exist") ||
    message.includes("numero nao existe") ||
    message.includes("number does not exist") ||
    message.includes("nao possui whatsapp") ||
    message.includes("not on whatsapp") ||
    message.includes("whatsapp number does not exist")
  );
}

async function expirePendingPhoneValidationIfNeeded(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
}) {
  const { data: pendingEvent } = await params.admin
    .from("atendimento_history_events")
    .select("id, details, created_at")
    .eq("lead_id", params.leadId)
    .eq("conversation_id", params.conversationId)
    .eq("event_type", "phone_validation_pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pendingEvent?.id) return false;

  const createdAtMs = new Date(String((pendingEvent as any).created_at ?? "")).getTime();
  if (Number.isNaN(createdAtMs) || Date.now() - createdAtMs < PHONE_VALIDATION_TIMEOUT_MS) {
    return false;
  }

  const nowIso = new Date().toISOString();
  const pendingDetails = ((pendingEvent as any).details ?? {}) as Record<string, unknown>;
  const { data: updatedPendingEvent } = await params.admin
    .from("atendimento_history_events")
    .update({
      event_type: "phone_validation_timeout",
      title: "Validacao do WhatsApp expirou sem confirmacao",
      details: {
        ...pendingDetails,
        final_status: "TIMEOUT",
        error: "validation_timeout",
        failed_at: nowIso,
      },
    })
    .eq("id", String((pendingEvent as any).id))
    .eq("event_type", "phone_validation_pending")
    .select("id")
    .maybeSingle();

  if (!updatedPendingEvent?.id) {
    return false;
  }

  await params.admin.from("atendimento_messages").insert({
    conversation_id: params.conversationId,
    sender_role: "bot",
    content_text: WHATSAPP_TECHNICAL_TIMEOUT_MESSAGE,
    media_type: "text",
    status: "entregue",
    sent_at: nowIso,
    delivered_at: nowIso,
  });

  const { data: leadRow } = await params.admin
    .from("atendimento_leads")
    .select("unread_count, status, funnel_stage")
    .eq("id", params.leadId)
    .maybeSingle();

  await params.admin
    .from("atendimento_leads")
    .update({
      status: (leadRow as any)?.status ?? null,
      funnel_stage: (leadRow as any)?.funnel_stage ?? null,
      unread_count: Number((leadRow as any)?.unread_count ?? 0) + 1,
      last_interaction_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", params.leadId);

  await syncConversationPreview({
    conversationId: params.conversationId,
    contentText: WHATSAPP_TECHNICAL_TIMEOUT_MESSAGE,
    createdAt: nowIso,
  });

  return true;
}

function looksLikeFieldValue(field: CapturedFieldName, text: string) {
  const clean = text.trim();
  if (!clean) return false;
  if (field === "phone") return clean.replace(/\D/g, "").length >= 8;
  if (field === "full_name") return clean.split(/\s+/).length >= 2;
  return true;
}

async function upsertCapturedFields(params: {
  leadId: string;
  sourceMessageId: string;
  values: Record<string, string>;
}) {
  const admin = createSupabaseAdminClient();
  const entries = Object.entries(params.values).filter(([, value]) => String(value).trim());
  if (!entries.length) return;

  for (const [fieldName, fieldValue] of entries) {
    const { data: existing } = await admin
      .from("atendimento_captured_fields")
      .select("id")
      .eq("lead_id", params.leadId)
      .eq("field_name", fieldName)
      .maybeSingle();

    if (existing?.id) {
      await admin
        .from("atendimento_captured_fields")
        .update({
          field_value: fieldValue,
          source_message_id: params.sourceMessageId,
          confidence: 0.92,
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(existing.id));
    } else {
      await admin.from("atendimento_captured_fields").insert({
        lead_id: params.leadId,
        field_name: fieldName,
        field_value: fieldValue,
        source_message_id: params.sourceMessageId,
        confidence: 0.92,
      });
    }
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const publicSlug = String(searchParams.get("public_slug") ?? "").trim();
  if (!publicSlug) {
    return Response.json({ ok: false, error: "missing_public_slug" }, { status: 400 });
  }

  const access = await getAuthenticatedAtendimentoConversationAccess(publicSlug);
  if (!access.ok) {
    return Response.json({ ok: false, error: access.error }, { status: access.status });
  }
  const { admin, conversation } = access;

  await ensureInitialBotConversationFlow({
    leadId: String(conversation.lead_id),
    conversationId: String(conversation.id),
  });

  const { data, error } = await admin
    .from("atendimento_messages")
    .select("*")
    .eq("conversation_id", String(conversation.id))
    .order("created_at", { ascending: true });

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  await admin
    .from("atendimento_messages")
    .update({ status: "lida", read_at: new Date().toISOString() })
    .eq("conversation_id", String(conversation.id))
    .in("sender_role", ["bot", "attendant"])
    .neq("status", "lida");

  return Response.json({ ok: true, messages: (data ?? []) as any[] });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const publicSlug = String(body?.public_slug ?? "").trim();
  const contentText = String(body?.content_text ?? "").trim();
  const mediaType = String(body?.media_type ?? "text").trim() || "text";
  const mediaUrl = String(body?.media_url ?? "").trim() || null;
  const mimeType = String(body?.mime_type ?? "").trim() || null;
  const fileName = String(body?.file_name ?? "").trim() || null;
  const fileSizeBytesRaw = Number(body?.file_size_bytes ?? 0);
  const fileSizeBytes = Number.isFinite(fileSizeBytesRaw) && fileSizeBytesRaw > 0 ? fileSizeBytesRaw : null;

  if (!publicSlug) {
    return Response.json({ ok: false, error: "missing_public_slug" }, { status: 400 });
  }
  if (!contentText && !mediaUrl) {
    return Response.json({ ok: false, error: "empty_message" }, { status: 400 });
  }

  const access = await getAuthenticatedAtendimentoConversationAccess(publicSlug);
  if (!access.ok) {
    return Response.json({ ok: false, error: access.error }, { status: access.status });
  }
  const { admin, conversation, lead } = access;
  if (!conversation.bot_enabled) {
    return Response.json(
      {
        ok: false,
        blocked: true,
        code: "conversation_blocked",
        error: "Este atendimento foi encerrado e não aceita novas mensagens.",
        conversation: { ...conversation, bot_enabled: false },
      },
      { status: 423 },
    );
  }

  const { data: lastBotMessage } = await admin
    .from("atendimento_messages")
    .select("content_text, created_at")
    .eq("conversation_id", String(conversation.id))
    .eq("sender_role", "bot")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nowIso = new Date().toISOString();

  const { data: lastLeadMessage } = await admin
    .from("atendimento_messages")
    .select("*")
    .eq("conversation_id", String(conversation.id))
    .eq("sender_role", "lead")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastLeadCreatedAtMs = new Date(String((lastLeadMessage as any)?.created_at ?? "")).getTime();
  const isLikelyDuplicateSubmission = Boolean(
    lastLeadMessage?.id &&
      String((lastLeadMessage as any)?.content_text ?? "").trim() === contentText &&
      String((lastLeadMessage as any)?.media_type ?? "text").trim() === mediaType &&
      String((lastLeadMessage as any)?.media_url ?? "").trim() === String(mediaUrl ?? "").trim() &&
      !Number.isNaN(lastLeadCreatedAtMs) &&
      Date.now() - lastLeadCreatedAtMs < 2500,
  );

  if (isLikelyDuplicateSubmission) {
    return Response.json({
      ok: true,
      inbound: lastLeadMessage,
      outbound: null,
      blocked: false,
      should_reload: true,
      conversation: {
        id: String(conversation.id),
        bot_enabled: true,
      },
    });
  }

  const { data: inbound, error: inboundError } = await admin
    .from("atendimento_messages")
    .insert({
      conversation_id: String(conversation.id),
      sender_role: "lead",
      content_text: contentText || null,
      media_type: mediaType,
      media_url: mediaUrl,
      mime_type: mimeType,
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
      status: "recebida",
      sent_at: nowIso,
      delivered_at: nowIso,
    })
    .select("*")
    .maybeSingle();

  if (inboundError || !inbound?.id) {
    return Response.json({ ok: false, error: inboundError?.message ?? "message_error" }, { status: 500 });
  }

  const extracted = extractLeadDataFromMessage(contentText) as Record<string, string>;
  const isAwaitingPhoneConfirmation =
    String(lastBotMessage?.content_text ?? "").trim() === PHONE_CONFIRMATION_PROMPT_MESSAGE;
  const expectedField = inferExpectedFieldFromBotMessage(lastBotMessage?.content_text ?? "") ?? getNextMissingField(lead as any);
  if (
    expectedField &&
    !extracted[expectedField] &&
    !String((lead as any)?.[expectedField] ?? "").trim() &&
    looksLikeFieldValue(expectedField, contentText)
  ) {
    extracted[expectedField] = contentText.trim();
  }
  const captured = filterCapturedDataForLead({
    lead: lead as any,
    captured: extracted as any,
    expectedField,
  }) as Record<string, string>;

  const numericOnlyValidation = !isAwaitingPhoneConfirmation && isNumericOnlyField(expectedField)
    ? classifyNumericOnlyResponse(contentText)
    : null;

  if (numericOnlyValidation && !numericOnlyValidation.ok) {
    await admin
      .from("atendimento_leads")
      .update({
        unread_count: Number(lead.unread_count ?? 0) + 1,
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", String(lead.id));

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
      createdAt: nowIso,
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "message_received",
      title: "Mensagem recebida do lead",
      details: {
        content_text: contentText || null,
        media_type: mediaType,
        media_url: mediaUrl,
        mime_type: mimeType,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
      },
      actorType: "lead",
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "numeric_field_validation_failed",
      title: "Resposta inválida para campo numérico",
      details: {
        field: expectedField,
        reason: numericOnlyValidation.reason,
        content_text: contentText || null,
      },
      actorType: "system",
    });

    await sleep(POST_LEAD_REPLY_DELAY_MS);
    const botNowIso = new Date().toISOString();
    const { data: outbound, error: outboundError } = await admin
      .from("atendimento_messages")
      .insert({
        conversation_id: String(conversation.id),
        sender_role: "bot",
        content_text: numericOnlyValidation.message,
        media_type: "text",
        status: "entregue",
        sent_at: botNowIso,
        delivered_at: botNowIso,
      })
      .select("*")
      .maybeSingle();

    if (outboundError) {
      const code = String((outboundError as any)?.code ?? "").trim();
      if (code !== "23505") {
        return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
      }
    }

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: numericOnlyValidation.message,
      createdAt: botNowIso,
    });

    return Response.json({
      ok: true,
      inbound,
      outbound: outboundError ? null : outbound,
      blocked: false,
      conversation: {
        id: String(conversation.id),
        bot_enabled: true,
      },
    });
  }

  if (isAwaitingPhoneConfirmation) {
    const pendingPhoneConfirmation = await getPendingPhoneConfirmation({
      admin,
      leadId: String(lead.id),
      conversationId: String(conversation.id),
    });
    const decision = interpretPhoneConfirmationDecision(contentText);
    const pendingPhone = String((pendingPhoneConfirmation?.details ?? {}).phone ?? "").trim();
    const replacementPhone = extractReplacementPhoneFromConfirmationResponse(contentText);

    await admin
      .from("atendimento_leads")
      .update({
        unread_count: Number(lead.unread_count ?? 0) + 1,
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", String(lead.id));

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
      createdAt: nowIso,
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "message_received",
      title: "Mensagem recebida do lead",
      details: {
        content_text: contentText || null,
        media_type: mediaType,
        media_url: mediaUrl,
        mime_type: mimeType,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
      },
      actorType: "lead",
    });

    if (replacementPhone) {
      if (pendingPhoneConfirmation?.id) {
        await admin
          .from("atendimento_history_events")
          .update({
            event_type: "phone_confirmation_rejected",
            title: "Lead informou um novo número de WhatsApp para confirmação",
            details: {
              ...((pendingPhoneConfirmation.details ?? {}) as Record<string, unknown>),
              decision: "replacement_phone",
              replaced_at: nowIso,
              replacement_phone: replacementPhone,
            },
          })
          .eq("id", String(pendingPhoneConfirmation.id))
          .eq("event_type", "phone_confirmation_pending");
      }

      await appendHistoryEvent({
        leadId: String(lead.id),
        conversationId: String(conversation.id),
        eventType: "phone_confirmation_pending",
        title: "Aguardando confirmação do novo número de WhatsApp",
        details: {
          phone: replacementPhone,
          replaced_previous_phone: pendingPhone || null,
        },
        actorType: "system",
      });

      await sleep(POST_LEAD_REPLY_DELAY_MS);
      const botNowIso = new Date().toISOString();
      const { data: outbound, error: outboundError } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String(conversation.id),
          sender_role: "bot",
          content_text: PHONE_CONFIRMATION_PROMPT_MESSAGE,
          media_type: "text",
          status: "entregue",
          sent_at: botNowIso,
          delivered_at: botNowIso,
        })
        .select("*")
        .maybeSingle();

      if (outboundError) {
        const code = String((outboundError as any)?.code ?? "").trim();
        if (code !== "23505") {
          return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
        }
      }

      await syncConversationPreview({
        conversationId: String(conversation.id),
        contentText: PHONE_CONFIRMATION_PROMPT_MESSAGE,
        createdAt: botNowIso,
      });

      return Response.json({
        ok: true,
        inbound,
        outbound: outboundError ? null : outbound,
        blocked: false,
        conversation: {
          id: String(conversation.id),
          bot_enabled: true,
        },
      });
    }

    if (decision === "negative") {
      if (pendingPhoneConfirmation?.id) {
        await admin
          .from("atendimento_history_events")
          .update({
            event_type: "phone_confirmation_rejected",
            title: "Lead não confirmou o número de WhatsApp",
            details: {
              ...((pendingPhoneConfirmation.details ?? {}) as Record<string, unknown>),
              decision: "negative",
              rejected_at: nowIso,
            },
          })
          .eq("id", String(pendingPhoneConfirmation.id))
          .eq("event_type", "phone_confirmation_pending");
      }

      await appendHistoryEvent({
        leadId: String(lead.id),
        conversationId: String(conversation.id),
        eventType: "phone_confirmation_pending",
        title: "Aguardando confirmação do número de WhatsApp",
        details: {
          phone: pendingPhone || null,
          retried_after_negative: true,
        },
        actorType: "system",
      });

      await sleep(POST_LEAD_REPLY_DELAY_MS);
      const botNowIso = new Date().toISOString();
      const { data: outbound, error: outboundError } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String(conversation.id),
          sender_role: "bot",
          content_text: PHONE_CONFIRMATION_PROMPT_MESSAGE,
          media_type: "text",
          status: "entregue",
          sent_at: botNowIso,
          delivered_at: botNowIso,
        })
        .select("*")
        .maybeSingle();

      if (outboundError) {
        const code = String((outboundError as any)?.code ?? "").trim();
        if (code !== "23505") {
          return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
        }
      }

      await syncConversationPreview({
        conversationId: String(conversation.id),
        contentText: PHONE_CONFIRMATION_PROMPT_MESSAGE,
        createdAt: botNowIso,
      });

      return Response.json({
        ok: true,
        inbound,
        outbound: outboundError ? null : outbound,
        blocked: false,
        conversation: {
          id: String(conversation.id),
          bot_enabled: true,
        },
      });
    }

    if (decision === "positive") {
      const traceId = `public-phone-validation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const baseUrl = resolveBaseUrlFromHeaders(req.headers);
      let positiveFollowUpMessage: string | null = null;
      if (pendingPhoneConfirmation?.id) {
        await admin
          .from("atendimento_history_events")
          .update({
            event_type: "phone_confirmation_confirmed",
            title: "Lead confirmou o número de WhatsApp",
            details: {
              ...((pendingPhoneConfirmation.details ?? {}) as Record<string, unknown>),
              decision: "positive",
              confirmed_at: nowIso,
            },
          })
          .eq("id", String(pendingPhoneConfirmation.id))
          .eq("event_type", "phone_confirmation_pending");
      }

      if (pendingPhone) {
        await admin
          .from("atendimento_leads")
          .update({
            phone: pendingPhone,
            updated_at: nowIso,
          })
          .eq("id", String(lead.id));

        await upsertCapturedFields({
          leadId: String(lead.id),
          sourceMessageId: String(inbound.id),
          values: { phone: pendingPhone },
        });

        await appendHistoryEvent({
          leadId: String(lead.id),
          conversationId: String(conversation.id),
          eventType: "data_captured",
          title: "Dados capturados automaticamente",
          details: { phone: pendingPhone },
          actorType: "system",
        });

        try {
          // #region debug-point A:send-start
          __dbg(traceId, "A", "[DEBUG] public_phone_validation_send_start", {
            leadId: String(lead.id),
            conversationId: String(conversation.id),
            pendingPhone,
            hasBaseUrl: Boolean(baseUrl),
          });
          // #endregion
          const sendResult = await sendAtendimentoWhatsAppText({
            phone: pendingPhone,
            message: buildWhatsAppWelcomeMessage(lead as { full_name?: string | null }),
            baseUrl,
          });

          const ids = extractWhatsAppMessageIds(sendResult);
          const externalMessageId = ids.messageId ?? ids.zaapId;
          // #region debug-point B:send-result
          __dbg(traceId, "B", "[DEBUG] public_phone_validation_send_result", {
            leadId: String(lead.id),
            conversationId: String(conversation.id),
            pendingPhone,
            sendResult,
            extractedMessageId: ids.messageId,
            extractedZaapId: ids.zaapId,
            externalMessageId,
          });
          // #endregion

          if (!externalMessageId) {
            throw new Error("Z-API não retornou identificador da mensagem para validar a entrega.");
          }

          await appendHistoryEvent({
            leadId: String(lead.id),
            conversationId: String(conversation.id),
            eventType: "phone_validation_pending",
            title: "Aguardando confirmação da entrega da mensagem no WhatsApp",
            details: {
              phone: pendingPhone,
              external_message_id: externalMessageId,
              external_zaap_id: ids.zaapId,
              payload: sendResult,
            },
            actorType: "system",
          });
          // #region debug-point C:pending-saved
          __dbg(traceId, "C", "[DEBUG] public_phone_validation_pending_saved", {
            leadId: String(lead.id),
            conversationId: String(conversation.id),
            pendingPhone,
            externalMessageId,
            externalZaapId: ids.zaapId,
          });
          // #endregion
          positiveFollowUpMessage = WHATSAPP_PENDING_MESSAGE;
        } catch (error) {
          // #region debug-point D:send-error
          __dbg(traceId, "D", "[DEBUG] public_phone_validation_send_error", {
            leadId: String(lead.id),
            conversationId: String(conversation.id),
            pendingPhone,
            error: error instanceof Error ? error.message : String(error),
          });
          // #endregion
          await appendHistoryEvent({
            leadId: String(lead.id),
            conversationId: String(conversation.id),
            eventType: "phone_confirmation_whatsapp_send_failed",
            title: "Falha ao enviar mensagem de boas-vindas para o WhatsApp confirmado",
            details: {
              phone: pendingPhone,
              error: error instanceof Error ? error.message : String(error),
            },
            actorType: "system",
          });
          positiveFollowUpMessage = PHONE_CONFIRMATION_SEND_FAILED_MESSAGE;
        }
      }

      let outbound: Record<string, unknown> | null = null;
      if (positiveFollowUpMessage) {
        await sleep(POST_LEAD_REPLY_DELAY_MS);
        const botNowIso = new Date().toISOString();
        const { data: outboundMessage, error: outboundError } = await admin
          .from("atendimento_messages")
          .insert({
            conversation_id: String(conversation.id),
            sender_role: "bot",
            content_text: positiveFollowUpMessage,
            media_type: "text",
            status: "entregue",
            sent_at: botNowIso,
            delivered_at: botNowIso,
          })
          .select("*")
          .maybeSingle();

        if (outboundError) {
          const code = String((outboundError as any)?.code ?? "").trim();
          if (code !== "23505") {
            return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
          }
        }

        await syncConversationPreview({
          conversationId: String(conversation.id),
          contentText: positiveFollowUpMessage,
          createdAt: botNowIso,
        });
        outbound = outboundError ? null : ((outboundMessage as Record<string, unknown> | null) ?? null);
      }

      return Response.json({
        ok: true,
        inbound,
        outbound,
        blocked: false,
        conversation: {
          id: String(conversation.id),
          bot_enabled: true,
        },
      });
    }

    await sleep(POST_LEAD_REPLY_DELAY_MS);
    const botNowIso = new Date().toISOString();
    const { data: outbound, error: outboundError } = await admin
      .from("atendimento_messages")
      .insert({
        conversation_id: String(conversation.id),
        sender_role: "bot",
        content_text: PHONE_CONFIRMATION_PROMPT_MESSAGE,
        media_type: "text",
        status: "entregue",
        sent_at: botNowIso,
        delivered_at: botNowIso,
      })
      .select("*")
      .maybeSingle();

    if (outboundError) {
      const code = String((outboundError as any)?.code ?? "").trim();
      if (code !== "23505") {
        return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
      }
    }

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: PHONE_CONFIRMATION_PROMPT_MESSAGE,
      createdAt: botNowIso,
    });

    return Response.json({
      ok: true,
      inbound,
      outbound: outboundError ? null : outbound,
      blocked: false,
      conversation: {
        id: String(conversation.id),
        bot_enabled: true,
      },
    });
  }

  if (expectedField === "phone") {
    await admin
      .from("atendimento_leads")
      .update({
        unread_count: Number(lead.unread_count ?? 0) + 1,
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", String(lead.id));

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
      createdAt: nowIso,
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "message_received",
      title: "Mensagem recebida do lead",
      details: {
        content_text: contentText || null,
        media_type: mediaType,
        media_url: mediaUrl,
        mime_type: mimeType,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
      },
      actorType: "lead",
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "phone_confirmation_pending",
      title: "Aguardando confirmação do número de WhatsApp",
      details: {
        phone: String(captured.phone ?? contentText ?? "").trim(),
      },
      actorType: "system",
    });

    await sleep(POST_LEAD_REPLY_DELAY_MS);
    const botNowIso = new Date().toISOString();
    const { data: outbound, error: outboundError } = await admin
      .from("atendimento_messages")
      .insert({
        conversation_id: String(conversation.id),
        sender_role: "bot",
        content_text: PHONE_CONFIRMATION_PROMPT_MESSAGE,
        media_type: "text",
        status: "entregue",
        sent_at: botNowIso,
        delivered_at: botNowIso,
      })
      .select("*")
      .maybeSingle();

    if (outboundError) {
      const code = String((outboundError as any)?.code ?? "").trim();
      if (code !== "23505") {
        return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
      }
    }

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: PHONE_CONFIRMATION_PROMPT_MESSAGE,
      createdAt: botNowIso,
    });

    return Response.json({
      ok: true,
      inbound,
      outbound: outboundError ? null : outbound,
      blocked: false,
      conversation: {
        id: String(conversation.id),
        bot_enabled: true,
      },
    });
  }

  if (!expectedField && String((lead as any)?.phone ?? "").trim()) {
    await admin
      .from("atendimento_leads")
      .update({
        unread_count: Number(lead.unread_count ?? 0) + 1,
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", String(lead.id));

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
      createdAt: nowIso,
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "message_received",
      title: "Mensagem recebida do lead",
      details: {
        content_text: contentText || null,
        media_type: mediaType,
        media_url: mediaUrl,
        mime_type: mimeType,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
      },
      actorType: "lead",
    });

    return Response.json({
      ok: true,
      inbound,
      outbound: null,
      blocked: false,
      conversation: {
        id: String(conversation.id),
        bot_enabled: true,
      },
    });
  }

  const nextLead = {
    ...lead,
    ...captured,
  };
  const nextMissingField = getNextMissingField(nextLead as any);
  const botResponse = botReplyForLead({ lead: nextLead as any, messageText: contentText });
  const nextStage = nextMissingField ? botResponse.stage : "pre_cadastro_concluido";
  const nextStatus = nextMissingField ? botResponse.status : "matricula_pendente";

  await admin
    .from("atendimento_leads")
    .update({
      ...captured,
      status: nextStatus,
      funnel_stage: nextStage,
      unread_count: Number(lead.unread_count ?? 0) + 1,
      last_interaction_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", String(lead.id));

  await upsertCapturedFields({
    leadId: String(lead.id),
    sourceMessageId: String(inbound.id),
    values: captured as Record<string, string>,
  });

  await syncConversationPreview({
    conversationId: String(conversation.id),
    contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
    createdAt: nowIso,
  });

  await appendHistoryEvent({
    leadId: String(lead.id),
    conversationId: String(conversation.id),
    eventType: "message_received",
    title: "Mensagem recebida do lead",
    details: {
      content_text: contentText || null,
      media_type: mediaType,
      media_url: mediaUrl,
      mime_type: mimeType,
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
    },
    actorType: "lead",
  });

  if (Object.keys(captured).length > 0) {
    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "data_captured",
      title: "Dados capturados automaticamente",
      details: captured,
      actorType: "system",
    });
  }

  await sleep(POST_LEAD_REPLY_DELAY_MS);
  const botNowIso = new Date().toISOString();

  const { data: lastBotBeforeInsert } = await admin
    .from("atendimento_messages")
    .select("*")
    .eq("conversation_id", String(conversation.id))
    .eq("sender_role", "bot")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastBotBeforeInsertCreatedAtMs = new Date(String((lastBotBeforeInsert as any)?.created_at ?? "")).getTime();
  const botResponseText = String(botResponse.message ?? "").trim();
  const shouldReuseLastBotMessage = Boolean(
    lastBotBeforeInsert?.id &&
      botResponseText &&
      String((lastBotBeforeInsert as any)?.content_text ?? "").trim() === botResponseText &&
      !Number.isNaN(lastBotBeforeInsertCreatedAtMs) &&
      Date.now() - lastBotBeforeInsertCreatedAtMs < POST_LEAD_REPLY_DELAY_MS + 4000,
  );

  if (shouldReuseLastBotMessage) {
    return Response.json({
      ok: true,
      inbound,
      outbound: lastBotBeforeInsert,
      blocked: false,
      conversation: {
        id: String(conversation.id),
        bot_enabled: true,
      },
    });
  }

  const { data: outbound, error: outboundError } = await admin
    .from("atendimento_messages")
    .insert({
      conversation_id: String(conversation.id),
      sender_role: "bot",
      content_text: botResponse.message,
      media_type: "text",
      status: "entregue",
      sent_at: botNowIso,
      delivered_at: botNowIso,
    })
    .select("*")
    .maybeSingle();

  if (outboundError) {
    const code = String((outboundError as any)?.code ?? "").trim();
    if (code !== "23505") {
      return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
    }
  }

  await syncConversationPreview({
    conversationId: String(conversation.id),
    contentText: botResponse.message,
    createdAt: botNowIso,
  });
  await appendHistoryEvent({
    leadId: String(lead.id),
    conversationId: String(conversation.id),
    eventType: "stage_changed",
    title: "Etapa do funil atualizada automaticamente",
    details: { status: nextStatus, funnel_stage: nextStage },
    actorType: "bot",
  });

  return Response.json({
    ok: true,
    inbound,
    outbound: outboundError ? null : outbound,
    blocked: false,
    conversation: {
      id: String(conversation.id),
      bot_enabled: true,
    },
  });
}
