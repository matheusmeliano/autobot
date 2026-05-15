"use client";

import { TemplatesClient, type TemplateRow } from "@/components/app/templates/TemplatesClient";
import { useCachedJson } from "@/lib/app/useCachedJson";

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex flex-col gap-4 min-[1201px]:flex-row min-[1201px]:items-end min-[1201px]:justify-between">
        <div className="min-w-0">
          <div className="h-3 w-28 rounded bg-white/10" />
          <div className="mt-3 h-8 w-44 rounded bg-white/10" />
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

export function MensagensPageClient() {
  const { data, loading, error } = useCachedJson<TemplateRow[]>({
    key: "app:mensagens",
    url: "/app/mensagens/data",
    maxAgeMs: 60_000,
  });

  if (!data && loading) return <Skeleton />;

  if (error || !data) {
    return (
      <div>
        <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
          MENSAGENS
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight min-[1201px]:text-3xl">
          Templates
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar seus templates. Tente novamente.
        </div>
      </div>
    );
  }

  return <TemplatesClient initial={data} />;
}

