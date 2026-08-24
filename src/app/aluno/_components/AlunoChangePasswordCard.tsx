"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function AlunoChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [nextPwd, setNextPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [statusMsg, setStatusMsg] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const busy = isPending;

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setStatusMsg(null);
    const cur = current.trim();
    const np = nextPwd.trim();
    const cf = confirm.trim();

    if (!cur) {
      setStatusMsg({ kind: "error", text: "Informe a senha atual." });
      return;
    }
    if (np.length < 4) {
      setStatusMsg({
        kind: "error",
        text: "A nova senha deve ter no mínimo 4 caracteres.",
      });
      return;
    }
    if (np !== cf) {
      setStatusMsg({
        kind: "error",
        text: "A confirmação da nova senha não confere.",
      });
      return;
    }

    startTransition(async () => {
      try {
        const resp = await fetch("/api/aluno/alterar-senha", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            current_password: cur,
            new_password: np,
            confirm_password: cf,
          }),
        });
        const payload = (await resp.json().catch(() => null)) as
          | { ok?: boolean; error?: string }
          | null;
        if (!resp.ok || !payload?.ok) {
          setStatusMsg({
            kind: "error",
            text: payload?.error ?? "Falha ao alterar a senha.",
          });
          return;
        }
        setCurrent("");
        setNextPwd("");
        setConfirm("");
        setStatusMsg({
          kind: "success",
          text: "Senha atualizada com sucesso.",
        });
      } catch (err) {
        setStatusMsg({
          kind: "error",
          text: err instanceof Error ? err.message : "Falha ao alterar a senha.",
        });
      }
    });
  }

  return (
    <div className="w-full rounded-2xl border border-sky-500/20 bg-sky-500/10 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30">
            <KeyRound className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100/85">
              Senha de acesso
            </div>
            <div className="mt-0.5 text-sm font-semibold text-[var(--app-text-85)]">
              Alterar senha de matrícula
            </div>
          </div>
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-4 grid min-w-0 items-stretch gap-3 md:grid-cols-1"
        noValidate
      >
        <label className="w-full min-w-0 flex flex-col items-stretch gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-text-45)]">
            Senha atual
          </span>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Digite a senha atual"
            className="inline-flex min-h-[44px] w-full items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2.5 text-sm font-medium text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] outline-none transition focus:border-sky-500/55 focus:ring-2 focus:ring-sky-500/25"
            disabled={busy}
          />
        </label>

        <div className="grid min-w-0 items-stretch gap-3 md:grid-cols-2">
          <label className="w-full min-w-0 flex flex-col items-stretch gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-text-45)]">
              Nova senha
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={nextPwd}
              onChange={(e) => setNextPwd(e.target.value)}
              placeholder="Mínimo 4 caracteres"
              className="inline-flex min-h-[44px] w-full items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2.5 text-sm font-medium text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] outline-none transition focus:border-sky-500/55 focus:ring-2 focus:ring-sky-500/25"
              disabled={busy}
            />
          </label>

          <label className="w-full min-w-0 flex flex-col items-stretch gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-text-45)]">
              Confirmar nova senha
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repita a nova senha"
              className="inline-flex min-h-[44px] w-full items-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2.5 text-sm font-medium text-[var(--app-text-85)] placeholder:text-[var(--app-text-45)] outline-none transition focus:border-sky-500/55 focus:ring-2 focus:ring-sky-500/25"
              disabled={busy}
            />
          </label>
        </div>

        {statusMsg && (
          <div
            className={`inline-flex min-h-[44px] w-full items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold ${
              statusMsg.kind === "success"
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
                : "border-red-500/30 bg-red-500/10 text-red-200"
            }`}
          >
            {statusMsg.kind === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{statusMsg.text}</span>
          </div>
        )}

        <div className="mt-1 flex w-full items-center justify-stretch sm:justify-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-[44px] w-full shrink-0 sm:w-auto items-center justify-center gap-2 rounded-full border border-sky-500/35 bg-sky-500/15 px-4 py-2.5 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="shrink-0">Salvar nova senha</span>
          </button>
        </div>
      </form>
    </div>
  );
}
