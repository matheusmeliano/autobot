"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  CalendarDays,
  CircleUserRound,
  Camera,
  Headset,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquareText,
  Settings,
  Smartphone,
  X,
} from "lucide-react";
import { AppNav } from "@/components/app/AppNav";
import { AvatarChangeModal } from "@/components/app/AvatarChangeModal";
import { logoutAction } from "@/app/app/actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizePlan, type PlanKey } from "@/lib/plans";
import { updateThemeAction } from "@/app/app/configuracoes/actions";
import { modalToast } from "@/lib/modalToast";
import { AppThemeProvider, type AppTheme } from "@/components/app/AppThemeProvider";
import { getThemeStorageKey, normalizeStoredTheme } from "@/lib/theme";
import { getDefaultAuthenticatedPath, isAtendimentoOnlyAccessScope } from "@/lib/auth/access";


function paymentToastMessage(pending: any) {
  const name = String(pending?.debtor?.nome ?? "").trim();
  const amount = String(pending?.amount_brl ?? "").trim();
  const due = String(pending?.due_date_br ?? "").trim();
  const parts = [name || "", amount || "", due ? `Venc.: ${due}` : ""].filter(Boolean);
  const suffix = parts.length ? ` (${parts.join(" • ")})` : "";
  return `Possível pagamento identificado. Deseja dar baixa na cobrança?${suffix}`;
}

function LoggedInAsCard({
  email,
  className = "",
}: {
  email: string;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-3 py-2",
        className,
      ].join(" ")}
    >
      <div className="text-[11px] font-semibold text-[var(--app-text-45)]">Logado como</div>
      <div className="mt-1 truncate text-sm font-semibold text-[var(--app-text-85)]">
        {email || "—"}
      </div>
    </div>
  );
}

