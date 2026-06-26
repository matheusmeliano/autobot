"use client";

import type { AtendimentoHistoryEvent, AtendimentoLead } from "@/lib/atendimento/types";
import { atendimentoStageLabel, atendimentoStatusLabel, formatAtendimentoDate, formatAtendimentoDateTime } from "@/lib/atendimento/utils";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-[var(--app-text-85)]">{value || "-"}</div>
    </div>
  );
}

export function AtendimentoLeadSidebar({
  lead,
  events,
}: {
  lead: AtendimentoLead | null;
  events: AtendimentoHistoryEvent[];
}) {
  if (!lead) {
    return (
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 text-sm text-[var(--app-text-45)]">
        Selecione um atendimento para ver os dados do lead e o histórico.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4">
        <div className="text-sm font-semibold text-[var(--app-text-85)]">Perfil do Lead</div>
        <div className="mt-4 grid gap-3">
          <Field label="Nome" value={lead.full_name} />
          <Field label="Telefone" value={lead.phone} />
          <Field label="CPF" value={lead.cpf} />
          <Field label="E-mail" value={lead.email} />
          <Field label="Cidade" value={lead.city} />
          <Field label="Estado" value={lead.state} />
          <Field label="País" value={lead.country} />
          <Field label="Timezone" value={lead.timezone} />
          <Field label="Melhor horário" value={lead.best_contact_time} />
          <Field label="Origem" value={lead.origin} />
          <Field label="Status" value={atendimentoStatusLabel(lead.status)} />
          <Field label="Etapa" value={atendimentoStageLabel(lead.funnel_stage)} />
          <Field label="Criado em" value={formatAtendimentoDateTime(lead.created_at)} />
          <Field
            label="Última interação"
            value={lead.last_interaction_at ? formatAtendimentoDateTime(lead.last_interaction_at) : "-"}
          />
          <Field label="Data base" value={formatAtendimentoDate(lead.created_at)} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)]">
        <div className="border-b border-[var(--app-border)] px-4 py-4">
          <div className="text-sm font-semibold text-[var(--app-text-85)]">Histórico</div>
          <div className="mt-1 text-xs text-[var(--app-text-45)]">
            Mudanças de etapa, dados capturados e eventos do atendimento.
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {events.length ? (
            events.map((event) => (
              <div key={event.id} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] p-3">
                <div className="text-sm font-semibold text-[var(--app-text-85)]">{event.title}</div>
                <div className="mt-1 text-xs text-[var(--app-text-55)]">
                  {formatAtendimentoDateTime(event.created_at)}
                </div>
                {event.details ? (
                  <pre className="mt-3 whitespace-pre-wrap break-words text-[11px] text-[var(--app-text-55)]">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))
          ) : (
            <div className="text-sm text-[var(--app-text-45)]">Ainda não há eventos registrados para este lead.</div>
          )}
        </div>
      </div>
    </div>
  );
}
