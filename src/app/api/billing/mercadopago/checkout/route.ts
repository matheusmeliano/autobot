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

type CreatePreferenceResult =
  | { kind: "redirect"; redirectUrl: string; status: 307 }
  | { kind: "preference"; pref: { init_point: string; id: string } };

async function createPreferenceForPlan(
  req: Request,
  plan: "basico" | "pro" | "vitalicio",
): Promise<CreatePreferenceResult> {
  const reqUrl = new URL(req.url);
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? reqUrl.origin;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !user.email) {
    return {
      kind: "redirect",
      redirectUrl: `${origin}/login?next=${encodeURIComponent("/app/assinatura")}`,
      status: 307,
    };
  }

  const notificationUrl = `${origin}/api/webhooks/mercadopago`;

  const base = `${origin}/app/assinatura`;
  const successUrl = `${base}?checkout=success`;
  const failureUrl = `${base}?checkout=failure`;
  const pendingUrl = `${base}?checkout=pending`;

  const isVitalicio = plan === "vitalicio";
  const pref = await createMercadoPagoCheckoutPreference({
    amount: planAmount[plan],
    title: planTitle[plan],
    payerEmail: isVitalicio ? undefined : user.email,
    notificationUrl,
    externalReference: `${user.id}:${plan}`,
    successUrl: isVitalicio ? undefined : successUrl,
    failureUrl: isVitalicio ? undefined : failureUrl,
    pendingUrl: isVitalicio ? undefined : pendingUrl,
    installments: 1,
    excludedPaymentTypes: isVitalicio
      ? ["debit_card", "prepaid_card"]
      : ["debit_card", "prepaid_card", "ticket", "atm"],
  });

  return { kind: "preference", pref: { init_point: pref.init_point, id: pref.id } };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const plan = url.searchParams.get("plan");
    const parsed = schema.safeParse({ plan });
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }

    const result = await createPreferenceForPlan(req, parsed.data.plan);
    if (result.kind === "redirect") {
      return NextResponse.redirect(result.redirectUrl, { status: result.status });
    }

    return NextResponse.redirect(result.pref.init_point, { status: 307 });
  } catch (err) {
    return NextResponse.json({ error: errorToUserMessage(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }

    const result = await createPreferenceForPlan(req, parsed.data.plan);
    if (result.kind === "redirect") {
      return NextResponse.json({ error: "Sem sessão." }, { status: 401 });
    }

    const pref = result.pref;
    return NextResponse.json({ ok: true, init_point: pref.init_point, preference_id: pref.id });
  } catch (err) {
    return NextResponse.json({ error: errorToUserMessage(err) }, { status: 500 });
  }
}
