import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createMercadoPagoCardPayment } from "@/lib/mercadopago";

export const runtime = "nodejs";

const schema = z.object({
  plan: z.enum(["basico", "pro"]),
  formData: z.any(),
});

const planAmount: Record<"basico" | "pro", number> = {
  basico: 49,
  pro: 99,
};

function errorToUserMessage(err: unknown) {
  const body = (err as any)?.body;
  const mpMsg =
    (typeof body?.message === "string" && body.message) ||
    (typeof body?.error === "string" && body.error) ||
    (typeof body?.cause?.[0]?.description === "string" && body.cause[0].description) ||
    null;

  if (mpMsg) return `Mercado Pago: ${mpMsg}`;
  return "Falha ao processar pagamento.";
}

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
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

    const fd = parsed.data.formData ?? {};
    const token = fd?.token ?? null;
    const paymentMethodId = fd?.payment_method_id ?? fd?.paymentMethodId ?? null;
    const issuerId = fd?.issuer_id ?? fd?.issuerId ?? null;
    const installments = Number(fd?.installments ?? 1);

    const idType =
      fd?.payer?.identification?.type ??
      fd?.identificationType ??
      fd?.identification_type ??
      null;
    const idNumber =
      fd?.payer?.identification?.number ??
      fd?.identificationNumber ??
      fd?.identification_number ??
      null;

    if (!token || !paymentMethodId || !issuerId || !idType || !idNumber) {
      return NextResponse.json(
        { error: "Dados do cartão incompletos." },
        { status: 400 },
      );
    }

    const reqUrl = new URL(req.url);
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? reqUrl.origin;
    const notificationUrl = `${origin}/api/webhooks/mercadopago`;

    const amount = planAmount[parsed.data.plan];
    const payment = await createMercadoPagoCardPayment({
      amount,
      token,
      paymentMethodId,
      issuerId,
      installments: 1,
      payerEmail: user.email,
      identificationType: String(idType),
      identificationNumber: String(idNumber),
      description:
        parsed.data.plan === "basico"
          ? "Plano Básico - AutoBot (Cartão)"
          : "Plano Pro - AutoBot (Cartão)",
      notificationUrl,
      externalReference: `${user.id}:${parsed.data.plan}`,
      metadata: { user_id: user.id, plan_slug: parsed.data.plan },
    });

    return NextResponse.json({ ok: true, id: String(payment.id), status: payment.status ?? null });
  } catch (err) {
    return NextResponse.json({ error: errorToUserMessage(err) }, { status: 500 });
  }
}

