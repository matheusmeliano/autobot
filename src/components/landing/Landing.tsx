"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  CreditCard,
  MessageSquareText,
  Shield,
  Zap,
  Bot,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Logo } from "@/components/ui/Logo";

const chartData = [
  { name: "Seg", value: 12 },
  { name: "Ter", value: 18 },
  { name: "Qua", value: 14 },
  { name: "Qui", value: 26 },
  { name: "Sex", value: 22 },
  { name: "Sáb", value: 30 },
  { name: "Dom", value: 28 },
];

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-6">{children}</div>;
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-xs font-semibold tracking-[0.2em] text-white/50">
        {eyebrow}
      </div>
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white md:text-4xl">
        {title}
      </h2>
      <p className="mt-3 text-balance text-sm leading-relaxed text-white/60 md:text-base">
        {description}
      </p>
    </div>
  );
}

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl",
        "shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)]",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export function Landing() {
  return (
    <div className="min-h-screen bg-[#070A10] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-280px] h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.30),rgba(99,102,241,0)_55%)]" />
        <div className="absolute right-[-220px] top-[140px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.22),rgba(16,185,129,0)_55%)]" />
        <div className="absolute left-[-240px] top-[520px] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.18),rgba(59,130,246,0)_55%)]" />
      </div>

      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#070A10]/60 backdrop-blur-xl">
        <Container>
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <Logo />
              <div className="text-sm font-semibold tracking-tight">AutoBot</div>
            </Link>

            <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex">
              <a className="hover:text-white" href="#beneficios">
                Benefícios
              </a>
              <a className="hover:text-white" href="#como-funciona">
                Como funciona
              </a>
              <a className="hover:text-white" href="#planos">
                Planos
              </a>
              <a className="hover:text-white" href="#faq">
                FAQ
              </a>
            </nav>

            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="hidden rounded-xl px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white md:inline-flex"
              >
                Entrar
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black shadow-sm hover:bg-white/90"
              >
                Fazer o teste <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Container>
      </header>

      <main className="relative">
        <section className="pt-16 md:pt-24">
          <Container>
            <div className="grid items-center gap-10 md:grid-cols-[1.2fr_0.8fr]">
              <div>
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/70"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
                  WhatsApp online • PIX pronto para copiar/colar
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: 0.05 }}
                  className="mt-5 text-balance text-4xl font-semibold tracking-tight md:text-6xl"
                >
                  Automatize cobranças no WhatsApp e receba mais no PIX.
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: 0.1 }}
                  className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-white/65 md:text-lg"
                >
                  Envie cobranças automáticas, reduza inadimplência e escale seu
                  negócio com automação inteligente.
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: 0.15 }}
                  className="mt-8 flex flex-col gap-2"
                >
                  <Link
                    href="/signup"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-sm hover:bg-white/90"
                  >
                    Começar gratuitamente <ArrowRight className="h-4 w-4" />
                  </Link>
                  <div className="text-center text-xs font-medium text-white/55">
                    Comece no teste grátis de 7 dias.
                  </div>
                </motion.div>

                <div className="mt-10 grid gap-4 sm:grid-cols-2">
                  {[
                    {
                      icon: <Zap className="h-4 w-4" />,
                      label: "Envios automáticos",
                      value: "Agendamentos + retentativas",
                    },
                    {
                      icon: <BarChart3 className="h-4 w-4" />,
                      label: "Relatórios",
                      value: "Indicadores de cobrança",
                    },
                  ].map((item) => (
                    <GlassCard key={item.label} className="p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-white/70">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.05] ring-1 ring-white/10">
                          {item.icon}
                        </span>
                        {item.label}
                      </div>
                      <div className="mt-3 text-sm text-white/60">
                        {item.value}
                      </div>
                    </GlassCard>
                  ))}
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                <GlassCard className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-white/70">
                      Painel • Visão geral
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-400/20">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      Conectado
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {[
                      { label: "Recebido (mês)", value: "R$ 18.420" },
                      { label: "Cobranças enviadas", value: "312" },
                      { label: "Inadimplentes", value: "27" },
                      { label: "Mensagens", value: "1.284" },
                    ].map((kpi) => (
                      <div
                        key={kpi.label}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <div className="text-[11px] font-semibold text-white/55">
                          {kpi.label}
                        </div>
                        <div className="mt-1 text-lg font-semibold">
                          {kpi.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-[11px] font-semibold text-white/55">
                      Recebimentos (7 dias)
                    </div>
                    <div className="mt-3 h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                          <defs>
                            <linearGradient
                              id="colorValue"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor="rgb(99 102 241)"
                                stopOpacity={0.55}
                              />
                              <stop
                                offset="100%"
                                stopColor="rgb(99 102 241)"
                                stopOpacity={0}
                              />
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
                          <Area
                            type="monotone"
                            dataKey="value"
                            stroke="rgb(99 102 241)"
                            strokeWidth={2}
                            fill="url(#colorValue)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] ring-1 ring-white/10">
                            <MessageSquareText className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-xs font-semibold">
                              Mensagem enviada
                            </div>
                            <div className="text-xs text-white/55">
                              Lembrete amigável • João S.
                            </div>
                          </div>
                        </div>
                        <div className="text-[11px] font-semibold text-white/45">
                          agora
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-white/70">
                        Olá João, tudo bem? Seu pagamento vence hoje. PIX:
                        000.000.000-00
                      </div>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            </div>
          </Container>
        </section>

        <section id="beneficios" className="pt-20 md:pt-28">
          <Container>
            <SectionTitle
              eyebrow="BENEFÍCIOS"
              title="Feito para reduzir inadimplência sem aumentar trabalho."
              description="Tudo que você precisa para cobrar com consistência: automação, templates e visibilidade do que foi enviado e do que foi pago."
            />

            <div className="mt-12 grid grid-cols-1 gap-4 min-[1001px]:grid-cols-3">
              {[
                {
                  icon: <Zap className="h-5 w-5" />,
                  title: "Cobrança automática",
                  desc: "Agende envios e deixe o sistema executar com retentativas.",
                },
                {
                  icon: <MessageSquareText className="h-5 w-5" />,
                  title: "WhatsApp integrado",
                  desc: "Integração com Z-API preparada para múltiplas instâncias.",
                },
                {
                  icon: <CreditCard className="h-5 w-5" />,
                  title: "PIX instantâneo",
                  desc: "Mensagens com chave PIX e variáveis prontas para copiar.",
                },
                {
                  icon: <BadgeCheck className="h-5 w-5" />,
                  title: "Redução da inadimplência",
                  desc: "Cadência de cobrança e lembretes na hora certa.",
                },
                {
                  icon: <BarChart3 className="h-5 w-5" />,
                  title: "Relatórios inteligentes",
                  desc: "KPIs claros: enviados, falhas, pagos e inadimplência.",
                },
                {
                  icon: <Shield className="h-5 w-5" />,
                  title: "Gestão simplificada",
                  desc: "Um painel rápido e minimalista para operação diária.",
                },
              ].map((b) => (
                <GlassCard key={b.title} className="p-5">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05] ring-1 ring-white/10">
                    {b.icon}
                  </div>
                  <div className="mt-4 text-sm font-semibold">{b.title}</div>
                  <div className="mt-2 text-sm leading-relaxed text-white/60">
                    {b.desc}
                  </div>
                </GlassCard>
              ))}
            </div>
          </Container>
        </section>

        <section id="como-funciona" className="pt-20 md:pt-28">
          <Container>
            <SectionTitle
              eyebrow="COMO FUNCIONA"
              title="Da conexão ao envio: um fluxo simples."
              description="Conecte seu WhatsApp, cadastre seus clientes e automatize cobranças com templates e agendamentos."
            />

            <div className="mt-12 grid gap-4 md:grid-cols-4">
              {[
                {
                  step: "01",
                  title: "Conecte seu WhatsApp",
                  description:
                    "Escaneie o QR Code e acompanhe a conexão em tempo real.",
                },
                {
                  step: "02",
                  title: "Cadastre clientes",
                  description:
                    "Organize contatos com telefone, valor, vencimento e status.",
                },
                {
                  step: "03",
                  title: "Configure mensagens",
                  description:
                    "Crie templates e personalize com nome, valor e data automaticamente.",
                },
                {
                  step: "04",
                  title: "Envio automático",
                  description:
                    "Agende cobranças, retentativas e acompanhe logs e histórico.",
                },
              ].map((item) => (
                <GlassCard key={item.step} className="p-5">
                  <div className="text-xs font-semibold text-white/45">
                    {item.step}
                  </div>
                  <div className="mt-2 text-sm font-semibold">{item.title}</div>
                  <div className="mt-2 text-sm text-white/60">
                    {item.description}
                  </div>
                </GlassCard>
              ))}
            </div>
          </Container>
        </section>

        <section id="planos" className="pt-20 md:pt-28">
          <Container>
            <SectionTitle
              eyebrow="PLANOS"
              title="Um plano para cada fase."
              description="Comece com o teste gratuito de 7 dias e evolua para o plano ideal conforme aumentar o volume de cobranças e a sua operação."
            />

            <div className="mt-12 grid grid-cols-1 gap-4 min-[1001px]:grid-cols-3">
              {[
                {
                  name: "Básico",
                  price: "R$ 49/mês",
                  highlight: false,
                  items: ["1 instância WhatsApp", "Agendamentos", "Templates básicos"],
                },
                {
                  name: "Pro",
                  price: "R$ 99/mês",
                  highlight: true,
                  items: [
                    "Tudo do Básico",
                    "Retentativas inteligentes",
                    "Relatórios completos",
                  ],
                },
                {
                  name: "Vitalício",
                  price: "R$ 2.490/único",
                  highlight: false,
                  items: [
                    "Tudo do Básico e Pro",
                    "Sem mensalidades. Seu para sempre!",
                  ],
                },
              ].map((plan) => (
                <GlassCard
                  key={plan.name}
                  className={[
                    "flex h-full flex-col p-6",
                    plan.highlight
                      ? "ring-1 ring-indigo-400/30 shadow-[0_0_0_1px_rgba(99,102,241,0.28),0_40px_100px_-40px_rgba(99,102,241,0.7)]"
                      : "",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{plan.name}</div>
                      <div className="mt-2 whitespace-nowrap text-[clamp(1.25rem,7vw,1.875rem)] font-semibold tracking-tight leading-none">
                        {plan.price}
                      </div>
                    </div>
                    {plan.highlight ? (
                      <div className="shrink-0 whitespace-nowrap rounded-full bg-indigo-500/15 px-3 py-1 text-[11px] font-semibold text-indigo-200 ring-1 ring-indigo-400/20">
                        Mais escolhido
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-6 flex-1 space-y-3 text-sm text-white/70">
                    {plan.items.map((item) => (
                      <div key={item} className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-white/50" />
                        {item}
                      </div>
                    ))}
                  </div>

                  <Link
                    href="/signup"
                    className={[
                      "mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold",
                      plan.highlight
                        ? "bg-white text-black hover:bg-white/90"
                        : "border border-white/10 bg-white/[0.04] text-white/85 hover:bg-white/[0.06]",
                    ].join(" ")}
                  >
                    Começar <ArrowRight className="h-4 w-4" />
                  </Link>
                </GlassCard>
              ))}
            </div>
          </Container>
        </section>

        <section id="faq" className="pt-20 md:pt-28">
          <Container>
            <SectionTitle
              eyebrow="FAQ"
              title="Perguntas frequentes."
              description="Respostas rápidas e suporte pensado para você começar com segurança, testar a plataforma e evoluir sua operação com mais confiança."
            />

            <div className="mt-12 grid gap-4 md:grid-cols-2">
              {[
                {
                  q: "Preciso instalar algo?",
                  a: "Não. É 100% web. Você acessa pelo navegador e conecta seu WhatsApp.",
                },
                {
                  q: "Funciona com qualquer WhatsApp?",
                  a: "Funciona com WhatsApp comum. A conexão é feita via Z-API (conforme seu plano).",
                },
                {
                  q: "Posso cancelar quando quiser?",
                  a: "Sim. Você pode cancelar ou trocar de plano a qualquer momento.",
                },
                {
                  q: "Tem teste grátis?",
                  a: "Podemos habilitar período de trial no plano Pro (configurável).",
                },
              ].map((item) => (
                <GlassCard key={item.q} className="p-5">
                  <div className="text-sm font-semibold">{item.q}</div>
                  <div className="mt-2 text-sm leading-relaxed text-white/60">
                    {item.a}
                  </div>
                </GlassCard>
              ))}
            </div>
          </Container>
        </section>

        <section className="pt-20 md:pt-28">
          <Container>
            <GlassCard className="p-8 md:p-10">
              <div className="grid items-center gap-8 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold tracking-[0.2em] text-white/50">
                    PRONTO PARA ESCALAR
                  </div>
                  <div className="mt-3 text-balance text-3xl font-semibold tracking-tight md:text-4xl">
                    Pare de cobrar manualmente.
                  </div>
                  <div className="mt-3 text-sm leading-relaxed text-white/60">
                    Automatize cobranças no WhatsApp com templates e agendamentos.
                    Mais consistência, menos fricção, mais recebimentos.
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/signup"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90"
                  >
                    Começar gratuitamente <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </GlassCard>
          </Container>
        </section>

        <footer className="pt-16">
          <Container>
            <div className="border-t border-white/5 py-10">
              <div className="grid gap-10 md:grid-cols-2">
                <div>
                  <Link href="/" className="flex items-center gap-2">
                    <Logo />
                    <div className="text-sm font-semibold tracking-tight">
                      AutoBot
                    </div>
                  </Link>
                  <div className="mt-3 max-w-sm text-sm text-white/55">
                    Plataforma SaaS que automatiza cobranças via WhatsApp com
                    geração de PIX integrada.
                  </div>
                  <div className="mt-4 text-xs text-white/35">
                    © {new Date().getFullYear()} AutoBot. Todos os direitos
                    reservados.
                  </div>
                  <div className="mt-4 text-xs text-white/35">
                    Desenvolvido pela{" "}
                    <a
                      href="#"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-white/60 hover:text-white"
                    >
                      HEYBROTHERS
                    </a>
                    .
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6 text-sm text-white/60 md:grid-cols-3 md:justify-end md:text-right">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold tracking-[0.2em] text-white/40">
                      PRODUTO
                    </div>
                    <a className="block hover:text-white" href="#beneficios">
                      Benefícios
                    </a>
                    <a className="block hover:text-white" href="#planos">
                      Planos
                    </a>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold tracking-[0.2em] text-white/40">
                      EMPRESA
                    </div>
                    <Link className="block hover:text-white" href="/termos">
                      Termos
                    </Link>
                    <Link className="block hover:text-white" href="/privacidade">
                      Privacidade
                    </Link>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold tracking-[0.2em] text-white/40">
                      SOCIAL
                    </div>
                    <a className="block hover:text-white" href="#">
                      Instagram
                    </a>
                    <Link className="block hover:text-white" href="/linkedin">
                      LinkedIn
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </footer>
      </main>
    </div>
  );
}

