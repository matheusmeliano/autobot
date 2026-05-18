import crypto from "crypto";

type MercadoPagoPlanSlug = "basico" | "pro";

function getMercadoPagoAccessToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error("Missing Mercado Pago access token");
  return token;
}

export function getMercadoPagoWebhookSecret() {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) throw new Error("Missing Mercado Pago webhook secret");
  return secret;
}

async function mpFetch<T>(path: string, init?: RequestInit) {
  const token = getMercadoPagoAccessToken();
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const body = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) {
    const error = new Error("Mercado Pago request failed");
    (error as any).status = res.status;
    (error as any).body = body;
    throw error;
  }

  return body as T;
}

export async function createMercadoPagoPlan(input: {
  slug: MercadoPagoPlanSlug;
  amount: number;
  backUrl: string;
}) {
  return mpFetch<{ id: string }>(`/preapproval_plan`, {
    method: "POST",
    body: JSON.stringify({
      reason: input.slug === "basico" ? "Plano Básico - AutoBot" : "Plano Pro - AutoBot",
      back_url: input.backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: input.amount,
        currency_id: "BRL",
      },
    }),
  });
}

export async function createMercadoPagoPreapproval(input: {
  planId: string;
  payerEmail: string;
  backUrl: string;
  externalReference: string;
  notificationUrl: string;
  cardTokenId: string;
  reason: string;
}) {
  return mpFetch<{ id: string; init_point?: string; sandbox_init_point?: string; status?: string }>(
    `/preapproval`,
    {
      method: "POST",
      body: JSON.stringify({
        preapproval_plan_id: input.planId,
        reason: input.reason,
        payer_email: input.payerEmail,
        back_url: input.backUrl,
        external_reference: input.externalReference,
        notification_url: input.notificationUrl,
        card_token_id: input.cardTokenId,
        status: "authorized",
      }),
    },
  );
}

export async function getMercadoPagoPreapproval(id: string) {
  return mpFetch<{
    id: string;
    status?: string;
    preapproval_plan_id?: string;
    external_reference?: string;
  }>(`/preapproval/${encodeURIComponent(id)}`, { method: "GET" });
}

export async function getMercadoPagoAuthorizedPayment(id: string) {
  return mpFetch<{
    id: string;
    status?: string;
    preapproval_id?: string;
    external_reference?: string;
    date_created?: string;
  }>(`/authorized_payments/${encodeURIComponent(id)}`, { method: "GET" });
}

export async function createMercadoPagoPixPayment(input: {
  amount: number;
  payerEmail: string;
  description: string;
  notificationUrl: string;
  externalReference: string;
  metadata?: Record<string, unknown>;
}) {
  return mpFetch<{
    id: number;
    status?: string;
    point_of_interaction?: {
      transaction_data?: {
        qr_code?: string;
        qr_code_base64?: string;
        ticket_url?: string;
      };
    };
  }>(`/v1/payments`, {
    method: "POST",
    body: JSON.stringify({
      transaction_amount: input.amount,
      description: input.description,
      payment_method_id: "pix",
      payer: { email: input.payerEmail },
      notification_url: input.notificationUrl,
      external_reference: input.externalReference,
      metadata: input.metadata ?? undefined,
    }),
  });
}

export async function createMercadoPagoCardPayment(input: {
  amount: number;
  token: string;
  paymentMethodId: string;
  issuerId: string;
  installments: number;
  payerEmail: string;
  identificationType: string;
  identificationNumber: string;
  description: string;
  notificationUrl: string;
  externalReference: string;
  metadata?: Record<string, unknown>;
}) {
  return mpFetch<{ id: number; status?: string }>(`/v1/payments`, {
    method: "POST",
    body: JSON.stringify({
      transaction_amount: input.amount,
      token: input.token,
      payment_method_id: input.paymentMethodId,
      issuer_id: input.issuerId,
      installments: input.installments,
      description: input.description,
      payer: {
        email: input.payerEmail,
        identification: {
          type: input.identificationType,
          number: input.identificationNumber,
        },
      },
      notification_url: input.notificationUrl,
      external_reference: input.externalReference,
      metadata: input.metadata ?? undefined,
    }),
  });
}

export async function getMercadoPagoPayment(id: string) {
  return mpFetch<{
    id: number;
    status?: string;
    external_reference?: string;
    metadata?: Record<string, unknown> | null;
  }>(`/v1/payments/${encodeURIComponent(id)}`, { method: "GET" });
}

function parseMercadoPagoSignature(signature: string | null) {
  if (!signature) return null;
  const parts = signature.split(",").map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith("ts="))?.slice(3) ?? null;
  const v1 = parts.find((p) => p.startsWith("v1="))?.slice(3) ?? null;
  if (!ts || !v1) return null;
  return { ts, v1 };
}

export function validateMercadoPagoWebhook(input: {
  secret: string;
  signatureHeader: string | null;
  requestIdHeader: string | null;
  dataIdFromQuery: string | null;
}) {
  const parsed = parseMercadoPagoSignature(input.signatureHeader);
  if (!parsed) return false;
  if (!input.requestIdHeader) return false;
  if (!input.dataIdFromQuery) return false;

  const dataId = input.dataIdFromQuery.toLowerCase();
  const manifest = `id:${dataId};request-id:${input.requestIdHeader};ts:${parsed.ts};`;
  const expected = crypto
    .createHmac("sha256", input.secret)
    .update(manifest)
    .digest("hex");

  if (expected.length !== parsed.v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.v1));
}
