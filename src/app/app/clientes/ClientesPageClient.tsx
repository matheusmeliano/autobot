"use client";

import Link from "next/link";
import { DebtorsClient, type DebtorRow } from "@/components/app/debtors/DebtorsClient";
import { useCachedJson } from "@/lib/app/useCachedJson";

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex flex-col gap-4 min-[1201px]:flex-row min-[1201px]:items-end min-[1201px]:justify-between">
        <div className="min-w-0">
          <div className="h-3 w-24 rounded bg-white/10" />
          <div className="mt-3 h-8 w-64 rounded bg-white/10" />
          <div className="mt-3 h-4 w-72 rounded bg-white/10" />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="h-10 w-full rounded-xl bg-white/10 sm:w-72" />
          <div className="h-10 w-full rounded-xl bg-white/10 sm:w-40" />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="h-4 w-40 rounded bg-white/10" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 w-full rounded-xl bg-white/5" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ClientesPageClient() {
  const { data, loading, error } = useCachedJson<DebtorRow[]>({
    key: "app:clientes",
    url: "/app/clientes/data",
    maxAgeMs: 60_000,
  });

  if (!data && loading) return <Skeleton />;

  if (error || !data) {
    return (
      <div>
        <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
          CLIENTES
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight min-[1201px]:text-3xl">
          Clientes e devedores
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar agora. Verifique se você está logado.
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="text-sm font-semibold">Como corrigir</div>
          <div className="mt-2 text-sm text-white/60">
            Verifique se a migration foi aplicada no Supabase e recarregue.
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/app/dashboard"
              className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90"
            >
              Voltar para o painel
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
            >
              Ir para a página inicial
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <DebtorsClient initial={data} />;
}

