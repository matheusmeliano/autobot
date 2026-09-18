"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.error("[AutoBot] Erro capturado (error boundary):", error);
    }
  }, [error]);

  const rawMsg = String(error?.message ?? "").trim();
  const low = rawMsg.toLowerCase();

  let title = "Algo deu errado";
  let body =
    "Ocorreu um erro inesperado. Atualize a página e tente novamente.";

  if (low.includes("image") || low.includes("imagem") || low.includes("arquivo")) {
    title = "Erro ao processar imagem ou arquivo";
    body =
      "Formato ou tamanho incompatível. Use JPG, JPEG, PNG, WEBP ou GIF com no máximo 5 MB e tente novamente.";
  } else if (
    low.includes("upload") ||
    low.includes("enviar") ||
    low.includes("envio")
  ) {
    title = "Erro no envio";
    body =
      "Não foi possível enviar o arquivo agora. Verifique sua conexão, tente novamente ou use um arquivo menor.";
  } else if (low.includes("storage") || low.includes("supabase") || low.includes("bucket")) {
    title = "Erro ao acessar o armazenamento";
    body =
      "Não foi possível salvar o arquivo. Tente novamente em instantes.";
  } else if (low.includes("tamanho") || low.includes("size") || low.includes("file too large")) {
    title = "Arquivo muito grande";
    body = "O arquivo excede o tamanho máximo permitido (5 MB).";
  } else if (low.includes("tipo") || low.includes("mime") || low.includes("mime type") || low.includes("not allowed")) {
    title = "Tipo de arquivo não permitido";
    body =
      "Use um formato compatível: JPG, JPEG, PNG, WEBP ou GIF.";
  }

  return (
    <div className="app-theme min-h-screen w-full bg-[#efeeed]" data-theme="light">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-4 py-10">
        <div className="w-full rounded-2xl border border-[var(--app-border)] bg-white p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <div className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--app-active)] bg-[color:var(--app-active)]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#9a3412"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold tracking-tight text-[var(--app-text-85)]">
                {title}
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--app-text-60)]">
                {body}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => {
                try {
                  reset();
                } catch {
                  window.location.reload();
                }
              }}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--app-border)] bg-white px-5 text-[15px] font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] sm:w-auto"
            >
              Tentar novamente
            </button>
            <Link
              href="/app"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#ea580c] px-5 text-[15px] font-semibold !text-white hover:bg-[#ea580c]/90 sm:w-auto"
            >
              Voltar ao painel
            </Link>
          </div>

          {rawMsg ? (
            <details className="mt-5 rounded-xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] p-3">
              <summary className="cursor-pointer select-none text-[13px] font-semibold text-[var(--app-text-65)]">
                Detalhes técnicos
              </summary>
              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--app-border)] bg-white p-3 text-[12px] leading-relaxed text-[var(--app-text-60)]">
                {rawMsg}
              </pre>
            </details>
          ) : null}
        </div>

        <p className="mt-5 text-[12px] text-[var(--app-text-45)]">
          Se o erro persistir, contate o suporte.
        </p>
      </div>
    </div>
  );
}
