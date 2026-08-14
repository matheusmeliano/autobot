"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

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

export default function CadastroRecorrenteBody() {
  const sp = useSearchParams();
  const initialNameParam = decodeURIComponent(String(sp.get("nome") ?? "").trim()) || "";
  const initialPhoneParam = decodeURIComponent(String(sp.get("telefone") ?? "").trim()) || "";

  function toNomeESobrenome(raw: string | null | undefined): string {
    const clean = String(raw ?? "").trim();
    if (!clean) return "";
    const parts = clean.split(/\s+/).filter((s) => s && s.trim());
    if (parts.length <= 2) return clean;
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }

  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9>(0);
  const [nome, setNome] = useState<string>(toNomeESobrenome(initialNameParam));
  const [phoneField, setPhoneField] = useState<string>(initialPhoneParam);
  const [senha, setSenha] = useState<string>("");
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
  const [contractAllFields, setContractAllFields] = useState<ContractFieldMeta[]>([]);
  const [contractCurrentFieldIdx, setContractCurrentFieldIdx] = useState<number>(0);
  const [contractCurrentValue, setContractCurrentValue] = useState<string>("");
  const [contractFieldError, setContractFieldError] = useState<string>("");
  const [contractFieldSaving, setContractFieldSaving] = useState<boolean>(false);
  const [contractFinalizing, setContractFinalizing] = useState<boolean>(false);
  const [contractFinalError, setContractFinalError] = useState<string>("");
  const [contractPdfUrl, setContractPdfUrl] = useState<string>("");
  const [contractSignedAt, setContractSignedAt] = useState<string>("");

  useEffect(() => {
    if (step !== 3 || !submitResult) return;
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
          throw new Error(json?.error || "Falha ao carregar os dados do contrato.");
        }
        setContractLeadId(String(json.leadId || submitLeadId || ""));
        setContractSnapshot(json.snapshot || contractSnapshot);
        setContractAllFields(json.allFields || []);
        setContractCurrentFieldIdx(0);
        setContractCurrentValue((json.allFields || [])[0]?.currentValue || "");
        goStep(3);
      } catch (e) {
        setContractInitError(e instanceof Error ? e.message : String(e ?? "Erro ao carregar."));
      } finally {
        setContractInitLoading(false);
      }
    })();
  }, [step, submitResult, phoneField, submitLeadId]);

  function contractFieldForStep(
    s: 3 | 4 | 5 | 6 | 7,
  ): { stepLabel: string; stepIdx: number } {
    const map: Record<3 | 4 | 5 | 6 | 7, { stepLabel: string; stepIdx: number }> = {
      3: { stepLabel: "Nome completo", stepIdx: 0 },
      4: { stepLabel: "CPF", stepIdx: 1 },
      5: { stepLabel: "Telefone/WhatsApp", stepIdx: 2 },
      6: { stepLabel: "Responsável (opcional)", stepIdx: 3 },
      7: { stepLabel: "CPF resp. legal (opcional)", stepIdx: 4 },
    };
    return map[s];
  }

  async function contractAdvanceField(skip = false) {
    if (step < 3 || step > 7) return;
    const tel = phoneField.replace(/\D/g, "").trim();
    if (contractFieldSaving) return;
    const fieldIdxByStep: Record<3 | 4 | 5 | 6 | 7, number> = { 3: 0, 4: 1, 5: 2, 6: 3, 7: 4 };
    const expectedIdx = fieldIdxByStep[step as 3 | 4 | 5 | 6 | 7];
    const currentMeta = contractAllFields[expectedIdx] ?? contractAllFields[contractCurrentFieldIdx];
    if (!currentMeta) return;
    if (!skip && !contractCurrentValue.trim() && !currentMeta.optional) {
      setContractFieldError("Campo obrigatório.");
      return;
    }
    setContractFieldSaving(true);
    setContractFieldError("");
    try {
      const res = await fetch("/api/cadastro/recorrente/contract-field-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone: tel,
          leadId: contractLeadId || submitLeadId || undefined,
          field: currentMeta.name,
          value: skip ? "" : contractCurrentValue.trim(),
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
          }
        | null;
      if (!res.ok || !json?.ok) {
        setContractFieldError(json?.error || "Falha ao salvar. Tente novamente.");
        return;
      }
      setContractSnapshot(json.snapshot || contractSnapshot);
      setContractAllFields(json.allFields || contractAllFields);
      const nextStep: 4 | 5 | 6 | 7 | 8 =
        step === 3 ? 4 : step === 4 ? 5 : step === 5 ? 6 : step === 6 ? 7 : 8;
      if (nextStep === 8) {
        setContractCurrentValue("");
        goStep(8);
        return;
      }
      const nextFieldIdx = nextStep - 3;
      setContractCurrentFieldIdx(nextFieldIdx);
      setContractCurrentValue((json.allFields || contractAllFields)[nextFieldIdx]?.currentValue || "");
      goStep(nextStep);
    } finally {
      setContractFieldSaving(false);
    }
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
        throw new Error(json?.error || "Falha ao gerar o contrato. Tente novamente.");
      }
      setContractPdfUrl(String(json.contract_pdf_url || ""));
      setContractSignedAt(String(json.contract_signed_at || new Date().toISOString()));
      goStep(9);
    } catch (e) {
      setContractFinalError(e instanceof Error ? e.message : String(e ?? "Erro ao gerar o contrato."));
    } finally {
      setContractFinalizing(false);
    }
  }

  function goStep(n: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9) {
    setStep(n);
    setSubmitError("");
    setContractFieldError("");
    setContractFinalError("");
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
    if (step < 3 || step > 7) return;
    if (!contractAllFields.length) return;
    const fieldIdxByStep: Record<3 | 4 | 5 | 6 | 7, number> = { 3: 0, 4: 1, 5: 2, 6: 3, 7: 4 };
    const expectedIdx = fieldIdxByStep[step as 3 | 4 | 5 | 6 | 7];
    const target = contractAllFields[expectedIdx];
    if (!target) return;
    if (contractCurrentValue !== String(target.currentValue || "")) {
      setContractCurrentValue(String(target.currentValue || ""));
    }
  }, [step, contractAllFields]);

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
                full_name?: string | null;
                phone?: string | null;
              } | null;
            }
          | null;
        if (!res.ok || json?.blocked) {
          setAccessBlocked(true);
          setAccessBlockedMessage(
            String(json?.error ?? "").trim() ||
              "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
          );
          return;
        }
        if (json?.ok && json?.lead) {
          const leadFullName = String(json.lead?.full_name ?? "").trim();
          const leadPhone = String(json.lead?.phone ?? "").replace(/\D/g, "").trim();
          const normalizedLeadFullName = toNomeESobrenome(leadFullName);
          if (normalizedLeadFullName) {
            setNome(normalizedLeadFullName);
          } else if (initialNameParam && !leadFullName) {
            setNome(toNomeESobrenome(initialNameParam));
          }
          if (leadPhone) {
            setPhoneField(leadPhone);
          } else if (initialPhoneParam && !leadPhone) {
            setPhoneField(initialPhoneParam);
          }
        }
      } catch (e) {
        setInitialDataError(e instanceof Error ? e.message : "");
      } finally {
        setInitialDataLoading(false);
      }
    })();
  }, []);

  const firstName = useMemo(() => {
    const parts = (nome || "Aluno(a)").trim().split(/\s+/).filter(Boolean);
    return parts[0] || "Aluno(a)";
  }, [nome]);

  async function saveDraftRecurring(payload: {
    weekday?: RecurringWeekdayKey | null;
    weekdayLabel?: string | null;
    professorTime?: string | null;
    leadTime?: string | null;
  }) {
    try {
      const telefone = phoneField.replace(/\D/g, "");
      if (!telefone || telefone.length < 10) return;
      await fetch("/api/cadastro/recorrente/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone,
          nome: nome.trim() || null,
          weekday: payload.weekday ?? null,
          weekdayLabel: payload.weekdayLabel ?? null,
          professorTime: payload.professorTime ?? null,
          leadTime: payload.leadTime ?? null,
        }),
      }).catch(() => {});
    } catch {}
  }

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

  async function loadAvailability() {
    setAvailLoading(true);
    setAvailError("");
    try {
      const tz = typeof Intl !== "undefined" && Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : "";
      const url = tz
        ? `/api/cadastro/recorrente/availability?timezone=${encodeURIComponent(tz)}`
        : `/api/cadastro/recorrente/availability`;
      const res = await fetch(url, { method: "GET" });
      const json = (await res.json().catch(() => null)) as AvailabilityResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Falha ao carregar disponibilidade.");
      }
      setAvailability(json);
    } catch (e) {
      setAvailError(e instanceof Error ? e.message : String(e ?? "Erro ao carregar disponibilidade."));
    } finally {
      setAvailLoading(false);
    }
  }

  useEffect(() => {
    if (step === 1 && !availability && !availLoading) {
      void loadAvailability();
    }
  }, [step]);

  function canAdvanceFromStep0() {
    if (accessBlocked) return false;
    return (
      phoneField.replace(/\D/g, "").length >= 10 &&
      senha.trim().length >= 4
    );
  }

  function handleAdvance0() {
    if (!canAdvanceFromStep0()) return;
    goStep(1);
  }

  function handleAdvance1() {
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
    goStep(2);
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
      if (res.status === 403 || json?.blocked) {
        setAccessBlocked(true);
        setAccessBlockedMessage(
          String(json?.error ?? "").trim() ||
            "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
        );
        throw new Error(String(json?.error ?? "Acesso bloqueado."));
      }
      if (!res.ok || !json?.ok || !json.scheduled) {
        throw new Error(json?.error || "Falha ao finalizar o cadastro. Tente novamente.");
      }
      setSubmitLeadId(String(json.leadId || ""));
      setSubmitResult(json.scheduled);
      goStep(3);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e ?? "Erro desconhecido."));
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
                { key: 1, label: "Dia", shortLabel: "Dia" },
                { key: 2, label: "Horário", shortLabel: "Hora" },
                { key: 3, label: "Nome", shortLabel: "Nome" },
                { key: 4, label: "CPF", shortLabel: "CPF" },
                { key: 5, label: "Telefone", shortLabel: "Tel" },
                { key: 6, label: "Resp. Legal", shortLabel: "Resp" },
                { key: 7, label: "CPF Resp.", shortLabel: "CPF-R" },
                { key: 8, label: "Revisão", shortLabel: "Rev" },
                { key: 9, label: "Concluído", shortLabel: "Fim" },
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
                        width: `${step === 0 ? 10 : step === 1 ? 20 : step === 2 ? 30 : step === 3 ? 40 : step === 4 ? 50 : step === 5 ? 60 : step === 6 ? 70 : step === 7 ? 80 : step === 8 ? 90 : 100}%`,
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
                    E-mail (identificador: seu WhatsApp)
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
                  Avançar →
                </button>
              </div>
            </section>
          )}

          {step === 1 && (
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
                  <div className="mt-1">{availError}</div>
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
                            {selected && <span className="text-white text-xs font-bold">✓</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 w-full">
                <button
                  onClick={handleAdvance1}
                  disabled={!selectedWeekday}
                  className="w-full sm:w-auto shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-4 sm:px-7 py-3.5 bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate sm:order-2 sm:justify-self-end"
                >
                  Avançar →
                </button>
                <button
                  onClick={() => goStep(0)}
                  className="w-full sm:w-auto shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-4 sm:px-6 py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition justify-center flex items-center text-sm sm:text-base truncate sm:order-1 sm:justify-self-start"
                >
                  ← Voltar
                </button>
              </div>
            </section>
          )}

          {step === 2 && (
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
                  Nenhum horário disponível nesse dia. Volte e escolha outro dia.
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
                            {selected && <span className="text-white text-xs font-bold">✓</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {submitError && (
                <div className="rounded-2xl bg-red-50 border border-red-200 p-5 text-red-700">{submitError}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 w-full">
                <button
                  onClick={() => void handleSubmitFinal()}
                  disabled={!selectedTimeOpt || submitLoading}
                  className="w-full sm:w-auto shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-4 sm:px-7 py-3.5 bg-emerald-600 text-white font-semibold shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate sm:order-2 sm:justify-self-end"
                >
                  {submitLoading ? "Finalizando..." : "Finalizar cadastro ✓"}
                </button>
                <button
                  onClick={() => goStep(1)}
                  className="w-full sm:w-auto shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-4 sm:px-6 py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition justify-center flex items-center text-sm sm:text-base truncate sm:order-1 sm:justify-self-start"
                >
                  ← Voltar
                </button>
              </div>
            </section>
          )}

          {step >= 3 && step <= 7 && submitResult && contractAllFields.length > 0 && (
            <section className="space-y-7">
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
                <p className="mt-2.5 text-base text-slate-500 leading-relaxed">Agora vamos <strong className="font-bold text-slate-700">formalizar o contrato</strong>. Responda uma pergunta por vez.</p>
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 divide-y divide-slate-100 sm:divide-y-0 sm:divide-x sm:divide-slate-100">
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
                    <div className="px-5 sm:px-6 py-5 sm:py-7 flex items-start sm:items-center gap-3 sm:gap-4 sm:gap-4.5">
                      <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5 sm:pt-0">
                        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.16em] sm:tracking-[0.18em] text-slate-500 whitespace-nowrap truncate">Situação</div>
                        <div className="mt-2 inline-flex items-center w-full max-w-full">
                          <span className="text-[clamp(14px,3.4vw,19px)] sm:text-[19px] font-extrabold text-emerald-700 leading-none whitespace-nowrap truncate max-w-full">Contrato em andamento</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {contractInitLoading && (
                <div className="py-14 text-center text-slate-500">Preparando suas informações…</div>
              )}
              {contractInitError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">{contractInitError}</div>
              )}

              {!contractInitLoading && !contractInitError && contractCurrentFieldIdx >= 0 && (
                <div className="max-w-2xl mx-auto space-y-6">
                  {(() => {
                    const fieldIdxByStep: Record<3 | 4 | 5 | 6 | 7, number> = { 3: 0, 4: 1, 5: 2, 6: 3, 7: 4 };
                    const expectedIdx = fieldIdxByStep[step as 3 | 4 | 5 | 6 | 7];
                    const meta = contractAllFields[expectedIdx] ?? contractAllFields[contractCurrentFieldIdx];
                    if (!meta) return null;
                    const hasExisting = Boolean(meta.currentValue);
                    return (
                      <div className="space-y-7">
                        <div className="space-y-1">
                        <h2 className="text-2xl font-bold text-slate-900">
                          {hasExisting ? "Confirme seu " + meta.label.toLowerCase() : "Informe seu " + meta.label.toLowerCase()}
                        </h2>
                        <p className="text-slate-600">
                          {meta.optional ? "Campo opcional. Você pode pular se preferir." : "Campo obrigatório."}
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
                            onChange={(e) => setContractCurrentValue(e.target.value)}
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
                            <div className="mt-3 text-sm text-red-700 rounded-xl bg-red-50 border border-red-200 p-3">{contractFieldError}</div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3 pt-2 w-full">
                          <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 col-span-2 sm:col-span-1 order-1 sm:order-2 sm:justify-self-end sm:w-auto">
                            {meta.optional && (
                              <button
                                onClick={() => void contractAdvanceField(true)}
                                disabled={contractFieldSaving}
                                className="w-full sm:w-auto shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-3 sm:px-6 py-3.5 bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate"
                              >
                                Pular →
                              </button>
                            )}
                            <button
                              onClick={() => void contractAdvanceField(false)}
                              disabled={contractFieldSaving}
                              className="w-full sm:w-auto shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-4 sm:px-7 py-3.5 bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate"
                            >
                              {contractFieldSaving ? "Salvando…" : hasExisting ? "Confirmar e avançar →" : "Avançar →"}
                            </button>
                          </div>
                          <button
                            onClick={() => goStep((Math.max(3, (step as number) - 1)) as any)}
                            disabled={contractFieldSaving}
                            className="w-full sm:w-auto shrink-0 min-w-0 whitespace-nowrap col-span-2 sm:col-span-1 order-2 sm:order-1 rounded-2xl px-4 sm:px-6 py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate sm:justify-self-start"
                          >
                            ← Voltar
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </section>
          )}

          {step === 8 && submitResult && (
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
              <div className="rounded-3xl border border-slate-200 bg-white max-w-2xl mx-auto divide-y divide-slate-100">
                {contractAllFields.map((f, idx) => {
                  const val = contractSnapshot[f.name] ?? f.currentValue;
                  if (!val && f.optional) return null;
                  return (
                    <div key={idx} className="px-6 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-5 items-start">
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 sm:text-right">
                        {f.label}
                        {f.optional ? " (opcional)" : ""}
                      </div>
                      <div className="sm:col-span-2 text-base font-semibold text-slate-900 break-words">
                        {val || "— não informado —"}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-3xl bg-slate-50 border border-slate-200 p-6 max-w-2xl mx-auto text-sm text-slate-700 leading-relaxed space-y-2">
                <p className="font-semibold text-slate-900 text-base">Declaração de aceite</p>
                <p>
                  Declaro que li, compreendi e concordo com as condições do contrato de prestação de serviços educacionais (aulas online de música) da Lucas Brum Online Music USA,
                  incluindo plano, valor, pagamentos, agenda, faltas, reposições, cancelamento, responsabilidades, material didático, uso de imagem e vigência.
                </p>
              </div>

              {contractFinalError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700 max-w-2xl mx-auto">{contractFinalError}</div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 max-w-2xl mx-auto w-full">
                <button
                  onClick={() => void handleContractFinalize()}
                  disabled={contractFinalizing}
                  className="w-full sm:w-auto shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-4 sm:px-7 py-3.5 bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm sm:text-base justify-center flex items-center truncate sm:order-2 sm:justify-self-end"
                >
                  {contractFinalizing ? "Gerando contrato…" : "✓ Sim, formalizar contrato agora"}
                </button>
                <button
                  onClick={() => goStep(7)}
                  disabled={contractFinalizing}
                  className="w-full sm:w-auto shrink-0 min-w-0 whitespace-nowrap rounded-2xl px-4 sm:px-6 py-3.5 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition justify-center flex items-center text-sm sm:text-base truncate sm:order-1 sm:justify-self-start"
                >
                  ← Voltar para revisar
                </button>
              </div>
            </section>
          )}

          {step === 9 && submitResult && (
            <section className="space-y-7 text-center">
              <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900">Matrícula concluída, {firstName}! 🎉</h2>
                <p className="mt-3 text-lg text-slate-600">Seu contrato foi formalizado com sucesso.</p>
                <p className="mt-2 text-base text-slate-500">
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
                    className="inline-flex items-center justify-center gap-2 rounded-2xl px-8 py-4 bg-emerald-600 text-white font-bold text-lg shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition w-full"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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

              <div className="pt-2 max-w-2xl mx-auto text-left text-sm text-slate-500 space-y-1">
                <p className="font-semibold text-slate-700">Próximos passos:</p>
                <p>• Em breve você receberá a confirmação do pagamento da primeira mensalidade.</p>
                <p>• Qualquer dúvida, entre em contato pelo WhatsApp.</p>
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
