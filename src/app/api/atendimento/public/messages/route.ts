import {
  botReplyForLead,
  extractLeadDataFromMessage,
  fieldFromBotPrompt,
  filterCapturedDataForLead,
  getNextMissingField,
} from "@/lib/atendimento/bot";
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
const WHATSAPP_REGISTERED_SUCCESS = "WhatsApp registrado com sucesso.";
const WHATSAPP_PENDING_MESSAGE =
  "Perfeito! Estou validando seu WhatsApp. Aguarde um instante.";
const WHATSAPP_INVALID_MESSAGE =
  "Não consegui entregar a mensagem de teste nesse WhatsApp. Por favor, informe um WhatsApp válido.";

// #region debug-point A:bootstrap
const __dbgEnvPath = ".dbg/zapi-webhook-auth.env";
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

Estamos muito felizes em ter você conosco e ansiosos para iniciar essa jornada musical ao seu lado.

Para finalizar seu cadastro, basta concluir as etapas solicitadas pelo bot. Assim que tudo estiver concluído, entraremos em contato e aguardaremos você na sua primeira aula.

Nos vemos em breve!`;
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

function looksLikeFieldValue(field: CapturedFieldName, text: string) {
  const clean = text.trim();
  if (!clean) return false;
  if (field === "cpf") return /\d{11}/.test(clean.replace(/\D/g, ""));
  if (field === "phone") return clean.replace(/\D/g, "").length >= 8;
  if (field === "email") return /@/.test(clean);
  if (field === "timezone") return /(america\/|gmt|utc)/i.test(clean);
  if (field === "best_contact_time") return /\d|manhã|tarde|noite/i.test(clean);
  if (field === "state") return /^[A-Za-zÀ-ÿ]{2,}$/i.test(clean.replace(/\s+/g, ""));
  if (field === "country") return /[A-Za-zÀ-ÿ]/.test(clean);
  if (field === "city") return /[A-Za-zÀ-ÿ]/.test(clean);
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
  const expectedField = fieldFromBotPrompt(lastBotMessage?.content_text ?? "");
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
  let phoneValidationFailed = false;
  let phoneValidationPending:
    | {
        phone: string;
        messageId: string | null;
        zaapId: string | null;
      }
    | null = null;

  if (expectedField === "phone") {
    const candidatePhone = String(captured.phone ?? extracted.phone ?? "").trim();
    // #region debug-point E:phone-candidate
    __dbg(traceId, "E", "[DEBUG] atendimento_phone_candidate", {
      candidatePhone,
      extractedPhone: extracted.phone ?? null,
      leadPhone: (lead as any)?.phone ?? null,
      expectedField,
      leadId: String((lead as any)?.id ?? ""),
    });
    // #endregion
    if (candidatePhone) {
      try {
        const sendResult = await sendAtendimentoWhatsAppText({
          phone: candidatePhone,
          message: buildWhatsAppWelcomeMessage(lead as any),
          baseUrl: resolveBaseUrlFromHeaders(req.headers),
        });
        const sendIds = extractWhatsAppMessageIds(sendResult);
        // #region debug-point A:acceptance-check
        __dbg(traceId, "A", "[DEBUG] atendimento_phone_send_acceptance_check", {
          candidatePhone,
          sendResult,
          accepted: wasWhatsAppSendAccepted(sendResult),
          sendIds,
        });
        // #endregion
        if (!wasWhatsAppSendAccepted(sendResult)) {
          throw new Error("Mensagem de teste não confirmada.");
        }
        delete captured.phone;
        phoneValidationPending = {
          phone: candidatePhone,
          messageId: sendIds.messageId,
          zaapId: sendIds.zaapId,
        };
      } catch {
        delete captured.phone;
        phoneValidationFailed = true;
        // #region debug-point D:validation-failed
        __dbg(traceId, "D", "[DEBUG] atendimento_phone_validation_failed", {
          candidatePhone,
        });
        // #endregion
      }
    } else {
      phoneValidationFailed = true;
      // #region debug-point D:missing-phone
      __dbg(traceId, "D", "[DEBUG] atendimento_phone_missing_candidate", {
        contentText,
      });
      // #endregion
    }
  }

  const nextLead = {
    ...lead,
    ...captured,
  };
  const nextMissingField = getNextMissingField(nextLead as any);
  const defaultBotResponse = botReplyForLead({ lead: nextLead as any, messageText: contentText });
  const botResponse = phoneValidationFailed
    ? {
        ...defaultBotResponse,
        message: WHATSAPP_INVALID_MESSAGE,
      }
    : phoneValidationPending
      ? {
          stage: (lead as any)?.funnel_stage ?? defaultBotResponse.stage,
          status: (lead as any)?.status ?? defaultBotResponse.status,
          message: WHATSAPP_PENDING_MESSAGE,
        }
      : defaultBotResponse;
  // #region debug-point B:save-decision
  __dbg(traceId, "B", "[DEBUG] atendimento_phone_save_decision", {
    expectedField,
    phoneValidationFailed,
    capturedPhone: captured.phone ?? null,
    phoneValidationPending,
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

  if (expectedField === "phone") {
    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: phoneValidationFailed
        ? "phone_validation_failed"
        : phoneValidationPending
          ? "phone_validation_pending"
          : "phone_validated",
      title: phoneValidationFailed
        ? "WhatsApp informado não passou no teste"
        : phoneValidationPending
          ? "WhatsApp aguardando confirmação de entrega"
          : "WhatsApp validado e salvo",
      details: {
        phone: phoneValidationFailed
          ? extracted.phone ?? contentText
          : phoneValidationPending?.phone ?? captured.phone,
        external_message_id: phoneValidationPending?.messageId ?? null,
        zaap_id: phoneValidationPending?.zaapId ?? null,
      },
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

  return Response.json({ ok: true, inbound, outbound: outboundError ? null : outbound });
}
