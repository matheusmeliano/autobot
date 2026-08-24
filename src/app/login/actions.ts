"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseErrorToPt } from "@/lib/supabase/errors";
import { getSafeAuthenticatedPath, normalizeAccessScope } from "@/lib/auth/access";
import { ensureStudentAuthUserCreatedForLead } from "@/lib/atendimento/server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const schema = z.object({
  login: z
    .string()
    .trim()
    .refine((v) => {
      if (!v) return false;
      if (EMAIL_REGEX.test(v)) return true;
      const digits = v.replace(/\D/g, "");
      return digits.length >= 10;
    }, "Informe um e-mail ou WhatsApp válido."),
  password: z.string().min(4),
});

function onlyDigits(v: string) {
  return String(v ?? "").replace(/\D/g, "");
}

async function resolveEmailFromLogin(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, loginRaw: string): Promise<string | null> {
  const login = String(loginRaw ?? "").trim();
  if (!login) return null;
  if (EMAIL_REGEX.test(login)) return login;

  const loginDigits = onlyDigits(login);
  if (loginDigits.length < 10) return null;

  const loginDigitsNoCountry = loginDigits.replace(/^55/, "");
  const phoneTail10 = (loginDigitsNoCountry || loginDigits).slice(-10);
  const syntheticStudentEmail = phoneTail10 ? `tel.${phoneTail10}@aluno.autobot.business` : "";

  if (syntheticStudentEmail) {
    const { data: profileSyn } = await supabase
      .from("profiles")
      .select("email, phone")
      .eq("email", syntheticStudentEmail)
      .limit(1)
      .maybeSingle();
    const foundSynEmail = String((profileSyn as any)?.email ?? "").trim();
    if (EMAIL_REGEX.test(foundSynEmail)) return foundSynEmail;
  }

  const profilePhoneFilters: string[] = [];
  profilePhoneFilters.push(`phone.eq.${encodeURIComponent(loginDigits)}`);
  if (loginDigitsNoCountry && loginDigitsNoCountry !== loginDigits) {
    profilePhoneFilters.push(`phone.eq.${encodeURIComponent(loginDigitsNoCountry)}`);
  }
  if (phoneTail10) {
    profilePhoneFilters.push(`phone.like.*${encodeURIComponent(phoneTail10)}`);
  }

  const { data: profileRows } = await supabase
    .from("profiles")
    .select("phone, email, user_id")
    .or(profilePhoneFilters.join(","))
    .limit(20);

  if (Array.isArray(profileRows)) {
    for (const row of profileRows) {
      const rowDigits = onlyDigits(String((row as any).phone ?? ""));
      if (!rowDigits) continue;
      const a = rowDigits.length > loginDigits.length ? rowDigits : loginDigits;
      const b = rowDigits.length > loginDigits.length ? loginDigits : rowDigits;
      if (a === b || a.endsWith(b)) {
        const email = String((row as any).email ?? "").trim();
        if (EMAIL_REGEX.test(email)) return email;
      }
    }
  }

  const leadFilters: string[] = [];
  leadFilters.push(`phone.eq.${encodeURIComponent(loginDigits)}`);
  if (loginDigitsNoCountry && loginDigitsNoCountry !== loginDigits) {
    leadFilters.push(`phone.eq.${encodeURIComponent(loginDigitsNoCountry)}`);
  }
  if (phoneTail10) {
    leadFilters.push(`phone.like.*${encodeURIComponent(phoneTail10)}`);
  }

  const { data: leadRows } = await supabase
    .from("atendimento_leads")
    .select("phone, student_email, recurring_registration_password, id")
    .or(leadFilters.join(","))
    .limit(20);

  if (Array.isArray(leadRows)) {
    for (const row of leadRows) {
      const rowDigits = onlyDigits(String((row as any).phone ?? ""));
      if (!rowDigits) continue;
      const a = rowDigits.length > loginDigits.length ? rowDigits : loginDigits;
      const b = rowDigits.length > loginDigits.length ? loginDigits : rowDigits;
      if (a === b || a.endsWith(b)) {
        const leadEmail = String((row as any).student_email ?? "").trim();
        if (EMAIL_REGEX.test(leadEmail)) {
          const { data: profileByEmail } = await supabase
            .from("profiles")
            .select("email")
            .eq("email", leadEmail)
            .limit(1)
            .maybeSingle();
          const profileEmail = String((profileByEmail as any)?.email ?? "").trim();
          if (EMAIL_REGEX.test(profileEmail)) return profileEmail;
        }
        const rowTail10 = (rowDigits.replace(/^55/, "") || rowDigits).slice(-10);
        const synth = rowTail10 ? `tel.${rowTail10}@aluno.autobot.business` : "";
        if (synth) {
          const { data: syn } = await supabase
            .from("profiles")
            .select("email")
            .eq("email", synth)
            .limit(1)
            .maybeSingle();
          const s = String((syn as any)?.email ?? "").trim();
          if (EMAIL_REGEX.test(s)) return s;
        }
      }
    }
  }

  return null;
}

