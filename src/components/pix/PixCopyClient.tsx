"use client";

import { useState } from "react";

type PixCopyClientProps = {
  pixKey: string;
  debtorName?: string | null;
  amount?: string | null;
};

export function PixCopyClient({ pixKey, debtorName, amount }: PixCopyClientProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pixKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#060816] px-4 py-10 text-white">
      <div className="mx-auto w-full max-w-md rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300/80">
            AutoBot
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Copiar PIX</h1>
          <p className="mt-2 text-sm text-white/70">
            Toque no botão abaixo para copiar a chave PIX e concluir o pagamento.
          </p>
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-[#0c1224] p-4">
          {debtorName ? (
            <div className="text-sm text-white/80">
              Cliente: <span className="font-semibold text-white">{debtorName}</span>
            </div>
          ) : null}
          {amount ? (
            <div className="mt-2 text-sm text-white/80">
              Valor: <span className="font-semibold text-white">{amount}</span>
            </div>
          ) : null}

          <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
            Chave PIX
          </div>
          <div
            className="mt-2 break-all rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-medium text-white"
            title={pixKey}
          >
            {pixKey}
          </div>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400"
        >
          {copied ? "PIX copiado" : "Copiar PIX"}
        </button>
      </div>
    </main>
  );
}
