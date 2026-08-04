import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  areBrazilianPhonesEquivalent,
  loadHiddenWhatsAppPhoneBlocklist,
  normalizePhoneDigitsOnly,
} from "@/lib/painelHiddenPhones";

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const hiddenBlocklist = await loadHiddenWhatsAppPhoneBlocklist();
  const debtorTelefonesById = new Map<string, string>();

  try {
    let off = 0;
    while (true) {
      const { data: debtorPage } = await supabase
        .from("debtors")
        .select("id, telefone")
        .range(off, off + 500 - 1);
      const arr = (debtorPage ?? []) as any[];
      for (const d of arr) {
        const id = String(d?.id ?? "");
        if (!id) continue;
        debtorTelefonesById.set(id, String(d?.telefone ?? ""));
      }
      if (arr.length < 500) break;
      off += 500;
    }
  } catch (_e) {}

  const scheduleDebtorIsBlocked = (row: any): boolean => {
    const debtorId = String(row?.debtor_id ?? "");
    if (!debtorId) return false;
    const phone = debtorTelefonesById.get(debtorId) ?? "";
    const pDigits = normalizePhoneDigitsOnly(phone);
    if (!pDigits) return false;
    for (const blocked of hiddenBlocklist) {
      if (!blocked) continue;
      if (areBrazilianPhonesEquivalent(pDigits, blocked)) return true;
    }
    return false;
  };

  const { data } = await supabase
    .from("schedules")
    .select(
      "id, debtor_id, template_id, data_envio, status, recurrence, recurrence_until, recurrence_day, recurrence_time, schedule_timezone, created_at, debtors(nome, telefone), message_templates(nome)",
    )
    .order("data_envio", { ascending: true })
    .limit(300);

  const rows =
    (data ?? [])
      .filter((r: any) => !scheduleDebtorIsBlocked(r))
      .map((r: any) => ({
        id: r.id,
        debtor_id: r.debtor_id,
        template_id: r.template_id,
        data_envio: r.data_envio,
        status: r.status,
        recurrence: r.recurrence ?? "none",
        recurrence_until: r.recurrence_until ?? null,
        recurrence_day: r.recurrence_day ?? null,
        recurrence_time: r.recurrence_time ?? null,
        schedule_timezone: r.schedule_timezone ?? null,
        created_at: r.created_at,
        debtor_nome: r.debtors?.nome ?? "-",
        template_nome: r.message_templates?.nome ?? null,
      })) ?? [];

  return Response.json(rows);
}
