import crypto from "node:crypto";
import OpenAI from "openai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

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
          text: `Mensagem: ${userText}\n\nSe houver imagem anexa, analise como comprovante de pagamento.`,
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

  const mediaUrl = getFirstNonEmpty(
    (body as any).image?.url,
    (body as any).imageUrl,
    (body as any).media?.url,
    (body as any).file?.url,
    (body as any).document?.url,
    (body as any).data?.image?.url,
    (body as any).data?.media?.url,
    (body as any).data?.file?.url,
    (body as any).data?.document?.url,
  );

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

  const hasContent = Boolean((messageText || "").trim() || (mediaUrl || "").trim());
  if (!hasContent) {
    return Response.json({ ok: true, ignored: true });
  }

  const analysis = await analyzePayment({ text: messageText, mediaUrl: mediaUrl || null }).catch((e: any) => ({
    ok: false as const,
    error: String(e?.message ?? "Falha ao analisar"),
  }));

  if (!analysis.ok) {
    return Response.json({ ok: true, analyzed: false, error: analysis.error });
  }

  const shouldCreate = analysis.result.is_payment_proof && analysis.result.confidence >= 0.75;
  if (!shouldCreate) {
    return Response.json({
      ok: true,
      analyzed: true,
      created: false,
      confidence: analysis.result.confidence,
    });
  }

  const normalizedFrom = normalizePhone(fromPhone);
  const { data: debtors } = await admin
    .from("debtors")
    .select("id, telefone")
    .eq("user_id", userId)
    .limit(500);

  const match = (debtors ?? []).find((d: any) => normalizePhone(String(d?.telefone ?? "")) === normalizedFrom);
  const debtorId = match?.id ? String(match.id) : null;

  const { data: schedule } = debtorId
    ? await admin
        .from("schedules")
        .select("id, status")
        .eq("user_id", userId)
        .eq("debtor_id", debtorId)
        .eq("status", "agendado")
        .order("data_envio", { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const scheduleId = schedule?.id ? String(schedule.id) : null;

  if (scheduleId) {
    await admin.from("schedules").update({ status: "suspeita_de_pagamento" }).eq("id", scheduleId);
  }

  await admin.from("payment_suspicions").insert({
    user_id: userId,
    schedule_id: scheduleId,
    debtor_id: debtorId,
    provider: "zapi",
    event_id: eventId,
    from_phone: normalizedFrom || fromPhone || null,
    message_text: messageText || null,
    media_url: mediaUrl || null,
    ai_confidence: analysis.result.confidence,
    ai_reason: analysis.result.reason || null,
    ai_result: analysis.result.raw,
    status: "pending",
  });

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "pagamento_suspeito",
    descricao: scheduleId
      ? `Suspeita de pagamento detectada para o agendamento ${scheduleId}`
      : "Suspeita de pagamento detectada (sem agendamento associado)",
  });

  return Response.json({ ok: true, analyzed: true, created: true, scheduleId });
}
