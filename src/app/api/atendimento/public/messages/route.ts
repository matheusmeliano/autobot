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
import fs from "node:fs";

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
  "Não foi possível validar o número de WhatsApp após 3 tentativas. Este atendimento foi encerrado definitivamente. Para tentar novamente, entre em contato com o suporte para remover o bloqueio do e-mail utilizado ou faça um novo cadastro com outro e-mail.";
const NUMERIC_ONLY_TEXT_MESSAGE =
  "Essa resposta não me parece válida. Responda somente com números.";
const NUMERIC_ONLY_MIXED_MESSAGE =
  "Por favor, responda somente com números.";
const PHONE_CONFIRMATION_PROMPT_MESSAGE =
  "Antes de prosseguir, preciso confirmar uma informação. Você tem certeza de que esse é o número correto? Posso fazer uma validação?";

// #region debug-point A:bootstrap
const __dbgEnvPath = ".dbg/valid-whatsapp-false-failure.env";
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

Conclua as etapas do bot para agendar sua aula experimental. No dia e horário escolhidos, entraremos em contato.

Nos vemos em breve ${firstName}. 🤝`;
}

function wasWhatsAppSendAccepted(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const data = payload as Record<string, unknown>;
  if (data.error) return false;
  if (data.success === false) return false;
  return Boolean(
    data.messageId ||
      data.zaapId ||
      data.id ||
      data.zapId ||
      data.text?.toString().trim() ||
      data.message?.toString().trim(),
  );
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
    .replace(/[\u0300-\u036f]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function interpretPhoneConfirmationDecision(value: string) {
  const normalized = normalizeDecisionText(value);
  if (!normalized) return "unknown" as const;
  if (/\bnao\b/.test(normalized)) return "negative" as const;
  if (/\bsim\b/.test(normalized)) return "positive" as const;
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
  // #region debug-point F:pending-timeout-check
  __dbg(`pending-timeout-${params.conversationId}`, "F", "[DEBUG] atendimento_pending_timeout_check", {
    leadId: params.leadId,
    conversationId: params.conversationId,
    pendingEventId: String((pendingEvent as any).id ?? ""),
    pendingCreatedAt: String((pendingEvent as any).created_at ?? ""),
    pendingAgeMs: Number.isNaN(createdAtMs) ? null : Date.now() - createdAtMs,
    timeoutMs: PHONE_VALIDATION_TIMEOUT_MS,
  });
  // #endregion
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
    // #region debug-point F:pending-timeout-race
    __dbg(`pending-timeout-${params.conversationId}`, "F", "[DEBUG] atendimento_pending_timeout_update_skipped", {
      leadId: params.leadId,
      conversationId: params.conversationId,
      pendingEventId: String((pendingEvent as any).id ?? ""),
    });
    // #endregion
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

  // #region debug-point F:pending-timeout-expired
  __dbg(`pending-timeout-${params.conversationId}`, "F", "[DEBUG] atendimento_pending_timeout_expired", {
    leadId: params.leadId,
    conversationId: params.conversationId,
    pendingEventId: String((pendingEvent as any).id ?? ""),
    timeoutMs: PHONE_VALIDATION_TIMEOUT_MS,
  });
  // #endregion

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
  const traceId = `public-wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  // #region debug-point B:phone-extraction
  __dbg(traceId, "B", "[DEBUG] atendimento_phone_extraction", {
    contentText,
    expectedField: null,
    extractedPhone: extracted.phone ?? null,
    extractedKeys: Object.keys(extracted),
  });
  // #endregion
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

      await admin
        .from("atendimento_conversations")
        .update({
          bot_enabled: false,
          updated_at: nowIso,
        })
        .eq("id", String(conversation.id));

      return Response.json({
        ok: true,
        inbound,
        outbound: null,
        blocked: true,
        conversation: {
          id: String(conversation.id),
          bot_enabled: false,
        },
      });
    }

    if (decision === "positive") {
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
      }

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
  // #region debug-point B:save-decision
  __dbg(traceId, "B", "[DEBUG] atendimento_phone_save_decision", {
    expectedField,
    leadPhone: String((lead as any)?.phone ?? ""),
    leadCpf: String((lead as any)?.cpf ?? ""),
    capturedPhone: captured.phone ?? null,
    nextMissingField,
    botMessage: botResponse.message,
  });
  // #endregion
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

  // #region debug-point E:post-response-shape
  __dbg(traceId, "E", "[DEBUG] atendimento_public_post_response_shape", {
    inboundId: String((inbound as any)?.id ?? ""),
    outboundId: String((outbound as any)?.id ?? ""),
    outboundMessage: String((outbound as any)?.content_text ?? ""),
    blocked: false,
  });
  // #endregion

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
