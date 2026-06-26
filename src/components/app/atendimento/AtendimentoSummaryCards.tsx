"use client";

import { FileSignature } from "lucide-react";
import type { AtendimentoSummary } from "@/lib/atendimento/types";

const SUMMARY_ITEMS: Array<{ key: keyof AtendimentoSummary; label: string }> = [
  { key: "totalLeads", label: "Total de Leads" },
  { key: "novosLeads", label: "Novos Leads" },
  { key: "emAtendimento", label: "Em Atendimento" },
  { key: "aulasExperimentaisAgendadas", label: "Aulas Experimentais Agendadas" },
  { key: "matriculasPendentes", label: "Matrículas Pendentes" },
  { key: "matriculados", label: "Alunos Matriculados" },
  { key: "conversasNaoLidas", label: "Conversas Não Lidas" },
];

const CONTRACT_PREVIEW = [
  { name: "Contrato inicial", status: "Pendente" },
  { name: "Termo da aula teste", status: "Em análise" },
  { name: "Matrícula USA", status: "Assinado" },
];

export function AtendimentoSummaryCards({ summary }: { summary: AtendimentoSummary }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {SUMMARY_ITEMS.map((item) => (
        <div
          key={item.key}
          className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
            {item.label}
          </div>
          <div className="mt-3 text-2xl font-semibold tracking-tight text-[var(--app-text-85)]">
            {summary[item.key]}
          </div>
        </div>
      ))}

      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
              Registros de Contratos
            </div>
            <div className="mt-1 text-xs text-[var(--app-text-55)]">
              Visualização frontend para acompanhar contratos do atendimento.
            </div>
          </div>
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-85)]">
            <FileSignature className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {CONTRACT_PREVIEW.map((item) => (
            <div
              key={item.name}
              className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-3"
            >
              <div className="text-sm font-semibold text-[var(--app-text-85)]">{item.name}</div>
              <div className="mt-1 text-xs text-[var(--app-text-55)]">{item.status}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
