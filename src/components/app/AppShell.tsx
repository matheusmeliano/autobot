"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppNav } from "@/components/app/AppNav";
import { logoutAction } from "@/app/app/actions";
import { Logo } from "@/components/ui/Logo";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizePlan } from "@/lib/plans";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState<string>("");
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [restricted, setRestricted] = useState(false);

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
    if (!isAuthed) return;

    let active = true;
    const checkAccess = async () => {
      const [{ data: profile }, { data: sub }] = await Promise.all([
        supabase.from("profiles").select("plano").maybeSingle(),
        supabase
          .from("subscriptions")
          .select("id, plano, status, vencimento, created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const plan = normalizePlan(profile?.plano ?? sub?.plano ?? "teste");
      if (plan === "vitalicio") {
        if (!active) return;
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
    if (currentPath === "/app/assinatura" || currentPath.startsWith("/app/assinatura/")) {
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
    !currentPath.startsWith("/app/assinatura/");
  if (shouldHoldRender) return null;

  return (
    <div className="min-h-screen bg-[#070A10] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-260px] h-[680px] w-[680px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.18),rgba(99,102,241,0)_55%)]" />
        <div className="absolute right-[-220px] top-[140px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.12),rgba(16,185,129,0)_55%)]" />
      </div>

      <div className="relative flex w-full gap-6 px-4 py-6 min-[1201px]:px-6">
        <aside className="hidden w-72 shrink-0 min-[1201px]:sticky min-[1201px]:top-6 min-[1201px]:block min-[1201px]:h-[calc(100vh-3rem)]">
          <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Logo />
                <div className="text-sm font-semibold tracking-tight">AutoBot</div>
              </div>
              {showAdmin ? (
                <Link
                  href="/admin"
                  className="rounded-xl px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/[0.06] hover:text-white/85"
                >
                  Admin
                </Link>
              ) : null}
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="text-[11px] font-semibold text-white/45">
                Logado como
              </div>
              <div className="mt-1 truncate text-sm font-semibold">
                {email || "—"}
              </div>
            </div>

            <div className="mt-4 flex-1">
              <AppNav variant="sidebar" restricted={restricted} />
            </div>

            <form action={logoutAction} className="mt-4">
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
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
                className="rounded-xl px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/[0.06] hover:text-white/85"
              >
                Sair
              </button>
            </form>
            {showAdmin ? (
              <Link
                href="/admin"
                className="rounded-xl px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/[0.06] hover:text-white/85"
              >
                Admin
              </Link>
            ) : null}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl min-[1201px]:p-6">
            {children}
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#070A10]/80 backdrop-blur-xl min-[1201px]:hidden">
        <AppNav variant="bottom" restricted={restricted} />
      </div>

      <div className="fixed bottom-20 right-4 z-40 text-xs text-white/50 min-[1201px]:bottom-4">
        Desenvolvido pela{" "}
        <a
          href="#"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-white/70 hover:text-white"
        >
          HEYBROTHERS
        </a>
        .
      </div>
    </div>
  );
}
