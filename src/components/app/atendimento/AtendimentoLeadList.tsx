"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import type { AtendimentoLeadListItem } from "@/lib/atendimento/types";
import { atendimentoStageLabel, atendimentoStatusLabel, formatAtendimentoDateTime } from "@/lib/atendimento/utils";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">{label}</div>
      <div className="mt-2 text-sm font-semibold text-[var(--app-text-85)]">{value || "-"}</div>
    </div>
  );
}

export function AtendimentoLeadList({
  leads,
  selectedLeadId,
  onSelectLead,
}: {
  leads: AtendimentoLeadListItem[];
  selectedLeadId: string | null;
  onSelectLead: (leadId: string) => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLead, setProfileLead] = useState<AtendimentoLeadListItem | null>(null);

  function closeProfile() {
    setProfileOpen(false);
    setProfileLead(null);
  }

  return (
    <div className="flex flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] lg:h-full">
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
                <div
                  key={lead.id}
                  onClick={() => onSelectLead(lead.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectLead(lead.id);
                    }
                  }}
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

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setProfileLead(lead);
                      setProfileOpen(true);
                    }}
                    className="mt-3 inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                  >
                    Abrir perfil do lead
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full min-h-56 items-center justify-center px-6 text-center text-sm text-[var(--app-text-45)]">
            Nenhum atendimento encontrado com os filtros atuais.
          </div>
        )}
      </div>

      <AppModal open={profileOpen} onClose={closeProfile} size="lg" zIndexClass="z-[120]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[var(--app-text-85)]">Perfil do Lead</div>
            <div className="mt-1 text-xs text-[var(--app-text-55)]">Informações capturadas durante o atendimento.</div>
          </div>
          <button
            type="button"
            onClick={closeProfile}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-80)] hover:bg-[var(--app-hover)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {profileLead ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Nome" value={profileLead.full_name} />
            <Field label="Telefone" value={profileLead.phone} />
            <Field label="CPF" value={profileLead.cpf} />
            <Field label="E-mail" value={profileLead.email} />
            <Field label="Cidade" value={profileLead.city} />
            <Field label="Estado" value={profileLead.state} />
            <Field label="País" value={profileLead.country} />
            <Field label="Timezone" value={profileLead.timezone} />
            <Field label="Melhor horário" value={profileLead.best_contact_time} />
            <Field label="Origem" value={profileLead.origin} />
            <Field label="Status" value={atendimentoStatusLabel(profileLead.status)} />
            <Field label="Etapa" value={atendimentoStageLabel(profileLead.funnel_stage)} />
            <Field label="Criado em" value={formatAtendimentoDateTime(profileLead.created_at)} />
            <Field
              label="Última interação"
              value={formatAtendimentoDateTime(profileLead.last_interaction_at || profileLead.created_at)}
            />
          </div>
        ) : (
          <div className="mt-4 text-sm text-[var(--app-text-55)]">Carregando perfil...</div>
        )}
      </AppModal>
    </div>
  );
}
