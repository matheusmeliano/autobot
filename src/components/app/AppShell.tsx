"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppNav } from "@/components/app/AppNav";
import { logoutAction } from "@/app/app/actions";
import { Logo } from "@/components/ui/Logo";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizePlan } from "@/lib/plans";
import { updateThemeAction } from "@/app/app/configuracoes/actions";
import { modalToast } from "@/lib/modalToast";
import { AppThemeProvider, type AppTheme } from "@/components/app/AppThemeProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState<string>("");
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [plan, setPlan] = useState<"teste" | "basico" | "pro" | "vitalicio">("teste");
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof document === "undefined") return "dark";
    const current = document.documentElement.getAttribute("data-theme");
    return current === "light" || current === "dark" ? current : "dark";
  });
  const [themePreference, setThemePreference] = useState<AppTheme | null>(null);
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [themeGateDraft, setThemeGateDraft] = useState<AppTheme>("dark");
  const [themeGateSaving, setThemeGateSaving] = useState(false);
  const [themeGateError, setThemeGateError] = useState<string>("");

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setEmail(data.user?.email ?? "");
      setIsAuthed(Boolean(data.user));
      setAuthChecked(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? "");
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
      setTheme(next);
      try {
        localStorage.setItem("app_theme", next);
      } catch {}

      const res = await updateThemeAction({ theme: next });
      if (!res.ok) return res;

      setThemePreference(next);
      return { ok: true as const };
    },
    [setTheme],
  );

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthed) return;

    let active = true;
    const checkAccess = async () => {
      const [{ data: profile }, { data: sub }] = await Promise.all([
        supabase.from("profiles").select("plano, theme").maybeSingle(),
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
      const rawTheme = (profile as any)?.theme;
      const savedTheme: AppTheme | null = rawTheme === "light" || rawTheme === "dark" ? rawTheme : null;
      setThemePreference(savedTheme);
      let storedTheme: AppTheme | null = null;
      try {
        const v = localStorage.getItem("app_theme");
        storedTheme = v === "light" || v === "dark" ? v : null;
      } catch {}
      setTheme(savedTheme ?? storedTheme ?? "dark");
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
  }, [authChecked, isAuthed, supabase]);

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthed) return;
    if (!themeLoaded) return;
    if (themePreference) return;
    if (restricted) return;

    const currentPath = pathname ?? "";
    if (currentPath !== "/app/dashboard") {
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

  const showAdmin = isGlobalAdminEmail(email);

  if (authChecked && !isAuthed) return null;

  const currentPath = pathname ?? "";
  const shouldHoldRender =
    restricted &&
    currentPath !== "/app/assinatura" &&
    !currentPath.startsWith("/app/assinatura/") &&
    currentPath !== "/app/configuracoes" &&
    !currentPath.startsWith("/app/configuracoes/");
  if (shouldHoldRender) return null;

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

  const themeProviderValue = { theme, themePreference, themeLoaded, saveTheme };

  return (
    <AppThemeProvider value={themeProviderValue}>
      <div className="min-h-screen">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-[-260px] h-[680px] w-[680px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.18),rgba(99,102,241,0)_55%)]" />
          <div className="absolute right-[-220px] top-[140px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.12),rgba(16,185,129,0)_55%)]" />
        </div>

        <div className="relative flex w-full gap-6 px-4 py-6 min-[1201px]:px-6">
        <aside className="hidden w-72 shrink-0 min-[1201px]:sticky min-[1201px]:top-6 min-[1201px]:block min-[1201px]:h-[calc(100vh-3rem)]">
          <div className="flex h-full flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4 backdrop-blur-xl">
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

            <div className="mt-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-3 py-2">
              <div className="text-[11px] font-semibold text-[var(--app-text-45)]">
                Logado como
              </div>
              <div className="mt-1 truncate text-sm font-semibold">
                {email || "—"}
              </div>
            </div>

            <div className="mt-4 flex-1">
              <AppNav variant="sidebar" restricted={restricted} plan={plan} />
            </div>

            <form action={logoutAction} className="mt-4">
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)]"
              >
                Sair
              </button>
            </form>
          </div>
        </aside>

        <div className="w-full pb-16 min-[1201px]:pb-6">
          <div className="mb-4 flex items-center justify-between gap-2 min-[1201px]:hidden">
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-xl px-3 py-2 text-xs font-semibold text-[var(--app-text-60)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]"
              >
                Sair
              </button>
            </form>
            {showAdmin ? (
              <Link
                href="/admin"
                className="rounded-xl px-3 py-2 text-xs font-semibold text-[var(--app-text-60)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]"
              >
                Admin
              </Link>
            ) : null}
          </div>
          <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] p-4 backdrop-blur-xl min-[1201px]:p-6">
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

        <div className="fixed inset-x-0 bottom-0 border-t border-[var(--app-border)] bg-[var(--app-bg-soft)] backdrop-blur-xl min-[1201px]:hidden">
        <AppNav variant="bottom" restricted={restricted} plan={plan} />
      </div>

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
                className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[var(--app-btn-primary-bg)] px-4 text-sm font-semibold text-[var(--app-btn-primary-fg)] hover:bg-[var(--app-btn-primary-bg-hover)] disabled:opacity-60"
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
