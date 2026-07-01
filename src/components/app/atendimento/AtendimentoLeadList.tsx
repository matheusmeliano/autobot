"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { AppModal } from "@/components/app/AppModal";
import { AtendimentoFileGallery } from "@/components/atendimento/AtendimentoFileGallery";
import type { AtendimentoFileRecord, AtendimentoLeadListItem } from "@/lib/atendimento/types";
import { atendimentoStageLabel, atendimentoStatusLabel, formatAtendimentoDateTime } from "@/lib/atendimento/utils";

const PAGE_SIZE = 2;

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
  query,
  loading,
  selectedLeadId,
  onQueryChange,
  onListHeightChange,
  onSelectLead,
  onOpenConversation,
  onDeleteLead,
}: {
  leads: AtendimentoLeadListItem[];
  query: string;
  loading: boolean;
  selectedLeadId: string | null;
  onQueryChange: (value: string) => void;
  onListHeightChange?: (height: number) => void;
  onSelectLead: (leadId: string) => void;
  onOpenConversation: (leadId: string) => void;
  onDeleteLead: (lead: AtendimentoLeadListItem) => Promise<void>;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLead, setProfileLead] = useState<AtendimentoLeadListItem | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [filesLead, setFilesLead] = useState<AtendimentoLeadListItem | null>(null);
  const [leadFiles, setLeadFiles] = useState<AtendimentoFileRecord[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [deleteLead, setDeleteLead] = useState<AtendimentoLeadListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(leads.length / PAGE_SIZE)), [leads.length]);

  useEffect(() => {
    setPage((current) => {
      if (current < 1) return 1;
      if (current > totalPages) return totalPages;
      return current;
    });
  }, [totalPages]);

  const pagedLeads = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return leads.slice(start, start + PAGE_SIZE);
  }, [leads, page]);

  useLayoutEffect(() => {
    if (!onListHeightChange) return;
    if (!rootRef.current) return;

    const emit = () => {
      if (!rootRef.current) return;
      const rect = rootRef.current.getBoundingClientRect();
      const height = Math.ceil(rect.height);
      if (!Number.isFinite(height) || height <= 0) return;
      onListHeightChange(height);
    };

    emit();

    if (typeof window === "undefined") return;
    const ResizeObserverCtor = (window as Window & typeof globalThis).ResizeObserver;
    if (!ResizeObserverCtor) return;

    const observer = new ResizeObserverCtor(() => emit());
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [loading, onListHeightChange, page, pagedLeads.length, query, totalPages]);

  function closeProfile() {
    setProfileOpen(false);
    setProfileLead(null);
  }

  function closeFilesModal() {
    setFilesOpen(false);
    setFilesLead(null);
    setLeadFiles([]);
    setFilesLoading(false);
  }

  function closeDeleteModal() {
    if (deleting) return;
    setDeleteLead(null);
  }

  async function handleConfirmDelete() {
    if (!deleteLead || deleting) return;
    setDeleting(true);
    try {
      await onDeleteLead(deleteLead);
      setDeleteLead(null);
    } finally {
      setDeleting(false);
    }
  }

  async function openFilesModal(lead: AtendimentoLeadListItem) {
    setFilesLead(lead);
    setFilesOpen(true);
    setFilesLoading(true);
    const res = await fetch(`/api/atendimento/leads/${lead.id}/files`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    setLeadFiles(((json?.ok ? json.files : []) ?? []) as AtendimentoFileRecord[]);
    setFilesLoading(false);
  }

  return (
    <div ref={rootRef} className="flex flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] lg:h-full">
      <div className="border-b border-[var(--app-border)] px-4 py-4">
        <div className="text-sm font-semibold text-[var(--app-text-85)]">Lista de Atendimentos</div>
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
            <Search className="h-4 w-4 text-[var(--app-text-45)]" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Pesquisar por nome, telefone ou CPF"
              className="w-full bg-transparent text-sm text-[var(--app-text-85)] outline-none placeholder:text-[var(--app-text-35)]"
            />
          </label>
        </div>
      </div>

      <div className="p-3">
        {pagedLeads.length ? (
          <div className="space-y-4">
            {pagedLeads.map((lead) => {
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
                      ? "border-[var(--app-border)] bg-[var(--app-hover)]"
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

                  <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setProfileLead(lead);
                        setProfileOpen(true);
                      }}
                      className="inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                    >
                      Abrir perfil do lead
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenConversation(String(lead.id));
                      }}
                      className="inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] lg:hidden"
                    >
                      Abrir conversa
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void openFilesModal(lead);
                      }}
                      className="inline-flex items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-3 py-2 text-xs font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
                    >
                      Arquivos
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteLead(lead);
                      }}
                      className="inline-flex items-center justify-center rounded-xl border border-red-400/70 bg-red-500 px-3 py-2 text-xs font-semibold text-[rgb(255,255,255)] hover:bg-red-600"
                    >
                      Excluir lead
                    </button>
                  </div>
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

      {leads.length > PAGE_SIZE ? (
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

      <AppModal open={profileOpen} onClose={closeProfile} size="lg" zIndexClass="z-[320]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[var(--app-text-85)]">Perfil do Lead</div>
            <div className="mt-1 text-xs text-[var(--app-text-55)]">Informações capturadas durante o atendimento.</div>
          </div>
          <button
            type="button"
            onClick={closeProfile}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] p-0 text-[var(--app-text-80)] hover:bg-[var(--app-hover)]"
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

      <AppModal open={filesOpen} onClose={closeFilesModal} size="xl" zIndexClass="z-[320]" fullScreenOnMobile>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[var(--app-text-85)]">Arquivos do Lead</div>
            <div className="mt-1 text-xs text-[var(--app-text-55)]">
              {filesLead ? `Arquivos vinculados a ${filesLead.full_name || filesLead.phone || "Novo Lead"}.` : "Arquivos vinculados ao cliente."}
            </div>
          </div>
          <button
            type="button"
            onClick={closeFilesModal}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] p-0 text-[var(--app-text-80)] hover:bg-[var(--app-hover)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">
          {filesLoading ? (
            <div className="text-sm text-[var(--app-text-55)]">Carregando arquivos...</div>
          ) : (
            <AtendimentoFileGallery
              files={leadFiles}
              emptyMessage="Nenhum arquivo foi enviado ou recebido por este lead ainda."
            />
          )}
        </div>
      </AppModal>

      <AppModal open={Boolean(deleteLead)} onClose={closeDeleteModal} size="md" zIndexClass="z-[130]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[var(--app-text-85)]">Excluir Lead</div>
            <div className="mt-1 text-xs text-[var(--app-text-55)]">
              Essa exclusão é permanente e remove o lead do sistema e do banco de dados sem possibilidade de recuperação.
            </div>
          </div>
          <button
            type="button"
            onClick={closeDeleteModal}
            disabled={deleting}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] p-0 text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-[var(--app-text-85)]">
          {deleteLead ? (
            <>
              Tem certeza que deseja excluir definitivamente o lead{" "}
              <span className="font-semibold">{deleteLead.full_name || deleteLead.phone || "Novo Lead"}</span>?
            </>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={closeDeleteModal}
            disabled={deleting}
            className="inline-flex w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={deleting}
            className="inline-flex w-full items-center justify-center rounded-xl border border-red-400/70 bg-red-500 px-4 py-2 text-sm font-semibold text-[rgb(255,255,255)] hover:bg-red-600 disabled:cursor-not-allowed disabled:text-[rgb(255,255,255)] disabled:opacity-40"
          >
            {deleting ? "Excluindo..." : "Excluir definitivamente"}
          </button>
        </div>
      </AppModal>
    </div>
  );
}
