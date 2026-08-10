import { AdminUsersClient, type AdminUserRow } from "@/components/admin/AdminUsersClient";
import { listAllAuthUsers } from "@/lib/adminUsers";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePlan } from "@/lib/plans";

export default async function AdminUsuariosPage() {
  const supabase = tryCreateSupabaseAdminClient();
  if (!supabase) {
    return (
      <div className="space-y-3">
        <div className="text-lg font-semibold">Configuração necessária</div>
        <div className="text-sm text-white/70">
          Para abrir o painel de usuários, configure na Vercel a variável{" "}
          <span className="font-semibold text-white">SUPABASE_SERVICE_ROLE_KEY</span>.
        </div>
        <div className="text-sm text-white/55">
          Vercel → Project → Settings → Environment Variables → adicione{" "}
          <span className="font-semibold text-white">SUPABASE_SERVICE_ROLE_KEY</span>{" "}
          (Production/Preview/Development) e redeploy.
        </div>
      </div>
    );
  }

  const { data, error } = await listAllAuthUsers(supabase);
  if (error) {
    return (
      <div className="space-y-3">
        <div className="text-lg font-semibold">Não foi possível carregar usuários</div>
        <div className="text-sm text-white/70">{error.message}</div>
      </div>
    );
  }

  const users = data.users ?? [];
  const ids = users.map((u) => u.id);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, nome, email, plano, created_at, access_scope")
    .in("user_id", ids);

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("id, user_id, plano, status, vencimento, created_at")
    .in("user_id", ids);

  const profileById = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
  const subById = new Map<string, any>();
  (subs ?? []).forEach((s: any) => {
    const prev = subById.get(s.user_id);
    if (!prev || new Date(s.created_at).getTime() > new Date(prev.created_at).getTime()) {
      subById.set(s.user_id, s);
    }
  });

  const today = new Date().toISOString().slice(0, 10);
  const expiredSubs = Array.from(subById.values()).filter((s: any) => {
    const p = profileById.get(s.user_id);
    const planSub = normalizePlan(s?.plano ?? null);
    const planProfile = normalizePlan(p?.plano ?? null);
    if (planSub === "vitalicio" || planProfile === "vitalicio") return false;
    const rawStatus = (s?.status ?? "").toLowerCase();
    const status = rawStatus === "pausado" || rawStatus === "past_due" ? "cancelado" : rawStatus;
    const vencimento = typeof s?.vencimento === "string" ? s.vencimento : null;
    return (
      status === "ativo" &&
      vencimento &&
      vencimento < today &&
      ((planSub === "teste" && planProfile === "teste") || planSub !== "teste")
    );
  });

  if (expiredSubs.length) {
    await Promise.all(
      expiredSubs.map((s: any) =>
        supabase.from("subscriptions").update({ status: "cancelado" }).eq("id", s.id),
      ),
    );
    expiredSubs.forEach((s: any) => {
      const current = subById.get(s.user_id);
      if (current?.id === s.id) {
        subById.set(s.user_id, { ...current, status: "cancelado" });
      }
    });
  }

  let whatsappByUserId = new Map<string, {
    instance_id: string | null;
    display_name: string | null;
    phone: string | null;
    status: string | null;
  }>();

  try {
    const whatsappBaseCols = ["user_id", "instance_id", "status"];
    const firstWa = await supabase
      .from("whatsapp_instances")
      .select([...whatsappBaseCols, "display_name", "phone"].join(", "))
      .in("user_id", ids)
      .order("created_at", { ascending: false });

    const missingDisplayName =
      firstWa.error &&
      /display_name/i.test(firstWa.error.message) &&
      /column/i.test(firstWa.error.message);
    const missingPhone =
      firstWa.error &&
      /\bphone\b/i.test(firstWa.error.message) &&
      /column/i.test(firstWa.error.message);

    let waRows: any[] = firstWa.data ?? [];

    if (firstWa.error && (missingDisplayName || missingPhone)) {
      const retryCols = [...whatsappBaseCols];
      if (!missingDisplayName) retryCols.push("display_name");
      if (!missingPhone) retryCols.push("phone");
      const retry = await supabase
        .from("whatsapp_instances")
        .select(retryCols.join(", "))
        .in("user_id", ids)
        .order("created_at", { ascending: false });
      waRows = retry.data ?? [];
    }

    waRows.forEach((row: any) => {
      whatsappByUserId.set(row.user_id, {
        instance_id: String(row.instance_id ?? "").trim() || null,
        display_name: String(row.display_name ?? "").trim() || null,
        phone: String(row.phone ?? "").trim() || null,
        status: String(row.status ?? "").trim() || null,
      });
    });
  } catch (_waErr) {
    whatsappByUserId = new Map();
  }

  const initial: AdminUserRow[] = users
    .filter((u) => String((profileById.get(u.id) as any)?.access_scope ?? "app") !== "atendimento")
    .map((u) => {
    const p = profileById.get(u.id);
    const s = subById.get(u.id);
    const wa = whatsappByUserId.get(u.id);
    return {
      id: u.id,
      email: u.email ?? p?.email ?? "-",
      nome: p?.nome ?? (u.user_metadata as any)?.name ?? "-",
      email_confirmado: Boolean((u as any).email_confirmed_at),
      plano: normalizePlan(s?.plano ?? p?.plano ?? "teste"),
      assinatura_status: s?.status ?? "-",
      vencimento: s?.vencimento ?? null,
      criado_em: u.created_at ?? p?.created_at ?? null,
      whatsapp: wa
        ? {
            instance_id: wa.instance_id,
            display_name: wa.display_name,
            phone: wa.phone,
            status: wa.status,
          }
        : null,
    };
    });

  return <AdminUsersClient initial={initial} />;
}
