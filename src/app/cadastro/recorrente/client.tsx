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

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
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
  const [submitRedirect, setSubmitRedirect] = useState<string | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
  const [draftSaving, setDraftSaving] = useState<"weekday" | "time" | null>(null);

  useEffect(() => {
    if (!submitRedirect || redirectCountdown === null) return;
    if (redirectCountdown <= 0) {
      try {
        window.location.assign(submitRedirect);
      } catch {
        window.location.href = submitRedirect;
      }
      return;
    }
    const timer = window.setTimeout(() => setRedirectCountdown((c) => (c === null ? null : Math.max(0, c - 1))), 1000);
    return () => window.clearTimeout(timer);
  }, [submitRedirect, redirectCountdown]);

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

  function goStep(next: 0 | 1 | 2 | 3) {
    setSubmitError("");
    setAvailError("");
    setStep(next);
  }

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
      setSubmitResult(json.scheduled);
      setSubmitRedirect(json.redirect_to || "/atendimento?slug=lucas-brum-online-music-usa");
      setRedirectCountdown(2);
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
                { key: 3, label: "Concluído" },
              ].map((st) => {
                const active = step === st.key;
                const done = step > st.key;
                return (
                  <div key={st.key} className="flex items-center gap-2 flex-1">
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
                        "hidden sm:block " +
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
                style={{ width: `${step === 0 ? 25 : step === 1 ? 50 : step === 2 ? 75 : 100}%` }}
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

          {step === 3 && submitResult && (
            <section className="space-y-8 text-center">
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
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900">Tudo certo, {firstName}! 🎉</h2>
                <p className="mt-3 text-lg text-slate-600">
                  Sua aula recorrente foi reservada.
                </p>
                <p className="mt-2 text-base text-slate-500">
                  Em seguida, vamos formalizar o contrato de prestação de serviços.
                </p>
              </div>
              <div className="rounded-3xl bg-gradient-to-br from-indigo-50 to-sky-50 border border-indigo-100 p-7 text-left max-w-lg mx-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Dia</div>
                    <div className="mt-1 text-xl font-bold text-slate-900">{submitResult.weekdayLabel}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Horário</div>
                    <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
                      {submitResult.leadTime}
                    </div>
                  </div>
                </div>
                <div className="mt-6 pt-6 border-t border-indigo-100 text-sm text-slate-700 leading-relaxed space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                    <span>Dia e horário fixos registrados com sucesso no seu cadastro.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-sky-600 font-bold mt-0.5">→</span>
                    <span>
                      Você está sendo redirecionado(a) para o link de matrícula, onde vamos formalizar o contrato
                      automaticamente com seus dados já cadastrados.
                    </span>
                  </div>
                </div>
                <div className="mt-5 pt-5 border-t border-indigo-100 text-center">
                  {redirectCountdown === null || redirectCountdown === 0 ? (
                    <div className="text-slate-500 text-sm">Redirecionando…</div>
                  ) : (
                    <div className="text-slate-600 text-sm">
                      Redirecionando em{" "}
                      <span className="font-bold text-slate-900 tabular-nums">{redirectCountdown}s</span>…
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-2 space-y-3">
                <a
                  href={submitRedirect || "/atendimento?slug=lucas-brum-online-music-usa"}
                  className="inline-flex items-center gap-2 rounded-2xl px-6 py-3 bg-indigo-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Formalizar contrato agora
                </a>
                <div>
                  <button
                    onClick={() => {
                      if (submitRedirect) {
                        try {
                          window.location.assign(submitRedirect);
                        } catch {
                          window.location.href = submitRedirect;
                        }
                      }
                    }}
                    className="rounded-2xl px-6 py-3 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition"
                  >
                    Ir agora para o link de matrícula
                  </button>
                </div>
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
