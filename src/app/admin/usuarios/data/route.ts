import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { normalizePlan } from "@/lib/plans";

type ProfileRow = {
  user_id: string;
  nome: string | null;
  email: string | null;
  plano: string | null;
  created_at: string | null;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  plano: string | null;
  status: string | null;
  vencimento: string | null;
  created_at: string;
};

export async function GET() {
  const supabaseAuth = await createSupabaseServerClient({ canSetCookies: true });
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!isGlobalAdminEmail(user?.email)) {
    return new Response("Acesso negado.", { status: 403 });
  }

  const supabase = createSupabaseAdminClient();
  const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 50 });

  const users = data.users ?? [];
  const ids = users.map((u) => u.id);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, nome, email, plano, created_at")
    .in("user_id", ids);

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("id, user_id, plano, status, vencimento, created_at")
    .in("user_id", ids);

  const profileById = new Map<string, ProfileRow>();
  for (const p of (profiles ?? []) as ProfileRow[]) {
    profileById.set(p.user_id, p);
  }

  const subById = new Map<string, SubscriptionRow>();
  for (const s of (subs ?? []) as SubscriptionRow[]) {
    const prev = subById.get(s.user_id);
    if (
      !prev ||
      new Date(s.created_at).getTime() > new Date(prev.created_at).getTime()
    ) {
      subById.set(s.user_id, s);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const expiredSubs = Array.from(subById.values()).filter((s) => {
    const p = profileById.get(s.user_id);
    const planSub = normalizePlan(s.plano);
    const planProfile = normalizePlan(p?.plano);
    const status = (s.status ?? "").toLowerCase();
    return (
      planSub === "teste" &&
      planProfile === "teste" &&
      status === "ativo" &&
      typeof s.vencimento === "string" &&
      s.vencimento < today
    );
  });

  if (expiredSubs.length) {
    await Promise.all(
      expiredSubs.map((s) =>
        supabase
          .from("subscriptions")
          .update({ status: "cancelado" })
          .eq("id", s.id),
      ),
    );
    expiredSubs.forEach((s) => {
      const current = subById.get(s.user_id);
      if (current?.id === s.id) {
        subById.set(s.user_id, { ...current, status: "cancelado" });
      }
    });
  }

  const rows = users.map((u) => {
    const p = profileById.get(u.id);
    const s = subById.get(u.id);
    const meta = (u.user_metadata ?? null) as Record<string, unknown> | null;
    const metaName = typeof meta?.name === "string" ? meta.name : null;
    const confirmedAt = (u as { email_confirmed_at?: string | null })
      .email_confirmed_at;
    return {
      id: u.id,
      email: u.email ?? p?.email ?? "-",
      nome: p?.nome ?? metaName ?? "-",
      email_confirmado: Boolean(confirmedAt),
      plano: normalizePlan(s?.plano ?? p?.plano ?? "teste"),
      assinatura_status: s?.status ?? "-",
      vencimento: s?.vencimento ?? null,
      criado_em: u.created_at ?? p?.created_at ?? null,
    };
  });

  return Response.json(rows);
}
