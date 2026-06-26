"use client";

import type { AtendimentoLeadListItem } from "@/lib/atendimento/types";
import { atendimentoStageLabel, atendimentoStatusLabel, formatAtendimentoDateTime } from "@/lib/atendimento/utils";

export function AtendimentoLeadList({
  leads,
  selectedLeadId,
  onSelectLead,
}: {
  leads: AtendimentoLeadListItem[];
  selectedLeadId: string | null;
  onSelectLead: (leadId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)]">
      <div className="border-b border-[var(--app-border)] px-4 py-4">
        <div className="text-sm font-semibold text-[var(--app-text-85)]">Lista de Atendimentos</div>
        <div className="mt-1 text-xs text-[var(--app-text-45)]">
          Leads organizados por última interação.
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {leads.length ? (
          <div className="space-y-2">
            {leads.map((lead) => {
              const active = selectedLeadId === lead.id;
              const unread = Number(lead.unread_count ?? 0);
              return (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onSelectLead(lead.id)}
                  className={[
                    "w-full rounded-2xl border px-4 py-3 text-left transition-all",
                    active
                      ? "border-[var(--app-border)] bg-[var(--app-active)]"
                      : "border-[var(--app-border)] bg-[var(--app-card)] hover:bg-[var(--app-hover)]",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--app-text-85)]">
                        {lead.full_name || "Novo Lead"}
                      </div>
                      <div className="mt-1 text-xs text-[var(--app-text-55)]">
                        {lead.phone || "Telefone ainda não informado"}
                      </div>
                    </div>
                    {unread > 0 ? (
                      <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white">
                        {unread}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 truncate text-xs text-[var(--app-text-60)]">
                    {lead.conversation?.last_message_preview || "Sem mensagens ainda."}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--app-text-45)]">
                    <span className="rounded-full border border-[var(--app-border)] px-2 py-1">
                      {atendimentoStatusLabel(lead.status)}
                    </span>
                    <span className="rounded-full border border-[var(--app-border)] px-2 py-1">
                      {atendimentoStageLabel(lead.funnel_stage)}
                    </span>
                    <span>{formatAtendimentoDateTime(lead.last_interaction_at || lead.created_at)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full min-h-56 items-center justify-center px-6 text-center text-sm text-[var(--app-text-45)]">
            Nenhum atendimento encontrado com os filtros atuais.
          </div>
        )}
      </div>
    </div>
  );
}
