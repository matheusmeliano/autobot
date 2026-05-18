"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { AppModal } from "@/components/app/AppModal";
import {
  BadgeCheck,
  BarChart3,
  CalendarDays,
  CircleUserRound,
  LayoutDashboard,
  MessageSquareText,
  Plus,
  Settings,
  Smartphone,
  WalletCards,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/app/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/app/clientes", label: "Clientes", icon: CircleUserRound },
  { href: "/app/cobrancas", label: "Cobranças", icon: WalletCards },
  { href: "/app/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/app/whatsapp", label: "WhatsApp", icon: Smartphone },
  { href: "/app/mensagens", label: "Mensagens", icon: MessageSquareText },
  { href: "/app/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/app/assinatura", label: "Assinatura", icon: BadgeCheck },
  { href: "/app/configuracoes", label: "Configurações", icon: Settings },
];

export function AppNav({
  variant,
  restricted,
}: {
  variant: "sidebar" | "bottom";
  restricted?: boolean;
}) {
  const pathname = usePathname();
  const navItems = restricted
    ? NAV_ITEMS.filter((i) => i.href === "/app/assinatura")
    : NAV_ITEMS;

  if (variant === "bottom") {
    const [openMore, setOpenMore] = useState(false);
    const items = navItems.slice(0, 3);
    const moreItems = useMemo(() => navItems.slice(3), [navItems]);
    const plusActive = openMore || moreItems.some((i) => i.href === pathname);

    return (
      <>
        <nav
          className={[
            "grid gap-1 px-2 pb-safe",
            restricted ? "grid-cols-1" : "grid-cols-4",
          ].join(" ")}
        >
          {items.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold",
                  active ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white/85",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          {!restricted && moreItems.length ? (
            <button
              type="button"
              onClick={() => setOpenMore(true)}
              className={[
                "flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold",
                plusActive
                  ? "bg-white/[0.08] text-white"
                  : "text-white/60 hover:bg-white/[0.06] hover:text-white/85",
              ].join(" ")}
            >
              <Plus className="h-4 w-4" />
              Mais
            </button>
          ) : null}
        </nav>

        <AppModal
          open={openMore}
          onClose={() => setOpenMore(false)}
          position="bottom"
          zIndexClass="z-[110]"
          panelClassName="shadow-[0_-30px_90px_-40px_rgba(0,0,0,0.9)]"
        >
          <div className="flex items-center justify-between px-2 py-2">
            <div className="text-sm font-semibold text-white/85">Mais</div>
            <button
              type="button"
              onClick={() => setOpenMore(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/85 hover:bg-white/[0.06]"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 px-2 pb-2">
            {moreItems.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpenMore(false)}
                  className={[
                    "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold",
                    active
                      ? "bg-white/[0.08] text-white"
                      : "border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.06]",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </AppModal>
      </>
    );
  }

  return (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold",
              active ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white/85",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
