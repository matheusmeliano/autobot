"use client";

import { DashboardClient } from "@/components/app/DashboardClient";
import { useSessionStore } from "@/lib/app/sessionStore";
import { useCachedJson } from "@/lib/app/useCachedJson";

type Payload = {
  stats: {
    totalReceived: number;
    chargesSent: number;
    messages: number;
    whatsappStatus: string;
  };
  chart: Array<{ name: string; value: number }>;
};

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex flex-col justify-between gap-4 min-[1201px]:flex-row min-[1201px]:items-end">
        <div className="min-w-0">
          <div className="h-3 w-24 rounded bg-white/10" />
          <div className="mt-3 h-8 w-56 rounded bg-white/10" />
          <div className="mt-3 h-4 w-48 rounded bg-white/10" />
        </div>
        <div className="h-9 w-44 rounded-full bg-white/10" />
      </div>

      <div className="mt-6 grid gap-4 min-[1201px]:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="h-3 w-32 rounded bg-white/10" />
            <div className="mt-3 h-7 w-40 rounded bg-white/10" />
            <div className="mt-2 h-3 w-28 rounded bg-white/10" />
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 min-[1201px]:grid-cols-5">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 min-[1201px]:col-span-3">
          <div className="h-4 w-48 rounded bg-white/10" />
          <div className="mt-4 h-40 rounded-xl bg-white/5" />
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 min-[1201px]:col-span-2">
          <div className="h-4 w-32 rounded bg-white/10" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="h-3 w-28 rounded bg-white/10" />
                <div className="mt-2 h-3 w-40 rounded bg-white/10" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardPageClient() {
  const email = useSessionStore((s) => s.email);
  const { data, loading, error } = useCachedJson<Payload>({
    key: "app:dashboard",
    url: "/app/dashboard/data",
    maxAgeMs: 30_000,
  });

  if (!data && loading) return <Skeleton />;

  if (error || !data) {
    return (
      <div>
        <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
          PAINEL
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight min-[1201px]:text-3xl">
          Painel
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar agora. Tente novamente.
        </div>
      </div>
    );
  }

  return <DashboardClient email={email} stats={data.stats} chart={data.chart} />;
}

