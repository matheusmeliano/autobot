import crypto from "node:crypto";
import OpenAI from "openai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { confirmExecutedSchedulePaymentForUser } from "@/app/app/agenda/actions";
import { syncDebtorChargeStatus } from "@/lib/debtorChargeStatus";
import { botReplyForLead } from "@/lib/atendimento/bot";
import {
  ATENDIMENTO_PROFESSOR_TIME_ZONE,
  CAPTURED_FIELD_PROMPTS,
  EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE,
  WHATSAPP_REGISTERED_SUCCESS_MESSAGE,
} from "@/lib/atendimento/constants";
import {
  buildExperimentalClassDatesMessage,
  listExperimentalClassAvailability,
} from "@/lib/atendimento/experimentalClass";
import { appendHistoryEvent, syncConversationPreview } from "@/lib/atendimento/server";
import { resolveTimeZoneFromCityInput } from "@/lib/timezone";

export const runtime = "nodejs";
const MAX_PHONE_VALIDATION_ATTEMPTS = 3;
const WHATSAPP_INVALID_MESSAGE =
  "Não foi possível validar esse número de WhatsApp. Por favor, informe um WhatsApp válido com o código do país no início (+55 para Brasil ou +1 para Estados Unidos).";
const WHATSAPP_INVALID_FINAL_MESSAGE =
  "Não foi possível validar seu número de WhatsApp após 3 tentativas. Este cadastro foi bloqueado. Para tentar novamente, entre em contato com nosso suporte para desbloquear o e-mail utilizado ou realize um novo cadastro com outro e-mail.\n\nFale com nossa equipe pelo link abaixo:\n\nhttps://wa.me/5565996933336";
const WHATSAPP_TECHNICAL_TIMEOUT_MESSAGE =
  "Nao foi possivel concluir a validacao do seu WhatsApp neste momento por instabilidade tecnica. Tente novamente em instantes.";

function normalizePhone(phone: string) {
  const raw = String(phone ?? "").trim();
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (raw.startsWith("+")) return d;
  if (d.startsWith("55")) return d;
  if (d.startsWith("1") && d.length === 11) return d;
  if (d.length === 11) return `55${d}`;
  return d;
}

function isAuthorized(req: Request) {
  const secret = process.env.ZAPI_WEBHOOK_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  const q = url.searchParams.get("secret");
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  return q === secret || bearer === secret;
}

function extractString(v: unknown) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function getFirstNonEmpty(...values: Array<unknown>) {
  for (const v of values) {
    const s = extractString(v).trim();
    if (s) return s;
  }
  return "";
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildPhoneValidationRetryMessage(attempts: number) {
  return `${WHATSAPP_INVALID_MESSAGE}\n\nTentativa ${attempts} de ${MAX_PHONE_VALIDATION_ATTEMPTS}.`;
}

function normalizeValidationErrorText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isExplicitInvalidWhatsAppError(error: unknown) {
  const message = normalizeValidationErrorText(error);
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

async function upsertCapturedPhoneField(params: {
  leadId: string;
  sourceMessageId: string;
  phone: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("atendimento_captured_fields")
    .select("id")
    .eq("lead_id", params.leadId)
    .eq("field_name", "phone")
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from("atendimento_captured_fields")
      .update({
        field_value: params.phone,
        source_message_id: params.sourceMessageId,
        confidence: 0.92,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(existing.id));
    return;
  }

  await admin.from("atendimento_captured_fields").insert({
    lead_id: params.leadId,
    field_name: "phone",
    field_value: params.phone,
    source_message_id: params.sourceMessageId,
    confidence: 0.92,
  });
}

async function listScheduledExperimentalClassProfessorStarts(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  nowIso: string;
}) {
  const { data, error } = await params.admin
    .from("atendimento_experimental_class_bookings")
    .select("professor_start_at")
    .eq("status", "scheduled")
    .gte("professor_start_at", params.nowIso)
    .order("professor_start_at", { ascending: true });

  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  const tableMissing =
    Boolean(error) &&
    (code === "42P01" || /relation .*atendimento_experimental_class_bookings.*does not exist/i.test(message));
  if (error && !tableMissing) {
    throw new Error(error.message || "Falha ao consultar horários ocupados da aula experimental.");
  }

  const { data: historyData, error: historyError } = await params.admin
    .from("atendimento_history_events")
    .select("details")
    .eq("event_type", "experimental_class_scheduled")
    .order("created_at", { ascending: true });

  if (historyError) {
    throw new Error(historyError.message || "Falha ao consultar horários ocupados da aula experimental.");
  }

  return Array.from(
    new Set([
      ...(!tableMissing ? (data ?? []).map((row) => String((row as any)?.professor_start_at ?? "").trim()) : []),
      ...(historyData ?? []).map((row) => String(((row as any)?.details ?? {}).professor_start_at ?? "").trim()),
    ]),
  ).filter((value) => value && value >= params.nowIso);
}

async function findPendingPhoneValidationEvent(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  messageIds: string[];
}) {
  for (const messageId of params.messageIds) {
    if (!messageId) continue;
    const { data: byMessageId } = await params.admin
      .from("atendimento_history_events")
      .select("id, lead_id, conversation_id, details")
      .eq("event_type", "phone_validation_pending")
      .contains("details", { external_message_id: messageId })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byMessageId?.id) {
      return byMessageId as any;
    }

    const { data: byZaapId } = await params.admin
      .from("atendimento_history_events")
      .select("id, lead_id, conversation_id, details")
      .eq("event_type", "phone_validation_pending")
      .contains("details", { external_zaap_id: messageId })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byZaapId?.id) {
      return byZaapId as any;
    }
  }

  return null;
}

