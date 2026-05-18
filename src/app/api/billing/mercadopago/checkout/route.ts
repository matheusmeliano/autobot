import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createMercadoPagoCheckoutPreference } from "@/lib/mercadopago";

export const runtime = "nodejs";

const schema = z.object({
  plan: z.enum(["basico", "pro", "vitalicio"]),
});

const planAmount: Record<"basico" | "pro" | "vitalicio", number> = {
  basico: 49,
  pro: 99,
  vitalicio: 2490,
};

const planTitle: Record<"basico" | "pro" | "vitalicio", string> = {
  basico: "Plano Básico - AutoBot (30 dias)",
  pro: "Plano Pro - AutoBot (30 dias)",
  vitalicio: "Plano Vitalício - AutoBot",
};

function errorToUserMessage(err: unknown) {
  const body = (err as any)?.body;
  const mpMsg =
    (typeof body?.message === "string" && body.message) ||
    (typeof body?.error === "string" && body.error) ||
    (typeof body?.cause?.[0]?.description === "string" && body.cause[0].description) ||
    null;
  if (mpMsg) return `Mercado Pago: ${mpMsg}`;
  return "Falha ao iniciar checkout.";
}

async function handleCheckout(req: Request, input: unknown) {
  try {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
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

    const base = `${origin}/app/assinatura`;
    const successUrl = `${base}?checkout=success`;
    const failureUrl = `${base}?checkout=failure`;
    const pendingUrl = `${base}?checkout=pending`;

    const plan = parsed.data.plan;
    const isVitalicio = plan === "vitalicio";
    const pref = await createMercadoPagoCheckoutPreference({
      amount: planAmount[plan],
      title: planTitle[plan],
      payerEmail: user.email,
      notificationUrl,
      externalReference: `${user.id}:${plan}`,
      successUrl: isVitalicio ? undefined : successUrl,
      failureUrl: isVitalicio ? undefined : failureUrl,
      pendingUrl: isVitalicio ? undefined : pendingUrl,
      installments: isVitalicio ? 3 : 1,
      excludedPaymentTypes: isVitalicio
        ? ["debit_card", "prepaid_card"]
        : ["debit_card", "prepaid_card", "ticket", "atm"],
    });

    return NextResponse.json({ ok: true, init_point: pref.init_point, preference_id: pref.id });
  } catch (err) {
    return NextResponse.json({ error: errorToUserMessage(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return handleCheckout(req, body);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const plan = url.searchParams.get("plan");
  const res = await handleCheckout(req, { plan });
  if (!res.ok) return res;
  const data = (await res.json().catch(() => null)) as
    | { ok?: true; init_point?: string }
    | null;
  const initPoint = data?.init_point ?? null;
  if (!data?.ok || !initPoint) {
    return NextResponse.json({ error: "Falha ao iniciar checkout." }, { status: 500 });
  }
  return NextResponse.redirect(initPoint, { status: 302 });
}
