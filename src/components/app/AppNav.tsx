"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  BarChart3,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  Headset,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  Shield,
  Smartphone,
} from "lucide-react";
import { isGlobalAdminEmail } from "@/lib/auth/admin";

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

const ATENDIMENTO_MENU_EMAIL = "atendimento.usa.music@gmail.com";

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { href: "/app/dashboard", label: "Painel", icon: LayoutDashboard },
      { href: "/app/clientes", label: "Clientes", icon: CircleUserRound },
      { href: "/app/mensagens", label: "Mensagens", icon: MessageSquareText },
      { href: "/app/agendar", label: "Agendar", icon: CalendarDays },
      { href: "/app/atendimento", label: "Atendimento", icon: Headset },
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
  userEmail,
}: {
  restricted?: boolean;
  plan?: AppPlan;
  userEmail?: string;
}) {
  const normalizedEmail = String(userEmail ?? "").trim().toLowerCase();
  const canSeeAtendimento = normalizedEmail === ATENDIMENTO_MENU_EMAIL;

  if (restricted) {
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.href !== "/app/atendimento" &&
          (item.href === "/app/assinatura" ||
            item.href === "/app/configuracoes" ||
            item.href === "/app/whatsapp"),
      ),
    })).filter((group) => group.items.length > 0);
  }

  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.href === "/app/atendimento") return canSeeAtendimento;
      if (item.href !== "/app/relatorios") return true;
      return plan === "pro" || plan === "vitalicio";
    }),
  })).filter((group) => group.items.length > 0);
}

export function AppNav({
  variant,
  restricted,
  plan,
  userEmail,
  onNavigate,
}: {
  variant: "sidebar" | "drawer";
  restricted?: boolean;
  plan?: AppPlan;
  userEmail?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const navGroups = getVisibleNavGroups({ restricted, plan, userEmail });
  const navItems = navGroups.flatMap((group) => group.items);
  const showAdmin = isGlobalAdminEmail(userEmail);
  const adminHref = "/app/admin";

  if (variant === "drawer") {
    const finalGroups = showAdmin
      ? [
          ...navGroups,
          {
            label: "Admin",
            items: [{ href: adminHref, label: "Administração", icon: Shield }],
          },
        ]
      : navGroups;

    return (
      <nav className="flex flex-col gap-5">
        {finalGroups.map((group) => (
          <div
            key={group.label}
            className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-2 shadow-none"
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
                      "group flex items-center gap-3 rounded-xl px-3 py-3 text-[0.95rem] font-medium transition-all duration-150",
                      active
                        ? "bg-[var(--app-active)] text-[#9a3412] font-semibold"
                        : "text-[var(--app-text-70)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                        active
                          ? "text-[#9a3412]"
                          : "text-[var(--app-text-60)] group-hover:text-[var(--app-text-85)]",
                      ].join(" ")}
                    >
                      <Icon className="h-[1.15rem] w-[1.15rem]" />
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
    <nav className="flex flex-col gap-1.5">
      {navItems.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-[0.95rem] font-medium transition-colors duration-150",
              active
                ? "bg-[var(--app-active)] text-[#9a3412] font-semibold"
                : "text-[var(--app-text-70)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]",
            ].join(" ")}
          >
            <Icon className="h-[1.15rem] w-[1.15rem]" />
            {item.label}
          </Link>
        );
      })}

      {showAdmin ? (
        <>
          <div className="my-2 h-px w-full bg-[var(--app-border)]"></div>
          <Link
            href={adminHref}
            className={[
              "flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-[0.95rem] font-medium transition-colors duration-150",
              pathname === adminHref
                ? "bg-[var(--app-active)] text-[#9a3412] font-semibold"
                : "text-[var(--app-text-70)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]",
            ].join(" ")}
          >
            <Shield className="h-[1.15rem] w-[1.15rem]" />
            Administração
          </Link>
        </>
      ) : null}
    </nav>
  );
}
