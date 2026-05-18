import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createMercadoPagoPlan,
  createMercadoPagoPreapproval,
} from "@/lib/mercadopago";

export const runtime = "nodejs";

const schema = z.object({
  plan: z.enum(["basico", "pro"]),
});

const planAmount: Record<"basico" | "pro", number> = {
  basico: 49,
  pro: 99,
};

async function getOrCreatePlanId(slug: "basico" | "pro") {
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

  const body = (err as any)?.body;
  const mpMsg =
    (typeof body?.message === "string" && body.message) ||
    (typeof body?.error === "string" && body.error) ||
    (typeof body?.cause?.[0]?.description === "string" && body.cause[0].description) ||
    null;

  if (mpMsg) {
    return `Mercado Pago: ${mpMsg}`;
  }

  return "Falha ao iniciar pagamento. Verifique as variáveis da Vercel e se sua conta Mercado Pago está habilitada para assinaturas.";
}

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Plano inválido." }, { status: 400 });
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

    const planId = await getOrCreatePlanId(parsed.data.plan);

    const created = await createMercadoPagoPreapproval({
      planId,
      payerEmail: user.email,
      backUrl,
      externalReference: user.id,
      notificationUrl,
    });

    const admin = createSupabaseAdminClient();
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

    const initPoint = created.init_point ?? created.sandbox_init_point ?? null;
    if (!initPoint) {
      return NextResponse.json(
        { error: "Checkout não retornou link." },
        { status: 502 },
      );
    }

    return NextResponse.json({ init_point: initPoint });
  } catch (err) {
    return NextResponse.json(
      { error: errorToUserMessage(err) },
      { status: 500 },
    );
  }
}
