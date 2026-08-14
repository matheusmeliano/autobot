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
        const firstPendingIdx = json.allFields.findIndex((f) => !f.alreadyFilled);
        const idx = firstPendingIdx < 0 ? 0 : firstPendingIdx;
        setContractCurrentFieldIdx(idx);
        setContractCurrentValue(json.allFields[idx]?.currentValue || "");
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
    const tel = phoneField.replace(/\D/g, "").trim();
    if (contractFieldSaving) return;
    const currentMeta = contractAllFields[contractCurrentFieldIdx];
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
      const nextIdx = contractCurrentFieldIdx + 1;
      if (nextIdx >= contractAllFields.length) {
        goStep(8);
        return;
      }
      setContractCurrentFieldIdx(nextIdx);
      setContractCurrentValue(json.allFields?.[nextIdx]?.currentValue || "");
      if (nextIdx + 3 > 9) {
        goStep(8);
      } else {
        goStep((nextIdx + 3) as 4 | 5 | 6 | 7 | 8);
      }
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
  }

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
    const parts = nome.trim().split(/\s+/).filter((s) => s && s.trim());
    return (
      nome.trim().length >= 2 &&
      parts.length >= 2 &&
      phoneField.replace(/\D/g, "").length >= 10 &&
      senha.trim().length >= 4
    );
  }

  function handleAdvance0() {
    if (!canAdvanceFromStep0()) return;
    (async () => {
      try {
        const telefone = phoneField.replace(/\D/g, "");
        if (telefone && telefone.length >= 10) {
          await fetch("/api/cadastro/recorrente/draft", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              telefone,
              nome: nome.trim() || null,
            }),
          }).catch(() => {});
        }
      } catch {}
    })();
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
            <div className="flex items-center justify-between text-xs sm:text-sm font-medium text-slate-500">
              {[
                { key: 0, label: "Conta" },
                { key: 1, label: "Dia" },
                { key: 2, label: "Horário" },
                { key: 3, label: "Nome" },
                { key: 4, label: "CPF" },
                { key: 5, label: "Telefone" },
                { key: 6, label: "Resp. Legal" },
                { key: 7, label: "CPF Resp." },
                { key: 8, label: "Revisão" },
                { key: 9, label: "Concluído" },
              ].map((st) => {
                const active = step === st.key;
                const done = step > st.key;
                return (
                  <div key={st.key} className="flex items-center gap-2 flex-1 min-w-0">
                    <div
                      className={
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 " +
                        (done
                          ? "bg-emerald-500 text-white"
                          : active
                          ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                          : "bg-slate-100 text-slate-400")
                      }
                    >
                      {done ? "✓" : String(st.key + 1)}
                    </div>
                    <span
                      className={
                        "hidden sm:block truncate " +
                        (done || active ? "text-slate-900 font-semibold" : "text-slate-400")
                      }
                    >
                      {st.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-sky-500 transition-all duration-300"
                style={{
                  width: `${step === 0 ? 10 : step === 1 ? 20 : step === 2 ? 30 : step === 3 ? 40 : step === 4 ? 50 : step === 5 ? 60 : step === 6 ? 70 : step === 7 ? 80 : step === 8 ? 90 : 100}%`,
                }}
              />
            </div>
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
                    Nome e sobrenome
                  </label>
                  <input
                    type="text"
                    value={nome}
                    onChange={(e) => setNome(toNomeESobrenome(e.target.value))}
                    disabled={accessBlocked || initialDataLoading}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
                    placeholder="Ex: Ana Maria Silva"
                  />
                </div>
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
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleAdvance0}
                  disabled={!canAdvanceFromStep0()}
                  className="rounded-2xl px-7 py-3 bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
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
              <div className="flex justify-between pt-2">
                <button
                  onClick={() => goStep(0)}
                  className="rounded-2xl px-6 py-3 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition"
                >
                  ← Voltar
                </button>
                <button
                  onClick={handleAdvance1}
                  disabled={!selectedWeekday}
                  className="rounded-2xl px-7 py-3 bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Avançar →
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
              <div className="flex justify-between pt-2">
                <button
                  onClick={() => goStep(1)}
                  className="rounded-2xl px-6 py-3 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition"
                >
                  ← Voltar
                </button>
                <button
                  onClick={() => void handleSubmitFinal()}
                  disabled={!selectedTimeOpt || submitLoading}
                  className="rounded-2xl px-7 py-3 bg-emerald-600 text-white font-semibold shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {submitLoading ? "Finalizando..." : "Finalizar cadastro ✓"}
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
                <p className="mt-3 text-lg text-slate-600">Sua aula recorrente foi reservada.</p>
                <p className="mt-2 text-base text-slate-500">Agora vamos formalizar o contrato. Responda uma pergunta por vez.</p>
              </div>

              <div className="rounded-3xl bg-gradient-to-br from-indigo-50 to-sky-50 border border-indigo-100 p-6 max-w-2xl mx-auto">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 items-start">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Dia</div>
                    <div className="mt-1 text-xl font-bold text-slate-900">{submitResult.weekdayLabel}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Horário</div>
                    <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{submitResult.leadTime}</div>
                  </div>
                  <div className="sm:text-right">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Status</div>
                    <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 text-emerald-700 px-3 py-1 text-sm font-bold">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Contrato em andamento
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
                        <div>
                          <h2 className="text-2xl font-bold text-slate-900">
                            {hasExisting ? "Confirme seu " + meta.label.toLowerCase() : "Informe seu " + meta.label.toLowerCase()}
                          </h2>
                          <p className="mt-1 text-slate-600">
                            {meta.optional ? "Campo opcional. Você pode pular se preferir." : "Campo obrigatório."}
                          </p>
                          {hasExisting && (
                            <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm text-indigo-900">
                              Já temos o valor abaixo cadastrado. Se estiver correto, basta clicar em <strong>Confirmar e avançar</strong>. Se precisar, edite o campo.
                              <div className="mt-2 font-bold text-base">{String(meta.currentValue || "")}</div>
                            </div>
                          )}
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
                        <div className="flex justify-between pt-2 gap-3 flex-wrap">
                          <button
                            onClick={() => goStep((Math.max(3, (step as number) - 1)) as any)}
                            disabled={contractFieldSaving}
                            className="rounded-2xl px-6 py-3 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition order-2 sm:order-1"
                          >
                            ← Voltar
                          </button>
                          <div className="flex gap-3 order-1 sm:order-2 flex-wrap justify-end">
                            {meta.optional && (
                              <button
                                onClick={() => void contractAdvanceField(true)}
                                disabled={contractFieldSaving}
                                className="rounded-2xl px-6 py-3 bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                              >
                                Pular →
                              </button>
                            )}
                            <button
                              onClick={() => void contractAdvanceField(false)}
                              disabled={contractFieldSaving}
                              className="rounded-2xl px-7 py-3 bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                            >
                              {contractFieldSaving ? "Salvando…" : hasExisting ? "Confirmar e avançar →" : "Avançar →"}
                            </button>
                          </div>
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

              <div className="flex justify-between pt-2 gap-3 max-w-2xl mx-auto flex-wrap">
                <button
                  onClick={() => goStep(7)}
                  disabled={contractFinalizing}
                  className="rounded-2xl px-6 py-3 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition order-2 sm:order-1"
                >
                  ← Voltar para revisar
                </button>
                <button
                  onClick={() => void handleContractFinalize()}
                  disabled={contractFinalizing}
                  className="rounded-2xl px-7 py-3.5 bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-base order-1 sm:order-2"
                >
                  {contractFinalizing ? "Gerando contrato…" : "✓ Sim, formalizar contrato agora"}
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
