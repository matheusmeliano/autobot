"use client";

import type { AtendimentoSummary } from "@/lib/atendimento/types";

const SUMMARY_ITEMS: Array<{ key: keyof AtendimentoSummary; label: string }> = [
  { key: "totalLeads", label: "Interessados" },
  { key: "matriculados", label: "Alunos" },
  { key: "aulasExperimentaisAgendadas", label: "Agendamentos" },
];

export function AtendimentoSummaryCards({ summary }: { summary: AtendimentoSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
          Contratos
        </div>
        <div className="mt-3 text-2xl font-semibold tracking-tight text-[var(--app-text-85)]">
          0
        </div>
      </div>
    </div>
  );
}
