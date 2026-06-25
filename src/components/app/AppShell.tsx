"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Menu, X } from "lucide-react";
import { AppNav } from "@/components/app/AppNav";
import { logoutAction } from "@/app/app/actions";
import { Logo } from "@/components/ui/Logo";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizePlan, type PlanKey } from "@/lib/plans";
import { updateThemeAction } from "@/app/app/configuracoes/actions";
import { modalToast } from "@/lib/modalToast";
import { AppThemeProvider, type AppTheme } from "@/components/app/AppThemeProvider";
import { getThemeStorageKey, normalizeStoredTheme } from "@/lib/theme";

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

  const saveTheme = useCallback(
    async (next: AppTheme) => {
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
        supabase.from("profiles").select("plano, theme, nome").maybeSingle(),
        supabase
          .from("subscriptions")
          .select("id, plano, status, vencimento, created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const plan = normalizePlan(profile?.plano ?? sub?.plano ?? "teste");
      if (!active) return;
      setPlan(plan);
      setProfileName(String(profile?.nome ?? "").trim());
      const rawTheme = (profile as { theme?: unknown } | null)?.theme;
      const savedTheme = normalizeStoredTheme(rawTheme);
      setThemePreference(savedTheme);
      let storedTheme: AppTheme | null = null;
      if (userId) {
        try {
          storedTheme = normalizeStoredTheme(localStorage.getItem(getThemeStorageKey(userId)));
        } catch {}
      }
      const resolvedTheme = savedTheme ?? storedTheme ?? initialTheme;
      setTheme(resolvedTheme);
      if (userId) {
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
  }, [authChecked, initialTheme, isAuthed, supabase, userId]);

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthed) return;
    if (!themeLoaded) return;
    if (themePreference) return;
    if (restricted) return;

    const currentPath = pathname ?? "";
    if (
      currentPath !== "/app/dashboard" &&
      currentPath !== "/app/configuracoes" &&
      !currentPath.startsWith("/app/configuracoes/")
    ) {
      router.replace("/app/dashboard");
    }
  }, [authChecked, isAuthed, pathname, restricted, router, themeLoaded, themePreference]);

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
      currentPath.startsWith("/app/configuracoes/")
    ) {
      return;
    }

    router.replace("/app/assinatura?blocked=1");
  }, [authChecked, isAuthed, pathname, restricted, router]);

  const showThemeGate =
    authChecked &&
    isAuthed &&
    themeLoaded &&
    !themePreference &&
    !restricted &&
    (pathname ?? "") === "/app/dashboard";

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

  const showAdmin = isGlobalAdminEmail(email);
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

  if (authChecked && !isAuthed) return null;

  const currentPath = pathname ?? "";
  const shouldHoldRender =
    restricted &&
    currentPath !== "/app/assinatura" &&
    !currentPath.startsWith("/app/assinatura/") &&
    currentPath !== "/app/configuracoes" &&
    !currentPath.startsWith("/app/configuracoes/");
  if (shouldHoldRender) return null;

  const themeProviderValue = { theme, themePreference, themeLoaded, saveTheme };

  return (
    <AppThemeProvider value={themeProviderValue}>
      <div className="min-h-screen">
        <div className="relative flex w-full gap-6 px-4 py-6 min-[1201px]:px-6">
        <aside className="hidden w-72 shrink-0 min-[1201px]:sticky min-[1201px]:top-6 min-[1201px]:block min-[1201px]:h-[calc(100vh-3rem)]">
          <div className="flex h-full flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Logo />
                <div className="text-sm font-semibold tracking-tight">AutoBot</div>
              </div>
              {showAdmin ? (
                <Link
                  href="/admin"
                  className="rounded-xl px-3 py-2 text-xs font-semibold text-[var(--app-text-60)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]"
                >
                  Admin
                </Link>
              ) : null}
            </div>

            <LoggedInAsCard email={email} className="mt-4" />

            <div className="mt-4 flex-1">
              <AppNav variant="sidebar" restricted={restricted} plan={plan} />
            </div>

            <form action={logoutAction} className="mt-4" onSubmit={handleLogoutSubmit}>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
              >
                Sair
              </button>
            </form>
          </div>
        </aside>

        <div className="flex min-h-[calc(100vh-3rem)] w-full flex-col pb-0 min-[1201px]:pb-6">
          <div className="fixed right-4 top-4 z-[250] flex items-center justify-end gap-2 min-[1201px]:hidden">
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
          <div className="flex-1 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4 min-[1201px]:p-6">
            {children}
          </div>
          <div className="mt-3 flex justify-end text-xs text-[var(--app-text-35)]">
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
          </div>
        </div>
      </div>

        <div
          className={[
            "fixed inset-0 z-[260] min-[1201px]:hidden",
            mobileMenuOpen ? "pointer-events-auto" : "pointer-events-none",
          ].join(" ")}
          aria-hidden={!mobileMenuOpen}
        >
          <button
            type="button"
            className={[
              "absolute inset-0 bg-black/55 transition-opacity duration-300",
              mobileMenuOpen ? "opacity-100" : "opacity-0",
            ].join(" ")}
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Fechar menu"
          />
          <aside
            id="mobile-app-drawer"
            className={[
              "absolute right-0 top-0 flex h-full w-full max-w-none flex-col overflow-hidden border-l border-[var(--app-border)] bg-[var(--app-bg)] transition-transform duration-300 ease-out md:max-w-sm",
              mobileMenuOpen ? "translate-x-0" : "translate-x-full",
            ].join(" ")}
          >
            <div className="border-b border-[var(--app-border)] bg-[var(--app-card)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--app-card-2)]">
                    <Logo />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[var(--app-text-85)]">AutoBot</div>
                    <div className="mt-0.5 text-xs text-[var(--app-text-45)]">Navegação do aplicativo</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] text-[var(--app-fg)] hover:bg-[var(--app-card)] hover:text-[var(--app-fg)]"
                  aria-label="Fechar menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-4">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] text-sm font-semibold text-[var(--app-text-85)]">
                    {avatarLabel || "U"}
                  </div>
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
              {showAdmin ? (
                <Link
                  href="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="mt-3 flex items-center justify-between rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-3 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-card)]"
                >
                  <span>Admin</span>
                  <span className="text-xs text-[var(--app-text-45)]">Painel administrativo</span>
                </Link>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <AppNav
                variant="drawer"
                restricted={restricted}
                plan={plan}
                onNavigate={() => setMobileMenuOpen(false)}
              />
            </div>

            <div className="border-t border-[var(--app-border)] bg-[var(--app-card)] px-4 py-4">
              <form action={logoutAction} onSubmit={handleLogoutSubmit}>
                <button
                  type="submit"
                  className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-card)]"
                >
                  Sair da conta
                </button>
              </form>
            </div>
          </aside>
        </div>

        {pendingPayment ? (
          <div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/60 px-4 py-10">
            <div className="w-full max-w-md rounded-2xl border border-[var(--app-border)] bg-[var(--app-modal-bg)] p-6">
              <div className="text-sm font-semibold tracking-tight text-[var(--app-text-85)]">
                Possível pagamento detectado
              </div>
              <div className="mt-2 text-sm text-[var(--app-text-60)]">
                Confirme se o cliente realmente pagou. Só então a cobrança será marcada como paga.
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

        {showThemeGate ? (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 px-4 py-10">
            <div className="w-full max-w-md rounded-2xl border border-[var(--app-border)] bg-[var(--app-modal-bg)] p-6 backdrop-blur-xl">
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
