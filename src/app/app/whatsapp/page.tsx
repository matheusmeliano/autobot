import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WhatsAppClient } from "@/components/app/whatsapp/WhatsAppClient";
import { getZapiInstanceMeta } from "@/lib/atendimento/server";

const BASE_COLS = ["instance_id", "token", "status"] as const;
const OPTIONAL_COLS = ["client_token", "phone"] as const;

type InstanceRow = Record<string, any>;

async function safeRefreshInstanceStatusLive(supabase: any, row: InstanceRow | null): Promise<string | null> {
  if (!row) return null;
  const instanceId = String(row.instance_id ?? "").trim();
  const token = String(row.token ?? "").trim();
  if (!instanceId || !token) return String(row.status ?? "").trim() || null;
  try {
    const meData = await getZapiInstanceMeta({
      instance_id: instanceId,
      token,
      client_token: (row.client_token ? String(row.client_token).trim() : undefined) || undefined,
    });
    if (!meData) {
      try {
        await supabase.from("whatsapp_instances").update({ status: "disconnected" }).eq("instance_id", instanceId);
      } catch {}
      return "disconnected";
    }
    try {
      await supabase.from("whatsapp_instances").update({ status: "connected" }).eq("instance_id", instanceId);
    } catch {}
    return "connected";
  } catch (_err) {
    try {
      await supabase.from("whatsapp_instances").update({ status: "disconnected" }).eq("instance_id", instanceId);
    } catch {}
    return "disconnected";
  }
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

  const liveStatus = await safeRefreshInstanceStatusLive(supabase, data);
  const status = liveStatus ?? (data?.status ?? null);

  return (
    <WhatsAppClient
      initial={
        data
          ? {
              instance_id: data.instance_id ?? null,
              status,
              hasToken: Boolean(data.token),
              hasClientToken: Boolean(data.client_token),
              phone: String(data.phone ?? "").trim() || null,
            }
          : null
      }
    />
  );
}
