"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import type { AtendimentoLeadListItem, AtendimentoSummary } from "@/lib/atendimento/types";
import { atendimentoStageLabel, atendimentoStatusLabel, formatAtendimentoDateTime } from "@/lib/atendimento/utils";

type SummarySectionId = "interessados" | "alunos" | "agendamentos" | "contratos";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">{label}</div>
      <div className="mt-2 text-sm font-semibold text-[var(--app-text-85)]">{value || "-"}</div>
    </div>
  );
}

function LeadDetails({ lead }: { lead: AtendimentoLeadListItem }) {
  return (
    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4">
      <div className="flex flex-col gap-2 border-b border-[var(--app-border)] pb-4">
        <div className="truncate text-lg font-semibold text-[var(--app-text-85)]">{lead.full_name || "Novo Lead"}</div>
        <div className="text-sm text-[var(--app-text-55)]">
          Ultima interacao: {formatAtendimentoDateTime(lead.last_interaction_at || lead.created_at)}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Telefone" value={lead.phone} />
        <Field label="Email" value={lead.email} />
        <Field label="CPF" value={lead.cpf} />
        <Field label="Origem" value={lead.origin} />
        <Field label="Status" value={atendimentoStatusLabel(lead.status)} />
        <Field label="Etapa" value={atendimentoStageLabel(lead.funnel_stage)} />
        <Field label="Cidade" value={lead.city} />
        <Field label="Estado" value={lead.state} />
        <Field label="Pais" value={lead.country} />
        <Field label="Fuso" value={lead.timezone} />
      </div>
    </div>
  );
}

export function AtendimentoSummaryCards({
  summary,
  leads,
}: {
  summary: AtendimentoSummary;
  leads: AtendimentoLeadListItem[];
}) {
  const sections = useMemo(
    () => [
      {
        id: "interessados" as const,
        label: "Interessados",
        value: summary.totalLeads,
        emptyMessage: "Nenhum interessado disponivel no momento.",
        items: leads.filter((lead) => lead.status !== "matriculado" && lead.funnel_stage !== "matriculado"),
      },
      {
        id: "alunos" as const,
        label: "Alunos",
        value: summary.matriculados,
        emptyMessage: "Nenhum aluno disponivel no momento.",
        items: leads.filter((lead) => lead.status === "matriculado" || lead.funnel_stage === "matriculado"),
      },
      {
        id: "agendamentos" as const,
        label: "Agendamentos",
        value: summary.aulasExperimentaisAgendadas,
        emptyMessage: "Nenhum agendamento disponivel no momento.",
        items: leads.filter((lead) => lead.funnel_stage === "aula_experimental_agendada"),
      },
      {
        id: "contratos" as const,
        label: "Contratos",
        value: summary.matriculasPendentes,
        emptyMessage: "Nenhum contrato disponivel no momento.",
        items: leads.filter(
          (lead) =>
            lead.status === "matricula_pendente" ||
            lead.funnel_stage === "matricula_pendente" ||
            lead.funnel_stage === "pre_cadastro_concluido",
        ),
      },
    ],
    [leads, summary],
  );
  const [activeSection, setActiveSection] = useState<SummarySectionId>("interessados");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [mobileLead, setMobileLead] = useState<AtendimentoLeadListItem | null>(null);

  const activeSectionData = sections.find((section) => section.id === activeSection) ?? sections[0];
  const activeItems = activeSectionData?.items ?? [];
  const selectedLead = activeItems.find((lead) => lead.id === selectedLeadId) ?? activeItems[0] ?? null;

  useEffect(() => {
    setSelectedLeadId((currentSelectedLeadId) => {
      if (!activeItems.length) return null;
      return activeItems.some((lead) => lead.id === currentSelectedLeadId) ? currentSelectedLeadId : activeItems[0]?.id ?? null;
    });
  }, [activeItems]);

  function handleSelectLead(lead: AtendimentoLeadListItem) {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setSelectedLeadId(lead.id);
      return;
    }
    setMobileLead(lead);
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {sections.map((section) => {
          const active = section.id === activeSection;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={[
                "rounded-2xl border p-4 text-left transition",
                active
                  ? "border-yellow-500/30 bg-yellow-500/10"
                  : "border-[var(--app-border)] bg-[var(--app-card-2)] hover:bg-[var(--app-hover)]",
              ].join(" ")}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
                {section.label}
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight text-[var(--app-text-85)]">{section.value}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-col gap-4 lg:min-h-[26rem] lg:flex-row">
        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] lg:w-[320px] lg:min-w-[320px]">
          <div className="border-b border-[var(--app-border)] px-4 py-4">
            <div className="text-sm font-semibold text-[var(--app-text-85)]">{activeSectionData.label}</div>
            <div className="mt-1 text-xs text-[var(--app-text-55)]">Selecione um item para visualizar os detalhes.</div>
          </div>
          <div className="max-h-[26rem] overflow-y-auto p-3">
            {activeItems.length ? (
              <div className="space-y-3">
                {activeItems.map((lead) => {
                  const active = lead.id === selectedLead?.id;
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => handleSelectLead(lead)}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-left transition",
                        active
                          ? "border-yellow-500/30 bg-yellow-500/10"
                          : "border-[var(--app-border)] bg-[var(--app-card)] hover:bg-[var(--app-hover)]",
                      ].join(" ")}
                    >
                      <div className="truncate text-sm font-semibold text-[var(--app-text-85)]">{lead.full_name || "Novo Lead"}</div>
                      <div className="mt-1 text-xs text-[var(--app-text-55)]">
                        {formatAtendimentoDateTime(lead.last_interaction_at || lead.created_at)}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-40 items-center justify-center px-4 text-center text-sm text-[var(--app-text-45)]">
                {activeSectionData.emptyMessage}
              </div>
            )}
          </div>
        </div>

        <div className="hidden min-h-0 flex-1 lg:block">
          {selectedLead ? (
            <LeadDetails lead={selectedLead} />
          ) : (
            <div className="flex h-full min-h-[26rem] items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-6 text-center text-sm text-[var(--app-text-45)]">
              {activeSectionData.emptyMessage}
            </div>
          )}
        </div>
      </div>

      <AppModal open={Boolean(mobileLead)} onClose={() => setMobileLead(null)} size="lg" zIndexClass="z-[340]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-[var(--app-text-85)]">{mobileLead?.full_name || "Novo Lead"}</div>
            <div className="mt-1 text-xs text-[var(--app-text-55)]">{activeSectionData.label}</div>
          </div>
          <button
            type="button"
            onClick={() => setMobileLead(null)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-80)] hover:bg-[var(--app-hover)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mobileLead ? <div className="mt-4"><LeadDetails lead={mobileLead} /></div> : null}
      </AppModal>
    </>
  );
}
