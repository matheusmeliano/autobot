export function normalizePhoneDigitsOnly(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function areBrazilianPhonesEquivalent(
  aRaw: string | null | undefined,
  bRaw: string | null | undefined,
): boolean {
  const a = normalizePhoneDigitsOnly(aRaw);
  const b = normalizePhoneDigitsOnly(bRaw);
  if (!a || !b) return false;
  if (a === b) return true;

  function stripPrefix55AndLeading9Local(digits: string): string {
    let s = digits;
    if (s.startsWith("55") && (s.length === 12 || s.length === 13)) s = s.slice(2);
    if (s.length === 11 && s.startsWith("9")) s = s.slice(1);
    if (s.length === 10 && s.startsWith("9")) s = s.slice(1);
    return s;
  }

  const aNorm = stripPrefix55AndLeading9Local(a);
  const bNorm = stripPrefix55AndLeading9Local(b);
  return aNorm === bNorm;
}

export function phoneIsInHiddenBrazilianBlocklist(
  phone: string | null | undefined,
  blocklistDigitsOnly: Iterable<string>,
): boolean {
  const p = normalizePhoneDigitsOnly(phone);
  if (!p) return false;
  for (const blocked of blocklistDigitsOnly) {
    if (!blocked) continue;
    if (areBrazilianPhonesEquivalent(p, blocked)) return true;
  }
  return false;
}

export async function loadHiddenWhatsAppPhoneBlocklist(params?: {
  supabaseAdmin?: any;
}): Promise<Set<string>> {
  const set = new Set<string>();

  const envPhones = [
    process.env.HIDDEN_PAINEL_PHONES,
    process.env.ZAPI_INSTANCE_PHONE,
    process.env.ZAPI_INSTANCE_PHONE_FALLBACK,
    process.env.ATENDIMENTO_WHATSAPP_PHONE,
    process.env.WHATSAPP_INSTANCE_PHONE,
    process.env.TEACHER_NOTIFICATION_PHONE,
    process.env.PROFESSOR_WHATSAPP_PHONE,
    "556581175345",
    "556598079407",
  ];
  for (const raw of envPhones) {
    if (!raw) continue;
    for (const part of String(raw).split(/[,;\s|]+/)) {
      const norm = normalizePhoneDigitsOnly(part);
      if (norm) set.add(norm);
    }
  }

  try {
    const admin =
      params?.supabaseAdmin ??
      (await import("@/lib/supabase/admin").then((m) => m.createSupabaseAdminClient()));
    const { data } = await admin
      .from("whatsapp_instances")
      .select("phone")
      .limit(100);
    for (const row of (data ?? []) as any[]) {
      const p = normalizePhoneDigitsOnly(String(row?.phone ?? ""));
      if (p) set.add(p);
    }
  } catch (_e) {}

  return set;
}
