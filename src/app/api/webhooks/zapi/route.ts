import crypto from "node:crypto";
import fs from "node:fs";
import OpenAI from "openai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { confirmExecutedSchedulePaymentForUser } from "@/app/app/agenda/actions";
import { syncDebtorChargeStatus } from "@/lib/debtorChargeStatus";
import { botReplyForLead } from "@/lib/atendimento/bot";
import { appendHistoryEvent, syncConversationPreview } from "@/lib/atendimento/server";

export const runtime = "nodejs";

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
      location: "src/app/api/webhooks/zapi/route.ts",
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

function normalizePhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55")) return d;
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

async function findPendingPhoneValidationEvent(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  messageIds: string[];
}) {
  for (const messageId of params.messageIds) {
    if (!messageId) continue;
    const { data } = await params.admin
      .from("atendimento_history_events")
      .select("id, lead_id, conversation_id, details")
      .eq("event_type", "phone_validation_pending")
      .contains("details", { external_message_id: messageId })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      return data as any;
    }
  }
  return null;
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
  const traceId = `zapi-webhook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const authUrl = new URL(req.url);
  const authHeader = req.headers.get("authorization") ?? "";
  // #region debug-point A:auth-check
  __dbg(traceId, "A", "[DEBUG] zapi_webhook_auth_check", {
    hasSecretEnv: Boolean(process.env.ZAPI_WEBHOOK_SECRET),
    hasSecretQuery: Boolean(authUrl.searchParams.get("secret")),
    hasBearer: authHeader.startsWith("Bearer "),
    instanceIdQuery: authUrl.searchParams.get("instanceId") ?? authUrl.searchParams.get("instance_id") ?? null,
  });
  // #endregion
  if (!isAuthorized(req)) {
    // #region debug-point A:auth-rejected
    __dbg(traceId, "A", "[DEBUG] zapi_webhook_auth_rejected", {
      hasSecretEnv: Boolean(process.env.ZAPI_WEBHOOK_SECRET),
      hasSecretQuery: Boolean(authUrl.searchParams.get("secret")),
      hasBearer: authHeader.startsWith("Bearer "),
    });
    // #endregion
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
  if (eventType === "DeliveryCallback" || eventType === "MessageStatusCallback") {
    // #region debug-point C:callback-match-start
    __dbg(traceId, "C", "[DEBUG] zapi_webhook_callback_match_start", {
      eventType,
      rawEventId,
      callbackMessageIds,
      instanceId,
      userId,
    });
    // #endregion
    const pendingEvent = await findPendingPhoneValidationEvent({
      admin,
      messageIds: callbackMessageIds,
    });

    // #region debug-point C:callback-match-result
    __dbg(traceId, "C", "[DEBUG] zapi_webhook_callback_match_result", {
      eventType,
      callbackMessageIds,
      matchedPendingEventId: pendingEvent?.id ?? null,
      matchedLeadId: (pendingEvent as any)?.lead_id ?? null,
      matchedConversationId: (pendingEvent as any)?.conversation_id ?? null,
    });
    // #endregion

    if (!pendingEvent?.id) {
      return Response.json({ ok: true, ignored: true, reason: "no_pending_phone_validation" });
    }

    const pendingDetails = (pendingEvent as any)?.details ?? {};
    const pendingPhone = String((pendingDetails as any)?.phone ?? "").trim();
    const deliveryError = getFirstNonEmpty((body as any).error, (body as any).data?.error);
    const statusChange = normalizeText(
      getFirstNonEmpty((body as any).status, (body as any).data?.status),
    ).toUpperCase();
    const nowIso = new Date().toISOString();

    if (eventType === "DeliveryCallback" && deliveryError) {
      await admin
        .from("atendimento_history_events")
        .update({
          event_type: "phone_validation_failed",
          title: "WhatsApp informado não passou no teste",
          details: {
            ...(pendingDetails as Record<string, unknown>),
            final_status: "DELIVERY_ERROR",
            error: deliveryError,
            failed_at: nowIso,
          },
        })
        .eq("id", String((pendingEvent as any).id));

      const { data: failureMessage } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String((pendingEvent as any).conversation_id ?? ""),
          sender_role: "bot",
          content_text:
            "Não consegui entregar a mensagem de teste nesse WhatsApp. Por favor, informe um WhatsApp válido.",
          media_type: "text",
          status: "entregue",
          sent_at: nowIso,
          delivered_at: nowIso,
        })
        .select("id, content_text")
        .maybeSingle();

      const { data: leadRow } = await admin
        .from("atendimento_leads")
        .select("id, unread_count")
        .eq("id", String((pendingEvent as any).lead_id ?? ""))
        .maybeSingle();

      await admin
        .from("atendimento_leads")
        .update({
          unread_count: Number((leadRow as any)?.unread_count ?? 0) + 1,
          last_interaction_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", String((pendingEvent as any).lead_id ?? ""));

      await syncConversationPreview({
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
        contentText: String((failureMessage as any)?.content_text ?? ""),
        createdAt: nowIso,
      });

      return Response.json({ ok: true, validated: false, reason: "delivery_error" });
    }

    if (eventType === "MessageStatusCallback" && (statusChange === "RECEIVED" || statusChange === "READ")) {
      const { data: leadRecord } = await admin
        .from("atendimento_leads")
        .select("*")
        .eq("id", String((pendingEvent as any).lead_id ?? ""))
        .maybeSingle();

      if (!leadRecord?.id || !pendingPhone) {
        return Response.json({ ok: true, ignored: true, reason: "missing_pending_lead_or_phone" });
      }

      const nextLead = {
        ...(leadRecord as any),
        phone: pendingPhone,
      };
      const botResponse = botReplyForLead({
        lead: nextLead,
        messageText: "",
      });
      const successMessage =
        botResponse.message === "WhatsApp registrado com sucesso."
          ? "WhatsApp registrado com sucesso."
          : `WhatsApp registrado com sucesso. ${botResponse.message}`;
      const nextStatus = botResponse.message
        ? botResponse.status
        : "matricula_pendente";
      const nextStage = botResponse.message
        ? botResponse.stage
        : "pre_cadastro_concluido";

      await admin
        .from("atendimento_leads")
        .update({
          phone: pendingPhone,
          status: nextStatus,
          funnel_stage: nextStage,
          unread_count: Number((leadRecord as any)?.unread_count ?? 0) + 1,
          last_interaction_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", String((pendingEvent as any).lead_id ?? ""));

      await upsertCapturedPhoneField({
        leadId: String((pendingEvent as any).lead_id ?? ""),
        sourceMessageId: callbackMessageIds[0] ?? String((pendingEvent as any).id ?? ""),
        phone: pendingPhone,
      });

      await admin
        .from("atendimento_history_events")
        .update({
          event_type: "phone_validated",
          title: "WhatsApp validado e salvo",
          details: {
            ...(pendingDetails as Record<string, unknown>),
            final_status: statusChange,
            confirmed_at: nowIso,
          },
        })
        .eq("id", String((pendingEvent as any).id));

      const { data: outbound } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String((pendingEvent as any).conversation_id ?? ""),
          sender_role: "bot",
          content_text: successMessage,
          media_type: "text",
          status: "entregue",
          sent_at: nowIso,
          delivered_at: nowIso,
        })
        .select("content_text")
        .maybeSingle();

      await syncConversationPreview({
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
        contentText: String((outbound as any)?.content_text ?? successMessage),
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

    return Response.json({ ok: true, ignored: true, reason: "awaiting_final_phone_status" });
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
