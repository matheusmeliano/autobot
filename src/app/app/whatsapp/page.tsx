import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WhatsAppClient } from "@/components/app/whatsapp/WhatsAppClient";
import { refreshOneWhatsAppInstanceStatusLive } from "@/lib/atendimento/server";
import { isUSDCurrencyEmail } from "@/lib/currency";
import { normalizePlan } from "@/lib/plans";

const BASE_COLS = ["instance_id", "token", "status"] as const;
const OPTIONAL_COLS = ["client_token", "phone"] as const;

type InstanceRow = Record<string, any>;

async function safeRefreshInstanceStatusLive(supabase: any, row: InstanceRow | null): Promise<string | null> {
  return await refreshOneWhatsAppInstanceStatusLive({
    supabase,
    row: {
      user_id: null,
      instance_id: row?.instance_id ?? null,
      token: row?.token ?? null,
      client_token: row?.client_token ?? null,
      status: row?.status ?? null,
    },
    filterMode: "by_instance_id",
    stickyConnected: false,
  });
}

async function safeFetchWhatsappInstance(supabase: any): Promise<{
  data: InstanceRow | null;
  fatalErrorMsg: string | null;
}> {
  // Estratégia resiliente: tenta o máximo de colunas primeiro,
  // depois, se falhar com erro de "column does not exist", retira as suspeitas uma a uma.
  const allCols = [...BASE_COLS, ...OPTIONAL_COLS];
  const try1 = await supabase
    .from("whatsapp_instances")
    .select(allCols.join(", "))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!try1.error) {
    return { data: (try1.data as InstanceRow) ?? null, fatalErrorMsg: null };
  }
  const errMsg = String(try1.error?.message ?? "");
  const isColumnErr = /column/i.test(errMsg);

  if (isColumnErr) {
    const missing = new Set<string>();
    for (const col of OPTIONAL_COLS) {
      const re = new RegExp(`\\b${col}\\b`, "i");
      if (re.test(errMsg)) missing.add(col);
    }
    const colsToTry = [
      ...BASE_COLS,
      ...OPTIONAL_COLS.filter((c) => !missing.has(c)),
    ];
    const try2 = await supabase
      .from("whatsapp_instances")
      .select(colsToTry.join(", "))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!try2.error) {
      const fullRow: InstanceRow = {
        client_token: null,
        phone: null,
        ...((try2.data as InstanceRow) ?? {}),
      };
      return { data: fullRow, fatalErrorMsg: null };
    }
  }

  // Ultimo recurso: apenas colunas base (essenciais).
  const try3 = await supabase
    .from("whatsapp_instances")
    .select(BASE_COLS.join(", "))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!try3.error) {
    const fullRow: InstanceRow = {
      client_token: null,
      phone: null,
      ...((try3.data as InstanceRow) ?? {}),
    };
    return { data: fullRow, fatalErrorMsg: null };
  }

  const fatalFinal = String(try3.error?.message ?? try1.error?.message ?? "");
  return { data: null, fatalErrorMsg: fatalFinal };
}

export default async function WhatsAppPage() {
  const supabase = await createSupabaseServerClient();
  const { data, fatalErrorMsg } = await safeFetchWhatsappInstance(supabase);

  if (fatalErrorMsg) {
    const isColError =
      /column/i.test(fatalErrorMsg) &&
      /\bclient_token\b/i.test(fatalErrorMsg);
    return (
      <div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Integração Z-API
        </h1>
        <div className="mt-2 text-sm text-white/60">
          {isColError
            ? "Atualize o banco: rode as migrations pendentes em whatsapp_instances e recarregue."
            : "Não foi possível carregar seus dados. Verifique se as tabelas existem e se você está logado."}
        </div>
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: profile }, { data: subscription }] = await Promise.all([
    user?.id
      ? supabase.from("profiles").select("plano").eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    user?.id
      ? supabase
          .from("subscriptions")
          .select("plano, status, vencimento, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const _rawPlan: string | null =
    (profile?.plano as string | null) ??
    (subscription?.plano as string | null) ??
    null;
  const plan = normalizePlan(_rawPlan ?? "teste");
  const _isUsaAtt = isUSDCurrencyEmail(user?.email ?? null);
  const rawSubStatus = String(subscription?.status ?? "").toLowerCase();
  const subStatus =
    rawSubStatus === "pausado" || rawSubStatus === "past_due" ? "cancelado" : rawSubStatus;
  const vencimento = subscription?.vencimento ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const isExpired =
    typeof vencimento === "string" &&
    vencimento.length >= 10 &&
    vencimento.slice(0, 10) < today;
  const isBlocked = subStatus === "cancelado" || (plan !== "vitalicio" && isExpired);
  const _hasPaidActivePlan =
    !isBlocked && (plan === "basico" || plan === "pro" || plan === "vitalicio");
  const showZApiNotice = !_isUsaAtt && !_hasPaidActivePlan;

  const liveStatus = await safeRefreshInstanceStatusLive(supabase, data);
  const instanceStatus = liveStatus ?? (data?.status ?? null);

  return (
    <WhatsAppClient
      initial={
        data
          ? {
              instance_id: data.instance_id ?? null,
              status: instanceStatus,
              hasToken: Boolean(data.token),
              hasClientToken: Boolean(data.client_token),
              phone: String(data.phone ?? "").trim() || null,
            }
          : null
      }
      showZApiNotice={showZApiNotice}
    />
  );
}
