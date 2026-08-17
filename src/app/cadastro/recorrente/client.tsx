"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { inferCountry } from "../../../lib/atendimento/experimentalClass";
import { resolveStudentTimezone } from "../../../lib/timezone";

type RecurringWeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

type RecurringWeekdayOption = {
  id: RecurringWeekdayKey;
  weekday: RecurringWeekdayKey;
  label: string;
  shortLabel: string;
  displayLabel: string;
  slotCount: number;
};

type RecurringWeekdayTimeOption = {
  id: string;
  weekday: RecurringWeekdayKey;
  professorTime: string;
  leadTime: string;
  displayLabel: string;
};

type AvailabilityResponse = {
  ok: boolean;
  dates: RecurringWeekdayOption[];
  slotsByWeekday: Record<RecurringWeekdayKey, RecurringWeekdayTimeOption[]>;
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

  function formatCpf(v: string | null | undefined): string {
    const d = digitsOnly(v).slice(0, 11);
    if (!d) return "";
    let out = d.slice(0, 3);
    if (d.length > 3) out += "." + d.slice(3, 6);
    if (d.length > 6) out += "." + d.slice(6, 9);
    if (d.length > 9) out += "-" + d.slice(9, 11);
    return out;
  }

  function formatPhoneMasked(v: string | null | undefined): string {
    const d = digitsOnly(v).slice(0, 13);
    if (!d) return "";
    if (d.length <= 10) {
      // (##) ####-####
      let out = "(" + d.slice(0, 2);
      if (d.length > 2) out += ") " + d.slice(2, 6);
      if (d.length > 6) out += "-" + d.slice(6, 10);
      return out;
    }
    if (d.length <= 11) {
      // (##) #####-####
      return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
    }
    // +## (##) #####-####
    return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9, 13)}`;
  }

  function formatFieldValue(name: string, raw: string | null | undefined): string {
    if (name === "cpf" || name === "legal_responsible_cpf") return formatCpf(raw);
    if (name === "phone") return formatPhoneMasked(raw);
    return String(raw ?? "");
  }

  function unformatFieldValue(name: string, val: string | null | undefined): string {
    const s = String(val ?? "").trim();
    if (!s) return "";
    if (name === "cpf" || name === "legal_responsible_cpf") return digitsOnly(s);
    if (name === "phone") return digitsOnly(s);
    return s;
  }

  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12>(0);
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
  const [selectedWeekday, setSelectedWeekday] = useState<RecurringWeekdayKey | null>(null);
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
  const [contractCurrentFieldIdx, setContractCurrentFieldIdx] = useState<number>(0);
  const [contractCurrentValue, setContractCurrentValue] = useState<string>("");
  const [contractFieldError, setContractFieldError] = useState<string>("");
  const [contractFieldSaving, setContractFieldSaving] = useState<boolean>(false);
  const [contractFinalizing, setContractFinalizing] = useState<boolean>(false);
  const [contractFinalError, setContractFinalError] = useState<string>("");
  const [contractPdfUrl, setContractPdfUrl] = useState<string>("");
  const [contractSignedAt, setContractSignedAt] = useState<string>("");
  const [paymentTab, setPaymentTab] = useState<"menu" | "link" | "deposit" | "pix">("menu");
  const [pixCopied, setPixCopied] = useState<boolean>(false);
  const lastLoadedContractFieldKey = useRef<string>("__none__");

  useEffect(() => {
    if (!submitResult) return;
    if (!(step >= 4 && step <= 9)) return;
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
        const fieldOrderMap: Record<ContractFieldMeta["name"], number> = {
          full_name: 0, cpf: 1, phone: 2, legal_responsible_name: 3, legal_responsible_cpf: 4,
        };
        let startIdx = 0;
        if (step >= 4 && step <= 8) {
          startIdx = step - 4;
        } else {
          startIdx = json.nextField && typeof fieldOrderMap[json.nextField] === "number"
            ? fieldOrderMap[json.nextField]
            : 0;
        }
        setContractCurrentFieldIdx(startIdx);
        const allF = json.allFields || [];
        const initialMeta = allF[startIdx] ?? allF[0];
        let preVal = "";
        if (initialMeta && typeof initialMeta.currentValue === "string" && initialMeta.currentValue.trim()) {
          preVal = String(initialMeta.currentValue).trim();
        } else if (initialMeta) {
          preVal = (json.snapshot || contractSnapshot)[initialMeta.name] ??
            initialMeta.currentValue ??
            lastSavedFieldValues[initialMeta.name] ??
            "";
        }
        setContractCurrentValue(
          formatFieldValue(initialMeta?.name ?? "full_name", typeof preVal === "string" ? preVal.trim() : "")
        );
      } catch (e) {
        setContractInitError(toErrorMessage(e, "Erro ao carregar."));
      } finally {
        setContractInitLoading(false);
      }
    })();
  }, [step, submitResult, phoneField, submitLeadId, contractAllFields.length, contractSnapshot, lastSavedFieldValues]);

  useEffect(() => {
    if (contractAllFields.length === 0) return;
    if (!(step >= 4 && step <= 8)) return;
    const fieldIdxByStep: Record<4 | 5 | 6 | 7 | 8, number> = { 4: 0, 5: 1, 6: 2, 7: 3, 8: 4 };
    const targetIdx = fieldIdxByStep[step as 4 | 5 | 6 | 7 | 8];
    const targetMeta = contractAllFields[targetIdx];
    if (targetMeta) {
      setContractCurrentFieldIdx(targetIdx);
      let pre = "";
      const snapShot = (contractSnapshot || {}) as Record<string, string | null>;
      const lastSaved = (lastSavedFieldValues || {}) as Record<string, string | null>;
      if (typeof targetMeta.currentValue === "string" && targetMeta.currentValue.trim()) {
        pre = String(targetMeta.currentValue).trim();
      } else if (snapShot[targetMeta.name] != null && String(snapShot[targetMeta.name] ?? "").trim()) {
        pre = String(snapShot[targetMeta.name] ?? "").trim();
      } else if (lastSaved[targetMeta.name] != null && String(lastSaved[targetMeta.name] ?? "").trim()) {
        pre = String(lastSaved[targetMeta.name] ?? "").trim();
      }
      setContractCurrentValue(formatFieldValue(targetMeta.name, pre));
    }
  }, [step, contractAllFields, contractSnapshot, lastSavedFieldValues]);

  function contractFieldForStep(
    s: 4 | 5 | 6 | 7 | 8,
  ): { stepLabel: string; stepIdx: number } {
    const map: Record<4 | 5 | 6 | 7 | 8, { stepLabel: string; stepIdx: number }> = {
      4: { stepLabel: "Nome completo", stepIdx: 0 },
      5: { stepLabel: "CPF", stepIdx: 1 },
      6: { stepLabel: "Telefone/WhatsApp", stepIdx: 2 },
      7: { stepLabel: "Responsável (opcional)", stepIdx: 3 },
      8: { stepLabel: "CPF resp. legal (opcional)", stepIdx: 4 },
    };
    return map[s];
  }

  async function contractAdvanceField(skip = false) {
    if (step < 4 || step > 8) return;
    const tel = phoneField.replace(/\D/g, "").trim();
    if (contractFieldSaving) return;
    const fieldIdxByStep: Record<4 | 5 | 6 | 7 | 8, number> = { 4: 0, 5: 1, 6: 2, 7: 3, 8: 4 };
    const expectedIdx = fieldIdxByStep[step as 4 | 5 | 6 | 7 | 8];
    const currentMeta = contractAllFields[expectedIdx] ?? contractAllFields[contractCurrentFieldIdx];
    if (!currentMeta) return;
    if (!skip && !contractCurrentValue.trim() && !currentMeta.optional) {
      setContractFieldError("Campo obrigatório.");
      return;
    }
    setContractFieldSaving(true);
    setContractFieldError("");
    try {
      const payloadValue = skip
        ? ""
        : unformatFieldValue(currentMeta.name, contractCurrentValue);
      const res = await fetch("/api/cadastro/recorrente/contract-field-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone: tel,
          leadId: contractLeadId || submitLeadId || undefined,
          field: currentMeta.name,
          value: payloadValue,
          skip,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            code?: string;
            snapshot?: Record<ContractFieldMeta["name"], string | null>;
            nextField?: ContractFieldMeta["name"] | null;
            allFields?: ContractFieldMeta[];
            skipped?: boolean;
            savedField?: ContractFieldMeta["name"];
            savedValue?: string | null;
          }
        | null;
      if (!res.ok || !json?.ok) {
        setContractFieldError(toErrorMessage(json?.error, "Falha ao salvar. Tente novamente."));
        return;
      }
      setContractSnapshot(json.snapshot || contractSnapshot);
      setLastSavedFieldValues((prev) => {
        let next: any = { ...prev };
        next[currentMeta.name] = json.savedValue ?? (json.snapshot ?? contractSnapshot)[currentMeta.name];
        if (step === 7 && skip) {
          next.legal_responsible_name = "";
          next.legal_responsible_cpf = "";
        }
        return next;
      });
      setContractAllFields(json.allFields || contractAllFields);
      let nextStepBase: 5 | 6 | 7 | 8 | 9 =
        step === 4 ? 5 : step === 5 ? 6 : step === 6 ? 7 : step === 7 ? 8 : 9;
      let nextStep: 5 | 6 | 7 | 8 | 9 = nextStepBase;
      if (step === 7 && skip) nextStep = 9;
      if (nextStep === 9) {
        setContractCurrentValue("");
        goStep(9);
        return;
      }
      const nextFieldIdx = nextStep - 4;
      setContractCurrentFieldIdx(nextFieldIdx);
      const nextMeta = (json.allFields || contractAllFields)[nextFieldIdx];
      if (nextMeta) {
        let pre = "";
        if (json.allFields && typeof json.allFields[nextFieldIdx]?.currentValue === "string" && json.allFields[nextFieldIdx].currentValue.trim()) {
          pre = String(json.allFields[nextFieldIdx].currentValue).trim();
        } else {
          pre = (json.snapshot || contractSnapshot)[nextMeta.name] ??
            nextMeta.currentValue ??
            lastSavedFieldValues[nextMeta.name] ??
            "";
        }
        setContractCurrentValue(formatFieldValue(nextMeta.name, typeof pre === "string" ? pre.trim() : ""));
      } else {
        setContractCurrentValue("");
      }
      goStep(nextStep);
    } finally {
      setContractFieldSaving(false);
    }
  }

  async function contractBackField() {
    if (step < 4 || step > 8) return;
    const backTargetStep = Math.max(0, (step as number) - 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    if (!(step >= 4 && step <= 8) || backTargetStep < 4) {
      goStep(backTargetStep);
      return;
    }
    const tel = phoneField.replace(/\D/g, "").trim();
    if (contractFieldSaving) return;
    const fieldIdxByStep: Record<4 | 5 | 6 | 7 | 8, number> = { 4: 0, 5: 1, 6: 2, 7: 3, 8: 4 };
    const expectedIdx = fieldIdxByStep[step as 4 | 5 | 6 | 7 | 8];
    const currentMeta = contractAllFields[expectedIdx] ?? contractAllFields[contractCurrentFieldIdx];
    let needSave = !!currentMeta && contractCurrentValue.trim().length > 0;
    if (currentMeta && contractCurrentValue.trim()) {
      const snapshotVal =
        (contractSnapshot && typeof contractSnapshot[currentMeta.name] === "string"
          ? String(contractSnapshot[currentMeta.name])
          : "") ||
        (lastSavedFieldValues && typeof lastSavedFieldValues[currentMeta.name] === "string"
          ? String(lastSavedFieldValues[currentMeta.name])
          : "") ||
        "";
      const formattedSnapshot = formatFieldValue(currentMeta.name, snapshotVal.trim());
      if (formattedSnapshot.trim() === contractCurrentValue.trim() || unformatFieldValue(currentMeta.name, formattedSnapshot) === unformatFieldValue(currentMeta.name, contractCurrentValue)) {
        needSave = false;
      }
    }
    let latestSnapshotFromSave: Record<ContractFieldMeta["name"], string | null> | null = null;
    let latestAllFieldsFromSave: ContractFieldMeta[] | null = null;
    if (needSave && currentMeta) {
      setContractFieldSaving(true);
      setContractFieldError("");
      try {
        const payloadValue = unformatFieldValue(currentMeta.name, contractCurrentValue);
        const res = await fetch("/api/cadastro/recorrente/contract-field-submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telefone: tel,
            leadId: contractLeadId || submitLeadId || undefined,
            field: currentMeta.name,
            value: payloadValue,
            skip: false,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              error?: string;
              code?: string;
              snapshot?: Record<ContractFieldMeta["name"], string | null>;
              nextField?: ContractFieldMeta["name"] | null;
              allFields?: ContractFieldMeta[];
              savedField?: ContractFieldMeta["name"];
              savedValue?: string | null;
            }
          | null;
        if (res.ok && json?.ok) {
          latestSnapshotFromSave = json.snapshot || null;
          latestAllFieldsFromSave = json.allFields || null;
          setContractSnapshot(json.snapshot || contractSnapshot);
          setLastSavedFieldValues((prev) => {
            let next: any = { ...prev };
            next[currentMeta.name] = json.savedValue ?? (json.snapshot ?? contractSnapshot)[currentMeta.name];
            return next;
          });
          setContractAllFields(json.allFields || contractAllFields);
        }
      } catch {}
      setContractFieldSaving(false);
    }
    const backStepAsContractStep = backTargetStep as 4 | 5 | 6 | 7 | 8;
    const backTargetIdx = fieldIdxByStep[backStepAsContractStep];
    const fallbackAllFields = latestAllFieldsFromSave && latestAllFieldsFromSave.length > 0
      ? latestAllFieldsFromSave
      : contractAllFields;
    const backMeta = fallbackAllFields[backTargetIdx];
    if (backMeta) {
      let pre = "";
      const snapShotLocal = latestSnapshotFromSave || contractSnapshot || {} as any;
      const lastSavedLocal = lastSavedFieldValues || {} as any;
      if (latestAllFieldsFromSave && typeof latestAllFieldsFromSave[backTargetIdx]?.currentValue === "string" && latestAllFieldsFromSave[backTargetIdx].currentValue.trim()) {
        pre = String(latestAllFieldsFromSave[backTargetIdx].currentValue).trim();
      } else if (snapShotLocal && snapShotLocal[backMeta.name] != null && String(snapShotLocal[backMeta.name] ?? "").trim()) {
        pre = String(snapShotLocal[backMeta.name] ?? "").trim();
      } else if (lastSavedLocal && lastSavedLocal[backMeta.name] != null && String(lastSavedLocal[backMeta.name] ?? "").trim()) {
        pre = String(lastSavedLocal[backMeta.name] ?? "").trim();
      } else if (backMeta.currentValue && String(backMeta.currentValue).trim()) {
        pre = String(backMeta.currentValue).trim();
      }
      setContractCurrentFieldIdx(backTargetIdx);
      setContractCurrentValue(formatFieldValue(backMeta.name, pre));
    }
    goStep(backTargetStep);
  }

  async function saveDraftRecurring(payload: {
    weekday?: RecurringWeekdayKey | null;
    weekdayLabel?: string | null;
    professorTime?: string | null;
    leadTime?: string | null;
    step?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | null;
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
            leadId?: string;
          }
        | null;
      if (!res.ok || !json?.ok) {
        throw new Error(toErrorMessage(json?.error, "Falha ao gerar o contrato. Tente novamente."));
      }
      setContractPdfUrl(String(json.contract_pdf_url || ""));
      setContractSignedAt(String(json.contract_signed_at || new Date().toISOString()));
      goStep(10);
    } catch (e) {
      setContractFinalError(toErrorMessage(e, "Erro ao gerar o contrato."));
    } finally {
      setContractFinalizing(false);
    }
  }

  function goStep(n: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12) {
    setStep(n);
    if (n === 10) setPaymentTab("menu");
    setSubmitError("");
    setContractFieldError("");
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

  async function finalizarMatriculaStep9() {
    if (contractFinalizing) return;
    setContractFinalizing(true);
    await new Promise<void>((r) => setTimeout(r, 700));
    goStep(11);
    setTimeout(() => setContractFinalizing(false), 250);
  }

  useEffect(() => {
    if (step === 10) setPaymentTab("menu");
    if (step === 8) {
      const legalName =
        typeof contractSnapshot?.legal_responsible_name === "string"
          ? contractSnapshot.legal_responsible_name
          : typeof lastSavedFieldValues?.legal_responsible_name === "string"
          ? lastSavedFieldValues.legal_responsible_name
          : "";
      if (!String(legalName ?? "").trim()) {
        goStep(9);
      }
    }
  }, [step]);

  useEffect(() => {
    if (step < 4 || step > 8) return;
    if (!contractAllFields.length) return;
    const fieldIdxByStep: Record<4 | 5 | 6 | 7 | 8, number> = { 4: 0, 5: 1, 6: 2, 7: 3, 8: 4 };
    const expectedIdx = fieldIdxByStep[step as 4 | 5 | 6 | 7 | 8];
    const target = contractAllFields[expectedIdx];
    if (!target) return;
    const key = `${step}:${target.name}`;
    if (lastLoadedContractFieldKey.current === key) return;
    lastLoadedContractFieldKey.current = key;
    const preferred =
      lastSavedFieldValues[target.name] ?? target.currentValue ?? contractSnapshot[target.name] ?? "";
    const next = formatFieldValue(target.name, typeof preferred === "string" ? preferred.trim() : "");
    setContractCurrentValue(next);
  }, [step, contractAllFields, lastSavedFieldValues, contractSnapshot]);

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
        let restoredCpf: string | null = null;
        let restoredLegalName: string | null = null;
        let restoredLegalCpf: string | null = null;
        let restoredState: string | null = null;
        let restoredCity: string | null = null;
        let savedCountry: string | null = null;
        let restoredTimezone: string | null = null;

        if (json?.ok && json?.lead) {
          restoredLeadFullName = String(json.lead?.full_name ?? "").trim();
          restoredLeadPhone = String(json.lead?.phone ?? "").replace(/\D/g, "").trim();
          restoredLeadId = String((json.lead as any)?.id ?? "").trim();
          restoredCpf = (json.lead as any)?.cpf ? String((json.lead as any).cpf) : null;
          restoredLegalName = (json.lead as any)?.legal_responsible_name ? String((json.lead as any).legal_responsible_name) : null;
          restoredLegalCpf = (json.lead as any)?.legal_responsible_cpf ? String((json.lead as any).legal_responsible_cpf) : null;
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
          if (restoredCpf) {
            setLastSavedFieldValues((prev) => ({ ...prev, cpf: restoredCpf! }));
            setContractSnapshot((prev) => ({ ...prev, cpf: restoredCpf! }));
          }
          if (normalizedLeadFullName) {
            setLastSavedFieldValues((prev) => ({ ...prev, full_name: normalizedLeadFullName! }));
            setContractSnapshot((prev) => ({ ...prev, full_name: normalizedLeadFullName! }));
          }
          if (restoredLeadPhone) {
            setLastSavedFieldValues((prev) => ({ ...prev, phone: restoredLeadPhone! }));
            setContractSnapshot((prev) => ({ ...prev, phone: restoredLeadPhone! }));
          }
          if (restoredLegalName) {
            setLastSavedFieldValues((prev) => ({ ...prev, legal_responsible_name: restoredLegalName! }));
            setContractSnapshot((prev) => ({ ...prev, legal_responsible_name: restoredLegalName! }));
          }
          if (restoredLegalCpf) {
            setLastSavedFieldValues((prev) => ({ ...prev, legal_responsible_cpf: restoredLegalCpf! }));
            setContractSnapshot((prev) => ({ ...prev, legal_responsible_cpf: restoredLegalCpf! }));
          }

          const restoredContractPdfUrl = typeof (json.lead as any)?.contract_pdf_url === "string" ? String((json.lead as any).contract_pdf_url).trim() : "";
          const restoredContractSignedAt = typeof (json.lead as any)?.contract_signed_at === "string" ? String((json.lead as any).contract_signed_at).trim() : "";
          if (restoredContractPdfUrl) {
            setContractPdfUrl(restoredContractPdfUrl);
          }
          if (restoredContractSignedAt) {
            setContractSignedAt(restoredContractSignedAt);
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
          const tzToUse = resolvedTz || restoredTimezone || browserTz || null;
          const badTz =
            !restoredTimezone || restoredTimezone === "America/Cuiaba";
          if ((!savedCountry || (hasLoc && badTz)) && (hasLoc || tzToUse)) {
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

        let stepNum: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 = 0;
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
            typeof prog.step === "number" && prog.step >= 0 && prog.step <= 12
              ? (prog.step as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12)
              : 0;
          hasPassword = Boolean(prog.has_password);
          savedWeekdayRaw = String(prog.recurring_class_weekday ?? "").trim().toLowerCase();
          savedWeekdayLabel = String(prog.recurring_class_weekday_label ?? "").trim();
          savedProfessorTime = String(prog.recurring_class_professor_time ?? "").trim();
          savedLeadTime = String(prog.recurring_class_lead_time ?? "").trim();

          if (savedWeekdayRaw) {
            const isWd = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(savedWeekdayRaw);
            if (isWd) {
              resolvedWeekday = savedWeekdayRaw as RecurringWeekdayKey;
              setSelectedWeekday(resolvedWeekday);
            }
          }
          if (hasPassword) {
            setHasPasswordInitial(true);
            if (stepNum >= 1) setSenha("••••••••");
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
                  const w = resolvedWeekday;
                  const arr = w ? j?.slotsByWeekday?.[w] ?? [] : [];
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
                      const lbl = savedWeekdayLabel || w || "";
                      const leadT = targetLeadT || targetTime;
                      setSubmitResult({
                        weekday: w || "fri",
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
    if (!availability?.slotsByWeekday || !selectedWeekday) return [];
    const arr = availability.slotsByWeekday[selectedWeekday];
    return Array.isArray(arr) ? arr : [];
  }, [availability, selectedWeekday]);

  const selectedWeekdayLabel = useMemo(() => {
    const opt = availableWeekdays.find((d) => d.weekday === selectedWeekday);
    return opt?.displayLabel || opt?.label || "";
  }, [availableWeekdays, selectedWeekday]);

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
        const tz = tzFromLoc || leadTimezone || browserTz || null;
        const inferredCountry = tz || st || ct ? inferCountry(st, ct, tz || null) : null;
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
    if (!selectedWeekday) return;
    (async () => {
      setDraftSaving("weekday");
      try {
        const opt = availableWeekdays.find((d) => d.weekday === selectedWeekday);
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
    if (!selectedWeekday || !selectedTimeOpt) return;
    setSubmitLoading(true);
    setSubmitError("");
    try {
      setDraftSaving("time");
      try {
        const opt = availableWeekdays.find((d) => d.weekday === selectedWeekday);
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
                { key: 4, label: "Nome", shortLabel: "Nome" },
                { key: 5, label: "CPF", shortLabel: "CPF" },
                { key: 6, label: "Telefone", shortLabel: "Tel" },
                { key: 7, label: "Resp. Legal", shortLabel: "Resp" },
                { key: 8, label: "CPF Resp.", shortLabel: "CPF-R" },
                { key: 9, label: "Revisão", shortLabel: "Rev" },
                { key: 10, label: "Pagamento", shortLabel: "Pag" },
                { key: 11, label: "Concluído", shortLabel: "Fim" },
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
                        width: `${step === 0 ? 8 : step === 1 ? 17 : step === 2 ? 25 : step === 3 ? 33 : step === 4 ? 42 : step === 5 ? 50 : step === 6 ? 58 : step === 7 ? 67 : step === 8 ? 75 : step === 9 ? 83 : step === 10 ? 92 : 100}%`,
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {availableWeekdays.map((day) => {
                    const selected = selectedWeekday === day.weekday;
                    return (
                      <button
                        key={day.id}
                        onClick={() => setSelectedWeekday(day.weekday)}
                        className={
                          "text-left rounded-2xl border p-5 transition focus:outline-none " +
                          (selected
                            ? "border-indigo-500 bg-indigo-50 ring-4 ring-indigo-100 shadow-md"
                            : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50")
                        }
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xl font-bold text-slate-900">{day.displayLabel}</div>
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
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 w-full">
                <button
                  onClick={handleAdvance2}
                  disabled={!selectedWeekday}
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
            <section className="space-y-7 mb-10">
              <div className="text-center">
                <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                  <svg
                    className="w-10 h-10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="mt-5 text-3xl font-extrabold text-slate-900">Tudo certo, {firstName}! 🎉</h2>
                <p className="mt-3 text-lg text-slate-600 leading-snug">Sua aula recorrente foi reservada.</p>
              </div>

              <div className="max-w-2xl mx-auto">
                <div className="rounded-3xl bg-white border border-slate-200 shadow-[0_8px_30px_-16px_rgba(15,23,42,0.18)] overflow-hidden">
                  <div className="bg-gradient-to-r from-indigo-600 via-indigo-500 to-sky-500 px-6 sm:px-8 py-5 sm:py-6 flex items-center gap-3 sm:gap-4">
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center text-white flex-shrink-0">
                      <svg className="w-5.5 h-5.5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.2em] sm:tracking-[0.22em] text-white/85">Agendamento confirmado</div>
                      <div className="text-white text-[17px] sm:text-[19px] font-extrabold leading-snug mt-1 break-words">
                        Sua vaga está garantida ✨
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y divide-slate-100 sm:divide-y-0 sm:divide-x sm:divide-slate-100">
                    <div className="px-5 sm:px-6 py-5 sm:py-7 flex items-start sm:items-center gap-3 sm:gap-4 sm:gap-4.5">
                      <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5 sm:pt-0">
                        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.16em] sm:tracking-[0.18em] text-slate-500 whitespace-nowrap truncate">Dia da aula</div>
                        <div className="mt-2 text-[clamp(18px,4.4vw,26px)] sm:text-[26px] font-extrabold text-slate-900 leading-none whitespace-nowrap truncate">{submitResult.weekdayLabel}</div>
                      </div>
                    </div>
                    <div className="px-5 sm:px-6 py-5 sm:py-7 flex items-start sm:items-center gap-3 sm:gap-4 sm:gap-4.5">
                      <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5 sm:pt-0">
                        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.16em] sm:tracking-[0.18em] text-slate-500 whitespace-nowrap truncate">Horário fixo</div>
                        <div className="mt-2 text-[clamp(18px,4.4vw,26px)] sm:text-[26px] font-extrabold text-slate-900 tabular-nums leading-none whitespace-nowrap truncate">{submitResult.leadTime}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="max-w-2xl mx-auto mt-7">
                <p className="text-center text-base text-slate-500 leading-relaxed">Agora vamos <strong className="font-bold text-slate-700">formalizar o contrato</strong>. Responda uma pergunta por vez.</p>
              </div>
            </section>
          )}

          {step >= 4 && step <= 8 && submitResult && (
            <section className="space-y-7">

              {(contractInitLoading || contractAllFields.length === 0) && !contractInitError && (
                <div className="py-14 text-center text-slate-500">
                  {contractInitLoading ? "Preparando suas informações…" : "Carregando seus dados…"}
                </div>
              )}
              {contractInitError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">{toErrorMessage(contractInitError, "Erro desconhecido.")}</div>
              )}

              {!contractInitLoading && !contractInitError && contractAllFields.length > 0 && contractCurrentFieldIdx >= 0 && (
                <div className="max-w-2xl mx-auto space-y-6">
                  {(() => {
                    const fieldIdxByStep: Record<4 | 5 | 6 | 7 | 8, number> = { 4: 0, 5: 1, 6: 2, 7: 3, 8: 4 };
                    const expectedIdx = fieldIdxByStep[step as 4 | 5 | 6 | 7 | 8];
                    const meta = contractAllFields[expectedIdx] ?? contractAllFields[contractCurrentFieldIdx];
                    if (!meta) return null;
                    const hasExisting = Boolean(meta.currentValue);
                    return (
                      <div className="space-y-7">
                        <div className="space-y-1">
                          <h2 className="text-2xl font-bold text-slate-900">
                            {(() => {
                              const useO = meta.name === "legal_responsible_name" || meta.name === "legal_responsible_cpf";
                              const keepCase = meta.name === "cpf" || meta.name === "legal_responsible_cpf";
                              const verb = hasExisting ? "Confirme" : "Informe";
                              const pronoun = useO ? "o" : "seu";
                              const label =
                                meta.name === "phone"
                                  ? "WhatsApp"
                                  : meta.name === "legal_responsible_cpf"
                                  ? "CPF do responsável"
                                  : keepCase
                                  ? meta.label
                                  : meta.label.toLowerCase();
                              return `${verb} ${pronoun} ${label}`;
                            })()}
                          </h2>
                          <p className="text-slate-600">
                            {meta.optional ? (
                              <>
                                <strong>Campo opcional</strong>. Você pode pular se preferir.
                              </>
                            ) : (
                              "Campo obrigatório."
                            )}
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-slate-800 mb-2">
                            {meta.label}
                            {meta.optional ? " (opcional)" : ""}
                          </label>
                          <input
                            type="text"
                            value={contractCurrentValue}
                            onChange={(e) => setContractCurrentValue(formatFieldValue(meta.name, e.target.value))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void contractAdvanceField(false);
                              }
                            }}
                            disabled={contractFieldSaving}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition disabled:opacity-60 disabled:cursor-not-allowed text-base"
                            placeholder={
                              meta.name === "full_name"
                                ? "Ex: Ana Maria Silva"
                                : meta.name === "cpf"
                                ? "Ex: 123.456.789-09"
                                : meta.name === "phone"
                                ? "Ex: (65) 99999-9999"
                                : meta.name === "legal_responsible_name"
                                ? "Ex: José Carlos Silva (opcional)"
                                : "Ex: 123.456.789-09 (opcional)"
                            }
                          />
                          {contractFieldError && (
                            <div className="mt-3 text-sm text-red-700 rounded-xl bg-red-50 border border-red-200 p-3">{toErrorMessage(contractFieldError, "Erro desconhecido.")}</div>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:flex sm:flex-row sm:items-start gap-3 pt-2 w-full">
                          {meta.optional && (
                            <button
                              onClick={() => void contractAdvanceField(true)}
                              disabled={contractFieldSaving}
                              className="order-1 sm:order-2 w-full sm:flex-1 shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-7 sm:min-w-[180px] py-3.5 bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate"
                            >
                              Pular
                            </button>
                          )}
                          <button
                            onClick={() => void contractBackField()}
                            disabled={contractFieldSaving}
                            className="order-2 sm:order-1 w-full sm:flex-1 shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-7 sm:min-w-[180px] py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate"
                          >
                            Voltar
                          </button>
                          <button
                            onClick={() => void contractAdvanceField(false)}
                            disabled={contractFieldSaving}
                            className="order-3 sm:order-3 w-full sm:flex-1 shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-5 sm:px-9 sm:min-w-[240px] py-3.5 bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate"
                          >
                            {contractFieldSaving ? "Salvando…" : hasExisting ? "Confirmar e avançar" : "Avançar"}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </section>
          )}

          {step === 9 && submitResult && (
            <section className="space-y-7">
              <div className="text-center">
                <div className="mx-auto w-20 h-20 rounded-full bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h2 className="mt-5 text-3xl font-extrabold text-slate-900">Revise seus dados</h2>
                <p className="mt-3 text-lg text-slate-600">
                  Confirme se as informações abaixo estão corretas para formalizar o contrato.
                </p>
              </div>
              {contractAllFields.length === 0 && (
                <div className="py-14 text-center text-slate-500">Carregando seus dados para revisão…</div>
              )}
              {contractAllFields.length > 0 && (
              <div className="rounded-3xl border border-slate-200 bg-white max-w-2xl mx-auto divide-y divide-slate-100">
                {contractAllFields.map((f, idx) => {
                  const raw =
                    lastSavedFieldValues[f.name] ?? f.currentValue ?? contractSnapshot[f.name] ?? null;
                  const rawVal = typeof raw === "string" ? raw.trim() : raw;
                  if ((!rawVal || rawVal === "") && f.optional) return null;
                  const digits = String(rawVal ?? "").replace(/\D/g, "");
                  let displayVal = rawVal ?? "— não informado —";
                  if ((f.name === "cpf" || f.name === "legal_responsible_cpf") && digits.length >= 11) {
                    displayVal = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
                  } else if (f.name === "phone") {
                    if (digits.length >= 13) {
                      displayVal = `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9, 13)}`;
                    } else if (digits.length === 11) {
                      displayVal = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
                    } else if (digits.length === 10) {
                      displayVal = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
                    }
                  }
                  return (
                    <div key={idx} className="px-6 py-4 grid grid-cols-1 sm:grid-cols-[minmax(140px,180px)_1fr] gap-3 sm:gap-5 items-start">
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 sm:text-right sm:pt-1">
                        {f.label}
                        {f.optional ? " (opcional)" : ""}
                      </div>
                      <div className="text-base font-semibold text-slate-900 break-words">
                        {displayVal}
                      </div>
                    </div>
                  );
                })}
              </div>
              )}

              {(() => {
                function fmtCPF(v: string | null): string {
                  const d = String(v ?? "").replace(/\D/g, "");
                  if (d.length < 11) return String(v ?? "___.___.___-__").trim() || "___.___.___-__";
                  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
                }
                function fmtPhone(v: string | null): string {
                  const d = String(v ?? "").replace(/\D/g, "");
                  if (d.length >= 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9, 13)}`;
                  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
                  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6, 10)}`;
                  return String(v ?? "(  ) _________").trim() || "(  ) _________";
                }
                function fmtCity(v: string | null): string | null {
                  const s = String(v ?? "").trim();
                  return s ? s : null;
                }
                function fmtSignedDate(iso: string): string {
                  const d = new Date(iso);
                  if (Number.isNaN(d.getTime())) return fmtSignedDate(new Date().toISOString());
                  const dia = String(d.getDate()).padStart(2, "0");
                  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
                  return `${dia} de ${meses[d.getMonth()] ?? ""} de ${String(d.getFullYear())}`;
                }
                const CONTRATADA_NOME = "INNOVALAND DESENVOLVIMENTO E PARTICIPAÇÕES LTDA";
                const CONTRATADA_CNPJ = "63.088.381/0001-22";
                const PROFESSOR_NOME = "Lucas Brum de Castro";

                const getFieldRaw = (name: "full_name" | "cpf" | "phone" | "legal_responsible_name" | "legal_responsible_cpf") => {
                  const f = contractAllFields.find((x) => x.name === name);
                  return (
                    lastSavedFieldValues[name] ??
                    f?.currentValue ??
                    contractSnapshot[name] ??
                    null
                  );
                };

                const studentFullName = String(getFieldRaw("full_name") ?? "ALUNO(A)").trim() || "ALUNO(A)";
                const studentCPF = fmtCPF(getFieldRaw("cpf"));
                const studentPhone = fmtPhone(getFieldRaw("phone"));
                const studentCity = fmtCity((contractSnapshot as any)?.city ?? null);
                const legalResponsibleNameRaw = String(getFieldRaw("legal_responsible_name") ?? "").trim() || null;
                const legalResponsibleCPFRaw = String(getFieldRaw("legal_responsible_cpf") ?? "").trim() || null;
                const hasLegalResponsible = Boolean(legalResponsibleNameRaw && legalResponsibleCPFRaw);
                const legalResponsibleName = hasLegalResponsible ? legalResponsibleNameRaw : null;
                const legalResponsibleCPF = hasLegalResponsible ? fmtCPF(legalResponsibleCPFRaw) : null;
                const signedAtIso = new Date().toISOString();
                const signedByLabel = hasLegalResponsible ? legalResponsibleName! : studentFullName;
                const signedByCPF = hasLegalResponsible ? fmtCPF(legalResponsibleCPFRaw) : fmtCPF(getFieldRaw("cpf"));
                const dataLocal = studentCity ? `${studentCity}, ${fmtSignedDate(signedAtIso)}.` : `${fmtSignedDate(signedAtIso)}.`;

                const p = "text-[13px] sm:text-[14px] leading-[1.6] text-justify mb-2 text-black/90";
                const h2 = "text-[15px] font-bold mb-2 mt-5 text-black";
                return (
                  <section className="max-w-2xl mx-auto mb-8">
                    <div className="text-center mb-6">
                      <h3 className="text-base sm:text-lg font-bold uppercase tracking-wide text-slate-800">
                        Prévia completa do contrato
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-500 mt-1">
                        Revise todo o conteúdo abaixo antes de formalizar. Este é o mesmo texto do PDF gerado após o aceite.
                      </p>
                    </div>
                    <article className="rounded-3xl border border-slate-200 bg-white shadow-[0_8px_30px_-16px_rgba(15,23,42,0.18)] p-6 sm:p-10 font-serif text-slate-900">
                      <h1 className="text-center text-[16px] sm:text-[18px] font-bold mb-5 leading-snug">
                        CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS
                        <br />
                        AULAS ONLINE DE MÚSICA
                      </h1>

                      <p className={p}>
                        <strong>CONTRATADA:</strong> {CONTRATADA_NOME}, inscrita no CNPJ nº {CONTRATADA_CNPJ}, responsável pela marca
                        Lucas Brum Online Music USA, representada pelo professor {PROFESSOR_NOME}.
                      </p>
                      <p className={p}><strong>Aluno(a):</strong> {studentFullName}</p>
                      <p className={p}><strong>CPF:</strong> {studentCPF}</p>
                      <p className={p}><strong>Telefone/WhatsApp:</strong> {studentPhone}</p>
                      {legalResponsibleName && (
                        <p className={p}><strong>Responsável legal, se menor:</strong> {legalResponsibleName}</p>
                      )}
                      {legalResponsibleCPF && (
                        <p className={p}><strong>CPF do responsável:</strong> {legalResponsibleCPF}</p>
                      )}

                      <h2 className={h2}>1. OBJETO</h2>
                      <p className={p}>
                        A CONTRATADA prestará ao(à) aluno(a) aulas individuais, online e ao vivo de música, em português,
                        ministradas pelo professor {PROFESSOR_NOME}, com conteúdo adequado ao nível, ao instrumento escolhido
                        e aos objetivos do(a) aluno(a).
                      </p>

                      <h2 className={h2}>2. PLANO, VALOR E PAGAMENTO</h2>
                      <p className={p}>
                        O plano compreende 1 (uma) aula por semana, com duração de 40 (quarenta) minutos, pelo valor mensal
                        de US$ 119,00 (cento e dezenove dólares). O pagamento será mensal e antecipado, por Stripe, Wise,
                        Pix, transferência ou outro meio informado pela CONTRATADA.
                      </p>

                      <h2 className={h2}>3. AGENDA, FALTAS E REPOSIÇÕES</h2>
                      <p className={p}>
                        As aulas ocorrerão em horário previamente combinado. A remarcação deverá ser solicitada com, no
                        mínimo, 24 (vinte e quatro) horas de antecedência. Faltas sem aviso prévio não geram reposição.
                        Problemas técnicos ou de internet que impeçam a aula poderão resultar em reagendamento, mediante
                        acordo entre as partes.
                      </p>

                      <h2 className={h2}>4. CANCELAMENTO</h2>
                      <p className={p}>
                        O contrato poderá ser cancelado a qualquer momento, sem multa. Os valores já pagos não serão
                        devolvidos proporcionalmente, pois o horário permanecerá reservado ao(à) aluno(a) durante o
                        respectivo ciclo mensal.
                      </p>

                      <h2 className={h2}>5. RESPONSABILIDADES DO(A) ALUNO(A)</h2>
                      <p className={p}>
                        O(A) aluno(a) deverá possuir o instrumento musical necessário às aulas, acesso à internet,
                        câmera, microfone e ambiente adequado. O desenvolvimento dependerá da frequência, dedicação
                        e prática individual, não havendo garantia de resultado específico.
                      </p>

                      <h2 className={h2}>6. MATERIAL DIDÁTICO</h2>
                      <p className={p}>
                        Os materiais fornecidos são de uso pessoal do(a) aluno(a) e não poderão ser vendidos,
                        publicados ou compartilhados sem autorização da CONTRATADA.
                      </p>

                      <h2 className={h2}>7. USO DE IMAGEM</h2>
                      <p className={p}>
                        O(A) aluno(a), ou seu responsável legal, autoriza gratuitamente o uso de imagens, vídeos e
                        trechos das aulas em que apareça para divulgação da Lucas Brum Online Music USA em redes
                        sociais, site e materiais institucionais. Caso não concorde, deverá informar a CONTRATADA
                        antes do início das aulas, e esta cláusula será retirada do contrato.
                      </p>

                      <h2 className={h2}>8. VIGÊNCIA E ACEITE</h2>
                      <p className={p}>
                        O contrato terá vigência inicial de 6 (seis) meses, com renovação automática, podendo ser
                        cancelado conforme a Cláusula 4. A assinatura eletrônica, o aceite por WhatsApp, formulário,
                        e-mail ou o primeiro pagamento confirmam a concordância com este contrato.
                      </p>

                      <h2 className={h2}>9. DISPOSIÇÕES FINAIS</h2>
                      <p className={p}>
                        Este contrato não gera vínculo empregatício. Eventuais alterações deverão ser acordadas entre
                        as partes. Fica eleito o foro da comarca de Campo Novo do Parecis/MT para resolver controvérsias,
                        ressalvadas as hipóteses legais de foro obrigatório.
                      </p>

                      <p className="mt-6 text-[13px] sm:text-[14px] leading-[1.6] mb-2">
                        Declaro que li, compreendi e concordo com as condições deste contrato.
                      </p>

                      <p className="mt-6 text-[13px] sm:text-[14px] leading-[1.6] text-left mb-2">{dataLocal}</p>

                      <div className="mt-14">
                        <div className="border-t border-black/80 w-[80%] mx-auto mb-2" />
                        <p className="text-center text-[12px] leading-snug">
                          <strong>CONTRATADA – Lucas Brum de Castro (professor representante)</strong>
                        </p>
                        <p className="text-center text-[12px] leading-snug mt-0.5">
                          {CONTRATADA_NOME} – CNPJ {CONTRATADA_CNPJ}
                        </p>
                      </div>

                      <div className="mt-10">
                        <div className="border-t border-black/80 w-[80%] mx-auto mb-2" />
                        {hasLegalResponsible ? (
                          <>
                            <p className="text-center text-[12px] leading-snug">
                              <strong>Responsável legal / Assinatura do(a) aluno(a):</strong> {signedByLabel}
                            </p>
                            <p className="text-center text-[12px] leading-snug mt-0.5">CPF: {signedByCPF}</p>
                          </>
                        ) : (
                          <>
                            <p className="text-center text-[12px] leading-snug">
                              <strong>Aluno(a):</strong> {signedByLabel}
                            </p>
                            <p className="text-center text-[12px] leading-snug mt-0.5">CPF: {signedByCPF}</p>
                          </>
                        )}
                      </div>
                    </article>
                  </section>
                );
              })()}

              <div className="rounded-3xl bg-slate-50 border border-slate-200 p-6 max-w-2xl mx-auto text-sm text-slate-700 leading-relaxed space-y-2">
                <p className="font-semibold text-slate-900 text-base">Declaração de aceite</p>
                <p>
                  Declaro que li, compreendi e concordo com as condições do contrato de prestação de serviços educacionais (aulas online de música) da Lucas Brum Online Music USA,
                  incluindo plano, valor, pagamentos, agenda, faltas, reposições, cancelamento, responsabilidades, material didático, uso de imagem e vigência.
                </p>
              </div>

              {contractFinalError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700 max-w-2xl mx-auto">{toErrorMessage(contractFinalError, "Erro desconhecido.")}</div>
              )}

              <div className="grid grid-cols-1 sm:flex sm:flex-row sm:items-start gap-3 pt-2 max-w-2xl mx-auto w-full">
                <button
                  onClick={() => {
                    const legalName =
                      typeof contractSnapshot?.legal_responsible_name === "string"
                        ? contractSnapshot.legal_responsible_name
                        : typeof lastSavedFieldValues?.legal_responsible_name === "string"
                        ? lastSavedFieldValues.legal_responsible_name
                        : "";
                    if (!String(legalName ?? "").trim()) {
                      goStep(7);
                    } else {
                      goStep(8);
                    }
                  }}
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
                  {contractFinalizing ? "Gerando contrato…" : "Sim, formalizar contrato agora"}
                </button>
              </div>
            </section>
          )}

          {step === 10 && submitResult && (
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
                      onClick={() => goStep(9)}
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
                    href="https://buy.stripe.com/00wfZiemqfuk3t0gnmcwg02"
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
                          <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-700/90">
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
                          src="/qr-code.jpeg"
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
                        00020126360014br.gov.bcb.pix0114+55659998511425204000053039865406595.005802BR5920Loivo de Brum Castro6009SAO PAULO62070503***63043C96
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            const code = "00020126360014br.gov.bcb.pix0114+55659998511425204000053039865406595.005802BR5920Loivo de Brum Castro6009SAO PAULO62070503***63043C96";
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

          {step === 11 && submitResult && (
            <section className="space-y-7 text-center">
              <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900">Estamos verificando o seu pagamento! 🤝</h2>
                <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
                  Você receberá uma notificação pelo WhatsApp assim que o pagamento for confirmado. Até lá, seus dados de matrícula ficarão registrados como pré-aprovados.
                </p>
                <p className="mt-4 text-base text-slate-500">
                  Aulas todas as <strong>{submitResult.weekdayLabel}</strong> às <strong>{submitResult.leadTime}</strong>.
                </p>
                {contractSignedAt && (
                  <p className="mt-2 text-sm text-slate-500">
                    Formalizado em: {new Date(contractSignedAt).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>

              <div className="rounded-3xl bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-50 border border-emerald-100 p-8 max-w-2xl mx-auto space-y-5">
                <div className="text-left">
                  <div className="text-2xl font-bold text-slate-900">📄 Contrato de prestação de serviços</div>
                  <p className="mt-1 text-slate-600">
                    Clique abaixo para baixar seu contrato completo em PDF.
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
                    Baixar contrato em PDF
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
