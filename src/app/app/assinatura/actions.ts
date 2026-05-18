"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePlan } from "@/lib/plans";

const schema = z.object({
  plano: z.enum(["basico", "pro", "vitalicio"]),
});

function addDaysISO(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function changePlanAction(formData: FormData) {
  const parsed = schema.safeParse({
    plano: formData.get("plano"),
  });

  if (!parsed.success) {
    redirect("/app/assinatura?error=1");
  }

  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = session?.user?.id ?? null;
  if (!userId) {
    redirect("/login");
  }

  const plano = normalizePlan(parsed.data.plano);
  const vencimento = plano === "vitalicio" ? null : addDaysISO(30);

  await supabase
    .from("profiles")
    .update({ plano })
    .eq("user_id", userId);

  await supabase.from("subscriptions").insert({
    user_id: userId,
    plano,
    status: "ativo",
    vencimento,
  });

  redirect("/app/assinatura?changed=1");
}

