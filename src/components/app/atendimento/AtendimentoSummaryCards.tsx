"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Search, X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { modalToast } from "@/lib/modalToast";
import type { AtendimentoLeadListItem, AtendimentoSummary } from "@/lib/atendimento/types";
import { atendimentoStageLabel, atendimentoStatusLabel, formatAtendimentoDateTime } from "@/lib/atendimento/utils";

type SummarySectionId = "interessados" | "alunos" | "agendamentos" | "contratos";
const PANEL_PAGE_SIZE = 4;

function Field({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string | null | undefined;
  copyable?: boolean;
}) {
  const displayValue = value || "-";
  const canCopy = Boolean(copyable && value && String(value).trim());

  async function handleCopy() {
    if (!canCopy) return;
    await navigator.clipboard.writeText(String(value).trim());
    modalToast.success(`${label} copiado.`);
  }

  return (
    <div className="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">{label}</div>
        {copyable ? (
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!canCopy}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] text-[var(--app-text-70)] transition hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Copiar ${label.toLowerCase()}`}
            title={canCopy ? `Copiar ${label.toLowerCase()}` : `${label} indisponivel`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="mt-2 truncate text-sm font-semibold text-[var(--app-text-85)]" title={displayValue}>
        {displayValue}
      </div>
    </div>
  );
}

function LeadDetails({ lead }: { lead: AtendimentoLeadListItem }) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 lg:h-full lg:overflow-y-auto">
      <div className="min-w-0 flex flex-col gap-2 border-b border-[var(--app-border)] pb-4">
        <div className="truncate text-lg font-semibold text-[var(--app-text-85)]" title={lead.full_name || "Novo Lead"}>
          {lead.full_name || "Novo Lead"}
        </div>
        <div className="text-sm text-[var(--app-text-55)]">
          Ultima interacao: {formatAtendimentoDateTime(lead.last_interaction_at || lead.created_at)}
        </div>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
        <Field label="Telefone" value={lead.phone} copyable />
        <Field label="Email" value={lead.email} copyable />
        <Field label="CPF" value={lead.cpf} copyable />
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
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const activeSectionData = sections.find((section) => section.id === activeSection) ?? sections[0];
  const activeItems = activeSectionData?.items ?? [];
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return activeItems;
    return activeItems.filter((lead) =>
      [lead.full_name, lead.phone, lead.cpf].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    );
  }, [activeItems, query]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredItems.length / PANEL_PAGE_SIZE)), [filteredItems.length]);
  const pagedItems = useMemo(() => {
    const start = (page - 1) * PANEL_PAGE_SIZE;
    return filteredItems.slice(start, start + PANEL_PAGE_SIZE);
  }, [filteredItems, page]);
  const selectedLead = filteredItems.find((lead) => lead.id === selectedLeadId) ?? filteredItems[0] ?? null;

  useEffect(() => {
    setQuery("");
    setPage(1);
  }, [activeSection]);

  useEffect(() => {
    setPage((current) => {
      if (current < 1) return 1;
      if (current > totalPages) return totalPages;
      return current;
    });
  }, [totalPages]);

  useEffect(() => {
    setSelectedLeadId((currentSelectedLeadId) => {
      if (!filteredItems.length) return null;
      return filteredItems.some((lead) => lead.id === currentSelectedLeadId) ? currentSelectedLeadId : filteredItems[0]?.id ?? null;
    });
  }, [filteredItems]);

  function handleSelectLead(lead: AtendimentoLeadListItem) {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setSelectedLeadId(lead.id);
      return;
    }
    setMobileLead(lead);
  }

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <div className="shrink-0 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

      <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:pr-1">
        <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] lg:flex lg:h-full lg:w-[320px] lg:min-w-[320px] lg:flex-col">
          <div className="border-b border-[var(--app-border)] px-4 py-4">
            <div className="text-sm font-semibold text-[var(--app-text-85)]">{activeSectionData.label}</div>
            <label className="mt-4 flex items-center gap-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
              <Search className="h-4 w-4 text-[var(--app-text-45)]" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Pesquisar por nome, telefone ou CPF"
                className="w-full bg-transparent text-sm text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-35)]"
              />
            </label>
          </div>
          <div className="max-h-[26rem] overflow-y-auto p-3 lg:min-h-0 lg:max-h-none lg:flex-1">
            {pagedItems.length ? (
              <div className="space-y-3">
                {pagedItems.map((lead) => {
                  const active = lead.id === selectedLead?.id;
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => handleSelectLead(lead)}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-left transition",
                        active
                          ? "border-[var(--app-border)] bg-[var(--app-card)] lg:border-yellow-500/30 lg:bg-yellow-500/10"
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
                {query.trim() ? "Nenhum resultado encontrado para a busca." : activeSectionData.emptyMessage}
              </div>
            )}
          </div>
          {filteredItems.length > PANEL_PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--app-border)] px-4 py-3">
              <div className="text-xs font-semibold text-[var(--app-text-55)]">
                Página {page} de {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Próximo
                </button>
              </div>
            </div>
          ) : null}
        </div>

          <div className="hidden min-h-0 min-w-0 flex-1 lg:block lg:h-full">
            {selectedLead ? (
              <LeadDetails lead={selectedLead} />
            ) : (
              <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-6 text-center text-sm text-[var(--app-text-45)]">
                {activeSectionData.emptyMessage}
              </div>
            )}
          </div>
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
    </div>
  );
}
