"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { inferCountry } from "../../../lib/atendimento/experimentalClass";
import { resolveStudentTimezone } from "../../../lib/timezone";

type RecurringWeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

type RecurringWeekdayOption = {
  id: string;
  weekday: RecurringWeekdayKey;
  label: string;
  shortLabel: string;
  displayLabel: string;
  slotCount: number;
  professorDate: string;
  weekIndex?: 0 | 1 | number;
  weekLabel?: string;
};

type RecurringWeekdayTimeOption = {
  id: string;
  weekday: RecurringWeekdayKey;
  professorTime: string;
  leadTime: string;
  displayLabel: string;
  professorDate?: string;
  professorStartAtIso?: string;
};

type AvailabilityResponse = {
  ok: boolean;
  dates: RecurringWeekdayOption[];
  slotsByWeekday: Record<string, RecurringWeekdayTimeOption[]>;
  slotsByWeekdayDate?: Record<string, RecurringWeekdayTimeOption[]>;
  timeZone: string;
  generatedAt?: string;
  error?: string;
};

type SubmitResponse = {
  ok: boolean;
  leadId?: string;
  scheduled?: {
    weekday: RecurringWeekdayKey;
    weekdayLabel: string;
    professorTime: string;
    leadTime: string;
  };
  redirect_to?: string;
  error?: string;
};

type ContractFieldMeta = {
  name: "full_name" | "cpf" | "phone" | "legal_responsible_name" | "legal_responsible_cpf";
  label: string;
  optional: boolean;
  alreadyFilled: boolean;
  currentValue: string | null;
};

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState<boolean>(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(String(value ?? ""));
        } catch {
          const ta = document.createElement("textarea");
          ta.value = String(value ?? "");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); } catch {}
          document.body.removeChild(ta);
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2200);
      }}
      className={`inline-flex items-center gap-1.5 shrink-0 text-xs sm:text-sm font-semibold rounded-xl px-3 sm:px-3.5 py-1.5 sm:py-2 border transition ${
        copied
          ? "bg-emerald-500 border-emerald-500 text-white"
          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
      }`}
      title={copied ? "Copiado!" : "Copiar"}
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
      <span>{copied ? "Copiado!" : label ?? "Copiar"}</span>
    </button>
  );
}

