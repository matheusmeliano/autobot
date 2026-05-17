"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, MessageSquareText, Smartphone, WalletCards } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

type StatPack = {
  totalReceived: number;
  chargesSent: number;
  messages: number;
  whatsappStatus: string;
};

type ChartPoint = { name: string; value: number };

function Card({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-white/55">{title}</div>
          <div className="mt-2 truncate text-2xl font-semibold tracking-tight">{value}</div>
          <div className="mt-1 text-xs text-white/45">{subtitle}</div>
        </div>
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05] ring-1 ring-white/10">
          {icon}
        </div>
      </div>
    </div>
  );
}

export function DashboardClient({
  email,
  stats,
  chart,
}: {
  email: string;
  stats: StatPack;
  chart: ChartPoint[];
}) {
  const statusLabel =
    stats.whatsappStatus === "connected"
      ? "conectado"
      : stats.whatsappStatus === "configured"
        ? "configurado"
        : "Desconectado";

  const money = stats.totalReceived.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col justify-between gap-4 min-[1201px]:flex-row min-[1201px]:items-end"
      >
        <div>
          <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
            PAINEL
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight min-[1201px]:text-3xl">
            Seja Bem-vindo(a)
          </h1>
          <div className="mt-2 text-sm text-white/60">{email}</div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-white/70">
          <span
            className={[
              "h-2 w-2 rounded-full shadow-[0_0_0_4px_rgba(16,185,129,0.12)]",
              statusLabel === "conectado"
                ? "bg-emerald-400"
                : statusLabel === "configurado"
                  ? "bg-indigo-300"
                  : "bg-white/30",
            ].join(" ")}
          />
          WhatsApp: {statusLabel}
        </div>
      </motion.div>

      <div className="mt-6 grid gap-4 min-[1201px]:grid-cols-4">
        <Card
          title="Total recebido (mês)"
          value={money}
          subtitle="Marcado como pago"
          icon={<ArrowUpRight className="h-5 w-5" />}
        />
        <Card
          title="Cobranças enviadas"
          value={String(stats.chargesSent)}
          subtitle="Status enviado + pago"
          icon={<WalletCards className="h-5 w-5" />}
        />
        <Card
          title="Mensagens"
          value={String(stats.messages)}
          subtitle="Total de cobranças criadas"
          icon={<MessageSquareText className="h-5 w-5" />}
        />
        <Card
          title="Status WhatsApp"
          value={statusLabel}
          subtitle="Config em WhatsApp"
          icon={<Smartphone className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid gap-4 min-[1201px]:grid-cols-5">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 min-[1201px]:col-span-3">
          <div className="text-sm font-semibold">Cobranças criadas (7 dias)</div>
          <div className="mt-1 text-xs text-white/45">
            Dados reais das cobranças cadastradas.
          </div>
          <div className="mt-4 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <defs>
                  <linearGradient id="dashValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="name"
                  tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15, 23, 42, 0.9)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 12,
                  }}
                  labelStyle={{ color: "rgba(255,255,255,0.7)" }}
                  itemStyle={{ color: "white" }}
                  formatter={(v: any) => [v, "Quantidade"]}
                  labelFormatter={(l: any) => `Dia: ${l}`}
                />
                <Area type="monotone" dataKey="value" stroke="rgb(99 102 241)" strokeWidth={2} fill="url(#dashValue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 min-[1201px]:col-span-2">
          <div className="text-sm font-semibold">Atividades</div>
          <div className="mt-1 text-xs text-white/45">
            Execuções, retentativas e logs aparecem aqui
          </div>
          <div className="mt-4 space-y-3">
            {[
              { title: "Envio agendado", desc: "Nenhum agendamento criado ainda" },
              { title: "Cobrança", desc: "Nenhuma cobrança enviada ainda" },
              { title: "WhatsApp", desc: "Instância não conectada" },
            ].map((i) => (
              <div key={i.title} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="text-xs font-semibold">{i.title}</div>
                <div className="mt-1 text-xs text-white/55">{i.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
