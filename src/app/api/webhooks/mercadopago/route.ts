import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getMercadoPagoAuthorizedPayment,
  getMercadoPagoPayment,
  getMercadoPagoPreapproval,
  getMercadoPagoWebhookSecret,
  validateMercadoPagoWebhook,
} from "@/lib/mercadopago";

export const runtime = "nodejs";

function addDaysISO(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toAppStatus(mpStatus: string | null | undefined) {
  const s = String(mpStatus ?? "").toLowerCase();
  if (s === "authorized" || s === "active") return "ativo";
  return "cancelado";
}

async function getPlanSlugByProviderPlanId(providerPlanId: string | null | undefined) {
  if (!providerPlanId) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("billing_plans")
    .select("slug")
    .eq("provider", "mercadopago")
    .eq("provider_plan_id", providerPlanId)
    .maybeSingle();
  return (data?.slug as "basico" | "pro" | undefined) ?? null;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const dataIdFromQuery = url.searchParams.get("data.id");
  const typeFromQuery = url.searchParams.get("type");

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");

  const secret = getMercadoPagoWebhookSecret();
  const isValid = validateMercadoPagoWebhook({
    secret,
    signatureHeader: xSignature,
    requestIdHeader: xRequestId,
    dataIdFromQuery,
  });

  if (!isValid) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as any;
  const type = (body?.type ?? typeFromQuery ?? null) as string | null;
  const dataId = (body?.data?.id ?? dataIdFromQuery ?? null) as string | null;

  if (!type || !dataId) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const eventId = `${xRequestId ?? "no-request-id"}:${type}:${dataId}`;
  const admin = createSupabaseAdminClient();

  await admin.from("billing_events").upsert(
    {
      provider: "mercadopago",
      event_id: eventId,
      event_type: type,
      payload: body ?? { type, data: { id: dataId } },
    },
    { onConflict: "provider,event_id" },
  );

  if (type === "subscription_preapproval") {
    const preapproval = await getMercadoPagoPreapproval(dataId);
    const subscriptionId = preapproval.id;

    const { data: billingSub } = await admin
      .from("billing_subscriptions")
      .select("user_id, plan_slug, provider_plan_id, provider_subscription_id")
      .eq("provider", "mercadopago")
      .eq("provider_subscription_id", subscriptionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const userId =
      billingSub?.user_id ??
      (typeof preapproval.external_reference === "string"
        ? preapproval.external_reference
        : null);

    const planSlug =
      (billingSub?.plan_slug as "basico" | "pro" | undefined) ??
      (await getPlanSlugByProviderPlanId(preapproval.preapproval_plan_id)) ??
      null;

    if (userId && planSlug) {
      const status = toAppStatus(preapproval.status);
      const vencimento = status === "ativo" ? addDaysISO(30) : null;

      await admin.from("billing_subscriptions").upsert(
        {
          user_id: userId,
          provider: "mercadopago",
          plan_slug: planSlug,
          provider_plan_id:
            billingSub?.provider_plan_id ?? preapproval.preapproval_plan_id ?? "",
          provider_subscription_id: subscriptionId,
          status: preapproval.status ?? "unknown",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider,provider_subscription_id" },
      );

      await admin.from("profiles").update({ plano: planSlug }).eq("user_id", userId);
      await admin.from("subscriptions").insert({
        user_id: userId,
        plano: planSlug,
        status,
        vencimento,
        provider: "mercadopago",
        provider_plan_id: preapproval.preapproval_plan_id ?? null,
        provider_subscription_id: subscriptionId,
        provider_status: preapproval.status ?? null,
      });
    }

    return NextResponse.json({ ok: true });
  }

  if (type === "subscription_authorized_payment") {
    const payment = await getMercadoPagoAuthorizedPayment(dataId);
    const preapprovalId = payment.preapproval_id ?? null;
    if (!preapprovalId) return NextResponse.json({ ok: true });

    const { data: billingSub } = await admin
      .from("billing_subscriptions")
      .select("user_id, plan_slug, provider_plan_id")
      .eq("provider", "mercadopago")
      .eq("provider_subscription_id", preapprovalId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const userId =
      billingSub?.user_id ??
      (typeof payment.external_reference === "string"
        ? payment.external_reference
        : null);

    const planSlug = (billingSub?.plan_slug as "basico" | "pro" | undefined) ?? null;
    if (!userId || !planSlug) return NextResponse.json({ ok: true });

    const pStatus = String(payment.status ?? "").toLowerCase();
    const status = pStatus === "approved" ? "ativo" : "cancelado";
    const vencimento = status === "ativo" ? addDaysISO(30) : null;

    await admin.from("profiles").update({ plano: planSlug }).eq("user_id", userId);
    await admin.from("subscriptions").insert({
      user_id: userId,
      plano: planSlug,
      status,
      vencimento,
      provider: "mercadopago",
      provider_plan_id: billingSub?.provider_plan_id ?? null,
      provider_subscription_id: preapprovalId,
      provider_status: payment.status ?? null,
    });

    return NextResponse.json({ ok: true });
  }

  if (type === "payment") {
    const payment = await getMercadoPagoPayment(dataId);
    const statusRaw = String(payment.status ?? "").toLowerCase();
    const status = statusRaw === "approved" ? "ativo" : "cancelado";
    const vencimento = status === "ativo" ? addDaysISO(30) : null;

    const metadata = payment.metadata ?? {};
    const planSlug = (metadata as any)?.plan_slug as "basico" | "pro" | undefined;
    const userIdFromMeta = (metadata as any)?.user_id as string | undefined;

    const userId =
      userIdFromMeta ??
      (typeof payment.external_reference === "string" &&
      payment.external_reference.includes(":")
        ? payment.external_reference.split(":")[0]
        : payment.external_reference ?? null);

    const plan =
      planSlug ??
      (typeof payment.external_reference === "string" &&
      payment.external_reference.includes(":")
        ? (payment.external_reference.split(":")[1] as any)
        : null);

    if (userId && (plan === "basico" || plan === "pro")) {
      if (status === "ativo") {
        await admin.from("profiles").update({ plano: plan }).eq("user_id", userId);
      }

      await admin.from("subscriptions").insert({
        user_id: userId,
        plano: plan,
        status,
        vencimento,
        provider: "mercadopago",
        provider_plan_id: null,
        provider_subscription_id: `pix:${payment.id}`,
        provider_status: payment.status ?? null,
      });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
