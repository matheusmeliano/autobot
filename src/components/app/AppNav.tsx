"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  BarChart3,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  Smartphone,
} from "lucide-react";

export type AppPlan = "teste" | "basico" | "pro" | "vitalicio";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { href: "/app/dashboard", label: "Painel", icon: LayoutDashboard },
      { href: "/app/clientes", label: "Clientes", icon: CircleUserRound },
      { href: "/app/mensagens", label: "Mensagens", icon: MessageSquareText },
      { href: "/app/agendar", label: "Agendar", icon: CalendarDays },
      { href: "/app/whatsapp", label: "WhatsApp", icon: Smartphone },
    ],
  },
  {
    label: "Gestão",
    items: [
      { href: "/app/assinatura", label: "Assinatura", icon: BadgeCheck },
      { href: "/app/relatorios", label: "Relatórios", icon: BarChart3 },
    ],
  },
  {
    label: "Conta",
    items: [{ href: "/app/configuracoes", label: "Configurações", icon: Settings }],
  },
];

function getVisibleNavGroups({
  restricted,
  plan,
}: {
  restricted?: boolean;
  plan?: AppPlan;
}) {
  if (restricted) {
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => item.href === "/app/assinatura" || item.href === "/app/configuracoes",
      ),
    })).filter((group) => group.items.length > 0);
  }

  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.href !== "/app/relatorios") return true;
      return plan === "pro" || plan === "vitalicio";
    }),
  })).filter((group) => group.items.length > 0);
}

export function AppNav({
  variant,
  restricted,
  plan,
  onNavigate,
}: {
  variant: "sidebar" | "drawer";
  restricted?: boolean;
  plan?: AppPlan;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const navGroups = getVisibleNavGroups({ restricted, plan });
  const navItems = navGroups.flatMap((group) => group.items);

  if (variant === "drawer") {
    return (
      <nav className="flex flex-col gap-5">
        {navGroups.map((group) => (
          <div
            key={group.label}
            className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-2"
          >
            <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-45)]">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={[
                      "group flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-semibold transition-all duration-200",
                      active
                        ? "border-[var(--app-border)] bg-[var(--app-card-2)] text-[var(--app-text-85)]"
                        : "border-transparent text-[var(--app-text-70)] hover:border-[var(--app-border)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-colors",
                        active
                          ? "border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-85)]"
                          : "border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-60)] group-hover:text-[var(--app-text-85)]",
                      ].join(" ")}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{item.label}</div>
                    </div>
                    {!active ? (
                      <ChevronRight className="h-4 w-4 text-[var(--app-text-35)] transition-transform group-hover:translate-x-0.5" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
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
              active
                ? "bg-[var(--app-active)] text-[var(--app-text-85)]"
                : "text-[var(--app-text-60)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]",
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
