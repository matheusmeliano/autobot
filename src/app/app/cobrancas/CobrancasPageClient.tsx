"use client";

import {
  ChargesClient,
  type ChargeRow,
  type DebtorOption,
  type TemplateOption,
} from "@/components/app/charges/ChargesClient";
import { useCachedJson } from "@/lib/app/useCachedJson";

type Payload = {
  rows: ChargeRow[];
  debtors: DebtorOption[];
  templates: TemplateOption[];
};

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-3 w-28 rounded bg-white/10" />
      <div className="mt-3 h-8 w-48 rounded bg-white/10" />
      <div className="mt-3 h-4 w-72 rounded bg-white/10" />

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="h-4 w-52 rounded bg-white/10" />
        <div className="mt-4 grid gap-3 min-[1201px]:grid-cols-2">
          <div className="h-10 rounded-xl bg-white/10" />
          <div className="h-10 rounded-xl bg-white/10" />
          <div className="h-24 rounded-xl bg-white/10 min-[1201px]:col-span-2" />
          <div className="h-10 rounded-xl bg-white/10 min-[1201px]:col-span-2" />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="h-4 w-36 rounded bg-white/10" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 w-full rounded-xl bg-white/5" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CobrancasPageClient() {
  const { data, loading, error } = useCachedJson<Payload>({
    key: "app:cobrancas:bootstrap",
    url: "/app/cobrancas/bootstrap",
    maxAgeMs: 60_000,
  });

  if (!data && loading) return <Skeleton />;

  if (error || !data) {
    return (
      <div>
        <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
          COBRANÇAS
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight min-[1201px]:text-3xl">
          Cobranças
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar seus dados. Tente novamente.
        </div>
      </div>
    );
  }

  return (
    <ChargesClient
      initial={data.rows}
      debtors={data.debtors}
      templates={data.templates}
    />
  );
}