export function AppShell({
  children,
  initialUserId,
  initialTheme,
}: {
  children: React.ReactNode;
  initialUserId: string;
  initialTheme: AppTheme;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState<string>("");
  const [profileName, setProfileName] = useState<string>("");
  const [userId, setUserId] = useState(initialUserId);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [plan, setPlan] = useState<PlanKey>("teste");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof document === "undefined") return initialTheme;
    const current = normalizeStoredTheme(document.documentElement.getAttribute("data-theme"));
    return current ?? initialTheme;
  });
  const [themePreference, setThemePreference] = useState<AppTheme | null>(null);
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [themeGateDraft, setThemeGateDraft] = useState<AppTheme>("dark");
  const [themeGateSaving, setThemeGateSaving] = useState(false);
  const [themeGateError, setThemeGateError] = useState<string>("");
  const [pendingPayment, setPendingPayment] = useState<any | null>(null);
  const [paymentResolving, setPaymentResolving] = useState<"confirm" | "reject" | null>(null);
  const lastPaymentSuspicionRealtimeIdRef = useRef<string>("");
  const [bootOverlayVisible, setBootOverlayVisible] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);

  const showThemeGate = false;

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setEmail(data.user?.email ?? "");
      setUserId(data.user?.id ?? "");
      setIsAuthed(Boolean(data.user));
      setAuthChecked(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? "");
      setUserId(session?.user?.id ?? "");
      setIsAuthed(Boolean(session?.user));
      setAuthChecked(true);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!authChecked) return;
    if (isAuthed) return;
    setProfileName("");
    setUserId("");
    setTheme("dark");
    setThemePreference(null);
    setThemeLoaded(false);
    setRestricted(false);
    setPlan("teste");
    setAvatarUrl(null);
  }, [authChecked, isAuthed]);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("app-theme");
    el.setAttribute("data-app-theme-scope", "app");
    el.setAttribute("data-theme", theme);
    const raf = window.requestAnimationFrame(() => el.classList.add("theme-ready"));
    return () => {
      window.cancelAnimationFrame(raf);
      if (el.getAttribute("data-app-theme-scope") === "app") {
        el.classList.remove("theme-ready");
        el.classList.remove("app-theme");
        el.removeAttribute("data-theme");
        el.removeAttribute("data-app-theme-scope");
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const el = document.documentElement;
    const isLightForced =
      typeof pathname === "string" &&
      (pathname.startsWith("/app") || pathname.startsWith("/admin"));
    if (isLightForced) {
      el.classList.add("app-theme");
      el.setAttribute("data-app-theme-scope", "app");
      el.setAttribute("data-theme", "light");
      window.requestAnimationFrame(() => el.classList.add("theme-ready"));
      return;
    }
  }, [pathname]);

  const saveTheme = useCallback(
    async (_next: AppTheme) => {
      const next: AppTheme = "dark";
      const previousTheme = theme;
      setTheme(next);

      const res = await updateThemeAction({ theme: next });
      if (!res.ok) {
        setTheme(previousTheme);
        return res;
      }

      if (userId) {
        try {
          localStorage.setItem(getThemeStorageKey(userId), next);
        } catch {}
      }

      setThemePreference(next);
      return { ok: true as const };
    },
    [theme, userId],
  );

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthed) return;

    let active = true;
    const checkAccess = async () => {
      const [{ data: profile }, { data: sub }] = await Promise.all([
        supabase.from("profiles").select("plano, theme, nome, access_scope, avatar_url").maybeSingle(),
        supabase
          .from("subscriptions")
          .select("id, plano, status, vencimento, created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const plan = normalizePlan(profile?.plano ?? sub?.plano ?? "teste");
      if (!active) return;
      if (isAtendimentoOnlyAccessScope(profile?.access_scope)) {
        router.replace(getDefaultAuthenticatedPath(profile?.access_scope));
        return;
      }
      setPlan(plan);
      setProfileName(String(profile?.nome ?? "").trim());
      setAvatarUrl(String(profile?.avatar_url ?? "").trim() || null);
      const rawTheme = (profile as { theme?: unknown } | null)?.theme;
      const savedTheme = normalizeStoredTheme(rawTheme);
      let storedTheme: AppTheme | null = null;
      if (userId) {
        try {
          storedTheme = normalizeStoredTheme(localStorage.getItem(getThemeStorageKey(userId)));
        } catch {}
      }
      const isLightForced =
        typeof pathname === "string" &&
        (pathname.startsWith("/app") || pathname.startsWith("/admin"));
      const resolvedTheme = isLightForced
        ? "light"
        : savedTheme ?? storedTheme ?? initialTheme;
      setThemePreference(isLightForced ? null : savedTheme ?? resolvedTheme);
      setTheme(resolvedTheme);
      if (userId && !isLightForced) {
        try {
          localStorage.setItem(getThemeStorageKey(userId), resolvedTheme);
        } catch {}
      }
      setThemeLoaded(true);
      if (plan === "vitalicio") {
        setRestricted(false);
        return;
      }

      const rawStatus = String(sub?.status ?? "").toLowerCase();
      const status = rawStatus === "pausado" || rawStatus === "past_due" ? "cancelado" : rawStatus;
      const vencimento = sub?.vencimento ?? null;
      const today = new Date().toISOString().slice(0, 10);
      const isExpired =
        typeof vencimento === "string" &&
        vencimento.length >= 10 &&
        vencimento.slice(0, 10) < today;

      if (isExpired && sub?.id && status !== "cancelado") {
        await supabase.from("subscriptions").update({ status: "cancelado" }).eq("id", sub.id);
      }

      const isBlocked = status === "cancelado" || isExpired;
      if (!active) return;
      setRestricted(isBlocked);
    };

    checkAccess();
    const onFocus = () => checkAccess();
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkAccess();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authChecked, initialTheme, isAuthed, pathname, supabase, userId]);

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthed) return;
    if (!themeLoaded) return;
    if (themePreference) return;
    if (restricted) return;
    if (!showThemeGate) return;

    const currentPath = pathname ?? "";
    if (
      currentPath !== "/app/dashboard" &&
      currentPath !== "/app/configuracoes" &&
      !currentPath.startsWith("/app/configuracoes/")
    ) {
      router.replace("/app/dashboard");
    }
  }, [authChecked, isAuthed, pathname, restricted, router, themeLoaded, themePreference, showThemeGate]);

  useEffect(() => {
    if (!authChecked) return;
    if (isAuthed) return;

    const qs = searchParams?.toString();
    const safePath = pathname ?? "/app";
    const next = `${safePath}${qs ? `?${qs}` : ""}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [authChecked, isAuthed, pathname, router, searchParams]);

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthed) return;
    if (!restricted) return;

    const currentPath = pathname ?? "";
    if (
      currentPath === "/app/assinatura" ||
      currentPath.startsWith("/app/assinatura/") ||
      currentPath === "/app/configuracoes" ||
      currentPath.startsWith("/app/configuracoes/") ||
      currentPath === "/app/whatsapp" ||
      currentPath.startsWith("/app/whatsapp/")
    ) {
      return;
    }

    router.replace("/app/assinatura?blocked=1");
  }, [authChecked, isAuthed, pathname, restricted, router]);

  useEffect(() => {
    if (!showThemeGate) return;
    setThemeGateDraft(theme);
    setThemeGateError("");
  }, [showThemeGate, theme]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      document.body.style.removeProperty("overflow");
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileMenuOpen]);

  const displayName = profileName || email.split("@")[0] || "Usuário";
  const avatarLabel = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2);

  const handleLogoutSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    if (window.confirm("Deseja realmente sair?")) return;
    event.preventDefault();
  }, []);

  const renderAvatarBlock = useCallback(
    (variant: "sidebar" | "drawer") => {
      const shapeClass =
        variant === "sidebar" ? "rounded-full" : "rounded-2xl";
      const hasAvatar = Boolean(avatarUrl);
      const fallbackLabel = avatarLabel || "U";

      return (
        <button
          type="button"
          onClick={() => setAvatarModalOpen(true)}
          aria-label="Alterar foto de perfil"
          className={[
            "group relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden",
            shapeClass,
            hasAvatar
              ? "bg-black p-0"
              : "border border-[color:var(--app-active)] bg-[color:var(--app-active)]",
          ].join(" ")}
        >
          {hasAvatar ? (
            <img
              src={avatarUrl!}
              alt="Foto de perfil"
              loading="lazy"
              className="h-[120%] w-[120%] shrink-0 object-cover scale-110"
            />
          ) : (
            <span className="font-bold tracking-tight text-[#9a3412]">
              {fallbackLabel}
            </span>
          )}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-150 group-hover:bg-black/45">
            <Camera className="h-5 w-5 !text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100" stroke="white" />
          </span>
        </button>
      );
    },
    [avatarUrl, avatarLabel],
  );

  const fetchPendingPayment = useCallback(async () => {
    if (!authChecked) return;
    if (!isAuthed) return;
    try {
      const res = await fetch("/api/payment-suspicions/pending", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!json?.ok) return;
      const next = json?.pending ?? null;
      setPendingPayment((prev: any) => {
        if (!next && !prev) return prev;
        if (!next && prev) return null;
        if (next && prev && String(next.id) === String(prev.id)) return prev;
        return next;
      });
      return next;
    } catch {}
  }, [authChecked, isAuthed]);

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthed) return;
    fetchPendingPayment();
    const id = window.setInterval(() => fetchPendingPayment(), 8000);
    const onFocus = () => fetchPendingPayment();
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchPendingPayment();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authChecked, fetchPendingPayment, isAuthed]);

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthed) return;
    if (!userId) return;

    const channel = supabase
      .channel(`payment-suspicions:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "payment_suspicions",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const nextId = String((payload as any)?.new?.id ?? "");
          if (nextId && lastPaymentSuspicionRealtimeIdRef.current === nextId) return;
          if (nextId) lastPaymentSuspicionRealtimeIdRef.current = nextId;
          fetchPendingPayment().then((next) => {
            modalToast.info(paymentToastMessage(next));
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authChecked, fetchPendingPayment, isAuthed, supabase, userId]);

  const currentPath = pathname ?? "";
  const drawerOnlyNav =
    currentPath === "/app/atendimento" || currentPath.startsWith("/app/atendimento/");

  const resolvePendingPayment = useCallback(
    async (decision: "confirm" | "reject") => {
      if (!pendingPayment?.id) return;
      if (paymentResolving) return;
      setPaymentResolving(decision);
      try {
        const res = await fetch("/api/payment-suspicions/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: pendingPayment.id, decision }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          modalToast.error(json?.error ?? "Falha ao confirmar pagamento.");
          return;
        }
        setPendingPayment(null);
        modalToast.success(decision === "confirm" ? "Pagamento confirmado." : "Suspeita rejeitada.");
        router.refresh();
      } catch {
        modalToast.error("Falha ao confirmar pagamento.");
      } finally {
        setPaymentResolving(null);
      }
    },
    [paymentResolving, pendingPayment, router],
  );

  useEffect(() => {
    const ready =
      themeLoaded &&
      authChecked &&
      typeof pathname !== "undefined" &&
      pathname !== null;
    if (!ready) return;
    const t = window.setTimeout(() => setBootOverlayVisible(false), 120);
    return () => window.clearTimeout(t);
  }, [themeLoaded, authChecked, pathname]);

  const isAppThemeScope = typeof pathname === "string" && pathname.startsWith("/app");
  const resolvedTheme: AppTheme = isAppThemeScope ? "light" : theme;
  const themeProviderValue = { theme: resolvedTheme, themePreference, themeLoaded, saveTheme };

  if (authChecked && !isAuthed) return null;
  const shouldHoldRender =
    restricted &&
    currentPath !== "/app/assinatura" &&
    !currentPath.startsWith("/app/assinatura/") &&
    currentPath !== "/app/configuracoes" &&
    !currentPath.startsWith("/app/configuracoes/") &&
    currentPath !== "/app/whatsapp" &&
    !currentPath.startsWith("/app/whatsapp/");
  if (shouldHoldRender) return null;

  return (
    <AppThemeProvider value={themeProviderValue}>
      <div
        aria-hidden={!bootOverlayVisible}
        className={[
          "fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#efeeed] transition-opacity duration-200",
          bootOverlayVisible ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
      >
        <Loader2 className="h-10 w-10 animate-spin text-[#ea580c]" />
        <div className="mt-4 text-[15px] font-semibold tracking-tight text-[#9a3412]">
          Carregando AutoBot...
        </div>
      </div>

      <div className={drawerOnlyNav ? "min-h-0 lg:h-[100dvh] lg:overflow-hidden" : "min-h-[100dvh]"}>
        <div
          className={[
            "relative flex w-full",
            drawerOnlyNav
              ? "min-h-0 flex-col gap-4 overflow-visible px-4 pb-6 pt-6 min-[1201px]:px-6 lg:h-full lg:min-h-0 lg:gap-6 lg:overflow-hidden lg:py-6"
              : "gap-6 px-4 py-6 min-[1201px]:px-6",
          ].join(" ")}
        >
        <aside
          className={[
            "w-72 shrink-0 min-[1201px]:sticky min-[1201px]:top-6 min-[1201px]:h-[calc(100dvh-3rem)]",
            drawerOnlyNav ? "hidden" : "hidden min-[1201px]:block",
          ].join(" ")}
        >
          <div className="flex h-full flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
            <div className="flex items-start gap-3">
              {renderAvatarBlock("sidebar")}
              <div className="min-w-0">
                <div className="truncate text-[0.95rem] font-semibold leading-tight text-[var(--app-text-85)]">
                  {displayName}
                </div>
                <div className="mt-1 truncate text-[0.8rem] text-[var(--app-text-55)]">
                  {email || "Sem e-mail"}
                </div>
              </div>
            </div>

            <div className="mt-5 border-t border-[var(--app-border)]" />

            <div className="mt-5 flex-1 min-h-0 overflow-hidden">
              <div className="h-full overflow-y-auto scrollbar-hide pr-1">
                <AppNav variant="sidebar" restricted={restricted} plan={plan} userEmail={email} />
              </div>
            </div>

            <div className="mt-5 border-t border-[var(--app-border)]" />

            <form action={logoutAction} className="mt-5" onSubmit={handleLogoutSubmit}>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[0.95rem] font-semibold text-[#9a3412] hover:bg-[color:var(--app-active)]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sair
              </button>
            </form>
          </div>
        </aside>

        <div
          className={[
            "flex w-full flex-col",
            drawerOnlyNav
              ? "pl-[112px] min-h-0 overflow-visible pb-0 lg:h-full lg:min-h-0 lg:overflow-hidden"
              : "pb-0 min-[1201px]:pb-6",
          ].join(" ")}
        >
          {drawerOnlyNav ? (
            // NAVIGATION RAIL (lado esquerdo fixo) — estilo imagem referencia
            <aside
              aria-label="Navegação principal"
              className={[
                "fixed left-4 top-4 bottom-4 z-[250]",
                "w-20",
                "flex flex-col items-center gap-3 p-3",
                "rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-solid-surface)] shadow-none",
              ].join(" ")}
            >
              {/* 1) Avatar topo */}
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => setAvatarModalOpen(true)}
                  className="group relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-white shadow-sm transition hover:scale-[1.02]"
                  style={{ backgroundColor: avatarUrl ? undefined : "var(--app-active)", color: "#9a3412" }}
                  aria-label={avatarUrl ? "Alterar foto de perfil" : "Adicionar foto de perfil"}
                  title={avatarUrl ? "Alterar foto" : "Adicionar foto"}
                >
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt={displayName || "Avatar"}
                      width={48}
                      height={48}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="text-[15px] font-bold tracking-tight leading-none">
                      {fallbackInitials}
                    </span>
                  )}
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition group-hover:opacity-100">
                    <Camera className="h-4 w-4 text-white" />
                  </span>
                </button>
              </div>

              {/* 2) Botão Expandir / Abrir Drawer completo (seta direita grande, destaque accent) */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Abrir menu completo"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-app-drawer"
                className={[
                  "inline-flex h-12 w-12 items-center justify-center rounded-full shadow-none transition-all",
                  "border border-[rgba(234,88,12,0.35)] bg-[rgba(234,88,12,0.14)] text-[#9a3412]",
                  "hover:bg-[rgba(234,88,12,0.22)] active:scale-95",
                ].join(" ")}
              >
                <ArrowRight className="h-5 w-5" strokeWidth={2.5} />
              </button>

              {/* 3) Separador */}
              <div className="h-px w-full shrink-0 bg-[var(--app-border)]" />

              {/* 4) Itens do menu (icones) — itens principais do AppNav */}
              <nav className="flex w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto scrollbar-hide py-1">
                {(
                  [
                    { href: "/app/dashboard", label: "Painel", icon: LayoutDashboard, section: "Principal" },
                    { href: "/app/clientes", label: "Clientes", icon: CircleUserRound, section: "Principal" },
                    { href: "/app/mensagens", label: "Mensagens", icon: MessageSquareText, section: "Principal" },
                    { href: "/app/agendar", label: "Agendar", icon: CalendarDays, section: "Principal" },
                    { href: "/app/atendimento", label: "Atendimento", icon: Headset, section: "Principal" },
                    { href: "/app/whatsapp", label: "WhatsApp", icon: Smartphone, section: "Principal" },
                    ...(restricted
                      ? []
                      : [
                          { href: "/app/relatorios" as const, label: "Relatórios", icon: BarChart3, section: "Gestão" },
                          { href: "/app/assinatura" as const, label: "Assinatura", icon: BadgeCheck, section: "Gestão" },
                        ]),
                    { href: "/app/configuracoes", label: "Configurações", icon: Settings, section: "Conta" },
                  ] as Array<{ href: string; label: string; icon: any; section: string }>
                ).map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      title={item.label}
                      aria-label={item.label}
                      className={[
                        "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-all",
                        active
                          ? "bg-[var(--app-btn-primary-bg)] !text-[var(--app-btn-primary-fg)] shadow-none"
                          : "text-[var(--app-text-70)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]",
                      ].join(" ")}
                    >
                      <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 2} />
                    </Link>
                  );
                })}
              </nav>

              {/* 5) Separador final + Botão Sair */}
              <div className="h-px w-full shrink-0 bg-[var(--app-border)]" />
              <form action={logoutAction} className="w-full shrink-0" onSubmit={handleLogoutSubmit}>
                <button
                  type="submit"
                  aria-label="Sair da conta"
                  title="Sair"
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl text-[#9a3412] transition-all hover:bg-[color:var(--app-active)]"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </form>
            </aside>
          ) : (
            <div
              className={[
                "fixed right-4 top-4 z-[250] flex min-[1201px]:hidden",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-fg)] transition-all hover:bg-[var(--app-solid-surface-2)] hover:text-[var(--app-fg)]"
                aria-label="Abrir menu"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-app-drawer"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          )}
          {drawerOnlyNav ? (
            children
          ) : (
            <div className="flex-1 p-0 min-[1201px]:p-0">
              {children}
            </div>
          )}
          {drawerOnlyNav ? null : (
            <div className="mt-auto flex w-full justify-end pr-1 pb-1 pt-3 text-[11px] text-[var(--app-text-35)] min-[1201px]:pr-2 min-[1201px]:pb-1 min-[1201px]:pt-3">
              <span>
                Desenvolvido pela
                <a
                  href="https://heybrothers.vercel.app/"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 font-semibold text-[var(--app-text-60)] hover:text-[var(--app-text-85)]"
                >
                  HEYBROTHERS
                </a>
                .
              </span>
            </div>
          )}
        </div>
      </div>

        <div
          className={[
            "fixed inset-0 z-[260]",
            drawerOnlyNav ? "" : "min-[1201px]:hidden",
            mobileMenuOpen ? "pointer-events-auto" : "pointer-events-none",
          ].join(" ")}
          aria-hidden={!mobileMenuOpen}
        >
          <button
            type="button"
            className={[
              "absolute inset-0 bg-stone-900/40 transition-opacity duration-300",
              mobileMenuOpen ? "opacity-100" : "opacity-0",
            ].join(" ")}
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Fechar menu"
          />
          <aside
            id="mobile-app-drawer"
            className={[
              "absolute right-0 top-0 flex h-full w-full max-w-none flex-col overflow-hidden border-l border-[var(--app-border)] bg-[var(--app-modal-bg)] transition-transform duration-300 ease-out md:max-w-sm",
              mobileMenuOpen ? "translate-x-0" : "translate-x-full",
            ].join(" ")}
          >
            <div className="flex items-center justify-end px-3 pt-3 pb-2">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] text-[var(--app-fg)] hover:bg-[var(--app-solid-surface-2)] hover:text-[var(--app-fg)]"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-3 pb-1">
              <div className="rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-solid-surface)] px-4 py-4">
                <div className="flex items-center gap-3">
                  {renderAvatarBlock("drawer")}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--app-text-85)]">
                      {displayName}
                    </div>
                    <div className="mt-1 truncate text-xs text-[var(--app-text-55)]">
                      {email || "Sem e-mail"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-2 flex-1 overflow-y-auto px-3 py-2 pb-3">
              <AppNav
                variant="drawer"
                restricted={restricted}
                plan={plan}
                userEmail={email}
                onNavigate={() => setMobileMenuOpen(false)}
              />
            </div>

            <div className="border-t border-[var(--app-border)] bg-[var(--app-solid-surface)] px-3 py-4">
              <form action={logoutAction} onSubmit={handleLogoutSubmit}>
                <button
                  type="submit"
                  className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] px-4 text-sm font-semibold text-[#9a3412] hover:bg-[color:var(--app-active)]"
                >
                  Sair da conta
                </button>
              </form>
            </div>
          </aside>
        </div>

        {pendingPayment ? (
          <div className="fixed inset-0 z-[320] flex items-stretch justify-stretch bg-black/60 px-0 py-0 lg:items-center lg:justify-center lg:px-4 lg:py-10">
            <div className="h-full w-full overflow-y-auto rounded-none border-0 bg-[var(--app-modal-bg)] p-4 lg:h-auto lg:max-w-md lg:rounded-2xl lg:border lg:border-[var(--app-border)] lg:p-6">
              <div className="text-sm font-semibold tracking-tight text-[var(--app-text-85)]">
                Possível pagamento identificado
              </div>
              <div className="mt-2 text-sm text-[var(--app-text-60)]">
                Possível pagamento identificado. Deseja dar baixa na cobrança?
              </div>

              <div className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] p-4 text-sm">
                {pendingPayment?.debtor?.nome ? (
                  <div
                    className="truncate font-semibold text-[var(--app-text-85)]"
                    title={`Cliente: ${pendingPayment.debtor.nome}`}
                  >
                    Cliente: {pendingPayment.debtor.nome}
                  </div>
                ) : null}
                {pendingPayment?.amount_brl ? (
                  <div className={`${pendingPayment?.debtor?.nome ? "mt-2" : ""} text-xs text-[var(--app-text-60)]`}>
                    Valor: {pendingPayment.amount_brl}
                  </div>
                ) : null}
                {pendingPayment?.due_date_br ? (
                  <div className={`${pendingPayment?.amount_brl ? "mt-1" : pendingPayment?.debtor?.nome ? "mt-2" : ""} text-xs text-[var(--app-text-60)]`}>
                    Vencimento: {pendingPayment.due_date_br}
                  </div>
                ) : null}
                <div className={`${pendingPayment?.debtor?.nome ? "mt-2" : ""} text-xs text-[var(--app-text-60)]`}>
                  {pendingPayment?.from_phone ? `Telefone: ${pendingPayment.from_phone}` : null}
                </div>
                {pendingPayment?.ai_reason ? (
                  <div className="mt-2 text-xs text-[var(--app-text-60)]">
                    Motivo: {pendingPayment.ai_reason}
                  </div>
                ) : null}
                {pendingPayment?.message_text ? (
                  <div className="mt-3 whitespace-pre-wrap text-xs text-[var(--app-text-60)]">
                    {pendingPayment.message_text}
                  </div>
                ) : null}
                {pendingPayment?.media_url ? (
                  <a
                    href={pendingPayment.media_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex text-xs font-semibold text-[var(--app-text-85)] underline"
                  >
                    Ver anexo
                  </a>
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={Boolean(paymentResolving)}
                  onClick={() => resolvePendingPayment("reject")}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:bg-[var(--app-card-2)] disabled:text-[var(--app-text-60)] disabled:hover:bg-[var(--app-card-2)] disabled:opacity-100"
                >
                  {paymentResolving === "reject" ? "Enviando..." : "Não é pagamento"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(paymentResolving)}
                  onClick={() => resolvePendingPayment("confirm")}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:bg-[var(--app-card-2)] disabled:text-[var(--app-text-60)] disabled:hover:bg-[var(--app-card-2)] disabled:opacity-100"
                >
                  {paymentResolving === "confirm" ? "Confirmando..." : "Confirmar pagamento"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <AvatarChangeModal
          open={avatarModalOpen}
          onClose={() => setAvatarModalOpen(false)}
          currentAvatarUrl={avatarUrl}
          displayName={displayName}
          email={email}
          onAvatarChanged={(newUrl) => {
            setAvatarUrl(newUrl);
            router.refresh();
          }}
        />

        {showThemeGate ? (
          <div className="fixed inset-0 z-[300] flex items-stretch justify-stretch bg-black/60 px-0 py-0 lg:items-center lg:justify-center lg:px-4 lg:py-10">
            <div className="h-full w-full overflow-y-auto rounded-none border-0 bg-[var(--app-modal-bg)] p-4 backdrop-blur-xl lg:h-auto lg:max-w-md lg:rounded-2xl lg:border lg:border-[var(--app-border)] lg:p-6">
              <div className="text-sm font-semibold tracking-tight text-[var(--app-text-85)]">
                Escolha seu tema
              </div>
              <div className="mt-2 text-sm text-[var(--app-text-60)]">
                Selecione como você prefere visualizar o sistema e clique em salvar para continuar.
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    if (themeGateDraft === "light") {
                      modalToast.info("Esse tema já está em uso.");
                      return;
                    }
                    setThemeGateDraft("light");
                    setTheme("light");
                  }}
                  className={[
                    "w-full rounded-2xl border p-3 text-left",
                    themeGateDraft === "light"
                      ? "border-[var(--app-border)] bg-[var(--app-active)]"
                      : "border-[var(--app-border)] bg-[var(--app-card)] hover:bg-[var(--app-hover)]",
                  ].join(" ")}
                >
                  <div className="text-sm font-semibold text-[var(--app-text-85)]">Tema Claro</div>
                  <div className="mt-2 app-theme rounded-xl border border-[var(--app-border)] p-3" data-theme="light">
                    <div className="flex items-center justify-between">
                      <div className="h-2.5 w-16 rounded-full bg-[var(--app-border)]" />
                      <div className="h-2.5 w-10 rounded-full bg-[var(--app-border)]" />
                    </div>
                    <div className="mt-3 grid gap-2">
                      <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-card)] p-2">
                        <div className="h-2 w-24 rounded-full bg-[var(--app-border)]" />
                        <div className="mt-2 h-2 w-16 rounded-full bg-[var(--app-border)]" />
                      </div>
                      <div className="h-8 rounded-lg bg-[var(--app-btn-primary-bg)]" />
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (themeGateDraft === "dark") {
                      modalToast.info("Esse tema já está em uso.");
                      return;
                    }
                    setThemeGateDraft("dark");
                    setTheme("dark");
                  }}
                  className={[
                    "w-full rounded-2xl border p-3 text-left",
                    themeGateDraft === "dark"
                      ? "border-[var(--app-border)] bg-[var(--app-active)]"
                      : "border-[var(--app-border)] bg-[var(--app-card)] hover:bg-[var(--app-hover)]",
                  ].join(" ")}
                >
                  <div className="text-sm font-semibold text-[var(--app-text-85)]">Tema Escuro</div>
                  <div className="mt-2 app-theme rounded-xl border border-[var(--app-border)] p-3" data-theme="dark">
                    <div className="flex items-center justify-between">
                      <div className="h-2.5 w-16 rounded-full bg-[var(--app-border)]" />
                      <div className="h-2.5 w-10 rounded-full bg-[var(--app-border)]" />
                    </div>
                    <div className="mt-3 grid gap-2">
                      <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-card)] p-2">
                        <div className="h-2 w-24 rounded-full bg-[var(--app-border)]" />
                        <div className="mt-2 h-2 w-16 rounded-full bg-[var(--app-border)]" />
                      </div>
                      <div className="h-8 rounded-lg bg-[var(--app-btn-primary-bg)]" />
                    </div>
                  </div>
                </button>
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (themeGateSaving) return;
                  setThemeGateSaving(true);
                  setThemeGateError("");
                  try {
                    const res = await saveTheme(themeGateDraft);
                    if (!res.ok) {
                      const msg = res.error ?? "Falha ao salvar.";
                      setThemeGateError(msg);
                      modalToast.error(msg);
                      return;
                    }
                    setThemePreference(themeGateDraft);
                  } catch {
                    const msg = "Falha ao salvar.";
                    setThemeGateError(msg);
                    modalToast.error(msg);
                  } finally {
                    setThemeGateSaving(false);
                  }
                }}
                disabled={themeGateSaving}
                className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:bg-[var(--app-card-2)] disabled:text-[var(--app-text-60)] disabled:hover:bg-[var(--app-card-2)] disabled:opacity-100"
              >
                {themeGateSaving ? "Salvando..." : "Salvar"}
              </button>
              {themeGateError ? (
                <div className="mt-3 rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {themeGateError}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </AppThemeProvider>
  );
}
