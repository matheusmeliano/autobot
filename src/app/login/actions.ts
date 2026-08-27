"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseErrorToPt } from "@/lib/supabase/errors";
import { getSafeAuthenticatedPath, normalizeAccessScope } from "@/lib/auth/access";

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
  const phoneTail11 = (loginDigitsNoCountry || loginDigits).slice(-11);
  const phoneTail12 = (loginDigitsNoCountry || loginDigits).slice(-12);
  const phoneTail13 = (loginDigitsNoCountry || loginDigits).slice(-13);
  const syntheticStudentEmail = phoneTail10 ? `tel.${phoneTail10}@aluno.autobot.business` : "";

  if (syntheticStudentEmail) {
    const { data: profileSyn } = await supabase
      .from("profiles")
      .select("email, phone, phone_digits")
      .eq("email", syntheticStudentEmail)
      .limit(1)
      .maybeSingle();
    const foundSynEmail = String((profileSyn as any)?.email ?? "").trim();
    if (EMAIL_REGEX.test(foundSynEmail)) return foundSynEmail;
  }

  const profilePhoneFilters: string[] = [];
  profilePhoneFilters.push(`phone.eq.${loginDigits}`);
  profilePhoneFilters.push(`phone_digits.eq.${loginDigits}`);
  if (loginDigitsNoCountry && loginDigitsNoCountry !== loginDigits) {
    profilePhoneFilters.push(`phone.eq.${loginDigitsNoCountry}`);
    profilePhoneFilters.push(`phone_digits.eq.${loginDigitsNoCountry}`);
  }
  if (phoneTail10) {
    profilePhoneFilters.push(`phone.ilike.%${phoneTail10}`);
    profilePhoneFilters.push(`phone_digits.ilike.%${phoneTail10}`);
  }
  if (phoneTail11 && phoneTail11 !== phoneTail10) {
    profilePhoneFilters.push(`phone.eq.${phoneTail11}`);
    profilePhoneFilters.push(`phone_digits.eq.${phoneTail11}`);
  }
  if (phoneTail12 && phoneTail12 !== phoneTail11) {
    profilePhoneFilters.push(`phone.eq.${phoneTail12}`);
    profilePhoneFilters.push(`phone_digits.eq.${phoneTail12}`);
  }
  if (phoneTail13 && phoneTail13 !== phoneTail12) {
    profilePhoneFilters.push(`phone.eq.${phoneTail13}`);
    profilePhoneFilters.push(`phone_digits.eq.${phoneTail13}`);
  }

  const { data: profileRows } = await supabase
    .from("profiles")
    .select("phone, phone_digits, email, user_id")
    .or(profilePhoneFilters.join(","))
    .limit(50);

  if (Array.isArray(profileRows)) {
    for (const row of profileRows) {
      const rowDigits =
        onlyDigits(String((row as any).phone ?? "")) ||
        onlyDigits(String((row as any).phone_digits ?? ""));
      if (!rowDigits) continue;
      const matchExactOrSuffix =
        rowDigits === loginDigits ||
        rowDigits.endsWith(phoneTail10) ||
        rowDigits.endsWith(phoneTail11) ||
        rowDigits.endsWith(phoneTail12) ||
        rowDigits.endsWith(phoneTail13) ||
        loginDigits.endsWith(rowDigits.slice(-10)) ||
        loginDigits.endsWith(rowDigits.slice(-11)) ||
        loginDigits.endsWith(rowDigits.slice(-12)) ||
        loginDigits.endsWith(rowDigits.slice(-13));
      if (matchExactOrSuffix) {
        const email = String((row as any).email ?? "").trim();
        if (EMAIL_REGEX.test(email)) return email;
      }
    }
  }

  const leadFilters: string[] = [];
  leadFilters.push(`phone.eq.${loginDigits}`);
  if (loginDigitsNoCountry && loginDigitsNoCountry !== loginDigits) {
    leadFilters.push(`phone.eq.${loginDigitsNoCountry}`);
  }
  if (phoneTail10) {
    leadFilters.push(`phone.ilike.%${phoneTail10}`);
  }
  if (phoneTail11 && phoneTail11 !== phoneTail10) {
    leadFilters.push(`phone.eq.${phoneTail11}`);
  }
  if (phoneTail12 && phoneTail12 !== phoneTail11) {
    leadFilters.push(`phone.eq.${phoneTail12}`);
  }
  if (phoneTail13 && phoneTail13 !== phoneTail12) {
    leadFilters.push(`phone.eq.${phoneTail13}`);
  }

  const { data: leadRows } = await supabase
    .from("atendimento_leads")
    .select("phone, student_email, recurring_registration_password, id")
    .or(leadFilters.join(","))
    .limit(50);

  if (Array.isArray(leadRows)) {
    for (const row of leadRows) {
      const rowDigits = onlyDigits(String((row as any).phone ?? ""));
      if (!rowDigits) continue;
      const matchExactOrSuffix =
        rowDigits === loginDigits ||
        rowDigits.endsWith(phoneTail10) ||
        rowDigits.endsWith(phoneTail11) ||
        rowDigits.endsWith(phoneTail12) ||
        rowDigits.endsWith(phoneTail13) ||
        loginDigits.endsWith(rowDigits.slice(-10)) ||
        loginDigits.endsWith(rowDigits.slice(-11)) ||
        loginDigits.endsWith(rowDigits.slice(-12)) ||
        loginDigits.endsWith(rowDigits.slice(-13));
      if (!matchExactOrSuffix) continue;
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

  const loginInputRaw = String(parsed.data.login ?? "").trim();
  const pwd = String(parsed.data.password ?? "").trim();

  const resolvedEmail = await resolveEmailFromLogin(supabase, loginInputRaw);
  if (!resolvedEmail) {
    return { ok: false, error: "Credenciais inválidas." };
  }

  let { error } = await supabase.auth.signInWithPassword({
    email: resolvedEmail,
    password: pwd,
  });
  if (error) {
    return { ok: false, error: supabaseErrorToPt(error.message) };
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
