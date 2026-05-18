import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createMercadoPagoPlan,
  createMercadoPagoPreapproval,
} from "@/lib/mercadopago";

export const runtime = "nodejs";

function addDaysISO(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const schema = z.object({
  plan: z.enum(["basico", "pro"]),
  card_token_id: z.string().min(1),
});

const planAmount: Record<"basico" | "pro", number> = {
  basico: 49,
  pro: 99,
};

function getMercadoPagoErrorMessage(err: unknown) {
  const body = (err as any)?.body;
  return (
    (typeof body?.message === "string" && body.message) ||
    (typeof body?.error === "string" && body.error) ||
    (typeof body?.cause?.[0]?.description === "string" && body.cause[0].description) ||
    null
  );
}

function isInactiveTemplateError(err: unknown) {
  const mpMsg = getMercadoPagoErrorMessage(err);
  if (!mpMsg) return false;
  return mpMsg.toLowerCase().includes("cannot create a new preapproval") &&
    mpMsg.toLowerCase().includes("cancelled/inactive template");
}

async function getOrCreatePlanId(slug: "basico" | "pro", backUrl: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("billing_plans")
    .select("provider_plan_id")
    .eq("provider", "mercadopago")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    const msg = String(error.message ?? "");
    if (msg.toLowerCase().includes("does not exist")) {
      const e = new Error("MIGRATION_NOT_APPLIED");
      (e as any).details = error;
      throw e;
    }
    throw error;
  }

  if (data?.provider_plan_id) return data.provider_plan_id;

  const created = await createMercadoPagoPlan({
    slug,
    amount: planAmount[slug],
    backUrl,
  });

  const insertRes = await admin.from("billing_plans").insert({
    provider: "mercadopago",
    slug,
    provider_plan_id: created.id,
    amount_cents: planAmount[slug] * 100,
    currency: "BRL",
    interval: "month",
    interval_count: 1,
  });
  if (insertRes.error) {
    const msg = String(insertRes.error.message ?? "");
    if (msg.toLowerCase().includes("does not exist")) {
      const e = new Error("MIGRATION_NOT_APPLIED");
      (e as any).details = insertRes.error;
      throw e;
    }
    throw insertRes.error;
  }

  return created.id;
}

async function replacePlanId(slug: "basico" | "pro", backUrl: string) {
  const admin = createSupabaseAdminClient();
  const created = await createMercadoPagoPlan({
    slug,
    amount: planAmount[slug],
    backUrl,
  });

  const upsertRes = await admin.from("billing_plans").upsert(
    {
      provider: "mercadopago",
      slug,
      provider_plan_id: created.id,
      amount_cents: planAmount[slug] * 100,
      currency: "BRL",
      interval: "month",
      interval_count: 1,
    },
    { onConflict: "provider,slug" },
  );
  if (upsertRes.error) {
    const msg = String(upsertRes.error.message ?? "");
    if (msg.toLowerCase().includes("does not exist")) {
      const e = new Error("MIGRATION_NOT_APPLIED");
      (e as any).details = upsertRes.error;
      throw e;
    }
    throw upsertRes.error;
  }

  return created.id;
}

function errorToUserMessage(err: unknown) {
  const message = err instanceof Error ? err.message : "";

  if (message === "MIGRATION_NOT_APPLIED") {
    return "Pagamentos ainda não configurados no Supabase. Aplique a migration 20260518_mercadopago_billing.sql no Supabase.";
  }

  if (message.toLowerCase().includes("missing mercado pago access token")) {
    return "Pagamentos ainda não configurados na Vercel. Configure MERCADOPAGO_ACCESS_TOKEN (produção) e faça redeploy.";
  }

  if (message.toLowerCase().includes("missing supabase service role credentials")) {
    return "Configuração do Supabase incompleta na Vercel. Configure SUPABASE_SERVICE_ROLE_KEY e faça redeploy.";
  }

  const mpMsg = getMercadoPagoErrorMessage(err);

  if (mpMsg) {
    if (mpMsg.includes("CC_VAL_433")) {
      return "Mercado Pago: validação do cartão falhou. Se você estiver testando, use credenciais TEST e cartão de teste. Se for cartão real, confira os dados, limite e se o cartão está habilitado para compras online.";
    }
    if (mpMsg.toLowerCase().includes("cannot create a new preapproval") && mpMsg.toLowerCase().includes("cancelled/inactive template")) {
      return "Mercado Pago: o plano de assinatura foi desativado. Tente novamente em alguns segundos.";
    }
    return `Mercado Pago: ${mpMsg}`;
  }

  return "Falha ao iniciar pagamento. Verifique as variáveis da Vercel e se sua conta Mercado Pago está habilitada para assinaturas.";
}

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos. Verifique os dados do cartão." },
        { status: 400 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id || !user.email) {
      return NextResponse.json({ error: "Sem sessão." }, { status: 401 });
    }

    const reqUrl = new URL(req.url);
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? reqUrl.origin;
    const notificationUrl = `${origin}/api/webhooks/mercadopago`;
    const backUrl = `${origin}/app/assinatura?mp=1`;

    let planId = await getOrCreatePlanId(parsed.data.plan, backUrl);

    let created;
    try {
      created = await createMercadoPagoPreapproval({
        planId,
        payerEmail: user.email,
        backUrl,
        externalReference: user.id,
        notificationUrl,
        cardTokenId: parsed.data.card_token_id,
        reason:
          parsed.data.plan === "basico" ? "Plano Básico - AutoBot" : "Plano Pro - AutoBot",
      });
    } catch (err) {
      if (!isInactiveTemplateError(err)) throw err;
      planId = await replacePlanId(parsed.data.plan, backUrl);
      created = await createMercadoPagoPreapproval({
        planId,
        payerEmail: user.email,
        backUrl,
        externalReference: user.id,
        notificationUrl,
        cardTokenId: parsed.data.card_token_id,
        reason:
          parsed.data.plan === "basico" ? "Plano Básico - AutoBot" : "Plano Pro - AutoBot",
      });
    }

    const admin = createSupabaseAdminClient();
    const createdStatus = String(created.status ?? "").toLowerCase();
    const appStatus =
      createdStatus === "authorized" || createdStatus === "active"
        ? "ativo"
        : "cancelado";
    const vencimento = appStatus === "ativo" ? addDaysISO(30) : null;

    const upsertRes = await admin.from("billing_subscriptions").upsert(
      {
        user_id: user.id,
        provider: "mercadopago",
        plan_slug: parsed.data.plan,
        provider_plan_id: planId,
        provider_subscription_id: created.id,
        status: created.status ?? "created",
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "provider,provider_subscription_id",
      },
    );
    if (upsertRes.error) {
      const msg = String(upsertRes.error.message ?? "");
      if (msg.toLowerCase().includes("does not exist")) {
        const e = new Error("MIGRATION_NOT_APPLIED");
        (e as any).details = upsertRes.error;
        throw e;
      }
      throw upsertRes.error;
    }

    await admin
      .from("profiles")
      .update({ plano: parsed.data.plan })
      .eq("user_id", user.id);

    await admin.from("subscriptions").insert({
      user_id: user.id,
      plano: parsed.data.plan,
      status: appStatus,
      vencimento,
      provider: "mercadopago",
      provider_plan_id: planId,
      provider_subscription_id: created.id,
      provider_status: created.status ?? null,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: errorToUserMessage(err) },
      { status: 500 },
    );
  }
}
