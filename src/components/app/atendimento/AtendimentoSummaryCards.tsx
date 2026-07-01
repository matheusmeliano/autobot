"use client";

import type { AtendimentoSummary } from "@/lib/atendimento/types";

const SUMMARY_ITEMS: Array<{ label: string; value: number }> = [
  { label: "Alunos", value: 0 },
  { label: "Agendamentos", value: 0 },
];

export function AtendimentoSummaryCards({ summary }: { summary: AtendimentoSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
          Interessados
        </div>
        <div className="mt-3 text-2xl font-semibold tracking-tight text-[var(--app-text-85)]">
          {summary.totalLeads}
        </div>
      </div>

      {SUMMARY_ITEMS.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
            {item.label}
          </div>
          <div className="mt-3 text-2xl font-semibold tracking-tight text-[var(--app-text-85)]">
            {item.value}
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