export default function CadastroRecorrenteBody() {
  const sp = useSearchParams();
  const initialNameParam = decodeURIComponent(String(sp.get("nome") ?? "").trim()) || "";
  const initialPhoneParam = decodeURIComponent(String(sp.get("telefone") ?? "").trim()) || "";
  const initialLeadIdParam = String(sp.get("id") ?? "").trim() || "";

  function toErrorMessage(raw: unknown, fallback = "Erro desconhecido."): string {
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw === "string") {
      const s = raw.trim();
      return s || fallback;
    }
    if (raw instanceof Error) {
      const m = raw.message?.trim();
      return m || fallback;
    }
    if (typeof raw === "object") {
      const any = raw as Record<string, unknown>;
      const candidates = [any.message, any.error, any.error_message, any.msg, any.detail];
      for (const c of candidates) {
        if (typeof c === "string" && c.trim()) return c.trim();
      }
      try {
        return JSON.stringify(raw);
      } catch {
        return String(raw) || fallback;
      }
    }
    return String(raw) || fallback;
  }

  function toNomeESobrenome(raw: string | null | undefined): string {
    const clean = String(raw ?? "").trim();
    if (!clean) return "";
    const parts = clean.split(/\s+/).filter((s) => s && s.trim());
    if (parts.length <= 2) return clean;
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }

  function digitsOnly(v: string | null | undefined): string {
    return String(v ?? "").replace(/\D/g, "");
  }

  function formatPhoneMasked(v: string | null | undefined): string {
    const d = digitsOnly(v).slice(0, 13);
    if (!d) return "";
    if (d.length <= 10) {
      let out = "(" + d.slice(0, 2);
      if (d.length > 2) out += ") " + d.slice(2, 6);
      if (d.length > 6) out += "-" + d.slice(6, 10);
      return out;
    }
    if (d.length <= 11) {
      return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
    }
    return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9, 13)}`;
  }

  function formatFieldValue(name: string, raw: string | null | undefined): string {
    if (name === "phone") return formatPhoneMasked(raw);
    return String(raw ?? "");
  }

  function unformatFieldValue(name: string, val: string | null | undefined): string {
    const s = String(val ?? "").trim();
    if (!s) return "";
    if (name === "phone") return digitsOnly(s);
    return s;
  }

  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6>(0);
  const [nome, setNome] = useState<string>(toNomeESobrenome(initialNameParam));
  const [phoneField, setPhoneField] = useState<string>(initialPhoneParam);
  const [senha, setSenha] = useState<string>("");
  const [hasPasswordInitial, setHasPasswordInitial] = useState<boolean>(false);
  const [stateField, setStateField] = useState<string>("");
  const [cityField, setCityField] = useState<string>("");
  const [leadTimezone, setLeadTimezone] = useState<string>("");
  const [initialDataLoading, setInitialDataLoading] = useState<boolean>(true);
  const [initialDataError, setInitialDataError] = useState<string>("");
  const [accessBlocked, setAccessBlocked] = useState<boolean>(false);
  const [accessBlockedMessage, setAccessBlockedMessage] = useState<string>("");
  const [availLoading, setAvailLoading] = useState<boolean>(false);
  const [availError, setAvailError] = useState<string>("");
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [selectedTimeOpt, setSelectedTimeOpt] = useState<RecurringWeekdayTimeOption | null>(null);
  const [submitLoading, setSubmitLoading] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>("");
  const [submitResult, setSubmitResult] = useState<SubmitResponse["scheduled"] | null>(null);
  const [submitLeadId, setSubmitLeadId] = useState<string>("");
  const [draftSaving, setDraftSaving] = useState<"weekday" | "time" | null>(null);

  const [contractInitLoading, setContractInitLoading] = useState<boolean>(false);
  const [contractInitError, setContractInitError] = useState<string>("");
  const [contractLeadId, setContractLeadId] = useState<string>("");
  const [contractSnapshot, setContractSnapshot] = useState<Record<ContractFieldMeta["name"], string | null>>({
    full_name: null,
    cpf: null,
    phone: null,
    legal_responsible_name: null,
    legal_responsible_cpf: null,
  });
  const [lastSavedFieldValues, setLastSavedFieldValues] = useState<Record<ContractFieldMeta["name"], string | null>>({
    full_name: null,
    cpf: null,
    phone: null,
    legal_responsible_name: null,
    legal_responsible_cpf: null,
  });
  const [contractAllFields, setContractAllFields] = useState<ContractFieldMeta[]>([]);
  const [contractFinalizing, setContractFinalizing] = useState<boolean>(false);
  const [contractFinalError, setContractFinalError] = useState<string>("");
  const [contractPdfUrl, setContractPdfUrl] = useState<string>("");
  const [contractSignedAt, setContractSignedAt] = useState<string>("");
  const [enrollmentNumber, setEnrollmentNumber] = useState<string>("");
  const [paymentTab, setPaymentTab] = useState<"menu" | "link" | "deposit" | "pix">("menu");
  const [pixCopied, setPixCopied] = useState<boolean>(false);
  const [showResumeScreen, setShowResumeScreen] = useState<boolean>(false);
  const [resumePassword, setResumePassword] = useState<string>("");
  const [resumeLoading, setResumeLoading] = useState<boolean>(false);
  const [resumeError, setResumeError] = useState<string>("");

  useEffect(() => {
    if (!submitResult) return;
    if (!(step === 4)) return;
    if (contractAllFields.length > 0) return;
    const tel = phoneField.replace(/\D/g, "").trim();
    if (!tel || tel.length < 10) return;
    void (async () => {
      setContractInitLoading(true);
      setContractInitError("");
      try {
        const res = await fetch("/api/cadastro/recorrente/contract-init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telefone: tel,
            leadId: submitLeadId || undefined,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              error?: string;
              leadId?: string;
              snapshot?: Record<ContractFieldMeta["name"], string | null>;
              allFields?: ContractFieldMeta[];
              nextField?: ContractFieldMeta["name"] | null;
            }
          | null;
        if (!res.ok || !json?.ok || !Array.isArray(json?.allFields)) {
          throw new Error(toErrorMessage(json?.error, "Falha ao carregar os dados do contrato."));
        }
        setContractLeadId(String(json.leadId || submitLeadId || ""));
        setContractSnapshot(json.snapshot || contractSnapshot);
        setLastSavedFieldValues(json.snapshot || lastSavedFieldValues);
        setContractAllFields(json.allFields || []);
        if (json.snapshot) {
          const snapName = (json.snapshot.full_name || "").trim();
          if (snapName && !nome.trim()) {
            setNome(toNomeESobrenome(snapName));
          }
        }
      } catch (e) {
        setContractInitError(toErrorMessage(e, "Erro ao carregar."));
      } finally {
        setContractInitLoading(false);
      }
    })();
  }, [step, submitResult, phoneField, submitLeadId, contractAllFields.length, contractSnapshot, lastSavedFieldValues, nome]);

  async function saveDraftRecurring(payload: {
    weekday?: RecurringWeekdayKey | null;
    weekdayLabel?: string | null;
    professorTime?: string | null;
    leadTime?: string | null;
    step?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | null;
    nomeOverride?: string | null;
    password?: string | null;
    state?: string | null;
    city?: string | null;
    country?: string | null;
    timezone?: string | null;
  }) {
    try {
      const telefone = phoneField.replace(/\D/g, "");
      if (!telefone || telefone.length < 10) return;
      const passwordRaw = payload.password;
      const safePassword =
        typeof passwordRaw === "string" &&
        passwordRaw.trim().length >= 4 &&
        !/^[•·*]{4,}$/.test(passwordRaw)
          ? passwordRaw.trim()
          : null;
      await fetch("/api/cadastro/recorrente/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone,
          nome: (payload.nomeOverride !== undefined ? payload.nomeOverride : nome.trim()) || null,
          weekday: payload.weekday ?? null,
          weekdayLabel: payload.weekdayLabel ?? null,
          professorTime: payload.professorTime ?? null,
          leadTime: payload.leadTime ?? null,
          step: payload.step ?? null,
          password: safePassword,
          state: payload.state ?? null,
          city: payload.city ?? null,
          country: payload.country ?? null,
          timezone: payload.timezone ?? null,
        }),
      }).catch(() => {});
    } catch {}
  }

  async function handleContractFinalize() {
    if (contractFinalizing) return;
    const tel = phoneField.replace(/\D/g, "").trim();
    setContractFinalizing(true);
    setContractFinalError("");
    try {
      const res = await fetch("/api/cadastro/recorrente/contract-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone: tel,
          leadId: contractLeadId || submitLeadId || undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            contract_pdf_url?: string | null;
            contract_signed_at?: string | null;
            enrollment_number?: string | null;
            leadId?: string;
          }
        | null;
      if (!res.ok || !json?.ok) {
        throw new Error(toErrorMessage(json?.error, "Falha ao gerar a confirmação. Tente novamente."));
      }
      setContractPdfUrl(String(json.contract_pdf_url || ""));
      setContractSignedAt(String(json.contract_signed_at || new Date().toISOString()));
      if (typeof json.enrollment_number === "string" && json.enrollment_number.trim()) {
        setEnrollmentNumber(String(json.enrollment_number).trim());
      }
      goStep(5);
    } catch (e) {
      setContractFinalError(toErrorMessage(e, "Erro ao gerar a confirmação."));
    } finally {
      setContractFinalizing(false);
    }
  }

  async function finalizarMatriculaStep9() {
    if (contractFinalizing) return;
    if (!enrollmentNumber) {
      const tel = phoneField.replace(/\D/g, "").trim();
      setContractFinalizing(true);
      setContractFinalError("");
      try {
        const res = await fetch("/api/cadastro/recorrente/contract-finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telefone: tel,
            leadId: contractLeadId || submitLeadId || undefined,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              error?: string;
              contract_pdf_url?: string | null;
              contract_signed_at?: string | null;
              enrollment_number?: string | null;
              leadId?: string;
            }
          | null;
        if (res.ok && json?.ok) {
          setContractPdfUrl(String(json.contract_pdf_url || ""));
          setContractSignedAt(String(json.contract_signed_at || new Date().toISOString()));
          if (typeof json.enrollment_number === "string" && json.enrollment_number.trim()) {
            setEnrollmentNumber(String(json.enrollment_number).trim());
          }
          if (typeof json.leadId === "string" && json.leadId.trim()) {
            const lid = String(json.leadId).trim();
            if (!contractLeadId) setContractLeadId(lid);
            if (!submitLeadId) setSubmitLeadId(lid);
          }
        } else if (!res.ok) {
          setContractFinalError(toErrorMessage(json?.error, "Falha ao finalizar a matrícula. Tente novamente."));
          setContractFinalizing(false);
          return;
        }
      } catch (e) {
        setContractFinalError(toErrorMessage(e, "Erro ao finalizar a matrícula. Tente novamente."));
      } finally {
      }
    }
    setContractFinalizing(true);
    await new Promise<void>((r) => setTimeout(r, 700));
    goStep(6);
    setTimeout(() => setContractFinalizing(false), 250);
  }

  function goStep(n: 0 | 1 | 2 | 3 | 4 | 5 | 6) {
    setStep(n);
    if (n === 5) setPaymentTab("menu");
    setSubmitError("");
    setContractFinalError("");
    void saveDraftRecurring({ step: n, password: senha.trim() || null });
    if (typeof window !== "undefined") {
      setTimeout(() => {
        try {
          window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
        } catch {
          window.scrollTo(0, 0);
        }
      }, 0);
    }
  }

  function scrollToTop() {
    if (typeof window !== "undefined") {
      setTimeout(() => {
        try {
          window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
        } catch {
          window.scrollTo(0, 0);
        }
      }, 0);
    }
  }

  useEffect(() => {
    if (step === 5) setPaymentTab("menu");
  }, [step]);

  useEffect(() => {
    void (async () => {
      setInitialDataLoading(true);
      setInitialDataError("");
      try {
        const phoneDigits = initialPhoneParam.replace(/\D/g, "").trim();
        if (phoneDigits.length < 10) return;
        const res = await fetch(
          `/api/cadastro/recorrente/draft?telefone=${encodeURIComponent(phoneDigits)}`,
          { method: "GET" },
        );
        const json = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              blocked?: boolean;
              error?: string | null;
              lead?: {
                id?: string | null;
                full_name?: string | null;
                phone?: string | null;
                cpf?: string | null;
                legal_responsible_name?: string | null;
                legal_responsible_cpf?: string | null;
                contract_pdf_url?: string | null;
                contract_signed_at?: string | null;
                state?: string | null;
                city?: string | null;
                timezone?: string | null;
              } | null;
              progress?: {
                step?: number | null;
                has_password?: boolean | null;
                recurring_class_weekday?: string | null;
                recurring_class_weekday_label?: string | null;
                recurring_class_professor_time?: string | null;
                recurring_class_lead_time?: string | null;
              } | null;
            }
          | null;
        if (json?.blocked === true) {
          setAccessBlocked(true);
          setAccessBlockedMessage(
            String(json?.error ?? "").trim() ||
              "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
          );
          return;
        }
        if (!res.ok || !json?.ok) {
          setInitialDataError(
            String(json?.error ?? "").trim() ||
              toErrorMessage(json?.error, "Não foi possível carregar seus dados. Tente novamente em alguns segundos."),
          );
          return;
        }

        let restoredLeadFullName = "";
        let restoredLeadPhone = "";
        let restoredLeadId = "";
        let restoredState: string | null = null;
        let restoredCity: string | null = null;
        let savedCountry: string | null = null;
        let restoredTimezone: string | null = null;

        if (json?.ok && json?.lead) {
          restoredLeadFullName = String(json.lead?.full_name ?? "").trim();
          restoredLeadPhone = String(json.lead?.phone ?? "").replace(/\D/g, "").trim();
          restoredLeadId = String((json.lead as any)?.id ?? "").trim();
          restoredState = (json.lead as any)?.state ? String((json.lead as any).state) : null;
          restoredCity = (json.lead as any)?.city ? String((json.lead as any).city) : null;
          savedCountry = (json.lead as any)?.country ? String((json.lead as any).country) : null;
          restoredTimezone = (json.lead as any)?.timezone ? String((json.lead as any).timezone) : null;

          const normalizedLeadFullName = toNomeESobrenome(restoredLeadFullName);
          if (restoredLeadId) {
            setSubmitLeadId(restoredLeadId);
            setContractLeadId(restoredLeadId);
          }
          if (normalizedLeadFullName) {
            setNome(normalizedLeadFullName);
          } else if (initialNameParam && !restoredLeadFullName) {
            setNome(toNomeESobrenome(initialNameParam));
          }
          if (restoredLeadPhone) {
            setPhoneField(restoredLeadPhone);
          } else if (initialPhoneParam && !restoredLeadPhone) {
            setPhoneField(initialPhoneParam);
          }
          if (restoredState) setStateField(restoredState);
          if (restoredCity) setCityField(restoredCity);
          if (restoredTimezone) setLeadTimezone(restoredTimezone);
          if (normalizedLeadFullName) {
            setLastSavedFieldValues((prev) => ({ ...prev, full_name: normalizedLeadFullName! }));
            setContractSnapshot((prev) => ({ ...prev, full_name: normalizedLeadFullName! }));
          }
          if (restoredLeadPhone) {
            setLastSavedFieldValues((prev) => ({ ...prev, phone: restoredLeadPhone! }));
            setContractSnapshot((prev) => ({ ...prev, phone: restoredLeadPhone! }));
          }

          const restoredContractPdfUrl = typeof (json.lead as any)?.contract_pdf_url === "string" ? String((json.lead as any).contract_pdf_url).trim() : "";
          const restoredContractSignedAt = typeof (json.lead as any)?.contract_signed_at === "string" ? String((json.lead as any).contract_signed_at).trim() : "";
          const restoredEnrollmentNumber = typeof (json.lead as any)?.enrollment_number === "string" ? String((json.lead as any).enrollment_number).trim() : "";
          if (restoredContractPdfUrl) {
            setContractPdfUrl(restoredContractPdfUrl);
          }
          if (restoredContractSignedAt) {
            setContractSignedAt(restoredContractSignedAt);
          }
          if (restoredEnrollmentNumber) {
            setEnrollmentNumber(restoredEnrollmentNumber);
          }

          const hasLoc = Boolean(restoredState || restoredCity);
          const browserTz =
            typeof Intl !== "undefined" && Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone
              ? Intl.DateTimeFormat().resolvedOptions().timeZone
              : "";
          const resolvedTz = hasLoc
            ? resolveStudentTimezone({
                state: restoredState || null,
                city: restoredCity || null,
                phone: restoredLeadPhone || null,
                browserTimeZone: browserTz || null,
              })
            : null;
          const tzToUse = resolvedTz || restoredTimezone || (hasLoc ? browserTz : "") || null;
          const badTz =
            !restoredTimezone || restoredTimezone === "America/Cuiaba";
          if (hasLoc && (tzToUse || !savedCountry)) {
            const inferred = inferCountry(
              restoredState || null,
              restoredCity || null,
              tzToUse || null
            );
            const patch: any = {};
            if (inferred && inferred !== savedCountry) patch.country = inferred;
            if (resolvedTz && resolvedTz !== restoredTimezone) {
              patch.timezone = resolvedTz;
              setLeadTimezone(resolvedTz);
            }
            if (Object.keys(patch).length) {
              void saveDraftRecurring(patch).catch(() => {});
            }
          }
        } else {
          if (initialNameParam) {
            setNome(toNomeESobrenome(initialNameParam));
          }
          if (initialPhoneParam) {
            setPhoneField(initialPhoneParam);
          }
        }

        let stepNum: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0;
        let hasPassword = false;
        let savedWeekdayRaw: string = "";
        let savedWeekdayLabel: string = "";
        let savedProfessorTime: string = "";
        let savedLeadTime: string = "";
        let resolvedWeekday: RecurringWeekdayKey | null = null;
        let savedSubmitResult: any = null;

        if (json?.progress) {
          const prog = json.progress;
          stepNum =
            typeof prog.step === "number" && prog.step >= 0 && prog.step <= 6
              ? (prog.step as 0 | 1 | 2 | 3 | 4 | 5 | 6)
              : 0;
          if (stepNum > 6) stepNum = 0;
          hasPassword = Boolean(prog.has_password);
          savedWeekdayRaw = String(prog.recurring_class_weekday ?? "").trim().toLowerCase();
          savedWeekdayLabel = String(prog.recurring_class_weekday_label ?? "").trim();
          savedProfessorTime = String(prog.recurring_class_professor_time ?? "").trim();
          savedLeadTime = String(prog.recurring_class_lead_time ?? "").trim();

          if (savedWeekdayRaw) {
            const isWd = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(savedWeekdayRaw);
            if (isWd) {
              resolvedWeekday = savedWeekdayRaw as RecurringWeekdayKey;
            }
          }
          if (hasPassword) {
            setHasPasswordInitial(true);
            const userKnowsRealPassword =
              senha.trim().length >= 4 && !/^[•·*]{4,}$/.test(senha.trim());
            if (!userKnowsRealPassword) {
              setShowResumeScreen(true);
              setSenha("");
            } else {
              if (stepNum >= 1) setSenha(senha.trim());
            }
          }
          if (stepNum >= 3 && resolvedWeekday && savedProfessorTime) {
            const finalLeadTime = savedLeadTime || savedProfessorTime;
            const finalLabel = savedWeekdayLabel || savedWeekdayRaw;
            savedSubmitResult = {
              weekday: resolvedWeekday,
              weekdayLabel: finalLabel,
              professorTime: savedProfessorTime,
              leadTime: finalLeadTime,
            };
            if (stepNum >= 4) {
              setSubmitResult(savedSubmitResult);
            }
            (async () => {
              try {
                const tzBrowser =
                  typeof Intl !== "undefined" &&
                  Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone
                    ? Intl.DateTimeFormat().resolvedOptions().timeZone
                    : "";
                const tzLead = restoredTimezone || leadTimezone;
                const params = new URLSearchParams();
                if (tzLead) params.set("lead_timezone", tzLead);
                if (tzBrowser) params.set("timezone", tzBrowser);
                const qs = params.toString();
                const url = qs
                  ? `/api/cadastro/recorrente/availability?${qs}`
                  : `/api/cadastro/recorrente/availability`;
                const r = await fetch(url, { method: "GET" });
                const j = (await r.json().catch(() => null)) as AvailabilityResponse | null;
                if (r.ok && j?.ok) {
                  setAvailability(j);
                  const slotsMap = j.slotsByWeekdayDate ?? j.slotsByWeekday ?? {};
                  const dayCandidates = (j.dates ?? []).filter((d) => d.weekday === resolvedWeekday);
                  let targetDayId: string | null = null;
                  if (dayCandidates.length === 1) {
                    targetDayId = dayCandidates[0].id;
                  } else if (dayCandidates.length > 1) {
                    const matchingByLabel = dayCandidates.find(
                      (d) =>
                        (savedWeekdayLabel &&
                          (d.displayLabel === savedWeekdayLabel || d.label === savedWeekdayLabel)) ||
                        false,
                    );
                    targetDayId = (matchingByLabel ?? dayCandidates[0])?.id ?? null;
                  }
                  if (targetDayId) {
                    setSelectedDayId(targetDayId);
                  }
                  const arr: RecurringWeekdayTimeOption[] = targetDayId
                    ? slotsMap[targetDayId] ?? []
                    : [];
                  const targetTime = savedProfessorTime;
                  const targetLeadT = savedLeadTime;
                  const opt =
                    (targetTime
                      ? arr.find(
                          (s: any) =>
                            String(s.professorTime ?? "").trim() === targetTime ||
                            String(s.leadTime ?? "").trim() === targetLeadT ||
                            String(s.displayLabel ?? "").trim() === targetLeadT,
                        )
                      : null) || null;
                  if (opt) {
                    setSelectedTimeOpt(opt as any);
                    if (stepNum >= 4) {
                      const lbl = savedWeekdayLabel || resolvedWeekday || "";
                      const leadT = targetLeadT || targetTime;
                      setSubmitResult({
                        weekday: resolvedWeekday || "fri",
                        weekdayLabel: lbl,
                        professorTime: targetTime,
                        leadTime: leadT,
                      } as any);
                    }
                  }
                }
              } catch {}
            })();
          }
          setStep(stepNum);
        }
      } catch (e) {
        setInitialDataError(toErrorMessage(e, ""));
      } finally {
        setInitialDataLoading(false);
      }
    })();
  }, []);

  const firstName = useMemo(() => {
    const parts = (nome || "Aluno(a)").trim().split(/\s+/).filter(Boolean);
    return parts[0] || "Aluno(a)";
  }, [nome]);

  const availableWeekdays = useMemo<RecurringWeekdayOption[]>(() => {
    if (!availability?.dates) return [];
    return availability.dates;
  }, [availability]);

  const availableTimesForSelected = useMemo<RecurringWeekdayTimeOption[]>(() => {
    if (!availability || !selectedDayId) return [];
    const slotsMap = availability.slotsByWeekdayDate ?? availability.slotsByWeekday ?? {};
    const arr = slotsMap[selectedDayId];
    return Array.isArray(arr) ? arr : [];
  }, [availability, selectedDayId]);

  const selectedDayOption = useMemo<RecurringWeekdayOption | null>(() => {
    return availableWeekdays.find((d) => d.id === selectedDayId) ?? null;
  }, [availableWeekdays, selectedDayId]);

  const selectedWeekday = selectedDayOption?.weekday ?? null;
  const selectedWeekdayLabel = selectedDayOption?.displayLabel || selectedDayOption?.label || "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onBeforeUnload() {
      const telefone = phoneField.replace(/\D/g, "");
      if (!telefone || telefone.length < 10) return;
      try {
        const weekdayLabelComputed = (() => {
          const opt = (availability?.dates ?? []).find(
            (d) => d.weekday === selectedWeekday,
          );
          return opt?.displayLabel || opt?.label || "";
        })();
        const browserTz =
          typeof Intl !== "undefined" && Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : "";
        const st = stateField.trim() || null;
        const ct = cityField.trim() || null;
        const tzFromLoc =
          st || ct
            ? resolveStudentTimezone({
                state: st,
                city: ct,
                phone: telefone || null,
                browserTimeZone: browserTz || null,
              })
            : null;
        const tz = tzFromLoc || leadTimezone || ((st || ct) ? browserTz : "") || null;
        const inferredCountry = (st || ct) && (tz || st || ct) ? inferCountry(st, ct, tz || null) : null;
        const payload = {
          telefone,
          nome: nome.trim() || null,
          step,
          password: senha.trim() || null,
          weekday: selectedWeekday || null,
          weekdayLabel: weekdayLabelComputed || null,
          professorTime: selectedTimeOpt?.professorTime || null,
          leadTime: selectedTimeOpt?.leadTime || selectedTimeOpt?.displayLabel || null,
          state: st,
          city: ct,
          country: inferredCountry,
          timezone: tz || null,
        };
        const body = JSON.stringify(payload);
        if (typeof navigator !== "undefined" && (navigator as any).sendBeacon) {
          try {
            const blob = new Blob([body], { type: "application/json" });
            (navigator as any).sendBeacon("/api/cadastro/recorrente/draft", blob);
            return;
          } catch {}
        }
        const xhr = new XMLHttpRequest();
        xhr.open("PATCH", "/api/cadastro/recorrente/draft", false);
        xhr.setRequestHeader("Content-Type", "application/json");
        try {
          xhr.send(body);
        } catch {}
      } catch {}
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [step, phoneField, nome, senha, selectedWeekday, availability, selectedTimeOpt, stateField, cityField, leadTimezone]);

  async function loadAvailability() {
    setAvailLoading(true);
    setAvailError("");
    try {
      const tzBrowser = typeof Intl !== "undefined" && Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : "";
      const tzLead = leadTimezone;
      const params = new URLSearchParams();
      if (tzLead) params.set("lead_timezone", tzLead);
      if (tzBrowser) params.set("timezone", tzBrowser);
      const qs = params.toString();
      const url = qs
        ? `/api/cadastro/recorrente/availability?${qs}`
        : `/api/cadastro/recorrente/availability`;
      const res = await fetch(url, { method: "GET" });
      const json = (await res.json().catch(() => null)) as AvailabilityResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(toErrorMessage(json?.error, "Falha ao carregar disponibilidade."));
      }
      setAvailability(json);
    } catch (e) {
      setAvailError(toErrorMessage(e, "Erro ao carregar disponibilidade."));
    } finally {
      setAvailLoading(false);
    }
  }

  useEffect(() => {
    if (step === 2 && !availability && !availLoading) {
      void loadAvailability();
    }
  }, [step]);

  function canAdvanceFromStep0() {
    if (accessBlocked) return false;
    if (phoneField.replace(/\D/g, "").length < 10) return false;
    if (hasPasswordInitial) return true;
    return senha.trim().length >= 4;
  }

  async function handleAdvance0() {
    if (!canAdvanceFromStep0()) return;
    const browserTz =
      typeof Intl !== "undefined" && Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : "";
    const safeState = stateField.trim();
    const safeCity = cityField.trim();
    const safePhone = phoneField.replace(/\D/g, "");
    const tzFromLoc =
      safeState || safeCity
        ? resolveStudentTimezone({
            state: safeState || null,
            city: safeCity || null,
            phone: safePhone || null,
            browserTimeZone: browserTz || null,
          })
        : null;
    const tzFinal = tzFromLoc || leadTimezone || browserTz || null;
    if (tzFinal && !leadTimezone) {
      setLeadTimezone(tzFinal);
    }
    const inferredCountry = inferCountry(
      safeState || null,
      safeCity || null,
      tzFinal || null
    );
    if (safeState && safeCity && inferredCountry) {
      await saveDraftRecurring({
        step: 1,
        password: senha.trim() || null,
        state: safeState,
        city: safeCity,
        country: inferredCountry,
        timezone: tzFinal || null,
      });
      setStep(2);
      return;
    }
    goStep(1);
  }

  async function handleAdvance1() {
    const st = stateField.trim();
    const ct = cityField.trim();
    if (!st || !ct) return;
    const browserTz =
      typeof Intl !== "undefined" && Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : "";
    const safePhone = phoneField.replace(/\D/g, "");
    const tzFromLoc = resolveStudentTimezone({
      state: st || null,
      city: ct || null,
      phone: safePhone || null,
      browserTimeZone: browserTz || null,
    });
    const tzFinal = tzFromLoc || leadTimezone || browserTz || null;
    if (tzFinal && !leadTimezone) {
      setLeadTimezone(tzFinal);
    }
    const inferred = inferCountry(st, ct, tzFinal || null);
    await saveDraftRecurring({
      step: 2,
      state: st,
      city: ct,
      country: inferred,
      timezone: tzFinal || null,
    });
    setSubmitError("");
    setStep(2);
  }

  function handleAdvance2() {
    if (!selectedDayId || !selectedWeekday) return;
    (async () => {
      setDraftSaving("weekday");
      try {
        const opt = availableWeekdays.find((d) => d.id === selectedDayId);
        await saveDraftRecurring({
          weekday: selectedWeekday,
          weekdayLabel: opt?.displayLabel || opt?.label || null,
        });
      } finally {
        setDraftSaving(null);
      }
    })();
    goStep(3);
  }

  async function handleSubmitFinal() {
    if (!selectedDayId || !selectedWeekday || !selectedTimeOpt) return;
    setSubmitLoading(true);
    setSubmitError("");
    try {
      setDraftSaving("time");
      try {
        const opt = availableWeekdays.find((d) => d.id === selectedDayId);
        await saveDraftRecurring({
          weekday: selectedWeekday,
          weekdayLabel: opt?.displayLabel || opt?.label || selectedWeekdayLabel || null,
          professorTime: selectedTimeOpt.professorTime,
          leadTime: selectedTimeOpt.leadTime || selectedTimeOpt.displayLabel,
        });
      } finally {
        setDraftSaving(null);
      }
      const res = await fetch("/api/cadastro/recorrente/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim(),
          telefone: phoneField.replace(/\D/g, ""),
          senha: senha.trim() || null,
          weekday: selectedWeekday,
          weekdayLabel: selectedWeekdayLabel || null,
          professorTime: selectedTimeOpt.professorTime,
          leadTime: selectedTimeOpt.leadTime || selectedTimeOpt.displayLabel,
          professorDate: selectedDayOption?.professorDate || null,
          professorStartAt: selectedTimeOpt.professorStartAtIso || null,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | (SubmitResponse & { blocked?: boolean })
        | null;
      if (json?.blocked === true) {
        setAccessBlocked(true);
        setAccessBlockedMessage(
          toErrorMessage(json?.error, "") ||
            "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
        );
        throw new Error(toErrorMessage(json?.error, "Acesso bloqueado."));
      }
      if (!res.ok || !json?.ok || !json.scheduled) {
        throw new Error(toErrorMessage(json?.error, "Falha ao finalizar o cadastro. Tente novamente."));
      }
      setSubmitLeadId(String(json.leadId || ""));
      setSubmitResult(json.scheduled);
      goStep(4);
    } catch (e) {
      setSubmitError(toErrorMessage(e, "Erro desconhecido."));
    } finally {
      setSubmitLoading(false);
    }
  }

  async function handleResumeAttempt() {
    if (resumeLoading) return;
    const pwd = resumePassword.trim();
    if (pwd.length < 4) {
      setResumeError("Informe sua senha para continuar.");
      return;
    }
    setResumeLoading(true);
    setResumeError("");
    try {
      const telefone = phoneField.replace(/\D/g, "").trim();
      const res = await fetch("/api/cadastro/recorrente/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefone, senha: pwd }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            resume?: boolean;
            error?: string;
            blocked?: boolean;
            lead?: any;
            progress?: any;
          }
        | null;
      if (json?.blocked === true) {
        setAccessBlocked(true);
        setAccessBlockedMessage(
          String(json?.error ?? "").trim() ||
            "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
        );
        return;
      }
      if (!res.ok || !json?.ok) {
        const msg = String(json?.error ?? "").trim() || "Senha incorreta. Tente novamente.";
        setResumeError(msg);
        return;
      }
      const prog = json.progress ?? null;
      const leadData = json.lead ?? null;
      let stepNum: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1;
      let savedWeekdayRaw = "";
      let savedWeekdayLabel = "";
      let savedProfessorTime = "";
      let savedLeadTime = "";
      let resolvedWeekday: RecurringWeekdayKey | null = null;
      let savedSubmitResult: any = null;
      if (prog) {
        stepNum =
          typeof prog.step === "number" && prog.step >= 0 && prog.step <= 6
            ? (prog.step as 0 | 1 | 2 | 3 | 4 | 5 | 6)
            : 1;
        if (stepNum < 1) stepNum = 1;
        if (stepNum > 6) stepNum = 1;
        setHasPasswordInitial(true);
        setSenha(pwd);
        savedWeekdayRaw = String(prog.recurring_class_weekday ?? "").trim().toLowerCase();
        savedWeekdayLabel = String(prog.recurring_class_weekday_label ?? "").trim();
        savedProfessorTime = String(prog.recurring_class_professor_time ?? "").trim();
        savedLeadTime = String(prog.recurring_class_lead_time ?? "").trim();
        if (savedWeekdayRaw) {
          const isWd = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(savedWeekdayRaw);
          if (isWd) resolvedWeekday = savedWeekdayRaw as RecurringWeekdayKey;
        }
        if (leadData) {
          const restoredName = toNomeESobrenome(String(leadData.full_name ?? "").trim());
          if (restoredName) {
            setNome(restoredName);
            setLastSavedFieldValues((prev) => ({ ...prev, full_name: restoredName! }));
            setContractSnapshot((prev) => ({ ...prev, full_name: restoredName! }));
          }
          const lid = String(leadData.id ?? "").trim();
          if (lid) {
            setSubmitLeadId(lid);
            setContractLeadId(lid);
          }
          if (leadData.state) setStateField(String(leadData.state));
          if (leadData.city) setCityField(String(leadData.city));
          if (leadData.timezone) setLeadTimezone(String(leadData.timezone));
        }
        if (stepNum >= 3 && resolvedWeekday && savedProfessorTime) {
          const finalLeadTime = savedLeadTime || savedProfessorTime;
          const finalLabel = savedWeekdayLabel || savedWeekdayRaw;
          savedSubmitResult = {
            weekday: resolvedWeekday,
            weekdayLabel: finalLabel,
            professorTime: savedProfessorTime,
            leadTime: finalLeadTime,
          };
          if (stepNum >= 4) {
            setSubmitResult(savedSubmitResult);
          }
          if (stepNum >= 2) {
            void (async () => {
              try {
                const tzBrowser =
                  typeof Intl !== "undefined" && Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone
                    ? Intl.DateTimeFormat().resolvedOptions().timeZone
                    : "";
                const tzLead = leadData?.timezone || leadTimezone;
                const params = new URLSearchParams();
                if (tzLead) params.set("lead_timezone", tzLead);
                if (tzBrowser) params.set("timezone", tzBrowser);
                const qs = params.toString();
                const url = qs
                  ? `/api/cadastro/recorrente/availability?${qs}`
                  : `/api/cadastro/recorrente/availability`;
                const r = await fetch(url, { method: "GET" });
                const j = (await r.json().catch(() => null)) as AvailabilityResponse | null;
                if (r.ok && j?.ok) {
                  setAvailability(j);
                  const slotsMap = j.slotsByWeekdayDate ?? j.slotsByWeekday ?? {};
                  const dayCandidates = (j.dates ?? []).filter((d) => d.weekday === resolvedWeekday);
                  let targetDayId: string | null = null;
                  if (dayCandidates.length === 1) {
                    targetDayId = dayCandidates[0].id;
                  } else if (dayCandidates.length > 1) {
                    const matchingByLabel = dayCandidates.find(
                      (d) =>
                        (savedWeekdayLabel &&
                          (d.displayLabel === savedWeekdayLabel || d.label === savedWeekdayLabel)) ||
                        false,
                    );
                    targetDayId = (matchingByLabel ?? dayCandidates[0])?.id ?? null;
                  }
                  if (targetDayId) setSelectedDayId(targetDayId);
                  const arr: RecurringWeekdayTimeOption[] = targetDayId
                    ? slotsMap[targetDayId] ?? []
                    : [];
                  const targetTime = savedProfessorTime;
                  const targetLeadT = savedLeadTime;
                  const opt =
                    (targetTime
                      ? arr.find(
                          (s: any) =>
                            String(s.professorTime ?? "").trim() === targetTime ||
                            String(s.leadTime ?? "").trim() === targetLeadT ||
                            String(s.displayLabel ?? "").trim() === targetLeadT,
                        )
                      : null) || null;
                  if (opt) {
                    setSelectedTimeOpt(opt as any);
                    if (stepNum >= 4) {
                      const lbl = savedWeekdayLabel || resolvedWeekday || "";
                      const leadT = targetLeadT || targetTime;
                      setSubmitResult({
                        weekday: resolvedWeekday || "fri",
                        weekdayLabel: lbl,
                        professorTime: targetTime,
                        leadTime: leadT,
                      } as any);
                    }
                  }
                }
              } catch {}
            })();
          }
        }
      }
      setShowResumeScreen(false);
      setResumePassword("");
      void saveDraftRecurring({ step: stepNum, password: pwd }).catch(() => {});
      setTimeout(() => {
        setStep(stepNum);
        if (typeof window !== "undefined") {
          try { window.scrollTo({ top: 0, left: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
        }
      }, 0);
    } catch (e) {
      setResumeError(toErrorMessage(e, "Falha ao validar a senha. Tente novamente."));
    } finally {
      setResumeLoading(false);
    }
  }

  if (accessBlocked) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-red-50 via-white to-rose-50 py-10 px-4 sm:px-6 flex items-center justify-center">
        <div className="mx-auto max-w-lg w-full">
          <div className="bg-white rounded-3xl shadow-xl shadow-red-100/50 border border-red-100 p-8 sm:p-10 text-center">
            <div className="mx-auto w-20 h-20 rounded-full bg-red-500/10 text-red-600 flex items-center justify-center mb-6">
              <svg
                className="w-10 h-10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15v2m0 0v2m0-2h2m-2 0h-2m4.243-9.243l1.414-1.414M4.929 19.071l1.414-1.414m0-11.314L4.929 4.929m14.142 14.142l-1.414-1.414M12 3a9 9 0 100 18 9 9 0 000-18z"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Acesso bloqueado
            </h1>
            <p className="mt-4 text-slate-600 text-base leading-relaxed">
              {accessBlockedMessage ||
                "Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp."}
            </p>
            <div className="mt-8 pt-7 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
              © {new Date().getFullYear()} Lucas Brum Online Music USA. Todos os direitos reservados.
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (showResumeScreen && !initialDataLoading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-sky-50 py-10 px-4 sm:px-6 flex items-center justify-center">
        <div className="mx-auto max-w-xl w-full">
          <div className="bg-white rounded-3xl shadow-xl shadow-indigo-100/50 border border-slate-100 p-6 sm:p-10">
            <div className="text-center mb-6">
              <div className="mx-auto w-16 h-16 rounded-full bg-indigo-500/10 text-indigo-600 flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Retome sua matrícula
              </h1>
              <p className="mt-4 text-slate-600 text-base leading-relaxed">
                Você já acessou este link de matrícula por outro dispositivo. Para continuar, insira sua senha abaixo e retome a matrícula da etapa em que parou.
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">
                  Seu telefone (WhatsApp)
                </label>
                <input
                  type="text"
                  value={phoneField}
                  readOnly
                  className="w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-slate-600 outline-none cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">
                  Sua senha
                </label>
                <input
                  type="password"
                  autoFocus
                  value={resumePassword}
                  onChange={(e) => {
                    setResumePassword(e.target.value);
                    setResumeError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleResumeAttempt();
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition text-base"
                  placeholder="Digite sua senha"
                  minLength={4}
                />
              </div>
              {resumeError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 leading-relaxed">
                  {resumeError}
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-3 pt-2 w-full">
                <button
                  onClick={() => void handleResumeAttempt()}
                  disabled={resumeLoading || resumePassword.trim().length < 4}
                  className="w-full sm:w-auto sm:ml-auto rounded-2xl px-7 py-3.5 bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-base"
                >
                  {resumeLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
                        <path d="M22 12a10 10 0 01-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Validando...
                    </span>
                  ) : (
                    "Continuar matrícula"
                  )}
                </button>
              </div>
            </div>
            <div className="mt-8 pt-6 border-t border-slate-100 text-xs text-slate-500 leading-relaxed text-center">
              © {new Date().getFullYear()} Lucas Brum Online Music USA. Todos os direitos reservados.
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-sky-50 py-10 px-4 sm:px-6">
      <div className="mx-auto max-w-3xl w-full">
        <header className="mb-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Lucas Brum Online Music USA
          </h1>
          <p className="mt-3 text-slate-600 text-lg">
            Conclua seu cadastro e escolha o melhor horário para suas aulas.
          </p>
        </header>

        <div className="bg-white rounded-3xl shadow-xl shadow-indigo-100/50 border border-slate-100 p-6 sm:p-10">
          <div className="mb-8">
            {(() => {
              const allSteps = [
                { key: 0, label: "Conta", shortLabel: "Conta" },
                { key: 1, label: "Localização", shortLabel: "Loc" },
                { key: 2, label: "Dia", shortLabel: "Dia" },
                { key: 3, label: "Horário", shortLabel: "Hora" },
                { key: 4, label: "Revisão", shortLabel: "Rev" },
                { key: 5, label: "Pagamento", shortLabel: "Pag" },
                { key: 6, label: "Concluído", shortLabel: "Fim" },
              ];
              const N = allSteps.length;
              const buildDisplayOrder = (current: number): Array<{ kind: "step"; idx: number } | { kind: "ellipsis" }> => {
                const out: Array<{ kind: "step"; idx: number } | { kind: "ellipsis" }> = [];
                const window = 1;
                const keep = new Set<number>();
                keep.add(0);
                keep.add(N - 1);
                for (let i = current - window; i <= current + window; i++) {
                  if (i >= 0 && i < N) keep.add(i);
                }
                let prevIdx = -2;
                for (let i = 0; i < N; i++) {
                  if (!keep.has(i)) continue;
                  if (prevIdx >= 0 && i - prevIdx > 1) out.push({ kind: "ellipsis" });
                  out.push({ kind: "step", idx: i });
                  prevIdx = i;
                }
                return out;
              };
              const display = buildDisplayOrder(step);
              const currentLabel = allSteps[step].label;
              return (
                <div className="space-y-2.5 sm:space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0">
                    <div className="text-[10px] sm:text-[11px] sm:text-xs font-bold uppercase tracking-[0.16em] sm:tracking-[0.18em] text-indigo-600">
                      Passo {step + 1} de {N}
                    </div>
                    <div className="text-[13px] sm:text-xs sm:text-sm font-semibold text-slate-700 truncate max-w-[70%]">
                      {currentLabel}
                    </div>
                  </div>
                  <div className="flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5 sm:gap-2 overflow-x-auto sm:overflow-visible pb-0.5 sm:pb-0 -mx-1 px-1 sm:mx-0 sm:px-0">
                    {display.map((item, pos) => {
                      if (item.kind === "ellipsis") {
                        return (
                          <div key={`e-${pos}`} className="flex items-center gap-1 sm:gap-1.5 text-slate-400 select-none flex-shrink-0">
                            <div className="hidden sm:block h-px w-4 sm:w-6 bg-slate-200" />
                            <div className="text-sm sm:text-lg font-bold leading-none tracking-widest text-slate-300">···</div>
                            <div className="hidden sm:block h-px w-4 sm:w-6 bg-slate-200" />
                          </div>
                        );
                      }
                      const idx = item.idx;
                      const st = allSteps[idx];
                      const active = step === idx;
                      const done = step > idx;
                      const isFirst = idx === 0;
                      const isLast = idx === N - 1;
                      return (
                        <div key={st.key} className="flex items-center gap-1 sm:gap-1.5 sm:gap-2 flex-shrink-0">
                          {!isFirst && (
                            <div className="hidden sm:block h-px w-4 sm:w-6 sm:w-8 bg-slate-200">
                              <div
                                className={
                                  "h-px w-full transition-all duration-300 " +
                                  (done ? "bg-gradient-to-r from-indigo-500 to-sky-500" : "bg-slate-200")
                                }
                              />
                            </div>
                          )}
                          <div className="flex flex-col items-center gap-1 sm:gap-1.5">
                            <div
                              className={
                                "w-7 h-7 sm:w-8.5 sm:h-8.5 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-[12px] sm:text-[13px] sm:text-sm font-extrabold flex-shrink-0 transition-all duration-200 " +
                                (done
                                  ? "bg-emerald-500 text-white shadow-sm sm:shadow-md shadow-emerald-200"
                                  : active
                                  ? "bg-indigo-600 text-white shadow-md sm:shadow-lg shadow-indigo-200 ring-2 sm:ring-4 ring-indigo-100"
                                  : "bg-white border border-slate-200 text-slate-400 hover:border-slate-300")
                              }
                            >
                              {done ? "✓" : String(st.key + 1)}
                            </div>
                            <span
                              className={
                                "hidden sm:block text-[10px] sm:text-[11px] font-bold uppercase tracking-wider whitespace-nowrap " +
                                (active
                                  ? "text-indigo-700"
                                  : done
                                  ? "text-slate-700"
                                  : "text-slate-400")
                              }
                            >
                              {st.shortLabel}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-sky-500 transition-all duration-500 ease-out"
                      style={{
                        width: `${step === 0 ? 14 : step === 1 ? 28 : step === 2 ? 42 : step === 3 ? 57 : step === 4 ? 71 : step === 5 ? 85 : 100}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })()}
          </div>

          {step === 0 && (
            <section className="space-y-7">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Crie sua conta</h2>
                <p className="mt-1 text-slate-600">Preencha os dados abaixo para prosseguir.</p>
                {initialDataLoading && (
                  <p className="mt-2 text-xs text-slate-500">Sincronizando seus dados...</p>
                )}
              </div>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    E-mail (seu WhatsApp)
                  </label>
                  <input
                    type="text"
                    value={phoneField}
                    onChange={(e) => setPhoneField(e.target.value)}
                    readOnly
                    className="w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-slate-600 outline-none cursor-not-allowed"
                    placeholder="Telefone identificador"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Esse valor é preenchido automaticamente com seu WhatsApp.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">Crie uma senha</label>
                  <input
                    type="password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition"
                    placeholder="Mínimo 4 caracteres"
                    minLength={4}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 pt-2 w-full">
                <button
                  onClick={handleAdvance0}
                  disabled={!canAdvanceFromStep0()}
                  className="w-full sm:w-auto sm:ml-auto rounded-2xl px-7 py-3.5 bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-base"
                >
                  Avançar
                </button>
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="space-y-7">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">
                  {firstName}, onde você mora?
                </h2>
                <p className="mt-1 text-slate-600">
                  Precisamos do seu estado e cidade para oferecer horários compatíveis com o seu fuso horário e a localização do professor. O país é identificado automaticamente.
                </p>
              </div>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Estado
                  </label>
                  <p className="mb-2 text-xs sm:text-sm text-slate-500">
                    Digite corretamente o nome do seu estado.
                  </p>
                  <input
                    type="text"
                    value={stateField}
                    onChange={(e) => setStateField(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition text-base"
                    placeholder="Ex: São Paulo, Mato Grosso, Florida..."
                    autoComplete="address-level1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Cidade
                  </label>
                  <p className="mb-2 text-xs sm:text-sm text-slate-500">
                    Digite corretamente o nome da sua cidade.
                  </p>
                  <input
                    type="text"
                    value={cityField}
                    onChange={(e) => setCityField(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition text-base"
                    placeholder="Ex: Campo Novo do Parecis, São Paulo, Miami..."
                    autoComplete="address-level2"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 w-full">
                <button
                  onClick={() => void handleAdvance1()}
                  disabled={!stateField.trim() || !cityField.trim()}
                  className="w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-10 sm:min-w-[240px] py-3.5 bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate order-2 sm:order-2 sm:justify-self-end"
                >
                  Avançar
                </button>
                <button
                  onClick={() => goStep(0)}
                  className="w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-8 sm:min-w-[200px] py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition justify-center flex items-center text-sm sm:text-base truncate order-1 sm:order-1 sm:justify-self-start"
                >
                  Voltar
                </button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-7">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">
                  {firstName}, qual dia da semana você teria disponibilidade para suas aulas?
                </h2>
                <p className="mt-1 text-slate-600">Apresentamos somente os dias realmente disponíveis.</p>
              </div>
              {availLoading && (
                <div className="py-16 text-center text-slate-500">Carregando dias disponíveis...</div>
              )}
              {!availLoading && availError && (
                <div className="rounded-2xl bg-red-50 border border-red-200 p-5 text-red-700">
                  <strong>Falha ao carregar disponibilidade:</strong>
                  <div className="mt-1">{toErrorMessage(availError, "Erro desconhecido.")}</div>
                  <button
                    onClick={() => void loadAvailability()}
                    className="mt-4 rounded-xl bg-red-600 text-white px-4 py-2 font-medium hover:bg-red-700"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}
              {!availLoading && !availError && availableWeekdays.length === 0 && (
                <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 text-amber-800">
                  No momento não há dias disponíveis para novas aulas recorrentes. Nossa equipe
                  entrará em contato para mais opções.
                </div>
              )}
              {!availLoading && !availError && availableWeekdays.length > 0 && (
                <div className="space-y-8">
                  {(() => {
                    const groups = new Map<string | number, RecurringWeekdayOption[]>();
                    for (const d of availableWeekdays) {
                      const key = d.weekIndex ?? 0;
                      if (!groups.has(key)) groups.set(key, []);
                      groups.get(key)!.push(d);
                    }
                    const order = Array.from(groups.keys()).sort((a, b) => (a as number) - (b as number));
                    return order.map((weekIdx) => {
                      const items = groups.get(weekIdx) ?? [];
                      const label = items[0]?.weekLabel ?? (weekIdx === 0 ? "Semana atual" : "Próxima semana");
                      return (
                        <div key={String(weekIdx)} className="space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="shrink-0 rounded-full bg-indigo-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600">
                              {label}
                            </div>
                            <div className="h-px flex-1 bg-slate-200/80" />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {items.map((day) => {
                              const selected = selectedDayId === day.id;
                              return (
                                <button
                                  key={day.id}
                                  onClick={() => setSelectedDayId(day.id)}
                                  className={
                                    "text-left rounded-2xl border p-5 transition focus:outline-none " +
                                    (selected
                                      ? "border-indigo-500 bg-indigo-50 ring-4 ring-indigo-100 shadow-md"
                                      : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50")
                                  }
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-xl font-bold text-slate-900 break-words">{day.displayLabel}</div>
                                      <div className="mt-1 text-sm text-slate-500">
                                        {day.slotCount} horário(s) disponível(is)
                                      </div>
                                    </div>
                                    <div
                                      className={
                                        "w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 " +
                                        (selected ? "border-indigo-600 bg-indigo-600" : "border-slate-300")
                                      }
                                    >
                                      {selected && <span className="text-white text-xs font-bold" />}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 w-full">
                <button
                  onClick={handleAdvance2}
                  disabled={!selectedDayId || !selectedWeekday}
                  className="w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-10 sm:min-w-[240px] py-3.5 bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate order-2 sm:order-2 sm:justify-self-end"
                >
                  Avançar
                </button>
                <button
                  onClick={() => goStep(1)}
                  className="w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-8 sm:min-w-[200px] py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition justify-center flex items-center text-sm sm:text-base truncate order-1 sm:order-1 sm:justify-self-start"
                >
                  Voltar
                </button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-7">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">
                  Qual horário fica melhor para você, {firstName}?
                </h2>
                <p className="mt-1 text-slate-600">
                  Apenas horários livres para {selectedWeekdayLabel || "o dia selecionado"}.
                </p>
              </div>
              {availableTimesForSelected.length === 0 && (
                <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 text-amber-800">
                  Houve uma falha no carregamento ou não há dados disponíveis para a opção escolhida. Volte uma etapa e tente novamente.
                </div>
              )}
              {availableTimesForSelected.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {availableTimesForSelected.map((t) => {
                    const selected = selectedTimeOpt?.id === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTimeOpt(t)}
                        className={
                          "text-left rounded-2xl border p-5 transition focus:outline-none " +
                          (selected
                            ? "border-emerald-500 bg-emerald-50 ring-4 ring-emerald-100 shadow-md"
                            : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-slate-50")
                        }
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
                              {t.displayLabel}
                            </div>
                            {t.professorTime !== t.displayLabel && (
                              <div className="mt-1 text-xs text-slate-500">
                                Horário do professor: {t.professorTime}
                              </div>
                            )}
                          </div>
                          <div
                            className={
                              "w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 " +
                              (selected ? "border-emerald-600 bg-emerald-600" : "border-slate-300")
                            }
                          >
                            {selected && <span className="text-white text-xs font-bold" />}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {submitError && (
                <div className="rounded-2xl bg-red-50 border border-red-200 p-5 text-red-700">{toErrorMessage(submitError, "Erro desconhecido.")}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 w-full">
                <button
                  onClick={() => void handleSubmitFinal()}
                  disabled={!selectedTimeOpt || submitLoading}
                  className="w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-10 sm:min-w-[280px] py-3.5 bg-emerald-600 text-white font-semibold shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate order-2 sm:order-2 sm:justify-self-end"
                >
                  {submitLoading ? "Agendando..." : "Agendar"}
                </button>
                <button
                  onClick={() => goStep(2)}
                  className="w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-8 sm:min-w-[200px] py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition justify-center flex items-center text-sm sm:text-base truncate order-1 sm:order-1 sm:justify-self-start"
                >
                  Voltar
                </button>
              </div>
            </section>
          )}

          {step === 4 && submitResult && (
            <section className="space-y-7">
              <div className="text-center">
                <div className="mx-auto w-20 h-20 rounded-full bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h2 className="mt-5 text-3xl font-extrabold text-slate-900">Revise seus dados</h2>
                <p className="mt-3 text-lg text-slate-600">
                  Confirme se as informações abaixo estão corretas.
                </p>
              </div>

              {contractInitLoading && !contractInitError && (
                <div className="py-14 text-center text-slate-500">Preparando suas informações…</div>
              )}
              {contractInitError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700 max-w-2xl mx-auto">{toErrorMessage(contractInitError, "Erro desconhecido.")}</div>
              )}

              <div className="rounded-3xl border border-slate-200 bg-white max-w-2xl mx-auto divide-y divide-slate-100">
                <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-[minmax(140px,180px)_1fr] gap-3 sm:gap-5 items-start">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 sm:text-right sm:pt-1">
                    Nome completo
                  </div>
                  <div className="text-base font-semibold text-slate-900 break-words">
                    {nome || "— não informado —"}
                  </div>
                </div>
                <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-[minmax(140px,180px)_1fr] gap-3 sm:gap-5 items-start">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 sm:text-right sm:pt-1">
                    Dia da aula
                  </div>
                  <div className="text-base font-semibold text-slate-900 break-words">
                    {submitResult.weekdayLabel}
                  </div>
                </div>
                <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-[minmax(140px,180px)_1fr] gap-3 sm:gap-5 items-start">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 sm:text-right sm:pt-1">
                    Horário
                  </div>
                  <div className="text-base font-semibold text-slate-900 break-words">
                    {submitResult.leadTime}
                  </div>
                </div>
              </div>

              {(() => {
                return (
                  <section className="max-w-2xl mx-auto mb-8">
                    <div className="text-center mb-6">
                      <h3 className="text-base sm:text-lg font-bold uppercase tracking-wide text-slate-800">
                        Prévia da confirmação de matrícula
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-500 mt-1">
                        Revise todo o conteúdo abaixo antes de confirmar. Este é o mesmo texto do PDF gerado após o aceite.
                      </p>
                    </div>
                    <article className="rounded-3xl border border-slate-200 bg-white shadow-[0_8px_30px_-16px_rgba(15,23,42,0.18)] p-6 sm:p-10 font-serif text-slate-900">
                      <h2 className="text-center font-bold">
                        LUCAS BRUM ONLINE MUSIC USA
                        <br />
                        CONFIRMAÇÃO DE MATRÍCULA
                      </h2>
                      <p className="mt-4 text-[13px] sm:text-[14px] leading-[1.6] text-justify mb-2 text-black/90">
                        Eu, <b>{nome || "[NOME]"}</b>, confirmo minha matrícula na Lucas Brum Online Music USA para participar de aulas individuais e online de música.
                      </p>
                      <p className="text-[13px] sm:text-[14px] leading-[1.6] text-justify mb-2 text-black/90">
                        <b>Dia da aula:</b> {submitResult.weekdayLabel}
                      </p>
                      <p className="text-[13px] sm:text-[14px] leading-[1.6] text-justify mb-2 text-black/90">
                        <b>Horário:</b> {submitResult.leadTime}
                      </p>
                      <p className="text-[13px] sm:text-[14px] leading-[1.6] text-justify mb-2 text-black/90">
                        <b>Frequência:</b> 1 aula por semana
                      </p>
                      <p className="text-[13px] sm:text-[14px] leading-[1.6] text-justify mb-2 text-black/90">
                        <b>Duração:</b> 40 minutos por aula
                      </p>
                      <p className="text-[13px] sm:text-[14px] leading-[1.6] text-justify mb-2 text-black/90">
                        <b>Plano:</b> Inicialmente previsto para 6 meses, podendo ser cancelado a qualquer momento, sem multa.
                      </p>
                      <p className="text-[13px] sm:text-[14px] leading-[1.6] text-justify text-black/90 mt-4">
                        Documento simplificado para confirmação eletrônica de matrícula.
                      </p>
                    </article>
                  </section>
                );
              })()}

              <div className="rounded-3xl bg-slate-50 border border-slate-200 p-6 max-w-2xl mx-auto text-sm text-slate-700 leading-relaxed space-y-2">
                <p className="font-semibold text-slate-900 text-base">Declaração de aceite</p>
                <p>
                  Declaro que li, compreendi e concordo com as condições apresentadas nesta confirmação de matrícula da Lucas Brum Online Music USA,
                  incluindo dia e horário das aulas, frequência, duração e condições do plano.
                </p>
              </div>

              {contractFinalError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700 max-w-2xl mx-auto">{toErrorMessage(contractFinalError, "Erro desconhecido.")}</div>
              )}

              <div className="grid grid-cols-1 sm:flex sm:flex-row sm:items-start gap-3 pt-2 max-w-2xl mx-auto w-full">
                <button
                  onClick={() => goStep(3)}
                  disabled={contractFinalizing}
                  className="order-1 sm:order-1 w-full sm:flex-1 shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-7 sm:min-w-[200px] py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate"
                >
                  Voltar para editar
                </button>
                <button
                  onClick={() => void handleContractFinalize()}
                  disabled={contractFinalizing}
                  className="order-2 sm:order-2 w-full sm:flex-1 shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-9 sm:min-w-[300px] py-3.5 bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm sm:text-base justify-center flex items-center truncate"
                >
                  {contractFinalizing ? "Confirmando..." : "Confirmar e avançar"}
                </button>
              </div>
            </section>
          )}

          {step === 5 && submitResult && (
            <section className="space-y-7 text-center">
              {paymentTab === "menu" && (
                <>
                  <div className="mx-auto w-20 h-20 rounded-full bg-sky-500/10 text-sky-600 flex items-center justify-center">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-3xl font-extrabold text-slate-900">Pagamento da primeira mensalidade</h2>
                    <p className="mt-5 text-xl text-slate-700 leading-snug">
                      Agora, para finalizar, <strong className="text-slate-900">{firstName}</strong>, escolha a forma de pagamento abaixo.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 max-w-2xl mx-auto w-full">
                    <button
                      onClick={() => { setPaymentTab("link"); scrollToTop(); }}
                      className="w-full text-left rounded-2xl border-2 border-slate-200 hover:border-sky-500 hover:bg-sky-50/50 transition p-4 sm:p-6 bg-white shadow-sm"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                        <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-sky-500/10 text-sky-600 flex items-center justify-center shrink-0">
                            <svg className="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-base sm:text-lg font-bold text-slate-900 leading-snug">1. Link de pagamento</div>
                            <div className="text-sm text-slate-500 mt-1 leading-relaxed">Pagamento online por cartão</div>
                          </div>
                        </div>
                        <div className="sm:shrink-0 self-start sm:self-center">
                          <div className="inline-flex items-center rounded-full bg-sky-500 text-white px-4 py-1.5 text-xs sm:text-sm font-bold tracking-wide">
                            Recomendado
                          </div>
                        </div>
                      </div>
                    </button>

                    <button
                      onClick={() => { setPaymentTab("deposit"); scrollToTop(); }}
                      className="w-full text-left rounded-2xl border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition p-4 sm:p-6 bg-white shadow-sm"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                        <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-slate-500/10 text-slate-700 flex items-center justify-center shrink-0">
                            <svg className="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-base sm:text-lg font-bold text-slate-900 leading-snug">2. Depósito bancário</div>
                            <div className="text-sm text-slate-500 mt-1 leading-relaxed">Wise US Inc · Conta Checking (USD)</div>
                          </div>
                        </div>
                        <div className="sm:text-right sm:shrink-0 self-start sm:self-center">
                          <div className="text-2xl sm:text-3xl font-black text-slate-900 leading-none">US$ 119,00</div>
                          <div className="text-xs sm:text-sm text-slate-500 mt-1">Dólar americano</div>
                        </div>
                      </div>
                    </button>

                    <button
                      onClick={() => { setPaymentTab("pix"); scrollToTop(); }}
                      className="w-full text-left rounded-2xl border-2 border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/50 transition p-4 sm:p-6 bg-white shadow-sm"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                        <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-emerald-500/10 text-emerald-700 flex items-center justify-center shrink-0">
                            <svg className="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                            </svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-base sm:text-lg font-bold text-slate-900 leading-snug">3. PIX</div>
                            <div className="text-sm text-slate-500 mt-1 leading-relaxed">QR Code ou copia e cola · Cotação fixa Ago/2026</div>
                          </div>
                        </div>
                        <div className="sm:text-right sm:shrink-0 self-start sm:self-center">
                          <div className="text-2xl sm:text-3xl font-black text-emerald-700 leading-none">R$ 595,00</div>
                          <div className="text-xs sm:text-sm text-slate-500 mt-1">US$ 1,00 = R$ 5,00</div>
                        </div>
                      </div>
                    </button>
                  </div>

                  <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-5 sm:p-6 text-left max-w-2xl mx-auto shadow-sm">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="w-11 h-11 shrink-0 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-500">
                          Titularidade das contas de recebimento
                        </div>
                        <div className="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug">
                          Loivo de Brum Castro
                        </div>
                        <div className="text-sm sm:text-base text-slate-600 leading-relaxed">
                          Gestor Financeiro da Escola de Música Lucas Brum
                        </div>
                        <div className="text-xs sm:text-sm text-slate-500 pt-1.5 leading-relaxed">
                          Cartão de crédito · Transferência bancária em dólar (Wise USD) · PIX
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6 text-left space-y-3 max-w-2xl mx-auto">
                    <p className="text-sm sm:text-base text-amber-800 leading-relaxed">
                      <strong className="font-bold">Importante:</strong> a data da mensalidade será definida com base na data da confirmação desse primeiro pagamento.
                    </p>
                    <p className="text-sm sm:text-base text-amber-900 leading-relaxed font-semibold pt-2 border-t border-amber-200/60">
                      A matrícula só será considerada efetivada após a confirmação do pagamento.
                    </p>
                  </div>

                  <div className="w-full max-w-2xl mx-auto pt-2">
                    <button
                      onClick={() => goStep(4)}
                      className="order-1 w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-8 sm:min-w-[200px] py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition justify-center flex items-center text-sm sm:text-base truncate"
                    >
                      Voltar
                    </button>
                  </div>
                </>
              )}

              {paymentTab === "link" && (
                <>
                  <div className="flex items-center justify-center gap-3 w-full max-w-2xl mx-auto">
                    <button
                      onClick={() => { setPaymentTab("menu"); scrollToTop(); }}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold transition"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                      Voltar
                    </button>
                    <div className="text-xs sm:text-sm text-slate-500">Link de pagamento</div>
                  </div>

                  <div className="mx-auto w-20 h-20 rounded-full bg-sky-500/10 text-sky-600 flex items-center justify-center">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">Pagamento online por cartão</h2>
                    <p className="mt-4 text-lg text-slate-700 leading-snug max-w-2xl mx-auto">
                      Clique no botão abaixo para abrir a página segura de pagamento e concluir em poucos segundos.
                    </p>
                  </div>

                  <a
                    href="https://buy.stripe.com/8x23cw4LQ1Due7E6MMcwg03"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-5 sm:px-8 py-4 bg-sky-600 text-white font-bold text-base sm:text-xl shadow-lg shadow-sky-200 hover:bg-sky-700 transition w-full max-w-2xl mx-auto min-w-0"
                  >
                    <svg className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Abrir link de pagamento
                  </a>

                  <div className="rounded-2xl border border-sky-200 bg-sky-50/50 p-5 sm:p-6 text-left space-y-2 max-w-2xl mx-auto">
                    <p className="text-sm sm:text-base text-sky-900 leading-relaxed">
                      <strong className="font-bold">Após efetuar o pagamento:</strong> retorne a esta página e clique em <strong className="underline">Finalizar matrícula</strong> abaixo.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 w-full max-w-2xl mx-auto">
                    <button
                      onClick={() => { setPaymentTab("menu"); scrollToTop(); }}
                      className="order-1 sm:order-1 w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-8 sm:min-w-[200px] py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition justify-center flex items-center text-sm sm:text-base truncate sm:justify-self-start"
                    >
                      Voltar
                    </button>
                    <button
                      disabled={contractFinalizing}
                      onClick={finalizarMatriculaStep9}
                      className="order-2 sm:order-2 w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-10 sm:min-w-[260px] py-3.5 bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate sm:justify-self-end"
                    >
                      {contractFinalizing ? "Finalizando matrícula…" : "Finalizar matrícula"}
                    </button>
                  </div>
                </>
              )}

              {paymentTab === "deposit" && (
                <>
                  <div className="flex items-center justify-center gap-3 w-full max-w-2xl mx-auto">
                    <button
                      onClick={() => { setPaymentTab("menu"); scrollToTop(); }}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold transition"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                      Voltar
                    </button>
                    <div className="text-xs sm:text-sm text-slate-500">Depósito bancário</div>
                  </div>

                  <div className="mx-auto w-20 h-20 rounded-full bg-slate-500/10 text-slate-700 flex items-center justify-center">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">Depósito internacional USD</h2>
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-50 px-5 py-2">
                      <div className="text-base sm:text-sm font-semibold text-slate-700">Valor:</div>
                      <div className="text-2xl sm:text-3xl font-black text-slate-900">US$ 119,00</div>
                    </div>
                  </div>

                  <div className="rounded-3xl border-2 border-slate-200 bg-white p-5 sm:p-8 text-left space-y-5 max-w-2xl mx-auto shadow-sm">
                    {([
                      { key: "titular", label: "Titular", value: "Loivo de Brum Castro", mono: false, copy: true },
                      { key: "banco", label: "Banco", value: "Wise US Inc", mono: false, copy: false },
                      { key: "tipo", label: "Tipo de conta", value: "Checking", mono: false, copy: false },
                      { key: "routing", label: "Routing Number", value: "101019628", mono: true, copy: true },
                      { key: "account", label: "Account Number", value: "217900196692", mono: true, copy: true },
                    ] as const).map((row) => (
                      <div key={row.key} className="grid grid-cols-1 sm:grid-cols-[minmax(120px,160px)_1fr] gap-1 sm:gap-4 items-start border-b last:border-b-0 border-slate-100 pb-4 last:pb-0">
                        <div className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 pt-1">
                          {row.label}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className={`font-semibold text-slate-900 text-base sm:text-lg break-words min-w-0 ${row.mono ? "font-mono tracking-tight" : ""}`}>
                            {row.value}
                          </div>
                          {row.copy && (
                            <CopyButton value={row.value} label="Copiar" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 sm:p-6 text-left space-y-2 max-w-2xl mx-auto">
                    <p className="text-sm sm:text-base text-sky-900 leading-relaxed">
                      <span className="inline-flex items-center gap-1.5 font-black uppercase tracking-wider text-xs sm:text-sm text-sky-700 mb-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Recomendado
                      </span>
                      <strong className="font-bold block">Preferencialmente, utilize ACH Transfer para realizar o pagamento.</strong>
                    </p>
                    <p className="text-xs sm:text-sm text-sky-800/90 leading-relaxed">
                      Transferências ACH são processadas em dólares americanos diretamente entre contas bancárias dos EUA, com tarifas menores e liberação mais rápida.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6 text-left space-y-2 max-w-2xl mx-auto">
                    <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                      <strong className="font-bold">Após efetuar o depósito/transferência:</strong> retorne a esta página e clique em <strong className="underline">Finalizar matrícula</strong> abaixo.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 w-full max-w-2xl mx-auto">
                    <button
                      onClick={() => { setPaymentTab("menu"); scrollToTop(); }}
                      className="order-1 sm:order-1 w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-8 sm:min-w-[200px] py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition justify-center flex items-center text-sm sm:text-base truncate sm:justify-self-start"
                    >
                      Voltar
                    </button>
                    <button
                      disabled={contractFinalizing}
                      onClick={finalizarMatriculaStep9}
                      className="order-2 sm:order-2 w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-10 sm:min-w-[260px] py-3.5 bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate sm:justify-self-end"
                    >
                      {contractFinalizing ? "Finalizando matrícula…" : "Finalizar matrícula"}
                    </button>
                  </div>
                </>
              )}

              {paymentTab === "pix" && (
                <>
                  <div className="flex items-center justify-center gap-3 w-full max-w-2xl mx-auto">
                    <button
                      onClick={() => { setPaymentTab("menu"); scrollToTop(); }}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold transition"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                      Voltar
                    </button>
                    <div className="text-xs sm:text-sm text-slate-500">PIX</div>
                  </div>

                  <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-700 flex items-center justify-center">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">Pagamento por PIX</h2>
                    <div className="mt-6 mx-auto w-full max-w-2xl rounded-3xl border-2 border-emerald-200 bg-emerald-50 px-4 sm:px-7 py-4 sm:py-6 text-center">
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-300/60 px-3 sm:px-4 py-1.5 mb-3 sm:mb-5">
                        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-700" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-emerald-800">
                          Cotação fixa · Ago/2026
                        </span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-stretch sm:justify-stretch gap-3 sm:gap-5">
                        <div className="flex-1 rounded-2xl bg-white/70 border border-emerald-200/60 px-5 sm:px-7 py-3 sm:py-5 flex flex-col items-center sm:items-start sm:text-left justify-center gap-1 sm:gap-1.5 min-w-0">
                          <div className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-emerald-700/90">
                            Câmbio utilizado
                          </div>
                          <div className="text-lg sm:text-2xl font-black text-slate-800 leading-none whitespace-nowrap overflow-hidden text-ellipsis w-full">
                            US$ 1,00 = R$ 5,00
                          </div>
                        </div>
                        <div className="hidden sm:flex self-stretch w-px bg-emerald-300/70" />
                        <div className="sm:hidden flex justify-center">
                          <div className="h-px w-16 bg-emerald-300/70" />
                        </div>
                        <div className="flex-1 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-md shadow-emerald-300/40 px-5 sm:px-8 py-3.5 sm:py-5 text-white flex flex-col items-center sm:items-end sm:text-right justify-center gap-1 sm:gap-1.5 min-w-0">
                          <div className="text-[10px] sm:text-xs font-black uppercase tracking-[0.14em] text-emerald-50/90">
                            Total a pagar
                          </div>
                          <div className="text-2xl sm:text-4xl font-black tracking-tight leading-none whitespace-nowrap overflow-hidden text-ellipsis w-full">
                            R$ 595,00
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl mx-auto w-full">
                    <div className="rounded-3xl border-2 border-emerald-200 bg-white p-5 sm:p-6 flex flex-col items-center text-center shadow-sm">
                      <div className="text-sm font-bold uppercase tracking-wider text-emerald-800 mb-3">QR Code</div>
                      <div className="w-full aspect-square max-w-[280px] rounded-2xl bg-white border-2 border-emerald-100 p-3 flex items-center justify-center mx-auto overflow-hidden">
                        <img
                          src="/qr-code-2.jpeg"
                          alt="QR Code PIX"
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="text-xs sm:text-sm text-slate-500 mt-3 leading-relaxed">
                        Abra o app do seu banco e escaneie o QR Code ao lado.
                      </div>
                    </div>

                    <div className="rounded-3xl border-2 border-emerald-200 bg-white p-5 sm:p-6 flex flex-col shadow-sm">
                      <div className="text-sm font-bold uppercase tracking-wider text-emerald-800 mb-3">PIX Copia e Cola</div>
                      <div className="w-full rounded-2xl bg-slate-50 border border-slate-200 p-3 sm:p-4 break-all font-mono text-[11px] sm:text-xs leading-relaxed text-slate-800 select-all">
                        00020126360014br.gov.bcb.pix0114+55659998511425204000053039865406500.005802BR5920Loivo de Brum Castro6009SAO PAULO62070503***63043407
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            const code = "00020126360014br.gov.bcb.pix0114+55659998511425204000053039865406500.005802BR5920Loivo de Brum Castro6009SAO PAULO62070503***63043407";
                            if (navigator?.clipboard?.writeText) {
                              await navigator.clipboard.writeText(code);
                            }
                            setPixCopied(true);
                            window.setTimeout(() => setPixCopied(false), 3000);
                          } catch {}
                        }}
                        className="mt-4 inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-5 py-3 bg-emerald-600 text-white font-bold text-sm sm:text-base hover:bg-emerald-700 active:scale-[0.98] transition w-full shadow-md shadow-emerald-200"
                      >
                        {pixCopied ? (
                          <>
                            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Código copiado!
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            Copiar código PIX
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 sm:p-6 text-left space-y-2 max-w-2xl mx-auto">
                    <p className="text-sm sm:text-base text-emerald-900 leading-relaxed">
                      <strong className="font-bold">Após efetuar o pagamento PIX:</strong> retorne a esta página e clique em <strong className="underline">Finalizar matrícula</strong> abaixo.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 w-full max-w-2xl mx-auto">
                    <button
                      onClick={() => { setPaymentTab("menu"); scrollToTop(); }}
                      className="order-1 sm:order-1 w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-8 sm:min-w-[200px] py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition justify-center flex items-center text-sm sm:text-base truncate sm:justify-self-start"
                    >
                      Voltar
                    </button>
                    <button
                      disabled={contractFinalizing}
                      onClick={finalizarMatriculaStep9}
                      className="order-2 sm:order-2 w-full shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-10 sm:min-w-[260px] py-3.5 bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate sm:justify-self-end"
                    >
                      {contractFinalizing ? "Finalizando matrícula…" : "Finalizar matrícula"}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {step === 6 && submitResult && (
            <section className="space-y-7 text-center">
              <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900">Estamos verificando o seu pagamento! 🤝</h2>
                <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
                  Você receberá uma notificação pelo WhatsApp em até 24 horas, assim que o pagamento for confirmado. Até a confirmação, seus dados de matrícula permanecerão registrados como pré-aprovados.
                </p>
                <p className="mt-4 text-base text-slate-500">
                  Aulas todas as <strong>{submitResult.weekdayLabel}</strong> às <strong>{submitResult.leadTime}</strong>.
                </p>
                {enrollmentNumber && (
                  <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-sky-500/35 bg-sky-500/15 px-4 py-2 text-sm font-semibold text-sky-700">
                    <span>N° da matrícula:</span>
                    <span className="font-black tracking-tight">{enrollmentNumber}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          if (navigator?.clipboard?.writeText) {
                            await navigator.clipboard.writeText(enrollmentNumber);
                          } else {
                            const ta = document.createElement("textarea");
                            ta.value = enrollmentNumber;
                            ta.style.position = "fixed";
                            ta.style.opacity = "0";
                            document.body.appendChild(ta);
                            ta.select();
                            try { document.execCommand("copy"); } catch {}
                            document.body.removeChild(ta);
                          }
                        } catch {}
                      }}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold border border-sky-500/40 bg-white hover:bg-sky-50 text-sky-700 transition"
                    >
                      Copiar
                    </button>
                  </div>
                )}
                {contractSignedAt && (
                  <p className="mt-2 text-sm text-slate-500">
                    Formalizado em: {new Date(contractSignedAt).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>

              <div className="rounded-3xl bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-50 border border-emerald-100 p-8 max-w-2xl mx-auto space-y-5">
                <div className="text-left">
                  <div className="text-2xl font-bold text-slate-900">📄 Confirmação de Matrícula</div>
                  <p className="mt-1 text-slate-600">
                    Clique abaixo para baixar sua confirmação completa em PDF.
                  </p>
                </div>
                {contractPdfUrl ? (
                  <a
                    href={contractPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-5 sm:px-8 py-3.5 sm:py-4 bg-emerald-600 text-white font-bold text-sm sm:text-lg shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition w-full min-w-0"
                  >
                    <svg className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Baixar confirmação em PDF
                  </a>
                ) : (
                  <div className="rounded-2xl bg-white border border-slate-200 p-5 text-slate-600">
                    Link do PDF sendo preparado… Se não aparecer, recarregue a página.
                  </div>
                )}
              </div>

              <div className="pt-2 max-w-2xl mx-auto text-center text-sm text-slate-500">
                <p>Qualquer dúvida, entre em contato pelo WhatsApp <a href="https://wa.me/5565996933336" target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-700 hover:text-indigo-600 transition-colors">(65) 9 9693-3336</a>.</p>
              </div>
            </section>
          )}
        </div>

        <footer className="mt-10 text-center text-sm text-slate-500">
          © {new Date().getFullYear()} Lucas Brum Online Music USA. Todos os direitos reservados.
        </footer>
      </div>
    </main>
  );
}
