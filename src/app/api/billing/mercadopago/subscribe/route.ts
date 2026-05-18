import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createMercadoPagoPlan,
  createMercadoPagoPreapproval,
} from "@/lib/mercadopago";

const schema = z.object({
  plan: z.enum(["basico", "pro"]),
});

const planAmount: Record<"basico" | "pro", number> = {
  basico: 49,
  pro: 99,
};

async function getOrCreatePlanId(slug: "basico" | "pro") {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("billing_plans")
    .select("provider_plan_id")
    .eq("provider", "mercadopago")
    .eq("slug", slug)
    .maybeSingle();

  if (data?.provider_plan_id) return data.provider_plan_id;

  const created = await createMercadoPagoPlan({
    slug,
    amount: planAmount[slug],
  });

  await admin.from("billing_plans").insert({
    provider: "mercadopago",
    slug,
    provider_plan_id: created.id,
    amount_cents: planAmount[slug] * 100,
    currency: "BRL",
    interval: "month",
    interval_count: 1,
  });

  return created.id;
}

export async function POST(req: Request) {
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
  await admin.from("billing_subscriptions").upsert(
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

  const initPoint = created.init_point ?? created.sandbox_init_point ?? null;
  if (!initPoint) {
    return NextResponse.json(
      { error: "Checkout não retornou link." },
      { status: 502 },
    );
  }

  return NextResponse.json({ init_point: initPoint });
}