export async function loginAction(formData: FormData) {
  const parsed = schema.safeParse({
    login: formData.get("login"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, error: "Credenciais inválidas." };
  }

  const supabase = await createSupabaseServerClient({ canSetCookies: true });

  const resolvedEmail = await resolveEmailFromLogin(supabase, parsed.data.login);
  if (!resolvedEmail) {
    return { ok: false, error: "Credenciais inválidas." };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: resolvedEmail,
    password: parsed.data.password,
  });
  if (error) {
    const isPhone = !EMAIL_REGEX.test(String(parsed.data.login ?? "").trim());
    const loginDigits = isPhone ? onlyDigits(parsed.data.login) : "";
    const phoneTail10 = (loginDigits.replace(/^55/, "") || loginDigits).slice(-10);
    let recovered = false;
    if (isPhone && loginDigits.length >= 10 && phoneTail10) {
      const filters: string[] = [];
      filters.push(`phone.eq.${encodeURIComponent(loginDigits)}`);
      const no55 = loginDigits.replace(/^55/, "");
      if (no55 && no55 !== loginDigits) {
        filters.push(`phone.eq.${encodeURIComponent(no55)}`);
      }
      filters.push(`phone.like.*${encodeURIComponent(phoneTail10)}`);
      const supabaseSrvr = await createSupabaseServerClient({ canSetCookies: false });
      const { data: hits } = await supabaseSrvr
        .from("atendimento_leads")
        .select("id, phone, recurring_registration_password, student_email, full_name")
        .or(filters.join(","))
        .limit(20);
      if (Array.isArray(hits) && hits.length) {
        for (const row of hits as any[]) {
          const rowDigits = onlyDigits(String(row.phone ?? ""));
          if (!rowDigits) continue;
          const bigger = rowDigits.length > loginDigits.length ? rowDigits : loginDigits;
          const smaller = rowDigits.length > loginDigits.length ? loginDigits : rowDigits;
          const matches = bigger === smaller || bigger.endsWith(smaller);
          if (!matches) continue;
          const savedPwd = String(row.recurring_registration_password ?? "").trim();
          const typedPwd = String(parsed.data.password ?? "").trim();
          if (!savedPwd || !typedPwd || savedPwd.length < 4) continue;
          if (savedPwd !== typedPwd) continue;
          try {
            const admin = createSupabaseAdminClient();
            const res = await ensureStudentAuthUserCreatedForLead({
              admin,
              leadId: String(row.id),
              lead: row,
            });
            if (res.ok && res.email) {
              const r2 = await supabase.auth.signInWithPassword({
                email: res.email,
                password: parsed.data.password,
              });
              if (!r2.error) {
                recovered = true;
                break;
              }
            }
          } catch {}
        }
      }
    }
    if (!recovered) {
      return { ok: false, error: supabaseErrorToPt(error.message) };
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let accessScope = "app";
  if (user?.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("access_scope")
      .eq("user_id", user.id)
      .maybeSingle();
    accessScope = normalizeAccessScope((profile as any)?.access_scope);
  }

  const requestedNext = String(formData.get("next") ?? "").trim();
  const safeNext = getSafeAuthenticatedPath(accessScope, requestedNext);

  return { ok: true, next: safeNext };
}