async function getPhoneValidationFailureCount(params: {
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

const POSITIVE_TEXT_SNIPPETS = [
  "pagamento realizado",
  "pix feito",
  "pix realizado",
  "pix pago",
  "pagamento efetuado",
  "ja paguei",
  "acabei de pagar",
  "efetuei o pagamento",
  "transferencia realizada",
  "valor pago",
  "conta quitada",
  "debito quitado",
  "mensalidade paga",
  "tudo certo com o pagamento",
  "envio de comprovante",
  "segue comprovante",
  "comprovante em anexo",
  "enviando comprovante",
  "comprovante do pagamento",
  "comprovante enviado",
  "anexei o comprovante",
  "print do pagamento",
  "print do pix",
  "comprovante pix",
  "recibo do pagamento",
  "evidencia do pagamento",
  "anexo do pagamento",
  "pago",
  "paguei",
  "ja foi pago",
  "ja esta pago",
  "feito",
  "resolvido",
  "tudo pago",
  "esta quitado",
  "pagamento concluido",
  "pix enviado",
  "transferido",
  "acabei de fazer o pix",
  "ok, pago",
  "pago agora",
  "enviei o pix",
  "confira o pix",
  "pode verificar",
  "da uma olhada",
  "confirma ai",
  "recebeu?",
];

const NEGATIVE_TEXT_SNIPPETS = [
  "vou pagar",
  "pagarei",
  "pago amanha",
  "vou fazer o pix",
  "vou fazer pix",
  "manda o pix",
  "manda sua chave",
  "qual a chave",
  "posso pagar",
  "como posso pagar",
];

function extractMediaInfo(body: any) {
  const mediaUrl = getFirstNonEmpty(
    body?.image?.url,
    body?.imageUrl,
    body?.media?.url,
    body?.file?.url,
    body?.document?.url,
    body?.message?.image?.url,
    body?.message?.document?.url,
    body?.message?.file?.url,
    body?.data?.image?.url,
    body?.data?.media?.url,
    body?.data?.file?.url,
    body?.data?.document?.url,
    body?.data?.message?.image?.url,
    body?.data?.message?.document?.url,
    body?.data?.message?.file?.url,
    Array.isArray(body?.messages) ? body?.messages?.[0]?.image?.url : "",
    Array.isArray(body?.messages) ? body?.messages?.[0]?.document?.url : "",
  );

  const typeSource = normalizeText(
    getFirstNonEmpty(
      body?.type,
      body?.event,
      body?.eventType,
      body?.message?.type,
      body?.message?.mimetype,
      body?.message?.mimeType,
      body?.data?.type,
      body?.data?.event,
      body?.data?.message?.type,
      body?.data?.message?.mimetype,
      body?.data?.message?.mimeType,
      Array.isArray(body?.messages) ? body?.messages?.[0]?.type : "",
      Array.isArray(body?.messages) ? body?.messages?.[0]?.mimetype : "",
    ),
  );

  const hasImageFlag =
    Boolean(body?.image || body?.message?.image || body?.data?.image || body?.data?.message?.image) ||
    typeSource.includes("image") ||
    typeSource.includes("imagem");
  const hasDocumentFlag =
    Boolean(body?.document || body?.message?.document || body?.data?.document || body?.data?.message?.document) ||
    typeSource.includes("document") ||
    typeSource.includes("arquivo") ||
    typeSource.includes("application/");

  return {
    mediaUrl,
    hasPaymentMedia: Boolean(mediaUrl || hasImageFlag || hasDocumentFlag),
  };
}

function heuristicPaymentDetection(params: { text: string; mediaUrl?: string | null; hasPaymentMedia?: boolean }) {
  const t = normalizeText(params.text || "");
  const hasMedia = Boolean(params.hasPaymentMedia || (params.mediaUrl || "").trim());
  const positive = POSITIVE_TEXT_SNIPPETS.some((snippet) => t.includes(snippet));
  const negative = NEGATIVE_TEXT_SNIPPETS.some((snippet) => t.includes(snippet));

  const isPayment = (positive || hasMedia) && !negative;
  if (!isPayment) {
    return { ok: false as const };
  }
  return {
    ok: true as const,
    result: {
      is_payment_proof: true,
      confidence: hasMedia ? 0.9 : 0.8,
      reason: hasMedia ? "Imagem/anexo recebido como potencial comprovante." : "Confirmação textual de pagamento detectada.",
      raw: { source: "heuristic", positive, negative, hasMedia },
    },
  };
}

async function analyzePayment(params: { text: string; mediaUrl?: string | null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false as const, error: "OPENAI_API_KEY não configurada" };
  }

  const openai = new OpenAI({ apiKey });
  const system = `Você analisa mensagens do WhatsApp (texto e/ou comprovante) e decide se isso é MUITO PROVAVELMENTE uma evidência de pagamento referente a uma cobrança.

Retorne sempre um JSON válido (sem texto fora do JSON) no formato:
{
  "is_payment_proof": boolean,
  "confidence": number,
  "reason": "string curta",
  "extracted": {
    "amount_brl": "string ou vazio",
    "payment_date": "string ou vazio",
    "payer_name": "string ou vazio",
    "reference": "string ou vazio"
  }
}

Regras:
- confidence deve ser entre 0 e 1
- Toda imagem ou documento enviado pelo cliente após uma cobrança deve ser tratado como potencial comprovante e pode gerar suspeita de pagamento mesmo sem texto.
- is_payment_proof só pode ser true quando confidence >= 0.75 e existir evidência clara de pagamento, seja:
  - comprovante/recibo/print (imagem) com sinais claros de transação, ou
  - confirmação textual explícita de que JÁ PAGOU (ex: "paguei", "pix feito", "transferi", "já está pago"), preferencialmente com algum detalhe (valor, data/hora, banco, id/transação, referência).
- Não marque como pagamento quando o texto indicar intenção futura ("vou pagar", "pagarei amanhã"), pedido de dados ("manda o pix"), ou dúvida ("posso pagar?").
`;

  const userText = params.text?.trim() ? params.text.trim() : "(sem texto)";

  const content = params.mediaUrl
    ? ([
        {
          type: "text",
          text: `Mensagem: ${userText}\n\nSe houver imagem ou documento anexado, trate como potencial comprovante de pagamento.`,
        },
        { type: "image_url", image_url: { url: params.mediaUrl } },
      ] as any)
    : (`Mensagem: ${userText}\n\nResponda apenas com o JSON.` as any);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const raw = completion.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  const isPayment = Boolean((parsed as any)?.is_payment_proof);
  const confidenceRaw = Number((parsed as any)?.confidence ?? 0);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
  const reason = extractString((parsed as any)?.reason);
  return {
    ok: true as const,
    result: {
      is_payment_proof: isPayment,
      confidence,
      reason,
      extracted: (parsed as any)?.extracted ?? null,
      raw: parsed,
    },
  };
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: true, ignored: true });
  }

  const instanceId = getFirstNonEmpty(
    url.searchParams.get("instanceId"),
    url.searchParams.get("instance_id"),
    (body as any).instanceId,
    (body as any).instance_id,
    (body as any).instance,
    (body as any).id,
    (body as any).data?.instanceId,
    (body as any).data?.instance_id,
  );

  const eventType = getFirstNonEmpty(
    (body as any).type,
    (body as any).event,
    (body as any).eventType,
    (body as any).data?.type,
    (body as any).data?.event,
  );

  const rawEventId = getFirstNonEmpty(
    (body as any).messageId,
    (body as any).message_id,
    (body as any).idMessage,
    (body as any).data?.messageId,
    (body as any).data?.message_id,
    (body as any).data?.idMessage,
  );

  const payloadString = JSON.stringify(body);
  const eventId = rawEventId || crypto.createHash("sha256").update(payloadString).digest("hex");

  const fromPhone = getFirstNonEmpty(
    (body as any).phone,
    (body as any).from,
    (body as any).sender?.phone,
    (body as any).senderPhone,
    (body as any).message?.from,
    (body as any).message?.phone,
    (body as any).data?.message?.from,
    (body as any).data?.message?.phone,
    (body as any).data?.phone,
    (body as any).data?.from,
    (body as any).data?.sender?.phone,
  );

  const messageText = getFirstNonEmpty(
    (body as any).text?.message,
    (body as any).text?.body,
    (body as any).message,
    (body as any).body,
    (body as any).message?.text,
    (body as any).message?.body,
    (body as any).data?.message?.text,
    (body as any).data?.message?.body,
    Array.isArray((body as any).messages) ? (body as any).messages?.[0]?.text : "",
    Array.isArray((body as any).messages) ? (body as any).messages?.[0]?.body : "",
    (body as any).data?.text?.message,
    (body as any).data?.message,
    (body as any).data?.body,
  );

  const mediaInfo = extractMediaInfo(body);
  const mediaUrl = mediaInfo.mediaUrl;

  if (!instanceId) {
    return Response.json({ ok: true, ignored: true, reason: "missing_instance_id" });
  }

  const admin = createSupabaseAdminClient();
  const { data: instance, error: instErr } = await admin
    .from("whatsapp_instances")
    .select("user_id")
    .eq("instance_id", instanceId)
    .maybeSingle();

  if (instErr) {
    return Response.json({ ok: false, error: instErr.message }, { status: 500 });
  }

  const userId = instance?.user_id ? String(instance.user_id) : "";
  if (!userId) {
    return Response.json({ ok: true, ignored: true, reason: "unknown_instance" });
  }

  const normalizedEventType = String(eventType ?? "").trim();
  const nextInstanceStatus =
    normalizedEventType === "DisconnectedCallback"
      ? "disconnected"
      : normalizedEventType === "ReceivedCallback" ||
          normalizedEventType === "MessageStatusCallback" ||
          normalizedEventType === "DeliveryCallback"
        ? "connected"
        : null;

  if (nextInstanceStatus) {
    await admin
      .from("whatsapp_instances")
      .update({ status: nextInstanceStatus })
      .eq("instance_id", instanceId);
  }

  await admin.from("whatsapp_events").upsert(
    {
      user_id: userId,
      provider: "zapi",
      event_id: eventId,
      instance_id: instanceId,
      event_type: eventType || null,
      payload: body,
    },
    { onConflict: "provider,event_id" },
  );

  const callbackMessageIds = Array.from(
    new Set(
      [
        rawEventId,
        ...(Array.isArray((body as any).ids)
          ? (body as any).ids.map((value: unknown) => String(value ?? "").trim())
          : []),
      ].filter(Boolean),
    ),
  );
  if ((eventType === "DeliveryCallback" || eventType === "MessageStatusCallback") && callbackMessageIds.length > 0) {
    const pendingEvent = await findPendingPhoneValidationEvent({
      admin,
      messageIds: callbackMessageIds,
    });

    if (!pendingEvent?.id) {
      return Response.json({ ok: true, ignored: true, reason: "no_pending_phone_validation" });
    }

    const pendingDetails = ((pendingEvent as any).details ?? {}) as Record<string, unknown>;
    const pendingPhone = String(pendingDetails.phone ?? "").trim();
    const deliveryError = getFirstNonEmpty((body as any).error, (body as any).data?.error);
    const statusChange = normalizeText(
      getFirstNonEmpty((body as any).status, (body as any).data?.status),
    ).toUpperCase();
    const nowIso = new Date().toISOString();

    if (eventType === "DeliveryCallback" && deliveryError) {
      const isRealInvalidWhatsApp = isExplicitInvalidWhatsAppError(deliveryError);
      const { data: claimedFailureEvent } = await admin
        .from("atendimento_history_events")
        .update({
          event_type: isRealInvalidWhatsApp ? "phone_validation_failed" : "phone_validation_timeout",
          title: isRealInvalidWhatsApp
            ? "WhatsApp informado não passou no teste"
            : "Validacao do WhatsApp falhou por indisponibilidade tecnica",
          details: {
            ...pendingDetails,
            final_status: isRealInvalidWhatsApp ? "DELIVERY_ERROR" : "DELIVERY_TECHNICAL_ERROR",
            error: deliveryError,
            failed_at: nowIso,
          },
        })
        .eq("id", String((pendingEvent as any).id))
        .eq("event_type", "phone_validation_pending")
        .select("id")
        .maybeSingle();

      if (!claimedFailureEvent?.id) {
        return Response.json({ ok: true, ignored: true, reason: "phone_validation_already_processed" });
      }

      const { data: leadRow } = await admin
        .from("atendimento_leads")
        .select("id, unread_count, status, funnel_stage")
        .eq("id", String((pendingEvent as any).lead_id ?? ""))
        .maybeSingle();

      if (!isRealInvalidWhatsApp) {
        const { data: technicalMessage } = await admin
          .from("atendimento_messages")
          .insert({
            conversation_id: String((pendingEvent as any).conversation_id ?? ""),
            sender_role: "bot",
            content_text: WHATSAPP_TECHNICAL_TIMEOUT_MESSAGE,
            media_type: "text",
            status: "entregue",
            sent_at: nowIso,
            delivered_at: nowIso,
          })
          .select("id, content_text")
          .maybeSingle();

        await admin
          .from("atendimento_leads")
          .update({
            status: (leadRow as any)?.status ?? null,
            funnel_stage: (leadRow as any)?.funnel_stage ?? null,
            last_interaction_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", String((pendingEvent as any).lead_id ?? ""));

        await syncConversationPreview({
          conversationId: String((pendingEvent as any).conversation_id ?? ""),
          contentText: String((technicalMessage as any)?.content_text ?? WHATSAPP_TECHNICAL_TIMEOUT_MESSAGE),
          createdAt: nowIso,
        });

        return Response.json({ ok: true, validated: false, reason: "delivery_error_technical" });
      }

      const failureAttempts = await getPhoneValidationFailureCount({
        admin,
        leadId: String((pendingEvent as any).lead_id ?? ""),
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
      });
      const shouldBlockConversation = failureAttempts >= MAX_PHONE_VALIDATION_ATTEMPTS;

      const { data: failureMessage } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String((pendingEvent as any).conversation_id ?? ""),
          sender_role: "bot",
          content_text: shouldBlockConversation
            ? WHATSAPP_INVALID_FINAL_MESSAGE
            : buildPhoneValidationRetryMessage(failureAttempts),
          media_type: "text",
          status: "entregue",
          sent_at: nowIso,
          delivered_at: nowIso,
        })
        .select("id, content_text")
        .maybeSingle();

      await admin
        .from("atendimento_leads")
        .update({
          status: shouldBlockConversation ? "encerrado" : (leadRow as any)?.status ?? null,
          funnel_stage: shouldBlockConversation ? "encerrado" : (leadRow as any)?.funnel_stage ?? null,
          last_interaction_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", String((pendingEvent as any).lead_id ?? ""));

      if (shouldBlockConversation) {
        await admin
          .from("atendimento_conversations")
          .update({
            bot_enabled: false,
            updated_at: nowIso,
          })
          .eq("id", String((pendingEvent as any).conversation_id ?? ""));

        await admin.from("atendimento_history_events").insert({
          lead_id: String((pendingEvent as any).lead_id ?? ""),
          conversation_id: String((pendingEvent as any).conversation_id ?? ""),
          event_type: "conversation_closed",
          title: "Atendimento encerrado após 3 tentativas inválidas de WhatsApp",
          details: {
            invalid_attempts: failureAttempts,
            source: "delivery_callback",
          },
          actor_type: "system",
          actor_email: null,
        });
      }

      await syncConversationPreview({
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
        contentText: String((failureMessage as any)?.content_text ?? ""),
        createdAt: nowIso,
      });

      return Response.json({ ok: true, validated: false, reason: "delivery_error" });
    }

    const shouldConfirmPhoneValidation =
      (eventType === "DeliveryCallback" && !deliveryError) ||
      (eventType === "MessageStatusCallback" &&
        (statusChange === "SENT" || statusChange === "RECEIVED" || statusChange === "READ"));

    if (!shouldConfirmPhoneValidation) {
      return Response.json({ ok: true, ignored: true, reason: "awaiting_final_phone_status" });
    }

    const { data: claimedSuccessEvent } = await admin
      .from("atendimento_history_events")
      .update({
        event_type: "phone_validated",
        title: "WhatsApp validado e salvo",
        details: {
          ...pendingDetails,
          final_status: statusChange || eventType,
          confirmed_at: nowIso,
        },
      })
      .eq("id", String((pendingEvent as any).id))
      .eq("event_type", "phone_validation_pending")
      .select("id")
      .maybeSingle();

    if (!claimedSuccessEvent?.id) {
      return Response.json({ ok: true, ignored: true, reason: "phone_validation_already_processed" });
    }

    const { data: leadRecord } = await admin
      .from("atendimento_leads")
      .select("*")
      .eq("id", String((pendingEvent as any).lead_id ?? ""))
      .maybeSingle();

    if (!leadRecord?.id || !pendingPhone) {
      return Response.json({ ok: true, ignored: true, reason: "missing_pending_lead_or_phone" });
    }

    const resolvedLeadLocation = String((leadRecord as any)?.city ?? "").trim()
      ? resolveTimeZoneFromCityInput({
          city: String((leadRecord as any)?.city ?? ""),
          state: String((leadRecord as any)?.state ?? ""),
          phone: pendingPhone,
        })
      : null;

    const nextLead = {
      ...(leadRecord as any),
      phone: pendingPhone,
      timezone: resolvedLeadLocation?.timeZone ?? (String((leadRecord as any)?.timezone ?? "").trim() || null),
      country:
        resolvedLeadLocation?.country === "BR"
          ? "Brasil"
          : resolvedLeadLocation?.country === "US"
            ? "Estados Unidos"
            : String((leadRecord as any)?.country ?? "").trim() || null,
    };
    const botResponse = botReplyForLead({
      lead: nextLead,
      messageText: "",
    });
    const successMessage = WHATSAPP_REGISTERED_SUCCESS_MESSAGE;
    const nextStatus = botResponse.status;
    const nextStage = botResponse.stage;

    await admin
      .from("atendimento_leads")
      .update({
        phone: pendingPhone,
        ...(resolvedLeadLocation
          ? {
              state: resolvedLeadLocation.state,
              city: resolvedLeadLocation.city,
              timezone: resolvedLeadLocation.timeZone,
              country: resolvedLeadLocation.country === "BR" ? "Brasil" : "Estados Unidos",
            }
          : {}),
        status: nextStatus,
        funnel_stage: nextStage,
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", String((pendingEvent as any).lead_id ?? ""));

    await upsertCapturedPhoneField({
      leadId: String((pendingEvent as any).lead_id ?? ""),
      sourceMessageId: callbackMessageIds[0] ?? String((pendingEvent as any).id ?? ""),
      phone: pendingPhone,
    });

    if (resolvedLeadLocation) {
      await appendHistoryEvent({
        leadId: String((pendingEvent as any).lead_id ?? ""),
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
        eventType: "lead_timezone_identified",
        title: "Cidade e fuso do lead identificados automaticamente",
        details: {
          state: resolvedLeadLocation.state,
          city: resolvedLeadLocation.city,
          timezone: resolvedLeadLocation.timeZone,
          teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
          country: resolvedLeadLocation.country === "BR" ? "Brasil" : "Estados Unidos",
          source: resolvedLeadLocation.source,
        },
        actorType: "system",
      });
    }

    const outgoingMessages = [successMessage];
    const followUpMessage = String(botResponse.message ?? "").trim();
    if (followUpMessage && followUpMessage !== successMessage) {
      outgoingMessages.push(followUpMessage);
    }

    let previewText = successMessage;
    for (const message of outgoingMessages) {
      const { data: outbound } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String((pendingEvent as any).conversation_id ?? ""),
          sender_role: "bot",
          content_text: message,
          media_type: "text",
          status: "entregue",
          sent_at: nowIso,
          delivered_at: nowIso,
        })
        .select("content_text")
        .maybeSingle();

      previewText = String((outbound as any)?.content_text ?? message);
    }

    if (followUpMessage === EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE) {
      const bookedProfessorStarts = await listScheduledExperimentalClassProfessorStarts({
        admin,
        nowIso,
      });
      const availability = listExperimentalClassAvailability({
        leadTimeZone: String((nextLead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
        bookedProfessorStartAts: bookedProfessorStarts,
      });
      const availabilityMessage = buildExperimentalClassDatesMessage(availability.dates);

      const { data: availabilityOutbound } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String((pendingEvent as any).conversation_id ?? ""),
          sender_role: "bot",
          content_text: availabilityMessage,
          media_type: "text",
          status: "entregue",
          sent_at: nowIso,
          delivered_at: nowIso,
        })
        .select("content_text")
        .maybeSingle();

      previewText = String((availabilityOutbound as any)?.content_text ?? availabilityMessage);

      await appendHistoryEvent({
        leadId: String((pendingEvent as any).lead_id ?? ""),
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
        eventType: "experimental_class_date_options_presented",
        title: "Datas disponíveis da aula experimental apresentadas",
        details: {
          teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
          lead_timezone: String((nextLead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
          options: availability.dates,
        },
        actorType: "system",
      });
    }

    if (
      followUpMessage === CAPTURED_FIELD_PROMPTS.state ||
      followUpMessage === CAPTURED_FIELD_PROMPTS.city
    ) {
      await appendHistoryEvent({
        leadId: String((pendingEvent as any).lead_id ?? ""),
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
        eventType: "lead_timezone_collection_started",
        title: "Coleta de estado e cidade do lead iniciada após validação do WhatsApp",
        details: {
          teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
        },
        actorType: "system",
      });
    }

    await syncConversationPreview({
      conversationId: String((pendingEvent as any).conversation_id ?? ""),
      contentText: previewText,
      createdAt: nowIso,
    });

    await appendHistoryEvent({
      leadId: String((pendingEvent as any).lead_id ?? ""),
      conversationId: String((pendingEvent as any).conversation_id ?? ""),
      eventType: "stage_changed",
      title: "Etapa do funil atualizada automaticamente",
      details: { status: nextStatus, funnel_stage: nextStage },
      actorType: "bot",
    });

    return Response.json({ ok: true, validated: true, reason: "message_received" });
  }

  const hasContent = Boolean((messageText || "").trim() || mediaInfo.hasPaymentMedia);
  if (!hasContent) {
    await admin.from("logs").insert({
      user_id: userId,
      tipo: "zapi_webhook_recebido",
      descricao: `Webhook recebido (sem conteúdo): instance=${instanceId} type=${eventType || "-"}`,
    });
    return Response.json({ ok: true, ignored: true });
  }

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "zapi_webhook_recebido",
    descricao: `Webhook recebido: instance=${instanceId} type=${eventType || "-"} from=${normalizePhone(fromPhone) || "-"}`,
  });

  const normalizedFrom = normalizePhone(fromPhone);
  if (!normalizedFrom) {
    await admin.from("logs").insert({
      user_id: userId,
      tipo: "zapi_webhook_ignorado",
      descricao: "Webhook financeiro ignorado: remetente sem telefone identificável.",
    });
    return Response.json({ ok: true, ignored: true, reason: "missing_sender_phone" });
  }

  const { data: debtors } = await admin
    .from("debtors")
    .select("id, telefone")
    .eq("user_id", userId)
    .limit(500);

  const match = (debtors ?? []).find((d: any) => normalizePhone(String(d?.telefone ?? "")) === normalizedFrom);
  const debtorId = match?.id ? String(match.id) : null;
  if (!debtorId) {
    await admin.from("logs").insert({
      user_id: userId,
      tipo: "zapi_webhook_ignorado",
      descricao: `Webhook financeiro ignorado: telefone ${normalizedFrom} sem cliente cadastrado.`,
    });
    return Response.json({ ok: true, ignored: true, reason: "unknown_debtor" });
  }

  const { data: activeSchedule } = await admin
    .from("schedules")
    .select("id, status")
    .eq("user_id", userId)
    .eq("debtor_id", debtorId)
    .in("status", ["pendente", "atrasado"])
    .order("data_envio", { ascending: true })
    .limit(1)
    .maybeSingle();

  const scheduleId = activeSchedule?.id ? String(activeSchedule.id) : null;
  if (!scheduleId) {
    await admin.from("logs").insert({
      user_id: userId,
      tipo: "zapi_webhook_ignorado",
      descricao: `Webhook financeiro ignorado: cliente ${debtorId} sem cobrança pendente/atrasada.`,
    });
    return Response.json({ ok: true, ignored: true, reason: "no_open_charge" });
  }

  const analysis =
    (await analyzePayment({ text: messageText, mediaUrl: mediaUrl || null }).catch((e: any) => ({
      ok: false as const,
      error: String(e?.message ?? "Falha ao analisar"),
    }))) || { ok: false as const, error: "Falha ao analisar" };

  const fallbackRes = analysis.ok
    ? null
    : heuristicPaymentDetection({
        text: messageText,
        mediaUrl: mediaUrl || null,
        hasPaymentMedia: mediaInfo.hasPaymentMedia,
      });
  if (!analysis.ok && (!fallbackRes || !fallbackRes.ok)) {
    return Response.json({ ok: true, analyzed: false, error: analysis.error });
  }

  const fallbackResult = fallbackRes && fallbackRes.ok ? fallbackRes.result : null;
  const finalResult = analysis.ok
    ? analysis.result
    : {
        is_payment_proof: true,
        confidence: fallbackResult?.confidence ?? 0,
        reason: fallbackResult?.reason ?? "",
        extracted: null,
        raw: fallbackResult?.raw ?? null,
      };

  const shouldCreate = finalResult.is_payment_proof && finalResult.confidence >= 0.75;
  if (!shouldCreate) {
    return Response.json({
      ok: true,
      analyzed: true,
      created: false,
      confidence: finalResult.confidence,
    });
  }

  const nowIso = new Date().toISOString();

  if (scheduleId) {
    const paymentRes = await confirmExecutedSchedulePaymentForUser({ scheduleId, userId });
    if (!paymentRes.ok) {
      return Response.json(
        { ok: false, error: paymentRes.error ?? "Falha ao confirmar pagamento." },
        { status: 500 },
      );
    }

    await admin.from("payment_suspicions").upsert(
      {
        user_id: userId,
        schedule_id: scheduleId,
        debtor_id: debtorId,
        provider: "zapi",
        event_id: eventId,
        from_phone: normalizedFrom || fromPhone || null,
        message_text: messageText || null,
        media_url: mediaUrl || null,
        ai_confidence: finalResult.confidence,
        ai_reason: finalResult.reason || null,
        ai_result: finalResult.raw,
        status: "confirmed",
        resolved_at: nowIso,
      },
      { onConflict: "provider,event_id" },
    );

    await admin.from("logs").insert({
      user_id: userId,
      tipo: "pagamento_confirmado",
      descricao: `Pagamento confirmado automaticamente para o agendamento ${scheduleId}`,
    });

    return Response.json({ ok: true, analyzed: true, created: true, scheduleId, confirmed: true });
  }

  await admin.from("payment_suspicions").upsert(
    {
      user_id: userId,
      schedule_id: scheduleId,
      debtor_id: debtorId,
      provider: "zapi",
      event_id: eventId,
      from_phone: normalizedFrom || fromPhone || null,
      message_text: messageText || null,
      media_url: mediaUrl || null,
      ai_confidence: finalResult.confidence,
      ai_reason: finalResult.reason || null,
      ai_result: finalResult.raw,
      status: "pending",
    },
    { onConflict: "provider,event_id" },
  );

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "pagamento_suspeito",
    descricao: "Suspeita de pagamento detectada (sem agendamento associado)",
  });

  return Response.json({ ok: true, analyzed: true, created: true, scheduleId });
}
